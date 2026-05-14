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
service EmployeeService @(path:'/employee') {

    entity MyTimesheets @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetHeader;
    entity MyEntries    @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetEntry;
    entity MyTasks      @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskMaster;
    entity TaskUpdates  @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskUpdate;
    entity Employees    @(requires: ['Employee','Manager']) as projection on db.timesheet.EmployeeMaster;

    // ── Leave ────────────────────────────────────────────────────────
    @(requires: ['Employee','Manager','HR'])
    entity LeaveRequests as projection on db.timesheet.LeaveRequest;

    @(requires: ['Employee','Manager','HR'])
    action applyLeave(
        employeeId : String,
        leaveType  : String,
        fromDate   : Date,
        toDate     : Date,
        days       : Integer,
        reason     : String,
        isUnpaid   : Boolean
    )  returns {
        leaveId  : String;
        status   : String;
        isUnpaid : Boolean;
    };

    @(requires: 'authenticated-user')
    action submitTimesheet(timesheetId : String(15)) returns String;

    @(requires: 'authenticated-user')
    action getUserRole() returns { role: String };

    @(requires: 'authenticated-user')
    action getCurrentUser() returns {
        email        : String(255);
        role         : String;
        employeeId   : String(10);
        employeeName : String(100);
        designation  : String(100);
        address      : String(255);
        mobileNumber : String(20);
        managerId    : String(10);
        isActive     : Boolean;
    };

    @(requires: ['Employee','Manager'])
    action consumeTaskAttachment(taskId : String(20)) returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };
}

// ── Manager Service ──────────────────────────────────────────────────────────
service ManagerService @(path:'/manager') @(requires: 'Manager') {

    entity PendingApprovals as projection on db.timesheet.TimesheetHeader
        where status = 'Submitted';
    entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;
    entity Employees        as projection on db.timesheet.EmployeeMaster;
    entity Tasks            as projection on db.timesheet.TaskMaster;
    entity TaskUpdates      as projection on db.timesheet.TaskUpdate;

    // ── Leave approval ───────────────────────────────────────────────
    entity LeaveRequests    as projection on db.timesheet.LeaveRequest;

    action approveLeave(
        leaveId  : String,
        approved : Boolean,
        remarks  : String
    ) returns {
        leaveId : String;
        status  : String;
    };

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

    action uploadTaskAttachment(
        taskId     : String(20),
        fileName   : String(255),
        mimeType   : String(100),
        dataBase64 : LargeString
    ) returns String;
}

// ── HR Service ───────────────────────────────────────────────────────────────
service HRService @(path:'/hr') @(requires: 'HR') {

    @odata.draft.enabled
    entity Employees as projection on db.timesheet.EmployeeMaster;

    entity Documents as projection on db.timesheet.EmployeeDocument;

    // ── Leave visibility for HR ──────────────────────────────────────
    entity LeaveRequests as projection on db.timesheet.LeaveRequest;

    action nextEmployeeId() returns String;

    action addEmployee(
        employeeName      : String(100),
        designation       : String(50),
        email             : String(100),
        address           : String(255),
        mobileNumber      : String(15),
        managerEmployeeId : String(10),
        dateOfBirth       : Date,
        gender            : String(10),
        department        : String(50),
        joiningDate       : Date,
        employmentType    : String(20),
        aadhaarNumber     : String(20),
        panNumber         : String(15),
        emergencyContact  : String(15),
        bloodGroup        : String(5),
        bankAccountNumber : String(30),
        bankName          : String(60),
        bankIfsc          : String(15)
    ) returns {
        employeeId : String(10);
    };

    action uploadEmployeeDocument(
        employeeId   : String(10),
        documentType : String(40),
        fileName     : String(255),
        mimeType     : String(100),
        description  : String(255),
        dataBase64   : LargeString
    ) returns String;

    action getEmployeeDocument(documentId : String(20)) returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };
}