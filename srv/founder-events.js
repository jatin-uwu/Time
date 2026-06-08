// ── Founder real-time event bus ───────────────────────────────────────────────
// A tiny in-process pub/sub used to push "data changed" pings to the Founder
// Dashboard over SSE. The ping carries NO business data — it only tells the
// client to re-fetch analytics through the authenticated /founder action — so
// the SSE channel itself needs no auth and can never leak data.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

let lastChange = 0;

// Coalesce bursts of writes into at most one ping every 400ms.
let timer = null;
function ping(reason) {
    lastChange = Date.now();
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        try { bus.emit('changed', { at: lastChange, reason: reason || '' }); } catch (e) { /* ignore */ }
    }, 400);
}

module.exports = { bus, ping, getLastChange: () => lastChange };
