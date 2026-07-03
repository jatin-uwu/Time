// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/services/email/email-service.js
// Reusable, enterprise-grade Email Service (SMTP via Nodemailer).
//
// ARCHITECTURE
//   Handlers → EmailService → SMTP → Recipient. Business logic never builds SMTP
//   config or transports; it calls one of:
//       sendEmail({ to, subject, text, html, ... })     // low-level
//       sendHtmlEmail({ to, subject, html, ... })        // convenience
//       sendTemplateEmail(template, to, data, opts)      // templated (preferred)
//   plus the fire-and-forget wrappers `*Async` that never block the caller.
//
// KEY PROPERTIES
//   • Config from ENV only (never hardcoded, never logged in clear — masked).
//   • Lazy, pooled transport (connection reuse).
//   • Retry with backoff for TRANSIENT errors only; auth/recipient errors fail fast.
//   • Every attempt is written to EmailLog (recipient/subject/status/error/time).
//   • Graceful "simulate" mode when SMTP is not configured (dev) — logs, no crash.
//   • Future-proof: cc/bcc/attachments/multiple recipients already accepted.
//
// ENV VARS
//   SMTP_HOST  SMTP_PORT  SMTP_SECURE(optional)  SMTP_USER  SMTP_PASS  SMTP_FROM
//   EMAIL_ENABLED (optional master switch: 'false' disables real sends)
//   COMPANY_NAME  COMPANY_LOGO_URL  COMPANY_SUPPORT_EMAIL  BRAND_COLOR  APP_URL
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const cds = require('@sap/cds');
const engine = require('./template-engine');

const LOG = cds.log('email');
const EMAIL_LOG = 'ccentrik.employee.timesheet.schema.timesheet.EmailLog';

let _transport = null;         // cached nodemailer transport (or false when disabled)
let _configWarned = false;

// ── Configuration ────────────────────────────────────────────────────────────
function readConfig() {
    return {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || parseInt(process.env.SMTP_PORT || '0', 10) === 465,
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `${process.env.COMPANY_NAME || 'Ccentrik'} <${process.env.SMTP_USER}>` : ''),
        enabled: (process.env.EMAIL_ENABLED || 'true').toLowerCase() !== 'false'
    };
}

// Mask secrets for safe logging: keep 2 leading chars of the local part only.
function maskEmail(v) {
    const s = String(v || '');
    const at = s.indexOf('@');
    if (at < 1) return s ? s.slice(0, 1) + '***' : '';
    return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
}

// Validate config at startup; returns { ok, missing[], summary }. Never throws.
function validateConfig() {
    const c = readConfig();
    const missing = [];
    if (!c.host) missing.push('SMTP_HOST');
    if (!c.user) missing.push('SMTP_USER');
    if (!c.pass) missing.push('SMTP_PASS');
    if (!c.port) missing.push('SMTP_PORT');
    const ok = missing.length === 0 && c.enabled;
    return {
        ok, missing, enabled: c.enabled,
        summary: `host=${c.host || '(unset)'} port=${c.port} secure=${c.secure} user=${maskEmail(c.user)} from=${c.from || '(unset)'} enabled=${c.enabled}`
    };
}

// Log a clear, masked startup banner. Call once from cds.on('served').
function logStartupStatus() {
    const v = validateConfig();
    if (v.ok) LOG.info(`SMTP configured → ${v.summary}`);
    else if (!v.enabled) LOG.warn('Email sending DISABLED (EMAIL_ENABLED=false) — emails will be simulated.');
    else LOG.warn(`SMTP not fully configured (missing: ${v.missing.join(', ')}) — emails will be simulated. Set them in .env / default-env.json.`);
}

// ── Transport (lazy, pooled) ─────────────────────────────────────────────────
function getTransport() {
    if (_transport !== null) return _transport;
    const c = readConfig();
    if (!c.enabled || !c.host || !c.user || !c.pass) {
        if (!_configWarned) { logStartupStatus(); _configWarned = true; }
        _transport = false;                       // simulate mode
        return _transport;
    }
    try {
        const nodemailer = require('nodemailer');
        _transport = nodemailer.createTransport({
            host: c.host, port: c.port, secure: c.secure,
            auth: { user: c.user, pass: c.pass },
            pool: true, maxConnections: 3, maxMessages: 50,
            connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000
        });
    } catch (e) {
        LOG.error('Failed to create SMTP transport:', e.message);
        _transport = false;
    }
    return _transport;
}

// ── Error classification (retry only transient failures) ─────────────────────
// Permanent (do NOT retry): auth failures, bad recipient, malformed message.
// Transient (retry): timeouts, connection resets, greylisting (4xx), DNS blips.
function isRetryable(err) {
    if (!err) return false;
    const code = err.code || '';
    const rc = err.responseCode || 0;
    if (['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(code)) return false;   // permanent
    if (rc >= 500 && rc < 600) return false;                               // hard SMTP reject
    if (['ETIMEDOUT', 'ECONNRESET', 'ESOCKET', 'ECONNECTION', 'EDNS', 'ETLS'].includes(code)) return true;
    if (rc >= 400 && rc < 500) return true;                                // greylist / temp
    return false;                                                          // unknown → don't hammer
}

function friendlyError(err) {
    if (!err) return 'Unknown error';
    switch (err.code) {
        case 'EAUTH': return 'SMTP authentication failed — check SMTP_USER / SMTP_PASS (Gmail needs an App Password).';
        case 'EENVELOPE': return 'Invalid sender/recipient address.';
        case 'ETIMEDOUT': return 'SMTP connection timed out.';
        case 'ECONNREFUSED': return 'SMTP server refused the connection — check SMTP_HOST / SMTP_PORT.';
        case 'ESOCKET': case 'ETLS': return 'SMTP TLS/socket error — check SMTP_SECURE / port.';
        default: return err.message || String(err);
    }
}

// ── EmailLog persistence (best-effort; never breaks the send path) ───────────
async function writeLog(rec) {
    try {
        if (!cds.db) return;
        const { INSERT } = cds.ql;
        await INSERT.into(EMAIL_LOG).entries({
            logId: `EML-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            recipient: String(rec.to || '').slice(0, 255),
            ccList: (rec.cc ? [].concat(rec.cc).join(', ') : null),
            subject: String(rec.subject || '').slice(0, 255),
            template: rec.template || null,
            status: rec.status,
            attempts: rec.attempts || 1,
            errorMessage: rec.error ? String(rec.error).slice(0, 1000) : null,
            refType: rec.refType || null,
            refId: rec.refId || null,
            sentAt: new Date().toISOString()
        });
    } catch (e) { LOG.warn('EmailLog write skipped:', e.message); }
}

// Basic recipient sanity (defence in depth; providers validate too).
function validRecipient(to) {
    const list = [].concat(to || []).filter(Boolean);
    if (!list.length) return false;
    return list.every(a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a).trim()));
}

// ── Core send (with retry) ───────────────────────────────────────────────────
// Returns { status:'Sent'|'Simulated'|'Failed', attempts, error? } and logs.
async function sendEmail(opts) {
    const c = readConfig();
    const to = opts.to, subject = opts.subject || '';
    const template = opts.template || null;
    const meta = { template, refType: opts.refType, refId: opts.refId };

    if (!validRecipient(to)) {
        await writeLog({ ...meta, to, subject, status: 'Failed', error: 'Invalid or missing recipient' });
        LOG.warn(`Email skipped — invalid recipient (${maskEmail([].concat(to)[0])})`);
        return { status: 'Failed', attempts: 0, error: 'Invalid recipient' };
    }

    const mailOptions = {
        from: c.from || 'no-reply@localhost',
        to: [].concat(to).join(', '),
        subject,
        text: opts.text || (opts.html ? engine.toPlainText(opts.html) : ''),
        html: opts.html || undefined,
        cc: opts.cc || undefined,
        bcc: opts.bcc || undefined,
        attachments: opts.attachments || undefined,
        icalEvent: opts.icalEvent || undefined
    };

    const transport = getTransport();
    if (!transport) {                              // simulate mode (no SMTP configured)
        await writeLog({ ...meta, to, subject, status: 'Simulated' });
        LOG.info(`[Email simulated] to=${maskEmail(mailOptions.to)} subject="${subject}"`);
        return { status: 'Simulated', attempts: 0 };
    }

    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await transport.sendMail(mailOptions);
            await writeLog({ ...meta, to, subject, status: 'Sent', attempts: attempt });
            LOG.info(`Email sent to=${maskEmail(mailOptions.to)} subject="${subject}"${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
            return { status: 'Sent', attempts: attempt };
        } catch (err) {
            lastErr = err;
            const retry = isRetryable(err) && attempt < maxAttempts;
            LOG.warn(`Email attempt ${attempt} failed (${err.code || 'ERR'}): ${friendlyError(err)}${retry ? ' — retrying' : ''}`);
            if (!retry) break;
            await new Promise(r => setTimeout(r, 1000 * attempt));   // linear backoff
        }
    }
    await writeLog({ ...meta, to, subject, status: 'Failed', attempts: maxAttempts, error: friendlyError(lastErr) });
    return { status: 'Failed', attempts: maxAttempts, error: friendlyError(lastErr) };
}

// Convenience: HTML email.
function sendHtmlEmail(opts) { return sendEmail({ ...opts, html: opts.html }); }

// Preferred: render a template + send. `data` fills {{placeholders}}.
async function sendTemplateEmail(template, to, data, opts) {
    const html = engine.render(template, data || {});
    return sendEmail({
        to, subject: (opts && opts.subject) || (data && data.Subject) || template,
        html, template,
        cc: opts && opts.cc, bcc: opts && opts.bcc,
        attachments: opts && opts.attachments, icalEvent: opts && opts.icalEvent,
        refType: opts && opts.refType, refId: opts && opts.refId
    });
}

// ── Fire-and-forget wrappers (immediate async — never block the caller) ──────
function sendEmailAsync(opts) { Promise.resolve().then(() => sendEmail(opts)).catch(e => LOG.error('sendEmailAsync:', e.message)); }
function sendTemplateEmailAsync(template, to, data, opts) {
    Promise.resolve().then(() => sendTemplateEmail(template, to, data, opts)).catch(e => LOG.error('sendTemplateEmailAsync:', e.message));
}

// Verify SMTP connectivity (for a health check / "send test" admin action).
async function verifyConnection() {
    const t = getTransport();
    if (!t) return { ok: false, message: 'SMTP not configured (simulate mode).' };
    try { await t.verify(); return { ok: true, message: 'SMTP connection OK.' }; }
    catch (e) { return { ok: false, message: friendlyError(e) }; }
}

// Test seam.
function _reset() { _transport = null; _configWarned = false; }

module.exports = {
    sendEmail, sendHtmlEmail, sendTemplateEmail,
    sendEmailAsync, sendTemplateEmailAsync,
    validateConfig, logStartupStatus, verifyConnection, maskEmail,
    _reset
};
