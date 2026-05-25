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

    workLocation        : String(50);
    maritalStatus       : String(20);
    fatherName          : String(100);
    partnerName         : String(100);
    marriageDate        : Date;
    hasKids             : String(5);

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
    statusUpdatedAt    : Timestamp;
    reviewer           : Association to EmployeeMaster;   // who reviews
    reviewerStatus     : String(20);
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

entity TimesheetDayUnlockRequest : managed {
    key requestId       : String(30);       // e.g. EMP1001-2026-05-19-HR

    employee            : Association to EmployeeMaster;
    targetDate          : Date;             // The specific missed date

    // HR person the employee selected from the filtered HR list
    hrApprover          : Association to EmployeeMaster;

    status              : String(20) default 'Pending';
                                            // Pending | Approved | Rejected
    employeeRemarks     : String(255);
    hrRemarks           : String(255);

    requestedOn         : Timestamp;
    resolvedOn          : Timestamp;
}

// ── Previous-Week Timesheet Approval Request ──────────────────────────────────
// Created when an employee clicks "Fill Previous Week" and confirms sending
// to manager. Manager approves → TimesheetHeader for that week is created
// (or unlocked) and the employee can fill + submit it directly.
entity TimesheetPrevWeekRequest : managed {
    key requestId       : String(30);       // e.g. EMP1001-PREV-1716000000000

    employee            : Association to EmployeeMaster;
    weekStartDate       : Date;             // Monday of the previous week
    weekEndDate         : Date;             // Sunday of the previous week

    // Manager is resolved automatically from employee.manager
    manager             : Association to EmployeeMaster;

    status              : String(20) default 'Pending';
                                            // Pending | Approved | Rejected
    employeeRemarks     : String(255);
    managerRemarks      : String(255);

    requestedOn         : Timestamp;
    resolvedOn          : Timestamp;

    // Once approved, this links to the TimesheetHeader that was unlocked
    timesheetId         : String(15);
}


entity LeaveRequest : managed {
    key leaveId        : String(20);
    employee           : Association to EmployeeMaster;
    leaveType          : String(20);   // Casual / Sick / Paid / Maternity / Paternity
    fromDate           : Date;
    toDate             : Date;
    days               : Integer;
    reason             : String(500);
    status             : String(20) default 'Pending';  // Pending / Approved / Rejected
    isUnpaid           : Boolean default false;
    managerRemarks     : String(255);
    approvedBy         : Association to EmployeeMaster;
    approvedOn         : Timestamp;
}
entity LeaveBalance : managed {
    key balanceId      : String(20);
    employee           : Association to EmployeeMaster;
    casualLeave        : Integer default 0;       // Casual Leave days
    sickLeave          : Integer default 0;       // Sick Leave days
    annualLeave        : Integer default 0;       // Annual Leave days
    lastUpdated        : Timestamp;
}

// Stores monthly performance review scores for each employee.
// The ratingValue (0.0 – 5.0) drives both the Performance Rating card
// and the Performance Trend line graph on the dashboard.
entity PerformanceRating : managed {
    key ratingId        : String(20);
    employee            : Association to EmployeeMaster;
    ratingValue         : Decimal(3,1);   // e.g. 4.6  (0.0 – 5.0)
    reviewMonth         : Integer;        // 1 – 12
    reviewYear          : Integer;        // e.g. 2024
    reviewComment       : String(500);
    ratingCategory      : String(30);     // Excellent / Good / Average / Needs Improvement
                                          // computed on insert/update via business logic
}

// ── Notifications ──────────────────────────────────────────────────────────
// Auto-created by service handlers on key events (timesheet approved/rejected,
// task assigned, performance rated, leave approved).
entity Notification : managed {
    key notificationId : String(30);
    employee           : Association to EmployeeMaster;
    type               : String(30);    // TIMESHEET_APPROVED | TIMESHEET_REJECTED |
                                        // TASK_ASSIGNED | PERFORMANCE_RATED |
                                        // LEAVE_APPROVED | LEAVE_REJECTED
    title              : String(100);
    message            : String(500);
    isRead             : Boolean default false;
    referenceId        : String(30);    // timesheetId / taskId / ratingId etc.
    notifiedAt         : Timestamp;
}
// ── Attendance Record ─────────────────────────────────────────────────────
entity AttendanceRecord : managed {
    key attendanceId   : String(30);     // EMP1001-2026-05-13
    employee           : Association to EmployeeMaster;
    attendanceDate     : Date;           // 2026-05-13
    attendanceDay      : String(15);     // Wednesday
    attendanceTime     : Time;           // 14:32:00
    status             : String(10) default 'Present';
}
}