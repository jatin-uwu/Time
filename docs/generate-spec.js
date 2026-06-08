/* ════════════════════════════════════════════════════════════════════════════
   Generates the Employee Management System — Functional Specification (.docx)
   Run:  node docs/generate-spec.js
   Requires the `docx` package (installed in node_modules).
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak,
    Header, Footer, PageNumber, TableOfContents, convertInchesToTwip
} = require('docx');

// ── palette ──────────────────────────────────────────────────────────────────
const NAVY = '1F3864';
const BLUE = '2563EB';
const SLATE = '1E293B';
const GREY = '64748B';
const LIGHT = 'EEF2FB';
const HEADERFILL = '1F3864';

const TODAY = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

// ── helpers ──────────────────────────────────────────────────────────────────
const out = [];
const push = (...els) => els.forEach(e => out.push(e));

function h1(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 140 },
        children: [new TextRun({ text, bold: true, color: NAVY, size: 30 })]
    });
}
function h2(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 90 },
        children: [new TextRun({ text, bold: true, color: BLUE, size: 24 })]
    });
}
function h3(text) {
    return new Paragraph({
        spacing: { before: 140, after: 60 },
        children: [new TextRun({ text, bold: true, color: SLATE, size: 21 })]
    });
}
function p(text, opts = {}) {
    return new Paragraph({
        spacing: { after: 100, line: 276 },
        children: [new TextRun({ text, size: 21, color: '202020', ...opts })]
    });
}
function bullet(text, level = 0) {
    return new Paragraph({
        bullet: { level },
        spacing: { after: 40, line: 264 },
        children: [new TextRun({ text, size: 21, color: '202020' })]
    });
}
function bullets(arr, level = 0) { return arr.map(t => bullet(t, level)); }

function cell(text, { bold = false, fill = null, color = '202020', width = null, align = AlignmentType.LEFT } = {}) {
    return new TableCell({
        width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
        shading: fill ? { fill } : undefined,
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, size: 20, color })] })]
    });
}
function headerRow(cells, widths) {
    return new TableRow({
        tableHeader: true,
        children: cells.map((c, i) => cell(c, { bold: true, fill: HEADERFILL, color: 'FFFFFF', width: widths[i] }))
    });
}
function dataRow(cells, widths, idx) {
    const fill = idx % 2 === 0 ? LIGHT : null;
    return new TableRow({ children: cells.map((c, i) => cell(c, { fill, width: widths[i] })) });
}
function table(headers, rows, widths) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D8E0EE' },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D8E0EE' }
        },
        rows: [headerRow(headers, widths), ...rows.map((r, i) => dataRow(r, widths, i))]
    });
}
function spacer(after = 120) { return new Paragraph({ spacing: { after }, children: [] }); }

// ════════════════════════════════════════════════════════════════════════════
// COVER PAGE
// ════════════════════════════════════════════════════════════════════════════
function coverLine(text, size, color, bold, before = 0, after = 0) {
    return new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before, after },
        children: [new TextRun({ text, size, color, bold })]
    });
}
push(
    new Paragraph({ spacing: { before: 1400 }, children: [] }),
    coverLine('CCENTRIK', 28, BLUE, true, 0, 40),
    coverLine('Employee Management System', 56, NAVY, true, 80, 0),
    new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 8 } },
        children: [new TextRun({ text: 'Functional Specification & Business Requirement Document', size: 28, color: SLATE })]
    }),
    coverLine('Functional Specification  •  Validation Document  •  Feature Overview', 20, GREY, false, 60, 600)
);
const coverMeta = table(
    ['Field', 'Detail'],
    [
        ['Prepared By', '[Your Name]'],
        ['Technology Stack', 'SAP CAP  •  SAPUI5  •  SAP BTP  •  SAP HANA Cloud'],
        ['Document Version', '1.0'],
        ['Date', TODAY],
        ['Audience', 'Founder / Executive Leadership'],
        ['Classification', 'Internal — Business Confidential']
    ],
    [30, 70]
);
push(coverMeta, new Paragraph({ children: [new PageBreak()] }));

// ════════════════════════════════════════════════════════════════════════════
// TABLE OF CONTENTS
// ════════════════════════════════════════════════════════════════════════════
push(
    h1('Table of Contents'),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({ children: [new PageBreak()] })
);

// ════════════════════════════════════════════════════════════════════════════
// 1. EXECUTIVE SUMMARY
// ════════════════════════════════════════════════════════════════════════════
push(
    h1('1. Executive Summary'),
    p('The Employee Management System is a centralized, enterprise-grade platform designed to manage the complete spectrum of workforce operations through a secure, role-based architecture. Built on SAP Cloud Application Programming Model (CAP) and SAPUI5, the platform consolidates day-to-day people operations and strategic decision-making into a single, real-time application.'),
    p('The system streamlines and governs the following core areas of workforce management:'),
    ...bullets([
        'Employee lifecycle management — onboarding, modification, activation and deactivation',
        'Task management — individual tasks, group tasks, review workflows and progress tracking',
        'Timesheet management — daily entry, weekly submission and managerial approval',
        'Leave management — application, approval, rejection and balance tracking',
        'Performance ratings — periodic reviews, trends and department performance tracking',
        'Approvals — leave, timesheet, task review and previous-week fill requests',
        'Executive analytics — company health, productivity, risk and benchmark intelligence'
    ]),
    p('The platform supports four distinct user communities — Employees, Managers, HR, and Founders — each with clearly separated responsibilities, permissions and tailored interfaces. Every action performed within the system updates organizational analytics in real time, giving leadership an always-current view of organizational health.', { }),
    spacer()
);

// ════════════════════════════════════════════════════════════════════════════
// 2. SYSTEM ARCHITECTURE
// ════════════════════════════════════════════════════════════════════════════
push(
    h1('2. System Architecture'),
    p('The solution follows a clean, layered architecture that separates presentation, business logic and persistence, ensuring scalability, maintainability and cloud readiness on SAP Business Technology Platform (BTP).'),
    table(
        ['Layer', 'Technology', 'Responsibility'],
        [
            ['Frontend', 'SAPUI5 (Freestyle)', 'Responsive, role-based user interfaces and dashboards'],
            ['Backend', 'SAP CAP (Node.js)', 'CDS data models, OData V4 services and business logic'],
            ['Database', 'SAP HANA Cloud', 'Secure, high-performance transactional persistence'],
            ['Deployment', 'SAP BTP', 'Cloud hosting, scaling and lifecycle management'],
            ['Security', 'XSUAA', 'Authentication, role collections and scope-based authorization']
        ],
        [22, 30, 48]
    ),
    spacer(),
    h2('Architectural Highlights'),
    ...bullets([
        'Database-agnostic CDS models — SQLite for local development, SAP HANA Cloud in production',
        'OData V4 services exposing typed entities and custom business actions',
        'Real-time push via Server-Sent Events (SSE) for live executive dashboards',
        'Strict separation of Employee, Manager, HR and Founder services with scope-based access'
    ]),
    spacer()
);

// ════════════════════════════════════════════════════════════════════════════
// 3. USER ROLES
// ════════════════════════════════════════════════════════════════════════════
push(
    h1('3. User Roles'),
    p('Access throughout the system is governed by four roles. Each role is authenticated through SAP XSUAA and presented with a navigation and feature set scoped to its responsibilities.'),
    table(
        ['Role', 'Primary Responsibility', 'Key Capabilities'],
        [
            ['Employee', 'Self-service operations', 'Manage profile, submit timesheets, apply leave, view & update tasks, view ratings, upload profile picture'],
            ['Manager', 'Team leadership & oversight', 'Team management, task assignment, team approvals, team attendance, performance ratings, approval history'],
            ['HR', 'Workforce administration', 'Employee onboarding, employee management, user activation / deactivation, workforce administration'],
            ['Founder', 'Executive intelligence', 'Executive dashboard, organization & department analytics, employee executive analytics, founder approvals, ratings and tasks']
        ],
        [16, 30, 54]
    ),
    spacer()
);

// ════════════════════════════════════════════════════════════════════════════
// generic module renderer (Features + Validations)
// ════════════════════════════════════════════════════════════════════════════
function module(title, sections) {
    push(h1(title));
    sections.forEach(sec => {
        push(h2(sec.heading));
        if (sec.intro) push(p(sec.intro));
        if (sec.bullets) push(...bullets(sec.bullets));
        if (sec.sub) sec.sub.forEach(s => { push(h3(s.heading)); push(...bullets(s.bullets)); });
        if (sec.table) push(sec.table, spacer(80));
    });
    push(spacer());
}

// 4. EMPLOYEE MANAGEMENT
module('4. Employee Management Module', [
    { heading: 'Features', bullets: ['Employee creation', 'Employee modification', 'Employee activation', 'Employee deactivation', 'Profile management'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Unique Employee ID', 'Each employee is assigned a system-generated, non-duplicable identifier'],
                ['Mandatory Email', 'A valid, unique email address is required and used for identity resolution'],
                ['Mandatory Department', 'Every employee must belong to a department'],
                ['Mandatory Designation', 'A designation/role title is required at creation'],
                ['Lifecycle Control', 'Deactivated employees are retained for history but blocked from access']
            ], [28, 72])
    }
]);

// 5. AUTH
module('5. Authentication & Authorization', [
    { heading: 'Features', bullets: ['Login', 'Logout', 'Password reset', 'Role-based navigation'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Inactive Login Block', 'Inactive employees cannot log in; the session is terminated server-side'],
                ['Authorized Access', 'Unauthorized page access is restricted by route guards and backend scopes'],
                ['Role Validation', 'Every module re-validates the caller’s role on each request'],
                ['Founder Routing', 'Founder logins are redirected to the dedicated Executive Command Center']
            ], [28, 72])
    }
]);

// 6. LEAVE
module('6. Leave Management Module', [
    { heading: 'Features', bullets: ['Apply leave', 'Leave cancellation', 'Leave approval', 'Leave rejection', 'Leave history'] },
    { heading: 'Leave Types', bullets: ['Casual Leave', 'Sick Leave', 'Earned Leave'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Balance Check', 'A leave request cannot exceed the employee’s available balance'],
                ['Idempotent Approval', 'A leave that is already approved cannot be approved again'],
                ['No Overlap', 'Leave dates cannot overlap with an existing request'],
                ['Mandatory Reason', 'A reason is required for every leave application']
            ], [28, 72])
    }
]);

// 7. TIMESHEET
module('7. Timesheet Management Module', [
    { heading: 'Features', bullets: ['Daily timesheet entry', 'Weekly summary', 'Timesheet submission', 'Timesheet approval', 'Previous-week fill requests', 'Missed-day unlock requests'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['No Future Dates', 'Entries cannot be logged against future dates'],
                ['Hour Limits', 'Logged hours cannot exceed the permitted daily/weekly limits'],
                ['Mandatory Task', 'Each entry must reference a task (or a custom "Others" task)'],
                ['Duplicate Prevention', 'Duplicate entries for the same task and date are blocked'],
                ['Locked After Approval', 'Approved entries are locked and cannot be edited']
            ], [28, 72])
    }
]);

// 8. TASK
push(h1('8. Task Management Module'));
push(h2('Individual Tasks'), ...bullets(['Create', 'Assign', 'Update status', 'Review workflow']));
push(h2('Group Tasks'), ...bullets(['Group assignment', 'Progress tracking', 'Team updates']));
push(h2('Task Updates'), p('Assigned employees can post progress updates with optional attachments. Managers can monitor progress and the review workflow in real time.'));
push(h2('Business Rules & Validations'), table(
    ['Validation', 'Rule'],
    [
        ['Mandatory Assignee', 'An assigned employee is required for every task'],
        ['Due Date Validation', 'Due dates are validated and drive overdue detection'],
        ['Review Workflow', 'Completed tasks follow the defined review/approval workflow'],
        ['Immutable After Approval', 'Completed tasks cannot revert after approval'],
        ['Completed Hidden', 'Completed tasks are excluded from active lists and selection dropdowns']
    ], [28, 72]), spacer());

// 9. RATING
module('9. Performance Rating Module', [
    { heading: 'Features', bullets: ['Employee rating', 'Manager rating', 'Rating history', 'Department performance tracking'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Rating Range', 'Ratings are constrained to the valid 1–5 scale'],
                ['Mandatory Comments', 'Comments are required where the workflow mandates them'],
                ['Immutable History', 'Historical ratings are preserved and feed trend analytics'],
                ['Scoped Rating', 'Managers may only rate their own team members']
            ], [28, 72])
    }
]);

// 10. APPROVAL
module('10. Approval Module', [
    { heading: 'Features', bullets: ['Leave approval', 'Timesheet approval', 'Task review approval', 'Previous-week & missed-day fill approvals'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Authorized Approvers', 'Only authorized approvers can act on a request'],
                ['Audit Trail', 'Every decision records who acted, when, and any remarks'],
                ['Locked After Completion', 'Approval status is locked once a decision is recorded'],
                ['Notification on Decision', 'The requester is notified in-app on every outcome']
            ], [28, 72])
    }
]);

// 11. NOTIFICATIONS
module('11. Notifications Module', [
    { heading: 'Features', bullets: ['Leave notifications', 'Task notifications', 'Approval notifications', 'Rating notifications'] },
    {
        heading: 'Business Rules & Validations', table: table(
            ['Validation', 'Rule'],
            [
                ['Role-based Visibility', 'Notifications are delivered only to the relevant recipient/role'],
                ['Real-time Updates', 'Notifications appear without a manual refresh'],
                ['Deep Linking', 'Notifications route the user to the relevant screen by type']
            ], [28, 72])
    }
]);

// 12. DASHBOARD
push(h1('12. Dashboard Module'));
push(h2('Employee Dashboard'), ...bullets(['Tasks', 'Leave balance', 'Timesheet summary', 'Ratings']));
push(h2('Manager Dashboard'), ...bullets(['Team performance', 'Pending approvals', 'Team attendance', 'Department metrics']));
push(h2('HR Dashboard'), ...bullets(['Employee statistics', 'Workforce overview', 'Employee lifecycle metrics']));
push(h2('Founder Dashboard — Executive Command Center'));
push(h3('Executive Metrics'), ...bullets(['Company Health Score', 'Productivity Score', 'Executive Insights', 'Department Rankings', 'Risk Center']));
push(h3('Analytics Views'), ...bullets(['Organization Analytics', 'Department Analytics', 'Employee Executive Analytics']));
push(h3('Charts & Visualizations'), ...bullets(['Performance Trends', 'Task Trends', 'Leave Analytics', 'Department Comparisons']));
push(spacer());

// 13. FORMULAS
push(h1('13. Founder Dashboard Calculations'));
push(p('All executive metrics are derived live from Tasks, Ratings, Leave, Timesheets and Employee records — there are no duplicate KPI tables. The weighted formulas below are applied consistently at organization, department and employee scope so that benchmarks are directly comparable.'));
push(h2('Company Health Score'), table(
    ['Component', 'Weight'],
    [['Task Completion', '30%'], ['Average Rating', '25%'], ['Timesheet Compliance', '20%'], ['Active Workforce', '15%'], ['Leave Utilization', '10%']], [70, 30]), spacer(80));
push(h2('Productivity Score'), table(
    ['Component', 'Weight'],
    [['Task Completion', '50%'], ['Timesheet Compliance', '30%'], ['Rating Score', '20%']], [70, 30]), spacer(80));
push(h2('Department Health Score'), table(
    ['Component', 'Weight'],
    [['Rating', '40%'], ['Task Completion', '30%'], ['Timesheet Compliance', '20%'], ['Leave Balance', '10%']], [70, 30]), spacer(80));
push(h2('Employee Executive Analytics'), p('Each employee profile additionally computes a Reliability Score (timesheet compliance, task-completion consistency and deadline adherence), a Contribution classification (High Performer, Consistent Contributor, Average Contributor or Needs Attention) and a Risk Level (Low / Medium / High) derived from declining ratings, overdue tasks, missing timesheets, low productivity and excessive leave usage.'), spacer());

// 14. SIDEBAR
push(h1('14. Founder Sidebar'),
    h2('Features'), ...bullets(['Collapsible navigation', 'Approvals', 'Tasks', 'Ratings']),
    h2('Behavior'),
    ...bullets(['Collapsed by default, showing icons only', 'Expands on click to reveal labels', 'Auto-collapses when not in use', 'Highlights the active destination']),
    spacer());

// 15. REAL-TIME
push(h1('15. Real-Time Updates'),
    p('The platform maintains an always-current executive view. Whenever any of the following business events occur, the dashboards, charts, KPIs and insights update automatically — without a manual refresh — via a live Server-Sent Events channel:'),
    ...bullets([
        'Employee created, updated, activated or deactivated',
        'Task created, updated or completed',
        'Rating submitted',
        'Leave approved or rejected',
        'Timesheet submitted or approved'
    ]),
    spacer());

// 16. SECURITY
push(h1('16. Security & Validation Rules'),
    p('Business rules are enforced both in the UI and re-validated server-side, ensuring data integrity regardless of the entry point.'),
    table(
        ['Category', 'Enforced Rules'],
        [
            ['Login Restrictions', 'Inactive accounts blocked; role validated on every request; founder auto-redirect'],
            ['Approval Restrictions', 'Only authorized approvers; idempotent decisions; locked after completion; full audit trail'],
            ['Task Restrictions', 'Mandatory assignee; due-date validation; completed tasks immutable after approval'],
            ['Leave Restrictions', 'Balance enforcement; no overlapping dates; mandatory reason'],
            ['Rating Restrictions', 'Valid 1–5 range; team-scoped; immutable history'],
            ['Data Integrity', 'Unique identifiers; single source of truth; no duplicate analytics tables']
        ],
        [26, 74]),
    spacer());

// 17. FUTURE
push(h1('17. Future Enhancements'),
    p('The architecture is designed to scale. The following roadmap items can be layered onto the existing foundation:'),
    ...bullets([
        'Mobile application for on-the-go access',
        'AI-driven executive insights and natural-language summaries',
        'Predictive analytics for attrition and performance forecasting',
        'Employee engagement module (surveys, recognition, feedback)',
        'Recruitment & applicant tracking module',
        'Payroll integration',
        'Advanced, configurable reporting and export'
    ]),
    spacer());

// 18. CONCLUSION
push(h1('18. Conclusion'),
    p('The Employee Management System delivers a unified, role-based platform that brings every dimension of workforce management — onboarding, tasks, timesheets, leave, performance and approvals — into a single, governed environment. Its layered SAP CAP and SAPUI5 architecture ensures scalability and maintainability, while strict role-based access and server-side validation guarantee security and data integrity.'),
    p('For leadership, the Founder Executive Command Center transforms operational activity into strategic intelligence: real-time company health, productivity and risk indicators, department rankings, and employee-level executive analytics with benchmark comparisons — all updating automatically as the organization works. The result is workflow automation and centralized workforce management that empowers fast, well-informed executive decision-making.'),
    spacer());

// ════════════════════════════════════════════════════════════════════════════
// ASSEMBLE
// ════════════════════════════════════════════════════════════════════════════
const doc = new Document({
    creator: 'Ccentrik',
    title: 'Employee Management System — Functional Specification',
    description: 'Functional Specification & Business Requirement Document',
    styles: {
        default: { document: { run: { font: 'Calibri', size: 21 } } }
    },
    sections: [{
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1200, right: 1200 } } },
        headers: {
            default: new Header({
                children: [new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5', space: 4 } },
                    children: [new TextRun({ text: 'Employee Management System  •  Functional Specification', size: 16, color: GREY })]
                })]
            })
        },
        footers: {
            default: new Footer({
                children: [new Paragraph({
                    alignment: AlignmentType.CENTER,
                    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2E5', space: 4 } },
                    children: [
                        new TextRun({ text: 'Ccentrik — Internal & Confidential     |     Page ', size: 16, color: GREY }),
                        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
                        new TextRun({ text: ' of ', size: 16, color: GREY }),
                        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY })
                    ]
                })]
            })
        },
        children: out
    }]
});

const outPath = path.join(__dirname, 'Employee_Management_System_Functional_Specification.docx');
Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(outPath, buf);
    console.log('✓ Document written:', outPath, '(' + Math.round(buf.length / 1024) + ' KB)');
}).catch(e => { console.error('Failed:', e); process.exit(1); });
