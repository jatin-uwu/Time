// using { ccentrik.employee.timesheet.schema as db } from '../db/data-model';

// // ── Employee Service ──────────────────────────────────────────────────────────
// service EmployeeService @(path:'/employee') {

//     @(requires: 'Employee')
//     entity MyTimesheets as projection on db.timesheet.TimesheetHeader;

//     @(requires: 'Employee')
//     entity MyEntries    as projection on db.timesheet.TimesheetEntry;

//     @(requires: 'Employee')
//     entity MyTasks      as projection on db.timesheet.TaskMaster;

//     @(requires: 'Employee')
//     action submitTimesheet(timesheetId : String(15)) returns String;

//     @(requires: 'Employee')
//     action getUserRole() returns { role: String };
// }

// // ── Manager Service ───────────────────────────────────────────────────────────
// service ManagerService @(path:'/manager') {

//     @(requires: 'Manager')
//     entity PendingApprovals as projection on db.timesheet.TimesheetHeader
//         where status = 'Submitted';

//     @(requires: 'Manager')
//     entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;

//     @(requires: 'Manager')
//     entity Employees        as projection on db.timesheet.EmployeeMaster;

//     @(requires: 'Manager')
//     action approveTimesheet(timesheetId : String(15), remarks : String(255)) returns String;

//     @(requires: 'Manager')
//     action rejectTimesheet (timesheetId : String(15), remarks : String(255)) returns String;
// }

using { ccentrik.employee.timesheet.schema as db } from '../db/data-model';

// ── Employee Service ─────────────────────────────────────────────────────────
// Accessible by users with EITHER Employee OR Manager scope, because
// managers also need to view their own dashboard, timesheet, tasks and
// notifications (which all live on the EmployeeService endpoints).
service EmployeeService @(path:'/employee') {

    entity MyTimesheets @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetHeader;
    entity MyEntries    @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetEntry;
    entity MyTasks      @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskMaster;
    entity TaskUpdates  @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskUpdate;
    entity Employees    @(requires: ['Employee','Manager']) as projection on db.timesheet.EmployeeMaster;

    // Submitting a timesheet is an Employee action (a Manager submitting
    // their own timesheet still has the Employee scope via role mapping).
    action submitTimesheet(timesheetId : String(15)) returns String
        @(requires: ['Employee','Manager']);

    // Anyone authenticated should be able to discover their role.
    action getUserRole() returns { role: String }
        @(requires: 'authenticated-user');

    // Single-shot download of the manager-attached file. Streams the
    // current bytes back as base64 and immediately clears them from
    // HANA so storage is freed and the file can only be downloaded once.
    action consumeTaskAttachment(taskId : String(20)) returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    } @(requires: ['Employee','Manager']);
}

// ── Manager Service ──────────────────────────────────────────────────────────
// Service-level @requires gates EVERY entity and action behind the Manager
// scope. Employees calling these endpoints get a 403 Forbidden.
service ManagerService @(path:'/manager') @(requires: 'Manager') {

    entity PendingApprovals as projection on db.timesheet.TimesheetHeader
        where status = 'Submitted';
    entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;
    entity Employees        as projection on db.timesheet.EmployeeMaster;
    entity Tasks            as projection on db.timesheet.TaskMaster;
    entity TaskUpdates      as projection on db.timesheet.TaskUpdate;

    action approveTimesheet(timesheetId : String(15), remarks : String(255)) returns String;
    action rejectTimesheet (timesheetId : String(15), remarks : String(255)) returns String;

    action notifyTaskAssignment(
        taskId          : String(20),
        taskName        : String(100),
        taskDescription : String(2000),
        priority        : String(20),
        dueDate         : String(20),
        assigneeId      : String(10)
    ) returns {
        sent      : Boolean;
        recipient : String;
        subject   : String;
        message   : String;
    };

    // Manager uploads (or replaces) the reference attachment on a task.
    // dataBase64 is the file payload without the "data:...;base64," prefix.
    action uploadTaskAttachment(
        taskId     : String(20),
        fileName   : String(255),
        mimeType   : String(100),
        dataBase64 : LargeString
    ) returns String;
}
