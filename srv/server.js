// Load .env (SMTP + email branding config) into process.env BEFORE anything else,
// since CAP does not auto-load .env. Safe if the file/dep is absent (falls back to
// real environment variables, e.g. on BTP where they're set as service vars).
try { require('dotenv').config(); } catch (e) { /* dotenv optional — env may come from the OS/BTP */ }

const cds = require('@sap/cds');
const express = require('express');
const founderEvents = require('./founder-events');
const realtime = require('./realtime');   // NEW — app-wide WebSocket real-time

// Raise the request body size limit so base64 attachments (chat files,
// documents — up to ~13 MB for a 10 MB file) aren't rejected with HTTP 413
// "request entity too large". Registered in bootstrap so it runs before the
// protocol adapters' parsers; once it has parsed the body, theirs skip it.
cds.on('bootstrap', (app) => {
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    // ── Founder Dashboard real-time stream (Server-Sent Events) ───────────
    // Pushes content-free "ping" messages whenever org data changes, so the
    // dashboard re-fetches analytics instantly without manual refresh. Carries
    // no business data, so it needs no auth.
    app.get('/founder-stream', (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders && res.flushHeaders();
        res.write('retry: 5000\n\n');
        res.write('event: ping\ndata: {"reason":"connected"}\n\n');

        const onChange = (payload) => {
            try { res.write('event: ping\ndata: ' + JSON.stringify(payload || {}) + '\n\n'); } catch (e) { /* ignore */ }
        };
        founderEvents.bus.on('changed', onChange);

        // Heartbeat so proxies/load-balancers keep the connection open.
        const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) { /* ignore */ } }, 25000);

        req.on('close', () => {
            clearInterval(hb);
            founderEvents.bus.removeListener('changed', onChange);
        });
    });
});

// ── App-wide WebSocket real-time (NEW, additive) ──────────────────────────────
// Attach the WebSocket server to the CAP HTTP server once it is listening. This
// is fully isolated from the Founder SSE above and from every OData service. If
// the `ws` package or the upgrade fails, attach() logs and returns null — the
// CAP app still boots and serves all existing functionality unchanged.
cds.on('listening', ({ server }) => {
    try { realtime.attach(server); }
    catch (e) { cds.log('realtime').warn('WebSocket attach failed (real-time disabled):', e.message || e); }
});

module.exports = cds.server;
