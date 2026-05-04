using {ccentrik.employee.timesheet.schema as db} from '../db/data-model';

// ── Employee Service ──────────────────────────────────────────────────────────
service EmployeeService @(
    path    : '/employee',
    requires: 'authenticated-user'
) {


    entity MyTimesheets @(restrict: [{
        grant: [
            'READ',
            'WRITE'
        ],
        to   : 'Employee'
    }, ])            as projection on db.timesheet.TimesheetHeader;

    entity MyEntries as projection on db.timesheet.TimesheetEntry;

    entity MyTasks @(restrict: [{
        grant: ['READ'],
        to   : 'Employee'
    }, ])            as projection on db.timesheet.TaskMaster;

    // Employee submits a week's timesheet → goes to manager for approval
    action submitTimesheet(timesheetId: String(15))                        returns String;
}

// ── Manager Service ───────────────────────────────────────────────────────────
service ManagerService @(
    path    : '/manager',
    requires: 'authenticated-user'
) {

    // Only timesheets waiting for a decision are exposed here
    entity PendingApprovals @(restrict: [{
        grant: [
            'READ',
            'WRITE'
        ],
        to   : 'Manager'
    }, ])                  as projection on db.timesheet.TimesheetHeader
                              where
                                  status = 'Submitted';

    entity ApprovalEntries as projection on db.timesheet.TimesheetEntry;
    entity Employees       as projection on db.timesheet.EmployeeMaster;

    // Manager approves a submitted timesheet → entries stay locked, status = Approved
    action approveTimesheet(timesheetId: String(15), remarks: String(255)) returns String;

    // Manager rejects a submitted timesheet → entries unlocked, employee can re-edit
    action rejectTimesheet(timesheetId: String(15), remarks: String(255))  returns String;
}
