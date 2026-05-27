using {ccentrik.employee.timesheet.schema as db} from '../db/data-model';

// ── Employee Service ─────────────────────────────────────────────────────────
service EmployeeService @(path: '/employee') {

    entity MyTimesheets @(requires: [
        'Employee',
        'Manager'
    ])                                               as projection on db.timesheet.TimesheetHeader;

    entity MyEntries @(requires: [
        'Employee',
        'Manager'
    ])                                               as projection on db.timesheet.TimesheetEntry;

    entity MyTasks @(requires: [
        'Employee',
        'Manager'
    ])                                               as projection on db.timesheet.TaskMaster;

    entity TaskUpdates @(requires: [
        'Employee',
        'Manager'
    ])                                               as projection on db.timesheet.TaskUpdate;

    entity Employees @(requires: [
        'Employee',
        'Manager'
    ])                                               as projection on db.timesheet.EmployeeMaster;

    entity PerformanceRatings                        as projection on db.timesheet.PerformanceRating;

    // Expose new approval-request entities to employees
    entity DayUnlockRequests @(requires: 'Employee') as projection on db.timesheet.TimesheetDayUnlockRequest;

    entity PrevWeekRequests @(requires: 'Employee')  as projection on db.timesheet.TimesheetPrevWeekRequest;

    // ── Timesheet grid data loader ────────────────────────────────────────────────
    // Returns everything the grid needs in one call:
    // current-week header, all entries, approval-request statuses,
    // prev-week request status, and tasks list.
    @(requires: 'authenticated-user')
    action getTimesheetWeekData(weekStartDate: Date, // ISO "YYYY-MM-DD" Monday
                                weekEndDate: Date // ISO "YYYY-MM-DD" Sunday
    )                                                                      returns {
        timesheetId        : String;
        weekStatus         : String; // Draft | Submitted | Approved | Rejected | None
        entries            : LargeString; // JSON array of TimesheetEntry rows
        dayUnlockRequests  : LargeString; // JSON array of DayUnlockRequest rows for this week
        prevWeekRequest    : LargeString; // JSON object of PrevWeekRequest if any
        isPrevWeekApproved : Boolean;
        tasks              : LargeString; // JSON array of TaskMaster for dropdown
    };

    // ── Save timesheet entries (current or approved-prev week) ────────────────────
    @(requires: 'authenticated-user')
    action saveTimesheetEntries(timesheetId: String,
                                weekStartDate: Date,
                                weekEndDate: Date,
                                isPrevWeek: Boolean,
                                entries: LargeString // JSON array [{taskId, workDate, hoursWorked, description}]
    )                                                                      returns {
        timesheetId : String;
        saved       : Integer; // number of entries upserted
    };

    // ── Request HR approval to unlock a missed day ────────────────────────────────
    @(requires: 'Employee')
    action requestDayUnlock(targetDate: Date,
                            hrApproverId: String,
                            employeeRemarks: String)                       returns {
        requestId : String;
        status    : String;
    };

    // ── Request manager approval to fill previous week ───────────────────────────
    @(requires: 'Employee')
    action requestPrevWeekFill(weekStartDate: Date,
                               weekEndDate: Date,
                               employeeRemarks: String)                    returns {
        requestId : String;
        status    : String;
    };

    // ── Submit timesheet (current week → Pending, prev week → Saved directly) ────
    // Replaces the old submitTimesheet; keeps backward compat via timesheetId param.
    @(requires: 'authenticated-user')
    action submitTimesheetWeek(timesheetId: String,
                               isPrevWeek: Boolean // if true → status stays Approved (no manager re-approval)
    )                                                                      returns String;


    @(requires: 'authenticated-user')
    action uploadProfilePhoto(dataBase64: LargeString)                     returns {
        success : Boolean;
        message : String;
    };

    @(requires: 'authenticated-user')
    action getProfilePhoto()                                               returns {
        dataBase64 : LargeString;
        mimeType   : String(100);
    };

    @(requires: [
        'Employee',
        'HR',
        'Manager'
    ])
    action updateTaskStatus(taskId: String(10),
                            status: String(20),
                            reviewerId: String(10),
                            reviewerStatus: String(20))
    returns {
        taskId : String(10);
        status : String(20);
    };

    // ── Review workflow ──────────────────────────────────────────────
    // Reviewer submits "Reviewed" decision → task becomes 'Completed'.
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action submitReview(taskId: String(10),
                        remarks: String(2000),
                        fileName: String(255),
                        mimeType: String(100),
                        dataBase64: LargeString)                           returns {
        reviewId : String(30);
        taskId   : String(10);
        status   : String(20);
    };

    // Reviewer submits "Issue Found" → task returns to 'In Progress'.
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action reportIssue(taskId: String(10),
                       remarks: String(2000),
                       fileName: String(255),
                       mimeType: String(100),
                       dataBase64: LargeString)                            returns {
        reviewId : String(30);
        taskId   : String(10);
        status   : String(20);
    };

    // Read the latest review for a task (for assignee to see what reviewer wrote).
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action getTaskReview(taskId: String(10))                               returns {
        reviewId       : String(30);
        reviewerId     : String(10);
        reviewerName   : String(100);
        decision       : String(20);
        remarks        : String(2000);
        attachmentName : String(255);
        reviewedOn     : String;
    };

    // Download attachment uploaded by a reviewer (kept as base64 stream).
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action getReviewAttachment(reviewId: String(30))                       returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };

    // Read-only projection so the UI can list/inspect review records.
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    entity TaskReviews                               as projection on db.timesheet.TaskReview;

    // ── Leave ────────────────────────────────────────────────────────
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    entity LeaveRequests                             as projection on db.timesheet.LeaveRequest;

    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action applyLeave(employeeId: String,
                      leaveType: String,
                      fromDate: Date,
                      toDate: Date,
                      days: Integer,
                      reason: String,
                      isUnpaid: Boolean)                                   returns {
        leaveId  : String;
        status   : String;
        isUnpaid : Boolean;
    };

    @(requires: 'authenticated-user')
    action submitTimesheet(timesheetId: String(15))                        returns String;

    @(requires: 'authenticated-user')
    action getUserRole()                                                   returns {
        role : String
    };

    @(requires: 'authenticated-user')
    action getCurrentUser()                                                returns {
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

    @(requires: [
        'Employee',
        'Manager'
    ])
    action consumeTaskAttachment(taskId: String(20))                       returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };

    // Dashboard action: Get work anniversary info for the logged-in employee.
    // Returns years completed, joining date, and a message.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action getWorkAnniversary()                                            returns {
        yearsCompleted : Decimal(5, 2);
        joiningDate    : Date;
        message        : String(255);
    };

    // Dashboard action: Get leave balance for the logged-in employee.
    // Returns casual, sick, annual leave counts and total.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action getLeaveBalance()                                               returns {
        casualLeave : Integer;
        sickLeave   : Integer;
        annualLeave : Integer;
        total       : Integer;
    };

    // Dashboard action: Get my tasks summary for the logged-in employee.
    // Returns count of pending tasks and high priority tasks.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action getMyTasks()                                                    returns {
        totalPending        : Integer;
        highPriorityCount   : Integer;
        mediumPriorityCount : Integer;
        lowPriorityCount    : Integer;
    };

    action markAttendance(attendanceDate: String,
                          attendanceDay: String,
                          attendanceTime: String)                          returns {
        attendanceId   : String;
        employeeId     : String;
        employeeName   : String;
        attendanceDate : String;
        attendanceDay  : String;
        attendanceTime : String;
        message        : String;
    };

    action getTodayAttendance(attendanceDate: String)                      returns {
        alreadyMarked  : Boolean;
        attendanceTime : String;
        attendanceDay  : String;
    };


    entity AttendanceRecord                          as projection on db.timesheet.AttendanceRecord;

    // Attendance card  (frontend-only for now; backend returns mock/stub data)
    action getAttendance()                                                 returns {
        attendancePercentage : Integer;
        presentCount         : Integer;
        absentCount          : Integer;
        monthLabel           : String;
    };

    // Performance Rating card
    action getPerformanceRating()                                          returns {
        ratingValue    : Decimal(3, 1);
        ratingCategory : String(30);
        reviewMonth    : Integer;
        reviewYear     : Integer;
        reviewComment  : String(500);
    };

    // Performance Trend graph  (returns JSON array as a String for flexibility)
    action getPerformanceTrend(year: Integer)                              returns {
        trendJSON : String; // JSON array: [{month,monthName,rating}, ...]
    };

    // Task Summary donut chart  (reuses existing TaskMaster entity)
    action getTaskSummary()                                                returns {
        total      : Integer;
        notStarted : Integer;
        inProgress : Integer;
        inReview   : Integer;
        completed  : Integer;
    };

    // Recent Notifications (last 5 for logged-in employee)
    action getRecentNotifications()                                        returns array of {
        notificationId : String(30);
        type           : String(30);
        title          : String(100);
        message        : String(500);
        isRead         : Boolean;
        referenceId    : String(30);
        notifiedAt     : String; // ISO timestamp string
    };

    // Upcoming Calendar events from Google Calendar
    action getUpcomingCalendar()                                           returns {
        eventsJSON : String; // JSON array of {id, title, start, end, timeLabel, dateLabel, isToday}
    };

    // My Leave Overview — yearly taken vs balance
    action getLeaveOverview(year: Integer)                                 returns {
        casual    : Integer; // balance remaining
        sick      : Integer;
        annual    : Integer;
        unpaid    : Integer;
        totalDays : Integer;
        takenJSON : String; // [{type,label,taken,balance,color}]
    };

}

// ── Manager Service ──────────────────────────────────────────────────────────
service ManagerService @(path: '/manager')@(requires: 'Manager') {

    entity PendingApprovals as projection on db.timesheet.TimesheetHeader
                               where
                                   status = 'Pending';

    entity ApprovalEntries  as projection on db.timesheet.TimesheetEntry;
    entity Employees        as projection on db.timesheet.EmployeeMaster;
    entity Tasks            as projection on db.timesheet.TaskMaster;
    entity TaskUpdates      as projection on db.timesheet.TaskUpdate;

    entity LeaveRequests    as projection on db.timesheet.LeaveRequest;

    action approveLeave(leaveId: String,
                        approved: Boolean,
                        remarks: String)                                   returns {
        leaveId : String;
        status  : String;
    };

    action approveTimesheet(timesheetId: String(15), remarks: String(255)) returns String;
    action rejectTimesheet(timesheetId: String(15), remarks: String(255))  returns String;

    action notifyTaskAssignment(taskId: String(20),
                                taskName: String(100),
                                taskDescription: String(2000),
                                priority: String(20),
                                dueDate: String(20),
                                assigneeId: String(10))                    returns {
        sent      : Boolean;
        recipient : String;
        subject   : String;
        message   : String;
    };

    action uploadTaskAttachment(taskId: String(20),
                                fileName: String(255),
                                mimeType: String(100),
                                dataBase64: LargeString)                   returns String;


    action submitPerformanceRating(employeeId: String,
                                   ratingValue: Decimal(3, 1),
                                   reviewMonth: Integer,
                                   reviewYear: Integer,
                                   reviewComment: String,
                                   ratingCategory: String)                 returns {
        ratingId : String;
        message  : String;
    };

    entity PrevWeekRequests as projection on db.timesheet.TimesheetPrevWeekRequest;

    action approvePrevWeekRequest(requestId: String,
                                  approved: Boolean,
                                  managerRemarks: String)                  returns {
        requestId   : String;
        status      : String;
        timesheetId : String;
    };

    // ── Team Attendance ───────────────────────────────────────────────────
    // Read-only Holiday projection so the grid can mark "H" cells.
    entity Holidays         as projection on db.timesheet.HolidayMaster;

    // Returns the full attendance grid for every employee reporting to the
    // logged-in manager, for the requested calendar month.  Output is JSON
    // (LargeString) to avoid a deep CDS type forest.
    action getTeamAttendance(year: Integer,
                             month: Integer)                               returns {
        employees : LargeString; // [{employeeId,employeeName,designation,email,days:[{date,status,time}]}]
        holidays  : LargeString; // [{date,name}]
        daysInMonth : Integer;
    };

}


// ── HR Service ───────────────────────────────────────────────────────────────
service HRService @(path: '/hr')@(requires: 'HR') {

    @odata.draft.enabled
    entity Employees                           as projection on db.timesheet.EmployeeMaster;

    entity Documents                           as projection on db.timesheet.EmployeeDocument;

    entity LeaveRequests                       as projection on db.timesheet.LeaveRequest;

    action nextEmployeeId()                                                returns String;

    action addEmployee(employeeName: String(100),
                       designation: String(50),
                       email: String(100),
                       address: String(255),
                       mobileNumber: String(15),
                       managerEmployeeId: String(10),
                       dateOfBirth: Date,
                       gender: String(10),
                       department: String(50),
                       joiningDate: Date,
                       employmentType: String(20),
                       aadhaarNumber: String(20),
                       panNumber: String(15),
                       emergencyContact: String(15),
                       bloodGroup: String(5),
                       bankAccountNumber: String(30),
                       bankName: String(60),
                       bankIfsc: String(15))                               returns {
        employeeId : String(10);
    };

    action uploadEmployeeDocument(employeeId: String(10),
                                  documentType: String(40),
                                  fileName: String(255),
                                  mimeType: String(100),
                                  description: String(255),
                                  dataBase64: LargeString)                 returns String;

    action getEmployeeDocument(documentId: String(20))                     returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };

    entity DayUnlockRequests @(requires: 'HR') as projection on db.timesheet.TimesheetDayUnlockRequest;

    action approveDayUnlock(requestId: String,
                            approved: Boolean,
                            hrRemarks: String)                             returns {
        requestId : String;
        status    : String;
    };

    // Holiday master — HR maintains national/regional holidays here.
    entity Holidays                            as projection on db.timesheet.HolidayMaster;
}
