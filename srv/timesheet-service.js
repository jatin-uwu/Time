const cds = require('@sap/cds');

const HEADER   = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY    = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';
const EMPLOYEE = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeMaster';
const TASK     = 'ccentrik.employee.timesheet.schema.timesheet.TaskMaster';

const PRIORITY_PREFIX = {
    'High':   '[HIGH PRIORITY]',
    'Medium': '[Medium Priority]',
    'Low':    '[Low Priority]'
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
            if (user.is('Manager')) return { role: 'manager' };
            if (user.is('Employee')) return { role: 'employee' };
            return { role: 'unknown' };
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
                fileName:   task.attachmentName,
                mimeType:   task.attachmentMimeType || 'application/octet-stream',
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

            const prefix  = PRIORITY_PREFIX[priority] || `[${priority || 'Normal'} Priority]`;
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
                sent:      false,
                recipient: employee.email,
                subject,
                message:   'SMTP not configured — email content was logged on the server.'
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
            if (!taskId)     return req.error(400, 'taskId is required.');
            if (!fileName)   return req.error(400, 'fileName is required.');
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
                    attachment:         buf,
                    attachmentName:     fileName,
                    attachmentMimeType: mimeType || 'application/octet-stream'
                })
                .where({ taskId });

            cds.log('attach').info(`Attachment '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return `Attachment uploaded for task '${taskId}'.`;
        });

        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService };