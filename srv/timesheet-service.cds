using {ccentrik.employee.timesheet.schema as db} from '../db/data-model';

// ── Employee Service ──────────────────────────────────────────────────────────
service EmployeeService @(path:'/employee') {

    @(requires: 'Employee')
    entity MyTimesheets as projection on db.timesheet.TimesheetHeader;

    @(requires: 'Employee')
    entity MyEntries    as projection on db.timesheet.TimesheetEntry;

    @(requires: 'Employee')
    entity MyTasks      as projection on db.timesheet.TaskMaster;

    @(requires: 'Employee')
    action submitTimesheet(timesheetId : String(15)) returns String;

    @(requires: 'Employee')
    action getUserRole() returns { role: String };
}

// ── Manager Service ───────────────────────────────────────────────────────────
service ManagerService @(path:'/manager') {

    @(requires: 'Manager')
    entity PendingApprovals as projection on db.timesheet.TimesheetHeader
        where status = 'Submitted';

    @(requires: 'Manager')
    entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;

    @(requires: 'Manager')
    entity Employees        as projection on db.timesheet.EmployeeMaster;

    @(requires: 'Manager')
    action approveTimesheet(timesheetId : String(15), remarks : String(255)) returns String;

    @(requires: 'Manager')
    action rejectTimesheet (timesheetId : String(15), remarks : String(255)) returns String;
}
