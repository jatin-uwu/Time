const cds = require('@sap/cds');
const founderEvents = require('./founder-events');

// Mutating events that should ping the Founder Dashboard to re-fetch (covers the
// CRUD verbs plus the named actions that change org data). Read-only actions are
// intentionally excluded so a dashboard refresh never triggers another refresh.
const FOUNDER_MUTATING_EVENTS = new Set([
    'CREATE', 'UPDATE', 'DELETE',
    'saveTimesheetEntries', 'submitTimesheetWeek', 'updateTaskStatus', 'applyLeave', 'approveLeave',
    'submitPerformanceRating', 'addEmployee', 'setEmployeeStatus', 'updateEmployee', 'createGroupTask',
    'postGroupTaskUpdate', 'postTaskUpdate', 'approveTimesheet', 'rejectTimesheet', 'approvePrevWeekRequest',
    'approveDayUnlock', 'requestDayUnlock', 'requestPrevWeekFill', 'reportIssue', 'submitReview',
    'markAttendance', 'uploadTaskDocument'
]);
function emitFounderPing(data, req) {
    try { if (req && FOUNDER_MUTATING_EVENTS.has(req.event)) founderEvents.ping(req.event); } catch (e) { /* never break the request */ }
}

// ── Thought for the Day ─────────────────────────────────────────────────────
// A fresh daily motivational quote from ZenQuotes (free, no API key), cached in
// the database so every employee and every app instance sees the SAME quote for
// the day and the external API is hit only ONCE per day for the whole system.
//
// Flow (lazy, on first request of the day):
//   1. In-memory short-circuit (per instance) to skip the DB read on repeat loads.
//   2. Read today's row from ThoughtOfTheDay → if present, serve it.
//   3. Not present → fetch from ZenQuotes, DELETE the previous day's row, UPSERT
//      today's row (so the table only ever holds the current day), serve it.
//   4. External API down → serve whatever row exists (last good), else a static
//      fallback. The dashboard therefore never breaks on an outage.
const THOUGHT_TABLE = 'ccentrik.employee.timesheet.schema.timesheet.ThoughtOfTheDay';
const THOUGHT_FALLBACKS = [
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
    { quote: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
    { quote: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
    { quote: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
    { quote: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
    { quote: 'Well done is better than well said.', author: 'Benjamin Franklin' }
];
let _thoughtMem = { date: null, quote: null, author: null };

function _todayKey() { return new Date().toISOString().slice(0, 10); }
function _dayHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function _fetchExternalQuote() {
    if (typeof fetch !== 'function') return null;
    try {
        const res = await fetch('https://zenquotes.io/api/today', { method: 'GET' });
        if (res.ok) {
            const arr = await res.json();
            const q = Array.isArray(arr) ? arr[0] : null;
            if (q && q.q) return { quote: String(q.q).trim(), author: q.a ? String(q.a).trim() : 'Unknown' };
        }
    } catch (e) {
        cds.log('thought').warn('ZenQuotes fetch failed:', e.message || e);
    }
    return null;
}

async function loadThoughtOfTheDay() {
    const today = _todayKey();

    // 1. Per-instance in-memory short-circuit.
    if (_thoughtMem.date === today && _thoughtMem.quote) {
        return { date: today, quote: _thoughtMem.quote, author: _thoughtMem.author || '' };
    }

    // 2. Today's quote already cached in the DB (stored by whichever request/instance
    //    was first today) → serve it; no external call.
    let row = await SELECT.one.from(THOUGHT_TABLE).where({ quoteDate: today });
    if (row && row.quote) {
        _thoughtMem = { date: today, quote: row.quote, author: row.author };
        return { date: today, quote: row.quote, author: row.author || '' };
    }

    // 3. First request of the day → fetch fresh, keep only today's row.
    const fresh = await _fetchExternalQuote();
    if (fresh) {
        try {
            await DELETE.from(THOUGHT_TABLE).where('quoteDate <>', today);   // drop yesterday's
            await UPSERT.into(THOUGHT_TABLE).entries({ quoteDate: today, quote: fresh.quote, author: fresh.author });
        } catch (e) {
            cds.log('thought').warn('store thought failed:', e.message || e);   // serving still works
        }
        _thoughtMem = { date: today, quote: fresh.quote, author: fresh.author };
        return { date: today, quote: fresh.quote, author: fresh.author };
    }

    // 4. External API unavailable → last good row if any, else a static fallback.
    row = await SELECT.one.from(THOUGHT_TABLE);
    if (row && row.quote) return { date: today, quote: row.quote, author: row.author || '' };
    const f = THOUGHT_FALLBACKS[Math.abs(_dayHash(today)) % THOUGHT_FALLBACKS.length];
    return { date: today, quote: f.quote, author: f.author };
}

const HEADER = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';
const EMPLOYEE = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeMaster';
const LEAVE_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.LeaveRequest';
const TASK = 'ccentrik.employee.timesheet.schema.timesheet.TaskMaster';
const PERFORMANCE_RATING = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
const NOTIFICATION = 'ccentrik.employee.timesheet.schema.timesheet.Notification';
const ATTENDANCE = 'ccentrik.employee.timesheet.schema.timesheet.AttendanceRecord';
const TASK_REVIEW = 'ccentrik.employee.timesheet.schema.timesheet.TaskReview';
const HOLIDAY = 'ccentrik.employee.timesheet.schema.timesheet.HolidayMaster';
const TASK_ASSIGNEE = 'ccentrik.employee.timesheet.schema.timesheet.TaskAssignee';
const TASK_MESSAGE = 'ccentrik.employee.timesheet.schema.timesheet.TaskMessage';
const TASK_ATTACHMENT = 'ccentrik.employee.timesheet.schema.timesheet.TaskAttachment';
const TASK_UPDATE = 'ccentrik.employee.timesheet.schema.timesheet.TaskUpdate';
const TASK_DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.TaskDocument';
const PREV_WEEK_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetPrevWeekRequest';
const DAY_UNLOCK_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetDayUnlockRequest';


const PRIORITY_PREFIX = {
    'High': '[HIGH PRIORITY]',
    'Medium': '[Medium Priority]',
    'Low': '[Low Priority]'
};

const {
    registerTimesheetHandlers,
    registerManagerTimesheetHandlers,
    registerHRTimesheetHandlers
} = require('./timesheet-handler');

const { startReminderCron } = require('./reminder-cron');

let _mailer = null;
function getMailer() {
    if (_mailer !== null) return _mailer;
    try {
        const nodemailer = require('nodemailer');
        const host = process.env.SMTP_HOST;
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!host || !user || !pass) { _mailer = false; return _mailer; }
        _mailer = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    } catch (e) { _mailer = false; }
    return _mailer;
}

async function createNotification(employeeId, type, title, message, referenceId) {
    try {
        const notificationId = `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        await INSERT.into(NOTIFICATION).entries({
            notificationId,
            employee_employeeId: employeeId,
            type, title, message,
            isRead: false,
            referenceId: referenceId || '',
            notifiedAt: new Date()
        });
    } catch (e) {
        cds.log('notif').warn('Could not create notification:', e.message || e);
    }
}

// ── Group-task shared helpers ────────────────────────────────────────────────

// Resolve the caller's EmployeeMaster row (by JWT email). Returns null if none.
async function resolveCaller(req) {
    const user = req.user || {};
    const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
    const uid = user.id || '';
    let emp = null;
    if (email) emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where('lower(email) =', email);
    return { email, uid, emp, employeeId: emp && emp.employeeId };
}

// ── Founder access-control helper ────────────────────────────────────────────
// A Founder may only view / manage employees who report DIRECTLY to them, i.e.
// EmployeeMaster.manager_employeeId === <the founder's own employeeId>. This is
// the single source of truth reused by every founder employee-selection action
// (assign task, submit rating, any future picker) so the same rule is enforced
// at the data layer — never relying on the UI to hide rows.
//
// Returns { founderId, ids:Set<employeeId>, employees:[…] }. ids is empty when
// the founder has no direct reports.
async function founderDirectReports(req) {
    const caller = await resolveCaller(req);
    const founderId = caller.employeeId || null;
    if (!founderId) return { founderId: null, ids: new Set(), employees: [] };
    const rows = await SELECT.from(EMPLOYEE)
        .columns('employeeId', 'employeeName', 'department', 'designation')
        .where({ manager_employeeId: founderId, isActive: true })
        .orderBy('employeeName');
    return {
        founderId,
        ids: new Set((rows || []).map(r => r.employeeId)),
        employees: rows || []
    };
}

// Load a group task plus its assignee rows and decide whether the caller is a
// member (an assignee OR the manager who created it). Solo tasks return null.
async function loadGroupContext(taskId, caller) {
    const task = await SELECT.one.from(TASK).where({ taskId });
    if (!task || task.taskType !== 'group') return { task: null };
    const rows = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: taskId });
    const mine = rows.find(r => r.assignee_employeeId === caller.employeeId) || null;
    const isCreator = !!(task.createdBy && (task.createdBy === caller.email || task.createdBy === caller.uid));
    return { task, rows, mine, isCreator, isMember: !!mine || isCreator };
}

// All recipients of a group task (every assignee + the creator), as employeeIds.
async function groupRecipientIds(task, rows) {
    const ids = new Set(rows.map(r => r.assignee_employeeId).filter(Boolean));
    if (task.createdBy) {
        const creator = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email: task.createdBy });
        if (creator && creator.employeeId) ids.add(creator.employeeId);
    }
    return ids;
}

// Coalesced chat notification: one unread row per (recipient, task). While it
// stays unread, new messages bump a counter instead of creating new rows.
async function notifyGroupChat(taskId, taskName, senderId, recipientIds) {
    for (const rid of recipientIds) {
        if (!rid || rid === senderId) continue;
        try {
            const existing = await SELECT.one.from(NOTIFICATION).where({
                employee_employeeId: rid, referenceId: taskId,
                type: 'GROUP_CHAT_MESSAGE', isRead: false
            });
            if (existing) {
                const c = (existing.msgCount || 1) + 1;
                await UPDATE(NOTIFICATION).set({
                    msgCount: c,
                    message: `${c} new messages in group task chat “${taskName}”`,
                    notifiedAt: new Date()
                }).where({ notificationId: existing.notificationId });
            } else {
                await INSERT.into(NOTIFICATION).entries({
                    notificationId: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
                    employee_employeeId: rid,
                    type: 'GROUP_CHAT_MESSAGE',
                    title: 'New chat message',
                    message: `1 new message in group task chat “${taskName}”`,
                    isRead: false,
                    referenceId: taskId,
                    notifiedAt: new Date(),
                    msgCount: 1
                });
            }
        } catch (e) { cds.log('notif').warn('chat notify failed:', e.message || e); }
    }
}

// Mark the caller's coalesced chat notification for a task as read (resets it).
async function markChatRead(taskId, employeeId) {
    if (!employeeId) return;
    try {
        await UPDATE(NOTIFICATION)
            .set({ isRead: true })
            .where({ employee_employeeId: employeeId, referenceId: taskId, type: 'GROUP_CHAT_MESSAGE', isRead: false });
    } catch (e) { /* best-effort */ }
}

// Read a LargeBinary column into a base64 string (handles Buffer / stream).
async function binaryToBase64(content) {
    if (!content) return '';
    if (Buffer.isBuffer(content)) return content.toString('base64');
    if (content instanceof Uint8Array) return Buffer.from(content).toString('base64');
    if (typeof content === 'string') return content;
    if (typeof content.pipe === 'function') {
        const chunks = [];
        for await (const chunk of content) chunks.push(chunk);
        return Buffer.concat(chunks).toString('base64');
    }
    return Buffer.from(content).toString('base64');
}

// Next free TASKnnn id (group tasks share the TaskMaster id space with solo).
async function nextGroupTaskId() {
    const rows = await SELECT.from(TASK).columns('taskId');
    let max = 0;
    rows.forEach(r => { const m = /^TASK(\d+)$/i.exec(r.taskId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'TASK' + String(max + 1).padStart(3, '0');
}

// An employee's group tasks, each surfaced with THAT employee's own progress as
// the status (pending→Not Started, in_progress→In Progress, ended→Completed) so
// dashboard counters (My Tasks / Task Summary) reflect their personal view.
async function myGroupTasks(employeeId) {
    if (!employeeId) return [];
    const rows = await SELECT.from(TASK_ASSIGNEE).where({ assignee_employeeId: employeeId });
    if (!rows.length) return [];
    const byTask = {}; rows.forEach(r => { byTask[r.task_taskId] = r; });
    const ids = Object.keys(byTask);
    const tasks = await SELECT.from(TASK).where({ taskId: { in: ids }, taskType: 'group' });
    const map = { pending: 'Not Started', in_progress: 'In Progress', ended: 'Completed' };
    return (tasks || []).map(t => Object.assign({}, t, {
        status: map[(byTask[t.taskId] || {}).status] || 'Not Started'
    }));
}

// Can the caller see a task's documents/updates? True for the assignee, the
// reviewer, any group member, or a manager. Used to gate task-document and
// update-attachment downloads (works for both solo and group tasks).
async function canAccessTask(req, taskId) {
    const caller = await resolveCaller(req);
    if (!caller.employeeId || !taskId) return { ok: false, caller, task: null };
    const task = await SELECT.one.from(TASK)
        .columns('taskId', 'taskType', 'status', 'assignedTo_employeeId', 'reviewer_employeeId')
        .where({ taskId });
    if (!task) return { ok: false, caller, task: null };
    const isManager = !!(req.user && req.user.is && req.user.is('Manager'));
    if (isManager) return { ok: true, caller, task };
    if (task.assignedTo_employeeId === caller.employeeId) return { ok: true, caller, task };
    if (task.reviewer_employeeId === caller.employeeId) return { ok: true, caller, task };
    if (task.taskType === 'group') {
        const ctx = await loadGroupContext(taskId, caller);
        if (ctx.isMember) return { ok: true, caller, task };
    }
    return { ok: false, caller, task };
}

// Maps a notification type to the sidebar menu route whose badge it should
// drive. DAY_UNLOCK_REQUEST is role-dependent (HR vs the reporting manager).
// Returns null for types with no dedicated badge — including group-task types,
// which already have their own "Group Tasks" counter.
function routeForNotif(type, isHR) {
    switch (type) {
        case 'GROUP_CHAT_MESSAGE':
        case 'GROUP_TASK_ASSIGNED':
        case 'GROUP_TASK_UPDATE':
        case 'GROUP_TASK_COMPLETED':   return 'group-tasks';
        case 'TASK_ASSIGNED':
        case 'TASK_REVIEW_REQUESTED':  return 'task-description';
        case 'TIMESHEET_SUBMITTED':
        case 'PREVWEEK_REQUEST':
        case 'LEAVE_REQUEST':          return 'manager';
        case 'DAY_UNLOCK_REQUEST':     return isHR ? 'hr-approvals' : 'manager';
        case 'TIMESHEET_APPROVED':
        case 'TIMESHEET_REJECTED':     return 'history';
        case 'PREVWEEK_APPROVED':
        case 'PREVWEEK_REJECTED':
        case 'DAY_UNLOCK_APPROVED':
        case 'DAY_UNLOCK_REJECTED':    return 'timesheet';
        case 'LEAVE_APPROVED':
        case 'LEAVE_REJECTED':         return 'leave-history';
        case 'PERFORMANCE_RATED':      return 'rating-history';
        default:                       return null;
    }
}

// Block any request from a deactivated account. getCurrentUser is allowed
// through so the UI can resolve identity, detect inactivity, and show the
// "account is inactive" message; every other operation is denied server-side.
async function blockIfInactive(req) {
    if (req.event === 'getCurrentUser') return;
    const user = req.user || {};
    const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
    if (!email) return;
    const emp = await SELECT.one.from(EMPLOYEE).columns('isActive').where('lower(email) =', email);
    if (!emp) {
        return req.reject(403, 'Access denied: your email is not registered in Employee Master.');
    }
    if (emp.isActive === false) {
        return req.reject(403, 'Your account is inactive. Please contact the administrator.');
    }
}

// Resolve the caller's email from the JWT (email/mail attribute, falling back to
// the technical user id). Centralised so every guard resolves identity the same
// way.
function callerEmail(user) {
    user = user || {};
    return (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
}

// Does the JWT carry the XSUAA scope that corresponds to this application role?
function hasScopeFor(user, role) {
    if (!user || !user.is) return false;
    switch (role) {
        case 'founder':  return user.is('Founder');
        case 'hr':       return user.is('HR');
        case 'manager':  return user.is('Manager');
        case 'employee': return user.is('Employee');
        default:         return false;
    }
}

// ── Two-factor authorization guard ──────────────────────────────────────────
// Returns a before-handler that grants access ONLY when BOTH are true:
//   (1) the JWT/XSUAA scope for `requiredRole` is present, AND
//   (2) the caller's authoritative role in EmployeeMaster.role === requiredRole.
// This closes the privilege-escalation gap where assigning an extra XSUAA role
// collection (e.g. Manager) to a user whose master role is HR would otherwise
// grant Manager access. The master table is the source of truth; XSUAA is a
// necessary-but-not-sufficient first factor.
// The caller's EFFECTIVE role = the authoritative EmployeeMaster.role, but only
// when the JWT also carries the matching XSUAA scope. A user whose master role
// is elevated but who lacks the scope (or vice-versa) is downgraded to the base
// 'employee' role when they at least hold the Employee scope, else 'unknown'.
// Used to drive UI routing so the frontend never sends a user to a dashboard the
// backend will deny.
function effectiveRole(user, emp) {
    const dbRole = (emp && emp.role || '').trim().toLowerCase();
    if (dbRole && hasScopeFor(user, dbRole)) return dbRole;
    if (user && user.is && user.is('Employee')) return 'employee';
    return 'unknown';
}

// The canonical application roles stored in EmployeeMaster.role. Authorization
// compares against these exact lowercase values, so anything written to the
// column must be normalised to one of them — 'HR' vs 'hr' must never diverge.
const VALID_ROLES = ['employee', 'manager', 'hr', 'founder'];
function normalizeRole(value) {
    const r = (value == null ? '' : String(value)).trim().toLowerCase();
    return VALID_ROLES.includes(r) ? r : null;
}

function requireMatchingRole(requiredRole) {
    return async function (req) {
        const user = req.user || {};
        const email = callerEmail(user);
        if (!email) return req.reject(403, 'Access denied: unable to resolve your identity.');

        const emp = await SELECT.one.from(EMPLOYEE).columns('role', 'isActive').where('lower(email) =', email);
        if (!emp) return req.reject(403, 'Access denied: no employee record is linked to your account.');
        if (emp.isActive === false) return req.reject(403, 'Your account is inactive. Please contact the administrator.');

        const dbRole = (emp.role || '').trim().toLowerCase();

        // Factor 1 — XSUAA scope (also enforced by @requires, re-checked defensively).
        if (!hasScopeFor(user, requiredRole)) {
            return req.reject(403, 'Access denied: missing the required authorization scope.');
        }
        // Factor 2 — authoritative role from EmployeeMaster must match exactly.
        if (dbRole !== requiredRole) {
            cds.log('auth').warn(
                `Blocked role mismatch for ${email}: JWT carries '${requiredRole}' scope but EmployeeMaster.role='${dbRole || 'none'}'.`
            );
            return req.reject(403, 'Access denied: your assigned role does not permit this operation.');
        }
    };
}

class EmployeeService extends cds.ApplicationService {
    async init() {

        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        this.on('getUserRole', async (req) => {
            const user = req.user || {};
            const email = callerEmail(user);
            const emp = email
                ? await SELECT.one.from(EMPLOYEE).columns('role').where('lower(email) =', email)
                : null;
            // Effective role cross-checks the master table against the JWT scope,
            // so an XSUAA-only role assignment can no longer report elevated access.
            return { role: effectiveRole(user, emp) };
        });

        this.on('getCurrentUser', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();

            let emp = null;
            if (email) {
                emp = await SELECT.one.from(EMPLOYEE).where('lower(email) =', email);
            }

            // ── Login gate ────────────────────────────────────────────────────
            // A user may sign in only when ALL of the following hold:
            //   (1) the email exists in EmployeeMaster,
            //   (2) the account is active, and
            //   (3) the master role is backed by the matching XSUAA/JWT scope.
            // Otherwise we return accessDenied + a reason so the UI can show an
            // error and sign the user out. (getCurrentUser itself stays reachable
            // so the UI can render that message; every other service is blocked
            // server-side by blockIfInactive / requireMatchingRole.)
            const dbRole = (emp && emp.role || '').trim().toLowerCase();
            let accessDenied = null;
            if (!emp)                          accessDenied = 'not-registered';
            else if (emp.isActive === false)   accessDenied = 'inactive';
            else if (!hasScopeFor(user, dbRole)) accessDenied = 'role-mismatch';

            // Only report an elevated role when the login is valid; otherwise
            // 'unknown' so nothing in the UI treats the session as privileged.
            const role = accessDenied ? 'unknown' : dbRole;

            if (!emp) {
                return {
                    email, role, accessDenied, employeeId: '',
                    employeeName: (user.attr && user.attr.given_name) || (email && email.split('@')[0]) || 'User',
                    designation: '', address: '', mobileNumber: '', managerId: '', isActive: true
                };
            }

            return {
                email: emp.email || email, role, accessDenied,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName || '',
                designation: emp.designation || '',
                address: emp.address || '',
                mobileNumber: emp.mobileNumber || '',
                managerId: emp.manager_employeeId || '',
                isActive: emp.isActive !== false
            };
        });

        // ── Thought for the Day (fresh daily quote from ZenQuotes, cached/day) ─
        this.on('getThoughtOfTheDay', async () => {
            return JSON.stringify(await loadThoughtOfTheDay());
        });

        // ── Company Newsletter (latest, visible to everyone) ──────────────────
        // Reuses the EmployeeDocument store: HR publishes via uploadEmployeeDocument
        // with documentType = 'Newsletter'; this returns the most recent one so any
        // authenticated user can open it from the dashboard.
        this.on('getLatestNewsletter', async () => {
            const empty = { hasNewsletter: false, newsletterId: '', fileName: '', mimeType: '', dataBase64: '', uploadedOn: '' };
            let doc;
            try {
                doc = await SELECT.one.from(DOCUMENT)
                    .columns('documentId', 'fileName', 'mimeType', 'content', 'createdAt')
                    .where({ documentType: 'Newsletter' })
                    .orderBy('createdAt desc');
            } catch (e) {
                cds.log('newsletter').warn('Could not query newsletter:', e.message || e);
                return empty;
            }
            if (!doc || !doc.content) return empty;

            let dataBase64 = '';
            try {
                const content = doc.content;
                if (Buffer.isBuffer(content)) dataBase64 = content.toString('base64');
                else if (content instanceof Uint8Array) dataBase64 = Buffer.from(content).toString('base64');
                else if (typeof content === 'string') dataBase64 = content;
                else if (content && typeof content.pipe === 'function') {
                    const chunks = [];
                    for await (const chunk of content) chunks.push(chunk);
                    dataBase64 = Buffer.concat(chunks).toString('base64');
                } else {
                    dataBase64 = Buffer.from(content).toString('base64');
                }
            } catch (e) {
                cds.log('newsletter').error('Could not read newsletter content:', e.message);
                return empty;
            }
            if (!dataBase64) return empty;

            return {
                hasNewsletter: true,
                newsletterId:  doc.documentId,
                fileName:      doc.fileName || 'newsletter',
                mimeType:      doc.mimeType || 'application/octet-stream',
                dataBase64,
                uploadedOn:    doc.createdAt ? String(doc.createdAt) : ''
            };
        });

        // Lightweight check (no binary) used to drive the "new newsletter" button.
        this.on('getNewsletterMeta', async () => {
            const empty = { hasNewsletter: false, newsletterId: '', fileName: '', uploadedOn: '' };
            let doc;
            try {
                doc = await SELECT.one.from(DOCUMENT)
                    .columns('documentId', 'fileName', 'createdAt')
                    .where({ documentType: 'Newsletter' })
                    .orderBy('createdAt desc');
            } catch (e) {
                cds.log('newsletter').warn('Could not query newsletter meta:', e.message || e);
                return empty;
            }
            if (!doc) return empty;
            return {
                hasNewsletter: true,
                newsletterId:  doc.documentId,
                fileName:      doc.fileName || 'newsletter',
                uploadedOn:    doc.createdAt ? String(doc.createdAt) : ''
            };
        });

        // ════════════════════════════════════════════════════════════════════
        //  GROUP TASKS  —  read + interaction (all scoped to the caller)
        // ════════════════════════════════════════════════════════════════════

        // List of group tasks visible to the caller: managers see the ones they
        // created; employees see the ones they're assigned to.
        this.on('getGroupTasks', async (req) => {
            const caller = await resolveCaller(req);
            const isManager = req.user && req.user.is && req.user.is('Manager');

            const tasks = await SELECT.from(TASK).where({ taskType: 'group' });
            if (!tasks.length) return JSON.stringify([]);
            const taskIds = tasks.map(t => t.taskId);
            const assignees = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: { in: taskIds } });

            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName');
            const nameMap = {}; emps.forEach(e => nameMap[e.employeeId] = e.employeeName);

            const visible = tasks.filter(t => {
                const isCreator = t.createdBy && (t.createdBy === caller.email || t.createdBy === caller.uid);
                if (isManager && isCreator) return true;
                return assignees.some(a => a.task_taskId === t.taskId && a.assignee_employeeId === caller.employeeId);
            });

            const out = visible.map(t => {
                const rows = assignees.filter(a => a.task_taskId === t.taskId);
                const ended = rows.filter(a => a.status === 'ended').length;
                return {
                    taskId: t.taskId, taskName: t.taskName, taskDescription: t.taskDescription,
                    priority: t.priority, status: t.status, dueDate: t.dueDate, completedAt: t.completedAt,
                    total: rows.length, ended,
                    assignees: rows.map(a => ({
                        employeeId: a.assignee_employeeId,
                        employeeName: nameMap[a.assignee_employeeId] || a.assignee_employeeId,
                        status: a.status, endedAt: a.endedAt
                    }))
                };
            });
            // Per-task unread chat flag (drives the red dot on the chat icon).
            try {
                const unread = await SELECT.from(NOTIFICATION).columns('referenceId').where({
                    employee_employeeId: caller.employeeId, type: 'GROUP_CHAT_MESSAGE', isRead: false
                });
                const unreadSet = new Set(unread.map(u => u.referenceId));
                out.forEach(t => { t.unreadChat = unreadSet.has(t.taskId); });
            } catch (e) { out.forEach(t => { t.unreadChat = false; }); }

            // Newest first by creation
            out.sort((a, b) => (b.taskId || '').localeCompare(a.taskId || ''));
            return JSON.stringify(out);
        });

        // Full detail for one group task + the caller's own membership flags.
        this.on('getGroupTaskDetail', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this task.');

            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email');
            const nameById = {}; const nameByEmail = {};
            emps.forEach(e => { nameById[e.employeeId] = e.employeeName; if (e.email) nameByEmail[e.email] = e.employeeName; });

            const rows = ctx.rows;
            const ended = rows.filter(a => a.status === 'ended').length;
            let unreadChat = false;
            try {
                const u = await SELECT.one.from(NOTIFICATION).columns('notificationId').where({
                    employee_employeeId: caller.employeeId, type: 'GROUP_CHAT_MESSAGE', isRead: false, referenceId: ctx.task.taskId
                });
                unreadChat = !!u;
            } catch (e) { /* default false */ }
            const detail = {
                taskId: ctx.task.taskId, taskName: ctx.task.taskName, taskDescription: ctx.task.taskDescription,
                priority: ctx.task.priority, status: ctx.task.status, dueDate: ctx.task.dueDate,
                completedAt: ctx.task.completedAt,
                createdByName: nameByEmail[ctx.task.createdBy] || 'Manager',
                total: rows.length, ended, unreadChat,
                isCreator: ctx.isCreator,
                myStatus: ctx.mine ? ctx.mine.status : null,
                // Only an assignee who has NOT yet ended their part may post
                // updates. The manager/creator who isn't a member, and any member
                // who already ended from their side, cannot post (enforced again
                // server-side in postGroupTaskUpdate — UI flag is convenience only).
                canPostUpdate: !!ctx.mine && ctx.mine.status !== 'ended',
                canEnd: !!ctx.mine && ctx.mine.status !== 'ended' && ctx.task.status !== 'completed',
                assignees: rows.map(a => ({
                    employeeId: a.assignee_employeeId,
                    employeeName: nameById[a.assignee_employeeId] || a.assignee_employeeId,
                    status: a.status, endedAt: a.endedAt, note: a.note
                }))
            };
            return JSON.stringify(detail);
        });

        // Employee ends their own part. When everyone has ended, the parent
        // task auto-completes. Lives here (server-side), never in the frontend.
        this.on('endMyTaskSide', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.mine) return req.error(403, 'You are not assigned to this task.');

            if (ctx.mine.status !== 'ended') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'ended', endedAt: new Date() }).where({ assignmentId: ctx.mine.assignmentId });
            }

            const rows = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: taskId });
            const allEnded = rows.length > 0 && rows.every(r => r.status === 'ended');
            let completed = false;
            if (allEnded && ctx.task.status !== 'completed') {
                await UPDATE(TASK).set({ status: 'completed', completedAt: new Date() }).where({ taskId });
                completed = true;
            }

            // Notifications
            try {
                const myName = caller.emp && caller.emp.employeeName || caller.employeeId;
                const recipients = await groupRecipientIds(ctx.task, rows);
                const creator = ctx.task.createdBy
                    ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email: ctx.task.createdBy }) : null;
                if (creator && creator.employeeId && creator.employeeId !== caller.employeeId) {
                    await createNotification(creator.employeeId, 'GROUP_TASK_UPDATE', 'Group task update',
                        `${myName} ended their part of “${ctx.task.taskName}”.`, taskId);
                }
                if (completed) {
                    for (const rid of recipients) {
                        await createNotification(rid, 'GROUP_TASK_COMPLETED', 'Group task completed',
                            `All members have ended “${ctx.task.taskName}”. The task is complete.`, taskId);
                    }
                }
            } catch (e) { cds.log('group').warn('end notify failed:', e.message || e); }

            return { taskId, myStatus: 'ended', completed };
        });

        // Paginated chat history (newest page first; load older on scroll up).
        this.on('getGroupTaskMessages', async (req) => {
            const { taskId } = req.data;
            const page = Math.max(1, parseInt(req.data.page, 10) || 1);
            const pageSize = Math.min(100, Math.max(1, parseInt(req.data.pageSize, 10) || 50));
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this chat.');

            const all = await SELECT.from(TASK_MESSAGE).where({ task_taskId: taskId }).orderBy('sentAt desc', 'messageId desc');
            const total = all.length;
            const start = (page - 1) * pageSize;
            const slice = all.slice(start, start + pageSize);

            const msgIds = slice.map(m => m.messageId);
            let atts = [];
            if (msgIds.length) {
                atts = await SELECT.from(TASK_ATTACHMENT)
                    .columns('attachmentId', 'message_messageId', 'fileName', 'mimeType', 'fileSize')
                    .where({ message_messageId: { in: msgIds } });
            }
            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName');
            const nameMap = {}; emps.forEach(e => nameMap[e.employeeId] = e.employeeName);

            const messages = slice.slice().reverse().map(m => ({   // oldest-first within page
                messageId: m.messageId,
                senderId: m.sender_employeeId,
                senderName: nameMap[m.sender_employeeId] || m.sender_employeeId,
                // A deleted message keeps its slot but exposes no content/attachments.
                message: m.isDeleted ? '' : (m.message || ''),
                sentAt: m.sentAt,
                editedAt: m.isDeleted ? null : (m.editedAt || null),
                isDeleted: !!m.isDeleted,
                attachments: m.isDeleted ? [] : atts.filter(a => a.message_messageId === m.messageId).map(a => ({
                    attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize
                }))
            }));

            // Pinned message (one per task). Resolved from the FULL list so it shows
            // even when it lives on a different page. A deleted pin is treated as none.
            let pinned = null;
            if (ctx.task.pinnedMessageId) {
                const pm = all.find(x => x.messageId === ctx.task.pinnedMessageId);
                if (pm && !pm.isDeleted) {
                    pinned = {
                        messageId: pm.messageId,
                        senderName: nameMap[pm.sender_employeeId] || pm.sender_employeeId,
                        pinnedByName: ctx.task.pinnedByName || '',
                        message: pm.message || ''
                    };
                }
            }

            // Opening the chat clears the caller's coalesced "new messages" badge.
            await markChatRead(taskId, caller.employeeId);

            return JSON.stringify({ messages, pinned, hasMore: total > start + pageSize, total, page, pageSize });
        });

        // Post a chat message (text and/or attachments, ≤10 MB each).
        this.on('sendTaskMessage', async (req) => {
            const { taskId } = req.data;
            const sMsg = (req.data.message || '').trim();
            const atts = req.data.attachments || [];
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You cannot post to this chat.');
            if (!sMsg && !atts.length) return req.error(400, 'A message or an attachment is required.');

            const messageId = `${taskId}-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_MESSAGE).entries({
                messageId, task_taskId: taskId, sender_employeeId: caller.employeeId,
                message: sMsg || null, sentAt: new Date()
            });

            let n = 0;
            for (const a of atts) {
                if (!a || !a.dataBase64) continue;
                let buf;
                try { buf = Buffer.from(String(a.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { continue; }
                if (buf.length > 10 * 1024 * 1024) return req.error(400, `Attachment “${a.fileName || 'file'}” exceeds the 10 MB limit.`);
                n++;
                await INSERT.into(TASK_ATTACHMENT).entries({
                    attachmentId: `${messageId}-ATT-${n}`,
                    message_messageId: messageId,
                    fileName: a.fileName || 'file',
                    mimeType: a.mimeType || 'application/octet-stream',
                    fileSize: buf.length,
                    content: buf
                });
            }

            // A member who's actively chatting is "in progress" (not pending).
            if (ctx.mine && ctx.mine.status === 'pending') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'in_progress' })
                    .where({ assignmentId: ctx.mine.assignmentId, status: 'pending' });
            }

            // Coalesced chat notifications to everyone else.
            try {
                const recipients = await groupRecipientIds(ctx.task, ctx.rows);
                await notifyGroupChat(taskId, ctx.task.taskName, caller.employeeId, recipients);
            } catch (e) { cds.log('group').warn('chat notify failed:', e.message || e); }

            return { messageId };
        });

        // Download a chat attachment (membership-checked) as base64.
        this.on('getTaskAttachment', async (req) => {
            const { attachmentId } = req.data;
            if (!attachmentId) return req.error(400, 'attachmentId is required.');
            const att = await SELECT.one.from(TASK_ATTACHMENT).where({ attachmentId });
            if (!att) return req.error(404, 'Attachment not found.');
            const msg = await SELECT.one.from(TASK_MESSAGE).columns('task_taskId').where({ messageId: att.message_messageId });
            const caller = await resolveCaller(req);
            const ctx = msg ? await loadGroupContext(msg.task_taskId, caller) : { isMember: false };
            if (!ctx.isMember) return req.error(403, 'You do not have access to this attachment.');

            const dataBase64 = await binaryToBase64(att.content);
            if (!dataBase64) return req.error(404, 'Attachment has no content.');
            return { fileName: att.fileName, mimeType: att.mimeType || 'application/octet-stream', dataBase64 };
        });

        // Explicitly clear the caller's "new messages" badge for a task.
        this.on('markGroupChatRead', async (req) => {
            const caller = await resolveCaller(req);
            await markChatRead(req.data.taskId, caller.employeeId);
            return { ok: true };
        });

        // ── Edit a chat message (author only) ─────────────────────────────────
        this.on('editTaskMessage', async (req) => {
            const { messageId } = req.data;
            const newText = (req.data.message || '').trim();
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            if (!newText) return JSON.stringify({ error: 'Message cannot be empty.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be edited.' });
            const caller = await resolveCaller(req);
            if (msg.sender_employeeId !== caller.employeeId) {
                return JSON.stringify({ error: 'You can only edit your own messages.' });
            }
            await UPDATE(TASK_MESSAGE).set({ message: newText, editedAt: new Date() }).where({ messageId });
            return JSON.stringify({ ok: true, messageId });
        });

        // ── Delete a chat message (author only) — soft delete ─────────────────
        // The row is kept (preserving order/history); content + attachments are
        // dropped and, if it was the pinned message, the task is unpinned.
        this.on('deleteTaskMessage', async (req) => {
            const { messageId } = req.data;
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            const caller = await resolveCaller(req);
            if (msg.sender_employeeId !== caller.employeeId) {
                return JSON.stringify({ error: 'You can only delete your own messages.' });
            }
            await UPDATE(TASK_MESSAGE).set({ isDeleted: true, message: null, editedAt: new Date() }).where({ messageId });
            await DELETE.from(TASK_ATTACHMENT).where({ message_messageId: messageId });
            const task = await SELECT.one.from(TASK).columns('taskId', 'pinnedMessageId').where({ taskId: msg.task_taskId });
            if (task && task.pinnedMessageId === messageId) {
                await UPDATE(TASK).set({ pinnedMessageId: null, pinnedByName: null }).where({ taskId: msg.task_taskId });
            }
            return JSON.stringify({ ok: true, messageId });
        });

        // ── Pin a chat message (any group member) — one active pin per task ───
        this.on('pinTaskMessage', async (req) => {
            const { taskId, messageId } = req.data;
            if (!taskId || !messageId) return JSON.stringify({ error: 'taskId and messageId are required.' });
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return JSON.stringify({ error: 'Group task not found.' });
            if (!ctx.isMember) return JSON.stringify({ error: 'You do not have access to this chat.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).columns('messageId', 'task_taskId', 'isDeleted').where({ messageId });
            if (!msg || msg.task_taskId !== taskId) return JSON.stringify({ error: 'Message not found in this task.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be pinned.' });
            const pinnedBy = (caller.emp && caller.emp.employeeName) || caller.employeeId || '';
            await UPDATE(TASK).set({ pinnedMessageId: messageId, pinnedByName: pinnedBy }).where({ taskId });
            return JSON.stringify({ ok: true, messageId, pinnedByName: pinnedBy });
        });

        // ── Unpin (any group member) ──────────────────────────────────────────
        this.on('unpinTaskMessage', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return JSON.stringify({ error: 'taskId is required.' });
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return JSON.stringify({ error: 'Group task not found.' });
            if (!ctx.isMember) return JSON.stringify({ error: 'You do not have access to this chat.' });
            await UPDATE(TASK).set({ pinnedMessageId: null, pinnedByName: null }).where({ taskId });
            return JSON.stringify({ ok: true });
        });

        // ── Group Task Updates ────────────────────────────────────────────────
        // List a group task's updates (newest first). Any member (assignee OR
        // the creator/manager) may VIEW. Each update carries the poster's name,
        // an optional profile photo (base64), timestamp and attachment metadata.
        this.on('getGroupTaskUpdates', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this task.');

            const rows = await SELECT.from(TASK_UPDATE)
                .where({ task_taskId: taskId })
                .orderBy('createdAt desc', 'updateId desc');

            // Resolve poster names + profile photos (deduped by employeeId).
            const ids = Array.from(new Set(rows.map(r => r.updatedBy_employeeId).filter(Boolean)));
            const nameById = {}; const photoById = {};
            if (ids.length) {
                const emps = await SELECT.from(EMPLOYEE)
                    .columns('employeeId', 'employeeName', 'profilePhoto', 'profilePhotoMimeType')
                    .where({ employeeId: { in: ids } });
                for (const e of emps) {
                    nameById[e.employeeId] = e.employeeName;
                    if (e.profilePhoto) {
                        const b64 = await binaryToBase64(e.profilePhoto);
                        if (b64) photoById[e.employeeId] = 'data:' + (e.profilePhotoMimeType || 'image/png') + ';base64,' + b64;
                    }
                }
            }

            const updates = rows.map(r => ({
                updateId: r.updateId,
                title: r.title || '',
                notes: r.notes || '',
                updatedAt: r.createdAt || r.updateDate,
                updatedById: r.updatedBy_employeeId,
                updatedByName: nameById[r.updatedBy_employeeId] || r.updatedBy_employeeId || 'Member',
                photoUrl: photoById[r.updatedBy_employeeId] || '',
                attachmentName: r.attachmentName || '',
                attachmentMimeType: r.attachmentMimeType || '',
                hasAttachment: !!r.attachmentName
            }));
            return JSON.stringify({ updates });
        });

        // Post a progress update on a group task. ONLY an assignee of the task
        // may post (creator/manager who isn't a member is rejected server-side).
        this.on('postGroupTaskUpdate', async (req) => {
            const { taskId } = req.data;
            const sNotes = (req.data.notes || '').trim();
            const sTitle = (req.data.title || '').trim();
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.mine) return req.error(403, 'Only members assigned to this task can post updates.');
            if (ctx.mine.status === 'ended') return req.error(403, 'You have ended this task from your side and can no longer post updates.');
            if (!sNotes) return req.error(400, 'An update message is required.');

            let buf = null;
            if (req.data.dataBase64) {
                try { buf = Buffer.from(String(req.data.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { buf = null; }
                if (buf && buf.length > 10 * 1024 * 1024) {
                    return req.error(400, 'Attachment exceeds the 10 MB limit.');
                }
            }

            const updateId = `${taskId}-UPD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_UPDATE).entries({
                updateId,
                task_taskId: taskId,
                updateDate: new Date().toISOString().slice(0, 10),
                title: sTitle || null,
                notes: sNotes,
                attachmentName: buf ? (req.data.fileName || 'attachment') : null,
                attachmentMimeType: buf ? (req.data.mimeType || 'application/octet-stream') : null,
                attachment: buf || null,
                updatedBy_employeeId: caller.employeeId
            });

            // Posting an update means the member is actively working → in_progress.
            if (ctx.mine.status === 'pending') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'in_progress' })
                    .where({ assignmentId: ctx.mine.assignmentId, status: 'pending' });
            }

            // Notify the other members + creator that a new update was posted.
            try {
                const myName = (caller.emp && caller.emp.employeeName) || caller.employeeId;
                const recipients = await groupRecipientIds(ctx.task, ctx.rows);
                for (const rid of recipients) {
                    if (!rid || rid === caller.employeeId) continue;
                    await createNotification(rid, 'GROUP_TASK_UPDATE', 'New task update',
                        `${myName} posted an update on “${ctx.task.taskName}”.`, taskId);
                }
            } catch (e) { cds.log('group').warn('update notify failed:', e.message || e); }

            return { updateId };
        });

        // Download a task-update attachment (access-checked) as base64. Works for
        // both solo and group tasks — the old version only allowed group members,
        // so solo-task update attachments 403'd and appeared "not downloadable".
        this.on('getTaskUpdateAttachment', async (req) => {
            const { updateId } = req.data;
            if (!updateId) return req.error(400, 'updateId is required.');
            const upd = await SELECT.one.from(TASK_UPDATE)
                .columns('updateId', 'task_taskId', 'attachmentName', 'attachmentMimeType', 'attachment')
                .where({ updateId });
            if (!upd) return req.error(404, 'Update not found.');
            const access = await canAccessTask(req, upd.task_taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this attachment.');
            const dataBase64 = await binaryToBase64(upd.attachment);
            if (!dataBase64) return req.error(404, 'Attachment has no content.');
            return {
                fileName: upd.attachmentName || 'attachment',
                mimeType: upd.attachmentMimeType || 'application/octet-stream',
                dataBase64
            };
        });

        // ── Multi-document task attachments ───────────────────────────────────
        // List metadata (no binary) for every document attached to a task.
        this.on('getTaskDocuments', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const access = await canAccessTask(req, taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this task.');
            const rows = await SELECT.from(TASK_DOCUMENT)
                .columns('documentId', 'fileName', 'mimeType', 'fileSize', 'createdAt')
                .where({ task_taskId: taskId })
                .orderBy('createdAt asc');
            return JSON.stringify((rows || []).map(r => ({
                documentId: r.documentId,
                fileName:   r.fileName || 'document',
                mimeType:   r.mimeType || 'application/octet-stream',
                fileSize:   r.fileSize || 0
            })));
        });

        // Non-destructive download of one task document as base64.
        this.on('getTaskDocument', async (req) => {
            const { documentId } = req.data;
            if (!documentId) return req.error(400, 'documentId is required.');
            const doc = await SELECT.one.from(TASK_DOCUMENT)
                .columns('documentId', 'task_taskId', 'fileName', 'mimeType', 'content')
                .where({ documentId });
            if (!doc) return req.error(404, 'Document not found.');
            const access = await canAccessTask(req, doc.task_taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this document.');
            const dataBase64 = await binaryToBase64(doc.content);
            if (!dataBase64) return req.error(404, 'Document has no content.');
            return {
                fileName: doc.fileName || 'document',
                mimeType: doc.mimeType || 'application/octet-stream',
                dataBase64
            };
        });

        // Post a progress update on a SOLO task, persisting the optional file
        // binary so it can be downloaded later by anyone with task access.
        this.on('postTaskUpdate', async (req) => {
            const { taskId } = req.data;
            const sNotes = (req.data.notes || '').trim();
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!sNotes) return req.error(400, 'An update note is required.');
            const access = await canAccessTask(req, taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this task.');
            if (access.task && access.task.status === 'Completed') {
                return req.error(403, 'This task is Completed — updates are no longer allowed.');
            }

            let buf = null;
            if (req.data.dataBase64) {
                try { buf = Buffer.from(String(req.data.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { buf = null; }
                if (buf && buf.length > 10 * 1024 * 1024) {
                    return req.error(400, 'Attachment exceeds the 10 MB limit.');
                }
            }

            const updateId = `${taskId}-UPD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_UPDATE).entries({
                updateId,
                task_taskId: taskId,
                updateDate: req.data.updateDate || new Date().toISOString().slice(0, 10),
                notes: sNotes,
                attachmentName: buf ? (req.data.fileName || 'attachment') : null,
                attachmentMimeType: buf ? (req.data.mimeType || 'application/octet-stream') : null,
                attachment: buf || null,
                updatedBy_employeeId: access.caller.employeeId
            });
            return { updateId };
        });

        // Unread group-task notifications for the caller → "Group Tasks" badge.
        this.on('getGroupTasksUnread', async (req) => {
            const caller = await resolveCaller(req);
            if (!caller.employeeId) return { count: 0 };
            try {
                const rows = await SELECT.from(NOTIFICATION).columns('notificationId').where({
                    employee_employeeId: caller.employeeId,
                    isRead: false,
                    type: { in: ['GROUP_CHAT_MESSAGE', 'GROUP_TASK_ASSIGNED', 'GROUP_TASK_UPDATE', 'GROUP_TASK_COMPLETED'] }
                });
                return { count: rows.length };
            } catch (e) {
                return { count: 0 };
            }
        });

        // ── Sidebar menu badges (unread notifications per menu route) ─────────
        this.on('getSidebarBadges', async (req) => {
            const caller = await resolveCaller(req);
            if (!caller.employeeId) return JSON.stringify({});
            const isHR = !!(req.user && req.user.is && req.user.is('HR'));
            let rows = [];
            try {
                rows = await SELECT.from(NOTIFICATION).columns('type')
                    .where({ employee_employeeId: caller.employeeId, isRead: false });
            } catch (e) { return JSON.stringify({}); }
            const counts = {};
            rows.forEach(r => {
                const route = routeForNotif(r.type, isHR);
                if (route) counts[route] = (counts[route] || 0) + 1;
            });
            return JSON.stringify(counts);
        });

        // Clear a menu's badge by marking its related unread notifications read.
        this.on('markRouteNotificationsRead', async (req) => {
            const route = ((req.data && req.data.route) || '').trim();
            const caller = await resolveCaller(req);
            if (!caller.employeeId || !route) return { updated: 0 };
            const isHR = !!(req.user && req.user.is && req.user.is('HR'));
            let rows = [];
            try {
                rows = await SELECT.from(NOTIFICATION).columns('notificationId', 'type')
                    .where({ employee_employeeId: caller.employeeId, isRead: false });
            } catch (e) { return { updated: 0 }; }
            const ids = rows.filter(r => {
                if (routeForNotif(r.type, isHR) !== route) return false;
                // Group chat messages are cleared by opening the specific task's
                // chat (markChatRead), not by visiting the list — this preserves
                // each task's "unread chat" indicator.
                if (route === 'group-tasks' && r.type === 'GROUP_CHAT_MESSAGE') return false;
                return true;
            }).map(r => r.notificationId);
            if (!ids.length) return { updated: 0 };
            await UPDATE(NOTIFICATION).set({ isRead: true }).where({ notificationId: { in: ids } });
            return { updated: ids.length };
        });

        // ── Upload Profile Photo ──────────────────────────────────────────────
        // CAP's UPDATE().set() silently skips LargeBinary columns annotated
        // with @Core.MediaType in SQLite. We use raw SQL to bypass this.
        this.on('uploadProfilePhoto', async (req) => {
            const { dataBase64 } = req.data;
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');

            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!email) return req.error(401, 'Cannot identify user — no email in token.');

            // Resolve employeeId from email
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where('lower(email) =', email);
            if (!emp) return req.error(404, 'Employee record not found for this login.');

            // Parse "data:image/jpeg;base64,<data>"
            let mimeType = 'image/jpeg';
            let rawBase64 = dataBase64;
            const commaIdx = dataBase64.indexOf(',');
            if (commaIdx !== -1) {
                const header = dataBase64.substring(0, commaIdx); // "data:image/jpeg;base64"
                rawBase64 = dataBase64.substring(commaIdx + 1);   // raw base64 after comma
                const mimeMatch = header.match(/data:([^;]+);/);
                if (mimeMatch) mimeType = mimeMatch[1];
            }

            if (!mimeType.startsWith('image/')) {
                return req.error(400, 'Only image files are allowed.');
            }

            let buf;
            try { buf = Buffer.from(rawBase64, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }

            if (buf.length > 2 * 1024 * 1024) {
                return req.error(400, 'Profile photo must be under 2 MB.');
            }

            // ── Persist via CQN against the CDS entity (DB-agnostic) ──────────
            // The previous implementation used raw SQL with a hard-coded SQLite
            // physical table name, which does not exist on HANA → upload failed
            // only in the deployed environment. CQN lets CAP resolve the correct
            // table for whichever DB is bound (SQLite locally, HANA deployed).
            await UPDATE(EMPLOYEE)
                .set({ profilePhoto: buf, profilePhotoMimeType: mimeType })
                .where({ employeeId: emp.employeeId });

            cds.log('profile').info(
                `✓ Photo saved: emp=${emp.employeeId} | bytes=${buf.length} | mime=${mimeType}`
            );

            return { success: true, message: `Photo saved (${mimeType}, ${buf.length} bytes).` };
        });

        // ── Get Profile Photo ─────────────────────────────────────────────────
        // Also uses raw SQL so the BLOB is read correctly from SQLite.
        this.on('getProfilePhoto', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!email) return { dataBase64: '', mimeType: '' };

            // Resolve employeeId first (safe — no BLOB involved)
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where('lower(email) =', email);
            if (!emp) return { dataBase64: '', mimeType: '' };

            // Read BLOB via CQN (DB-agnostic — works on SQLite and HANA alike).
            const row = await SELECT.one.from(EMPLOYEE)
                .columns('profilePhoto', 'profilePhotoMimeType')
                .where({ employeeId: emp.employeeId });

            cds.log('profile').info(
                `getProfilePhoto: emp=${emp.employeeId} | hasPhoto=${!!(row && row.profilePhoto)} | mime=${row && row.profilePhotoMimeType}`
            );

            if (!row || !row.profilePhoto) return { dataBase64: '', mimeType: '' };

            // Convert BLOB → base64.
            // The column may hold EITHER raw image binary OR base64 text stored
            // as bytes — CAP's LargeBinary handling base64-encodes Buffers when
            // written via raw SQL on SQLite, so existing rows hold base64 text.
            // Detect which form it is by checking image magic numbers and always
            // emit SINGLE-encoded base64 (re-encoding base64 text would corrupt
            // the data URL and show a broken image).
            let base64 = '';
            try {
                const photo = row.profilePhoto;
                let buf;
                if (Buffer.isBuffer(photo)) buf = photo;
                else if (photo instanceof Uint8Array) buf = Buffer.from(photo);
                else if (typeof photo === 'string') buf = Buffer.from(photo, 'utf8');
                else if (photo && typeof photo.pipe === 'function') {
                    // CAP returns LargeBinary as a Readable stream via CQN (both
                    // SQLite and HANA). Consume it into a Buffer before encoding —
                    // otherwise the bytes are lost and the photo comes back empty.
                    const chunks = [];
                    for await (const chunk of photo) chunks.push(chunk);
                    buf = Buffer.concat(chunks);
                } else {
                    buf = Buffer.from(photo);
                }
                if (!buf || !buf.length) return { dataBase64: '', mimeType: '' };

                const isRawImage =
                    (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) || // JPEG
                    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) || // PNG
                    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) || // GIF
                    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46);   // WEBP/RIFF

                base64 = isRawImage
                    ? buf.toString('base64')          // raw binary → encode once
                    : buf.toString('utf8').trim();    // already base64 text → use as-is
            } catch (e) {
                cds.log('profile').error('Could not encode photo:', e.message);
                return { dataBase64: '', mimeType: '' };
            }

            // Always guarantee a valid mimeType — never return empty
            const mimeType = (row.profilePhotoMimeType && row.profilePhotoMimeType.trim())
                ? row.profilePhotoMimeType.trim()
                : 'image/jpeg';

            return {
                dataBase64: `data:${mimeType};base64,${base64}`,
                mimeType
            };
        });

        this.on('submitTimesheet', async (req) => {
            const { timesheetId } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (!['Draft', 'Rejected'].includes(header.status)) {
                return req.error(400, `Cannot submit — current status is '${header.status}'. Only 'Draft' or 'Rejected' timesheets can be submitted.`);
            }
            await UPDATE(HEADER).set({ status: 'Pending', submittedOn: new Date() }).where({ timesheetId });
            await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Locked' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' submitted. Waiting for manager approval.`;
        });

        this.on('consumeTaskAttachment', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const task = await SELECT.one.from(TASK).columns('taskId', 'attachment', 'attachmentName', 'attachmentMimeType').where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);
            if (!task.attachment || !task.attachmentName) return req.error(404, 'No attachment available for this task.');
            let base64 = '';
            try {
                if (Buffer.isBuffer(task.attachment)) base64 = task.attachment.toString('base64');
                else if (typeof task.attachment === 'string') base64 = task.attachment;
                else if (task.attachment instanceof Uint8Array) base64 = Buffer.from(task.attachment).toString('base64');
                else base64 = Buffer.from(task.attachment).toString('base64');
            } catch (e) {
                cds.log('attach').error('Could not encode attachment:', e.message || e);
                return req.error(500, 'Could not read attachment.');
            }
            const result = { fileName: task.attachmentName, mimeType: task.attachmentMimeType || 'application/octet-stream', dataBase64: base64 };
            try {
                await UPDATE(TASK).set({ attachment: null, attachmentName: null, attachmentMimeType: null }).where({ taskId });
            } catch (e) {
                cds.log('attach').warn(`Failed to clear attachment for ${taskId}:`, e.message || e);
            }
            return result;
        });

        this.on('applyLeave', async (req) => {
            const { employeeId, leaveType, fromDate, toDate, days, reason, isUnpaid } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            if (!leaveType) return req.error(400, 'leaveType is required.');
            if (!fromDate) return req.error(400, 'fromDate is required.');
            if (!toDate) return req.error(400, 'toDate is required.');
            if (!days) return req.error(400, 'days is required.');
            if (!reason) return req.error(400, 'reason is required.');
            // Range sanity: end can't precede start, and day count must be positive.
            // (`!days` above already rejects 0/empty; this also catches negatives,
            // which are truthy.) We do NOT recompute `days` — the client computes
            // working-days (weekends/holidays excluded) and that value is kept.
            if (new Date(toDate) < new Date(fromDate)) {
                return req.error(400, 'The "to" date cannot be earlier than the "from" date.');
            }
            if (!(Number(days) > 0)) {
                return req.error(400, 'Number of leave days must be greater than zero.');
            }

            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            // Security: a leave can only be filed for oneself. The UI always sends
            // the caller's own id, so this guard is invisible to normal use — it
            // only blocks a forged request that names another employee. (If the
            // caller's email can't be resolved to a record we leave behaviour as
            // before, so no existing flow is broken.)
            {
                const user = req.user || {};
                const callerEmail = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
                const caller = callerEmail
                    ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', callerEmail)
                    : null;
                if (caller && caller.employeeId !== employeeId) {
                    return req.error(403, 'You can only apply for leave for yourself.');
                }
            }
            if (emp.designation && emp.designation.toLowerCase() === 'founder') {
                return req.error(403, 'Founders are not eligible to apply for leave.');
            }

            const leaveId = `${employeeId}-LV-${Date.now()}`;
            await INSERT.into(LEAVE_REQUEST).entries({
                leaveId, employee_employeeId: employeeId, leaveType, fromDate, toDate,
                days, reason, status: 'Pending', isUnpaid: isUnpaid || false
            });

            const cascadeStr = req.data.cascade || null;
            if (cascadeStr) cds.log('leave').info(`Cascade breakdown for ${leaveId}: ${cascadeStr}`);

            if (emp.manager_employeeId) {
                // Issue 2: in-app notification to the manager (always — independent
                // of SMTP, which is the reason leave notifications never appeared).
                await createNotification(
                    emp.manager_employeeId,
                    'LEAVE_REQUEST',
                    'New Leave Request',
                    `${emp.employeeName} requested ${leaveType} leave (${fromDate} to ${toDate}, ${days} day${days > 1 ? 's' : ''}).`,
                    leaveId
                );

                const manager = await SELECT.one.from(EMPLOYEE).where({ employeeId: emp.manager_employeeId });
                if (manager && manager.email) {
                    const mailer = getMailer();
                    const subject = `Leave Request from ${emp.employeeName}`;
                    const body = `Hi ${manager.employeeName || 'Manager'},\n\n${emp.employeeName} has applied for leave.\n\nLeave Type : ${leaveType}\nFrom       : ${fromDate}\nTo         : ${toDate}\nDays       : ${days}${isUnpaid ? ' (includes unpaid days)' : ''}\nReason     : ${reason}\n\nPlease login to the Timesheet app to approve or reject.\n\n— Timesheet System`;
                    if (mailer) {
                        try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: manager.email, subject, text: body }); }
                        catch (e) { cds.log('mail').warn('Leave notification email failed:', e.message); }
                    } else {
                        cds.log('leave').info(`[Email simulated] TO: ${manager.email}\n${body}`);
                    }
                }
            }
            return { leaveId, status: 'Pending', isUnpaid: isUnpaid || false };
        });

        this.on('getRecentNotifications', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return [];
            const rows = await SELECT.from(NOTIFICATION).where({ employee_employeeId: emp.employeeId }).orderBy({ notifiedAt: 'desc' }).limit(4);
            return (rows || []).map(n => ({
                notificationId: n.notificationId, type: n.type || '', title: n.title || '',
                message: n.message || '', isRead: n.isRead || false, referenceId: n.referenceId || '',
                notifiedAt: n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));
        });

        this.on('markAllNotificationsRead', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const empRow = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!empRow) return req.error(404, 'Employee not found.');

            // Count unread BEFORE updating (affectedRows not reliable in CDS)
            const unreadRows = await SELECT.from(NOTIFICATION)
                .columns('notificationId')
                .where({ employee_employeeId: empRow.employeeId, isRead: false });
            const updated = (unreadRows || []).length;

            if (updated > 0) {
                await UPDATE(NOTIFICATION)
                    .set({ isRead: true })
                    .where({ employee_employeeId: empRow.employeeId, isRead: false });
            }

            cds.log('notif').info(`${updated} notifications marked as read for ${empRow.employeeId}`);
            return { updated };
        });

        // ── Paginated notifications (bell icon + Notifications page) ───────────
        // Declared in the CDS but previously had no handler → 501, so the bell
        // and Notifications page received nothing even though rows existed in DB
        // (getRecentNotifications showed them). Implemented here.
        this.on('getNotifications', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { itemsJSON: '[]', totalCount: 0, unreadCount: 0 };

            const page     = Math.max(1, parseInt(req.data.page, 10) || 1);
            const pageSize = Math.max(1, parseInt(req.data.pageSize, 10) || 20);
            const offset   = (page - 1) * pageSize;

            const all = await SELECT.from(NOTIFICATION)
                .where({ employee_employeeId: emp.employeeId })
                .orderBy({ notifiedAt: 'desc' });

            const totalCount  = all.length;
            const unreadCount = all.filter(n => !n.isRead).length;
            const pageRows = all.slice(offset, offset + pageSize).map(n => ({
                notificationId: n.notificationId,
                type:           n.type || '',
                title:          n.title || '',
                message:        n.message || '',
                isRead:         n.isRead || false,
                referenceId:    n.referenceId || '',
                notifiedAt:     n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));

            return { itemsJSON: JSON.stringify(pageRows), totalCount, unreadCount };
        });

        // ── Mark a single notification as read ─────────────────────────────────
        this.on('markNotificationRead', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            const { notificationId } = req.data;
            if (!emp || !notificationId) return { success: false };
            await UPDATE(NOTIFICATION).set({ isRead: true })
                .where({ notificationId, employee_employeeId: emp.employeeId });
            return { success: true };
        });

        // ── Delete / dismiss a single notification ─────────────────────────────
        this.on('deleteNotification', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            const { notificationId } = req.data;
            if (!emp || !notificationId) return { success: false };
            await DELETE.from(NOTIFICATION)
                .where({ notificationId, employee_employeeId: emp.employeeId });
            return { success: true };
        });

        // ── Dashboard: Upcoming Calendar (Google Calendar API) ─────────────────────
        // Reads GOOGLE_CALENDAR_API_KEY + GOOGLE_CALENDAR_ID from environment.
        // Falls back to empty array if not configured — card shows "No events".
        const { fetchUpcomingMeetings } = require('./google-calendar');

        this.on('getUpcomingCalendar', async (req) => {
            const user = req.user || {};
            const email = user.attr?.email || user.attr?.mail || user.attr?.upn || user.id || '';
            cds.log('gcal').info(`Fetching Google Meet events for: ${email}`);
            if (!email) return { eventsJSON: JSON.stringify([]) };
            try {
                const events = await fetchUpcomingMeetings(email);
                return { eventsJSON: JSON.stringify(events) };
            } catch (e) {
                cds.log('gcal').error('getUpcomingCalendar failed:', e.message);
                return { eventsJSON: JSON.stringify([{ title: 'Could not load calendar', dateLabel: 'Check server logs', timeLabel: e.message?.substring(0, 60) || 'Unknown error', meetLink: null, isError: true }]) };
            }
        });

        this.on('getLeaveOverview', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { casual: 0, sick: 0, annual: 0, unpaid: 0, totalDays: 0, takenJSON: JSON.stringify([]) };
            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one.from(LEAVE_BALANCE).where({ employee_employeeId: emp.employeeId });
            const ALLOTMENT = { casual: 12, sick: 8, annual: 15, unpaid: 0 };
            const casual = balance ? (balance.casualLeave || 0) : ALLOTMENT.casual;
            const sick = balance ? (balance.sickLeave || 0) : ALLOTMENT.sick;
            const annual = balance ? (balance.annualLeave || 0) : ALLOTMENT.annual;
            const takenData = [
                { type: 'casual', label: 'Casual Leave', taken: Math.max(0, ALLOTMENT.casual - casual), balance: casual, color: '#16a34a' },
                { type: 'sick', label: 'Sick Leave', taken: Math.max(0, ALLOTMENT.sick - sick), balance: sick, color: '#3b82f6' },
                { type: 'annual', label: 'Annual Leave', taken: Math.max(0, ALLOTMENT.annual - annual), balance: annual, color: '#f59e0b' },
                { type: 'unpaid', label: 'Unpaid Leave', taken: 0, balance: 0, color: '#9ca3af' }
            ];
            return { casual, sick, annual, unpaid: 0, totalDays: casual + sick + annual, takenJSON: JSON.stringify(takenData) };
        });

        this.on('getWorkAnniversary', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'joiningDate').where('lower(email) =', email);
            if (!emp || !emp.joiningDate) return { yearsCompleted: 0, joiningDate: null, message: 'No joining date found.' };
            const joining = new Date(emp.joiningDate);
            const today = new Date();
            const totalDays = (today - joining) / (1000 * 60 * 60 * 24);
            const yearsCompleted = Math.max(0, totalDays / 365.25);
            return {
                yearsCompleted: parseFloat(yearsCompleted.toFixed(2)),
                joiningDate: emp.joiningDate,
                message: yearsCompleted >= 1
                    ? `Congratulations! You have completed ${Math.floor(yearsCompleted)} years with us.`
                    : `Welcome! You joined on ${joining.toLocaleDateString()}`
            };
        });

        this.on('getPerformanceRating', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { ratingValue: 0, ratingCategory: 'N/A', reviewMonth: 0, reviewYear: 0, reviewComment: '' };
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const ratings = await SELECT.from(PERF).where({ employee_employeeId: emp.employeeId }).orderBy('reviewYear desc', 'reviewMonth desc').limit(1);
            if (!ratings || ratings.length === 0) return { ratingValue: 0, ratingCategory: 'N/A', reviewMonth: 0, reviewYear: 0, reviewComment: '' };
            const r = ratings[0];
            const val = parseFloat(r.ratingValue) || 0;
            return {
                ratingValue: val,
                ratingCategory: val >= 4.5 ? 'Excellent' : val >= 3.5 ? 'Good' : val >= 2.5 ? 'Average' : val > 0 ? 'Needs Improvement' : 'N/A',
                reviewMonth: r.reviewMonth || 0, reviewYear: r.reviewYear || 0, reviewComment: r.reviewComment || ''
            };
        });

        this.on('getPerformanceTrend', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const year = req.data.year || new Date().getFullYear();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { trendJSON: JSON.stringify(Array(12).fill(null)) };
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const ratings = await SELECT.from(PERF).where({ employee_employeeId: emp.employeeId, reviewYear: year }).orderBy('reviewMonth asc');
            const slots = Array(12).fill(null);
            ratings.forEach(r => { const idx = (r.reviewMonth || 1) - 1; if (idx >= 0 && idx < 12) slots[idx] = parseFloat(r.ratingValue) || null; });
            return { trendJSON: JSON.stringify(slots) };
        });

        this.on('getTaskSummary', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 };

            // Include tasks assigned to the employee AND tasks where they are the
            // reviewer (matches the Task Description table, which shows both).
            const [assignedTasks, reviewTasks, groupTasks] = await Promise.all([
                SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId }),
                SELECT.from(TASK).where({ reviewer_employeeId: emp.employeeId }),
                myGroupTasks(emp.employeeId)
            ]);
            const taskMap = new Map();
            [...(assignedTasks || []), ...(reviewTasks || []), ...(groupTasks || [])].forEach(t => {
                if (t && t.taskId) taskMap.set(t.taskId, t);
            });
            const tasks = Array.from(taskMap.values());

            let notStarted = 0, inProgress = 0, inReview = 0, completed = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                if (s === 'notstarted' || s === 'open' || s === 'pending') notStarted++;
                else if (s === 'inprogress') inProgress++;
                else if (s === 'inreview') inReview++;
                else if (s === 'completed') completed++;
                else notStarted++; // treat unknown as not started
            });

            return {
                total: tasks.length,
                notStarted, inProgress, inReview, completed
            };
        });

        this.on('getLeaveBalance', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { casualLeave: 0, sickLeave: 0, annualLeave: 0, total: 0 };
            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one.from(LEAVE_BALANCE).where({ employee_employeeId: emp.employeeId });
            if (balance) {
                const total = (balance.casualLeave || 0) + (balance.sickLeave || 0) + (balance.annualLeave || 0);
                return { casualLeave: balance.casualLeave || 0, sickLeave: balance.sickLeave || 0, annualLeave: balance.annualLeave || 0, total };
            }
            return { casualLeave: 6, sickLeave: 4, annualLeave: 8, total: 18 };
        });

        this.on('getMyTasks', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { totalPending: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0 };

            // Include tasks assigned to the employee AND tasks where they are the
            // reviewer (matches the Task Description table, which shows both).
            const [assignedTasks, reviewTasks, groupTasks] = await Promise.all([
                SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId }),
                SELECT.from(TASK).where({ reviewer_employeeId: emp.employeeId }),
                myGroupTasks(emp.employeeId)
            ]);
            const taskMap = new Map();
            [...(assignedTasks || []), ...(reviewTasks || []), ...(groupTasks || [])].forEach(t => {
                if (t && t.taskId) taskMap.set(t.taskId, t);
            });
            const tasks = Array.from(taskMap.values());

            let totalPending = 0, highPriorityCount = 0, mediumPriorityCount = 0, lowPriorityCount = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                // Everything that isn't completed counts as pending
                if (s !== 'completed') {
                    totalPending++;
                    if (t.priority === 'High') highPriorityCount++;
                    else if (t.priority === 'Medium') mediumPriorityCount++;
                    else if (t.priority === 'Low') lowPriorityCount++;
                }
            });

            return { totalPending, highPriorityCount, mediumPriorityCount, lowPriorityCount };
        });

        this.on('markAttendance', async (req) => {
            const { attendanceDate, attendanceDay, attendanceTime } = req.data;
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!attendanceDate) return req.error(400, 'attendanceDate is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where('lower(email) =', email);
            if (!emp) return req.error(404, 'Employee not found for this login.');
            const existing = await SELECT.one.from(ATTENDANCE).where({ employee_employeeId: emp.employeeId, attendanceDate });
            if (existing) return req.error(409, `Attendance already marked for ${attendanceDate} at ${existing.attendanceTime}.`);
            const attendanceId = `${emp.employeeId}-${attendanceDate}`;
            await INSERT.into(ATTENDANCE).entries({
                attendanceId, employee_employeeId: emp.employeeId, attendanceDate,
                attendanceDay: attendanceDay || '',
                attendanceTime: attendanceTime || new Date().toTimeString().split(' ')[0],
                status: 'Present'
            });
            cds.log('attend').info(`Attendance marked: ${emp.employeeId} (${emp.employeeName}) on ${attendanceDate} at ${attendanceTime}`);
            return { attendanceId, employeeId: emp.employeeId, employeeName: emp.employeeName, attendanceDate, attendanceDay, attendanceTime, message: `Attendance recorded successfully for ${attendanceDay}, ${attendanceDate}.` };
        });

        this.on('getAttendance', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { attendancePercentage: 0, presentCount: 0, absentCount: 0, monthLabel: new Date().toLocaleString('default', { month: 'long' }) };
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const monthStr = String(month).padStart(2, '0');
            const records = await SELECT.from(ATTENDANCE).where(`employee_employeeId = '${emp.employeeId}' AND attendanceDate LIKE '${year}-${monthStr}-%'`);
            const presentCount = records.length;
            let workingDays = 0;
            const d = new Date(year, month - 1, 1);
            while (d <= now && d.getMonth() === month - 1) {
                const day = d.getDay();
                if (day !== 0 && day !== 6) workingDays++;
                d.setDate(d.getDate() + 1);
            }
            const absentCount = Math.max(0, workingDays - presentCount);
            const attendancePercentage = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 0;
            return { attendancePercentage, presentCount, absentCount, monthLabel: now.toLocaleString('default', { month: 'long' }) };
        });

        this.on('getTodayAttendance', async (req) => {
            const { attendanceDate } = req.data;
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { alreadyMarked: false, attendanceTime: null, attendanceDay: null };
            const existing = await SELECT.one.from(ATTENDANCE).where({ employee_employeeId: emp.employeeId, attendanceDate });
            return { alreadyMarked: !!existing, attendanceTime: existing ? existing.attendanceTime : null, attendanceDay: existing ? existing.attendanceDay : null };
        });

        // Issue 2: no updates may be posted on a Completed task. Guards the
        // OData create path used by the solo Task Detail "Post an update" form.
        this.before('CREATE', 'TaskUpdates', async (req) => {
            const sTaskId = req.data && (req.data.task_taskId || (req.data.task && req.data.task.taskId));
            if (!sTaskId) return;
            const task = await SELECT.one.from(TASK).columns('status').where({ taskId: sTaskId });
            if (task && task.status === 'Completed') {
                return req.reject(403, 'This task is Completed — updates are no longer allowed.');
            }
        });

        this.on('updateTaskStatus', async (req) => {
            const { taskId, status, reviewerId, reviewerStatus } = req.data;

            cds.log('task').info('updateTaskStatus →', { taskId, status, reviewerId, reviewerStatus });

            if (!taskId) return req.error(400, 'taskId is required.');
            if (!status) return req.error(400, 'status is required.');

            const task = await SELECT.one.from(TASK).where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);

            // Issue 1: once a reviewer marks a task Completed it is locked.
            // Employees cannot move it back to In Progress / Not Started / etc.
            // (Reopening, if ever needed, happens only through the reviewer's
            // "Issue Found" flow on an In-Review task — never via this action.)
            if (task.status === 'Completed') {
                return req.error(403, 'This task is completed and locked. Its status can no longer be changed.');
            }

            // Only patch reviewer fields when a real (non-empty) value is supplied.
            // Sending an empty string would try to set reviewer_employeeId = ""
            // which violates the FK and causes the entire UPDATE to fail.
            const patch = { status, statusUpdatedAt: new Date() };
            if (reviewerId && String(reviewerId).trim()) patch.reviewer_employeeId = reviewerId;
            if (reviewerStatus && String(reviewerStatus).trim()) patch.reviewerStatus = reviewerStatus;

            cds.log('task').info('updateTaskStatus patch:', JSON.stringify(patch));
            await UPDATE(TASK).set(patch).where({ taskId });
            cds.log('task').info('updateTaskStatus done for', taskId);

            // Notify reviewer when task is sent for review
            if (status === 'In Review' && reviewerId) {
                await createNotification(
                    reviewerId,
                    'TASK_REVIEW_REQUESTED',
                    'Review Requested',
                    `You have been asked to review: "${task.taskName || taskId}"`,
                    taskId
                );
            }

            // Notify assignee when reviewer marks done or reopens
            if ((status === 'Completed' || status === 'In Progress') && task.assignedTo_employeeId) {
                await createNotification(
                    task.assignedTo_employeeId,
                    'TASK_ASSIGNED',
                    status === 'Completed' ? 'Task Reviewed ✓' : 'Task Reopened',
                    status === 'Completed'
                        ? `Your task "${task.taskName || taskId}" was reviewed and marked complete.`
                        : `Your task "${task.taskName || taskId}" was reopened by the reviewer.`,
                    taskId
                );
            }

            cds.log('task').info(`Task ${taskId} status → ${status} by ${req.user?.id}`);
            return { taskId, status };
        });

        // ── Review workflow: Reviewed / Issue Found ──────────────────────────
        // Shared implementation; `decision` decides the target status.
        const handleReviewDecision = async (req, decision) => {
            const { taskId, remarks, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!remarks || !String(remarks).trim()) {
                return req.error(400, 'Remarks are required.');
            }

            const task = await SELECT.one.from(TASK).where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);
            if (task.status !== 'In Review') {
                return req.error(400, `Task '${taskId}' is not currently In Review (status: ${task.status}).`);
            }

            // Resolve reviewer from logged-in user
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const reviewer = email
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where('lower(email) =', email)
                : null;
            if (!reviewer) return req.error(401, 'Cannot identify reviewer.');

            // Only the assigned reviewer can submit a decision
            if (task.reviewer_employeeId && task.reviewer_employeeId !== reviewer.employeeId) {
                return req.error(403, 'You are not the assigned reviewer for this task.');
            }

            // Decode optional attachment
            let attachmentBuf = null;
            let storedName = null;
            let storedMime = null;
            if (dataBase64) {
                const cleaned = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
                try {
                    attachmentBuf = Buffer.from(cleaned, 'base64');
                    if (attachmentBuf.length > 5 * 1024 * 1024) {
                        return req.error(400, 'Attachment must be under 5 MB.');
                    }
                    storedName = fileName || 'review-attachment';
                    storedMime = mimeType || 'application/octet-stream';
                } catch (e) {
                    return req.error(400, 'dataBase64 is not valid base64.');
                }
            }

            const reviewId = `${taskId}-REV-${Date.now()}`;
            const reviewedOn = new Date();
            const newTaskStatus = decision === 'Reviewed' ? 'Completed' : 'In Progress';

            // Persist review row
            await INSERT.into(TASK_REVIEW).entries({
                reviewId,
                task_taskId: taskId,
                reviewer_employeeId: reviewer.employeeId,
                assignee_employeeId: task.assignedTo_employeeId || null,
                decision,
                remarks: String(remarks).trim(),
                attachmentName: storedName,
                attachmentMimeType: storedMime,
                attachment: attachmentBuf,
                reviewedOn
            });

            // Update task status (and keep reviewerStatus in sync for legacy UI)
            await UPDATE(TASK).set({
                status: newTaskStatus,
                reviewerStatus: decision === 'Reviewed' ? 'Reviewed' : 'Issue Found',
                statusUpdatedAt: reviewedOn
            }).where({ taskId });

            // Notify the original assignee
            if (task.assignedTo_employeeId) {
                const title = decision === 'Reviewed' ? 'Task Reviewed ✓' : 'Issue Found — please rework';
                const msg = decision === 'Reviewed'
                    ? `"${task.taskName || taskId}" was reviewed by ${reviewer.employeeName} and marked Completed.`
                    : `"${task.taskName || taskId}" was returned by ${reviewer.employeeName}. Reason: ${String(remarks).trim().slice(0, 200)}`;
                await createNotification(
                    task.assignedTo_employeeId,
                    decision === 'Reviewed' ? 'TASK_ASSIGNED' : 'TASK_ASSIGNED',
                    title, msg, taskId
                );
            }

            cds.log('task').info(`Task ${taskId} review submitted: ${decision} by ${reviewer.employeeId} → status ${newTaskStatus}`);
            return { reviewId, taskId, status: newTaskStatus };
        };

        this.on('submitReview', (req) => handleReviewDecision(req, 'Reviewed'));
        this.on('reportIssue', (req) => handleReviewDecision(req, 'IssueFound'));

        // Fetch the latest review for a task (no attachment payload — use getReviewAttachment).
        this.on('getTaskReview', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const reviews = await SELECT.from(TASK_REVIEW)
                .where({ task_taskId: taskId })
                .orderBy('reviewedOn desc')
                .limit(1);
            const r = reviews && reviews[0];
            if (!r) return {};
            let reviewerName = '';
            if (r.reviewer_employeeId) {
                const e = await SELECT.one.from(EMPLOYEE)
                    .columns('employeeName')
                    .where({ employeeId: r.reviewer_employeeId });
                reviewerName = (e && e.employeeName) || '';
            }
            return {
                reviewId: r.reviewId || '',
                reviewerId: r.reviewer_employeeId || '',
                reviewerName,
                decision: r.decision || '',
                remarks: r.remarks || '',
                attachmentName: r.attachmentName || '',
                reviewedOn: r.reviewedOn ? new Date(r.reviewedOn).toISOString() : ''
            };
        });

        // Stream a review attachment as base64 (mirrors consumeTaskAttachment pattern).
        this.on('getReviewAttachment', async (req) => {
            const { reviewId } = req.data;
            if (!reviewId) return req.error(400, 'reviewId is required.');
            const r = await SELECT.one.from(TASK_REVIEW)
                .columns('reviewId', 'attachment', 'attachmentName', 'attachmentMimeType')
                .where({ reviewId });
            if (!r) return req.error(404, `Review '${reviewId}' not found.`);
            if (!r.attachment) return req.error(404, 'No attachment on this review.');
            let base64 = '';
            try {
                const a = r.attachment;
                if (Buffer.isBuffer(a)) base64 = a.toString('base64');
                else if (typeof a === 'string') base64 = a;
                else if (a instanceof Uint8Array) base64 = Buffer.from(a).toString('base64');
                else base64 = Buffer.from(a).toString('base64');
            } catch (e) {
                return req.error(500, 'Could not read attachment.');
            }
            return {
                fileName: r.attachmentName || 'attachment',
                mimeType: r.attachmentMimeType || 'application/octet-stream',
                dataBase64: base64
            };
        });

        await registerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

class ManagerService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'Manager' scope AND EmployeeMaster.role === 'manager'.
        this.before('*', requireMatchingRole('manager'));
        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        // Issue 4: a manager may create an INDIVIDUAL task only for an employee who
        // reports directly to them and is active. Enforced at the data layer so it
        // holds even if the UI is bypassed (direct OData CREATE on /manager/Tasks).
        this.before('CREATE', 'Tasks', async (req) => {
            const assigneeId = req.data && req.data.assignedTo_employeeId;
            if (!assigneeId) return;                       // unassigned drafts are unaffected
            const err = await this._assertAssignable(req, assigneeId);
            if (err) return req.reject(403, err);
        });

        this.on('approveTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (header.status !== 'Pending') return req.error(400, `Cannot approve — current status is '${header.status}'.`);
            // Issue 4: only the employee's assigned manager may approve.
            if (!(await this._managesEmployee(req, header.employee_employeeId))) {
                return req.error(403, 'You are not authorised to approve this timesheet.');
            }
            await UPDATE(HEADER).set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
            const hdr = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr) await createNotification(hdr.employee_employeeId, 'TIMESHEET_APPROVED', 'Timesheet Approved ✓', `Your timesheet ${timesheetId} has been approved.${remarks ? ' Remarks: ' + remarks : ''}`, timesheetId);
            await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Approved' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' approved.`;
        });

        this.on('submitPerformanceRating', async (req) => {
            const { employeeId, ratingValue, reviewMonth, reviewYear, reviewComment, ratingCategory } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            if (!ratingValue) return req.error(400, 'ratingValue is required.');
            if (!reviewMonth) return req.error(400, 'reviewMonth is required.');
            if (!reviewYear) return req.error(400, 'reviewYear is required.');

            // ── Validate manager is rating their own team member ──
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;
            if (!manager) return req.error(403, 'Manager record not found.');

            const emp = await SELECT.one.from(EMPLOYEE)
                .where({ employeeId, manager_employeeId: manager.employeeId, isActive: true });
            if (!emp) return req.error(403, `You are not authorised to rate employee '${employeeId}'.`);
            // ─────────────────────────────────────────────────────

            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const period = `${MN[reviewMonth] || reviewMonth} ${reviewYear}`;

            // Issue 5: one rating per employee per month — never overwrite history.
            const existing = await SELECT.one.from(PERF).where({ employee_employeeId: employeeId, reviewMonth, reviewYear });
            if (existing) {
                return req.error(409, `Rating for this employee has already been submitted for ${period}.`);
            }
            const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2, '0')}`;

            // Insert only. The deterministic ratingId is the primary key, so a
            // concurrent duplicate (race past the SELECT) fails here — caught and
            // surfaced as the same friendly "already submitted" message.
            try {
                await INSERT.into(PERF).entries({ ratingId, employee_employeeId: employeeId, ratingValue, reviewMonth, reviewYear, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' });
            } catch (e) {
                return req.error(409, `Rating for this employee has already been submitted for ${period}.`);
            }
            await createNotification(
                employeeId, 'PERFORMANCE_RATED', 'New Performance Rating ⭐',
                `${manager.employeeName || 'Your manager'} rated you ${ratingValue}/5` +
                    `${ratingCategory ? ' (' + ratingCategory + ')' : ''} for ${period}.` +
                    `${reviewComment ? ' Comment: ' + reviewComment : ''}`,
                ratingId
            );
            return { ratingId, message: `Rating submitted for ${employeeId} — ${reviewMonth}/${reviewYear}` };
        });

        
        this.on('notifyTaskAssignment', async (req) => {
            const { taskId, taskName, taskDescription, priority, dueDate, assigneeId } = req.data;
            const employee = await SELECT.one.from(EMPLOYEE).where({ employeeId: assigneeId });
            if (!employee) return req.error(404, `Employee '${assigneeId}' not found.`);
            if (!employee.email) return req.error(400, `Employee '${assigneeId}' has no email on file.`);
            const prefix = PRIORITY_PREFIX[priority] || `[${priority || 'Normal'} Priority]`;
            const subject = `${prefix} New task assigned: ${taskName}`;
            const body = `Hi ${employee.employeeName || ''},\n\nYou have been assigned a new task by your manager.\n\nTask ID:     ${taskId}\nTask:        ${taskName}\nPriority:    ${priority || 'Normal'}\n${dueDate ? `Due Date:    ${dueDate}\n` : ''}\nDescription:\n${taskDescription || '(no description)'}\n\nPlease open your Timesheet app to view the full details.\n\n— Timesheet System`;
            const from = process.env.SMTP_FROM || 'no-reply@timesheet.local';
            const mailer = getMailer();
            if (mailer) {
                try {
                    await mailer.sendMail({ from, to: employee.email, subject, text: body });
                    return { sent: true, recipient: employee.email, subject, message: 'Email sent.' };
                } catch (e) { cds.log('mail').error('Failed to send email:', e.message || e); }
            }
            await createNotification(assigneeId, 'TASK_ASSIGNED', `New Task: ${taskName}`, `You have been assigned "${taskName}" (${priority || 'Normal'} priority).`, taskId);
            cds.log('mail').info(`[Email simulated]\nFROM: ${from}\nTO: ${employee.email}\nSUBJECT: ${subject}\n${body}`);
            return { sent: false, recipient: employee.email, subject, message: 'SMTP not configured — email content was logged on the server.' };
        });

        this.on('rejectTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (header.status !== 'Pending') return req.error(400, `Cannot reject — current status is '${header.status}'.`);
            // Issue 4: only the employee's assigned manager may reject.
            if (!(await this._managesEmployee(req, header.employee_employeeId))) {
                return req.error(403, 'You are not authorised to reject this timesheet.');
            }
            await UPDATE(HEADER).set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
            const hdr2 = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr2) await createNotification(hdr2.employee_employeeId, 'TIMESHEET_REJECTED', 'Timesheet Returned ✗', `Your timesheet ${timesheetId} was returned.${remarks ? ' Reason: ' + remarks : ''}`, timesheetId);
            await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' rejected. Employee can edit and resubmit.`;
        });

        this.on('uploadTaskAttachment', async (req) => {
            const { taskId, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!fileName) return req.error(400, 'fileName is required.');
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');
            const exists = await SELECT.one.from(TASK).columns('taskId').where({ taskId });
            if (!exists) return req.error(404, `Task '${taskId}' not found.`);
            const cleaned = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
            let buf;
            try { buf = Buffer.from(cleaned, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            await UPDATE(TASK).set({ attachment: buf, attachmentName: fileName, attachmentMimeType: mimeType || 'application/octet-stream' }).where({ taskId });
            cds.log('attach').info(`Attachment '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return `Attachment uploaded for task '${taskId}'.`;
        });

        // Attach ONE document to a task. Called once per file, so a manager can
        // attach multiple documents to the same task. Stored in TaskDocument and
        // downloadable (non-destructively) by every assignee/reviewer.
        this.on('uploadTaskDocument', async (req) => {
            const { taskId, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!fileName) return req.error(400, 'fileName is required.');
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');
            const exists = await SELECT.one.from(TASK).columns('taskId').where({ taskId });
            if (!exists) return req.error(404, `Task '${taskId}' not found.`);
            let buf;
            try { buf = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            if (buf.length > 10 * 1024 * 1024) return req.error(400, 'Document exceeds the 10 MB limit.');

            const user = req.user || {};
            const callerEmail = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const uploader = callerEmail
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', callerEmail)
                : null;

            const documentId = `${taskId}-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_DOCUMENT).entries({
                documentId,
                task_taskId: taskId,
                fileName,
                mimeType: mimeType || 'application/octet-stream',
                fileSize: buf.length,
                content: buf,
                uploadedBy_employeeId: uploader ? uploader.employeeId : null
            });
            cds.log('attach').info(`Task document '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return { documentId };
        });

        // ── Create a group task + seed its assignees (manager only) ────────────
        this.on('createGroupTask', async (req) => {
            const d = req.data || {};
            const assignees = (d.assignees || []).filter(a => a && a.employeeId);
            if (!d.taskName || !d.taskName.trim()) return req.error(400, 'Task name is required.');
            // De-duplicate employee ids defensively.
            const seen = new Set();
            const uniq = assignees.filter(a => (seen.has(a.employeeId) ? false : (seen.add(a.employeeId), true)));
            if (uniq.length < 2) return req.error(400, 'Select at least 2 employees for a group task.');

            // Issue 4: every member must report directly to the caller and be active.
            // Backend-enforced so a forged request can't add unrelated employees.
            for (const a of uniq) {
                const err = await this._assertAssignable(req, a.employeeId);
                if (err) return req.error(403, err);
            }

            const taskId = await nextGroupTaskId();
            await INSERT.into(TASK).entries({
                taskId,
                taskName: d.taskName.trim(),
                taskDescription: (d.taskDescription || '').trim(),
                priority: d.priority || 'Medium',
                status: 'In Progress',
                taskType: 'group',
                startDate: d.startDate || null,
                dueDate: d.dueDate || null
            });

            for (const a of uniq) {
                await INSERT.into(TASK_ASSIGNEE).entries({
                    assignmentId: `${taskId}-AS-${a.employeeId}`,
                    task_taskId: taskId,
                    assignee_employeeId: a.employeeId,
                    status: 'pending',
                    note: a.note || null
                });
            }

            // Notify each assignee they were added to a group task.
            for (const a of uniq) {
                await createNotification(a.employeeId, 'GROUP_TASK_ASSIGNED', 'New group task',
                    `You've been added to the group task “${d.taskName.trim()}”.`, taskId);
            }

            cds.log('group').info(`Group task ${taskId} created with ${uniq.length} assignees`);
            return { taskId };
        });

        this.on('approveLeave', async (req) => {
            const { leaveId, approved, remarks } = req.data;
            if (!leaveId) return req.error(400, 'leaveId is required.');
            const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
            if (!leave) return req.error(404, `Leave request '${leaveId}' not found.`);
            if (leave.status !== 'Pending') return req.error(400, `Leave is already '${leave.status}'.`);
            const newStatus = approved ? 'Approved' : 'Rejected';
            await UPDATE(LEAVE_REQUEST).set({ status: newStatus, managerRemarks: remarks || '', approvedOn: new Date() }).where({ leaveId });

            // Issue 2: in-app notification to the employee (always — independent of SMTP).
            await createNotification(
                leave.employee_employeeId,
                approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                approved ? 'Leave Approved ✓' : 'Leave Rejected ✗',
                approved
                    ? `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was approved.${remarks ? ' Remarks: ' + remarks : ''}`
                    : `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was rejected.${remarks ? ' Reason: ' + remarks : ''}`,
                leaveId
            );

            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId: leave.employee_employeeId });
            if (emp && emp.email) {
                const mailer = getMailer();
                const subject = `Your leave request has been ${newStatus}`;
                const body = `Hi ${emp.employeeName || ''},\n\nYour leave request has been ${newStatus.toLowerCase()} by your manager.\n\nLeave Type : ${leave.leaveType}\nFrom       : ${leave.fromDate}\nTo         : ${leave.toDate}\nDays       : ${leave.days}\n${remarks ? `Remarks    : ${remarks}\n` : ''}\n— Timesheet System`;
                if (mailer) {
                    try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: emp.email, subject, text: body }); }
                    catch (e) { cds.log('mail').warn('Leave approval email failed:', e.message); }
                } else { cds.log('leave').info(`[Email simulated] TO: ${emp.email}\n${body}`); }
            }
            cds.log('leave').info(`Leave ${leaveId} ${newStatus} by manager`);
            return { leaveId, status: newStatus };
        });
        // read manager associated employees for Employee Management and Team Attendance features
        this.on('READ', 'Employees', async (req) => {
            // Resolve logged-in manager from email
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();

            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;

            if (!manager) return req.error(404, 'Manager record not found.');

            // Return only employees reporting to this manager
            return await SELECT.from(EMPLOYEE)
                .columns('employeeId', 'employeeName', 'designation', 'email', 'isActive')
                .where({
                    manager_employeeId: manager.employeeId,
                    isActive: true
                })
                .orderBy('employeeName');
        });

        // ── Issue 4: strict manager-scoped visibility ─────────────────────────
        // The projections (PendingApprovals / PrevWeekRequests / LeaveRequests)
        // had no manager filter, so EVERY manager could see (and act on) other
        // managers' employees' requests. These before-READ hooks restrict every
        // read to the logged-in manager's own team. Using req.query.where keeps
        // OData $expand / paging / the projection's status filter intact.
        const _resolveManager = async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            return email
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email)
                : null;
        };
        const _teamIdsOf = async (managerId) => {
            const rows = await SELECT.from(EMPLOYEE).columns('employeeId')
                .where({ manager_employeeId: managerId });
            return rows.map(r => r.employeeId);
        };
        // Impossible value → guarantees an empty result set (avoids `IN ()`).
        const NO_MATCH = '___no_manager_match___';

        // Timesheet approvals: header has no manager field → scope via the
        // employee's manager (the manager's direct-report ids).
        this.before('READ', 'PendingApprovals', async (req) => {
            const mgr = await _resolveManager(req);
            if (!mgr) { req.query.where('employee_employeeId =', NO_MATCH); return; }
            const ids = await _teamIdsOf(mgr.employeeId);
            req.query.where('employee_employeeId in', ids.length ? ids : [NO_MATCH]);
        });

        // Leave requests: same scoping via the employee's manager.
        this.before('READ', 'LeaveRequests', async (req) => {
            const mgr = await _resolveManager(req);
            if (!mgr) { req.query.where('employee_employeeId =', NO_MATCH); return; }
            const ids = await _teamIdsOf(mgr.employeeId);
            req.query.where('employee_employeeId in', ids.length ? ids : [NO_MATCH]);
        });

        // Prev-week requests store the target manager directly → strict routing:
        // only the manager the request was assigned to can see it.
        this.before('READ', 'PrevWeekRequests', async (req) => {
            const mgr = await _resolveManager(req);
            req.query.where('manager_employeeId =', mgr ? mgr.employeeId : NO_MATCH);
        });

        // ── Team Attendance grid ──────────────────────────────────────────
        // Returns a per-employee, per-day status grid for the manager's team
        // for the requested month.  Cell statuses:
        //   P   = Present  (attendance record exists)
        //   A   = Absent   (working day, no attendance, no leave)
        //   H   = Holiday  (matches HolidayMaster row)
        //   W   = Weekend  (Saturday/Sunday)
        //   CL  = Casual Leave  (approved)
        //   SL  = Sick Leave    (approved)
        //   PL  = Paid Leave    (approved)
        //   ML  = Maternity Leave (approved)
        //   PtL = Paternity Leave (approved)
        this.on('getTeamAttendance', async (req) => {
            const { year, month } = req.data;
            if (!year || !month) return req.error(400, 'year and month are required.');
            if (month < 1 || month > 12) return req.error(400, 'month must be 1-12.');

            // 1. Resolve the logged-in manager
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;
            if (!manager) return req.error(404, 'Manager record not found.');

            // 2. All direct reports (active)
            const team = await SELECT.from(EMPLOYEE)
                .columns('employeeId', 'employeeName', 'designation', 'email')
                .where({ manager_employeeId: manager.employeeId, isActive: true });
            team.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

            if (!team.length) {
                return { employees: '[]', holidays: '[]', daysInMonth: new Date(year, month, 0).getDate() };
            }
            const teamIds = team.map(e => e.employeeId);

            // 3. Month boundaries (use UTC-aligned ISO dates so timezone never shifts a day)
            const daysInMonth = new Date(year, month, 0).getDate();
            const pad = (n) => String(n).padStart(2, '0');
            const isoStart = `${year}-${pad(month)}-01`;
            const isoEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;

            // 4. Fetch all relevant data in parallel
            const [attendance, leaves, holidays] = await Promise.all([
                SELECT.from(ATTENDANCE).where({ employee_employeeId: { in: teamIds } }),
                SELECT.from(LEAVE_REQUEST).where({ employee_employeeId: { in: teamIds }, status: 'Approved' }),
                SELECT.from(HOLIDAY)
            ]);

            // 5. Index attendance: empId → date → { time }
            const attMap = new Map();
            for (const a of attendance) {
                const dt = String(a.attendanceDate || '').slice(0, 10);
                if (dt < isoStart || dt > isoEnd) continue;
                if (!attMap.has(a.employee_employeeId)) attMap.set(a.employee_employeeId, new Map());
                attMap.get(a.employee_employeeId).set(dt, { time: a.attendanceTime || '' });
            }

            // 6. Index leaves: empId → date → leaveCode
            const leaveCode = (t) => {
                const lc = String(t || '').toLowerCase();
                if (lc.includes('casual')) return 'CL';
                if (lc.includes('sick')) return 'SL';
                if (lc.includes('paternity')) return 'PtL';
                if (lc.includes('maternity')) return 'ML';
                if (lc.includes('paid')) return 'PL';
                return 'L';
            };
            const leaveMap = new Map();
            for (const l of leaves) {
                const code = leaveCode(l.leaveType);
                const from = String(l.fromDate || '').slice(0, 10);
                const to = String(l.toDate || '').slice(0, 10);
                if (!from || !to) continue;
                // Walk each calendar date in the leave range that falls in this month.
                const startD = new Date(`${from}T00:00:00Z`);
                const endD = new Date(`${to}T00:00:00Z`);
                for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
                    const key = d.toISOString().slice(0, 10);
                    if (key < isoStart || key > isoEnd) continue;
                    if (!leaveMap.has(l.employee_employeeId)) leaveMap.set(l.employee_employeeId, new Map());
                    leaveMap.get(l.employee_employeeId).set(key, code);
                }
            }

            // 7. Index holidays: date → name (only those in this month)
            const holidayMap = new Map();
            for (const h of holidays) {
                const dt = String(h.holidayDate || '').slice(0, 10);
                if (dt >= isoStart && dt <= isoEnd) holidayMap.set(dt, h.holidayName);
            }

            // 8. Build per-employee day grid
            // "today" is computed once per request so the grid renders
            // future dates as a neutral "F" (no entry yet) rather than "A".
            const todayIso = new Date().toISOString().slice(0, 10);

            const result = team.map(emp => {
                const days = [];
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `${year}-${pad(month)}-${pad(d)}`;
                    const dow = new Date(`${key}T00:00:00Z`).getUTCDay(); // 0=Sun 6=Sat
                    let status, time = '';
                    if (holidayMap.has(key)) {
                        status = 'H';
                    } else if (dow === 0 || dow === 6) {
                        status = 'W';
                    } else if (key > todayIso) {
                        // Future working day — no entry yet, render as blank/grey.
                        status = 'F';
                    } else {
                        const att = attMap.get(emp.employeeId) && attMap.get(emp.employeeId).get(key);
                        if (att) {
                            status = 'P';
                            time = att.time || '';
                        } else {
                            const lv = leaveMap.get(emp.employeeId) && leaveMap.get(emp.employeeId).get(key);
                            status = lv || 'A';
                        }
                    }
                    days.push({ date: key, status, time });
                }
                return {
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName || '',
                    designation: emp.designation || '',
                    email: emp.email || '',
                    days
                };
            });

            const holidayArr = Array.from(holidayMap.entries())
                .map(([date, name]) => ({ date, name }))
                .sort((a, b) => a.date.localeCompare(b.date));

            return {
                employees: JSON.stringify(result),
                holidays: JSON.stringify(holidayArr),
                daysInMonth
            };
        });

        await registerManagerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }

    // Issue 4: true only when the logged-in manager is the assigned manager of
    // the given employee. Used to gate approve/reject so a manager can never act
    // on another team's request, even via a direct API call.
    async _managesEmployee(req, sEmployeeId) {
        if (!sEmployeeId) return false;
        const user = req.user || {};
        const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
        if (!email) return false;
        const manager = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
        if (!manager) return false;
        const emp = await SELECT.one.from(EMPLOYEE)
            .columns('manager_employeeId').where({ employeeId: sEmployeeId });
        return !!(emp && emp.manager_employeeId === manager.employeeId);
    }

    // Issue 4: validate that the caller (a manager) may assign a task to
    // `employeeId`. The employee must exist, be active, AND report directly to the
    // caller. Returns null when allowed, otherwise a user-facing error message.
    // Used by both the individual-task CREATE guard and createGroupTask so the rule
    // is identical for solo and group assignment.
    async _assertAssignable(req, employeeId) {
        if (!employeeId) return 'An assignee is required.';
        const user = req.user || {};
        const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
        const manager = email
            ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email)
            : null;
        if (!manager) return 'Could not resolve your manager account.';
        const emp = await SELECT.one.from(EMPLOYEE)
            .columns('employeeId', 'manager_employeeId', 'isActive')
            .where({ employeeId });
        if (!emp) return `Employee '${employeeId}' not found.`;
        if (emp.isActive === false) return `Employee '${employeeId}' is inactive.`;
        if (emp.manager_employeeId !== manager.employeeId) {
            return 'You can only assign tasks to employees associated with your account.';
        }
        return null;
    }
}

const DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeDocument';
class HRService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'HR' scope AND EmployeeMaster.role === 'hr'.
        this.before('*', requireMatchingRole('hr'));
        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        const generateEmployeeId = async () => {
            const rows = await SELECT.from(EMPLOYEE).columns('employeeId');
            const max = rows.reduce((m, r) => { const n = parseInt(String(r.employeeId || '').replace(/\D/g, ''), 10); return Number.isFinite(n) && n > m ? n : m; }, 1000);
            return 'EMP' + (max + 1);
        };

        this.on('nextEmployeeId', async () => await generateEmployeeId());

        this.on('addEmployee', async (req) => {
            const d = req.data || {};
            if (!d.employeeName) return req.error(400, 'employeeName is required.');
            if (!d.email) return req.error(400, 'email is required.');
            // Identity is resolved by matching the IdP-asserted email against this
            // column on every request, so store a single canonical form (trimmed,
            // lower-cased). Without this, a mismatched case means login works but
            // no per-user data (dashboard tiles, anniversary, leave…) ever resolves.
            const normEmail = String(d.email).trim().toLowerCase();
            const dup = await SELECT.one.from(EMPLOYEE).where('lower(email) =', normEmail);
            if (dup) return req.error(409, `An employee with email '${normEmail}' already exists.`);
            // Authoritative role — normalised to a canonical lowercase value so the
            // login/authorization checks match (e.g. 'HR' → 'hr'). Defaults to
            // 'employee' when omitted or invalid, never an elevated role.
            const role = normalizeRole(d.role) || 'employee';
            const newId = await generateEmployeeId();
            await INSERT.into(EMPLOYEE).entries({
                employeeId: newId, employeeName: d.employeeName, designation: d.designation || null, role,
                email: normEmail, address: d.address || null, mobileNumber: d.mobileNumber || null,
                manager_employeeId: d.managerEmployeeId || null, isActive: true,
                dateOfBirth: d.dateOfBirth || null, gender: d.gender || null, department: d.department || null,
                joiningDate: d.joiningDate || null, employmentType: d.employmentType || null,
                aadhaarNumber: d.aadhaarNumber || null, panNumber: d.panNumber || null, status: 'Active',
                emergencyContact: d.emergencyContact || null, bloodGroup: d.bloodGroup || null,
                bankAccountNumber: d.bankAccountNumber || null, bankName: d.bankName || null, bankIfsc: d.bankIfsc || null
            });
            cds.log('hr').info(`HR created employee ${newId} (${d.employeeName})`);
            return { employeeId: newId };
        });

        this.on('uploadEmployeeDocument', async (req) => {
            const { employeeId, documentType, fileName, mimeType, description, dataBase64 } = req.data;
            if (!employeeId || !fileName || !dataBase64) return req.error(400, 'employeeId, fileName and dataBase64 are required.');
            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            let buf;
            try { buf = Buffer.from(dataBase64, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            const documentId = `${employeeId}-DOC-${Date.now()}`;
            await INSERT.into(DOCUMENT).entries({ documentId, employee_employeeId: employeeId, documentType: documentType || 'Other', fileName, mimeType: mimeType || 'application/octet-stream', description: description || null, content: buf });
            cds.log('hr').info(`Uploaded ${fileName} (${buf.length} bytes) for ${employeeId}`);
            return documentId;
        });

        this.on('getEmployeeDocument', async (req) => {
            const { documentId } = req.data;
            if (!documentId) return req.error(400, 'documentId is required.');
            const doc = await SELECT.one.from(DOCUMENT).columns('documentId', 'fileName', 'mimeType', 'content').where({ documentId });
            if (!doc) return req.error(404, `Document '${documentId}' not found.`);
            if (!doc.content) return req.error(404, 'Document has no content.');
            let dataBase64 = '';
            try {
                const content = doc.content;
                if (Buffer.isBuffer(content)) dataBase64 = content.toString('base64');
                else if (content instanceof Uint8Array) dataBase64 = Buffer.from(content).toString('base64');
                else if (typeof content === 'string') dataBase64 = content; // legacy base64 text
                else if (content && typeof content.pipe === 'function') {
                    // CAP returns LargeBinary as a Readable stream via CQN (both
                    // SQLite and HANA). Must consume it into a Buffer — the old
                    // Buffer.from(stream) failed, causing "Could not download".
                    const chunks = [];
                    for await (const chunk of content) chunks.push(chunk);
                    dataBase64 = Buffer.concat(chunks).toString('base64');
                } else {
                    dataBase64 = Buffer.from(content).toString('base64');
                }
            } catch (e) {
                cds.log('hr').error('Could not read document:', e.message);
                return req.error(500, 'Could not read document.');
            }
            if (!dataBase64) return req.error(404, 'Document has no content.');
            return { fileName: doc.fileName, mimeType: doc.mimeType || 'application/octet-stream', dataBase64 };
        });

        // ── Activate / deactivate an employee ─────────────────────────────────
        this.on('setEmployeeStatus', async (req) => {
            const { employeeId, isActive } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            const status = isActive ? 'Active' : 'Inactive';
            await UPDATE(EMPLOYEE).set({ isActive: !!isActive, status }).where({ employeeId });
            cds.log('hr').info(`Employee ${employeeId} set ${status} by HR`);
            return { employeeId, isActive: !!isActive, status };
        });

        // ── Inline edit of an employee's profile fields ───────────────────────
        // Only fields that are actually provided (non-null/non-undefined) are
        // applied, so the drawer can send partial updates without wiping data.
        this.on('updateEmployee', async (req) => {
            const d = req.data || {};
            if (!d.employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ employeeId: d.employeeId });
            if (!emp) return req.error(404, `Employee '${d.employeeId}' not found.`);

            // Email uniqueness guard (if email is being changed). Normalize to the
            // same canonical form used for identity resolution on every request.
            if (d.email) {
                d.email = String(d.email).trim().toLowerCase();
                const dup = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', d.email);
                if (dup && dup.employeeId !== d.employeeId) {
                    return req.error(409, `Another employee already uses email '${d.email}'.`);
                }
            }

            const patch = {};
            const map = {
                employeeName: 'employeeName', designation: 'designation', email: 'email',
                address: 'address', mobileNumber: 'mobileNumber', department: 'department',
                employmentType: 'employmentType', emergencyContact: 'emergencyContact',
                managerEmployeeId: 'manager_employeeId'
            };
            Object.keys(map).forEach(k => {
                if (d[k] !== undefined && d[k] !== null) patch[map[k]] = d[k];
            });
            // Role is normalised to a canonical value; an invalid value is ignored
            // (left unchanged) rather than silently downgrading the employee.
            if (d.role !== undefined && d.role !== null && d.role !== '') {
                const nr = normalizeRole(d.role);
                if (!nr) return req.error(400, `Invalid role '${d.role}'. Allowed: ${VALID_ROLES.join(', ')}.`);
                patch.role = nr;
            }
            if (!Object.keys(patch).length) return { employeeId: d.employeeId, message: 'Nothing to update.' };

            await UPDATE(EMPLOYEE).set(patch).where({ employeeId: d.employeeId });
            cds.log('hr').info(`Employee ${d.employeeId} updated by HR (${Object.keys(patch).join(', ')})`);
            return { employeeId: d.employeeId, message: 'Employee updated successfully.' };
        });

        // ── Reset password ────────────────────────────────────────────────────
        // Identities are managed by the IdP (XSUAA in prod, mocked in dev) — there
        // is no local password store, so we return an informative message.
        this.on('resetEmployeePassword', async (req) => {
            const { employeeId } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'email').where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            return {
                success: false,
                message: `Passwords are managed by the identity provider. Please trigger a reset for ${emp.email || employeeId} from the IdP / SAP BTP cockpit.`
            };
        });

        await registerHRTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FOUNDER ANALYTICS  —  whole-org executive metrics computed live from the
//  CDS entities. Heavy lifting is done in JS (DB-portable) over modest data.
// ═════════════════════════════════════════════════════════════════════════════
function _monKey(y, m) { return y + '-' + String(m).padStart(2, '0'); }
function _last6Months() {
    const out = []; const d = new Date();
    for (let i = 5; i >= 0; i--) {
        const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push({ y: dd.getFullYear(), m: dd.getMonth() + 1,
            label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dd.getMonth()] });
    }
    return out;
}
function _mondayISO(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
}
function _pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function _avg(arr) { return arr.length ? (arr.reduce((s, x) => s + x, 0) / arr.length) : 0; }
function _healthStatus(score) {
    return score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';
}
function _heatColor(score) { return score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red'; }

async function loadFounderData() {
    const [emps, tasks, leaves, headers, ratings] = await Promise.all([
        SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'designation', 'department', 'isActive', 'status', 'joiningDate'),
        SELECT.from(TASK).columns('taskId', 'taskName', 'taskDescription', 'status', 'assignedTo_employeeId', 'dueDate', 'priority', 'statusUpdatedAt', 'taskType'),
        SELECT.from(LEAVE_REQUEST).columns('leaveId', 'employee_employeeId', 'leaveType', 'days', 'status', 'fromDate'),
        SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId', 'status', 'weekStartDate', 'submittedOn'),
        SELECT.from(PERFORMANCE_RATING).columns('ratingId', 'employee_employeeId', 'ratingValue', 'reviewMonth', 'reviewYear', 'ratingCategory', 'reviewComment')
    ]);
    return { emps: emps || [], tasks: tasks || [], leaves: leaves || [], headers: headers || [], ratings: ratings || [] };
}

// Latest rating value per employee, plus a current/previous month average.
function ratingStats(ratings, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const rs = ratings.filter(r => !setIds || setIds.has(r.employee_employeeId));
    const latestByEmp = {};
    rs.forEach(r => {
        const k = r.employee_employeeId;
        const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0);
        if (!latestByEmp[k] || ord > latestByEmp[k].ord) latestByEmp[k] = { ord, val: parseFloat(r.ratingValue) || 0 };
    });
    const latestVals = Object.values(latestByEmp).map(x => x.val).filter(v => v > 0);
    const current = +(_avg(latestVals)).toFixed(2);
    // previous = avg of ratings from the previous calendar month
    const now = new Date(); const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevVals = rs.filter(r => r.reviewYear === pm.getFullYear() && r.reviewMonth === (pm.getMonth() + 1))
        .map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const previous = +(_avg(prevVals)).toFixed(2) || +(current * 0.96).toFixed(2);
    const growthPct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
    return { current, previous, growthPct };
}

function taskStats(tasks, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ts = tasks.filter(t => !setIds || setIds.has(t.assignedTo_employeeId));
    const today = new Date().toISOString().slice(0, 10);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    let completed = 0, inProgress = 0, pending = 0, overdue = 0;
    ts.forEach(t => {
        const s = norm(t.status);
        const isDone = (s === 'completed');
        if (!isDone && t.dueDate && String(t.dueDate).slice(0, 10) < today) { overdue++; return; }
        if (isDone) completed++;
        else if (s === 'inprogress' || s === 'inreview') inProgress++;
        else pending++;
    });
    const total = ts.length;
    return {
        total, completed, inProgress, pending, overdue,
        completedPct: _pct(completed, total), inProgressPct: _pct(inProgress, total),
        pendingPct: _pct(pending, total), overduePct: _pct(overdue, total)
    };
}

function timesheetCompliance(headers, activeEmpIds) {
    const week = _mondayISO(new Date());
    const submittedStatuses = new Set(['Submitted', 'Pending', 'Approved', 'AutoApproved']);
    const submittedSet = new Set(
        headers.filter(h => String(h.weekStartDate).slice(0, 10) === week && submittedStatuses.has(h.status))
            .map(h => h.employee_employeeId)
    );
    const expected = activeEmpIds.length;
    const submitted = activeEmpIds.filter(id => submittedSet.has(id)).length;
    const missing = Math.max(0, expected - submitted);
    return { submitted, missing, expected, submittedPct: _pct(submitted, expected), missingPct: _pct(missing, expected), submittedSet };
}

function leaveStats(leaves, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ls = leaves.filter(l => (!setIds || setIds.has(l.employee_employeeId)) && l.status === 'Approved');
    const cat = { Casual: 0, Sick: 0, Earned: 0, Other: 0 };
    const usedByEmp = {};
    ls.forEach(l => {
        const d = Number(l.days) || 0;
        usedByEmp[l.employee_employeeId] = (usedByEmp[l.employee_employeeId] || 0) + d;
        const t = String(l.leaveType || '').toLowerCase();
        if (t.includes('casual')) cat.Casual += d;
        else if (t.includes('sick')) cat.Sick += d;
        else if (t.includes('paid') || t.includes('earned') || t.includes('annual')) cat.Earned += d;
        else cat.Other += d;
    });
    const totalUsed = cat.Casual + cat.Sick + cat.Earned + cat.Other;
    const ANNUAL_QUOTA = 21; // per employee
    const totalQuota = Math.max(1, (empIds ? empIds.length : Object.keys(usedByEmp).length || 1) * ANNUAL_QUOTA);
    const usedPct = Math.min(100, _pct(totalUsed, totalQuota));
    return { byType: cat, totalUsed, usedPct, availablePct: 100 - usedPct, usedByEmp };
}

function ratingTrend(ratings, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const rs = ratings.filter(r => !setIds || setIds.has(r.employee_employeeId));
    const byMon = {};
    rs.forEach(r => {
        const k = _monKey(r.reviewYear || 0, r.reviewMonth || 0);
        (byMon[k] = byMon[k] || []).push(parseFloat(r.ratingValue) || 0);
    });
    return _last6Months().map(mm => {
        const k = _monKey(mm.y, mm.m);
        const v = byMon[k] ? +(_avg(byMon[k])).toFixed(2) : null;
        return { label: mm.label, value: v };
    });
}

function taskCompletionTrend(tasks, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ts = tasks.filter(t => !setIds || setIds.has(t.assignedTo_employeeId));
    const total = Math.max(1, ts.length);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    return _last6Months().map(mm => {
        const monthEnd = new Date(mm.y, mm.m, 0).toISOString().slice(0, 10);
        const doneBy = ts.filter(t => norm(t.status) === 'completed' &&
            (!t.statusUpdatedAt || String(t.statusUpdatedAt).slice(0, 10) <= monthEnd)).length;
        return { label: mm.label, value: _pct(doneBy, total) };
    });
}

function departmentBreakdown(data) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const activeIds = emps.filter(e => e.isActive !== false).map(e => e.employeeId);
    const depMap = {};
    emps.forEach(e => {
        const dep = (e.department || 'Unassigned').trim() || 'Unassigned';
        (depMap[dep] = depMap[dep] || []).push(e);
    });
    const comp = timesheetCompliance(headers, activeIds);
    return Object.keys(depMap).map(dep => {
        const list = depMap[dep];
        const ids = list.map(e => e.employeeId);
        const rstat = ratingStats(ratings, ids);
        const tstat = taskStats(tasks, ids);
        const deptActive = ids.filter(id => list.find(e => e.employeeId === id && e.isActive !== false));
        const deptSubmitted = ids.filter(id => comp.submittedSet.has(id)).length;
        const tsPct = _pct(deptSubmitted, Math.max(1, ids.filter(id => list.find(e => e.employeeId === id && e.isActive !== false)).length));
        const health = Math.round(
            0.35 * (rstat.current / 5 * 100) + 0.35 * tstat.completedPct + 0.30 * tsPct
        );
        return {
            department: dep,
            employees: list.length,
            active: list.filter(e => e.isActive !== false).length,
            avgRating: rstat.current,
            taskCompletion: tstat.completedPct,
            timesheetCompliance: tsPct,
            healthScore: health,
            status: _heatStatusLabel(health)
        };
    }).sort((a, b) => b.healthScore - a.healthScore);
}
function _heatStatusLabel(s) { return s >= 80 ? 'Excellent' : s >= 60 ? 'Needs Attention' : 'Critical'; }

function buildOverall(data) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const total = emps.length;
    const active = emps.filter(e => e.isActive !== false).length;
    const inactive = total - active;
    const activeIds = emps.filter(e => e.isActive !== false).map(e => e.employeeId);
    const activePct = _pct(active, total);

    const rstat = ratingStats(ratings);
    const tstat = taskStats(tasks);
    const comp = timesheetCompliance(headers, activeIds);
    const lstat = leaveStats(leaves, emps.map(e => e.employeeId));

    const productivityScore = Math.round(0.5 * tstat.completedPct + 0.3 * comp.submittedPct + 0.2 * (rstat.current / 5 * 100));
    const leaveBalancePct = lstat.availablePct;
    const healthScore = Math.round(
        0.30 * (rstat.current / 5 * 100) + 0.25 * tstat.completedPct +
        0.20 * comp.submittedPct + 0.10 * leaveBalancePct + 0.15 * activePct
    );

    const depts = departmentBreakdown(data);
    const deptNames = Array.from(new Set(emps.map(e => (e.department || 'Unassigned').trim() || 'Unassigned')));

    // Risk center
    const today = new Date().toISOString().slice(0, 10);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const overdueTasks = tasks.filter(t => norm(t.status) !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today).length;
    const excessiveLeave = Object.entries(lstat.usedByEmp).filter(([id, d]) => d > 15)
        .map(([id]) => { const e = emps.find(x => x.employeeId === id); return e ? e.employeeName : id; });
    const lowDepts = depts.filter(d => d.healthScore < 60).map(d => d.department);

    const leadDept = depts[0] ? depts[0].department : '—';
    const highestLeaveDept = (() => {
        const byDept = {};
        emps.forEach(e => { const dep = (e.department || 'Unassigned').trim() || 'Unassigned'; byDept[dep] = byDept[dep] || 0; });
        Object.entries(lstat.usedByEmp).forEach(([id, d]) => {
            const e = emps.find(x => x.employeeId === id); if (!e) return;
            const dep = (e.department || 'Unassigned').trim() || 'Unassigned'; byDept[dep] = (byDept[dep] || 0) + d;
        });
        const top = Object.entries(byDept).sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : '—';
    })();

    const aiInsight =
        `There are currently ${active} active employees across ${deptNames.length} department${deptNames.length !== 1 ? 's' : ''}. ` +
        `Organization-wide task completion stands at ${tstat.completedPct}%, while timesheet compliance remains ${comp.submittedPct >= 80 ? 'strong' : 'moderate'} at ${comp.submittedPct}%. ` +
        `Average employee rating is ${rstat.current.toFixed(2)}/5${rstat.growthPct ? `, ${rstat.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(rstat.growthPct)}% from last month` : ''}. ` +
        `The ${leadDept} department currently leads overall performance, while ${highestLeaveDept} has the highest leave utilization.`;

    return {
        employees: { total, active, inactive, activePct },
        rating: rstat,
        tasks: tstat,
        timesheet: { submitted: comp.submitted, missing: comp.missing, submittedPct: comp.submittedPct, missingPct: comp.missingPct },
        leave: { usedPct: lstat.usedPct, availablePct: lstat.availablePct, totalUsed: lstat.totalUsed, byType: lstat.byType },
        productivityScore,
        healthScore, healthStatus: _healthStatus(healthScore), healthTrendPct: rstat.growthPct,
        aiInsight,
        performanceTrend: ratingTrend(ratings),
        taskCompletionTrend: taskCompletionTrend(tasks),
        taskStatusDistribution: { completed: tstat.completed, inProgress: tstat.inProgress, pending: tstat.pending, overdue: tstat.overdue },
        leaveAnalytics: lstat.byType,
        departmentRanking: depts.map(d => ({ department: d.department, rating: d.avgRating, taskCompletion: d.taskCompletion, timesheetCompliance: d.timesheetCompliance, healthScore: d.healthScore })),
        heatmap: depts.map(d => ({ department: d.department, healthScore: d.healthScore, color: _heatColor(d.healthScore), status: d.status })),
        topDepartments: depts.slice(0, 5).map((d, i) => ({ rank: i + 1, department: d.department, healthScore: d.healthScore, taskCompletion: d.taskCompletion, avgRating: d.avgRating })),
        riskCenter: {
            overdueTasks,
            missingTimesheets: comp.missing,
            lowPerformingDepartments: lowDepts,
            excessiveLeave,
            inactiveEmployees: inactive
        },
        departments: deptNames
    };
}

function buildDepartment(data, department) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const list = emps.filter(e => ((e.department || 'Unassigned').trim() || 'Unassigned') === department);
    const ids = list.map(e => e.employeeId);
    const activeIds = list.filter(e => e.isActive !== false).map(e => e.employeeId);
    const rstat = ratingStats(ratings, ids);
    const tstat = taskStats(tasks, ids);
    const comp = timesheetCompliance(headers, activeIds);
    const lstat = leaveStats(leaves, ids);

    // Latest rating per employee for top/bottom performers
    const latestByEmp = {};
    ratings.filter(r => ids.includes(r.employee_employeeId)).forEach(r => {
        const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0);
        if (!latestByEmp[r.employee_employeeId] || ord > latestByEmp[r.employee_employeeId].ord)
            latestByEmp[r.employee_employeeId] = { ord, val: parseFloat(r.ratingValue) || 0 };
    });
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const today = new Date().toISOString().slice(0, 10);
    const perEmp = list.map(e => {
        const completed = tasks.filter(t => t.assignedTo_employeeId === e.employeeId && norm(t.status) === 'completed').length;
        return { employeeName: e.employeeName, rating: (latestByEmp[e.employeeId] || {}).val || 0, completedTasks: completed, isActive: e.isActive !== false };
    });
    const top5 = perEmp.slice().sort((a, b) => b.rating - a.rating || b.completedTasks - a.completedTasks).slice(0, 5);
    const lowRated = perEmp.filter(p => p.rating > 0 && p.rating < 3).map(p => p.employeeName);
    const overdueDept = tasks.filter(t => ids.includes(t.assignedTo_employeeId) && norm(t.status) !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today).length;

    return {
        department,
        overview: {
            total: list.length, active: list.filter(e => e.isActive !== false).length,
            avgRating: rstat.current, taskCompletionPct: tstat.completedPct,
            timesheetCompliancePct: comp.submittedPct, leaveUtilizationPct: lstat.usedPct
        },
        ratingTrend: ratingTrend(ratings, ids),
        taskCompletionTrend: taskCompletionTrend(tasks, ids),
        leaveAnalytics: lstat.byType,
        taskStatusDistribution: { completed: tstat.completed, inProgress: tstat.inProgress, pending: tstat.pending, overdue: tstat.overdue },
        // Roster for the employee drill-down picker (Founder → Department → Employee).
        employees: list.map(e => ({
            employeeId: e.employeeId, employeeName: e.employeeName,
            designation: e.designation || '', isActive: e.isActive !== false,
            rating: (latestByEmp[e.employeeId] || {}).val || 0,
            completedTasks: tasks.filter(t => t.assignedTo_employeeId === e.employeeId && norm(t.status) === 'completed').length
        })).sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
        top5,
        risk: {
            lowRated,
            pendingReviews: list.length - Object.keys(latestByEmp).length,
            overdueTasks: overdueDept,
            missingTimesheets: comp.missing
        }
    };
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTIVE EMPLOYEE ANALYTICS — strategic profile (no operational records).
// All metrics are derived live from Ratings / Tasks / Timesheets / Leave so the
// same formulas apply to an employee, a department and the whole company, making
// the benchmarks directly comparable. No new tables / entities.
// ════════════════════════════════════════════════════════════════════════════
const _TS_OK = new Set(['Submitted', 'Pending', 'Approved', 'AutoApproved', 'PrevWeekApproved']);
function _normStatus(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
function _lastNMondays(n) {
    const out = []; const base = new Date(_mondayISO(new Date()));
    for (let i = 0; i < n; i++) { const d = new Date(base); d.setDate(base.getDate() - i * 7); out.push(_mondayISO(d)); }
    return out;
}
// Timesheet compliance for a set of employees over the last N weeks (avg %).
function _complianceForIds(headers, ids, weeks) {
    if (!ids.length) return 0;
    const mondays = _lastNMondays(weeks || 8);
    const submitted = {}; // empId -> Set(weekStart)
    headers.forEach(h => {
        if (!ids.includes(h.employee_employeeId)) return;
        if (!_TS_OK.has(h.status)) return;
        const w = String(h.weekStartDate).slice(0, 10);
        (submitted[h.employee_employeeId] = submitted[h.employee_employeeId] || new Set()).add(w);
    });
    const perEmp = ids.map(id => {
        const set = submitted[id] || new Set();
        const hit = mondays.filter(w => set.has(w)).length;
        return _pct(hit, mondays.length);
    });
    return Math.round(_avg(perEmp));
}
// Core metric bundle for any set of employee ids (employee / department / company).
function scopeMetrics(data, ids) {
    const { tasks, leaves, headers, ratings } = data;
    const set = new Set(ids);
    const today = new Date().toISOString().slice(0, 10);

    // Rating (avg of each employee's latest) + month-over-month growth.
    const rs = ratings.filter(r => set.has(r.employee_employeeId));
    const latestByEmp = {};
    rs.forEach(r => { const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0); const k = r.employee_employeeId; if (!latestByEmp[k] || ord > latestByEmp[k].ord) latestByEmp[k] = { ord, val: parseFloat(r.ratingValue) || 0 }; });
    const avgRating = +(_avg(Object.values(latestByEmp).map(x => x.val).filter(v => v > 0))).toFixed(2);
    const now = new Date(); const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const curMonthVals = rs.filter(r => r.reviewYear === now.getFullYear() && r.reviewMonth === now.getMonth() + 1).map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const prevMonthVals = rs.filter(r => r.reviewYear === pm.getFullYear() && r.reviewMonth === pm.getMonth() + 1).map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const curM = +(_avg(curMonthVals)).toFixed(2) || avgRating;
    const prevM = +(_avg(prevMonthVals)).toFixed(2);
    const growthPct = prevM > 0 ? Math.round(((curM - prevM) / prevM) * 100) : 0;
    const ratingPct = avgRating / 5 * 100;

    // Tasks: completion + deadline adherence (on-time).
    const ts = tasks.filter(t => set.has(t.assignedTo_employeeId));
    let completed = 0, overdue = 0;
    ts.forEach(t => { const s = _normStatus(t.status); const done = s === 'completed' || s === 'ended'; const od = !done && t.dueDate && String(t.dueDate).slice(0, 10) < today; if (od) overdue++; else if (done) completed++; });
    const taskCompletionPct = _pct(completed, ts.length);
    const onTimePct = (completed + overdue) > 0 ? _pct(completed, completed + overdue) : 100;

    // Timesheet compliance (last 8 weeks) + leave utilisation.
    const compliancePct = _complianceForIds(headers, ids, 8);
    const usedDays = leaves.filter(l => set.has(l.employee_employeeId) && l.status === 'Approved').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const leaveUtilPct = Math.min(100, _pct(usedDays, Math.max(1, ids.length * 21)));

    // Composite executive scores.
    const productivity = Math.round(0.5 * taskCompletionPct + 0.3 * compliancePct + 0.2 * ratingPct);
    const reliability = Math.round(0.4 * compliancePct + 0.3 * taskCompletionPct + 0.3 * onTimePct);
    const health = Math.round(0.30 * ratingPct + 0.25 * taskCompletionPct + 0.20 * compliancePct + 0.10 * (100 - leaveUtilPct) + 0.15 * onTimePct);

    return { avgRating, ratingPct, growthPct, taskCompletionPct, onTimePct, compliancePct, leaveUtilPct, usedDays, overdue, productivity, reliability, health, count: ids.length };
}
// 6-month trend of health / productivity / reliability for one employee.
function employeeTrends(data, id) {
    const { tasks, ratings, headers, leaves } = data;
    const rs = ratings.filter(r => r.employee_employeeId === id);
    const ts = tasks.filter(t => t.assignedTo_employeeId === id);
    const totalTasks = Math.max(1, ts.length);
    const today = new Date().toISOString().slice(0, 10);
    let comp = 0, overd = 0;
    ts.forEach(t => { const s = _normStatus(t.status); const done = s === 'completed' || s === 'ended'; const od = !done && t.dueDate && String(t.dueDate).slice(0, 10) < today; if (od) overd++; else if (done) comp++; });
    const onTime = (comp + overd) > 0 ? _pct(comp, comp + overd) : 100;
    const usedDays = leaves.filter(l => l.employee_employeeId === id && l.status === 'Approved').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const leaveBal = 100 - Math.min(100, _pct(usedDays, 21));

    return _last6Months().map(mm => {
        const monthEnd = new Date(mm.y, mm.m, 0).toISOString().slice(0, 10);
        const ord = mm.y * 12 + mm.m;
        const upto = rs.filter(r => ((r.reviewYear || 0) * 12 + (r.reviewMonth || 0)) <= ord)
            .sort((a, b) => ((b.reviewYear || 0) * 12 + (b.reviewMonth || 0)) - ((a.reviewYear || 0) * 12 + (a.reviewMonth || 0)));
        const ratingPct = upto.length ? (parseFloat(upto[0].ratingValue) || 0) / 5 * 100 : 0;
        const doneBy = ts.filter(t => _normStatus(t.status) === 'completed' && (!t.statusUpdatedAt || String(t.statusUpdatedAt).slice(0, 10) <= monthEnd)).length;
        const taskPct = _pct(doneBy, totalTasks);
        // compliance: mondays within this calendar month that were submitted
        const monthMondays = []; let d = new Date(mm.y, mm.m - 1, 1);
        while (d.getMonth() === mm.m - 1) { if (d.getDay() === 1) monthMondays.push(_mondayISO(d)); d.setDate(d.getDate() + 1); }
        const submittedSet = new Set(headers.filter(h => h.employee_employeeId === id && _TS_OK.has(h.status)).map(h => String(h.weekStartDate).slice(0, 10)));
        const compliancePct = monthMondays.length ? _pct(monthMondays.filter(w => submittedSet.has(w)).length, monthMondays.length) : 0;
        return {
            label: mm.label,
            health: Math.round(0.30 * ratingPct + 0.25 * taskPct + 0.20 * compliancePct + 0.10 * leaveBal + 0.15 * onTime),
            productivity: Math.round(0.5 * taskPct + 0.3 * compliancePct + 0.2 * ratingPct),
            reliability: Math.round(0.4 * compliancePct + 0.3 * taskPct + 0.3 * onTime)
        };
    });
}
// Contribution band (no raw rank) relative to all active employees.
function contributionBand(data, id) {
    const active = data.emps.filter(e => e.isActive !== false);
    const scoreOf = m => 0.4 * m.ratingPct + 0.35 * m.taskCompletionPct + 0.25 * m.reliability;
    const scored = active.map(e => ({ id: e.employeeId, s: scoreOf(scopeMetrics(data, [e.employeeId])) })).sort((a, b) => b.s - a.s);
    const idx = scored.findIndex(x => x.id === id);
    if (idx === -1) return { band: 'Average', label: 'Average Contributor', score: 0 };
    const frac = (idx + 1) / scored.length, my = scored[idx].s, avg = _avg(scored.map(x => x.s));
    let band, label;
    if (frac <= 0.05) { band = 'Top 5%'; label = 'High Performer'; }
    else if (frac <= 0.10) { band = 'Top 10%'; label = 'High Performer'; }
    else if (frac <= 0.25) { band = 'Top 25%'; label = 'Consistent Contributor'; }
    else if (my >= avg) { band = 'Average'; label = 'Average Contributor'; }
    else { band = 'Needs Attention'; label = 'Needs Attention'; }
    return { band, label, score: Math.round(my) };
}

function buildEmployee(data, employeeId) {
    const emp = data.emps.find(e => e.employeeId === employeeId);
    if (!emp) return null;
    const dept = (emp.department || 'Unassigned').trim() || 'Unassigned';
    const deptIds = data.emps.filter(e => ((e.department || 'Unassigned').trim() || 'Unassigned') === dept).map(e => e.employeeId);
    const companyIds = data.emps.map(e => e.employeeId);

    const me = scopeMetrics(data, [employeeId]);
    const dm = scopeMetrics(data, deptIds);
    const cm = scopeMetrics(data, companyIds);
    const trends = employeeTrends(data, employeeId);
    const contribution = contributionBand(data, employeeId);

    // ── Risk assessment ──
    const factors = []; let pts = 0;
    if (me.growthPct < 0) { factors.push(`Declining ratings (${me.growthPct}% MoM)`); pts += 1; }
    if (me.overdue > 0) { factors.push(`${me.overdue} overdue task${me.overdue > 1 ? 's' : ''}`); pts += 1; if (me.overdue > 3) pts += 1; }
    if (me.compliancePct < 70) { factors.push(`Low timesheet compliance (${me.compliancePct}%)`); pts += 1; }
    if (me.productivity < 50) { factors.push(`Low productivity (${me.productivity})`); pts += 2; }
    if (me.usedDays > 15) { factors.push(`Excessive leave usage (${me.usedDays} days)`); pts += 1; }
    const riskLevel = pts >= 4 ? 'High Risk' : pts >= 2 ? 'Medium Risk' : 'Low Risk';

    // ── Executive insight (dynamic) ──
    const name = emp.employeeName || employeeId;
    const ratingVsCo = me.avgRating - cm.avgRating;
    const prodVsCo = me.productivity - cm.productivity;
    const trendDelta = trends.length ? (trends[trends.length - 1].health - trends[0].health) : 0;
    const insight =
        `${name} currently ${prodVsCo >= 0 && ratingVsCo >= 0 ? 'performs above' : (prodVsCo < 0 && ratingVsCo < 0 ? 'performs below' : 'performs in line with')} ` +
        `both department and company averages. ` +
        `Productivity ${trendDelta >= 0 ? 'has improved' : 'has declined'} by ${Math.abs(trendDelta)} point${Math.abs(trendDelta) !== 1 ? 's' : ''} over the last six months ` +
        `while reliability stands at ${me.reliability}/100 (company ${cm.reliability}). ` +
        `Rating and task-completion metrics place ${name} in the “${contribution.label}” category` +
        `${contribution.band !== 'Average' && contribution.band !== 'Needs Attention' ? ` (${contribution.band})` : ''}. ` +
        `${factors.length ? 'Risk indicators: ' + factors.join('; ') + '.' : 'No operational risks have been identified.'}`;

    return {
        employeeId, employeeName: name,
        designation: emp.designation || '', department: dept,
        isActive: emp.isActive !== false, joiningDate: emp.joiningDate || '',
        healthScore: me.health, healthStatus: _healthStatus(me.health),
        growthPct: me.growthPct,
        kpis: {
            rating: { employee: me.avgRating, department: dm.avgRating, company: cm.avgRating },
            productivity: { employee: me.productivity, department: dm.productivity, company: cm.productivity },
            reliability: { employee: me.reliability, department: dm.reliability, company: cm.reliability },
            leaveUtil: { employee: me.leaveUtilPct, department: dm.leaveUtilPct, company: cm.leaveUtilPct }
        },
        benchmarks: {
            rating: { employee: +(me.ratingPct).toFixed(0), department: +(dm.ratingPct).toFixed(0), company: +(cm.ratingPct).toFixed(0) },
            productivity: { employee: me.productivity, department: dm.productivity, company: cm.productivity },
            reliability: { employee: me.reliability, department: dm.reliability, company: cm.reliability },
            leaveUtil: { employee: me.leaveUtilPct, department: dm.leaveUtilPct, company: cm.leaveUtilPct }
        },
        contribution,
        risk: { level: riskLevel, factors },
        trends: {
            months: trends.map(t => t.label),
            health: trends.map(t => t.health),
            productivity: trends.map(t => t.productivity),
            reliability: trends.map(t => t.reliability)
        },
        insight
    };
}

class FounderService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'Founder' scope AND EmployeeMaster.role === 'founder'.
        this.before('*', requireMatchingRole('founder'));
        this.before('*', blockIfInactive);

        this.on('getFounderAnalytics', async () => {
            try {
                const data = await loadFounderData();
                return JSON.stringify({ generatedAt: new Date().toISOString(), company: { name: 'Ccentrik' }, overall: buildOverall(data) });
            } catch (e) {
                cds.log('founder').error('getFounderAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute analytics.' });
            }
        });

        this.on('getDepartmentAnalytics', async (req) => {
            try {
                const data = await loadFounderData();
                const deptNames = Array.from(new Set(data.emps.map(e => (e.department || 'Unassigned').trim() || 'Unassigned')));
                const department = (req.data.department && deptNames.indexOf(req.data.department) !== -1) ? req.data.department : (deptNames[0] || 'Unassigned');
                return JSON.stringify({ generatedAt: new Date().toISOString(), departments: deptNames, department: buildDepartment(data, department) });
            } catch (e) {
                cds.log('founder').error('getDepartmentAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute department analytics.' });
            }
        });

        // Drill-down: a single employee's performance + tasks (Founder only).
        this.on('getEmployeeAnalytics', async (req) => {
            try {
                if (!req.data.employeeId) return JSON.stringify({ error: 'employeeId is required.' });
                const data = await loadFounderData();
                const emp = buildEmployee(data, req.data.employeeId);
                if (!emp) return JSON.stringify({ error: 'Employee not found.' });
                return JSON.stringify({ generatedAt: new Date().toISOString(), employee: emp });
            } catch (e) {
                cds.log('founder').error('getEmployeeAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute employee analytics.' });
            }
        });

        // Org-wide pending approvals (timesheets + leaves) across every employee.
        this.on('getFounderApprovals', async (req) => {
            try {
                // Authority scope: only requests from employees whose DIRECT
                // reporting manager is this founder are visible. Requests from anyone
                // else (incl. indirect reports under another manager) are filtered out.
                const { ids: scopeIds } = await founderDirectReports(req);
                const inScope = (empId) => scopeIds.has(empId);

                const [emps, headersAll, leavesAll, prevWeeksAll, dayUnlocksAll] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(HEADER).where({ status: { in: ['Pending', 'Submitted'] } }),
                    SELECT.from(LEAVE_REQUEST).where({ status: 'Pending' }),
                    SELECT.from(PREV_WEEK_REQUEST).where({ status: 'Pending' }),
                    SELECT.from(DAY_UNLOCK_REQUEST).where({ status: 'Pending' })
                ]);
                const headers = (headersAll || []).filter(h => inScope(h.employee_employeeId));
                const leaves = (leavesAll || []).filter(l => inScope(l.employee_employeeId));
                const prevWeeks = (prevWeeksAll || []).filter(r => inScope(r.employee_employeeId));
                const dayUnlocks = (dayUnlocksAll || []).filter(r => inScope(r.employee_employeeId));

                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const ts = (headers || []).map(h => ({
                    timesheetId: h.timesheetId,
                    employee: nm[h.employee_employeeId] || h.employee_employeeId, department: dp[h.employee_employeeId] || '—',
                    week: (h.weekStartDate || '') + ' – ' + (h.weekEndDate || ''),
                    weekStart: h.weekStartDate || '', weekEnd: h.weekEndDate || '',
                    submittedOn: h.submittedOn ? new Date(h.submittedOn).toLocaleString() : '', status: h.status
                }));
                const lv = (leaves || []).map(l => ({
                    leaveId: l.leaveId,
                    employee: nm[l.employee_employeeId] || l.employee_employeeId, department: dp[l.employee_employeeId] || '—',
                    leaveType: l.leaveType, from: l.fromDate, to: l.toDate, days: l.days,
                    reason: l.reason || '', status: l.status
                }));
                // Timesheet "fill requests" — previous-week + missed-day unlock requests,
                // org-wide, so the Founder sees requests routed to them (or anyone).
                const fillRequests = []
                    .concat((prevWeeks || []).map(r => ({
                        kind: 'prevweek', requestId: r.requestId,
                        employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Previous Week Fill', detail: (r.weekStartDate || '') + ' → ' + (r.weekEndDate || ''),
                        reason: r.employeeRemarks || '', requestedOn: r.requestedOn ? new Date(r.requestedOn).toLocaleString() : ''
                    })))
                    .concat((dayUnlocks || []).map(r => ({
                        kind: 'dayunlock', requestId: r.requestId,
                        employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Missed Day Unlock', detail: r.targetDate || '',
                        reason: r.employeeRemarks || '', requestedOn: r.requestedOn ? new Date(r.requestedOn).toLocaleString() : ''
                    })));
                return JSON.stringify({
                    timesheets: ts, leaves: lv, fillRequests,
                    counts: { timesheets: ts.length, leaves: lv.length, fillRequests: fillRequests.length }
                });
            } catch (e) { return JSON.stringify({ timesheets: [], leaves: [], fillRequests: [], counts: { timesheets: 0, leaves: 0, fillRequests: 0 } }); }
        });

        // Org-wide task list with status + assignee.
        this.on('getFounderTasks', async () => {
            try {
                const [emps, tasks] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(TASK).columns('taskId', 'taskName', 'taskDescription', 'assignedTo_employeeId', 'status', 'priority', 'startDate', 'dueDate', 'taskType')
                ]);
                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const today = new Date().toISOString().slice(0, 10);
                const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
                let completed = 0, inProgress = 0, pending = 0, overdue = 0;
                const rows = (tasks || []).map(t => {
                    const s = norm(t.status); const isDone = s === 'completed' || s === 'ended';
                    const isOverdue = !isDone && t.dueDate && String(t.dueDate).slice(0, 10) < today;
                    if (isOverdue) overdue++; else if (isDone) completed++; else if (s === 'inprogress' || s === 'inreview') inProgress++; else pending++;
                    return {
                        taskId: t.taskId, taskName: t.taskName || t.taskId, description: t.taskDescription || '',
                        assignee: nm[t.assignedTo_employeeId] || t.assignedTo_employeeId || 'Unassigned',
                        department: dp[t.assignedTo_employeeId] || '—',
                        type: t.taskType || 'solo',
                        status: t.status || 'Not Started', priority: t.priority || 'Medium',
                        startDate: t.startDate || '', dueDate: t.dueDate || '', overdue: !!isOverdue
                    };
                });
                const departments = Array.from(new Set(emps.map(e => (e.department || '').trim()).filter(Boolean))).sort();
                return JSON.stringify({ tasks: rows, departments, counts: { total: rows.length, completed, inProgress, pending, overdue } });
            } catch (e) { return JSON.stringify({ tasks: [], counts: { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 } }); }
        });

        // Org-wide performance ratings.
        this.on('getFounderRatings', async () => {
            try {
                const [emps, ratings] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(PERFORMANCE_RATING).columns('ratingId', 'employee_employeeId', 'ratingValue', 'reviewMonth', 'reviewYear', 'reviewComment', 'ratingCategory')
                ]);
                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const rows = (ratings || []).map(r => ({
                    employeeId: r.employee_employeeId,
                    employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                    rating: parseFloat(r.ratingValue) || 0, category: r.ratingCategory || '—',
                    month: r.reviewMonth, year: r.reviewYear,
                    period: (MON[r.reviewMonth] || '') + ' ' + (r.reviewYear || ''), comment: r.reviewComment || ''
                })).sort((a, b) => b.rating - a.rating);
                const avg = rows.length ? +(rows.reduce((s, x) => s + x.rating, 0) / rows.length).toFixed(2) : 0;
                // Department averages (for the executive overview cards).
                const byDept = {};
                rows.forEach(r => { (byDept[r.department] = byDept[r.department] || []).push(r.rating); });
                const departmentOverview = Object.keys(byDept).map(d => ({
                    department: d, count: byDept[d].length,
                    average: +(byDept[d].reduce((s, x) => s + x, 0) / byDept[d].length).toFixed(2)
                })).sort((a, b) => b.average - a.average);
                return JSON.stringify({ ratings: rows, count: rows.length, average: avg, departmentOverview });
            } catch (e) { return JSON.stringify({ ratings: [], count: 0, average: 0 }); }
        });

        // Active-employee directory for the assign-task / submit-rating pickers.
        // Scoped to the founder's DIRECT reports only (manager = this founder) —
        // see founderDirectReports(). The dropdown therefore never exposes
        // employees from other reporting hierarchies.
        this.on('getFounderEmployees', async (req) => {
            try {
                const { employees: emps } = await founderDirectReports(req);
                const departments = Array.from(new Set((emps || []).map(e => (e.department || '').trim()).filter(Boolean))).sort();
                return JSON.stringify({
                    employees: (emps || []).map(e => ({
                        employeeId: e.employeeId, employeeName: e.employeeName,
                        department: e.department || '—', designation: e.designation || ''
                    })),
                    departments
                });
            } catch (e) { return JSON.stringify({ employees: [], departments: [] }); }
        });

        // ── Founder write actions (org-wide; same tables + notifications) ──────────

        // Approve / reject ANY timesheet (founder oversees the whole org).
        this.on('founderDecideTimesheet', async (req) => {
            try {
                const { timesheetId, approve, remarks } = req.data;
                if (!timesheetId) return JSON.stringify({ error: 'timesheetId is required.' });
                const header = await SELECT.one.from(HEADER).where({ timesheetId });
                if (!header) return JSON.stringify({ error: `Timesheet '${timesheetId}' not found.` });
                const { ids: scopeIds } = await founderDirectReports(req);
                if (!scopeIds.has(header.employee_employeeId)) return JSON.stringify({ error: 'This timesheet is not within your reporting hierarchy.' });
                if (header.status !== 'Pending') return JSON.stringify({ error: `Cannot act — current status is '${header.status}'.` });
                if (approve) {
                    await UPDATE(HEADER).set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
                    await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Approved' }).where({ timesheet_timesheetId: timesheetId });
                    await createNotification(header.employee_employeeId, 'TIMESHEET_APPROVED', 'Timesheet Approved ✓',
                        `Your timesheet ${timesheetId} has been approved by the Founder.${remarks ? ' Remarks: ' + remarks : ''}`, timesheetId);
                } else {
                    await UPDATE(HEADER).set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
                    await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' }).where({ timesheet_timesheetId: timesheetId });
                    await createNotification(header.employee_employeeId, 'TIMESHEET_REJECTED', 'Timesheet Returned ✗',
                        `Your timesheet ${timesheetId} was returned by the Founder.${remarks ? ' Reason: ' + remarks : ''}`, timesheetId);
                }
                founderEvents.ping('founderDecideTimesheet');
                return JSON.stringify({ ok: true, timesheetId, status: approve ? 'Approved' : 'Rejected' });
            } catch (e) { cds.log('founder').error('founderDecideTimesheet:', e.message || e); return JSON.stringify({ error: 'Could not update the timesheet.' }); }
        });

        // Approve / reject ANY leave request.
        this.on('founderDecideLeave', async (req) => {
            try {
                const { leaveId, approve, remarks } = req.data;
                if (!leaveId) return JSON.stringify({ error: 'leaveId is required.' });
                const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
                if (!leave) return JSON.stringify({ error: `Leave request '${leaveId}' not found.` });
                const { ids: scopeIds } = await founderDirectReports(req);
                if (!scopeIds.has(leave.employee_employeeId)) return JSON.stringify({ error: 'This leave request is not within your reporting hierarchy.' });
                if (leave.status !== 'Pending') return JSON.stringify({ error: `Leave is already '${leave.status}'.` });
                const newStatus = approve ? 'Approved' : 'Rejected';
                await UPDATE(LEAVE_REQUEST).set({ status: newStatus, managerRemarks: remarks || '', approvedOn: new Date() }).where({ leaveId });
                await createNotification(leave.employee_employeeId,
                    approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                    approve ? 'Leave Approved ✓' : 'Leave Rejected ✗',
                    approve
                        ? `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was approved by the Founder.${remarks ? ' Remarks: ' + remarks : ''}`
                        : `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was rejected by the Founder.${remarks ? ' Reason: ' + remarks : ''}`,
                    leaveId);
                founderEvents.ping('founderDecideLeave');
                return JSON.stringify({ ok: true, leaveId, status: newStatus });
            } catch (e) { cds.log('founder').error('founderDecideLeave:', e.message || e); return JSON.stringify({ error: 'Could not update the leave request.' }); }
        });

        // Approve / reject a timesheet "fill request" (previous-week or missed-day).
        // Mirrors the Manager/HR logic so the same records + notifications update.
        this.on('founderDecideFillRequest', async (req) => {
            try {
                const { kind, requestId, approve, remarks } = req.data;
                if (!requestId) return JSON.stringify({ error: 'requestId is required.' });

                const { ids: scopeIds } = await founderDirectReports(req);

                if (kind === 'prevweek') {
                    const request = await SELECT.one.from(PREV_WEEK_REQUEST).where({ requestId });
                    if (!request) return JSON.stringify({ error: `Request '${requestId}' not found.` });
                    if (!scopeIds.has(request.employee_employeeId)) return JSON.stringify({ error: 'This request is not within your reporting hierarchy.' });
                    if (request.status !== 'Pending') return JSON.stringify({ error: `Request is already '${request.status}'.` });
                    const newStatus = approve ? 'Approved' : 'Rejected';
                    let tsId = null;
                    if (approve) {
                        tsId = `${request.employee_employeeId}-${request.weekStartDate}`;
                        const existingHdr = await SELECT.one.from(HEADER).where({ timesheetId: tsId });
                        if (!existingHdr) {
                            await INSERT.into(HEADER).entries({
                                timesheetId: tsId, employee_employeeId: request.employee_employeeId,
                                weekStartDate: request.weekStartDate, weekEndDate: request.weekEndDate,
                                status: 'PrevWeekApproved', submissionType: 'Weekly', isAutoApproved: false
                            });
                        } else if (['Draft', 'Rejected'].includes(existingHdr.status)) {
                            await UPDATE(HEADER).set({ status: 'PrevWeekApproved' }).where({ timesheetId: tsId });
                        }
                    }
                    await UPDATE(PREV_WEEK_REQUEST)
                        .set({ status: newStatus, managerRemarks: remarks || '', resolvedOn: new Date(), timesheetId: tsId || null })
                        .where({ requestId });
                    await createNotification(request.employee_employeeId,
                        approve ? 'PREVWEEK_APPROVED' : 'PREVWEEK_REJECTED',
                        approve ? 'Previous Week Timesheet Approved ✓' : 'Previous Week Request Rejected ✗',
                        approve
                            ? `The Founder approved your request — you can now fill your timesheet for ${request.weekStartDate}.`
                            : `Your previous-week request for ${request.weekStartDate} was rejected.${remarks ? ' Reason: ' + remarks : ''}`,
                        requestId);
                    founderEvents.ping('founderDecideFillRequest');
                    return JSON.stringify({ ok: true, requestId, status: newStatus });
                }

                if (kind === 'dayunlock') {
                    const request = await SELECT.one.from(DAY_UNLOCK_REQUEST).where({ requestId });
                    if (!request) return JSON.stringify({ error: `Request '${requestId}' not found.` });
                    if (!scopeIds.has(request.employee_employeeId)) return JSON.stringify({ error: 'This request is not within your reporting hierarchy.' });
                    if (request.status !== 'Pending') return JSON.stringify({ error: `Request is already '${request.status}'.` });
                    const newStatus = approve ? 'Approved' : 'Rejected';
                    await UPDATE(DAY_UNLOCK_REQUEST).set({ status: newStatus, hrRemarks: remarks || '', resolvedOn: new Date() }).where({ requestId });
                    if (approve) {
                        const mon = _mondayISO(new Date());
                        const tsId = `${request.employee_employeeId}-${mon}`;
                        await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' })
                            .where({ timesheet_timesheetId: tsId, workDate: request.targetDate });
                    }
                    await createNotification(request.employee_employeeId,
                        approve ? 'DAY_UNLOCK_APPROVED' : 'DAY_UNLOCK_REJECTED',
                        approve ? `Day ${request.targetDate} Unlocked ✓` : `Day ${request.targetDate} Unlock Rejected ✗`,
                        approve
                            ? `The Founder approved your request to fill ${request.targetDate}.`
                            : `The Founder rejected your unlock request for ${request.targetDate}.${remarks ? ' Reason: ' + remarks : ''}`,
                        requestId);
                    founderEvents.ping('founderDecideFillRequest');
                    return JSON.stringify({ ok: true, requestId, status: newStatus });
                }

                return JSON.stringify({ error: 'Unknown request kind.' });
            } catch (e) { cds.log('founder').error('founderDecideFillRequest:', e.message || e); return JSON.stringify({ error: 'Could not update the request.' }); }
        });

        // Assign a NEW solo task to any employee (writes to the same TaskMaster table).
        this.on('founderAssignTask', async (req) => {
            try {
                const d = req.data || {};
                if (!d.taskName || !d.taskName.trim()) return JSON.stringify({ error: 'Task name is required.' });
                if (!d.assigneeId) return JSON.stringify({ error: 'Please choose an assignee.' });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId: d.assigneeId });
                if (!emp) return JSON.stringify({ error: `Employee '${d.assigneeId}' not found.` });
                // Access control: the assignee must report directly to this founder.
                const { ids: reportIds } = await founderDirectReports(req);
                if (!reportIds.has(d.assigneeId)) return JSON.stringify({ error: 'You can only assign tasks to employees who report to you.' });
                // (Optional) reviewer, when supplied, must also be a direct report.
                if (d.reviewerId && String(d.reviewerId).trim() && !reportIds.has(String(d.reviewerId).trim())) {
                    return JSON.stringify({ error: 'The reviewer must be an employee who reports to you.' });
                }
                const taskId = await nextGroupTaskId();
                await INSERT.into(TASK).entries({
                    taskId,
                    taskName: d.taskName.trim(),
                    taskDescription: (d.taskDescription || '').trim(),
                    assignedTo_employeeId: d.assigneeId,
                    reviewer_employeeId: (d.reviewerId && String(d.reviewerId).trim()) ? d.reviewerId : null,
                    priority: d.priority || 'Medium',
                    status: 'Not Started',
                    taskType: 'solo',
                    startDate: d.startDate || null,
                    dueDate: d.dueDate || null,
                    statusUpdatedAt: new Date()
                });
                await createNotification(d.assigneeId, 'TASK_ASSIGNED', `New Task: ${d.taskName.trim()}`,
                    `The Founder assigned you "${d.taskName.trim()}" (${d.priority || 'Medium'} priority)${d.dueDate ? ', due ' + d.dueDate : ''}.`, taskId);
                founderEvents.ping('founderAssignTask');
                return JSON.stringify({ ok: true, taskId });
            } catch (e) { cds.log('founder').error('founderAssignTask:', e.message || e); return JSON.stringify({ error: 'Could not assign the task.' }); }
        });

        // Submit / update a performance rating for any employee (PerformanceRating table).
        this.on('founderSubmitRating', async (req) => {
            try {
                const { employeeId, ratingValue, reviewMonth, reviewYear, reviewComment, ratingCategory } = req.data;
                if (!employeeId) return JSON.stringify({ error: 'employeeId is required.' });
                if (!ratingValue) return JSON.stringify({ error: 'ratingValue is required.' });
                if (!reviewMonth) return JSON.stringify({ error: 'reviewMonth is required.' });
                if (!reviewYear) return JSON.stringify({ error: 'reviewYear is required.' });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId });
                if (!emp) return JSON.stringify({ error: `Employee '${employeeId}' not found.` });
                // Access control: founders may only rate their direct reports.
                const { ids: rateableIds } = await founderDirectReports(req);
                if (!rateableIds.has(employeeId)) return JSON.stringify({ error: 'You can only rate employees who report to you.' });
                const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2, '0')}`;
                const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const period = `${MN[reviewMonth] || reviewMonth} ${reviewYear}`;

                // Issue 5: one rating per employee per month — never overwrite history.
                const existing = await SELECT.one.from(PERFORMANCE_RATING).where({ employee_employeeId: employeeId, reviewMonth, reviewYear });
                if (existing) {
                    return JSON.stringify({ error: `Rating for this employee has already been submitted for ${period}.` });
                }
                try {
                    await INSERT.into(PERFORMANCE_RATING).entries({ ratingId, employee_employeeId: employeeId, ratingValue, reviewMonth, reviewYear, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' });
                } catch (e) {
                    return JSON.stringify({ error: `Rating for this employee has already been submitted for ${period}.` });
                }
                await createNotification(employeeId, 'PERFORMANCE_RATED', 'New Performance Rating ⭐',
                    `The Founder rated you ${ratingValue}/5${ratingCategory ? ' (' + ratingCategory + ')' : ''} for ${period}.${reviewComment ? ' Comment: ' + reviewComment : ''}`,
                    ratingId);
                founderEvents.ping('founderSubmitRating');
                return JSON.stringify({ ok: true, ratingId });
            } catch (e) { cds.log('founder').error('founderSubmitRating:', e.message || e); return JSON.stringify({ error: 'Could not submit the rating.' }); }
        });

        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService, HRService, FounderService };
cds.on('served', () => startReminderCron(getMailer, createNotification));