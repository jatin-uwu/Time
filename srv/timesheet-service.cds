using { ccentrik.employee.timesheet.schema as db } from '../db/data-model';

// ── Employee Service ─────────────────────────────────────────────────────────
service EmployeeService @(path:'/employee') {

    entity MyTimesheets @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetHeader;
    entity MyEntries    @(requires: ['Employee','Manager']) as projection on db.timesheet.TimesheetEntry;
    entity MyTasks      @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskMaster;
    entity TaskUpdates  @(requires: ['Employee','Manager']) as projection on db.timesheet.TaskUpdate;
    entity Employees    @(requires: ['Employee','Manager']) as projection on db.timesheet.EmployeeMaster;
    entity PerformanceRatings as projection on db.timesheet.PerformanceRating;

    // ── Notifications (employee sees own notifications) ──────────────────
    @(requires: ['Employee','Manager','HR'])
    entity MyNotifications as projection on db.timesheet.Notification;

    @(requires: ['Employee','Manager'])
    action createTaskNotification(
        employeeId  : String,
        type        : String,
        title       : String,
        message     : String,
        referenceId : String
    ) returns Boolean;


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

    @(requires: ['Employee','Manager'])
    action markNotificationsRead(notificationIds : array of String) returns Boolean;

    @(requires: ['Employee','Manager'])
    action getWorkAnniversary() returns {
        yearsCompleted : Decimal(5,2);
        joiningDate    : Date;
        message        : String(255);
    };

    @(requires: ['Employee','Manager'])
    action getLeaveBalance() returns {
        casualLeave : Integer;
        sickLeave   : Integer;
        annualLeave : Integer;
        total       : Integer;
    };

    @(requires: ['Employee','Manager'])
    action getMyTasks() returns {
        totalPending      : Integer;
        highPriorityCount : Integer;
        inProgressCount   : Integer;
        notStartedCount   : Integer;
    };

    function getAttendance() returns {
        attendancePercentage : Integer;
        presentCount         : Integer;
        absentCount          : Integer;
        monthLabel           : String;
    };

    function getPerformanceRating() returns {
        ratingValue      : Decimal(3,1);
        ratingCategory   : String(30);
        reviewMonth      : Integer;
        reviewYear       : Integer;
        reviewComment    : String(500);
    };

    function getPerformanceTrend(year : Integer) returns {
        trendJSON : String;
    };

    function getTaskSummary() returns {
        total       : Integer;
        notStarted  : Integer;
        inProgress  : Integer;
        inReview    : Integer;
        completed   : Integer;
    };

    function getRecentNotifications() returns array of {
        notificationId : String(30);
        type           : String(30);
        title          : String(100);
        message        : String(500);
        isRead         : Boolean;
        referenceId    : String(30);
        notifiedAt     : String;
    };

    function getUpcomingCalendar() returns {
        eventsJSON : String;
    };

    function getLeaveOverview(year : Integer) returns {
        casual       : Integer;
        sick         : Integer;
        annual       : Integer;
        unpaid       : Integer;
        totalDays    : Integer;
        takenJSON    : String;
    };
}

// ── Manager Service ──────────────────────────────────────────────────────────
service ManagerService @(path:'/manager') @(requires: 'Manager') {

    entity PendingApprovals as projection on db.timesheet.TimesheetHeader where status = 'Pending';
    entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;
    entity Employees        as projection on db.timesheet.EmployeeMaster;
    entity Tasks            as projection on db.timesheet.TaskMaster;
    entity TaskUpdates      as projection on db.timesheet.TaskUpdate;

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
