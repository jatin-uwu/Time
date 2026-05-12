namespace ccentrik.employee.timesheet.schema;

using { managed } from '@sap/cds/common';
  
context timesheet{

entity EmployeeMaster : managed {
    key employeeId      : String(10);
    employeeName        : String(100);
    designation         : String(50);
    email               : String(100);
    address             : String(255);
    mobileNumber        : String(15);
    manager             : Association to EmployeeMaster;
    isActive            : Boolean default true;

    // ── HR profile fields ──────────────────────────────────────────
    dateOfBirth         : Date;
    gender              : String(10);            // Male / Female / Other
    department          : String(50);
    joiningDate         : Date;
    employmentType      : String(20);            // Permanent / Contract / Intern
    aadhaarNumber       : String(20);
    panNumber           : String(15);
    status              : String(20) default 'Active'; // Active / Inactive / On-Leave / Resigned
    emergencyContact    : String(15);
    bloodGroup          : String(5);

    // ── New fields ─────────────────────────────────────────────────
    workLocation        : String(50);
    maritalStatus       : String(20);   // Single / Married / Divorced / Widowed
    fatherName          : String(100);  // shown when Single
    partnerName         : String(100);  // shown when Married
    marriageDate        : Date;         // shown when Married
    hasKids             : String(5);    // Yes / No, shown when Married
    
    // Bank details (kept inline; promote to a separate entity if you ever
    // need to support multiple bank accounts per employee).
    bankAccountNumber   : String(30);
    bankName            : String(60);
    bankIfsc            : String(15);

    // Profile photo (single binary, served via OData media stream).
    profilePhoto        : LargeBinary @Core.MediaType: profilePhotoMimeType;
    profilePhotoMimeType: String(100) @Core.IsMediaType;

    timesheets          : Composition of many timesheet.TimesheetHeader
                          on timesheets.employee = $self;

    documents           : Composition of many EmployeeDocument
                          on documents.employee = $self;
}

// One row per uploaded HR document (Aadhaar, PAN, Resume, …).
// The binary stream is exposed as an OData media entity so the
// SAPUI5 FileUploader / Download icons work out-of-the-box.
entity EmployeeDocument : managed {
    key documentId   : String(20);
    employee         : Association to EmployeeMaster;
    documentType     : String(40);                 // Aadhaar / PAN / Resume / Certificate / Photo / Other
    fileName         : String(255);
    mimeType         : String(100) @Core.IsMediaType;
    content          : LargeBinary  @Core.MediaType: mimeType;
    description      : String(255);
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