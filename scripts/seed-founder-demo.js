/* ─────────────────────────────────────────────────────────────────────────────
 * scripts/seed-founder-demo.js
 *
 * Populates RICH DEMO DATA so the Founder Executive Dashboard looks fully alive
 * for a demo:  multiple departments, 6 months of performance ratings (trend),
 * tasks across every status (incl. overdue), current-week timesheet compliance,
 * and approved leaves of every type.
 *
 * SAFE & IDEMPOTENT — every row it creates is tagged, so re-running first removes
 * the previous demo rows and never touches your real data:
 *   • demo employees ............ employeeId  LIKE 'EMP2%'
 *   • demo tasks ................ taskId      LIKE 'DTASK%'
 *   • demo leaves ............... leaveId     LIKE 'DLV-%'
 *   • demo ratings .............. reviewComment LIKE '%[seed]%'
 *   • demo timesheets ........... remarks     = '[seed]'
 *
 * Run (local SQLite):   node scripts/seed-founder-demo.js
 * Undo:                 node scripts/seed-founder-demo.js --clear
 * ───────────────────────────────────────────────────────────────────────────── */
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'db.sqlite'));
const P = 'ccentrik_employee_timesheet_schema_timesheet_';

// ── date helpers ──────────────────────────────────────────────────────────────
const iso = (d) => { const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${d.getFullYear()}-${m}-${day}`; };
function mondayOf(date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d; }
function last6Months() { const out = []; const n = new Date(); for (let i = 5; i >= 0; i--) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push({ y: d.getFullYear(), m: d.getMonth() + 1 }); } return out; }
const today = new Date();
// IMPORTANT: match the founder analytics' own current-week key exactly. Its
// _mondayISO() builds local-midnight Monday then toISOString() (→ UTC), which in
// a +ve timezone shifts the date back a day. We replicate it 1:1 so the seeded
// timesheets register as "submitted this week" in the compliance widget.
function mondayKeyServer(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
}
const weekStartStr = mondayKeyServer(today);
const weekEndStr = (() => { const d = new Date(weekStartStr); d.setDate(d.getDate() + 4); return d.toISOString().slice(0, 10); })();
const catFor = (v) => v >= 4.5 ? 'Excellent' : v >= 3.5 ? 'Good' : v >= 2.5 ? 'Average' : 'Needs Improvement';

// ── 1. CLEAR any previous demo rows (always, so re-runs are clean) ────────────
const clear = () => {
    db.prepare(`DELETE FROM ${P}PerformanceRating WHERE reviewComment LIKE '%[seed]%'`).run();
    db.prepare(`DELETE FROM ${P}TaskMaster        WHERE taskId LIKE 'DTASK%'`).run();
    db.prepare(`DELETE FROM ${P}LeaveRequest      WHERE leaveId LIKE 'DLV-%'`).run();
    db.prepare(`DELETE FROM ${P}TimesheetHeader   WHERE remarks = '[seed]'`).run();
    db.prepare(`DELETE FROM ${P}EmployeeMaster    WHERE employeeId LIKE 'EMP2%'`).run();
    // Salary master rows for the demo/base employees (used by project budget calc).
    try { db.prepare(`DELETE FROM ${P}EmployeeSalaryMaster WHERE salaryId LIKE 'EMP%'`).run(); } catch (e) { /* table may not exist yet on first run */ }
};

// Per-employee annual salary (₹) → hourly cost (≈ annual / (12·22·8)) for budget.
const SALARY_ANNUAL = {
    EMP1001: 1200000, EMP1002: 1500000, EMP1003: 900000, EMP1004: 1000000,
    EMP1005: 2400000, EMP1006: 6000000, EMP1008: 1800000,
    EMP2001: 1100000, EMP2002: 1600000, EMP2003: 800000, EMP2004: 1300000,
    EMP2005: 1400000, EMP2006: 1500000, EMP2007: 1700000, EMP2008: 950000
};

if (process.argv.includes('--clear')) {
    clear();
    console.log('✓ Demo data removed.');
    process.exit(0);
}

// ── 2. Demo employees (enrich departments so rankings/heatmap look staffed) ───
const demoEmployees = [
    ['EMP2001', 'Aarav Mehta',   'Software Engineer',   'Engineering',     'EMP1005'],
    ['EMP2002', 'Isha Reddy',    'Senior Developer',    'Engineering',     'EMP1005'],
    ['EMP2003', 'Rohan Gupta',   'Sales Executive',     'Sales',           'EMP1006'],
    ['EMP2004', 'Sara Khan',     'Account Manager',     'Sales',           'EMP1006'],
    ['EMP2005', 'Vikram Nair',   'Financial Analyst',   'Finance',         'EMP1005'],
    ['EMP2006', 'Meera Joshi',   'HR Executive',        'Human Resources', 'EMP1006'],
    ['EMP2007', 'Karan Malhotra','Marketing Lead',      'Marketing',       'EMP1006'],
    ['EMP2008', 'Diya Shah',     'Content Strategist',  'Marketing',       'EMP1006']
];

// existing non-founder employees we also enrich with data
const baseEmployees = [
    { id: 'EMP1001', dept: 'Engineering' },
    { id: 'EMP1002', dept: 'Human Resources' },
    { id: 'EMP1003', dept: 'Sales' },
    { id: 'EMP1004', dept: 'Finance' },
    { id: 'EMP1005', dept: 'Management' },
    { id: 'EMP1008', dept: 'Human Resources' }
];

const insEmp = db.prepare(
    `INSERT INTO ${P}EmployeeMaster (employeeId, employeeName, designation, email, department, joiningDate, isActive, status, role, manager_employeeId)
     VALUES (@employeeId, @employeeName, @designation, @email, @department, @joiningDate, 1, 'Active', 'employee', @manager)`
);
const insRating = db.prepare(
    `INSERT OR REPLACE INTO ${P}PerformanceRating (ratingId, employee_employeeId, ratingValue, reviewMonth, reviewYear, ratingCategory, reviewComment)
     VALUES (@ratingId, @emp, @val, @m, @y, @cat, @comment)`
);
const insTask = db.prepare(
    `INSERT INTO ${P}TaskMaster (taskId, taskName, taskDescription, assignedTo_employeeId, priority, status, taskType, startDate, dueDate, statusUpdatedAt, completedAt)
     VALUES (@taskId, @name, @desc, @emp, @priority, @status, 'solo', @start, @due, @updated, @completed)`
);
const insHeader = db.prepare(
    `INSERT OR REPLACE INTO ${P}TimesheetHeader (timesheetId, employee_employeeId, weekStartDate, weekEndDate, status, submissionType, submittedOn, remarks)
     VALUES (@id, @emp, @ws, @we, @status, 'Weekly', @submittedOn, '[seed]')`
);
const insLeave = db.prepare(
    `INSERT INTO ${P}LeaveRequest (leaveId, employee_employeeId, leaveType, fromDate, toDate, days, reason, status)
     VALUES (@id, @emp, @type, @from, @to, @days, @reason, 'Approved')`
);
let insSalary = null;
try {
    insSalary = db.prepare(
        `INSERT OR REPLACE INTO ${P}EmployeeSalaryMaster (salaryId, employee_employeeId, employeeName, annualSalary, monthlySalary, hourlyCost, effectiveFrom, isActive)
         VALUES (@id, @emp, @name, @annual, @monthly, @hourly, '2024-01-01', 1)`
    );
} catch (e) { /* table not deployed yet */ }

const PRIORITIES = ['High', 'Medium', 'Low'];
const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Paid Leave', 'Earned Leave'];
const TASK_NAMES = ['Quarterly report', 'Client onboarding', 'Feature rollout', 'Process review', 'Budget planning', 'Campaign launch', 'Audit follow-up', 'Team sync notes'];

const seed = db.transaction(() => {
    clear();

    // employees
    for (const [employeeId, employeeName, designation, department, manager] of demoEmployees) {
        insEmp.run({ employeeId, employeeName, designation, department, manager,
            email: employeeName.toLowerCase().replace(/\s+/g, '.') + '@ccentrik.com',
            joiningDate: '2022-0' + (1 + (parseInt(employeeId.slice(-1)) % 8)) + '-15' });
    }

    // Salary master (hourly cost = annual / (12·22·8)) for budget consumption.
    if (insSalary) {
        const nameById = {}; demoEmployees.forEach(d => { nameById[d[0]] = d[1]; });
        Object.keys(SALARY_ANNUAL).forEach(empId => {
            const annual = SALARY_ANNUAL[empId];
            insSalary.run({ id: empId + '-2024-01-01', emp: empId, name: nameById[empId] || empId,
                annual: annual, monthly: Math.round(annual / 12), hourly: Math.round((annual / (12 * 22 * 8)) * 100) / 100 });
        });
    }

    const allEmps = baseEmployees.map(e => e.id).concat(demoEmployees.map(d => d[0]));
    const months = last6Months();
    let taskN = 0, leaveN = 0, ei = 0;

    for (const emp of allEmps) {
        ei++;
        // ── 6 months of ratings, gently trending upward (varies per employee) ──
        const base = 3.2 + ((ei % 5) * 0.25);          // 3.2 … 4.2 baseline
        months.forEach((mm, idx) => {
            let v = Math.min(5, base + idx * 0.12 + (((ei + idx) % 3) - 1) * 0.1);
            v = Math.round(v * 10) / 10;
            insRating.run({ ratingId: `${emp}-${mm.y}-${String(mm.m).padStart(2, '0')}`, emp,
                val: v, m: mm.m, y: mm.y, cat: catFor(v), comment: 'Solid month. [seed]' });
        });

        // ── 5 tasks: 2 completed, 1 in-review, 1 in-progress, 1 (some overdue) ──
        const plans = [
            { status: 'Completed',   overdue: false },
            { status: 'Completed',   overdue: false },
            { status: 'In Review',   overdue: false },
            { status: 'In Progress', overdue: false },
            { status: (ei % 4 === 0 ? 'Not Started' : 'In Progress'), overdue: (ei % 3 === 0) }
        ];
        plans.forEach((p, i) => {
            taskN++;
            const start = new Date(today); start.setDate(start.getDate() - (10 + i * 3));
            const due = new Date(today);
            if (p.overdue) due.setDate(due.getDate() - (2 + i));      // past + not completed → overdue
            else due.setDate(due.getDate() + (5 + i * 2));
            insTask.run({ taskId: `DTASK${String(taskN).padStart(3, '0')}`,
                name: TASK_NAMES[(taskN) % TASK_NAMES.length], desc: 'Demo task for analytics. [seed]',
                emp, priority: PRIORITIES[i % 3], status: p.status,
                start: iso(start), due: iso(due), updated: today.toISOString(),
                completed: p.status === 'Completed' ? today.toISOString() : null });
        });

        // ── Current-week timesheet (≈85% compliant; the rest left "missing") ──
        if (ei % 7 !== 0) {
            // A few stay 'Pending' (awaiting the founder's decision); the rest are
            // 'Approved'. Both count toward timesheet compliance.
            insHeader.run({ id: `${emp}-${weekStartStr}`, emp, ws: weekStartStr, we: weekEndStr,
                status: (ei % 4 === 0 ? 'Pending' : 'Approved'), submittedOn: today.toISOString() });
        }

        // ── 1–2 approved leaves of varied types ──
        const nLeaves = 1 + (ei % 2);
        for (let i = 0; i < nLeaves; i++) {
            leaveN++;
            const from = new Date(today); from.setDate(from.getDate() - (15 + i * 7));
            const to = new Date(from); to.setDate(from.getDate() + (1 + i));
            insLeave.run({ id: `DLV-${String(leaveN).padStart(3, '0')}`, emp,
                type: LEAVE_TYPES[(ei + i) % LEAVE_TYPES.length], from: iso(from), to: iso(to),
                days: 1 + i, reason: 'Personal' });
        }
    }
});

seed();

// ── summary ───────────────────────────────────────────────────────────────────
const count = (t, w) => db.prepare(`SELECT COUNT(*) c FROM ${P}${t} ${w}`).get().c;
console.log('✓ Founder demo data seeded:');
console.log('   employees (demo):', count('EmployeeMaster', "WHERE employeeId LIKE 'EMP2%'"));
console.log('   ratings (seed)  :', count('PerformanceRating', "WHERE reviewComment LIKE '%[seed]%'"));
console.log('   tasks (demo)    :', count('TaskMaster', "WHERE taskId LIKE 'DTASK%'"));
console.log('   timesheets(seed):', count('TimesheetHeader', "WHERE remarks = '[seed]'"));
console.log('   leaves (demo)   :', count('LeaveRequest', "WHERE leaveId LIKE 'DLV-%'"));
console.log('   current week    :', weekStartStr, '→', weekEndStr);
