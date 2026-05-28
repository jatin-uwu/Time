const cds = require('@sap/cds');

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

// SQLite table name derived from CDS namespace + entity name
const EMPLOYEE_TABLE = 'ccentrik_employee_timesheet_schema_timesheet_EmployeeMaster';

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

class EmployeeService extends cds.ApplicationService {
    async init() {

        this.on('getUserRole', (req) => {
            const user = req.user;
            if (user.is('HR')) return { role: 'hr' };
            if (user.is('Manager')) return { role: 'manager' };
            if (user.is('Employee')) return { role: 'employee' };
            return { role: 'unknown' };
        });

        this.on('getCurrentUser', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const role = user.is && user.is('HR') ? 'hr'
                : user.is && user.is('Manager') ? 'manager'
                    : user.is && user.is('Employee') ? 'employee'
                        : 'unknown';

            let emp = null;
            if (email) {
                emp = await SELECT.one.from(EMPLOYEE).where({ email: email });
            }

            if (!emp) {
                return {
                    email, role, employeeId: '',
                    employeeName: (user.attr && user.attr.given_name) || (email && email.split('@')[0]) || 'User',
                    designation: '', address: '', mobileNumber: '', managerId: '', isActive: true
                };
            }

            return {
                email: emp.email || email, role,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName || '',
                designation: emp.designation || '',
                address: emp.address || '',
                mobileNumber: emp.mobileNumber || '',
                managerId: emp.manager_employeeId || '',
                isActive: emp.isActive !== false
            };
        });

        // ── Upload Profile Photo ──────────────────────────────────────────────
        // CAP's UPDATE().set() silently skips LargeBinary columns annotated
        // with @Core.MediaType in SQLite. We use raw SQL to bypass this.
        this.on('uploadProfilePhoto', async (req) => {
            const { dataBase64 } = req.data;
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');

            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            if (!email) return req.error(401, 'Cannot identify user — no email in token.');

            // Resolve employeeId from email
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });
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

            // ── Raw SQL UPDATE — the ONLY reliable way to write LargeBinary
            // columns annotated with @Core.MediaType in CAP + SQLite.
            // CAP's ORM skips these columns entirely in UPDATE().set({}).
            const db = await cds.connect.to('db');
            await db.run(
                `UPDATE "${EMPLOYEE_TABLE}"
                 SET "profilePhoto" = ?, "profilePhotoMimeType" = ?
                 WHERE "employeeId" = ?`,
                [buf, mimeType, emp.employeeId]
            );

            // Verify it actually saved
            const rows = await db.run(
                `SELECT length("profilePhoto") as photoLen, "profilePhotoMimeType" as mime
                 FROM "${EMPLOYEE_TABLE}" WHERE "employeeId" = ?`,
                [emp.employeeId]
            );
            const row = Array.isArray(rows) ? rows[0] : rows;
            cds.log('profile').info(
                `✓ Photo saved: emp=${emp.employeeId} | bytes=${row && row.photoLen} | mime=${row && row.mime}`
            );

            return { success: true, message: `Photo saved (${mimeType}, ${buf.length} bytes).` };
        });

        // ── Get Profile Photo ─────────────────────────────────────────────────
        // Also uses raw SQL so the BLOB is read correctly from SQLite.
        this.on('getProfilePhoto', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            if (!email) return { dataBase64: '', mimeType: '' };

            // Resolve employeeId first (safe — no BLOB involved)
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });
            if (!emp) return { dataBase64: '', mimeType: '' };

            // Read BLOB via raw SQL
            const db = await cds.connect.to('db');
            const rows = await db.run(
                `SELECT "profilePhoto", "profilePhotoMimeType"
                 FROM "${EMPLOYEE_TABLE}" WHERE "employeeId" = ?`,
                [emp.employeeId]
            );
            const row = Array.isArray(rows) ? rows[0] : rows;

            cds.log('profile').info(
                `getProfilePhoto: emp=${emp.employeeId} | hasPhoto=${!!(row && row.profilePhoto)} | mime=${row && row.profilePhotoMimeType}`
            );

            if (!row || !row.profilePhoto) return { dataBase64: '', mimeType: '' };

            // Convert BLOB → base64
            let base64 = '';
            try {
                const photo = row.profilePhoto;
                if (Buffer.isBuffer(photo)) base64 = photo.toString('base64');
                else if (typeof photo === 'string') base64 = photo;
                else if (photo instanceof Uint8Array) base64 = Buffer.from(photo).toString('base64');
                else base64 = Buffer.from(photo).toString('base64');
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

            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return [];
            const rows = await SELECT.from(NOTIFICATION).where({ employee_employeeId: emp.employeeId }).orderBy({ notifiedAt: 'desc' }).limit(5);
            return (rows || []).map(n => ({
                notificationId: n.notificationId, type: n.type || '', title: n.title || '',
                message: n.message || '', isRead: n.isRead || false, referenceId: n.referenceId || '',
                notifiedAt: n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));
        });

               this.on('markAllNotificationsRead', async (req) => {
            const user  = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp   = await SELECT.one.from(NOTIFICATION_ENTITY).columns('notificationId')
                              .where({ employee_employeeId: 'placeholder' });
            // Re-fetch employee
            const empRow = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'joiningDate').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const year = req.data.year || new Date().getFullYear();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return { trendJSON: JSON.stringify(Array(12).fill(null)) };
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const ratings = await SELECT.from(PERF).where({ employee_employeeId: emp.employeeId, reviewYear: year }).orderBy('reviewMonth asc');
            const slots = Array(12).fill(null);
            ratings.forEach(r => { const idx = (r.reviewMonth || 1) - 1; if (idx >= 0 && idx < 12) slots[idx] = parseFloat(r.ratingValue) || null; });
            return { trendJSON: JSON.stringify(slots) };
        });

        this.on('getTaskSummary', async (req) => {
            const user  = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp   = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 };
 
            const tasks = await SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId });
 
            let notStarted = 0, inProgress = 0, inReview = 0, completed = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                if      (s === 'notstarted' || s === 'open' || s === 'pending') notStarted++;
                else if (s === 'inprogress')  inProgress++;
                else if (s === 'inreview')    inReview++;
                else if (s === 'completed')   completed++;
                else                          notStarted++; // treat unknown as not started
            });
 
            return {
                total: tasks.length,
                notStarted, inProgress, inReview, completed
            };
        });

        this.on('getLeaveBalance', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
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
            const user  = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp   = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return { totalPending: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0 };
 
            const tasks = await SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId });
 
            let totalPending = 0, highPriorityCount = 0, mediumPriorityCount = 0, lowPriorityCount = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                // Everything that isn't completed counts as pending
                if (s !== 'completed') {
                    totalPending++;
                    if      (t.priority === 'High')   highPriorityCount++;
                    else if (t.priority === 'Medium')  mediumPriorityCount++;
                    else if (t.priority === 'Low')     lowPriorityCount++;
                }
            });
 
            return { totalPending, highPriorityCount, mediumPriorityCount, lowPriorityCount };
        });

        this.on('markAttendance', async (req) => {
            const { attendanceDate, attendanceDay, attendanceTime } = req.data;
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            if (!attendanceDate) return req.error(400, 'attendanceDate is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
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
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email });
            if (!emp) return { alreadyMarked: false, attendanceTime: null, attendanceDay: null };
            const existing = await SELECT.one.from(ATTENDANCE).where({ employee_employeeId: emp.employeeId, attendanceDate });
            return { alreadyMarked: !!existing, attendanceTime: existing ? existing.attendanceTime : null, attendanceDay: existing ? existing.attendanceDay : null };
        });

        this.on('updateTaskStatus', async (req) => {
            const { taskId, status, reviewerId, reviewerStatus } = req.data;

            cds.log('task').info('updateTaskStatus →', { taskId, status, reviewerId, reviewerStatus });

            if (!taskId)  return req.error(400, 'taskId is required.');
            if (!status)  return req.error(400, 'status is required.');

            const task = await SELECT.one.from(TASK).where({ taskId });
            if (!task)    return req.error(404, `Task '${taskId}' not found.`);

            // Only patch reviewer fields when a real (non-empty) value is supplied.
            // Sending an empty string would try to set reviewer_employeeId = ""
            // which violates the FK and causes the entire UPDATE to fail.
            const patch = { status, statusUpdatedAt: new Date() };
            if (reviewerId     && String(reviewerId).trim())     patch.reviewer_employeeId = reviewerId;
            if (reviewerStatus && String(reviewerStatus).trim()) patch.reviewerStatus       = reviewerStatus;

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
            const user  = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const reviewer = email
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ email })
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
                task_taskId:          taskId,
                reviewer_employeeId:  reviewer.employeeId,
                assignee_employeeId:  task.assignedTo_employeeId || null,
                decision,
                remarks:              String(remarks).trim(),
                attachmentName:       storedName,
                attachmentMimeType:   storedMime,
                attachment:           attachmentBuf,
                reviewedOn
            });

            // Update task status (and keep reviewerStatus in sync for legacy UI)
            await UPDATE(TASK).set({
                status:          newTaskStatus,
                reviewerStatus:  decision === 'Reviewed' ? 'Reviewed' : 'Issue Found',
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
        this.on('reportIssue',  (req) => handleReviewDecision(req, 'IssueFound'));

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
                reviewId:       r.reviewId || '',
                reviewerId:     r.reviewer_employeeId || '',
                reviewerName,
                decision:       r.decision || '',
                remarks:        r.remarks || '',
                attachmentName: r.attachmentName || '',
                reviewedOn:     r.reviewedOn ? new Date(r.reviewedOn).toISOString() : ''
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
                fileName:   r.attachmentName || 'attachment',
                mimeType:   r.attachmentMimeType || 'application/octet-stream',
                dataBase64: base64
            };
        });

        await registerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

class ManagerService extends cds.ApplicationService {
    async init() {

        this.on('approveTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (header.status !== 'Pending') return req.error(400, `Cannot approve — current status is '${header.status}'.`);
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
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const existing = await SELECT.one.from(PERF).where({ employee_employeeId: employeeId, reviewMonth, reviewYear });
            const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2, '0')}`;
            if (existing) {
                await UPDATE(PERF).set({ ratingValue, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' }).where({ ratingId: existing.ratingId });
                return { ratingId: existing.ratingId, message: `Rating updated for ${employeeId} — ${reviewMonth}/${reviewYear}` };
            }
            await INSERT.into(PERF).entries({ ratingId, employee_employeeId: employeeId, ratingValue, reviewMonth, reviewYear, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' });
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

        this.on('approveLeave', async (req) => {
            const { leaveId, approved, remarks } = req.data;
            if (!leaveId) return req.error(400, 'leaveId is required.');
            const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
            if (!leave) return req.error(404, `Leave request '${leaveId}' not found.`);
            if (leave.status !== 'Pending') return req.error(400, `Leave is already '${leave.status}'.`);
            const newStatus = approved ? 'Approved' : 'Rejected';
            await UPDATE(LEAVE_REQUEST).set({ status: newStatus, managerRemarks: remarks || '', approvedOn: new Date() }).where({ leaveId });
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
            if (!year || !month)            return req.error(400, 'year and month are required.');
            if (month < 1 || month > 12)    return req.error(400, 'month must be 1-12.');

            // 1. Resolve the logged-in manager
            const user  = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail)) || user.id || '';
            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where({ email })
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
            const isoEnd   = `${year}-${pad(month)}-${pad(daysInMonth)}`;

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
                if (lc.includes('casual'))    return 'CL';
                if (lc.includes('sick'))      return 'SL';
                if (lc.includes('paternity')) return 'PtL';
                if (lc.includes('maternity')) return 'ML';
                if (lc.includes('paid'))      return 'PL';
                return 'L';
            };
            const leaveMap = new Map();
            for (const l of leaves) {
                const code = leaveCode(l.leaveType);
                const from = String(l.fromDate || '').slice(0, 10);
                const to   = String(l.toDate   || '').slice(0, 10);
                if (!from || !to) continue;
                // Walk each calendar date in the leave range that falls in this month.
                const startD = new Date(`${from}T00:00:00Z`);
                const endD   = new Date(`${to}T00:00:00Z`);
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
                    employeeId:   emp.employeeId,
                    employeeName: emp.employeeName || '',
                    designation:  emp.designation  || '',
                    email:        emp.email        || '',
                    days
                };
            });

            const holidayArr = Array.from(holidayMap.entries())
                .map(([date, name]) => ({ date, name }))
                .sort((a, b) => a.date.localeCompare(b.date));

            return {
                employees:   JSON.stringify(result),
                holidays:    JSON.stringify(holidayArr),
                daysInMonth
            };
        });

        await registerManagerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

const DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeDocument';
class HRService extends cds.ApplicationService {
    async init() {

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
            const dup = await SELECT.one.from(EMPLOYEE).where({ email: d.email });
            if (dup) return req.error(409, `An employee with email '${d.email}' already exists.`);
            const newId = await generateEmployeeId();
            await INSERT.into(EMPLOYEE).entries({
                employeeId: newId, employeeName: d.employeeName, designation: d.designation || null,
                email: d.email, address: d.address || null, mobileNumber: d.mobileNumber || null,
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
                if (Buffer.isBuffer(doc.content)) dataBase64 = doc.content.toString('base64');
                else if (typeof doc.content === 'string') dataBase64 = doc.content;
                else if (doc.content instanceof Uint8Array) dataBase64 = Buffer.from(doc.content).toString('base64');
                else dataBase64 = Buffer.from(doc.content).toString('base64');
            } catch (e) { return req.error(500, 'Could not read document.'); }
            return { fileName: doc.fileName, mimeType: doc.mimeType || 'application/octet-stream', dataBase64 };
        });

        await registerHRTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService, HRService };
cds.on('served', () => startReminderCron(getMailer));