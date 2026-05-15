const cds = require('@sap/cds');

const HEADER = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';
const EMPLOYEE = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeMaster';
const LEAVE_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.LeaveRequest';
const TASK = 'ccentrik.employee.timesheet.schema.timesheet.TaskMaster';
const PERFORMANCE_RATING = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
const NOTIFICATION = 'ccentrik.employee.timesheet.schema.timesheet.Notification';
const ATTENDANCE = 'ccentrik.employee.timesheet.schema.timesheet.AttendanceRecord';

const PRIORITY_PREFIX = {
    'High': '[HIGH PRIORITY]',
    'Medium': '[Medium Priority]',
    'Low': '[Low Priority]'
};

// Lazy-load nodemailer so the service still works even if it isn't installed.
let _mailer = null;
function getMailer() {
    if (_mailer !== null) return _mailer;
    try {
        const nodemailer = require('nodemailer');
        const host = process.env.SMTP_HOST;
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!host || !user || !pass) {
            _mailer = false;
            return _mailer;
        }
        _mailer = nodemailer.createTransport({
            host, port, secure: port === 465,
            auth: { user, pass }
        });
    } catch (e) {
        _mailer = false;
    }
    return _mailer;
}
// ── Notification helper ───────────────────────────────────────────────────
// Called from any handler to create a Notification row. Fire-and-forget:
// errors are logged but never bubble up to disrupt the parent operation.
async function createNotification(employeeId, type, title, message, referenceId) {
    try {
        const notificationId = `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        await INSERT.into(NOTIFICATION).entries({
            notificationId,
            employee_employeeId: employeeId,
            type,
            title,
            message,
            isRead: false,
            referenceId: referenceId || '',
            notifiedAt: new Date()
        });
    } catch (e) {
        cds.log('notif').warn('Could not create notification:', e.message || e);
    }
}

class EmployeeService extends cds.ApplicationService {
    async init() {

        // Expose current user role to frontend
        this.on('getUserRole', (req) => {
            const user = req.user;
            if (user.is('HR')) return { role: 'hr' };
            if (user.is('Manager')) return { role: 'manager' };
            if (user.is('Employee')) return { role: 'employee' };
            return { role: 'unknown' };
        });

        // Resolve the JWT user (from XSUAA / IAS) against EmployeeMaster
        // by email and return the matched employee record. Falls back
        // gracefully when no matching record exists so the UI can still
        // render a usable header instead of crashing.
        this.on('getCurrentUser', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id
                || '';
            // HR scope wins over Manager wins over Employee — matches the
            // sidebar gating priority on the frontend.
            const role = user.is && user.is('HR') ? 'hr'
                : user.is && user.is('Manager') ? 'manager'
                    : user.is && user.is('Employee') ? 'employee'
                        : 'unknown';

            let emp = null;
            if (email) {
                emp = await SELECT.one
                    .from(EMPLOYEE)
                    .where({ email: email });
            }

            if (!emp) {
                // No EmployeeMaster row for this login — return a
                // minimal record built from the JWT itself so the
                // frontend can still greet them by name.
                return {
                    email: email,
                    role: role,
                    employeeId: '',
                    employeeName: (user.attr && user.attr.given_name)
                        || (email && email.split('@')[0])
                        || 'User',
                    designation: '',
                    address: '',
                    mobileNumber: '',
                    managerId: '',
                    isActive: true
                };
            }

            return {
                email: emp.email || email,
                role: role,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName || '',
                designation: emp.designation || '',
                address: emp.address || '',
                mobileNumber: emp.mobileNumber || '',
                managerId: emp.manager_employeeId || '',
                isActive: emp.isActive !== false
            };
        });

        this.on('submitTimesheet', async (req) => {
            const { timesheetId } = req.data;

            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) {
                return req.error(404, `Timesheet '${timesheetId}' not found.`);
            }

            if (!['Draft', 'Rejected'].includes(header.status)) {
                return req.error(400,
                    `Cannot submit — current status is '${header.status}'. ` +
                    `Only 'Draft' or 'Rejected' timesheets can be submitted.`
                );
            }

            await UPDATE(HEADER)
                .set({ status: 'Pending',  submittedOn: new Date() })
                .where({ timesheetId });

            await UPDATE(ENTRY)
                .set({ isLocked: true, entryStatus: 'Locked' })
                .where({ timesheet_timesheetId: timesheetId });

            return `Timesheet '${timesheetId}' submitted. Waiting for manager approval.`;
        });

        // ── Single-shot download of the manager attachment ───────────────
        // Reads the bytes, returns them as base64, then NULLs the columns
        // so HANA storage is freed and the link won't reappear elsewhere.
        this.on('consumeTaskAttachment', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');

            const task = await SELECT.one
                .from(TASK)
                .columns('taskId', 'attachment', 'attachmentName', 'attachmentMimeType')
                .where({ taskId });

            if (!task) {
                return req.error(404, `Task '${taskId}' not found.`);
            }
            if (!task.attachment || !task.attachmentName) {
                return req.error(404, 'No attachment available for this task.');
            }

            // Normalise binary → base64.
            let base64 = '';
            try {
                if (Buffer.isBuffer(task.attachment)) {
                    base64 = task.attachment.toString('base64');
                } else if (typeof task.attachment === 'string') {
                    // Some drivers return base64 directly.
                    base64 = task.attachment;
                } else if (task.attachment instanceof Uint8Array) {
                    base64 = Buffer.from(task.attachment).toString('base64');
                } else {
                    base64 = Buffer.from(task.attachment).toString('base64');
                }
            } catch (e) {
                cds.log('attach').error('Could not encode attachment:', e.message || e);
                return req.error(500, 'Could not read attachment.');
            }

            const result = {
                fileName: task.attachmentName,
                mimeType: task.attachmentMimeType || 'application/octet-stream',
                dataBase64: base64
            };

            // Free the bytes immediately so the file is gone after one
            // successful download (per product spec).
            try {
                await UPDATE(TASK)
                    .set({ attachment: null, attachmentName: null, attachmentMimeType: null })
                    .where({ taskId });
            } catch (e) {
                cds.log('attach').warn(`Failed to clear attachment for ${taskId}:`, e.message || e);
                // We still return the result — the user already has the bytes.
            }

            return result;
        });

<<<<<<< HEAD
=======
        this.on('getPerformanceRating', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where({ email });

            if (!emp) {
                return {
                    ratingValue: 0,
                    ratingCategory: 'N/A',
                    reviewMonth: 0,
                    reviewYear: 0,
                    reviewComment: ''
                };
            }

            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

            // Get the most recent rating — highest year then month
            const ratings = await SELECT.from(PERF)
                .where({ employee_employeeId: emp.employeeId })
                .orderBy('reviewYear desc', 'reviewMonth desc')
                .limit(1);

            if (!ratings || ratings.length === 0) {
                return {
                    ratingValue: 0,
                    ratingCategory: 'N/A',
                    reviewMonth: 0,
                    reviewYear: 0,
                    reviewComment: ''
                };
            }

            const r = ratings[0];
            const val = parseFloat(r.ratingValue) || 0;
            const category = val >= 4.5 ? 'Excellent'
                : val >= 3.5 ? 'Good'
                    : val >= 2.5 ? 'Average'
                        : val > 0 ? 'Needs Improvement'
                            : 'N/A';

            return {
                ratingValue: val,
                ratingCategory: category,
                reviewMonth: r.reviewMonth || 0,
                reviewYear: r.reviewYear || 0,
                reviewComment: r.reviewComment || ''
            };
        });


        this.on('getPerformanceTrend', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';
            const year = req.data.year || new Date().getFullYear();

            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where({ email });

            if (!emp) {
                return { trendJSON: JSON.stringify(Array(12).fill(null)) };
            }

            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

            const ratings = await SELECT.from(PERF)
                .where({
                    employee_employeeId: emp.employeeId,
                    reviewYear: year
                })
                .orderBy('reviewMonth asc');

            // Build 12-slot array — null for months with no rating
            const MONTH_NAMES = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
            ];

            const slots = Array(12).fill(null);
            ratings.forEach(r => {
                const idx = (r.reviewMonth || 1) - 1;
                if (idx >= 0 && idx < 12) {
                    slots[idx] = {
                        rating: parseFloat(r.ratingValue) || null,
                        comment: r.reviewComment || "",
                        category: r.ratingCategory || ""
                    };
                }
            });

            // Return as array directly — controller reads oData directly
            // Also return as trendJSON string for backward compatibility
            return {
                trendJSON: JSON.stringify(slots)
            };
        });




>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        this.on('applyLeave', async (req) => {
            const { employeeId, leaveType, fromDate, toDate, days, reason, isUnpaid } = req.data;

            if (!employeeId) return req.error(400, 'employeeId is required.');
            if (!leaveType) return req.error(400, 'leaveType is required.');
            if (!fromDate) return req.error(400, 'fromDate is required.');
            if (!toDate) return req.error(400, 'toDate is required.');
            if (!days) return req.error(400, 'days is required.');
            if (!reason) return req.error(400, 'reason is required.');

            // Block founders from applying leave
            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            if (emp.designation && emp.designation.toLowerCase() === 'founder') {
                return req.error(403, 'Founders are not eligible to apply for leave.');
            }

            const leaveId = `${employeeId}-LV-${Date.now()}`;

            await INSERT.into(LEAVE_REQUEST).entries({
                leaveId,
                employee_employeeId: employeeId,
                leaveType,
                fromDate,
                toDate,
                days,
                reason,
                status: 'Pending',
                isUnpaid: isUnpaid || false
                // cascade is stored as a JSON string in managerRemarks temporarily
                // OR: add cascadeSick/cascadeCasual/cascadePaid columns to the schema.
                // Simplest: store it in a spare string field for now.
            });

            // After INSERT, if cascade was passed, log it (for auditability)
            const cascadeStr = req.data.cascade || null;
            if (cascadeStr) {
                cds.log('leave').info(`Cascade breakdown for ${leaveId}: ${cascadeStr}`);
            }

            //cds.log('leave').info(`Leave request ${leaveId} submitted by ${employeeId}`);

            // Notify manager via email if SMTP configured
            if (emp.manager_employeeId) {
                const manager = await SELECT.one.from(EMPLOYEE)
                    .where({ employeeId: emp.manager_employeeId });
                if (manager && manager.email) {
                    const mailer = getMailer();
                    const subject = `Leave Request from ${emp.employeeName}`;
                    const body =
                        `Hi ${manager.employeeName || 'Manager'},\n\n` +
                        `${emp.employeeName} has applied for leave.\n\n` +
                        `Leave Type : ${leaveType}\n` +
                        `From       : ${fromDate}\n` +
                        `To         : ${toDate}\n` +
                        `Days       : ${days}${isUnpaid ? ' (includes unpaid days)' : ''}\n` +
                        `Reason     : ${reason}\n\n` +
                        `Please login to the Timesheet app to approve or reject.\n\n` +
                        `— Timesheet System`;

                    if (mailer) {
                        try {
                            await mailer.sendMail({
                                from: process.env.SMTP_FROM || 'no-reply@timesheet.local',
                                to: manager.email,
                                subject,
                                text: body
                            });
                        } catch (e) {
                            cds.log('mail').warn('Leave notification email failed:', e.message);
                        }
                    } else {
                        cds.log('leave').info(`[Email simulated] TO: ${manager.email}\n${body}`);
                    }
                }
            }

            return { leaveId, status: 'Pending', isUnpaid: isUnpaid || false };
        });

        // ── Dashboard: Recent Notifications ───────────────────────────────────────
        this.on('getRecentNotifications', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';

            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return [];

            const rows = await SELECT.from(NOTIFICATION)
                .where({ employee_employeeId: emp.employeeId })
                .orderBy({ notifiedAt: 'desc' })
                .limit(5);

            return (rows || []).map(n => ({
                notificationId: n.notificationId,
                type: n.type || '',
                title: n.title || '',
                message: n.message || '',
                isRead: n.isRead || false,
                referenceId: n.referenceId || '',
                notifiedAt: n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));
        });

        // ── Dashboard: Upcoming Calendar (Google Calendar API) ─────────────────────
        // Reads GOOGLE_CALENDAR_API_KEY + GOOGLE_CALENDAR_ID from environment.
        // Falls back to empty array if not configured — card shows "No events".
        this.on('getUpcomingCalendar', async (req) => {
            const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
            const calendarId = process.env.GOOGLE_CALENDAR_ID; // usually the employee's email

            if (!apiKey || !calendarId) {
                // Not configured — return empty so frontend shows graceful empty state
                return { eventsJSON: JSON.stringify([]) };
            }

            try {
                const now = new Date();
                const maxTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // next 7 days
                const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
                    `?key=${apiKey}` +
                    `&timeMin=${now.toISOString()}` +
                    `&timeMax=${maxTime.toISOString()}` +
                    `&singleEvents=true` +
                    `&orderBy=startTime` +
                    `&maxResults=5`;

                // Use built-in fetch (Node 18+) or fallback to https module
                let body;
                if (typeof fetch !== 'undefined') {
                    const res = await fetch(url);
                    body = await res.json();
                } else {
                    const https = require('https');
                    body = await new Promise((resolve, reject) => {
                        https.get(url, res => {
                            let data = '';
                            res.on('data', chunk => data += chunk);
                            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
                        }).on('error', reject);
                    });
                }

                const todayStr = now.toDateString();
                const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                const events = (body.items || []).map(ev => {
                    const start = new Date(ev.start.dateTime || ev.start.date);
                    const end = new Date(ev.end.dateTime || ev.end.date);
                    const isToday = start.toDateString() === todayStr;
                    const isTomorrow = start.toDateString() === new Date(now.getTime() + 86400000).toDateString();

                    // Format: "10:00 AM – 10:30 AM"
                    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    const timeLabel = ev.start.dateTime ? `${fmt(start)} – ${fmt(end)}` : 'All Day';
                    const dateLabel = isToday ? 'Today'
                        : isTomorrow ? 'Tomorrow'
                            : `${DAY_NAMES[start.getDay()]}, ${MON_NAMES[start.getMonth()]} ${start.getDate()}`;

                    return {
                        id: ev.id,
                        title: ev.summary || 'Untitled Event',
                        start: start.toISOString(),
                        end: end.toISOString(),
                        timeLabel,
                        dateLabel,
                        isToday,
                        colorId: ev.colorId || '1'
                    };
                });

                return { eventsJSON: JSON.stringify(events) };
            } catch (e) {
                cds.log('calendar').warn('Google Calendar fetch failed:', e.message || e);
                return { eventsJSON: JSON.stringify([]) };
            }
        });

        // ── Dashboard: My Leave Overview ───────────────────────────────────────────
        // Returns remaining leave balance + how much has been taken this year.
        // "Taken" is approximated from LeaveBalance initial allotment vs current.
        // Your colleague's leave-request module should decrement LeaveBalance when
        // a leave is approved — this handler just reads what's already stored.
        this.on('getLeaveOverview', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';

            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) {
                return {
                    casual: 0, sick: 0, annual: 0, unpaid: 0, totalDays: 0,
                    takenJSON: JSON.stringify([])
                };
            }

            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one.from(LEAVE_BALANCE)
                .where({ employee_employeeId: emp.employeeId });

            // Standard annual allotments (adjust to match your HR policy)
            const ALLOTMENT = { casual: 12, sick: 8, annual: 15, unpaid: 0 };

            const casual = balance ? (balance.casualLeave || 0) : ALLOTMENT.casual;
            const sick = balance ? (balance.sickLeave || 0) : ALLOTMENT.sick;
            const annual = balance ? (balance.annualLeave || 0) : ALLOTMENT.annual;
            const unpaid = 0; // extend LeaveBalance entity if you track unpaid leave

            // "Taken" = allotment minus remaining balance
            const takenCasual = Math.max(0, ALLOTMENT.casual - casual);
            const takenSick = Math.max(0, ALLOTMENT.sick - sick);
            const takenAnnual = Math.max(0, ALLOTMENT.annual - annual);

            const totalDays = casual + sick + annual + unpaid;

            const takenData = [
                { type: 'casual', label: 'Casual Leave', taken: takenCasual, balance: casual, color: '#16a34a' },
                { type: 'sick', label: 'Sick Leave', taken: takenSick, balance: sick, color: '#3b82f6' },
                { type: 'annual', label: 'Annual Leave', taken: takenAnnual, balance: annual, color: '#f59e0b' },
                { type: 'unpaid', label: 'Unpaid Leave', taken: 0, balance: 0, color: '#9ca3af' }
            ];

            return { casual, sick, annual, unpaid, totalDays, takenJSON: JSON.stringify(takenData) };
        });

        // ── Dashboard: Work Anniversary ────────────────────────────────
        // Calculate years completed since joining date for the logged-in employee.
        this.on('getWorkAnniversary', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id
                || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId', 'employeeName', 'joiningDate')
                .where({ email: email });

            if (!emp || !emp.joiningDate) {
                return {
                    yearsCompleted: 0,
                    joiningDate: null,
                    message: 'No joining date found.'
                };
            }

            const joining = new Date(emp.joiningDate);
            const today = new Date();
            const years = today.getFullYear() - joining.getFullYear();
            const months = today.getMonth() - joining.getMonth();
            const days = today.getDate() - joining.getDate();

            // Calculate exact years with decimal precision
            let yearsCompleted = years;
            if (months < 0 || (months === 0 && days < 0)) {
                yearsCompleted = years - 1;
            }
            const totalDays = (today - joining) / (1000 * 60 * 60 * 24);
            yearsCompleted = Math.max(0, totalDays / 365.25);

            const message = yearsCompleted >= 1
                ? `Congratulations! You have completed ${Math.floor(yearsCompleted)} years with us.`
                : `Welcome! You joined on ${joining.toLocaleDateString()}`;

            return {
                yearsCompleted: parseFloat(yearsCompleted.toFixed(2)),
                joiningDate: emp.joiningDate,
                message: message
            };
        });


        // ── Dashboard: Performance Rating ─────────────────────────────────────────
        // Fetches the most-recent PerformanceRating row for the logged-in employee.
this.on('getPerformanceRating', async (req) => {
    const user  = req.user || {};
    const email = (user.attr && (user.attr.email || user.attr.mail))
               || user.id || '';

    const emp = await SELECT.one.from(EMPLOYEE)
        .columns('employeeId')
        .where({ email });

    if (!emp) {
        return {
            ratingValue:    0,
            ratingCategory: 'N/A',
            reviewMonth:    0,
            reviewYear:     0,
            reviewComment:  ''
        };
    }

    const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

    // Get the most recent rating — highest year then month
    const ratings = await SELECT.from(PERF)
        .where({ employee_employeeId: emp.employeeId })
        .orderBy('reviewYear desc', 'reviewMonth desc')
        .limit(1);

    if (!ratings || ratings.length === 0) {
        return {
            ratingValue:    0,
            ratingCategory: 'N/A',
            reviewMonth:    0,
            reviewYear:     0,
            reviewComment:  ''
        };
    }

    const r        = ratings[0];
    const val      = parseFloat(r.ratingValue) || 0;
    const category = val >= 4.5 ? 'Excellent'
                   : val >= 3.5 ? 'Good'
                   : val >= 2.5 ? 'Average'
                   : val >  0   ? 'Needs Improvement'
                   : 'N/A';

    return {
        ratingValue:    val,
        ratingCategory: category,
        reviewMonth:    r.reviewMonth  || 0,
        reviewYear:     r.reviewYear   || 0,
        reviewComment:  r.reviewComment || ''
    };
});

        // ── Dashboard: Performance Trend ──────────────────────────────────────────
        // Returns all monthly ratings for the current (or requested) year,
        // sorted Jan→Dec, so the frontend can draw a line chart.
this.on('getPerformanceTrend', async (req) => {
    const user  = req.user || {};
    const email = (user.attr && (user.attr.email || user.attr.mail))
               || user.id || '';
    const year  = req.data.year || new Date().getFullYear();

    const emp = await SELECT.one.from(EMPLOYEE)
        .columns('employeeId')
        .where({ email });

    if (!emp) {
        return { trendJSON: JSON.stringify(Array(12).fill(null)) };
    }

    const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

    const ratings = await SELECT.from(PERF)
        .where({
            employee_employeeId: emp.employeeId,
            reviewYear:          year
        })
        .orderBy('reviewMonth asc');

    // Build 12-slot array — null for months with no rating
    const MONTH_NAMES = [
        'Jan','Feb','Mar','Apr','May','Jun',
        'Jul','Aug','Sep','Oct','Nov','Dec'
    ];

    const slots = Array(12).fill(null);
    ratings.forEach(r => {
        const idx = (r.reviewMonth || 1) - 1;
        if (idx >= 0 && idx < 12) {
            slots[idx] = parseFloat(r.ratingValue) || null;
        }
    });

    // Return as array directly — controller reads oData directly
    // Also return as trendJSON string for backward compatibility
    return {
        trendJSON: JSON.stringify(slots)
    };
});


        // ── Dashboard: Task Summary ────────────────────────────────────────────────
        // Reuses existing TaskMaster entity.  Counts tasks by status for the
        // logged-in employee.  No duplicate entity or service is created.
        this.on('getTaskSummary', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            if (!emp) {
                return { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 };
            }

            const tasks = await SELECT
                .from(TASK)
                .where({ assignedTo_employeeId: emp.employeeId });

            let notStarted = 0, inProgress = 0, inReview = 0, completed = 0;

            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                if (s === 'notstarted') notStarted++;
                else if (s === 'inprogress') inProgress++;
                else if (s === 'inreview') inReview++;
                else if (s === 'completed') completed++;
                // 'closed' intentionally omitted from chart — adjust if needed
            });

            return {
                total: notStarted + inProgress + inReview + completed,
                notStarted: notStarted,
                inProgress: inProgress,
                inReview: inReview,
                completed: completed
            };
        });

        // ── Dashboard: Leave Balance ───────────────────────────────────
        // Get leave balance for the logged-in employee.
        // Fetches or creates default balance data.
        this.on('getLeaveBalance', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id
                || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            if (!emp) {
                return {
                    casualLeave: 0,
                    sickLeave: 0,
                    annualLeave: 0,
                    total: 0
                };
            }

            // Try to fetch the balance; if it doesn't exist, return defaults
            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one
                .from(LEAVE_BALANCE)
                .where({ employee_employeeId: emp.employeeId });

            if (balance) {
                const total = (balance.casualLeave || 0) + (balance.sickLeave || 0) + (balance.annualLeave || 0);
                return {
                    casualLeave: balance.casualLeave || 0,
                    sickLeave: balance.sickLeave || 0,
                    annualLeave: balance.annualLeave || 0,
                    total: total
                };
            }

            // Return default values if no balance record exists
            return {
                casualLeave: 6,
                sickLeave: 4,
                annualLeave: 8,
                total: 18
            };
        });

        // ── Dashboard: My Tasks ────────────────────────────────────────
        // Get summary of tasks assigned to the logged-in employee.
        // Returns counts of pending and high-priority tasks.
        this.on('getMyTasks', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            if (!emp) {
                return {
                    totalPending: 0,
                    highPriorityCount: 0,
                    mediumPriorityCount: 0,
                    lowPriorityCount: 0
                };
            }

            const tasks = await SELECT.from(TASK)
                .where({ assignedTo_employeeId: emp.employeeId });

            let totalPending = 0;
            let highPriorityCount = 0;
            let mediumPriorityCount = 0;
            let lowPriorityCount = 0;

            tasks.forEach(t => {
                if (t.status && t.status !== 'Completed' && t.status !== 'Closed') {
                    totalPending++;
                    if (t.priority === 'High') highPriorityCount++;
                    else if (t.priority === 'Medium') mediumPriorityCount++;
                    else if (t.priority === 'Low') lowPriorityCount++;
                }
            });

            return {
                totalPending,
                highPriorityCount,
                mediumPriorityCount,
                lowPriorityCount
            };
        });

        // ── Mark Attendance ───────────────────────────────────────────────────
        this.on('markAttendance', async (req) => {
            const { attendanceDate, attendanceDay, attendanceTime } = req.data;
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            if (!attendanceDate) return req.error(400, 'attendanceDate is required.');

            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId', 'employeeName')
                .where({ email });

            if (!emp) return req.error(404, 'Employee not found for this login.');

            // Prevent duplicate marking for the same day
            const existing = await SELECT.one.from(ATTENDANCE)
                .where({
                    employee_employeeId: emp.employeeId,
                    attendanceDate: attendanceDate
                });

            if (existing) {
                return req.error(409,
                    `Attendance already marked for ${attendanceDate} at ${existing.attendanceTime}.`
                );
            }

            const attendanceId = `${emp.employeeId}-${attendanceDate}`;

            await INSERT.into(ATTENDANCE).entries({
                attendanceId,
                employee_employeeId: emp.employeeId,
                attendanceDate,
                attendanceDay: attendanceDay || '',
                attendanceTime: attendanceTime || new Date().toTimeString().split(' ')[0],
                status: 'Present'
            });

            cds.log('attend').info(
                `Attendance marked: ${emp.employeeId} (${emp.employeeName}) ` +
                `on ${attendanceDate} at ${attendanceTime}`
            );

            return {
                attendanceId,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName,
                attendanceDate,
                attendanceDay,
                attendanceTime,
                message: `Attendance recorded successfully for ${attendanceDay}, ${attendanceDate}.`
            };
        }),

            // ── Check Today Attendance ────────────────────────────────────────────
<<<<<<< HEAD
            this.on('getTodayAttendance', async (req) => {
                const { attendanceDate } = req.data;
=======
            this.on('getAttendance', async (req) => {
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
                const user = req.user || {};
                const email = (user.attr && (user.attr.email || user.attr.mail))
                    || user.id || '';

                const emp = await SELECT.one.from(EMPLOYEE)
                    .columns('employeeId')
                    .where({ email });

<<<<<<< HEAD
                if (!emp) return { alreadyMarked: false };

                const existing = await SELECT.one.from(ATTENDANCE)
                    .where({
                        employee_employeeId: emp.employeeId,
                        attendanceDate: attendanceDate
                    });

                return {
                    alreadyMarked: !!existing,
                    attendanceTime: existing ? existing.attendanceTime : null,
                    attendanceDay: existing ? existing.attendanceDay : null
                };
            });

        this.before('READ', 'MyTasks', async (req) => {
            const user = req.user;

            // Managers see all tasks — no filter applied
            if (user.is('Manager')) return;

            // Resolve email — works for both mocked auth and XSUAA JWT
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id
                || '';

            if (!email) return;

            // Lookup employee by email — same logic as getCurrentUser()
            // Works identically in dev (mocked) and prod (XSUAA) because
            // both ultimately resolve to the same email address
            const emp = await SELECT.one
                .from(EMPLOYEE)
                .where({ email });

            if (!emp) return;

            // Filter at DB level — employee only sees their own tasks
            req.query.where({ assignedTo_employeeId: emp.employeeId });
        });

        // ── Filter MyNotifications to only show the logged-in employee's ──
        // Works with mocked auth (email via attr) and XSUAA (email from JWT)
        this.before('READ', 'MyNotifications', async (req) => {
            const user  = req.user;
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';
            if (!email) return;
 
            const emp = await SELECT.one.from(EMPLOYEE).where({ email });
            if (!emp) return;
 
            req.query.where({ employee_employeeId: emp.employeeId });
        });
 
        // ── Filter MyTasks to only show the logged-in employee's tasks ───
        // Managers see all; employees only see their own.
        this.before('READ', 'MyTasks', async (req) => {
            const user = req.user;
            if (user.is('Manager')) return; // managers see all
 
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';
            if (!email) return;
 
            const emp = await SELECT.one.from(EMPLOYEE).where({ email });
            if (!emp) return;
 
            req.query.where({ assignedTo_employeeId: emp.employeeId });
        });
 
        // ── createTaskNotification action ────────────────────────────────
        // Called by the manager's TaskAssignment controller after a task
        // is created. Inserts a Notification row for the assigned employee.
        // The manager calls /employee/createTaskNotification (not /manager)
        // so it uses the EMPLOYEE const already defined in this file.
        this.on('createTaskNotification', async (req) => {
            const { employeeId, type, title, message, referenceId } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
 
            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
 
            await createNotification(employeeId, type, title, message, referenceId);
            return true;
        });
 
        // ── markNotificationsRead action ─────────────────────────────────
        // Marks one or more notifications as read for the logged-in employee.
        this.on('markNotificationsRead', async (req) => {
            const { notificationIds } = req.data;
            if (!notificationIds || !notificationIds.length) return true;
 
            for (const nid of notificationIds) {
                await UPDATE(NOTIFICATION)
                    .set({ isRead: true })
                    .where({ notificationId: nid });
            }
            return true;
        });

=======
                if (!emp) {
                    return {
                        attendancePercentage: 0,
                        presentCount: 0,
                        absentCount: 0,
                        monthLabel: new Date().toLocaleString('default', { month: 'long' })
                    };
                }

                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;
                const monthStr = String(month).padStart(2, '0');

                // Fetch all attendance records for current month
                const records = await SELECT.from(ATTENDANCE)
                    .where(`employee_employeeId = '${emp.employeeId}'
            AND attendanceDate LIKE '${year}-${monthStr}-%'`);

                const presentCount = records.length;

                // Count working days (Mon-Fri) from 1st of month up to today
                let workingDays = 0;
                const d = new Date(year, month - 1, 1);
                while (d <= now && d.getMonth() === month - 1) {
                    const day = d.getDay();
                    if (day !== 0 && day !== 6) workingDays++;
                    d.setDate(d.getDate() + 1);
                }

                const absentCount = Math.max(0, workingDays - presentCount);
                const attendancePercentage = workingDays > 0
                    ? Math.round((presentCount / workingDays) * 100)
                    : 0;

                return {
                    attendancePercentage,
                    presentCount,
                    absentCount,
                    monthLabel: now.toLocaleString('default', { month: 'long' })
                };
            });

        this.on('getTodayAttendance', async (req) => {
            const { attendanceDate } = req.data;
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where({ email });

            if (!emp) {
                return { alreadyMarked: false, attendanceTime: null, attendanceDay: null };
            }

            const existing = await SELECT.one.from(ATTENDANCE)
                .where({
                    employee_employeeId: emp.employeeId,
                    attendanceDate: attendanceDate
                });

            return {
                alreadyMarked: !!existing,
                attendanceTime: existing ? existing.attendanceTime : null,
                attendanceDay: existing ? existing.attendanceDay : null
            };
        });

>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        return super.init();
    }
}

class ManagerService extends cds.ApplicationService {
    async init() {

        this.on('approveTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;

            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) {
                return req.error(404, `Timesheet '${timesheetId}' not found.`);
            }

            if (header.status !== 'Pending') {
                return req.error(400,
                    `Cannot approve — current status is '${header.status}'. ` +
                    `Only 'Pending' timesheets can be approved.`
                );
            }

            await UPDATE(HEADER)
                .set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' })
                .where({ timesheetId });

            // Auto-notify employee
            const hdr = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr) await createNotification(
                hdr.employee_employeeId,
                'TIMESHEET_APPROVED',
                'Timesheet Approved ✓',
                `Your timesheet ${timesheetId} has been approved.${remarks ? ' Remarks: ' + remarks : ''}`,
                timesheetId
            );

            await UPDATE(ENTRY)
                .set({ isLocked: true, entryStatus: 'Approved' })
                .where({ timesheet_timesheetId: timesheetId });

            return `Timesheet '${timesheetId}' approved.`;
        });


this.on('submitPerformanceRating', async (req) => {
    const {
        employeeId, ratingValue, reviewMonth,
        reviewYear, reviewComment, ratingCategory
    } = req.data;

    if (!employeeId)  return req.error(400, 'employeeId is required.');
    if (!ratingValue) return req.error(400, 'ratingValue is required.');
    if (!reviewMonth) return req.error(400, 'reviewMonth is required.');
    if (!reviewYear)  return req.error(400, 'reviewYear is required.');

    const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

    // Check if rating already exists for this employee/month/year
    const existing = await SELECT.one.from(PERF)
        .where({
            employee_employeeId: employeeId,
            reviewMonth:         reviewMonth,
            reviewYear:          reviewYear
        });

    const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2,'0')}`;

    if (existing) {
        // Update existing rating
        await UPDATE(PERF)
            .set({
                ratingValue:    ratingValue,
                reviewComment:  reviewComment || '',
                ratingCategory: ratingCategory || ''
            })
            .where({ ratingId: existing.ratingId });

        cds.log('perf').info(
            `Rating updated: ${employeeId} — ${reviewMonth}/${reviewYear} — ${ratingValue}`
        );
        return {
            ratingId: existing.ratingId,
            message:  `Rating updated for ${employeeId} — ${reviewMonth}/${reviewYear}`
        };
    }

    // Insert new rating
    await INSERT.into(PERF).entries({
        ratingId,
        employee_employeeId: employeeId,
        ratingValue:         ratingValue,
        reviewMonth:         reviewMonth,
        reviewYear:          reviewYear,
        reviewComment:       reviewComment  || '',
        ratingCategory:      ratingCategory || ''
    });

    cds.log('perf').info(
        `Rating added: ${employeeId} — ${reviewMonth}/${reviewYear} — ${ratingValue}`
    );
    return {
        ratingId,
        message: `Rating submitted for ${employeeId} — ${reviewMonth}/${reviewYear}`
    };
});

        this.on('notifyTaskAssignment', async (req) => {
            const {
                taskId, taskName, taskDescription,
                priority, dueDate, assigneeId
            } = req.data;

            const employee = await SELECT.one.from(EMPLOYEE).where({ employeeId: assigneeId });
            if (!employee) {
                return req.error(404, `Employee '${assigneeId}' not found.`);
            }
            if (!employee.email) {
                return req.error(400, `Employee '${assigneeId}' has no email on file.`);
            }

            const prefix = PRIORITY_PREFIX[priority] || `[${priority || 'Normal'} Priority]`;
            const subject = `${prefix} New task assigned: ${taskName}`;
            const body =
                `Hi ${employee.employeeName || ''},\n\n` +
                `You have been assigned a new task by your manager.\n\n` +
                `Task ID:     ${taskId}\n` +
                `Task:        ${taskName}\n` +
                `Priority:    ${priority || 'Normal'}\n` +
                (dueDate ? `Due Date:    ${dueDate}\n` : '') +
                `\nDescription:\n${taskDescription || '(no description)'}\n\n` +
                `Please open your Timesheet app to view the full details.\n\n` +
                `— Timesheet System`;

            const from = process.env.SMTP_FROM || 'no-reply@timesheet.local';
            const mailer = getMailer();

            if (mailer) {
                try {
                    await mailer.sendMail({ from, to: employee.email, subject, text: body });
                    cds.log('mail').info(`Task-assignment email sent to ${employee.email} (${taskId})`);
                    return { sent: true, recipient: employee.email, subject, message: 'Email sent.' };
                } catch (e) {
                    cds.log('mail').error('Failed to send email:', e.message || e);
                    // fall through to logged-only mode
                }
            }

            await createNotification(
                assigneeId,
                'TASK_ASSIGNED',
                `New Task: ${taskName}`,
                `You have been assigned "${taskName}" (${priority || 'Normal'} priority).`,
                taskId
            );

            // No SMTP configured — log the message so we have a reproducible trail.
            cds.log('mail').info(
                `[Email simulated]\nFROM: ${from}\nTO: ${employee.email}\nSUBJECT: ${subject}\n${body}`
            );
            return {
                sent: false,
                recipient: employee.email,
                subject,
                message: 'SMTP not configured — email content was logged on the server.'
            };
        });

        this.on('rejectTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;

            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) {
                return req.error(404, `Timesheet '${timesheetId}' not found.`);
            }

            if (header.status !== 'Pending') {
                return req.error(400,
                    `Cannot reject — current status is '${header.status}'. ` +
                    `Only 'Pending' timesheets can be rejected.`
                );
            }

            await UPDATE(HEADER)
                .set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' })
                .where({ timesheetId });

            const hdr2 = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr2) await createNotification(
                hdr2.employee_employeeId,
                'TIMESHEET_REJECTED',
                'Timesheet Returned ✗',
                `Your timesheet ${timesheetId} was returned.${remarks ? ' Reason: ' + remarks : ''}`,
                timesheetId
            );

            await UPDATE(ENTRY)
                .set({ isLocked: false, entryStatus: 'Open' })
                .where({ timesheet_timesheetId: timesheetId });

            return `Timesheet '${timesheetId}' rejected. Employee can edit and resubmit.`;
        });

        // ── Manager uploads (or replaces) the task attachment ────────────
        // Stores the binary in TaskMaster.attachment so the assigned
        // employee can later pull it via consumeTaskAttachment.
        this.on('uploadTaskAttachment', async (req) => {
            const { taskId, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!fileName) return req.error(400, 'fileName is required.');
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');

            const exists = await SELECT.one.from(TASK).columns('taskId').where({ taskId });
            if (!exists) return req.error(404, `Task '${taskId}' not found.`);

            // Strip a "data:...;base64," prefix if the client forgot to.
            const cleaned = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
            let buf;
            try {
                buf = Buffer.from(cleaned, 'base64');
            } catch (e) {
                return req.error(400, 'dataBase64 is not valid base64.');
            }

            await UPDATE(TASK)
                .set({
                    attachment: buf,
                    attachmentName: fileName,
                    attachmentMimeType: mimeType || 'application/octet-stream'
                })
                .where({ taskId });

            cds.log('attach').info(`Attachment '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return `Attachment uploaded for task '${taskId}'.`;
        });

        this.on('approveLeave', async (req) => {
            const { leaveId, approved, remarks } = req.data;
            if (!leaveId) return req.error(400, 'leaveId is required.');

            const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
            if (!leave) return req.error(404, `Leave request '${leaveId}' not found.`);
            if (leave.status !== 'Pending') {
                return req.error(400, `Leave is already '${leave.status}'.`);
            }

            const newStatus = approved ? 'Approved' : 'Rejected';

            await UPDATE(LEAVE_REQUEST)
                .set({
                    status: newStatus,
                    managerRemarks: remarks || '',
                    approvedOn: new Date()
                })
                .where({ leaveId });

            // Notify employee
            const emp = await SELECT.one.from(EMPLOYEE)
                .where({ employeeId: leave.employee_employeeId });

            if (emp && emp.email) {
                const mailer = getMailer();
                const subject = `Your leave request has been ${newStatus}`;
                const body =
                    `Hi ${emp.employeeName || ''},\n\n` +
                    `Your leave request has been ${newStatus.toLowerCase()} by your manager.\n\n` +
                    `Leave Type : ${leave.leaveType}\n` +
                    `From       : ${leave.fromDate}\n` +
                    `To         : ${leave.toDate}\n` +
                    `Days       : ${leave.days}\n` +
                    (remarks ? `Remarks    : ${remarks}\n` : '') +
                    `\n— Timesheet System`;

                if (mailer) {
                    try {
                        await mailer.sendMail({
                            from: process.env.SMTP_FROM || 'no-reply@timesheet.local',
                            to: emp.email,
                            subject,
                            text: body
                        });
                    } catch (e) {
                        cds.log('mail').warn('Leave approval email failed:', e.message);
                    }
                } else {
                    cds.log('leave').info(`[Email simulated] TO: ${emp.email}\n${body}`);
                }
            }

            cds.log('leave').info(`Leave ${leaveId} ${newStatus} by manager`);
            return { leaveId, status: newStatus };
        });
        return super.init();
    }
}

// ── HR Service ───────────────────────────────────────────────────────────────
// Backs the HR "Add Employee" form and the "All Employees" directory.
const DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeDocument';

class HRService extends cds.ApplicationService {
    async init() {

        // Returns the next sequential employeeId (e.g. EMP1008). Logic:
        // pick the highest existing numeric suffix and add one. Falls
        // back to EMP1001 when the table is empty.
        const generateEmployeeId = async () => {
            const rows = await SELECT.from(EMPLOYEE).columns('employeeId');
            const max = rows.reduce((m, r) => {
                const n = parseInt(String(r.employeeId || '').replace(/\D/g, ''), 10);
                return Number.isFinite(n) && n > m ? n : m;
            }, 1000);
            return 'EMP' + (max + 1);
        };

        this.on('nextEmployeeId', async () => {
            return await generateEmployeeId();
        });

        this.on('addEmployee', async (req) => {
            const d = req.data || {};
            if (!d.employeeName) return req.error(400, 'employeeName is required.');
            if (!d.email) return req.error(400, 'email is required.');

            // Reject if the email is already taken — keeps the
            // EmployeeMaster.email lookup used by getCurrentUser unique.
            const dup = await SELECT.one.from(EMPLOYEE)
                .where({ email: d.email });
            if (dup) {
                return req.error(409, `An employee with email '${d.email}' already exists.`);
            }

            const newId = await generateEmployeeId();
            const row = {
                employeeId: newId,
                employeeName: d.employeeName,
                designation: d.designation || null,
                email: d.email,
                address: d.address || null,
                mobileNumber: d.mobileNumber || null,
                manager_employeeId: d.managerEmployeeId || null,
                isActive: true,
                dateOfBirth: d.dateOfBirth || null,
                gender: d.gender || null,
                department: d.department || null,
                joiningDate: d.joiningDate || null,
                employmentType: d.employmentType || null,
                aadhaarNumber: d.aadhaarNumber || null,
                panNumber: d.panNumber || null,
                status: 'Active',
                emergencyContact: d.emergencyContact || null,
                bloodGroup: d.bloodGroup || null,
                bankAccountNumber: d.bankAccountNumber || null,
                bankName: d.bankName || null,
                bankIfsc: d.bankIfsc || null
            };
            await INSERT.into(EMPLOYEE).entries(row);
            cds.log('hr').info(`HR created employee ${newId} (${d.employeeName})`);
            return { employeeId: newId };
        });

        this.on('uploadEmployeeDocument', async (req) => {
            const { employeeId, documentType, fileName, mimeType, description, dataBase64 } = req.data;
            if (!employeeId || !fileName || !dataBase64) {
                return req.error(400, 'employeeId, fileName and dataBase64 are required.');
            }

            // Verify the employee exists so we don't create orphan documents.
            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);

            let buf;
            try { buf = Buffer.from(dataBase64, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }

            // documentId = EMP1007-DOC-1700000000000 (employee + epoch ms)
            const documentId = `${employeeId}-DOC-${Date.now()}`;
            await INSERT.into(DOCUMENT).entries({
                documentId,
                employee_employeeId: employeeId,
                documentType: documentType || 'Other',
                fileName,
                mimeType: mimeType || 'application/octet-stream',
                description: description || null,
                content: buf
            });
            cds.log('hr').info(`Uploaded ${fileName} (${buf.length} bytes) for ${employeeId}`);
            return documentId;
        });

        this.on('getEmployeeDocument', async (req) => {
            const { documentId } = req.data;
            if (!documentId) return req.error(400, 'documentId is required.');

            const doc = await SELECT.one.from(DOCUMENT)
                .columns('documentId', 'fileName', 'mimeType', 'content')
                .where({ documentId });
            if (!doc) return req.error(404, `Document '${documentId}' not found.`);
            if (!doc.content) return req.error(404, 'Document has no content.');

            let dataBase64 = '';
            try {
                if (Buffer.isBuffer(doc.content)) {
                    dataBase64 = doc.content.toString('base64');
                } else if (typeof doc.content === 'string') {
                    dataBase64 = doc.content;
                } else if (doc.content instanceof Uint8Array) {
                    dataBase64 = Buffer.from(doc.content).toString('base64');
                } else {
                    dataBase64 = Buffer.from(doc.content).toString('base64');
                }
            } catch (e) {
                cds.log('hr').error('Could not encode document:', e.message || e);
                return req.error(500, 'Could not read document.');
            }

            return {
                fileName: doc.fileName,
                mimeType: doc.mimeType || 'application/octet-stream',
                dataBase64
            };
        });

        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService, HRService };
