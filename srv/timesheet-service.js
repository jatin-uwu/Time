const cds = require('@sap/cds');

const HEADER = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY  = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';

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

        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService };