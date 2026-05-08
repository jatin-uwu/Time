namespace ccentrik.employee.timesheet.schema;

using { managed } from '@sap/cds/common';
  
context timesheet{

entity EmployeeMaster : managed {
    key employeeId     : String(10);
    employeeName       : String(100);
    designation        : String(50);
    email              : String(100);
    address            : String(255);
    mobileNumber       : String(15);
    manager            : Association to EmployeeMaster;
    isActive           : Boolean default true;

    timesheets         : Composition of many timesheet.TimesheetHeader
                         on timesheets.employee = $self;
}

entity TaskMaster : managed {
    key taskId         : String(10);
    taskName           : String(100);
    taskDescription    : String(255);
    assignedTo         : Association to EmployeeMaster;
    priority           : String(20);
    status             : String(20);
    startDate          : Date;
    dueDate            : Date;

    attachmentName     : String(255);
    attachmentMimeType : String(100);
    attachment         : LargeBinary;

    updates            : Composition of many TaskUpdate
                         on updates.task = $self;
}

entity TaskUpdate : managed {
    key updateId       : String(20);
    task               : Association to TaskMaster;
    updateDate         : Date;
    notes              : String(2000);
    attachmentName     : String(255);
    attachmentMimeType : String(100);
    attachment         : LargeBinary;
    updatedBy          : Association to EmployeeMaster;
}

entity TimesheetHeader : managed {
    key timesheetId    : String(15);

    employee           : Association to EmployeeMaster;

    weekStartDate      : Date;
    weekEndDate        : Date;

    status             : String(20);   // Draft, Submitted, Approved, Rejected
    submissionType     : String(20);   // Daily, Weekly

    submittedOn        : Timestamp;
    approvedOn         : Timestamp;
    rejectedOn         : Timestamp;

    approvedBy         : Association to EmployeeMaster;
    remarks            : String(255);

    isAutoApproved     : Boolean default false;

    entries            : Composition of many TimesheetEntry
                         on entries.timesheet = $self;
}

entity TimesheetEntry : managed {
    key entryId        : String(15);

    timesheet          : Association to TimesheetHeader;
    task               : Association to TaskMaster;

    workDate           : Date;
    hoursWorked        : Decimal(4,2);
    description        : String(255);

    entryStatus        : String(20);   // Open, Locked, Approved
    isLocked           : Boolean default false;
}
}