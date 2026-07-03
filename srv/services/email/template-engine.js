// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/services/email/template-engine.js
// Reusable HTML template engine for the Email module.
//
//  • Loads a named template from ./templates/<name>.html and wraps it in the
//    shared responsive _layout.html (logo / company name / footer).
//  • Substitutes {{Placeholder}} tokens from a plain data object.
//  • Branding (company name, logo, colour, support email) comes from ENV — never
//    hardcoded — so the same templates re-brand per deployment with no code change.
//  • Values are HTML-escaped by default to prevent injection; use {{{raw}}} for
//    pre-formatted HTML fragments you explicitly trust.
//
// Design notes: templates are cached in memory after first read (fast, and the
// set is fixed at deploy time). Unknown {{tokens}} resolve to '' so half-rendered
// braces never reach a recipient.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const _cache = {};

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Read + cache a raw template file. Returns '' if it does not exist (caller decides).
function readTemplate(name) {
    if (_cache[name] !== undefined) return _cache[name];
    const file = path.join(TEMPLATE_DIR, `${name}.html`);
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch (e) { content = ''; }
    _cache[name] = content;
    return content;
}

// Replace {{{raw}}} (unescaped) then {{escaped}} tokens. Missing → ''.
function substitute(tpl, data) {
    const d = data || {};
    return String(tpl)
        .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, k) => (d[k] != null ? String(d[k]) : ''))
        .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (d[k] != null ? escapeHtml(d[k]) : ''));
}

// Branding block resolved from ENV, applied to every email via the layout.
function brand() {
    return {
        CompanyName: process.env.COMPANY_NAME || 'Ccentrik',
        CompanyLogoUrl: process.env.COMPANY_LOGO_URL || '',
        SupportEmail: process.env.COMPANY_SUPPORT_EMAIL || process.env.SMTP_FROM || '',
        BrandColor: process.env.BRAND_COLOR || '#4338ca',
        AppUrl: process.env.APP_URL || '',
        Year: String(new Date().getFullYear())
    };
}

// Render a full HTML email: inner template → wrapped in _layout.
//   name  : template file name (without .html), e.g. 'task-assigned'
//   data  : placeholder values (EmployeeName, TaskName, …)
// Falls back to the 'generic' template when `name` is unknown.
function render(name, data) {
    let inner = readTemplate(name);
    if (!inner) inner = readTemplate('generic');
    const b = brand();
    const merged = Object.assign({}, b, data || {});
    // Optional logo <img> only when a URL is configured (avoids broken images).
    merged.LogoBlock = b.CompanyLogoUrl
        ? `<img src="${escapeHtml(b.CompanyLogoUrl)}" alt="${escapeHtml(b.CompanyName)}" height="40" style="height:40px;display:block;border:0;" />`
        : `<span style="font-size:20px;font-weight:800;color:#ffffff;">${escapeHtml(b.CompanyName)}</span>`;
    const body = substitute(inner, merged);
    const layout = readTemplate('_layout');
    if (!layout) return body;                       // no layout → send inner alone
    return substitute(layout, Object.assign({}, merged, { BODY: body }));
}

// Render only the plain-text fallback (strip tags) for multipart emails / clients
// that block HTML. Cheap heuristic — good enough for notification content.
function toPlainText(html) {
    return String(html)
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

// Test seam — clear the in-memory cache (used by unit tests / hot reload).
function _clearCache() { for (const k of Object.keys(_cache)) delete _cache[k]; }

module.exports = { render, substitute, escapeHtml, toPlainText, brand, _clearCache };
