// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/timesheet-handler.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const cds = require('@sap/cds');

const NS         = 'ccentrik.employee.timesheet.schema.timesheet';
const HEADER     = `${NS}.TimesheetHeader`;
const ENTRY      = `${NS}.TimesheetEntry`;
const EMPLOYEE   = `${NS}.EmployeeMaster`;
const TASK       = `${NS}.TaskMaster`;
const TASK_ASSIGNEE = `${NS}.TaskAssignee`;
const DAY_UNLOCK = `${NS}.TimesheetDayUnlockRequest`;
const PREV_WEEK  = `${NS}.TimesheetPrevWeekRequest`;

// ── Date helpers ──────────────────────────────────────────────────────────────

// FIX: Use local date parts instead of toISOString() to avoid UTC timezone shift
function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Stable short hash (base36) — used to key custom-task entries that have no taskId.
function shortHash(s) {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h.toString(36);
}

function getMondayOfWeek(date) {
    const d   = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

function getSundayOfWeek(date) {
    const mon = getMondayOfWeek(date);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return sun;
}

function getPrevMonday(date) {
    const mon = getMondayOfWeek(date);
    mon.setDate(mon.getDate() - 7);
    return mon;
}

function getPrevSunday(date) {
    const sun = new Date(getPrevMonday(date));
    sun.setDate(sun.getDate() + 6);
    return sun;
}

function isCurrentWeek(dateStr) {
    const mon = getMondayOfWeek(new Date());
    const sun = getSundayOfWeek(new Date());
    const d   = new Date(dateStr);
    return d >= mon && d <= sun;
}

function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function timesheetId(empId, weekStart) {
    return `${empId}-${weekStart}`;
}

// ── NEW: Get date N days ago as ISO string ────────────────────────────────────
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return toISODate(d);
}

// ── NEW: Check if a date is within the allowed fill window (today or last 2 days,
//         but only within the current week) ────────────────────────────────────
function isWithinFillWindow(dateStr) {
    const today     = toISODate(new Date());
    const yesterday = daysAgo(1);
    const twoDaysAgo = daysAgo(2);
    // Must be current week
    if (!isCurrentWeek(dateStr)) return false;
    // Must be today, yesterday, or 2 days ago
    return dateStr === today || dateStr === yesterday || dateStr === twoDaysAgo;
}

// ── NEW: Check if today is Friday or later in the week (for submit validation)
function isFridayOrLater() {
    const day = new Date().getDay(); // 0=Sun,1=Mon...5=Fri,6=Sat
    return day === 5 || day === 6;   // Friday or Saturday
    // Sunday (0) is holiday — employees wouldn't submit on Sunday
}

// ═════════════════════════════════════════════════════════════════════════════
// EMPLOYEE SERVICE handlers
// ═════════════════════════════════════════════════════════════════════════════
async function registerTimesheetHandlers(svc, getMailer, createNotification) {

    async function resolveEmployee(req) {
        const user  = req.user || {};
        const email = user.attr?.email || user.attr?.mail || user.id || '';
        return await SELECT.one.from(EMPLOYEE).where({ email });
    }

    async function ensureHeader(empId, weekStart, weekEnd) {
        const id  = timesheetId(empId, weekStart);
        let   hdr = await SELECT.one.from(HEADER).where({ timesheetId: id });
        if (!hdr) {
            await INSERT.into(HEADER).entries({
                timesheetId:         id,
                employee_employeeId: empId,
                weekStartDate:       weekStart,
                weekEndDate:         weekEnd,
                status:              'Draft',
                submissionType:      'Weekly',
                isAutoApproved:      false
            });
            hdr = await SELECT.one.from(HEADER).where({ timesheetId: id });
        }
        return hdr;
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: getTimesheetWeekData
    // ────────────────────────────────────────────────────────────────────────
    svc.on('getTimesheetWeekData', async (req) => {
        const { weekStartDate, weekEndDate } = req.data;
        if (!weekStartDate || !weekEndDate)
            return req.error(400, 'weekStartDate and weekEndDate are required.');

        const emp = await resolveEmployee(req);
        if (!emp) return req.error(404, 'Employee not found.');

        const id  = timesheetId(emp.employeeId, weekStartDate);
        const hdr = await SELECT.one.from(HEADER).where({ timesheetId: id });

        const entries = hdr
            ? await SELECT.from(ENTRY).where({ timesheet_timesheetId: id })
            : [];

        const dayUnlockReqs  = await SELECT.from(DAY_UNLOCK)
            .where({ employee_employeeId: emp.employeeId })
            .orderBy({ requestedOn: 'desc' });

        const weekDayUnlocks = dayUnlockReqs.filter(r =>
            r.targetDate >= weekStartDate && r.targetDate <= weekEndDate
        );

        const prevMon      = toISODate(getPrevMonday(new Date()));
        const prevWeekReqs = await SELECT.from(PREV_WEEK)
            .where({ employee_employeeId: emp.employeeId, weekStartDate: prevMon })
            .orderBy({ requestedOn: 'desc' })
            .limit(1);

        const prevWeekReq       = prevWeekReqs.length ? prevWeekReqs[0] : null;
        const isPrevWeekApproved = prevWeekReq && prevWeekReq.status === 'Approved';

        // Tasks available in the timesheet dropdown = the employee's own SOLO tasks
        // PLUS every GROUP task they are a member of (membership lives in the
        // TaskAssignee table, and a group task's assignedTo_employeeId is null — so
        // a plain assignedTo filter alone silently drops all group tasks).
        const soloTasks = await SELECT.from(TASK)
            .where({ assignedTo_employeeId: emp.employeeId })
            .columns('taskId', 'taskName', 'status');

        const memberRows = await SELECT.from(TASK_ASSIGNEE)
            .where({ assignee_employeeId: emp.employeeId })
            .columns('task_taskId');
        const groupTaskIds = (memberRows || []).map(r => r.task_taskId).filter(Boolean);
        const groupTasks = groupTaskIds.length
            ? await SELECT.from(TASK)
                .where({ taskId: { in: groupTaskIds }, taskType: 'group' })
                .columns('taskId', 'taskName', 'status')
            : [];

        // Merge + de-duplicate by taskId (an employee can't be in both lists for the
        // same task, but the guard keeps the result clean regardless).
        const seenTaskIds = new Set();
        const tasks = [];
        [...soloTasks, ...groupTasks].forEach(t => {
            if (t && t.taskId && !seenTaskIds.has(t.taskId)) { seenTaskIds.add(t.taskId); tasks.push(t); }
        });

        return {
            timesheetId:      id,
            weekStatus:       hdr ? hdr.status : 'None',
            entries:          JSON.stringify(entries),
            dayUnlockRequests: JSON.stringify(weekDayUnlocks),
            prevWeekRequest:  JSON.stringify(prevWeekReq),
            isPrevWeekApproved: !!isPrevWeekApproved,
            tasks:            JSON.stringify(tasks)
        };
    });

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: saveTimesheetEntries
    // FIX: Allow today + yesterday + 2 days ago for current week.
    //      Previous week entries bypass this check (manager already approved).
    // ────────────────────────────────────────────────────────────────────────
    svc.on('saveTimesheetEntries', async (req) => {
        const { weekStartDate, weekEndDate, isPrevWeek } = req.data;
        let   { timesheetId: tsId, entries: entriesJSON } = req.data;

        const emp = await resolveEmployee(req);
        if (!emp) return req.error(404, 'Employee not found.');

        let entries = [];
        try { entries = JSON.parse(entriesJSON || '[]'); }
        catch (e) { return req.error(400, 'entries must be valid JSON.'); }

        if (!entries.length) return req.error(400, 'No entries to save.');

        // ── FIX: Validate current week date window ───────────────────────────
        // Allow: today, yesterday, 2 days ago — all within current week only.
        // Days older than 2 days require HR unlock (handled separately).
        // Previous week entries skip this check entirely.
        if (!isPrevWeek) {
            const today      = toISODate(new Date());
            const yesterday  = daysAgo(1);
            const twoDaysAgo = daysAgo(2);
            const allowedDates = new Set([today, yesterday, twoDaysAgo]);

            for (const e of entries) {
                // Check if it's an HR-unlocked date — if so, allow regardless of window
                const unlockReq = await SELECT.one.from(DAY_UNLOCK).where({
                    employee_employeeId: emp.employeeId,
                    targetDate:          e.workDate,
                    status:              'Approved'
                });

                if (!unlockReq && !allowedDates.has(e.workDate)) {
                    return req.error(400,
                        `Entry for ${e.workDate} is not allowed. ` +
                        `You can fill today (${today}), yesterday (${yesterday}), ` +
                        `or ${twoDaysAgo}. For older dates, request HR approval.`
                    );
                }

                // Must still be current week (not a future date)
                if (e.workDate > today) {
                    return req.error(400, `Cannot fill future date ${e.workDate}.`);
                }
            }
        }

        // ── Validate: prev-week requires an approved manager request ──────────
        if (isPrevWeek) {
            const prevMon  = toISODate(getPrevMonday(new Date()));
            const approved = await SELECT.one.from(PREV_WEEK).where({
                employee_employeeId: emp.employeeId,
                weekStartDate:       prevMon,
                status:              'Approved'
            });
            if (!approved)
                return req.error(403, 'Previous week timesheet requires manager approval first.');
            tsId = approved.timesheetId || timesheetId(emp.employeeId, weekStartDate);
        }

        const hdr = await ensureHeader(emp.employeeId, weekStartDate, weekEndDate);
        if (!hdr) return req.error(500, 'Could not create timesheet header.');

        let saved = 0;
        for (const e of entries) {
            // ── Custom ("Others") task entries carry free text instead of a taskId.
            const isCustom = !!e.isCustomTask;
            let customText = '';
            if (isCustom) {
                customText = String(e.customTaskText || '').trim();
                if (!customText) {
                    return req.error(400, 'Please enter task details (maximum 30 characters).');
                }
                if (customText.length > 30) customText = customText.slice(0, 30);
            }

            if ((!isCustom && !e.taskId) || !e.workDate || e.hoursWorked == null) continue;

            // Guard against impossible daily hours (a single day cannot exceed 24,
            // and negative hours are nonsensical). The grid only ever sends sane
            // values, so this only blocks forged / corrupted payloads.
            const h = Number(e.hoursWorked);
            if (Number.isNaN(h) || h < 0 || h > 24) {
                return req.error(400, `Hours for ${e.workDate} must be between 0 and 24.`);
            }

            // Custom entries have no taskId — key them by a stable hash of the text
            // so each (custom task, day) is one upsertable row.
            const entryId  = isCustom
                ? `${hdr.timesheetId}-C${shortHash(customText.toLowerCase())}-${e.workDate}`
                : `${hdr.timesheetId}-${e.taskId}-${e.workDate}`;
            const existing = await SELECT.one.from(ENTRY).where({ entryId });

            if (existing) {
                if (existing.isLocked) continue;
                await UPDATE(ENTRY)
                    .set({
                        hoursWorked:    e.hoursWorked,
                        description:    e.description || (isCustom ? customText : ''),
                        isCustomTask:   isCustom,
                        customTaskText: isCustom ? customText : null,
                        entryStatus:    'Open'
                    })
                    .where({ entryId });
            } else {
                await INSERT.into(ENTRY).entries({
                    entryId,
                    timesheet_timesheetId: hdr.timesheetId,
                    task_taskId:           isCustom ? null : e.taskId,
                    workDate:              e.workDate,
                    hoursWorked:           e.hoursWorked,
                    description:           e.description || (isCustom ? customText : ''),
                    isCustomTask:          isCustom,
                    customTaskText:        isCustom ? customText : null,
                    entryStatus:           'Open',
                    isLocked:              false
                });
            }
            saved++;
        }

        cds.log('timesheet').info(`Saved ${saved} entries for ${emp.employeeId} week ${weekStartDate}`);
        return { timesheetId: hdr.timesheetId, saved };
    });

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: submitTimesheetWeek
    // FIX: Block submission before Friday for current week.
    // ────────────────────────────────────────────────────────────────────────
    svc.on('submitTimesheetWeek', async (req) => {
        const { timesheetId: tsId, isPrevWeek } = req.data;

        const emp = await resolveEmployee(req);
        if (!emp) return req.error(404, 'Employee not found.');

        // ── FIX: Current week can only be submitted on Friday or Saturday ────
        if (!isPrevWeek) {
            if (!isFridayOrLater()) {
                const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                const today    = dayNames[new Date().getDay()];
                const daysLeft = 5 - new Date().getDay();
                return req.error(400,
                    `Timesheet can only be submitted on Friday or later. ` +
                    `Today is ${today} — ${daysLeft} day(s) until Friday.`
                );
            }
        }

        const hdr = await SELECT.one.from(HEADER).where({ timesheetId: tsId });
        if (!hdr) return req.error(404, `Timesheet '${tsId}' not found.`);

        if (isPrevWeek) {
            await UPDATE(HEADER)
                .set({ status: 'Approved', submittedOn: new Date(), approvedOn: new Date() })
                .where({ timesheetId: tsId });
            await UPDATE(ENTRY)
                .set({ isLocked: true, entryStatus: 'Approved' })
                .where({ timesheet_timesheetId: tsId });
            await UPDATE(PREV_WEEK)
                .set({ status: 'Completed' })
                .where({ employee_employeeId: emp.employeeId, timesheetId: tsId });

            cds.log('timesheet').info(`Prev-week timesheet ${tsId} submitted directly`);
            return `Previous week timesheet submitted and saved successfully.`;

        } else {
            if (!['Draft', 'Rejected'].includes(hdr.status))
                return req.error(400, `Cannot submit — current status is '${hdr.status}'.`);

            await UPDATE(HEADER)
                .set({ status: 'Pending', submittedOn: new Date() })
                .where({ timesheetId: tsId });
            await UPDATE(ENTRY)
                .set({ isLocked: true, entryStatus: 'Locked' })
                .where({ timesheet_timesheetId: tsId });

            // Notify manager — in-app notification (always) + email (if SMTP set)
            if (emp.manager_employeeId) {
                // In-app notification so the manager sees it in the bell / page
                // even when SMTP is not configured.
                if (createNotification) {
                    await createNotification(
                        emp.manager_employeeId,
                        'TIMESHEET_SUBMITTED',
                        'Timesheet Awaiting Approval',
                        `${emp.employeeName} submitted their timesheet (${hdr.weekStartDate} to ${hdr.weekEndDate}) for your approval.`,
                        tsId
                    );
                }

                const manager = await SELECT.one.from(EMPLOYEE).where({ employeeId: emp.manager_employeeId });
                if (manager && manager.email) {
                    const mailer  = getMailer();
                    const subject = `Timesheet Submitted — ${emp.employeeName}`;
                    const body    =
                        `Hi ${manager.employeeName || 'Manager'},\n\n` +
                        `${emp.employeeName} has submitted their timesheet for approval.\n\n` +
                        `Timesheet ID : ${tsId}\n` +
                        `Week         : ${hdr.weekStartDate} to ${hdr.weekEndDate}\n\n` +
                        `Please login to approve or reject.\n\n— Timesheet System`;
                    if (mailer) {
                        try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: manager.email, subject, text: body }); }
                        catch (e) { cds.log('mail').warn('Submit notification failed:', e.message); }
                    }
                }
            }

            cds.log('timesheet').info(`Timesheet ${tsId} submitted for approval`);
            return `Timesheet submitted successfully. Awaiting manager approval.`;
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: requestDayUnlock
    // HR unlock — only for days older than 2 days within current week
    // ────────────────────────────────────────────────────────────────────────
    svc.on('requestDayUnlock', async (req) => {
        const { targetDate, hrApproverId, employeeRemarks } = req.data;

        if (!targetDate)    return req.error(400, 'targetDate is required.');
        if (!hrApproverId)  return req.error(400, 'hrApproverId is required.');

        const emp = await resolveEmployee(req);
        if (!emp) return req.error(404, 'Employee not found.');

        const today      = toISODate(new Date());
        const yesterday  = daysAgo(1);
        const twoDaysAgo = daysAgo(2);

        if (targetDate >= today)
            return req.error(400, 'Day unlock is only for past missed dates.');

        // FIX: Days within 2-day window are directly editable — no HR needed
        if (targetDate === yesterday || targetDate === twoDaysAgo) {
            return req.error(400,
                `${targetDate} is within the 2-day fill window and can be filled directly ` +
                `without HR approval.`
            );
        }

        if (!isCurrentWeek(targetDate))
            return req.error(400,
                'Day unlock is only for missed days within the current week. ' +
                'Use "Request Previous Week Approval" for older dates.'
            );

        // The requestId is deterministic per (employee, targetDate), so a prior
        // request (e.g. one HR rejected) still occupies that primary key. Re-using
        // it instead of inserting a duplicate is what makes "Re-request" work —
        // a fresh INSERT here previously failed with a primary-key violation.
        const requestId = `${emp.employeeId}-${targetDate}-HR`;
        const existing = await SELECT.one.from(DAY_UNLOCK).where({ requestId });

        if (existing && existing.status === 'Pending') {
            return req.error(409, `A pending unlock request already exists for ${targetDate}.`);
        }

        if (existing) {
            // Re-request: reset the existing (Rejected/Approved) row back to Pending.
            await UPDATE(DAY_UNLOCK).set({
                hrApprover_employeeId: hrApproverId,
                status:                'Pending',
                employeeRemarks:       employeeRemarks || '',
                hrRemarks:             null,
                resolvedOn:            null,
                requestedOn:           new Date()
            }).where({ requestId });
        } else {
            await INSERT.into(DAY_UNLOCK).entries({
                requestId,
                employee_employeeId:   emp.employeeId,
                targetDate,
                hrApprover_employeeId: hrApproverId,
                status:                'Pending',
                employeeRemarks:       employeeRemarks || '',
                requestedOn:           new Date()
            });
        }

        // In-app notification to the approver (HR or, for HR users, their manager)
        // so it shows in the bell / approvals page even without SMTP. This was
        // missing — only the email was sent, so approvers never saw a request.
        if (createNotification) {
            await createNotification(
                hrApproverId,
                'DAY_UNLOCK_REQUEST',
                'Missed Day Approval Request',
                `${emp.employeeName} (${emp.employeeId}) requested approval to fill their missed timesheet for ${targetDate}.` +
                    (employeeRemarks ? ` Reason: ${employeeRemarks}` : ''),
                requestId
            );
        }

        const hr = await SELECT.one.from(EMPLOYEE).where({ employeeId: hrApproverId });
        if (hr && hr.email) {
            const mailer  = getMailer();
            const subject = `Day Unlock Request — ${emp.employeeName} for ${targetDate}`;
            const body    =
                `Hi ${hr.employeeName || 'HR'},\n\n` +
                `${emp.employeeName} (${emp.employeeId}) missed filling their timesheet ` +
                `for ${targetDate} and is requesting your approval to unlock it.\n\n` +
                `Reason: ${employeeRemarks || '(no reason provided)'}\n\n` +
                `Please login to the HR portal to approve or reject.\n\n— Timesheet System`;
            if (mailer) {
                try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: hr.email, subject, text: body }); }
                catch (e) { cds.log('mail').warn('Day-unlock email failed:', e.message); }
            } else {
                cds.log('timesheet').info(`[Email simulated] TO: ${hr.email}\n${body}`);
            }
        }

        cds.log('timesheet').info(`Day-unlock request ${requestId} created for ${emp.employeeId} on ${targetDate}`);
        return { requestId, status: 'Pending' };
    });

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: requestPrevWeekFill  (unchanged)
    // ────────────────────────────────────────────────────────────────────────
    svc.on('requestPrevWeekFill', async (req) => {
        const { weekStartDate, weekEndDate, employeeRemarks } = req.data;

        if (!weekStartDate || !weekEndDate)
            return req.error(400, 'weekStartDate and weekEndDate are required.');

        const emp = await resolveEmployee(req);
        if (!emp) return req.error(404, 'Employee not found.');

        if (!emp.manager_employeeId)
            return req.error(400, 'No manager assigned to your profile. Please contact HR.');

        const dup = await SELECT.one.from(PREV_WEEK).where({
            employee_employeeId: emp.employeeId,
            weekStartDate,
            status: 'Pending'
        });
        if (dup) return req.error(409, 'A pending previous-week request already exists for this week.');

        const requestId = uid(`${emp.employeeId}-PREV`);

        await INSERT.into(PREV_WEEK).entries({
            requestId,
            employee_employeeId: emp.employeeId,
            weekStartDate,
            weekEndDate,
            manager_employeeId:  emp.manager_employeeId,
            status:              'Pending',
            employeeRemarks:     employeeRemarks || '',
            requestedOn:         new Date()
        });

        // In-app notification to the manager so the request shows in the bell /
        // approvals page even without SMTP. This was missing — only the email was
        // sent, so managers never saw the request.
        if (createNotification) {
            await createNotification(
                emp.manager_employeeId,
                'PREVWEEK_REQUEST',
                'Timesheet Fill Request',
                `${emp.employeeName} (${emp.employeeId}) requested approval to fill their timesheet for ${weekStartDate} to ${weekEndDate}.` +
                    (employeeRemarks ? ` Reason: ${employeeRemarks}` : ''),
                requestId
            );
        }

        const manager = await SELECT.one.from(EMPLOYEE).where({ employeeId: emp.manager_employeeId });
        if (manager && manager.email) {
            const mailer  = getMailer();
            const subject = `Previous Week Timesheet Request — ${emp.employeeName}`;
            const body    =
                `Hi ${manager.employeeName || 'Manager'},\n\n` +
                `${emp.employeeName} (${emp.employeeId}) is requesting approval to fill ` +
                `their timesheet for the previous week.\n\n` +
                `Week : ${weekStartDate} to ${weekEndDate}\n` +
                `Reason: ${employeeRemarks || '(no reason provided)'}\n\n` +
                `Please login to the Manager portal to approve or reject.\n\n— Timesheet System`;
            if (mailer) {
                try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: manager.email, subject, text: body }); }
                catch (e) { cds.log('mail').warn('Prev-week request email failed:', e.message); }
            } else {
                cds.log('timesheet').info(`[Email simulated] TO: ${manager.email}\n${body}`);
            }
        }

        cds.log('timesheet').info(`Prev-week request ${requestId} created for ${emp.employeeId} week ${weekStartDate}`);
        return { requestId, status: 'Pending' };
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// MANAGER SERVICE handlers  (unchanged)
// ═════════════════════════════════════════════════════════════════════════════
async function registerManagerTimesheetHandlers(svc, getMailer, createNotification) {

    svc.on('approvePrevWeekRequest', async (req) => {
        const { requestId, approved, managerRemarks } = req.data;
        if (!requestId) return req.error(400, 'requestId is required.');

        const request = await SELECT.one.from(PREV_WEEK).where({ requestId });
        if (!request) return req.error(404, `Request '${requestId}' not found.`);
        if (request.status !== 'Pending')
            return req.error(400, `Request is already '${request.status}'.`);

        const newStatus = approved ? 'Approved' : 'Rejected';
        let   tsId      = null;

        if (approved) {
            tsId = `${request.employee_employeeId}-${request.weekStartDate}`;
            const existingHdr = await SELECT.one.from(HEADER).where({ timesheetId: tsId });
            if (!existingHdr) {
                await INSERT.into(HEADER).entries({
                    timesheetId:         tsId,
                    employee_employeeId: request.employee_employeeId,
                    weekStartDate:       request.weekStartDate,
                    weekEndDate:         request.weekEndDate,
                    status:              'PrevWeekApproved',
                    submissionType:      'Weekly',
                    isAutoApproved:      false
                });
            } else if (['Draft', 'Rejected'].includes(existingHdr.status)) {
                await UPDATE(HEADER).set({ status: 'PrevWeekApproved' }).where({ timesheetId: tsId });
            }
        }

        await UPDATE(PREV_WEEK)
            .set({ status: newStatus, managerRemarks: managerRemarks || '', resolvedOn: new Date(), timesheetId: tsId || null })
            .where({ requestId });

        const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId: request.employee_employeeId });
        if (emp && emp.email) {
            const mailer  = getMailer();
            const subject = approved
                ? `Previous Week Timesheet Approved — You can now fill it`
                : `Previous Week Timesheet Request Rejected`;
            const body =
                `Hi ${emp.employeeName || ''},\n\n` +
                (approved
                    ? `Your request to fill the timesheet for ${request.weekStartDate} to ${request.weekEndDate} has been APPROVED.\n`
                    : `Your request to fill the previous week timesheet was REJECTED.\n`) +
                (managerRemarks ? `\nManager Remarks: ${managerRemarks}\n` : '') +
                `\n— Timesheet System`;
            if (mailer) {
                try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: emp.email, subject, text: body }); }
                catch (e) { cds.log('mail').warn('Prev-week approval email failed:', e.message); }
            }
        }

        if (createNotification && emp) {
            await createNotification(
                emp.employeeId,
                approved ? 'PREVWEEK_APPROVED' : 'PREVWEEK_REJECTED',
                approved ? 'Previous Week Timesheet Approved ✓' : 'Previous Week Request Rejected ✗',
                approved
                    ? `You can now fill your timesheet for ${request.weekStartDate}.`
                    : `Your request for ${request.weekStartDate} was rejected.${managerRemarks ? ' Reason: ' + managerRemarks : ''}`,
                requestId
            );
        }

        cds.log('timesheet').info(`Prev-week request ${requestId} ${newStatus} by manager`);
        return { requestId, status: newStatus, timesheetId: tsId || '' };
    });

    // HR employees' missed-day requests are routed here (to their manager) and
    // approved on the manager's "Timesheet Fill Requests" tab.
    svc.on('approveDayUnlock', (req) =>
        approveDayUnlockImpl(req, getMailer, createNotification, 'manager'));
}

// ═════════════════════════════════════════════════════════════════════════════
// DAY-UNLOCK APPROVAL  (shared by HR and Manager services)
// Normal employees route missed-day requests to HR; HR employees route theirs
// to their reporting manager. Both approve through this same logic, which
// unlocks the day so the employee can fill it and notifies them of the outcome.
// ═════════════════════════════════════════════════════════════════════════════
async function approveDayUnlockImpl(req, getMailer, createNotification, approverRole) {
    const { requestId, approved, hrRemarks } = req.data;
    if (!requestId) return req.error(400, 'requestId is required.');

    const request = await SELECT.one.from(DAY_UNLOCK).where({ requestId });
    if (!request) return req.error(404, `Request '${requestId}' not found.`);
    if (request.status !== 'Pending')
        return req.error(400, `Request is already '${request.status}'.`);

    // A manager may only act on requests actually routed to them.
    if (approverRole === 'manager') {
        const u = req.user || {};
        const callerEmail = (((u.attr && (u.attr.email || u.attr.mail)) || u.id || '') + '').trim().toLowerCase();
        const me = callerEmail
            ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', callerEmail)
            : null;
        if (!me || request.hrApprover_employeeId !== me.employeeId)
            return req.error(403, 'You are not the assigned approver for this request.');
    }

    const newStatus = approved ? 'Approved' : 'Rejected';
    const byLabel   = approverRole === 'manager' ? 'Your manager' : 'HR';

    await UPDATE(DAY_UNLOCK)
        .set({ status: newStatus, hrRemarks: hrRemarks || '', resolvedOn: new Date() })
        .where({ requestId });

    if (approved) {
        const mon       = getMondayOfWeek(new Date());
        const weekStart = toISODate(mon);
        const tsId      = `${request.employee_employeeId}-${weekStart}`;
        await UPDATE(ENTRY)
            .set({ isLocked: false, entryStatus: 'Open' })
            .where({ timesheet_timesheetId: tsId, workDate: request.targetDate });
        cds.log('timesheet').info(`Day ${request.targetDate} unlocked for ${request.employee_employeeId} by ${approverRole}`);
    }

    const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId: request.employee_employeeId });
    if (emp && emp.email) {
        const mailer  = getMailer();
        const subject = approved ? `Day Unlock Approved — ${request.targetDate}` : `Day Unlock Request Rejected — ${request.targetDate}`;
        const body    =
            `Hi ${emp.employeeName || ''},\n\n` +
            (approved
                ? `Your request to fill your timesheet for ${request.targetDate} has been APPROVED by ${byLabel.toLowerCase()}.\n`
                : `Your request to unlock ${request.targetDate} was REJECTED by ${byLabel.toLowerCase()}.\n`) +
            (hrRemarks ? `\nRemarks: ${hrRemarks}\n` : '') +
            `\n— Timesheet System`;
        if (mailer) {
            try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: emp.email, subject, text: body }); }
            catch (e) { cds.log('mail').warn('Day-unlock approval email failed:', e.message); }
        }
    }

    if (createNotification && emp) {
        await createNotification(
            emp.employeeId,
            approved ? 'DAY_UNLOCK_APPROVED' : 'DAY_UNLOCK_REJECTED',
            approved ? `Day ${request.targetDate} Unlocked ✓` : `Day ${request.targetDate} Unlock Rejected ✗`,
            approved
                ? `${byLabel} approved your request to fill ${request.targetDate}.`
                : `${byLabel} rejected your unlock request for ${request.targetDate}.${hrRemarks ? ' Reason: ' + hrRemarks : ''}`,
            requestId
        );
    }

    return { requestId, status: newStatus };
}

// ═════════════════════════════════════════════════════════════════════════════
// HR SERVICE handlers
// ═════════════════════════════════════════════════════════════════════════════
async function registerHRTimesheetHandlers(svc, getMailer, createNotification) {

    svc.on('approveDayUnlock', (req) =>
        approveDayUnlockImpl(req, getMailer, createNotification, 'HR'));
}

// ═════════════════════════════════════════════════════════════════════════════
// DAILY REMINDERS
// FIX: Added consecutive 2-day miss detection with separate email + notification
// ═════════════════════════════════════════════════════════════════════════════
async function sendDailyReminders(getMailer, createNotification) {
    const today      = new Date();
    const todayStr   = toISODate(today);
    const dayOfWeek  = today.getDay(); // 0=Sun,6=Sat

    // Skip Sunday
    if (dayOfWeek === 0) {
        cds.log('reminder').info('Sunday — skipping reminder.');
        return;
    }

    cds.log('reminder').info(`Running 5 PM timesheet reminder for ${todayStr}`);

    const employees = await SELECT.from(EMPLOYEE).where({ isActive: true });
    const mon       = getMondayOfWeek(today);
    const weekStart = toISODate(mon);

    // Build list of past weekdays this week (Mon–today, excluding Sunday)
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        if (d > today) break;
        const iso = toISODate(d);
        if (d.getDay() !== 0) weekDays.push(iso); // skip Sunday
    }

    let reminderCount       = 0;
    let consecutiveCount    = 0;

    for (const emp of employees) {
        if (!emp.email) continue;

        const tsId = `${emp.employeeId}-${weekStart}`;
        const hdr  = await SELECT.one.from(HEADER).where({ timesheetId: tsId });

        // Skip if already submitted/approved
        if (hdr && ['Pending', 'Approved'].includes(hdr.status)) continue;

        // ── Check today's entry for standard daily reminder ───────────────
        const todayEntry = await SELECT.one.from(ENTRY).where({
            timesheet_timesheetId: tsId,
            workDate:              todayStr
        });

        const todayFilled = todayEntry && todayEntry.hoursWorked > 0;

        // ── Check for consecutive 2-day miss (current week only) ──────────
        // Get all filled dates this week for this employee
        const filledEntries = hdr
            ? await SELECT.from(ENTRY)
                .where({ timesheet_timesheetId: tsId })
                .columns('workDate', 'hoursWorked')
            : [];

        const filledDates = new Set(
            filledEntries
                .filter(e => e.hoursWorked > 0)
                .map(e => e.workDate)
        );

        // Find the last 2 past weekdays (before today)
        const pastDays = weekDays.filter(d => d < todayStr);
        let   consecutiveMissDays = [];

        if (pastDays.length >= 2) {
            const lastTwo = pastDays.slice(-2); // last 2 past weekdays
            const bothMissed = lastTwo.every(d => !filledDates.has(d));
            if (bothMissed) consecutiveMissDays = lastTwo;
        }

        const mailer = getMailer();

        // ── Send standard daily reminder if today not filled ─────────────
        if (!todayFilled) {
            const subject = `⏰ Reminder: Please fill your timesheet for today (${todayStr})`;
            const body    =
                `Hi ${emp.employeeName || 'Employee'},\n\n` +
                `This is a friendly reminder that your timesheet for today (${todayStr}) ` +
                `has not been filled yet.\n\n` +
                `Please login and fill your timesheet before end of day.\n\n` +
                `Note: You can fill today and the last 2 days directly. ` +
                `Older missed days require HR approval to unlock.\n\n` +
                `— Timesheet System`;

            if (mailer) {
                try {
                    await mailer.sendMail({
                        from: process.env.SMTP_FROM || 'no-reply@timesheet.local',
                        to: emp.email, subject, text: body
                    });
                    reminderCount++;
                } catch (e) {
                    cds.log('mail').warn(`Daily reminder failed for ${emp.email}:`, e.message);
                }
            } else {
                cds.log('reminder').info(`[Email simulated] TO: ${emp.email} SUBJECT: ${subject}`);
                reminderCount++;
            }
        }

        // ── Send consecutive 2-day miss alert (separate email + notification)
        if (consecutiveMissDays.length === 2) {
            consecutiveCount++;
            const [d1, d2] = consecutiveMissDays;
            const subject  = `⚠️ Timesheet Alert: You haven't filled timesheet for 2 consecutive days`;
            const body     =
                `Hi ${emp.employeeName || 'Employee'},\n\n` +
                `We noticed you haven't filled your timesheet for the last 2 working days:\n` +
                `  • ${d1}\n` +
                `  • ${d2}\n\n` +
                `Please login and fill your timesheet as soon as possible.\n\n` +
                `You can fill these dates directly from the timesheet page ` +
                `(within the 2-day fill window). If the dates are older, ` +
                `you will need to request HR approval.\n\n` +
                `— Timesheet System`;

            if (mailer) {
                try {
                    await mailer.sendMail({
                        from: process.env.SMTP_FROM || 'no-reply@timesheet.local',
                        to: emp.email, subject, text: body
                    });
                } catch (e) {
                    cds.log('mail').warn(`Consecutive miss alert failed for ${emp.email}:`, e.message);
                }
            } else {
                cds.log('reminder').info(`[Email simulated — consecutive miss] TO: ${emp.email}`);
            }

            // ── In-app notification ───────────────────────────────────────
            if (createNotification) {
                try {
                    await createNotification(
                        emp.employeeId,
                        'TIMESHEET_CONSECUTIVE_MISS',
                        '⚠️ Timesheet Not Filled for 2 Days',
                        `You haven't filled your timesheet for ${d1} and ${d2}. Please fill it now.`,
                        null
                    );
                } catch (e) {
                    cds.log('reminder').warn(`Notification failed for ${emp.employeeId}:`, e.message);
                }
            }
        }
    }

    cds.log('reminder').info(
        `Daily reminders sent: ${reminderCount}. Consecutive miss alerts: ${consecutiveCount}.`
    );
}

module.exports = {
    registerTimesheetHandlers,
    registerManagerTimesheetHandlers,
    registerHRTimesheetHandlers,
    sendDailyReminders
};