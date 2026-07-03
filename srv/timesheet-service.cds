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

    // Read-only: the dashboard / rating history only READ this. All writes must go
    // through submitPerformanceRating / founderSubmitRating, which enforce the
    // one-rating-per-employee-per-month rule (Issue 5). @readonly closes the OData
    // CREATE/UPDATE/DELETE bypass without affecting those action handlers (they
    // write the DB entity directly).
    @readonly
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
    action submitTimesheet(timesheetId: String(50))                        returns String;

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
        accessDenied : String(40);
        clientId     : String(20);
        clientName   : String(150);
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

    // ── Company Newsletter (read for everyone) ────────────────────────────
    // Returns the most recently published newsletter so any authenticated
    // user (Employee / Manager / HR) can view it. HR publishes a new one via
    // the HR uploadEmployeeDocument action with documentType = 'Newsletter'.
    @(requires: 'authenticated-user')
    action getLatestNewsletter()                                           returns {
        hasNewsletter : Boolean;
        newsletterId  : String;
        fileName      : String;
        mimeType      : String;
        dataBase64    : LargeString;
        uploadedOn    : String;
    };

    // Lightweight metadata (no binary) — used to decide whether to show the
    // "new newsletter" button without transferring the whole document.
    @(requires: 'authenticated-user')
    action getNewsletterMeta()                                             returns {
        hasNewsletter : Boolean;
        newsletterId  : String;
        fileName      : String;
        uploadedOn    : String;
    };

    // ── Group Tasks (read + interaction; results scoped to the caller) ────────
    // Reads return JSON (LargeString) to avoid a deep CDS type forest — same
    // pattern as getTeamAttendance. Membership (assignee OR the manager who
    // created the task) is enforced inside every handler, so an employee can
    // only ever see/act on group tasks they belong to.
    // Thought for the Day — daily motivational quote, fetched once per day on the
    // backend and cached/shared across all users (see loadThoughtOfTheDay).
    action getThoughtOfTheDay()                                            returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action getGroupTasks()                                                 returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action getGroupTaskDetail(taskId: String(10))                          returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action endMyTaskSide(taskId: String(10))                               returns {
        taskId    : String;
        myStatus  : String;
        completed : Boolean;
    };

    @(requires: ['Employee', 'Manager'])
    action getGroupTaskMessages(taskId: String(10),
                                page: Integer,
                                pageSize: Integer)                         returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action sendTaskMessage(taskId: String(10),
                           message: LargeString,
                           attachments: many {
                               fileName   : String(255);
                               mimeType   : String(100);
                               dataBase64 : LargeString;
                           })                                              returns {
        messageId : String;
    };

    @(requires: ['Employee', 'Manager'])
    action getTaskAttachment(attachmentId: String(50))                     returns {
        fileName   : String;
        mimeType   : String;
        dataBase64 : LargeString;
    };

    @(requires: ['Employee', 'Manager'])
    action markGroupChatRead(taskId: String(10))                           returns {
        ok : Boolean;
    };

    // ── Group chat message actions (edit / delete / pin) ──────────────────────
    @(requires: ['Employee', 'Manager'])
    action editTaskMessage(messageId: String(40),
                           message: LargeString)                           returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action deleteTaskMessage(messageId: String(40))                        returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action pinTaskMessage(taskId: String(10),
                          messageId: String(40))                           returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action unpinTaskMessage(taskId: String(10))                            returns LargeString;

    // ── Group Task Updates (progress posts on a group task) ───────────────────
    // Read returns JSON (LargeString) — same pattern as getGroupTaskDetail.
    // Membership (assignee OR creator) may VIEW; only an assignee may POST.
    @(requires: ['Employee', 'Manager'])
    action getGroupTaskUpdates(taskId: String(10))                         returns LargeString;

    @(requires: ['Employee', 'Manager'])
    action postGroupTaskUpdate(taskId: String(10),
                               title: String(200),
                               notes: String(2000),
                               fileName: String(255),
                               mimeType: String(100),
                               dataBase64: LargeString)                    returns {
        updateId : String;
    };

    @(requires: ['Employee', 'Manager'])
    action getTaskUpdateAttachment(updateId: String(40))                   returns {
        fileName   : String;
        mimeType   : String;
        dataBase64 : LargeString;
    };

    // ── Multi-document task attachments (assignment files) ────────────────────
    // List metadata for every document attached to a task (no binary). Any
    // assignee, the reviewer, or a manager may list. Returns a JSON array.
    @(requires: ['Employee', 'Manager'])
    action getTaskDocuments(taskId: String(20))                            returns LargeString;

    // Non-destructive download of one task document as base64.
    @(requires: ['Employee', 'Manager'])
    action getTaskDocument(documentId: String(60))                         returns {
        fileName   : String;
        mimeType   : String;
        dataBase64 : LargeString;
    };

    // Post a progress update on a SOLO task, persisting an optional attachment
    // binary so it is downloadable later (the old OData create never stored it).
    @(requires: ['Employee', 'Manager'])
    action postTaskUpdate(taskId: String(20),
                          updateDate: Date,
                          notes: String(2000),
                          fileName: String(255),
                          mimeType: String(100),
                          dataBase64: LargeString)                         returns {
        updateId : String;
    };

    // Unread group-task notification count — drives the "Group Tasks" menu badge.
    @(requires: ['Employee', 'Manager'])
    action getGroupTasksUnread()                                           returns {
        count : Integer;
    };

    // Unread-notification counts grouped by the sidebar menu route they relate
    // to (e.g. { "task-description": 2, "manager": 1 }). Drives the menu badges.
    @(requires: 'authenticated-user')
    action getSidebarBadges()                                              returns LargeString;

    // Mark every unread notification that belongs to a menu route as read —
    // called when the user opens that page, so its badge clears.
    @(requires: 'authenticated-user')
    action markRouteNotificationsRead(route: String)                       returns {
        updated : Integer;
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

    // Upcoming Teams meetings for the logged-in employee (next 7 days from DB)
    action getUpcomingMeetings()                                           returns LargeString;

    // All meetings visible to the caller (for standalone Meetings page)
    // filter: all | today | week | month | upcoming | completed | cancelled
    action getMyMeetings(filter: String)                                   returns LargeString;

    // My Leave Overview — yearly taken vs balance
    action getLeaveOverview(year: Integer)                                 returns {
        casual    : Integer; // balance remaining
        sick      : Integer;
        annual    : Integer;
        unpaid    : Integer;
        totalDays : Integer;
        takenJSON : String; // [{type,label,taken,balance,color}]
    };

        // Mark a single notification as read
    @(requires: 'authenticated-user')
    action markNotificationRead(notificationId: String(30)) returns {
        success : Boolean;
    };

    // Mark ALL notifications as read for the logged-in employee
    @(requires: 'authenticated-user')
    action markAllNotificationsRead() returns {
        updated : Integer;
    };

    // Delete / dismiss a single notification
    @(requires: 'authenticated-user')
    action deleteNotification(notificationId: String(30)) returns {
        success : Boolean;
    };

    // Paginated notifications list
    @(requires: 'authenticated-user')
    action getNotifications(page: Integer, pageSize: Integer) returns {
        itemsJSON    : LargeString;  // JSON array of notification objects
        totalCount   : Integer;
        unreadCount  : Integer;
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

    action approveTimesheet(timesheetId: String(50), remarks: String(255)) returns String;
    action rejectTimesheet(timesheetId: String(50), remarks: String(255))  returns String;

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

    // Attach one document to a task (called once per file → supports multiple
    // documents per task). Returns the new documentId.
    action uploadTaskDocument(taskId: String(20),
                              fileName: String(255),
                              mimeType: String(100),
                              dataBase64: LargeString)                     returns {
        documentId : String;
    };

    // ── Create a group task and seed its assignees (manager only) ──────────
    // Leaves the existing solo task-create flow completely untouched.
    action createGroupTask(taskName: String(100),
                           taskDescription: String(255),
                           priority: String(20),
                           startDate: Date,
                           dueDate: Date,
                           assignees: many {
                               employeeId : String(10);
                               note       : String(500);
                           })                                              returns {
        taskId : String;
    };


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

    // Missed-day (day-unlock) requests routed to a manager — used when the
    // requester is an HR employee, whose requests go to their reporting
    // manager instead of HR. Surfaced in the "Timesheet Fill Requests" tab.
    entity DayUnlockRequests as projection on db.timesheet.TimesheetDayUnlockRequest;

    action approveDayUnlock(requestId: String,
                            approved: Boolean,
                            hrRemarks: String)                             returns {
        requestId : String;
        status    : String;
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

    // Hierarchical resource masters (Department → Role → Specialization) + skill /
    // certification catalogs, for the cascading HR dropdowns. Returns LargeString JSON.
    action getResourceHierarchy()                                          returns LargeString;

    // ── Talent Taxonomy (dynamic typeahead + create-if-not-exists) ───────────────
    // type: role | module | skill | certification. departmentId scopes roles;
    // roleId scopes modules. Both return LargeString JSON.
    action searchTaxonomy(type: String(20), q: String(150),
                          departmentId: String(20), roleId: String(30))   returns LargeString;
    action upsertTaxonomy(type: String(20), name: String(150),
                          departmentId: String(20), roleId: String(30))   returns LargeString;
    // Language typeahead — distinct values already on file (dynamic, no hardcoded list).
    action searchLanguages(q: String(100))                                 returns LargeString;
    // Email diagnostics — verify SMTP + send a branded test email (UI → CAP → SMTP).
    action sendTestEmail(to: String(255))                                  returns LargeString;

    action addEmployee(employeeName: String(100),
                       designation: String(50),
                       role: String(20),
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
                       bankIfsc: String(15),
                       // ── Work location + marital details (collected by the form) ──
                       workLocation: String(50),
                       maritalStatus: String(20),
                       fatherName: String(100),
                       partnerName: String(100),
                       marriageDate: Date,
                       hasKids: String(5),
                       // ── Hierarchical resource profile (additive, optional) ──
                       roleCategoryId: String(30),
                       specializationId: String(40),
                       subSpecialization: String(100),
                       yearsOfExperience: Decimal,
                       skills: String(500),
                       certifications: String(500),
                       languages: String(255),
                       ctc: Decimal,
                       baseAvailabilityPct: Integer)                       returns {
        employeeId : String(10);
    };

    // ── Rich certifications (per-certificate document) ───────────────────────────
    action saveEmployeeCertification(employeeId: String(10), certName: String(150),
                                     certificateNumber: String(100), issuedBy: String(150),
                                     issueDate: Date, expiryDate: Date,
                                     fileName: String(255), mimeType: String(100),
                                     dataBase64: LargeString)               returns LargeString;
    action getEmployeeCertifications(employeeId: String(10))               returns LargeString;
    action getCertificationDocument(id: String(55))                        returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };
    action deleteEmployeeCertification(id: String(55))                     returns LargeString;

    action uploadEmployeeDocument(employeeId: String(10),
                                  documentType: String(40),
                                  fileName: String(255),
                                  mimeType: String(100),
                                  description: String(255),
                                  dataBase64: LargeString)                 returns String;

    action getEmployeeDocument(documentId: String(50))                     returns {
        fileName   : String(255);
        mimeType   : String(100);
        dataBase64 : LargeString;
    };

    // ── Employee directory actions (HR profile side-panel) ────────────────────
    // Activate / deactivate an employee. isActive + status are kept in sync.
    action setEmployeeStatus(employeeId: String(10),
                             isActive: Boolean)                            returns {
        employeeId : String(10);
        isActive   : Boolean;
        status     : String(20);
    };

    // Inline edit of an employee's editable profile fields. Only non-null
    // fields are applied, so partial updates are safe.
    action updateEmployee(employeeId: String(10),
                          employeeName: String(100),
                          designation: String(50),
                          role: String(20),
                          email: String(100),
                          address: String(255),
                          mobileNumber: String(15),
                          department: String(50),
                          employmentType: String(20),
                          emergencyContact: String(15),
                          managerEmployeeId: String(10),
                          // ── Hierarchical resource profile (additive, optional) ──
                          roleCategoryId: String(30),
                          specializationId: String(40),
                          subSpecialization: String(100),
                          yearsOfExperience: Decimal,
                          skills: String(500),
                          certifications: String(500),
                          languages: String(255),
                          ctc: Decimal,
                          baseAvailabilityPct: Integer)                    returns {
        employeeId : String(10);
        message    : String;
    };

    // Reset password — this app's identities are managed by the IdP (XSUAA in
    // production, mocked users in dev), so there is no local password store to
    // reset. The action returns a clear message rather than failing silently.
    action resetEmployeePassword(employeeId: String(10))                   returns {
        success : Boolean;
        message : String;
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

// ── Founder Service ───────────────────────────────────────────────────────────
// Executive analytics for the Founder Dashboard. Returns pre-aggregated JSON
// (LargeString) computed live from the CDS entities. Gated to the Founder role.
service FounderService @(path: '/founder') @(requires: 'Founder') {

    // Whole-organisation analytics (Overall view).
    action getFounderAnalytics()                                          returns LargeString;

    // Department-scoped analytics (Department view).
    action getDepartmentAnalytics(department: String, period: String)     returns LargeString;

    // Single-employee drill-down (Founder → Department → Employee).
    action getEmployeeAnalytics(employeeId: String)                       returns LargeString;

    // Org-wide lists for the Founder sidebar destinations (read-only overview).
    action getFounderApprovals()                                          returns LargeString;

    // Decisions the founder has already made (approved / rejected) for their
    // direct reports — read-only history.
    action getFounderApprovalHistory()                                    returns LargeString;
    action getFounderTasks()                                              returns LargeString;
    action getFounderRatings()                                            returns LargeString;

    // Active-employee directory (for assign-task / submit-rating pickers).
    action getFounderEmployees()                                          returns LargeString;

    // ── Founder write actions ─────────────────────────────────────────────────
    // These operate org-wide (no manager scoping) but write to the SAME tables
    // and emit the SAME notifications as the Manager/HR flows, so every Founder
    // action immediately reflects in dashboard KPIs, analytics and the records
    // seen by Employees / Managers / HR. No new entities are introduced.
    action founderDecideTimesheet(timesheetId: String, approve: Boolean, remarks: String) returns LargeString;
    action founderDecideLeave(leaveId: String, approve: Boolean, remarks: String)          returns LargeString;
    action founderDecideFillRequest(kind: String, requestId: String, approve: Boolean, remarks: String) returns LargeString;
    action founderAssignTask(taskName: String, taskDescription: String, priority: String,
                             startDate: String, dueDate: String, assigneeId: String, reviewerId: String) returns LargeString;
    action founderSubmitRating(employeeId: String, ratingValue: Decimal, reviewMonth: Integer,
                               reviewYear: Integer, reviewComment: String, ratingCategory: String) returns LargeString;
}

// ══════════════════════════════════════════════════════════════════════════════
// Project Management Service (Phase 1) — ADDITIVE. Path /project. Open to any
// authenticated user; per-action authorization (Founder / POC / allocated
// employee) is enforced in the handlers. All reads/writes go through actions that
// return scoped JSON (LargeString), mirroring the Founder service style — so no
// raw entity is writable over OData.
// ══════════════════════════════════════════════════════════════════════════════
service ProjectService @(path: '/project') @(requires: 'authenticated-user') {

    // ── Founder-only ──────────────────────────────────────────────────────────
    // clientId is mandatory — every project belongs to exactly one client.
    action createProject(projectName: String(150), customerName: String(150),
                         description: String(1000), startDate: String, endDate: String,
                         priority: String(20), pocEmployeeId: String(10),
                         budget: Decimal, goLiveDate: String, focusAreas: String(500),
                         clientId: String(20),
                         projectType: String(30), contractValue: Decimal,
                         profitMarginPct: Decimal) returns LargeString;
    // Configurable project-type master (drives planning/budgeting/resourcing).
    action getProjectTypes() returns LargeString;
    // Dynamic roles (= active-employee designations) for a department / project type.
    action getDepartmentRoles(projectId: String(20), department: String(50)) returns LargeString;

    // ── Milestone Management ────────────────────────────────────────────────────
    action getMilestones(projectId: String(20))                                   returns LargeString;
    action seedMilestones(projectId: String(20))                                  returns LargeString;
    action createMilestone(projectId: String(20), name: String(150), description: String(1000),
                           plannedStartDate: String, plannedEndDate: String, ownerId: String(10),
                           isCritical: Boolean, isBillable: Boolean, plannedBudget: Decimal,
                           progressMode: String(20), sequence: Integer)            returns LargeString;
    action updateMilestone(milestoneId: String(40), name: String(150), description: String(1000),
                           plannedStartDate: String, plannedEndDate: String, ownerId: String(10),
                           isCritical: Boolean, isBillable: Boolean, plannedBudget: Decimal,
                           progressMode: String(20), sequence: Integer, remarks: String(1000)) returns LargeString;
    action deleteMilestone(milestoneId: String(40))                               returns LargeString;
    action setMilestoneDependency(milestoneId: String(40), predecessorId: String(40)) returns LargeString;
    action removeMilestoneDependency(dependencyId: String(55))                    returns LargeString;
    action startMilestone(milestoneId: String(40))                               returns LargeString;
    action updateMilestoneProgress(milestoneId: String(40), progressPct: Integer) returns LargeString;
    action completeMilestone(milestoneId: String(40), override: Boolean)          returns LargeString;
    action requestMilestoneApproval(milestoneId: String(40), approverRole: String(30),
                                    approverId: String(10), comments: String(1000)) returns LargeString;
    action decideMilestoneApproval(milestoneId: String(40), decision: String(25),
                                   comments: String(1000))                        returns LargeString;
    action transferMilestoneResource(fromMilestoneId: String(40), toMilestoneId: String(40),
                                     employeeId: String(10))                       returns LargeString;
    // Phase 15 — downloadable reports. reportType: status|budget|resource|delay|
    // forecast|health · format: xlsx|pdf. Returns {ok,fileName,mime,base64}.
    action generateMilestoneReport(projectId: String(20), reportType: String(20),
                                   format: String(10))                            returns LargeString;

    // ── Hierarchical resource requirements (Phase 4) ─────────────────────────────
    action getResourceHierarchy()                                                 returns LargeString;
    action getResourceRequirements(projectId: String(20))                         returns LargeString;
    action createResourceRequirement(projectId: String(20), departmentId: String(20),
                                     roleCategoryId: String(30), specializationId: String(40),
                                     requiredCount: Integer, requiredHours: Decimal,
                                     startDate: String, endDate: String, notes: String(500)) returns LargeString;
    action deleteResourceRequirement(requirementId: String(45))                   returns LargeString;

    // ── Client Master management (Founder) ──────────────────────────────────────
    action getClientMasters()                                                     returns LargeString;
    // Pre-save duplicate probe: matches on company name, email and phone.
    action checkClientDuplicate(companyName: String(150), email: String(150),
                             phoneNumber: String(30))                              returns LargeString;
    action createClientMaster(clientName: String(150), companyName: String(150),
                             clientType: String(20), industry: String(100),
                             website: String(200), country: String(80),
                             timeZone: String(60), contactPerson: String(100),
                             designation: String(100), email: String(150),
                             phoneNumber: String(30),
                             secondaryContactName: String(100), secondaryEmail: String(150),
                             secondaryPhone: String(30), billingEmail: String(150),
                             gstNumber: String(50), billingAddress: String(300),
                             status: String(20), notes: String(2000),
                             force: Boolean)                                       returns LargeString;
    action updateClientMaster(clientId: String(20), clientName: String(150),
                             companyName: String(150), clientType: String(20),
                             industry: String(100), website: String(200),
                             country: String(80), timeZone: String(60),
                             contactPerson: String(100), designation: String(100),
                             phoneNumber: String(30),
                             secondaryContactName: String(100), secondaryEmail: String(150),
                             secondaryPhone: String(30), billingEmail: String(150),
                             gstNumber: String(50), billingAddress: String(300),
                             status: String(20), notes: String(2000),
                             reason: String(500))                                  returns LargeString;
    action deleteClientMaster(clientId: String(20), reason: String(500))          returns LargeString;
    action getClientStatusHistory(clientId: String(20))                           returns LargeString;

    // ── Requirement visibility & handling (Founder / POC / assigned employee) ────
    // Founder & POC see all requirements for their scope; employees see assigned.
    action getRequirementsInbox(filter: String(30))                               returns LargeString;
    action getProjectRequirements(projectId: String(20))                          returns LargeString;
    action getRequirementDetail(requirementId: String(30))                        returns LargeString;
    action assignRequirement(requirementId: String(30), employeeId: String(10))   returns LargeString;
    action updateRequirementStatus(requirementId: String(30), status: String(30)) returns LargeString;
    action addRequirementComment(requirementId: String(30), message: LargeString,
                                fileName: String(255), mimeType: String(100),
                                dataBase64: LargeString)                           returns LargeString;
    action getRequirementCommentAttachment(commentId: String(50))                 returns {
        fileName : String; mimeType : String; dataBase64 : LargeString;
    };
    action getRequirementAttachment(attachmentId: String(50))                     returns {
        fileName : String; mimeType : String; dataBase64 : LargeString;
    };

    // ── Executive dashboard (budget, effort, issues, AI summary) ───────────────
    // ── Project lifecycle governance (Founder-only) ──────────────────────────
    // Marks the planning meeting as Completed and advances lifecycleStage.
    action completePlanningMeeting(projectId: String(20))                          returns LargeString;
    // Saves department + other budget allocations; advances lifecycleStage to BudgetAllocated.
    action saveBudgetAllocation(projectId: String(20), totalBudget: Decimal,
                                departmentBudgets: LargeString,
                                otherBudgets: LargeString,
                                categoryBudgets: LargeString)                      returns LargeString;
    // Returns the saved budget breakdown for a project.
    action getBudgetAllocation(projectId: String(20))                              returns LargeString;
    // Returns all active managers (for planning-meeting participant selection).
    action getManagersForMeeting()                                                 returns LargeString;
    action getDepartments()                                                        returns LargeString;

    // Per-project Budget vs Actual analysis with dept→employee cost drill-down (Founder only).
    action getProjectBudgetAnalysis(projectId: String(20))                        returns LargeString;
    // Additional department-budget request & approval workflow.
    action requestAdditionalBudget(projectId: String(20), department: String(50),
            requestedAmount: Decimal, justification: String(2000),
            businessImpact: String(2000))                                         returns LargeString;
    action withdrawBudgetRequest(requestId: String(45))                           returns LargeString;
    action getMyBudgetRequests(projectId: String(20))                             returns LargeString;
    action decideBudgetRequest(requestId: String(45), decision: String(10),
            approvedAmount: Decimal, comments: String(2000))                      returns LargeString;
    // Operational resource-planning indicators — capacity/utilization, NO financials (POC view).
    action getProjectResourcePlanning(projectId: String(20))                      returns LargeString;

    action getProjectExecutive(projectId: String(20))                             returns LargeString;

    // Risk/issue register
    action createProjectIssue(projectId: String(20), title: String(200),
                             description: String(1000), severity: String(20),
                             ownerId: String(10))                                 returns LargeString;
    action updateProjectIssue(issueId: String(45), status: String(20))            returns LargeString;

    // Employee cost master (Founder/HR) — used for budget consumption
    action upsertEmployeeSalary(employeeId: String(10), annualSalary: Decimal,
                               hourlyCost: Decimal, effectiveFrom: String)         returns LargeString;
    action getEmployeeSalaries()                                                  returns LargeString;

    action createProjectTask(projectId: String(20), taskName: String(150),
                            description: String(1000), assignedToId: String(10),
                            priority: String(20), startDate: String, dueDate: String,
                            estimatedHours: Decimal, milestoneId: String(40))      returns LargeString;

    action updateProjectStatus(projectId: String(20), status: String(20))         returns LargeString;
    action getProjectDashboard()                                                  returns LargeString;

    // ── POC of the project (or Founder) ───────────────────────────────────────
    action getAllocatableEmployees(projectId: String(20))                         returns LargeString;
    action allocateResources(projectId: String(20),
                            allocations: many {
                                employeeId : String(10);
                                bandwidth  : Integer;
                                startDate  : String;   // optional ISO YYYY-MM-DD
                                endDate    : String;   // optional ISO YYYY-MM-DD
                                role       : String;   // optional project role
                                phase      : String;   // optional (phase-based plan)
                                module     : String;   // optional (module assignment)
                                milestoneId: String;   // optional milestone scope
                            },
                            allowOverride: Boolean,
                            overrideReason: String(500))                           returns LargeString;
    action removeResource(projectId: String(20), employeeId: String(10))          returns LargeString;

    // ── Resource Planning & Recommendation (Manager / Founder; POC for recommend) ──
    // All values are backend-computed (utilization, free hours, availability,
    // recommendation score) — see srv/resource-planning.js.
    action getResourcePool(skill: String(100), department: String(50),
                           minUtil: Integer, maxUtil: Integer,
                           availabilityDate: String, nameSearch: String(100),
                           status: String(20))                                   returns LargeString;
    action getResourcePlanningKPIs()                                            returns LargeString;
    action getOverUtilizedResources()                                          returns LargeString;
    action getResourceCapacityRisks()                                          returns LargeString;
    // Cost forecasting + project health + founder financial dashboard (Phase 3).
    action getProjectHealth(projectId: String(20))                             returns LargeString;
    action getFounderFinancials()                                              returns LargeString;
    // Executive Portfolio Command Center (Founder only).
    action getPortfolioAnalysis()                                                 returns LargeString;
    action getPortfolioProjectDetail(projectId: String(20))                       returns LargeString;
    // Multi-month capacity timeline (single source of truth, time-aware).
    action getCapacityForecast(employeeId: String(10), fromDate: String, toDate: String) returns LargeString;
    action getProjectCapacityForecast(projectId: String(20))                   returns LargeString;
    // Centralized engine configuration (admin) + company events.
    action getResourcePlanningConfig()                                         returns LargeString;
    action saveResourcePlanningConfig(skillWeight: Integer, availabilityWeight: Integer,
                                      utilizationWeight: Integer, experienceWeight: Integer,
                                      maxUtilizationThreshold: Integer, standardDailyHours: Decimal,
                                      standardWorkingDays: Integer, nonBillablePct: Integer,
                                      monthlyOverhead: Decimal) returns LargeString;
    action getCompanyEvents()                                                  returns LargeString;
    action saveCompanyEvent(eventId: String(30), eventName: String(150),
                            fromDate: String, toDate: String, description: String(500)) returns LargeString;
    action deleteCompanyEvent(eventId: String(30))                             returns LargeString;
    action recommendResources(projectId: String(20), requiredSkills: String(500),
                              requiredRole: String(100),
                              neededBandwidth: Integer, limit: Integer)          returns LargeString;

    // ── Assigned employee ─────────────────────────────────────────────────────
    action updateProjectTaskStatus(taskId: String(25), status: String(20),
                                   actualHours: Decimal)                           returns LargeString;

    // ── Scoped reads (Founder: all · POC: assigned · Employee: allocated) ──────
    action getProjects()                                                          returns LargeString;
    action getProjectDetail(projectId: String(20))                                returns LargeString;
    action getProjectAuditLog(projectId: String(20))                              returns LargeString;

    // ── Microsoft Teams Meetings (project-scoped) ─────────────────────────────
    // POC or Founder can schedule/edit/cancel; all project members can view.
    action scheduleMeeting(projectId: String(20), title: String(200),
                           agenda: String(2000), startDateTime: String, endDateTime: String,
                           participantIds: many String)                            returns LargeString;
    action updateMeetingDetails(meetingId: String(45), title: String(200),
                                agenda: String(2000), startDateTime: String,
                                endDateTime: String)                               returns LargeString;
    action cancelProjectMeeting(meetingId: String(45))                            returns LargeString;
    action getProjectMeetings(projectId: String(20))                              returns LargeString;

    // ── Project Chat ──────────────────────────────────────────────────────────
    // All project members (allocated employees, POC, Founder) can participate.
    action getProjectMessages(projectId: String(20),
                              page: Integer,
                              pageSize: Integer)                                   returns LargeString;
    action sendProjectMessage(projectId: String(20),
                              message: LargeString,
                              attachments: many {
                                  fileName   : String(255);
                                  mimeType   : String(100);
                                  dataBase64 : LargeString;
                              })                                                   returns {
        messageId : String;
    };
    action getProjectChatAttachment(attachmentId: String(60))                     returns {
        fileName   : String;
        mimeType   : String;
        dataBase64 : LargeString;
    };
    action markProjectChatRead(projectId: String(20))                             returns {
        ok : Boolean;
    };
    action editProjectMessage(messageId: String(50),
                              message: LargeString)                                returns LargeString;
    action deleteProjectMessage(messageId: String(50))                            returns LargeString;
    action pinProjectMessage(projectId: String(20),
                             messageId: String(50))                                returns LargeString;
    action unpinProjectMessage(projectId: String(20))                             returns LargeString;
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL — external customer self-service.
// Every handler resolves the caller's clientId and filters strictly to it, so a
// client can never read or act on another client's data. Backend-enforced; the
// 'Client' XSUAA scope is a necessary first factor.
// ══════════════════════════════════════════════════════════════════════════════
service ClientService @(path: '/client') @(requires: 'Client') {

    // Dashboard tiles + project list for the logged-in client.
    action getClientDashboard()                                                   returns LargeString;
    // Detail of one project (ownership re-checked server-side).
    action getClientProjectDetail(projectId: String(20))                          returns LargeString;

    // ── Requirements ────────────────────────────────────────────────────────────
    action getClientRequirements(projectId: String(20), filter: String(30))       returns LargeString;
    action getClientRequirementDetail(requirementId: String(30))                  returns LargeString;
    action createRequirement(projectId: String(20), title: String(200),
                            description: String(4000), businessJustification: String(2000),
                            priority: String(20), expectedDeliveryDate: String,
                            category: String(100), module: String(100), remarks: String(1000),
                            assignedToId: String(10))                              returns LargeString;
    // Client assigns/reassigns to a project employee or the POC.
    action assignClientRequirement(requirementId: String(30), employeeId: String(10)) returns LargeString;

    // ── Attachments (multiple, versioned) ────────────────────────────────────────
    action uploadRequirementAttachment(requirementId: String(30), fileName: String(255),
                                      mimeType: String(100), dataBase64: LargeString) returns LargeString;
    action getRequirementAttachment(attachmentId: String(50))                     returns {
        fileName : String; mimeType : String; dataBase64 : LargeString;
    };

    // ── Discussion ────────────────────────────────────────────────────────────────
    action getRequirementComments(requirementId: String(30))                      returns LargeString;
    action addRequirementComment(requirementId: String(30), message: LargeString,
                                fileName: String(255), mimeType: String(100),
                                dataBase64: LargeString)                           returns LargeString;
    action getRequirementCommentAttachment(commentId: String(50))                 returns {
        fileName : String; mimeType : String; dataBase64 : LargeString;
    };

    // ── Approval (Awaiting Client Review → Approved | Rejected | request changes) ─
    // approvalComments mandatory. decision: 'approve' | 'reject' | 'changes'
    action reviewRequirement(requirementId: String(30), decision: String(20),
                            comments: String(2000))                               returns LargeString;

    // Audit history of a requirement (client-visible).
    action getRequirementHistory(requirementId: String(30))                       returns LargeString;
}
