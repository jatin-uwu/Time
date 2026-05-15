using {ccentrik.employee.timesheet.schema as db} from '../db/data-model';

// ── Employee Service ─────────────────────────────────────────────────────────
service EmployeeService @(path: '/employee') {

<<<<<<< HEAD
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

=======
    entity MyTimesheets @(requires: [
        'Employee',
        'Manager'
    ])                        as projection on db.timesheet.TimesheetHeader;

    entity MyEntries @(requires: [
        'Employee',
        'Manager'
    ])                        as projection on db.timesheet.TimesheetEntry;

    entity MyTasks @(requires: [
        'Employee',
        'Manager'
    ])                        as projection on db.timesheet.TaskMaster;

    entity TaskUpdates @(requires: [
        'Employee',
        'Manager'
    ])                        as projection on db.timesheet.TaskUpdate;

    entity Employees @(requires: [
        'Employee',
        'Manager'
    ])                        as projection on db.timesheet.EmployeeMaster;

    entity PerformanceRatings as projection on db.timesheet.PerformanceRating;
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6

    // ── Leave ────────────────────────────────────────────────────────
    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    entity LeaveRequests      as projection on db.timesheet.LeaveRequest;

    @(requires: [
        'Employee',
        'Manager',
        'HR'
    ])
    action   applyLeave(employeeId: String,
                        leaveType: String,
                        fromDate: Date,
                        toDate: Date,
                        days: Integer,
                        reason: String,
                        isUnpaid: Boolean)                                 returns {
        leaveId  : String;
        status   : String;
        isUnpaid : Boolean;
    };

    @(requires: 'authenticated-user')
    action   submitTimesheet(timesheetId: String(15))                      returns String;

    @(requires: 'authenticated-user')
    action   getUserRole()                                                 returns {
        role : String
    };

    @(requires: 'authenticated-user')
    action   getCurrentUser()                                              returns {
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
    action   consumeTaskAttachment(taskId: String(20))                     returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };

<<<<<<< HEAD
    @(requires: ['Employee','Manager'])
    action markNotificationsRead(notificationIds : array of String) returns Boolean;

    @(requires: ['Employee','Manager'])
    action getWorkAnniversary() returns {
        yearsCompleted : Decimal(5,2);
=======
    // Dashboard action: Get work anniversary info for the logged-in employee.
    // Returns years completed, joining date, and a message.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action   getWorkAnniversary()                                          returns {
        yearsCompleted : Decimal(5, 2);
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        joiningDate    : Date;
        message        : String(255);
    };

<<<<<<< HEAD
    @(requires: ['Employee','Manager'])
    action getLeaveBalance() returns {
=======
    // Dashboard action: Get leave balance for the logged-in employee.
    // Returns casual, sick, annual leave counts and total.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action   getLeaveBalance()                                             returns {
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        casualLeave : Integer;
        sickLeave   : Integer;
        annualLeave : Integer;
        total       : Integer;
    };

<<<<<<< HEAD
    @(requires: ['Employee','Manager'])
    action getMyTasks() returns {
=======
    // Dashboard action: Get my tasks summary for the logged-in employee.
    // Returns count of pending tasks and high priority tasks.
    @(requires: [
        'Employee',
        'Manager'
    ])
    action   getMyTasks()                                                  returns {
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        totalPending      : Integer;
        highPriorityCount : Integer;
        mediumPriorityCount : Integer;
        lowPriorityCount    : Integer;
    };

<<<<<<< HEAD
    function getAttendance() returns {
=======
    action   markAttendance(attendanceDate: String,
                            attendanceDay: String,
                            attendanceTime: String)                        returns {
        attendanceId   : String;
        employeeId     : String;
        employeeName   : String;
        attendanceDate : String;
        attendanceDay  : String;
        attendanceTime : String;
        message        : String;
    };

    action   getTodayAttendance(attendanceDate: String)                    returns {
        alreadyMarked  : Boolean;
        attendanceTime : String;
        attendanceDay  : String;
    };


    entity AttendanceRecord   as projection on db.timesheet.AttendanceRecord;

    // Attendance card  (frontend-only for now; backend returns mock/stub data)
    action   getAttendance()                                               
    returns {
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        attendancePercentage : Integer;
        presentCount         : Integer;
        absentCount          : Integer;
        monthLabel           : String;
    };

<<<<<<< HEAD
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
=======
    // Performance Rating card
    action getPerformanceRating()                                        
    returns {
        ratingValue    : Decimal(3, 1);
        ratingCategory : String(30);
        reviewMonth    : Integer;
        reviewYear     : Integer;
        reviewComment  : String(500);
    };

    // Performance Trend graph  (returns JSON array as a String for flexibility)
    action getPerformanceTrend(year: Integer)                            
    returns {
        trendJSON : String; // JSON array: [{month,monthName,rating}, ...]
    };

    // Task Summary donut chart  (reuses existing TaskMaster entity)
    action getTaskSummary()                                              returns {
        total      : Integer;
        notStarted : Integer;
        inProgress : Integer;
        inReview   : Integer;
        completed  : Integer;
    };

    // Recent Notifications (last 5 for logged-in employee)
    action getRecentNotifications()                                      returns array of {
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
        notificationId : String(30);
        type           : String(30);
        title          : String(100);
        message        : String(500);
        isRead         : Boolean;
        referenceId    : String(30);
<<<<<<< HEAD
        notifiedAt     : String;
    };

    function getUpcomingCalendar() returns {
        eventsJSON : String;
=======
        notifiedAt     : String; // ISO timestamp string
    };

    // Upcoming Calendar events from Google Calendar
    action getUpcomingCalendar()                                         returns {
        eventsJSON : String; // JSON array of {id, title, start, end, timeLabel, dateLabel, isToday}
    };

    // My Leave Overview — yearly taken vs balance
    action getLeaveOverview(year: Integer)                               returns {
        casual    : Integer; // balance remaining
        sick      : Integer;
        annual    : Integer;
        unpaid    : Integer;
        totalDays : Integer;
        takenJSON : String; // [{type,label,taken,balance,color}]
>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
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
service ManagerService @(path: '/manager')@(requires: 'Manager') {

<<<<<<< HEAD
    entity PendingApprovals as projection on db.timesheet.TimesheetHeader where status = 'Pending';
=======
    entity PendingApprovals as projection on db.timesheet.TimesheetHeader
                               where
                                   status = 'Submitted';

>>>>>>> 25e6900692685e40653f2b1e2479f3e02cc9aee6
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


action submitPerformanceRating(
    employeeId    : String,
    ratingValue   : Decimal(3,1),
    reviewMonth   : Integer,
    reviewYear    : Integer,
    reviewComment : String,
    ratingCategory: String
) returns {
    ratingId : String;
    message  : String;
};

}



// ── HR Service ───────────────────────────────────────────────────────────────
service HRService @(path: '/hr')@(requires: 'HR') {

    @odata.draft.enabled
    entity Employees     as projection on db.timesheet.EmployeeMaster;

    entity Documents     as projection on db.timesheet.EmployeeDocument;

    entity LeaveRequests as projection on db.timesheet.LeaveRequest;

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
}
