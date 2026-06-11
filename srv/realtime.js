// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/realtime.js   (NEW — additive, non-breaking)
// ─────────────────────────────────────────────────────────────────────────────
// Centralised WebSocket service for app-wide real-time refresh signals.
//
// Design notes (important):
//  • This module is PURELY ADDITIVE. It does not touch any OData service, CAP
//    handler, routing, auth, or DB logic. The Founder dashboard keeps its own
//    Server-Sent-Events stream (srv/server.js → /founder-stream) untouched.
//  • Triggering is done by SUBSCRIBING to the existing in-process mutation bus
//    (srv/founder-events.js → bus 'changed'). That bus already fires after every
//    mutating transaction (leave/timesheet/task/rating/notification) via the
//    `emitFounderPing` after('*') hooks already present on the services. So we
//    add zero new event hooks and change zero business logic.
//  • Payloads carry NO business data — only a type/entity/category so the client
//    knows WHICH models to re-fetch through the normal authenticated OData APIs.
//  • Connection management: a heartbeat ping/pong reaps dead sockets so we never
//    leak connections with many concurrent users.
//
// Rollback: delete the `cds.on('listening', …)` block in srv/server.js (or set
// env DISABLE_REALTIME=true). The WS server simply never starts; everything else
// — including the Founder SSE — keeps working exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const cds = require('@sap/cds');
const founderEvents = require('./founder-events');

const log = cds.log('realtime');
let wss = null;          // the single WebSocketServer instance
let heartbeat = null;    // dead-connection reaper

// Map a CAP event name (the mutation bus "reason") → a UI-facing typed event.
// Anything not listed falls back to a generic DATA_CHANGED so the client can
// still do a light refresh. `category` is what the frontend routes on.
const TYPE_MAP = {
    // ── Leave ──
    applyLeave:              { type: 'LEAVE_CREATED',       entity: 'LeaveRequest',     category: 'leave' },
    approveLeave:            { type: 'LEAVE_UPDATED',       entity: 'LeaveRequest',     category: 'leave' },
    // ── Timesheet ──
    saveTimesheetEntries:    { type: 'TIMESHEET_SAVED',     entity: 'TimesheetHeader',  category: 'timesheet' },
    submitTimesheetWeek:     { type: 'TIMESHEET_SUBMITTED', entity: 'TimesheetHeader',  category: 'timesheet' },
    approveTimesheet:        { type: 'TIMESHEET_APPROVED',  entity: 'TimesheetHeader',  category: 'timesheet' },
    rejectTimesheet:         { type: 'TIMESHEET_REJECTED',  entity: 'TimesheetHeader',  category: 'timesheet' },
    approvePrevWeekRequest:  { type: 'TIMESHEET_UPDATED',   entity: 'TimesheetHeader',  category: 'timesheet' },
    approveDayUnlock:        { type: 'TIMESHEET_UPDATED',   entity: 'TimesheetHeader',  category: 'timesheet' },
    requestDayUnlock:        { type: 'TIMESHEET_UPDATED',   entity: 'TimesheetHeader',  category: 'timesheet' },
    requestPrevWeekFill:     { type: 'TIMESHEET_UPDATED',   entity: 'TimesheetHeader',  category: 'timesheet' },
    // ── Performance ratings ──
    submitPerformanceRating: { type: 'RATING_SUBMITTED',    entity: 'PerformanceRating', category: 'rating' },
    // ── Tasks ──
    createGroupTask:         { type: 'TASK_ASSIGNED',       entity: 'TaskMaster',       category: 'task' },
    notifyTaskAssignment:    { type: 'TASK_ASSIGNED',       entity: 'TaskMaster',       category: 'task' },
    updateTaskStatus:        { type: 'TASK_UPDATED',        entity: 'TaskMaster',       category: 'task' },
    postTaskUpdate:          { type: 'TASK_UPDATED',        entity: 'TaskUpdate',       category: 'task' },
    postGroupTaskUpdate:     { type: 'TASK_UPDATED',        entity: 'TaskUpdate',       category: 'task' },
    uploadTaskDocument:      { type: 'TASK_UPDATED',        entity: 'TaskDocument',     category: 'task' },
    reportIssue:             { type: 'TASK_UPDATED',        entity: 'TaskMaster',       category: 'task' },
    submitReview:            { type: 'TASK_UPDATED',        entity: 'TaskReview',       category: 'task' },
    // ── Attendance ──
    markAttendance:          { type: 'ATTENDANCE_MARKED',   entity: 'AttendanceRecord', category: 'attendance' }
};

function toEvent(reason) {
    const r = String(reason || '');
    const m = TYPE_MAP[r] || null;
    return {
        type:      m ? m.type     : 'DATA_CHANGED',
        entity:    m ? m.entity   : '',
        category:  m ? m.category : 'data',
        reason:    r,                         // raw CAP event name (debug aid)
        timestamp: new Date().toISOString()
    };
}

// Reusable broadcast — fan a content-free signal out to every open client.
function broadcast(payload) {
    if (!wss) return;
    let msg;
    try { msg = JSON.stringify(payload); } catch (e) { return; }
    wss.clients.forEach((client) => {
        if (client.readyState === 1 /* OPEN */) {
            try { client.send(msg); } catch (e) { /* drop on a bad socket */ }
        }
    });
}

// Attach the WebSocket server to the running CAP HTTP server. Idempotent.
// Lazy-requires `ws` so a missing dependency can never crash the CAP boot —
// real-time simply stays disabled and the rest of the app runs normally.
function attach(server) {
    if (wss) return wss;
    if (String(process.env.DISABLE_REALTIME).toLowerCase() === 'true') {
        log.info('Real-time disabled via DISABLE_REALTIME=true');
        return null;
    }

    let WebSocketServer;
    try {
        ({ WebSocketServer } = require('ws'));
    } catch (e) {
        log.warn('`ws` package not available — real-time WebSocket disabled (run `npm install ws`).');
        return null;
    }

    // path:'/ws' → only upgrade requests to /ws are handled; all existing HTTP
    // routes (OData, /founder-stream, static) are completely unaffected.
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('error', () => { /* swallow — onclose handles cleanup */ });
        try { ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })); } catch (e) { /* */ }
    });

    // Heartbeat — reap sockets that stopped responding (closed laptops, dropped
    // proxies) so connection memory never grows unbounded under many users.
    heartbeat = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) { try { ws.terminate(); } catch (e) { /* */ } return; }
            ws.isAlive = false;
            try { ws.ping(); } catch (e) { /* */ }
        });
    }, 30000);
    if (heartbeat.unref) heartbeat.unref();
    wss.on('close', () => clearInterval(heartbeat));

    // ── The bridge ── subscribe to the EXISTING mutation bus and rebroadcast as
    // a typed WS signal. This is an additional listener on the same EventEmitter
    // that already drives the Founder SSE — the SSE listener is untouched.
    founderEvents.bus.on('changed', (p) => {
        try { broadcast(toEvent(p && p.reason)); }
        catch (e) { log.warn('broadcast failed:', e.message || e); }
    });

    log.info('WebSocket real-time server attached at /ws');
    return wss;
}

module.exports = { attach, broadcast };
