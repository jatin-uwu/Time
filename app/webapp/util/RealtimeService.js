// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/webapp/util/RealtimeService.js   (NEW — additive, non-breaking)
// ─────────────────────────────────────────────────────────────────────────────
// Reusable, app-wide WebSocket client for real-time refresh signals.
//
// Contract:
//  • ONE-WAY: server → client. The server only sends content-free signals
//    ({type, entity, category, timestamp}); the client re-fetches data through
//    the normal authenticated OData/action APIs. No business data crosses the WS.
//  • NON-BLOCKING: if the browser has no WebSocket, the server is down, or the
//    connection drops, the UI keeps working exactly as before. Failures only
//    schedule a reconnect; they never throw into application code.
//  • Controllers DON'T talk to the socket directly. They subscribe to the SAPUI5
//    core EventBus on channel "rt"; this service publishes the typed event there
//    (and a catch-all "ANY"). That keeps the transport swappable (e.g. back to
//    SSE) without touching a single controller.
//
// Usage (see Component.js + controller examples):
//    RealtimeService.init();                       // once, at app startup
//    sap.ui.getCore().getEventBus().subscribe("rt", "TASK_UPDATED", fn, this);
//    sap.ui.getCore().getEventBus().subscribe("rt", "ANY", fn, this);  // any event
// ─────────────────────────────────────────────────────────────────────────────
sap.ui.define([], function () {
    "use strict";

    var _ws = null;
    var _stopped = false;
    var _retry = 0;
    var _timer = null;
    var CHANNEL = "rt";

    function _bus() { return sap.ui.getCore().getEventBus(); }

    function _url() {
        var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return proto + "//" + window.location.host + "/ws";
    }

    function _scheduleReconnect() {
        if (_stopped) return;
        _retry = Math.min(_retry + 1, 6);                 // cap the exponent
        var delay = Math.min(30000, 1000 * Math.pow(2, _retry)); // 2s … 30s backoff
        clearTimeout(_timer);
        _timer = setTimeout(_connect, delay);
    }

    function _connect() {
        if (_stopped) return;
        if (typeof window.WebSocket === "undefined") return;  // ancient browser → no-op

        var ws;
        try { ws = new WebSocket(_url()); }
        catch (e) { _scheduleReconnect(); return; }
        _ws = ws;

        ws.onopen = function () { _retry = 0; };

        ws.onmessage = function (evt) {
            var data;
            try { data = JSON.parse(evt.data); } catch (e) { return; }
            if (!data || !data.type || data.type === "CONNECTED") return;
            // Fan out on the global event bus. Controllers subscribe by type
            // (e.g. "TASK_UPDATED") or to the catch-all "ANY".
            try {
                _bus().publish(CHANNEL, data.type, data);
                _bus().publish(CHANNEL, "ANY", data);
            } catch (e) { /* never let a subscriber error break the socket */ }
        };

        // A dropped/refused connection just reconnects with backoff.
        ws.onclose = function () { _scheduleReconnect(); };
        ws.onerror = function () { try { ws.close(); } catch (e) { /* */ } };
    }

    return {
        // Start (or restart) the connection. Safe to call once at startup.
        init: function () {
            _stopped = false;
            _retry = 0;
            _connect();
        },
        // Permanently stop (e.g. on logout). No further reconnects.
        stop: function () {
            _stopped = true;
            clearTimeout(_timer);
            try { if (_ws) { _ws.onclose = null; _ws.close(); } } catch (e) { /* */ }
            _ws = null;
        },
        isConnected: function () {
            return !!_ws && _ws.readyState === 1 /* OPEN */;
        },
        // Channel name controllers subscribe on (exported for convenience).
        CHANNEL: CHANNEL
    };
});
