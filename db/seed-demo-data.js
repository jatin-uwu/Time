/* ════════════════════════════════════════════════════════════════════════════
   Founder Dashboard — demo / dummy data seed (idempotent)
   ----------------------------------------------------------------------------
   Populates the existing tables so the Founder Dashboard, charts, heatmap,
   leaderboard, risk-center and the Approvals/Tasks/Ratings modules look alive.

   • Idempotent: every row it writes is tagged createdBy = 'seed-demo'. Re-running
     first deletes all 'seed-demo' rows, so it never duplicates and never touches
     the real EMP1xxx records.
   • No schema changes — writes only to existing physical tables.

   Run:  node db/seed-demo-data.js
   Undo: node db/seed-demo-data.js --clear
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'db.sqlite');
const P = 'ccentrik_employee_timesheet_schema_timesheet_';
const TAG = 'seed-demo';
const db = new Database(DB_PATH);

const T = {
    emp: P + 'EmployeeMaster',
    task: P + 'TaskMaster',
    leave: P + 'LeaveRequest',
    header: P + 'TimesheetHeader',
    rating: P + 'PerformanceRating'
};

// ── helpers ──────────────────────────────────────────────────────────────────
const colCache = {};
function cols(table) { return colCache[table] || (colCache[table] = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name))); }
function insert(table, obj) {
    const valid = Object.keys(obj).filter(k => cols(table).has(k));
    const sql = `INSERT INTO ${table} (${valid.map(c => '"' + c + '"').join(',')}) VALUES (${valid.map(() => '?').join(',')})`;
    db.prepare(sql).run(valid.map(k => obj[k]));
}
const NOW = new Date();
const nowISO = NOW.toISOString();
const iso = d => d.toISOString().slice(0, 10);
const managed = () => ({ createdAt: nowISO, createdBy: TAG, modifiedAt: nowISO, modifiedBy: TAG });
function mondayISO(date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return iso(d); }
function addDays(isoStr, n) { const d = new Date(isoStr); d.setDate(d.getDate() + n); return iso(d); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function round1(n) { return Math.round(n * 10) / 10; }
// last 6 months ending current month (matches the dashboard's _last6Months window)
const months6 = (() => { const out = []; for (let i = 5; i >= 0; i--) { const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1); out.push({ y: d.getFullYear(), m: d.getMonth() + 1 }); } return out; })();

// ── clear previous demo data ─────────────────────────────────────────────────
function clearDemo() {
    let total = 0;
    Object.values(T).forEach(tbl => { total += db.prepare(`DELETE FROM ${tbl} WHERE createdBy = ?`).run(TAG).changes; });
    return total;
}

// ── department blueprint (shapes heatmap / leaderboard / risk) ────────────────
// avg = target rating · taskQ = completion bias (0..1) · comply = % who submit TS
const DEPTS = [
    { name: 'Engineering',      avg: 4.4, taskQ: 0.85, comply: 0.9,  size: 4, desg: ['Senior Engineer', 'Software Engineer', 'Tech Lead', 'QA Engineer'] },
    { name: 'Finance',          avg: 4.5, taskQ: 0.8,  comply: 0.95, size: 3, desg: ['Accountant', 'Finance Analyst', 'Finance Manager'] },
    { name: 'Sales',            avg: 3.7, taskQ: 0.6,  comply: 0.7,  size: 4, desg: ['Sales Executive', 'Account Manager', 'Sales Lead', 'BDR'] },
    { name: 'Human Resources',  avg: 3.9, taskQ: 0.7,  comply: 0.85, size: 3, desg: ['HR Executive', 'Recruiter', 'HR Business Partner'] },
    { name: 'IT',               avg: 4.1, taskQ: 0.78, comply: 0.8,  size: 3, desg: ['System Admin', 'IT Support', 'DevOps Engineer'] },
    { name: 'Customer Success', avg: 3.4, taskQ: 0.55, comply: 0.6,  size: 3, desg: ['CS Associate', 'CS Manager', 'Support Specialist'] },
    { name: 'Marketing',        avg: 3.1, taskQ: 0.45, comply: 0.5,  size: 3, desg: ['Marketing Exec', 'Content Writer', 'SEO Specialist'] },
    { name: 'Operations',       avg: 2.5, taskQ: 0.3,  comply: 0.3,  size: 3, desg: ['Ops Associate', 'Ops Coordinator', 'Logistics Lead'] }
];

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Navya', 'Riya', 'Ira', 'Kabir', 'Dev', 'Yash', 'Nikhil', 'Tara', 'Meera', 'Sara', 'Pooja'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Mehta', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Joshi', 'Malhotra', 'Bose', 'Chopra', 'Sethi', 'Rao', 'Desai', 'Kulkarni'];

function seed() {
    const removed = clearDemo();
    console.log(`Cleared ${removed} previous demo rows.`);

    const employees = [];
    let n = 0, fi = 0, li = 0;
    DEPTS.forEach(dep => {
        for (let i = 0; i < dep.size; i++) {
            const id = 'EMP2' + String(++n).padStart(3, '0');
            const first = FIRST[fi++ % FIRST.length], last = LAST[li++ % LAST.length];
            const name = `${first} ${last}`;
            // a couple of inactive employees (Operations + Marketing) → inactive risk
            const inactive = (dep.name === 'Operations' && i === dep.size - 1) || (dep.name === 'Marketing' && i === dep.size - 1);
            const joinYear = 2017 + (n % 8);
            const joinMonth = String(1 + (n % 12)).padStart(2, '0');
            const joinDay = String(1 + (n % 27)).padStart(2, '0');
            employees.push({ id, name, dep, inactive });
            insert(T.emp, Object.assign(managed(), {
                employeeId: id, employeeName: name,
                email: `${first}.${last}.${n}`.toLowerCase() + '@ccentrik.com',
                designation: dep.desg[i % dep.desg.length], department: dep.name,
                manager_employeeId: 'EMP1005',
                isActive: inactive ? 0 : 1, status: inactive ? 'Inactive' : 'Active',
                joiningDate: `${joinYear}-${joinMonth}-${joinDay}`,
                employmentType: 'Full-time', workLocation: pick(['Remote', 'Office', 'Hybrid']),
                gender: pick(['Male', 'Female'])
            }));
        }
    });
    console.log(`Inserted ${employees.length} demo employees.`);

    // ── Performance ratings — 6 months per employee (drives trend + heatmap) ──
    let rCount = 0;
    employees.forEach(e => {
        months6.forEach((mm, idx) => {
            // gentle upward wobble across the 6 months + per-employee variance
            const base = e.dep.avg + rnd(-0.4, 0.4) + (idx - 2.5) * 0.04;
            const val = Math.max(1, Math.min(5, round1(base)));
            insert(T.rating, Object.assign(managed(), {
                ratingId: `${e.id}-${mm.y}-${String(mm.m).padStart(2, '0')}`,
                employee_employeeId: e.id, ratingValue: val,
                reviewMonth: mm.m, reviewYear: mm.y,
                ratingCategory: 'Overall',
                reviewComment: pick(['Consistent contributor.', 'Exceeded expectations this month.', 'Solid delivery.', 'Room to improve on deadlines.', 'Great team player.', 'Needs closer follow-up.'])
            }));
            rCount++;
        });
    });
    console.log(`Inserted ${rCount} performance ratings (6 months each).`);

    // ── Tasks — mixed statuses incl. overdue; completedAt spread for trend ────
    const today = iso(NOW);
    let tCount = 0, tid = 0, overdueTotal = 0;
    employees.filter(e => !e.inactive).forEach(e => {
        const count = 2 + Math.floor(Math.random() * 3); // 2–4 tasks each
        for (let i = 0; i < count; i++) {
            const id = 'DM' + String(++tid).padStart(3, '0');
            const r = Math.random();
            let status, statusUpdatedAt = null, dueDate, completedAt = null;
            if (r < e.dep.taskQ) {
                // completed — completion month weighted toward recent months
                status = 'Completed';
                const mm = months6[Math.min(5, Math.floor(Math.pow(Math.random(), 0.6) * 6))];
                const day = String(5 + Math.floor(Math.random() * 20)).padStart(2, '0');
                statusUpdatedAt = `${mm.y}-${String(mm.m).padStart(2, '0')}-${day}T10:00:00.000Z`;
                completedAt = statusUpdatedAt;
                dueDate = `${mm.y}-${String(mm.m).padStart(2, '0')}-28`;
            } else if (r < e.dep.taskQ + 0.18) {
                status = 'In Progress';
                statusUpdatedAt = nowISO;
                dueDate = addDays(today, 5 + Math.floor(Math.random() * 20));
            } else if (r < e.dep.taskQ + 0.36) {
                // overdue: not completed + due date in the past
                status = pick(['Not Started', 'In Progress']);
                dueDate = addDays(today, -(3 + Math.floor(Math.random() * 25)));
                overdueTotal++;
            } else {
                status = 'Not Started';
                dueDate = addDays(today, 7 + Math.floor(Math.random() * 21));
            }
            insert(T.task, Object.assign(managed(), {
                taskId: id,
                taskName: pick(['Quarterly report', 'Client onboarding', 'Bug triage', 'Campaign rollout', 'Data migration', 'Process audit', 'Feature spec', 'Vendor review', 'Budget planning', 'Sprint cleanup']) + ' #' + id.slice(2),
                taskDescription: 'Demo task for ' + e.name,
                assignedTo_employeeId: e.id, reviewer_employeeId: 'EMP1005',
                priority: pick(['High', 'Medium', 'Medium', 'Low']),
                status, statusUpdatedAt, completedAt,
                taskType: 'solo',
                startDate: addDays(today, -30), dueDate
            }));
            tCount++;
        }
    });
    console.log(`Inserted ${tCount} tasks (${overdueTotal} overdue).`);

    // ── Approved leaves — donut categories + excessive-leave risk ────────────
    let lCount = 0, lid = 0;
    const leaveTypes = ['Casual', 'Sick', 'Paid'];
    employees.filter(e => !e.inactive).forEach((e, idx) => {
        const taken = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < taken; i++) {
            const days = 1 + Math.floor(Math.random() * 4);
            const from = `2026-0${1 + Math.floor(Math.random() * 5)}-${String(2 + Math.floor(Math.random() * 20)).padStart(2, '0')}`;
            insert(T.leave, Object.assign(managed(), {
                leaveId: `${e.id}-LV-${Date.now()}-${++lid}`,
                employee_employeeId: e.id, leaveType: pick(leaveTypes),
                fromDate: from, toDate: addDays(from, days - 1), days,
                reason: pick(['Personal work', 'Medical', 'Family function', 'Vacation', 'Not well']),
                status: 'Approved', approvedBy_employeeId: 'EMP1005', approvedOn: nowISO
            }));
            lCount++;
        }
        // a few employees with > 15 approved days → excessive-leave risk
        if (idx % 9 === 0) {
            insert(T.leave, Object.assign(managed(), {
                leaveId: `${e.id}-LV-${Date.now()}-X${++lid}`,
                employee_employeeId: e.id, leaveType: 'Paid',
                fromDate: '2026-04-06', toDate: '2026-04-23', days: 16,
                reason: 'Extended vacation', status: 'Approved', approvedBy_employeeId: 'EMP1005', approvedOn: nowISO
            }));
            lCount++;
        }
    });
    console.log(`Inserted ${lCount} approved leave requests.`);

    // ── A few PENDING leaves so the Approvals module has items ────────────────
    let pendCount = 0;
    employees.filter(e => !e.inactive).slice(0, 4).forEach((e, i) => {
        const from = addDays(today, 3 + i);
        insert(T.leave, Object.assign(managed(), {
            leaveId: `${e.id}-LV-${Date.now()}-P${i}`,
            employee_employeeId: e.id, leaveType: pick(leaveTypes),
            fromDate: from, toDate: addDays(from, 1 + i), days: 2 + i,
            reason: pick(['Personal work', 'Medical appointment', 'Family event']),
            status: 'Pending'
        }));
        pendCount++;
    });
    console.log(`Inserted ${pendCount} pending leave requests (for Approvals).`);

    // ── Timesheets for the last 8 weeks — compliance/reliability history ──────
    // (executive analytics uses an 8-week window; one week alone reads as ~0%).
    const monday = mondayISO(NOW);
    const sunday = addDays(monday, 6);
    let hCount = 0;
    for (let wk = 0; wk < 8; wk++) {
        const wMon = addDays(monday, -7 * wk);
        const wSun = addDays(wMon, 6);
        employees.filter(e => !e.inactive).forEach(e => {
            // per-week submission chance tracks the department's compliance bias
            if (Math.random() < e.dep.comply) {
                insert(T.header, Object.assign(managed(), {
                    timesheetId: `${e.id}-${wMon}`,
                    employee_employeeId: e.id, weekStartDate: wMon, weekEndDate: wSun,
                    status: wk === 0 ? pick(['Approved', 'Submitted', 'Pending']) : 'Approved',
                    submissionType: 'Weekly', submittedOn: nowISO
                }));
                hCount++;
            }
        });
    }
    // a couple of PENDING timesheets so the Approvals module shows timesheets too
    let tsPending = 0;
    employees.filter(e => !e.inactive).slice(0, 3).forEach(e => {
        const tsId = `${e.id}-${monday}`;
        db.prepare(`DELETE FROM ${T.header} WHERE timesheetId = ?`).run(tsId); // avoid PK clash
        insert(T.header, Object.assign(managed(), {
            timesheetId: tsId, employee_employeeId: e.id,
            weekStartDate: monday, weekEndDate: sunday,
            status: 'Pending', submissionType: 'Weekly', submittedOn: nowISO
        }));
        tsPending++;
    });
    console.log(`Inserted ${hCount} timesheets across 8 weeks (${tsPending} pending for Approvals).`);

    console.log('\n✓ Demo data seeded. Open the Founder Dashboard to see it populated.');
}

// ── entry ────────────────────────────────────────────────────────────────────
try {
    if (process.argv.includes('--clear')) { console.log(`Cleared ${clearDemo()} demo rows.`); }
    else { seed(); }
} finally { db.close(); }
