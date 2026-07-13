namespace ccentrik.employee.timesheet.schema;

using { managed } from '@sap/cds/common';

context timesheet{

// Thought for the Day — a single cached daily quote shared by all employees.
// Only the current day's row is ever kept (the previous one is deleted when a new
// quote is fetched), so this table holds at most one row. Populated lazily on the
// first dashboard request of the day; see loadThoughtOfTheDay in the service.
entity ThoughtOfTheDay {
    key quoteDate : String(10);   // 'YYYY-MM-DD'
        quote     : String(1000);
        author    : String(200);
}

entity EmployeeMaster : managed {
    key employeeId      : String(10);
    employeeName        : String(100);
    designation         : String(50);
    // Authoritative application role, independent of the free-text job title in
    // `designation`. Used by the backend to cross-check the XSUAA/JWT scope so a
    // user cannot gain elevated access purely via an XSUAA role-collection
    // assignment. Allowed values: employee | manager | hr | founder.
    role                : String(20) default 'employee';
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

    // ── Resource-planning fields (additive — see ProjectResource / Resource
    // Planning module). All optional with safe defaults so existing employee
    // rows remain valid and pre-feature utilization calc keeps working.
    //   skills              : comma-separated tag list ("Node.js, SAP UI5, HANA")
    //   monthlyCapacityHours: configurable monthly working capacity (default 160)
    //   monthlyTrainingHours: recurring training/L&D overhead deducted from capacity
    // Internal-meeting and approved-leave overheads are derived live from the
    // Meeting/LeaveRequest tables — not stored here.
    skills              : String(500);
    monthlyCapacityHours : Decimal(7,2) default 160;
    monthlyTrainingHours : Decimal(7,2) default 0;

    // ── Hierarchical resource classification (additive, optional) ──────────────
    // Layered on top of free-text department/designation. roleCategory/specialization
    // point at the new masters; subSpecialization is optional free text. certifications
    // is a comma cache (mirrors `skills`); structured rows live in EmployeeCertification.
    // baseAvailabilityPct lets HR cap a part-time/shared employee's capacity (default 100).
    roleCategory        : Association to RoleCategoryMaster;
    specialization      : Association to SpecializationMaster;
    subSpecialization   : String(100);
    yearsOfExperience   : Decimal(4,1) default 0;
    certifications      : String(500);
    languages           : String(255);          // comma cache (free-text chips)
    baseAvailabilityPct : Integer default 100;

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

    // Profile photo. Stored/retrieved as base64 purely through the
    // uploadProfilePhoto / getProfilePhoto actions — never streamed via OData
    // $value. The @Core.MediaType annotation (which marks it as an OData media
    // stream) made CAP exclude the column from normal CQN read/write, so reads
    // came back empty on HANA. As a plain LargeBinary, CQN persists & reads it
    // portably on both SQLite and HANA.
    profilePhoto        : LargeBinary;
    profilePhotoMimeType: String(100);

    timesheets          : Composition of many timesheet.TimesheetHeader
                          on timesheets.employee = $self;

    documents           : Composition of many EmployeeDocument
                          on documents.employee = $self;
}

// One row per uploaded HR document (Aadhaar, PAN, Resume, …).
// The binary stream is exposed as an OData media entity so the
// SAPUI5 FileUploader / Download icons work out-of-the-box.
entity EmployeeDocument : managed {
    // Generated as "<employeeId>-DOC-<timestamp>" (~24 chars) — 20 overflowed on
    // HANA (enforced) though SQLite ignored it. Widened so uploads persist and
    // the id round-trips through the getEmployeeDocument action.
    key documentId   : String(50);
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

    // ── Group-task support (additive — solo tasks are unaffected) ──────────
    // taskType is null for every pre-existing (solo) row; all queries treat
    // null OR 'solo' as a solo task, so existing records/flows are untouched.
    taskType           : String(10) default 'solo';      // 'solo' | 'group'
    completedAt        : Timestamp;                       // set when a group task fully ends

    // ── Group chat pinned message (one active pin per task) ────────────────
    pinnedMessageId    : String(40);                     // null = nothing pinned
    pinnedByName       : String(100);                    // display name of who pinned it

    assignees          : Composition of many TaskAssignee
                         on assignees.task = $self;
    messages           : Composition of many TaskMessage
                         on messages.task = $self;
    documents          : Composition of many TaskDocument
                         on documents.task = $self;
}

// ── Task documents — multiple attachments per task (assignment files) ──────
// A manager can attach several documents when creating/assigning a task; every
// assignee (and the reviewer/manager) can list and download them. Stored inline
// like EmployeeDocument; served as base64 by a non-destructive download action.
entity TaskDocument : managed {
    key documentId : String(60);               // "<taskId>-DOC-<ts>-<rand>"
    task           : Association to TaskMaster;
    fileName       : String(255);
    mimeType       : String(100);
    fileSize       : Integer;                   // bytes
    content        : LargeBinary;
    uploadedBy     : Association to EmployeeMaster;
}

// ── Group task: one row per assignee, each with their own status ──────────
// Solo tasks never create rows here; they keep using TaskMaster.assignedTo.
entity TaskAssignee : managed {
    // NOTE: must NOT be named "rowId" — ROWID is a reserved keyword in SAP HANA,
    // and the runtime emits unquoted identifiers, so an INSERT referencing a
    // column called rowId fails with "SQL syntax error" on HANA (group-task
    // assignment). Renamed to a non-reserved identifier.
    key assignmentId : String(40);             // "<taskId>-AS-<employeeId>"
    task         : Association to TaskMaster;
    assignee     : Association to EmployeeMaster;
    status       : String(15) default 'pending';   // pending | in_progress | ended
    endedAt      : Timestamp;
    note         : String(500);                // optional per-assignee sub-task note
}

// ── Group task chat: one persistent thread per group task ─────────────────
entity TaskMessage : managed {
    key messageId : String(40);                // "<taskId>-MSG-<ts>-<rand>"
    task          : Association to TaskMaster;
    sender        : Association to EmployeeMaster;
    message       : LargeString;               // nullable — attachment-only messages allowed
    sentAt        : Timestamp;
    editedAt      : Timestamp;                 // set when the author edits (drives "Edited")
    isDeleted     : Boolean default false;     // soft-delete → renders "This message was deleted"
    attachments   : Composition of many TaskAttachment
                    on attachments.message = $self;
}

// Chat attachment — stored inline (consistent with EmployeeDocument), served
// as base64 via a download action. Max 10 MB enforced in the handler.
entity TaskAttachment : managed {
    key attachmentId : String(50);             // "<messageId>-ATT-<n>"
    message          : Association to TaskMessage;
    fileName         : String(255);
    mimeType         : String(100);
    fileSize         : Integer;                // bytes
    content          : LargeBinary;
}

// ── Project chat: one persistent thread per project ───────────────────────
entity ProjectMessage : managed {
    key messageId : String(50);               // "<projectId>-PMSG-<ts>-<rand>"
    project       : Association to Project;
    sender        : Association to EmployeeMaster;
    message       : LargeString;              // nullable — attachment-only messages allowed
    sentAt        : Timestamp;
    editedAt      : Timestamp;                // set when the author edits
    isDeleted     : Boolean default false;    // soft-delete → shows "This message was deleted"
    attachments   : Composition of many ProjectAttachment
                    on attachments.message = $self;
}

entity ProjectAttachment : managed {
    key attachmentId : String(60);            // "<messageId>-PATT-<n>"
    message          : Association to ProjectMessage;
    fileName         : String(255);
    mimeType         : String(100);
    fileSize         : Integer;
    content          : LargeBinary;
}

entity TaskUpdate : managed {
    // Widened from 20 → 40: group-task updates generate longer ids
    // ("<taskId>-UPD-<ts>-<rand>") that overflowed 20 on HANA. Solo updates
    // (~19 chars) still fit, so this is purely additive/non-breaking.
    key updateId       : String(40);
    task               : Association to TaskMaster;
    updateDate         : Date;
    title              : String(200);          // optional update title
    notes              : String(2000);
    attachmentName     : String(255);
    attachmentMimeType : String(100);
    attachment         : LargeBinary;
    updatedBy          : Association to EmployeeMaster;
}

entity TimesheetHeader : managed {
    // Generated as "<employeeId>-<weekStart>" (e.g. EMP1002-2026-05-25 = 18 chars),
    // so 15 was too short and overflowed on HANA (NVARCHAR length is enforced on
    // HANA but ignored on SQLite — the cause of the deployed-only 500s). Widened.
    key timesheetId    : String(50);

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
    // Generated as "<timesheetId>-<taskId>-<workDate>" (~37 chars) — 15 overflowed
    // on HANA. Widened so saves persist in the deployed environment.
    key entryId        : String(60);

    timesheet          : Association to TimesheetHeader;
    task               : Association to TaskMaster;   // null for custom ("Others") entries
    projectTask        : Association to ProjectTask;  // set instead of `task` when logging time on a project task (additive)

    workDate           : Date;
    hoursWorked        : Decimal(4,2);
    description        : String(255);

    // ── Custom ("Others") task support ────────────────────────────────────
    // When the employee picks "Others" instead of an assigned task, the work
    // is recorded here (no task association) and flagged so every screen can
    // visually distinguish it from manager-assigned work.
    isCustomTask       : Boolean default false;
    customTaskText     : String(30);   // free-text task name, max 30 chars

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
    // Generated as "<employeeId>-PREV-<timestamp>-<rand>" (~31 chars) — 30 was
    // 1 char short and overflowed on HANA (deployed-only 500 on prev-week request).
    key requestId       : String(50);       // e.g. EMP1001-PREV-1716000000000-AB12

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
    // (same 18-char "<employeeId>-<weekStart>" format → must match the widened key).
    timesheetId         : String(50);
}


entity LeaveRequest : managed {
    // Generated as "<employeeId>-LV-<timestamp>" (~24 chars) — 20 overflowed on HANA.
    key leaveId        : String(40);
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
    // Running counter for coalesced notifications (e.g. group-chat: "N new
    // messages"). Null for all existing/non-aggregated notifications.
    // NOTE: avoid the name "count" — COUNT is reserved in SAP HANA and the
    // unquoted runtime INSERT/UPDATE would fail there.
    msgCount           : Integer;
}
// ── Task Review (Reviewer's decision + remarks + attachment) ─────────────
// Created when a reviewer takes a decision on a task that is "In Review":
//   decision = 'Reviewed'   → original task moves to 'Completed'
//   decision = 'IssueFound' → original task moves back to 'In Progress'
// Stores remarks and an optional attachment uploaded by the reviewer.
entity TaskReview : managed {
    key reviewId       : String(30);     // TASK001-REV-1716000000000
    task               : Association to TaskMaster;
    reviewer           : Association to EmployeeMaster;
    assignee           : Association to EmployeeMaster;  // Original assignee (for filtering)
    decision           : String(20);     // Reviewed | IssueFound
    remarks            : String(2000);
    attachmentName     : String(255);
    attachmentMimeType : String(100);
    attachment         : LargeBinary;
    reviewedOn         : Timestamp;
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

// ── Holiday Master ────────────────────────────────────────────────────────
// HR maintains national / regional holidays here.  Team Attendance grid
// reads this to mark "H" cells.
entity HolidayMaster : managed {
    key holidayId      : String(20);         // HOL-2026-001
    holidayDate        : Date;               // 2026-08-15
    holidayName        : String(100);        // Independence Day
    isOptional         : Boolean default false; // optional / restricted holidays
    description        : String(255);
}

// ══════════════════════════════════════════════════════════════════════════════
// Project Management module (Phase 1) — ENTIRELY ADDITIVE.
// New entities only; no existing entity is modified, so Task / Leave / Timesheet /
// Performance / Notifications / Dashboard are unaffected.
// ══════════════════════════════════════════════════════════════════════════════

// ── Project Type master (configurable without code changes) ───────────────────
// Seeded with 5 defaults on first run; Founder/HR can add more. Each type drives
// its planning model, resource categories, phases and whether it earns revenue.
entity ProjectTypeMaster : managed {
    key code           : String(30);          // SAP_IMPL | SOFTWARE_DEV | SUPPORT | INTERNAL | OTHER
    name               : String(100);         // "SAP Implementation Project"
    planningModel      : String(40);          // Phase | Sprint | MonthlyCapacity | CostTracking
    hasRevenue         : Boolean default true; // Internal = false (cost tracking only)
    resourceCategories : LargeString;          // (legacy fallback) JSON array of role categories
    // Departments this type draws resources from (admin-configurable master data).
    // Roles are then derived DYNAMICALLY from active employees' designations in
    // these departments — never hardcoded. Empty → legacy department behaviour.
    departments        : LargeString;          // JSON array of department names
    phases             : LargeString;          // JSON array of phases (phase-based types)
    modules            : LargeString;          // JSON array of modules (e.g. SAP MM/SD/FI…)
    sortOrder          : Integer default 0;
    isActive           : Boolean default true;
}

// A project. POC = the single point-of-contact employee who allocates resources.
entity Project : managed {
    key projectId   : String(20);            // auto: PRJ-0001
    projectName     : String(150);           // unique (enforced in handler)
    customerName    : String(150);
    description     : String(1000);
    startDate       : Date;
    endDate         : Date;
    status          : String(20) default 'Planning'; // Planning|Active|On Hold|Completed|Cancelled
    priority        : String(20) default 'Medium';   // Low|Medium|High|Critical
    poc             : Association to EmployeeMaster;  // project POC
    pocName         : String(100);                    // denormalised for quick display
    createdByName   : String(100);                    // founder display name
    // ── Client ownership (one project belongs to exactly one client) ──────
    client          : Association to ClientMaster;
    clientName      : String(150);                    // denormalised for quick display
    currentPhase    : String(60);                     // free-text phase shown to client
    // ── Executive dashboard fields (Phase 2, additive) ────────────────────
    budget          : Decimal(15, 2) default 0;       // kept = executionBudget for back-compat
    goLiveDate      : Date;                            // planned go-live
    focusAreas      : String(500);                     // comma-separated tags
    // ── Project-type-driven planning (additive) ───────────────────────────
    // Existing rows default to 'OTHER' (backfilled on first run). Type drives
    // budgeting / planning-model / resource categories / forecasting.
    projectType     : Association to ProjectTypeMaster;
    projectTypeName : String(100);                     // denormalised for display
    // ── Financial model: Contract → Profit Reserve → Execution Budget ──────
    // executionBudget = contractValue − profitReserveAmount, and is the ONLY
    // ceiling resource/cost allocation may consume (never the contract value).
    contractValue       : Decimal(15, 2) default 0;
    profitMarginPct     : Decimal(5, 2)  default 0;
    profitReserveAmount : Decimal(15, 2) default 0;    // contractValue × margin%
    executionBudget     : Decimal(15, 2) default 0;    // contractValue − reserve
    // Skills this project needs — drives the Resource Recommendation engine
    // (70% skill-match weight). Comma-separated tags, matched against
    // EmployeeMaster.skills. Optional; empty = capacity-only recommendations.
    requiredSkills  : String(500);
    // ── Project chat pin (one active pin per project) ─────────────────────
    pinnedMessageId : String(50);
    pinnedByName    : String(100);
    // ── Project lifecycle (governance workflow before going Active) ────────
    // Planning → MeetingScheduled → MeetingCompleted → BudgetAllocated → (Active)
    lifecycleStage    : String(30) default 'Planning';
    planningMeetingId : String(45);      // FK to Meeting.meetingId (the planning meeting)
    resources       : Composition of many ProjectResource on resources.project = $self;
    tasks           : Composition of many ProjectTask    on tasks.project = $self;
    issues          : Composition of many ProjectIssue   on issues.project = $self;
}

// Budget allocation record created by the Founder once the planning meeting is done.
// Stores total budget + department-wise + other-category breakdowns as JSON.
entity ProjectBudget : managed {
    key budgetId          : String(30);        // <projectId>-BUDGET // 001,002
    project               : Association to Project;//project1, project2
    totalBudget           : Decimal(15,2) default 0;//18000000, 2000000
    departmentBudgets     : LargeString;        // JSON [{department,amount,notes}] (legacy, still read)//1000000, 1000000
    otherBudgets          : LargeString;        // JSON [{category,amount,notes}]  (legacy, still read)//
    // ── Category-based allocation (primary) — against Execution Budget ─────────
    // JSON [{category,amount,notes}] over the 7 cost categories: Resource Cost,
    // Infrastructure, Licensing, Vendor, Travel, Training, Miscellaneous.
    categoryBudgets       : LargeString;
    allocatedAt           : Timestamp;
    allocatedByName       : String(100);
}

// POC → Founder additional-budget escalation. One immutable row per request; decision
// fields are filled when the Founder approves/rejects. Approved amounts are deducted from
// the project's unallocated pool and added to the requested department's allocation.
entity ProjectBudgetRequest : managed {
    key requestId         : String(45);          // <projectId>-BR-<seq>
    project               : Association to Project;
    department            : String(50);
    requestedAmount       : Decimal(15,2) default 0;
    justification         : String(2000);
    businessImpact        : String(2000);
    requestedById         : String(10);
    requestedByName       : String(100);
    // Pending Founder Approval | Approved | Rejected | Withdrawn
    status                : String(30) default 'Pending Founder Approval';
    approvedAmount        : Decimal(15,2) default 0;
    founderComments       : String(2000);
    decidedByName         : String(100);
    decidedAt             : Timestamp;
    utilizationSnapshot   : Integer default 0;   // dept utilization % at request time
    deptBudgetBefore      : Decimal(15,2) default 0;
    deptBudgetAfter       : Decimal(15,2) default 0;
    unallocatedBefore     : Decimal(15,2) default 0;
    unallocatedAfter      : Decimal(15,2) default 0;
}

// Employee cost master — drives budget consumption (hourlyCost × hours logged).
entity EmployeeSalaryMaster : managed {
    key salaryId  : String(45);                        // <employeeId>-<effectiveFrom>
    employee      : Association to EmployeeMaster;
    employeeName  : String(100);
    annualSalary  : Decimal(15, 2);
    monthlySalary : Decimal(15, 2);
    hourlyCost    : Decimal(12, 2);                    // used for budget consumption
    effectiveFrom : Date;
    effectiveTo   : Date;
    isActive      : Boolean default true;
}

// ══════════════════════════════════════════════════════════════════════════════
// Milestone Management (enterprise) — ENTIRELY ADDITIVE.
// A project can have many milestones (auto-seeded from the project type's phases).
// Resource/task milestone links are nullable → existing project-level data is
// untouched and keeps working. Derived metrics (actual cost, variance, delay) are
// computed live by the cost/timeline engines — not stored, to avoid drift.
// ══════════════════════════════════════════════════════════════════════════════
entity Milestone : managed {
    key milestoneId    : String(40);          // <projectId>-M-001
    project            : Association to Project;
    name               : String(150);
    description        : String(1000);
    sequence           : Integer default 0;
    plannedStartDate   : Date;
    plannedEndDate     : Date;
    actualStartDate    : Date;
    actualEndDate      : Date;
    // Not Started | Planned | In Progress | Delayed | At Risk | Completed |
    // Completed Early | Blocked | Cancelled
    status             : String(25) default 'Not Started';
    progressPct        : Integer default 0;
    progressMode       : String(20) default 'manual';   // manual | task | timesheet
    owner              : Association to EmployeeMaster;
    ownerName          : String(100);
    remarks            : String(1000);
    isCritical         : Boolean default false;
    isBillable         : Boolean default true;
    plannedBudget      : Decimal(15, 2) default 0;
    // None | Pending Approval | Approved | Rejected | Rework Required
    approvalStatus     : String(25) default 'None';
    // ── Milestone planning detail (additive — Planning-First PM workflow) ──────
    priority           : String(20) default 'Medium';   // Low | Medium | High | Critical
    completionCriteria : String(1000);                  // definition of done
    deliverables       : String(1000);                  // expected outputs (free text / list)
    estimatedEffort    : Decimal(9, 2) default 0;       // planned effort in person-hours
    // Set when the milestone's resource plan exceeds the project baseline (approval hint).
    exceedsResourcePlan : Boolean default false;
    // ── Business-deliverable tracking (additive — Milestone = business planning) ──
    riskStatus         : String(20) default 'On Track'; // On Track | At Risk | Off Track
    actualCost         : Decimal(15, 2) default 0;      // rolled up from allocation/spend
    actualHours        : Decimal(9, 2) default 0;       // rolled up from time logs
    completionDate     : Date;                          // set when milestone Completed
}

// Finish-to-start dependency: `milestone` cannot start before `predecessor` Completed.
entity MilestoneDependency : managed {
    key dependencyId   : String(55);
    milestone          : Association to Milestone;   // the dependent
    predecessor        : Association to Milestone;   // must complete first
}

// Milestone completion approval (PM / Product Manager / Client / Founder).
entity MilestoneApproval : managed {
    key approvalId     : String(55);
    milestone          : Association to Milestone;
    approverRole       : String(30);
    approverId         : String(10);
    approverName       : String(100);
    status             : String(25) default 'Pending Approval';
    comments           : String(1000);
    decidedAt          : Timestamp;
}

// Project risk/issue register (Phase 2).
entity ProjectIssue : managed {
    key issueId  : String(45);                         // <projectId>-ISS-001
    project      : Association to Project;
    title        : String(200);
    description  : String(1000);
    severity     : String(20) default 'Medium';        // Critical | High | Medium | Low
    owner        : Association to EmployeeMaster;
    ownerName    : String(100);
    status       : String(20) default 'Open';          // Open | In Progress | Resolved | Closed
}

// FTE-based resource allocation: one row per (project, employee). bandwidth 25/50/75/100.
entity ProjectResource : managed {
    key allocationId : String(45);           // <projectId>-<employeeId>
    project          : Association to Project;
    employee         : Association to EmployeeMaster;
    employeeName     : String(100);
    department       : String(50);
    bandwidth        : Integer default 0;     // 25 | 50 | 75 | 100  (percent FTE) == allocation %
    // ── Time-boxed allocation (additive — Resource Planning module) ───────────
    // Existing rows have null dates → treated as "for the whole project duration"
    // by the availability/forecasting engine, so historical allocations stay
    // valid. allocatedHours is derived (bandwidth% × monthlyCapacityHours) and
    // persisted for fast dashboard reads; recomputed on every allocate.
    startDate        : Date;
    endDate          : Date;
    allocatedHours   : Decimal(7,2) default 0;
    // ── Allocation model (additive) — role on the project + lifecycle status.
    // Existing rows: role null, status defaults to 'Active' so they stay valid.
    role             : String(60);                   // project role/consultant category
    phase            : String(40);                   // phase-based plan (SAP: Discover…Hypercare)
    module           : String(60);                   // module assignment (SAP: MM/SD/FI…)
    milestone        : Association to Milestone;      // optional milestone scope (additive)
    // ── Cost snapshots (frozen at allocation time → historical accuracy) ───────
    // PMs never see salary; these are derived cost rates only.
    hourlyCostSnapshot : Decimal(12,2) default 0;     // fully-loaded rate/hr at allocation
    overheadSnapshot   : Decimal(12,2) default 0;     // monthly overhead applied
    totalAllocationCost: Decimal(15,2) default 0;     // rate × allocated hrs × project months
    status           : String(20) default 'Active';  // Planned | Active | Completed | Cancelled
    // ── Over-utilization override (additive) ──────────────────────────────────
    // Set when a POC/Founder knowingly allocates beyond 100% capacity. Drives the
    // "Overridden" badge; the full audit trail lives in ResourceOverride.
    isOverridden     : Boolean default false;
    overrideReason   : String(500);
    // ── Milestone-hours allocation model (additive, Resource Planning v2) ──────
    // When a PM allocates by milestone+hours, estimatedHours holds the total and the
    // system spreads it into ResourceMonthlyAllocation rows by working days. bandwidth
    // stays populated (derived) so every existing dashboard/report keeps working.
    estimatedHours   : Decimal(9,2) default 0;       // = milestoneAllocatedHours (project hrs × milestone %)
    // ── Milestone allocation as a % of the employee's PROJECT-allocated hours ──────
    // milestone% is relative to projectAllocationHours (NOT monthly capacity), so the
    // PM sees the exact % they entered (40h × 50% = 20h → 50%).
    projectAllocationHours   : Decimal(9,2) default 0;   // total approved project effort for this employee
    milestoneAllocationPercent : Integer default 0;      // % of project hours assigned to this milestone
    allocationType   : String(10) default 'Hard';    // Hard (confirmed) | Soft (tentative)
    billingRate      : Decimal(12,2) default 0;      // client bill rate/hr for this allocation
    // Daily money-spent tracking — actuals frozen on each reforecast.
    spentToDate      : Decimal(15,2) default 0;      // frozen actual ₹ at last snapshot
    spentFraction    : Decimal(9,6) default 0;       // milestone-elapsed fraction at snapshot (0..1)
    monthlyRows      : Composition of many ResourceMonthlyAllocation on monthlyRows.allocation = $self;
}

// System-generated month-wise allocation (never entered by hand). One row per
// (allocation, month). Source of truth for availability, forecasting, utilization
// and recommendations. Regenerated whenever the parent allocation/milestone changes.
entity ResourceMonthlyAllocation : managed {
    key monthlyId    : String(60);                   // <allocationId>-<YYYYMM>
    allocation       : Association to ProjectResource;
    project          : Association to Project;
    employee         : Association to EmployeeMaster;
    milestone        : Association to Milestone;
    yearMonth        : String(7);                    // "2026-07"
    allocatedHours   : Decimal(9,2) default 0;
    // ── Time-phased costing (additive) ────────────────────────────────────────
    // Per-month FROZEN cost. Past months (yearMonth < current) are never rewritten
    // when the allocation later changes → historical spend stays accurate.
    allocatedCost    : Decimal(15,2) default 0;      // month hours × loaded hourly rate
    allocationPct    : Integer default 0;            // that month's allocation % (display)
    allocationType   : String(10) default 'Hard';    // Hard | Soft (mirrors parent)
}

// Immutable audit of every allocation change (increase/decrease/partial release).
// One row per change; previous rows are never overwritten. Drives the time-phased
// reforecast trail and the "who changed what, and the budget impact" audit.
entity ResourceAllocationHistory : managed {
    key historyId    : String(70);
    allocation       : Association to ProjectResource;
    allocationId     : String(45);                   // denormalised for querying
    project          : Association to Project;
    employee         : Association to EmployeeMaster;
    employeeName     : String(100);
    milestone        : Association to Milestone;
    milestoneName    : String(150);
    effectiveFrom    : Date;
    effectiveTo      : Date;
    oldAllocationPct : Integer default 0;
    newAllocationPct : Integer default 0;
    monthlyHours     : Decimal(9,2) default 0;       // representative full-month hours
    spentCost        : Decimal(15,2) default 0;      // frozen historical at time of change
    forecastCost     : Decimal(15,2) default 0;      // future forecast after change
    estimatedCost    : Decimal(15,2) default 0;      // spent + forecast
    budgetImpact     : Decimal(15,2) default 0;      // newEstimated − oldEstimated (± = more/less)
    changeType       : String(20);                   // Created|Increased|Reduced|Removed|Rephased
    changedById      : String(10);
    changedByName    : String(100);
    changedAt        : Timestamp;
}

// ── Centralized Resource Planning configuration (singleton, configId='GLOBAL') ──
// Drives the capacity engine: recommendation weights (must sum logically; they
// are normalised at runtime), utilization threshold, working-time basis and the
// global non-billable reserve. Admin-editable — never hardcoded.
entity ResourcePlanningConfig : managed {
    key configId             : String(20) default 'GLOBAL';
    skillWeight              : Integer default 40;   // recommendation: skill match
    availabilityWeight       : Integer default 30;   // recommendation: future availability
    experienceWeight         : Integer default 15;   // recommendation: project experience
    certificationWeight      : Integer default 10;   // recommendation: certification match
    previousProjectWeight    : Integer default 5;    // recommendation: prior work w/ this client
    utilizationWeight        : Integer default 0;    // legacy headroom factor (kept, off by default)
    maxUtilizationThreshold  : Integer default 100;  // overallocation threshold %
    standardDailyHours       : Decimal(4,2) default 8;
    standardWorkingDays      : Integer default 20;    // working days per month basis
    nonBillablePct           : Integer default 0;     // % of capacity reserved (non-billable)
    // Configurable employee overhead (laptop/software/admin/etc., single amount in
    // V1) added to monthly salary to form the fully-loaded cost rate. NOT hardcoded.
    monthlyOverhead          : Decimal(12,2) default 10000;
}

// Company-wide non-working time (town halls, off-sites, shutdowns). Reduces every
// employee's effective capacity for the overlapping days. Distinct from public
// holidays (HolidayMaster) and per-employee leave (LeaveRequest).
entity CompanyEvent : managed {
    key eventId   : String(30);          // EVT-0001
    eventName     : String(150);
    fromDate      : Date;
    toDate        : Date;
    description   : String(500);
}

// Immutable audit trail of every over-utilization override. One row per override
// event (employee pushed beyond 100% FTE on a project). Founder-visible.
entity ResourceOverride : managed {
    key overrideId        : String(60);          // <projectId>-OVR-<employeeId>-<ts>
    project               : Association to Project;
    projectName           : String(150);
    employee              : Association to EmployeeMaster;
    employeeName          : String(100);
    utilizationBefore     : Integer default 0;   // total FTE % before this allocation
    utilizationAfter      : Integer default 0;   // total FTE % after
    reason                : String(500);         // mandatory
    overriddenById        : String(10);
    overriddenByName      : String(100);
    overriddenAt          : Timestamp;
}

// ════════════════════════════════════════════════════════════════════════════
// Resource Master Data (hierarchical) — Department → RoleCategory → Specialization
// plus Skill / Certification catalogs. ENTIRELY ADDITIVE & optional. Existing
// free-text EmployeeMaster.department / .designation keep working untouched; these
// masters drive the new cascading HR dropdowns and the hierarchical Manage-Resource
// grid. Names mirror existing free-text values so both worlds stay consistent.
// ════════════════════════════════════════════════════════════════════════════
entity DepartmentMaster : managed {
    key deptId   : String(20);            // SAP, ENG, …
    name         : String(100);           // matches existing free-text department names
    description  : String(255);
    sortOrder    : Integer default 0;
    isActive     : Boolean default true;
    roles        : Composition of many RoleCategoryMaster on roles.department = $self;
}
// ── Talent taxonomy masters (extended) ───────────────────────────────────────
// normalizedName = UPPER(trim(collapse-spaces(name))) — the dedup key (case-
// insensitive existence check). usageCount drives "most-used first" suggestions.
// Both are additive; existing rows are backfilled. New typed values are stored
// UPPERCASE per the taxonomy spec; existing display names are left as-is.
entity RoleCategoryMaster : managed {
    key roleId      : String(30);         // SAP-BASIS, SAP-FUNC, …
    department      : Association to DepartmentMaster;
    name            : String(100);        // Basis Consultant, Functional Consultant
    normalizedName  : String(100);
    usageCount      : Integer default 0;
    sortOrder       : Integer default 0;
    isActive        : Boolean default true;
    specializations : Composition of many SpecializationMaster on specializations.roleCategory = $self;
}
entity SpecializationMaster : managed {
    key specId    : String(40);           // SAP-FUNC-MM, …
    roleCategory  : Association to RoleCategoryMaster;
    name          : String(100);          // MM, SD, FICO, ABAP, …
    normalizedName: String(100);
    usageCount    : Integer default 0;
    sortOrder     : Integer default 0;
    isActive      : Boolean default true;
}
entity SkillMaster : managed {
    key skillId    : String(40);
    name           : String(100);
    normalizedName : String(100);
    usageCount     : Integer default 0;
    department     : Association to DepartmentMaster;   // optional scope
    category       : String(60);
    isActive       : Boolean default true;
}
entity CertificationMaster : managed {
    key certId     : String(40);
    name           : String(150);
    normalizedName : String(150);
    usageCount     : Integer default 0;
    department     : Association to DepartmentMaster;   // optional scope
    issuer         : String(100);
    isActive       : Boolean default true;
}
// Employee ↔ skill / certification links (normalized). The comma caches on
// EmployeeMaster (.skills / .certifications) remain the denormalized display
// values so the existing recommendation engine keeps working unchanged.
entity EmployeeSkill : managed {
    key id    : String(55);               // <employeeId>-<skillId>
    employee  : Association to EmployeeMaster;
    skill     : Association to SkillMaster;
    skillName : String(100);
    level     : String(20);               // Beginner / Intermediate / Expert (optional)
}
// Audit log of every email send attempt — powers delivery history, retries insight
// and a future "email history" UI. Additive; written best-effort by the EmailService.
entity EmailLog : managed {
    key logId      : String(40);
    recipient      : String(255);
    ccList         : String(500);
    subject        : String(255);
    template       : String(60);
    status         : String(20);          // Sent | Failed | Simulated
    attempts       : Integer default 1;
    errorMessage   : String(1000);
    refType        : String(40);          // MEETING | TASK | LEAVE | MILESTONE | …
    refId          : String(60);
    sentAt         : Timestamp;
}

entity EmployeeCertification : managed {
    key id            : String(55);        // <employeeId>-<certId>
    employee          : Association to EmployeeMaster;
    certification     : Association to CertificationMaster;
    certName          : String(150);
    certificateNumber : String(100);       // optional
    issuedBy          : String(150);       // optional
    obtainedDate      : Date;              // = Issue Date
    expiryDate        : Date;
    // Per-certificate document (PDF / JPG / PNG). Stored inline; served as base64
    // by a download action (same pattern as EmployeeDocument / TaskDocument).
    documentFileName  : String(255);
    documentMimeType  : String(100);
    document          : LargeBinary;
}

// Resource demand a project declares up-front: how many of which Dept→Role→Spec it
// needs, for how many hours, over which window. Additive — drives the hierarchical
// Manage-Resource grid (supply side = ProjectResource allocations).
entity ProjectResourceRequirement : managed {
    key requirementId : String(45);          // <projectId>-REQ-001
    project           : Association to Project;
    department        : Association to DepartmentMaster;
    departmentName    : String(100);          // denormalised display
    roleCategory      : Association to RoleCategoryMaster;
    roleCategoryName  : String(100);
    specialization    : Association to SpecializationMaster;
    specializationName: String(100);
    requiredCount     : Integer default 1;
    estimatedHours    : Decimal(9,2) default 0;      // per-employee planning hours (renamed from requiredHours)
    status            : String(20) default 'Open';   // Open | Fulfilled | Cancelled
    // ── Skill/experience planning detail (Planning-First workflow) ────────────
    skillCategory     : String(100);
    skills            : String(500);
    experienceRange   : String(40);
}

// Milestone-level staffing plan vs the project baseline (execution planning).
entity MilestoneResourceRequirement : managed {
    key mrId          : String(60);          // <milestoneId>-<requirementId>
    milestone         : Association to Milestone;
    requirement       : Association to ProjectResourceRequirement;
    roleName          : String(150);
    departmentName    : String(100);
    plannedQuantity   : Integer default 0;   // baseline qty from the project requirement
    milestoneQuantity : Integer default 0;   // qty this milestone requests
    hoursPerEmployee  : Decimal(9, 2) default 0;
    notes             : String(500);
    planStatus        : String(20) default 'within';   // within | exceeds | unplanned
}

// Immutable audit of every milestone resource-plan change.
entity MilestoneResourceAudit : managed {
    key auditId       : String(60);
    milestone         : Association to Milestone;
    milestoneName     : String(150);
    roleName          : String(150);
    previousQuantity  : Integer default 0;
    newQuantity       : Integer default 0;
    changedById       : String(20);
    changedByName     : String(100);
    reason            : String(500);
    changedAt         : Timestamp;
}

// ── Sprint (execution planning) — belongs to a Milestone (business planning) ──
// Milestones plan the business; Sprints execute work inside them. Capacity is
// derived from the milestone's resource allocations (no separate cost engine).
// Sprint = EXECUTION, a DIRECT child of Project (NOT of Milestone). Stories are the
// only bridge between a Milestone and a Sprint. New ids are <projectId>-S-001.
entity Sprint : managed {
    key sprintId           : String(45);          // <projectId>-S-001
    project                : Association to Project;
    // DEPRECATED: sprints are no longer children of a milestone. Column kept nullable
    // for backward compatibility with existing rows; do NOT read it as a hierarchy.
    milestone              : Association to Milestone;
    name                   : String(150);
    goal                   : String(500);
    sprintNumber           : Integer default 1;
    // Backlog | Planned | Active | Completed | Cancelled
    status                 : String(20) default 'Backlog';
    startDate              : Date;
    endDate                : Date;
    estimatedCapacityHours : Decimal(9, 2) default 0;  // planned capacity for the sprint
    owner                  : Association to EmployeeMaster;
    ownerName              : String(100);
    description            : String(1000);
    sequence               : Integer default 0;        // ordering within the project
    completedAt            : Timestamp;
    // ── Sprint execution metrics (additive) ──────────────────────────────────────
    velocity               : Decimal(9, 2) default 0;  // completed story points last run
    teamJson               : LargeString;              // committed team members snapshot
    burndownJson           : LargeString;              // [{date, remaining}] burndown series
    health                 : String(20) default 'On Track'; // On Track | At Risk | Off Track
}

// A task that belongs to a project (cannot exist without one). Refactored into a
// Jira-style work item: still a ProjectTask (all existing APIs/flows preserved),
// now optionally inside a Sprint with a work-item type, story points and a parent.
entity ProjectTask : managed {
    key taskId       : String(25);           // <projectId>-T-001
    project          : Association to Project;
    taskName         : String(150);
    description      : String(1000);
    assignedTo       : Association to EmployeeMaster;
    assignedToName   : String(100);
    priority         : String(20) default 'Medium';
    status           : String(20) default 'Not Started'; // Not Started|In Progress|In Review|Testing|Completed|Blocked
    startDate        : Date;
    dueDate          : Date;
    estimatedHours   : Decimal(7, 2) default 0;
    actualHours      : Decimal(7, 2) default 0;      // = logged hours
    completedAt      : Timestamp;
    milestone        : Association to Milestone;      // optional milestone scope (additive)
    // ── Sprint / Jira work-item model (additive — existing tasks stay valid) ──────
    sprint           : Association to Sprint;         // execution container (optional)
    workItemType     : String(20) default 'Task';    // Epic | Story | Task | Bug | Subtask | Spike
    storyPoints      : Decimal(5, 1) default 0;
    parentTask       : Association to ProjectTask;    // story→subtask / epic→story
    reporter         : Association to EmployeeMaster;
    reporterName     : String(100);
    labels           : String(300);                  // comma-separated
    // ── Story bridge / execution detail (additive) ───────────────────────────────
    // Story = the ONLY link between a Milestone and a Sprint: a Story MUST have both
    // milestone and sprint. Task/Subtask inherit milestone+sprint+project from their
    // parent Story. Bug may hang off a Story or directly off a Sprint.
    remainingHours     : Decimal(7, 2) default 0;     // work left (drives sprint capacity)
    acceptanceCriteria : String(2000);                // definition of done for a story
    epic               : Association to ProjectTask;  // optional epic grouping
}

// Threaded comments on a work item (Jira-style activity).
entity WorkItemComment : managed {
    key commentId : String(60);
    task          : Association to ProjectTask;
    authorId      : String(20);
    authorName    : String(100);
    text          : String(2000);
    at            : Timestamp;
}

// Immutable audit trail for every project-module action.
entity ProjectAuditLog : managed {
    key logId   : String(45);
    project     : Association to Project;
    userName    : String(100);
    action      : String(60);                // Project Created | POC Assigned | …
    oldValue    : String(500);
    newValue    : String(500);
    at          : Timestamp;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL & REQUIREMENT MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

// External customer who owns one or more projects. Authenticated via the
// 'Client' XSUAA scope; identity resolved by matching login email → this.email.
// Clients are NOT employees and never appear in EmployeeMaster.
entity ClientMaster : managed {
    key clientId    : String(20);                 // CLT-0001
    // ── Company information ───────────────────────────────────────────────────
    // clientName / companyName retained for backward compatibility. companyName is
    // the enterprise-facing "Company Name *"; clientName mirrors it when only one
    // is supplied so existing screens (project pickers, requirements) keep working.
    clientName      : String(150);
    companyName     : String(150);
    clientType      : String(20);                 // Enterprise | SMB | Startup | Individual | Internal
    industry        : String(100);
    website         : String(200);
    country         : String(80);
    timeZone        : String(60);
    // ── Primary contact ───────────────────────────────────────────────────────
    contactPerson   : String(100);                // Primary contact name
    designation     : String(100);                // Primary contact designation
    email           : String(150);                // login identity (unique, lower-cased on read)
    phoneNumber     : String(30);                 // Primary phone (with country code)
    // ── Secondary contact (optional) ─────────────────────────────────────────
    secondaryContactName : String(100);
    secondaryEmail       : String(150);
    secondaryPhone       : String(30);
    // ── Billing information (optional) ───────────────────────────────────────
    billingEmail    : String(150);
    gstNumber       : String(50);                 // GST / VAT number
    billingAddress  : String(300);
    // ── Status & misc ────────────────────────────────────────────────────────
    status          : String(20) default 'Prospect'; // Prospect | Active | Inactive | Blacklisted
    lastLogin       : Timestamp;
    notes           : String(2000);
    projects        : Composition of many Project on projects.client = $self;
    // Audit (createdBy/createdAt/modifiedBy/modifiedAt) provided by `managed`.
}

// Immutable audit trail of every client status transition.
entity ClientStatusHistory : managed {
    key historyId   : String(30);                 // CSH-000001
    client          : Association to ClientMaster;
    clientId        : String(20);                 // denormalised for easy querying
    oldStatus       : String(20);
    newStatus       : String(20);
    reason          : String(500);
    changedBy       : String(150);                // caller display name / email
    changedOn       : Timestamp;
}

// A business requirement raised by a client against one of their projects.
entity Requirement : managed {
    key requirementId   : String(30);             // <projectId>-REQ-001
    project             : Association to Project;
    client              : Association to ClientMaster;   // denormalised owner (isolation key)
    title               : String(200);
    description         : String(4000);
    businessJustification : String(2000);
    priority            : String(20) default 'Medium';   // Critical | High | Medium | Low
    expectedDeliveryDate : Date;
    category            : String(100);             // Requirement Category
    module              : String(100);
    remarks             : String(1000);
    // ── Assignment ────────────────────────────────────────────────────────
    assignedTo          : Association to EmployeeMaster; // POC or a project employee
    assignedToName      : String(100);
    assignedByName      : String(100);            // client contact who assigned
    assignedDate        : Timestamp;
    // ── Status workflow ─────────────────────────────────────────────────────
    // New | Assigned | Under Analysis | In Development | Under Testing |
    // Awaiting Client Review | Approved | Rejected | Closed
    status              : String(30) default 'New';
    approvalComments    : String(2000);           // mandatory on approve/reject
    closedAt            : Timestamp;
    attachments         : Composition of many RequirementAttachment on attachments.requirement = $self;
    comments            : Composition of many RequirementComment    on comments.requirement = $self;
    history             : Composition of many RequirementAudit       on history.requirement = $self;
}

// Multiple versioned attachments per requirement (stored inline as base64-blob).
entity RequirementAttachment : managed {
    key attachmentId : String(50);                // <requirementId>-ATT-<n>
    requirement      : Association to Requirement;
    fileName         : String(255);
    mimeType         : String(100);
    fileSize         : Integer;
    version          : Integer default 1;
    uploadedByName   : String(100);
    content          : LargeBinary;
}

// Flat discussion thread on a requirement (client + assigned employee + POC).
entity RequirementComment : managed {
    key commentId    : String(50);                // <requirementId>-CMT-<ts>-<rand>
    requirement      : Association to Requirement;
    authorName       : String(100);
    authorRole       : String(20);                // client | employee | poc | founder
    authorEmployee   : Association to EmployeeMaster;  // null when author is a client
    message          : LargeString;
    isDeleted        : Boolean default false;
    attachmentName   : String(255);
    attachmentMimeType : String(100);
    attachment       : LargeBinary;
}

// Immutable audit trail for a requirement (created, assigned, status change,
// document upload, comment, approval/rejection). Stores who + when.
entity RequirementAudit : managed {
    key auditId   : String(50);                   // <requirementId>-AUD-<ts>-<rand>
    requirement   : Association to Requirement;
    userName      : String(100);
    action        : String(60);                   // Created | Assigned | Status Changed | …
    oldValue      : String(500);
    newValue      : String(500);
    at            : Timestamp;
}

// ── Microsoft Teams Meetings ─────────────────────────────────────────────────
// One row per scheduled meeting.  teamsMeetingId / teamsJoinUrl are populated
// by the Graph API response (or mock IDs in dev mode).
entity Meeting : managed {
    key meetingId       : String(45);           // MTG-<projectId>-<seq>
    project             : Association to Project;
    title               : String(200);
    meetingType         : String(150);           // free-text: Kick-off, UAT Sign-off, custom…
    agenda              : String(2000);
    startDateTime       : DateTime;
    endDateTime         : DateTime;
    timeZone            : String(60);            // IANA zone the wall-times are in
    meetingMode         : String(20) default 'Teams'; // Teams | InPerson
    location            : String(300);           // room / address for In-Person meetings
    organizerEmail      : String(150);           // Azure AD UPN / employee email
    organizerName       : String(100);
    organizer           : Association to EmployeeMaster;
    status              : String(20) default 'Scheduled'; // Draft|Scheduled|Completed|Cancelled
    manualLink          : Boolean default false; // Teams link was entered manually (fallback)
    teamsMeetingId      : String(500);           // Graph API id
    teamsJoinUrl        : String(1000);          // Graph API joinWebUrl
    teamsDialIn         : String(500);           // optional dial-in URL
    participants        : Composition of many MeetingParticipant on participants.meeting = $self;
}

// One row per invited employee.
entity MeetingParticipant : managed {
    key participantId   : String(50);
    meeting             : Association to Meeting;
    employee            : Association to EmployeeMaster;  // null for external participants
    employeeName        : String(100);
    employeeEmail       : String(150);
    isExternal          : Boolean default false;          // guest / non-employee
    isRequired          : Boolean default false;          // required vs additional
    attendanceStatus    : String(20) default 'Invited'; // Invited|Accepted|Declined|Attended
}
}