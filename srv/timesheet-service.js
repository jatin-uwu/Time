const cds = require('@sap/cds');

const HEADER = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';
const EMPLOYEE = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeMaster';
const TASK = 'ccentrik.employee.timesheet.schema.timesheet.TaskMaster';
const PERFORMANCE_RATING = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';

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
                .set({ status: 'Submitted', submittedOn: new Date() })
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

        this.on('getAttendance', async (req) => {
            const now = new Date();
            const monthNames = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            // ── MOCK DATA (replace with real query when backend is ready) ────────
            // To hook up real data, query an Attendance entity here and calculate
            // presentCount / absentCount from actual records.
            const presentCount = 22;
            const absentCount = 0;
            const workingDays = presentCount + absentCount || 1;
            const attendancePct = Math.round((presentCount / workingDays) * 100);
            // ─────────────────────────────────────────────────────────────────────

            return {
                attendancePercentage: attendancePct,
                presentCount: presentCount,
                absentCount: absentCount,
                monthLabel: monthNames[now.getMonth()]
            };
        });

        // ── Dashboard: Performance Rating ─────────────────────────────────────────
        // Fetches the most-recent PerformanceRating row for the logged-in employee.
        this.on('getPerformanceRating', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            if (!emp) {
                return {
                    ratingValue: 0,
                    ratingCategory: 'N/A',
                    reviewMonth: 0,
                    reviewYear: 0,
                    reviewComment: ''
                };
            }

            // Most recent rating = highest year + month combination
            const ratings = await SELECT
                .from(PERFORMANCE_RATING)
                .where({ employee_employeeId: emp.employeeId })
                .orderBy({ reviewYear: 'desc', reviewMonth: 'desc' })
                .limit(1);

            if (!ratings || ratings.length === 0) {
                return {
                    ratingValue: 0,
                    ratingCategory: 'No Rating Yet',
                    reviewMonth: 0,
                    reviewYear: 0,
                    reviewComment: ''
                };
            }

            const latest = ratings[0];

            // Derive category from value (business rule)
            const deriveCategory = (val) => {
                if (val >= 4.5) return 'Excellent';
                if (val >= 3.5) return 'Good';
                if (val >= 2.5) return 'Average';
                return 'Needs Improvement';
            };

            const category = latest.ratingCategory || deriveCategory(latest.ratingValue || 0);

            return {
                ratingValue: parseFloat((latest.ratingValue || 0).toFixed(1)),
                ratingCategory: category,
                reviewMonth: latest.reviewMonth || 0,
                reviewYear: latest.reviewYear || 0,
                reviewComment: latest.reviewComment || ''
            };
        });

        // ── Dashboard: Performance Trend ──────────────────────────────────────────
        // Returns all monthly ratings for the current (or requested) year,
        // sorted Jan→Dec, so the frontend can draw a line chart.
        this.on('getPerformanceTrend', async (req) => {
            const user = req.user || {};
            const email = (user.attr && (user.attr.email || user.attr.mail))
                || user.id || '';

            const requestedYear = req.data && req.data.year
                ? parseInt(req.data.year, 10)
                : new Date().getFullYear();

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            const MONTH_NAMES = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
            ];

            if (!emp) {
                return { trendJSON: JSON.stringify([]) };
            }

            const ratings = await SELECT
                .from(PERFORMANCE_RATING)
                .where({
                    employee_employeeId: emp.employeeId,
                    reviewYear: requestedYear
                })
                .orderBy({ reviewMonth: 'asc' });

            // Build month-keyed map so gaps are visible as null (not omitted)
            const map = {};
            (ratings || []).forEach(r => {
                map[r.reviewMonth] = parseFloat((r.ratingValue || 0).toFixed(1));
            });

            const trend = [];
            for (let m = 1; m <= 12; m++) {
                trend.push({
                    month: m,
                    monthName: MONTH_NAMES[m - 1],
                    rating: map[m] !== undefined ? map[m] : null
                });
            }

            return { trendJSON: JSON.stringify(trend) };
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
                || user.id
                || '';

            const emp = await SELECT.one
                .from(EMPLOYEE)
                .columns('employeeId')
                .where({ email: email });

            if (!emp) {
                return {
                    totalPending: 0,
                    highPriorityCount: 0,
                    inProgressCount: 0,
                    notStartedCount: 0
                };
            }

            // Fetch all tasks assigned to this employee
            const tasks = await SELECT.from(TASK)
                .where({ assignedTo_employeeId: emp.employeeId });

            // Count by status and priority
            let totalPending = 0;
            let highPriorityCount = 0;
            let inProgressCount = 0;
            let notStartedCount = 0;

            tasks.forEach(t => {
                // Count pending tasks (not 'Completed' or 'Closed')
                if (t.status && t.status !== 'Completed' && t.status !== 'Closed') {
                    totalPending++;

                    // Count high priority items
                    if (t.priority === 'High') {
                        highPriorityCount++;
                    }

                    // Count by status
                    if (t.status === 'In Progress') {
                        inProgressCount++;
                    } else if (t.status === 'Not Started') {
                        notStartedCount++;
                    }
                }
            });

            return {
                totalPending: totalPending,
                highPriorityCount: highPriorityCount,
                inProgressCount: inProgressCount,
                notStartedCount: notStartedCount
            };
        });

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

            if (header.status !== 'Submitted') {
                return req.error(400,
                    `Cannot approve — current status is '${header.status}'. ` +
                    `Only 'Submitted' timesheets can be approved.`
                );
            }

            await UPDATE(HEADER)
                .set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' })
                .where({ timesheetId });

            await UPDATE(ENTRY)
                .set({ isLocked: true, entryStatus: 'Approved' })
                .where({ timesheet_timesheetId: timesheetId });

            return `Timesheet '${timesheetId}' approved.`;
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

            if (header.status !== 'Submitted') {
                return req.error(400,
                    `Cannot reject — current status is '${header.status}'. ` +
                    `Only 'Submitted' timesheets can be rejected.`
                );
            }

            await UPDATE(HEADER)
                .set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' })
                .where({ timesheetId });

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
