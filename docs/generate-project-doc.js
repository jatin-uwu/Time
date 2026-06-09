/* ════════════════════════════════════════════════════════════════════════════
   Ccentrik Employee Management System — Business & Functional Document
   Generated from an analysis of the actual project (SAP CAP + SAPUI5).
   Run:  node docs/generate-project-doc.js
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak,
    Header, Footer, PageNumber, TableOfContents
} = require('docx');

const NAVY = '1F3864', BLUE = '2563EB', SLATE = '1E293B', GREY = '64748B', LIGHT = 'EEF2FB', FILL = '1F3864';
const TODAY = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const out = [], push = (...e) => e.forEach(x => out.push(x));

const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 }, children: [new TextRun({ text: t, bold: true, color: NAVY, size: 30 })] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 90 }, children: [new TextRun({ text: t, bold: true, color: BLUE, size: 24 })] });
const h3 = t => new Paragraph({ spacing: { before: 150, after: 60 }, children: [new TextRun({ text: t, bold: true, color: SLATE, size: 21 })] });
const p = (t, o = {}) => new Paragraph({ spacing: { after: 100, line: 276 }, children: [new TextRun({ text: t, size: 21, color: '202020', ...o })] });
const bullet = (t, level = 0) => new Paragraph({ bullet: { level }, spacing: { after: 36, line: 264 }, children: [new TextRun({ text: t, size: 21, color: '202020' })] });
const bullets = (a, level = 0) => a.map(t => bullet(t, level));
const num = (t, i) => new Paragraph({ numbering: { reference: 'wf', level: 0 }, spacing: { after: 44, line: 268 }, children: [new TextRun({ text: t, size: 21, color: '202020' })] });
const spacer = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

function cell(text, { bold = false, fill = null, color = '202020', width = null } = {}) {
    return new TableCell({
        width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
        shading: fill ? { fill } : undefined, margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20, color })] })]
    });
}
function table(headers, rows, widths) {
    const hr = new TableRow({ tableHeader: true, children: headers.map((c, i) => cell(c, { bold: true, fill: FILL, color: 'FFFFFF', width: widths[i] })) });
    const dr = rows.map((r, idx) => new TableRow({ children: r.map((c, i) => cell(c, { fill: idx % 2 === 0 ? LIGHT : null, width: widths[i] })) }));
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D8E0EE' }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D8E0EE' }
        },
        rows: [hr, ...dr]
    });
}

// ── COVER ─────────────────────────────────────────────────────────────────────
const cl = (t, s, c, b, before = 0, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after }, children: [new TextRun({ text: t, size: s, color: c, bold: b })] });
push(
    new Paragraph({ spacing: { before: 1300 }, children: [] }),
    cl('CCENTRIK', 28, BLUE, true, 0, 40),
    cl('Employee Management System', 54, NAVY, true, 80, 0),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 220 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 8 } }, children: [new TextRun({ text: 'Business, Functional & Workflow Document', size: 28, color: SLATE })] }),
    cl('A complete overview of features, validations and workflows implemented in the platform', 20, GREY, false, 40, 600),
    table(['Field', 'Detail'], [
        ['Prepared By', '[Your Name]'],
        ['Technology Stack', 'SAP CAP (Node.js)  •  SAPUI5 (Freestyle)  •  SAP BTP  •  SAP HANA Cloud'],
        ['Document Version', '1.0'],
        ['Date', TODAY],
        ['Audience', 'Founder / Executive Leadership'],
        ['Classification', 'Internal — Business Confidential']
    ], [30, 70]),
    new Paragraph({ children: [new PageBreak()] })
);

// ── TOC ───────────────────────────────────────────────────────────────────────
push(h1('Table of Contents'), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }), new Paragraph({ children: [new PageBreak()] }));

// ── 1. EXECUTIVE OVERVIEW ──────────────────────────────────────────────────────
push(
    h1('1. Executive Overview'),
    p('The Ccentrik Employee Management System is a centralized, role-based platform that manages the complete workforce lifecycle — from employee onboarding to executive decision-making. It unifies timesheets, leave, tasks, performance ratings, approvals and real-time analytics into a single SAP CAP + SAPUI5 application.'),
    p('The platform serves four user communities, each with a dedicated interface and scoped permissions:'),
    ...bullets([
        'Employees — self-service: profile, timesheets, leave, tasks and ratings',
        'Managers — team oversight: task assignment, approvals, attendance and performance ratings',
        'HR — workforce administration: onboarding, employee management and account lifecycle',
        'Founder — an Executive Command Center with organization, department and employee analytics'
    ]),
    p('Every operational action — a submitted timesheet, an approved leave, a completed task, a new rating — updates organizational analytics in real time, giving leadership an always-current view of organizational health.'),
    spacer()
);

// ── 2. TECHNOLOGY & ARCHITECTURE ──────────────────────────────────────────────
push(
    h1('2. Technology & Architecture'),
    p('The solution follows a clean, layered architecture that cleanly separates presentation, business logic and persistence, ensuring scalability and cloud readiness on SAP Business Technology Platform.'),
    table(['Layer', 'Technology', 'Responsibility'], [
        ['Frontend', 'SAPUI5 Freestyle (XML views, JS controllers)', 'Responsive, role-based interfaces and dashboards'],
        ['Backend', 'SAP CAP (Node.js, @sap/cds)', 'CDS data models, OData V4 services, business actions'],
        ['Database', 'SAP HANA Cloud (SQLite in development)', 'Secure, high-performance transactional persistence'],
        ['Authentication', 'SAP XSUAA', 'Roles, scopes and role-collection based authorization'],
        ['Real-time', 'Server-Sent Events (SSE)', 'Live push to the Founder executive dashboards'],
        ['Deployment', 'SAP BTP', 'Cloud hosting, scaling and lifecycle management']
    ], [18, 40, 42]),
    spacer(),
    h2('Service Landscape'),
    p('Business logic is exposed through four OData V4 services, each gated to the appropriate role:'),
    table(['Service', 'Path', 'Access', 'Purpose'], [
        ['EmployeeService', '/employee', 'Employee', 'Self-service: profile, timesheets, leave, tasks, ratings, notifications'],
        ['ManagerService', '/manager', 'Manager', 'Team approvals, task assignment, ratings, attendance'],
        ['HRService', '/hr', 'HR', 'Employee onboarding, lifecycle and administration'],
        ['FounderService', '/founder', 'Founder', 'Executive analytics, approvals, tasks and ratings']
    ], [24, 16, 14, 46]),
    spacer()
);

// ── 3. USER ROLES & ACCESS ────────────────────────────────────────────────────
push(
    h1('3. User Roles & Access Control'),
    p('Access is governed by four XSUAA roles. Roles are additive — a Founder also carries Manager, HR and Employee scopes — and the system resolves the highest applicable role for navigation while re-validating authority on every request.'),
    table(['Role', 'Primary Responsibility', 'Representative Capabilities'], [
        ['Employee', 'Self-service operations', 'Fill & submit timesheets, apply leave, view/update tasks, post task updates, view ratings, upload profile picture, request previous-week fill / missed-day unlock'],
        ['Manager', 'Team leadership', 'Approve/reject timesheets & leave, assign individual & group tasks, review task workflow, rate team members, team attendance, approval history'],
        ['HR', 'Workforce administration', 'Add employees, modify records, activate/deactivate accounts, reset passwords, upload employee documents, publish newsletter, approve missed-day requests'],
        ['Founder', 'Executive intelligence', 'Organization / department / employee executive analytics, founder approvals (timesheets, leave, fill requests), assign tasks, submit ratings']
    ], [14, 26, 60]),
    spacer()
);

// ── 4. DATA MODEL ─────────────────────────────────────────────────────────────
push(
    h1('4. Data Model'),
    p('The system persists all data through CDS entities (no duplicate or analytics-only tables). The principal entities are:'),
    table(['Entity', 'Purpose'], [
        ['EmployeeMaster', 'Core employee record — identity, department, designation, manager, status, personal & bank details, profile photo'],
        ['EmployeeDocument', 'Employee documents and the company newsletter'],
        ['TaskMaster', 'Individual & group tasks — assignee, reviewer, priority, status, dates, attachments'],
        ['TaskAssignee / TaskMessage / TaskUpdate / TaskDocument / TaskAttachment', 'Group-task membership, chat, progress updates and attachments'],
        ['TaskReview', 'Task review/approval records (reviewer decision, remarks, attachment)'],
        ['TimesheetHeader / TimesheetEntry', 'Weekly timesheet header and per-day task entries (incl. custom "Others" tasks)'],
        ['TimesheetPrevWeekRequest', 'Previous-week fill approval requests routed to the manager'],
        ['TimesheetDayUnlockRequest', 'Missed-day unlock requests routed to HR / manager'],
        ['LeaveRequest / LeaveBalance', 'Leave applications, decisions and per-type balances'],
        ['PerformanceRating', 'Monthly performance ratings, comments and categories'],
        ['AttendanceRecord', 'Daily attendance marks'],
        ['Notification', 'In-app notifications across all workflows'],
        ['HolidayMaster', 'Company holiday calendar']
    ], [34, 66]),
    spacer()
);

// ── 5. FUNCTIONAL MODULES & FEATURES ──────────────────────────────────────────
push(h1('5. Functional Modules & Features'));

push(h2('5.1 Authentication & Identity'), ...bullets([
    'Login / logout with role-based navigation',
    'Email-based identity resolution (case-insensitive) linking the login to the employee record',
    'Automatic role detection with Founder → Executive Command Center redirect',
    'Inactive accounts are blocked at the service layer on every request',
    'Profile popover with personal details and profile-picture upload'
]));

push(h2('5.2 Employee Lifecycle (HR)'), ...bullets([
    'Add employee with auto-generated, unique Employee ID',
    'Modify employee records (personal, bank and organizational details)',
    'Activate / deactivate accounts (lifecycle control)',
    'Reset employee password',
    'Upload & retrieve employee documents; publish the company newsletter',
    'View all employees and full employee profiles'
]));

push(h2('5.3 Timesheet Management'), ...bullets([
    'Weekly timesheet grid with daily, per-task entries',
    'Custom "Others" task entry (free text up to 30 characters) for unlisted work',
    'Save draft entries and submit the week for approval',
    'Manager approval / rejection with remarks; approved entries are locked',
    'Previous-week fill request workflow (manager approval required)',
    'Missed-day unlock request workflow (HR / manager approval)',
    '"Enter Work Duration" HH:MM picker for accurate hour capture'
]));

push(h2('5.4 Leave Management'), ...bullets([
    'Apply for leave (Casual, Sick, Earned/Paid, Unpaid) with reason',
    'Per-type leave balance tracking and overview',
    'Manager approval / rejection with remarks and employee notification',
    'Leave history and leave overview by year'
]));

push(h2('5.5 Task Management'),
    h3('Individual Tasks'), ...bullets(['Assign tasks with priority, dates and a reviewer', 'Update task status through the lifecycle', 'Attach and download multiple assignment documents', 'Review workflow — submit review or report an issue']),
    h3('Group Tasks'), ...bullets(['Assign a task to two or more members', 'Per-member progress with "end my side" completion', 'Group chat with attachments', 'Team progress updates with downloadable attachments']),
    h3('Task Tracking'), ...bullets(['Task Description, Task Status and Team Task Status screens', 'Completed tasks are hidden from active lists and selection dropdowns', 'Unread badges on sidebar items that clear on visit']));

push(h2('5.6 Performance Ratings'), ...bullets([
    'Managers rate their own team members (1–5 scale, category and comment)',
    'Monthly rating history and performance trend',
    'Department-level performance tracking',
    'Founder can submit / update ratings organization-wide'
]));

push(h2('5.7 Approvals'), ...bullets([
    'Timesheet approval / rejection (manager-scoped)',
    'Leave approval / rejection',
    'Previous-week fill and missed-day unlock approvals',
    'Task review approvals',
    'Approval history with full audit trail',
    'A dedicated Founder Approval module (timesheets, leave and fill requests) with premium cards'
]));

push(h2('5.8 Notifications'), ...bullets([
    'In-app notifications for leave, tasks, approvals, ratings and fill requests',
    'Role-based delivery and type-based deep linking to the relevant screen',
    'Recent notifications, full notifications list, mark-read and delete',
    'Sidebar unread badges that clear on visit',
    'A dedicated premium Founder Notification Center'
]));

push(h2('5.9 Dashboards'), ...bullets([
    'Employee Dashboard — tasks, leave balance, timesheet summary, ratings, work anniversary, attendance',
    'Manager Dashboard — team performance, pending approvals, team attendance, department metrics',
    'HR Dashboard — employee statistics and workforce overview'
]));

push(h2('5.10 Founder Executive Command Center'),
    ...bullets([
        'Overall, Department and Employee analytics views with a collapsible founder sidebar',
        'Company Health Score, Productivity Score and Executive Insights',
        'Department rankings, organizational heatmap and leaderboard',
        'Executive Risk Center (overdue tasks, missing timesheets, low-performing departments, excessive leave, inactive employees)',
        'Employee Executive Analytics — health score, productivity, reliability and contribution with department & company benchmarks, trends and risk assessment',
        'Founder Approvals, Tasks and Ratings modules operating on the same backend records',
        'Live charts (performance, task, leave trends) and real-time updates'
    ]),
    spacer());

// ── 6. BUSINESS RULES & VALIDATIONS ───────────────────────────────────────────
push(h1('6. Business Rules & Validations'),
    p('Validations are enforced server-side on every request (and mirrored in the UI), guaranteeing data integrity regardless of entry point. The rules below are drawn directly from the implemented services.'));

push(h2('6.1 Authentication & Access'), table(['Rule', 'Behaviour'], [
    ['Inactive login block', 'Inactive employees are blocked on every service call ("before *" guard) and signed out'],
    ['Identity required', 'A user that cannot be identified from the token is rejected (401)'],
    ['Role re-validation', 'Each module re-checks the caller’s role and scope'],
    ['Founder routing', 'Founder logins are redirected to the Executive Command Center']
], [34, 66]), spacer(80));

push(h2('6.2 Employee Management'), table(['Rule', 'Behaviour'], [
    ['Employee name required', 'Creation fails without an employee name'],
    ['Email required & unique', 'A valid, unique email is mandatory and used for identity'],
    ['Employee ID required / unique', 'A system-generated identifier is enforced on relevant operations'],
    ['Lifecycle control', 'Deactivation retains history but blocks access; status mirrors isActive']
], [34, 66]), spacer(80));

push(h2('6.3 Timesheet'), table(['Rule', 'Behaviour'], [
    ['No future dates', '"Cannot fill future date" — entries cannot target a future day'],
    ['Hour bounds', 'Hours for a day must be between 0 and 24'],
    ['Custom task limit', 'Custom "Others" task text is mandatory and limited to 30 characters'],
    ['Mandatory task', 'Each entry must reference a task; empty saves are rejected'],
    ['Submission gating', 'Only Draft or Rejected timesheets can be submitted'],
    ['Locked after approval', 'Approved entries are locked from further edits'],
    ['Previous-week control', 'Previous-week filling requires prior manager approval'],
    ['Day-unlock scope', 'Day-unlock requests are valid only for past, missed dates']
], [34, 66]), spacer(80));

push(h2('6.4 Leave'), table(['Rule', 'Behaviour'], [
    ['Self-only', 'An employee can apply for leave only for themselves'],
    ['Founders excluded', 'Founders are not eligible to apply for leave'],
    ['Positive duration', 'Number of leave days must be greater than zero'],
    ['Valid date range', 'The "to" date cannot be earlier than the "from" date'],
    ['Mandatory fields', 'Leave type, dates and reason are required'],
    ['Idempotent decision', 'A leave already Approved/Rejected cannot be decided again']
], [34, 66]), spacer(80));

push(h2('6.5 Task'), table(['Rule', 'Behaviour'], [
    ['Mandatory assignee', 'An assignee (with a valid email) is required to assign a task'],
    ['Group minimum', 'A group task requires at least two members'],
    ['Update authority', 'Only members assigned to a task may post updates'],
    ['Completed lock', 'Completed tasks are locked — status cannot change and updates are blocked'],
    ['Reviewer authority', 'Only the assigned reviewer may submit a review or report an issue'],
    ['Review gating', 'A review applies only when the task is "In Review"'],
    ['Attachment limits', 'Documents ≤ 10 MB; chat/update attachments within configured limits']
], [34, 66]), spacer(80));

push(h2('6.6 Performance Rating'), table(['Rule', 'Behaviour'], [
    ['Mandatory inputs', 'Rating value, review month and review year are required'],
    ['Team-scoped (Manager)', 'A manager may only rate active members of their own team'],
    ['Valid scale', 'Ratings are constrained to the 1–5 scale'],
    ['Preserved history', 'Historical ratings are retained and feed trend analytics']
], [34, 66]), spacer(80));

push(h2('6.7 Approvals & Files'), table(['Rule', 'Behaviour'], [
    ['Authorized approver', 'Only the assigned approver / scoped manager may act on a request'],
    ['Status gating', 'Decisions are blocked once a request is no longer Pending'],
    ['Profile photo', 'Images only, under 2 MB'],
    ['Document upload', 'Valid base64; documents enforced under their size limits'],
    ['Audit trail', 'Every decision records actor, time and remarks; the requester is notified']
], [34, 66]), spacer());

// ── 7. KEY WORKFLOWS ──────────────────────────────────────────────────────────
push(h1('7. Key Workflows'),
    p('The following end-to-end workflows describe how work flows through the system across roles. Each updates notifications and, where relevant, executive analytics in real time.'));

function workflow(title, steps) {
    push(h2(title));
    steps.forEach(s => push(num(s)));
    push(spacer(80));
}

workflow('7.1 Login & Role Routing', [
    'The user signs in; the backend resolves identity from the token email (case-insensitive).',
    'An inactive account is blocked immediately and signed out.',
    'The system determines the highest applicable role (Founder ▸ HR ▸ Manager ▸ Employee).',
    'Navigation and the dashboard render for that role; a Founder is redirected to the Executive Command Center.'
]);

workflow('7.2 Timesheet Fill & Approval', [
    'The employee opens the weekly grid (getTimesheetWeekData) for the selected week.',
    'Entries are added per day and task — including custom "Others" tasks — and saved (saveTimesheetEntries) with future-date, hour-range and custom-text validations.',
    'The employee submits the week (submitTimesheetWeek); only Draft or Rejected timesheets may be submitted.',
    'The manager reviews and approves (approveTimesheet) or rejects (rejectTimesheet) with remarks.',
    'On approval the entries are locked; the employee is notified of the outcome.'
]);

workflow('7.3 Previous-Week Fill Request', [
    'The employee requests approval to fill a previous week (requestPrevWeekFill); the request routes to their manager.',
    'The manager (or the Founder, via the Founder Approvals module) approves or rejects it.',
    'On approval, the timesheet header for that week is created/unlocked so the employee can fill and submit it.',
    'The employee is notified and can complete the previous-week timesheet.'
]);

workflow('7.4 Missed-Day Unlock Request', [
    'The employee requests to unlock a specific past, missed date (requestDayUnlock), selecting the approver.',
    'The approver (HR, or the manager for HR staff) approves or rejects the request (approveDayUnlock).',
    'On approval the specific day is unlocked for entry; the employee is notified.'
]);

workflow('7.5 Leave Application & Approval', [
    'The employee applies for leave (applyLeave) with type, dates and reason; self-only and date validations apply.',
    'The request is created as Pending and the manager is notified in-app (and by email when configured).',
    'The manager approves or rejects (approveLeave); the decision is idempotent and recorded.',
    'The employee is notified of the outcome and balances/analytics update.'
]);

workflow('7.6 Task Assignment, Update & Review', [
    'A manager assigns an individual task (with reviewer) or creates a group task (createGroupTask, ≥ 2 members); assignees are notified.',
    'Assignees progress the task (updateTaskStatus) and post updates with attachments (postTaskUpdate / postGroupTaskUpdate).',
    'When work is ready, the reviewer submits a review (submitReview) or reports an issue (reportIssue) — only when the task is In Review.',
    'A completed task is locked: its status cannot change and further updates are blocked.'
]);

workflow('7.7 Performance Rating', [
    'A manager rates an active member of their own team (submitPerformanceRating) with value, period, category and comment.',
    'The rating is created or updated for that month and the employee is notified.',
    'Rating history and department/organization trends update accordingly.'
]);

workflow('7.8 Employee Onboarding & Lifecycle (HR)', [
    'HR adds a new employee (addEmployee) with a unique, auto-generated Employee ID.',
    'HR uploads supporting documents and can modify the record (updateEmployee).',
    'HR activates or deactivates the account (setEmployeeStatus) and can reset the password (resetEmployeePassword).',
    'A deactivated employee is immediately blocked from the application while history is preserved.'
]);

workflow('7.9 Founder Executive Decisioning', [
    'The Founder reviews organization, department and individual-employee analytics in the Executive Command Center.',
    'From the Founder Approvals module they approve/reject timesheets, leave and previous-week / missed-day fill requests on the same backend records.',
    'The Founder can assign tasks and submit ratings organization-wide.',
    'Every action emits a real-time signal that refreshes KPIs, charts, insights and the risk center without a manual refresh.'
]);

push(spacer());

// ── 8. FOUNDER CALCULATIONS ───────────────────────────────────────────────────
push(h1('8. Founder Dashboard Calculations'),
    p('Executive metrics are computed live from Tasks, Ratings, Leave, Timesheets and Employee records using consistent weighted formulas, applied at organization, department and employee scope so benchmarks are directly comparable.'));
push(h2('Company Health Score'), table(['Component', 'Weight'], [['Task Completion', '30%'], ['Average Rating', '25%'], ['Timesheet Compliance', '20%'], ['Active Workforce', '15%'], ['Leave Utilization', '10%']], [70, 30]), spacer(80));
push(h2('Productivity Score'), table(['Component', 'Weight'], [['Task Completion', '50%'], ['Timesheet Compliance', '30%'], ['Rating Score', '20%']], [70, 30]), spacer(80));
push(h2('Department Health Score'), table(['Component', 'Weight'], [['Rating', '40%'], ['Task Completion', '30%'], ['Timesheet Compliance', '20%'], ['Leave Balance', '10%']], [70, 30]), spacer(80));
push(h2('Employee Executive Metrics'),
    ...bullets([
        'Reliability Score — timesheet compliance, task-completion consistency and deadline adherence',
        'Contribution classification — High Performer, Consistent Contributor, Average Contributor or Needs Attention (percentile-based, no raw ranks)',
        'Risk Level — Low / Medium / High from declining ratings, overdue tasks, missing timesheets, low productivity and excessive leave',
        'Benchmarks — employee vs department vs company for rating, productivity, reliability and leave utilization'
    ]),
    spacer());

// ── 9. REAL-TIME ──────────────────────────────────────────────────────────────
push(h1('9. Real-Time Update Engine'),
    p('The Founder dashboards stay current automatically. When any of the following business events occurs, a lightweight Server-Sent Events signal triggers a refresh of dashboards, charts, KPIs and insights — without a manual reload:'),
    ...bullets([
        'Employee created, updated, activated or deactivated',
        'Task created, updated or completed',
        'Rating submitted', 'Leave approved or rejected', 'Timesheet submitted or approved',
        'Previous-week / missed-day fill request decided'
    ]),
    p('A 45-second polling fallback guarantees freshness even if the live channel is interrupted.'),
    spacer());

// ── 10. SECURITY ──────────────────────────────────────────────────────────────
push(h1('10. Security & Data Integrity'),
    table(['Category', 'Enforced Controls'], [
        ['Authentication', 'XSUAA-based login; inactive accounts blocked server-side; identity from verified token'],
        ['Authorization', 'Scope-gated services; role re-validated per request; manager/team scoping on sensitive actions'],
        ['Approvals', 'Only authorized approvers; idempotent, status-gated decisions; full audit trail'],
        ['Tasks', 'Assignee/reviewer authority enforced; completed tasks immutable'],
        ['Files', 'Type/size limits (profile photo ≤ 2 MB, documents ≤ 10 MB); base64 validation'],
        ['Data Integrity', 'Single source of truth; no duplicate analytics tables; unique identifiers; validated inputs']
    ], [24, 76]),
    spacer());

// ── 11. FUTURE ────────────────────────────────────────────────────────────────
push(h1('11. Future Enhancements'),
    p('The architecture is designed to scale. Candidate roadmap items include:'),
    ...bullets([
        'Mobile application for on-the-go access',
        'AI-driven executive insights and natural-language summaries',
        'Predictive analytics for attrition and performance forecasting',
        'Employee engagement module (surveys, recognition, feedback)',
        'Recruitment & applicant tracking',
        'Payroll integration',
        'Advanced, configurable reporting and export'
    ]),
    spacer());

// ── 12. CONCLUSION ────────────────────────────────────────────────────────────
push(h1('12. Conclusion'),
    p('The Ccentrik Employee Management System delivers a unified, role-based platform spanning the full employee lifecycle — onboarding, timesheets, leave, tasks, performance and approvals — within a single governed environment. Its layered SAP CAP and SAPUI5 architecture, scope-based security and server-side validation guarantee integrity and scalability.'),
    p('For leadership, the Founder Executive Command Center converts everyday operational activity into strategic intelligence: real-time company health, productivity and risk indicators, department rankings, and employee-level executive analytics with benchmark comparisons — all updating automatically as the organization works.')
);

// ── ASSEMBLE ──────────────────────────────────────────────────────────────────
const doc = new Document({
    creator: 'Ccentrik', title: 'Employee Management System — Business & Functional Document',
    description: 'Features, validations and workflows',
    numbering: { config: [{ reference: 'wf', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] },
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1200, right: 1200 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5', space: 4 } }, children: [new TextRun({ text: 'Ccentrik Employee Management System  •  Business & Functional Document', size: 16, color: GREY })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5', space: 4 } }, children: [new TextRun({ text: 'Ccentrik — Internal & Confidential     |     Page ', size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }), new TextRun({ text: ' of ', size: 16, color: GREY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY })] })] }) },
        children: out
    }]
});

const outPath = path.join(__dirname, 'Ccentrik_Employee_Management_System_Business_Document.docx');
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outPath, buf); console.log('✓ Document written:', outPath, '(' + Math.round(buf.length / 1024) + ' KB)'); })
    .catch(e => { console.error('Failed:', e); process.exit(1); });
