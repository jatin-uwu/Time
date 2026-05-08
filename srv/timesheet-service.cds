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
    @(requires: ['Employee','Manager'])
    action submitTimesheet(timesheetId : String(15)) returns String;

    // Anyone authenticated should be able to discover their role.
    @(requires: 'authenticated-user')
    action getUserRole() returns { role: String };

    // Returns the currently authenticated user resolved against the
    // EmployeeMaster table by email. Frontend uses this to show the
    // *real* employee record (greeting, profile, manager linkage)
    // instead of the hard-coded EMP1001/EMP1005 fallback.
    @(requires: 'authenticated-user')
    action getCurrentUser() returns {
        email           : String(255);
        role            : String;
        employeeId      : String(10);
        employeeName    : String(100);
        designation     : String(100);
        address         : String(255);
        mobileNumber    : String(20);
        managerId       : String(10);
        isActive        : Boolean;
    };

    // Single-shot download of the manager-attached file. Streams the
    // current bytes back as base64 and immediately clears them from
    // HANA so storage is freed and the file can only be downloaded once.
    @(requires: ['Employee','Manager'])
    action consumeTaskAttachment(taskId : String(20)) returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };
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
// ── HR Service ───────────────────────────────────────────────────────────────
// Service-level @requires gates EVERY entity and action behind the HR scope.
// Backs the "Add Employee" form and the "All Employees" directory page.
service HRService @(path:'/hr') @(requires: 'HR') {

    // Full CRUD on the employee master.
    @odata.draft.enabled
    entity Employees as projection on db.timesheet.EmployeeMaster;

    // All uploaded documents — exposed so the AllEmployees details
    // pane can list/download them and AddEmployee can POST new ones.
    entity Documents as projection on db.timesheet.EmployeeDocument;

    // Generates the next sequential employeeId (e.g. EMP1008).
    // Used by the AddEmployee form when the user clicks "Save".
    action nextEmployeeId() returns String;

    // Convenience wrapper that creates an EmployeeMaster row with an
    // auto-assigned id and returns the new id. The frontend can also
    // POST directly to /hr/Employees if it prefers.
    action addEmployee(
        employeeName       : String(100),
        designation        : String(50),
        email              : String(100),
        address            : String(255),
        mobileNumber       : String(15),
        managerEmployeeId  : String(10),
        dateOfBirth        : Date,
        gender             : String(10),
        department         : String(50),
        joiningDate        : Date,
        employmentType     : String(20),
        aadhaarNumber      : String(20),
        panNumber          : String(15),
        emergencyContact   : String(15),
        bloodGroup         : String(5),
        bankAccountNumber  : String(30),
        bankName           : String(60),
        bankIfsc           : String(15)
    ) returns {
        employeeId : String(10);
    };

    // Single document upload. dataBase64 is the file body without the
    // "data:...;base64," prefix. Returns the new documentId.
    action uploadEmployeeDocument(
        employeeId   : String(10),
        documentType : String(40),
        fileName     : String(255),
        mimeType     : String(100),
        description  : String(255),
        dataBase64   : LargeString
    ) returns String;

    // Single-shot download of an uploaded document — same pattern as
    // consumeTaskAttachment but it does NOT clear the bytes (HR may
    // need to download a doc multiple times).
    action getEmployeeDocument(documentId : String(20)) returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };
}