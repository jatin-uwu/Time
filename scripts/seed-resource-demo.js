// One-off demo seeder for the Resource Planning module.
// Adds employee skills/capacity, two demo projects (with requiredSkills), a set
// of allocations (including a deliberate overallocation), and an approved leave
// so utilization / availability / recommendations all show non-trivial values.
//
// Run with the app stopped:  node scripts/seed-resource-demo.js
const cds = require('@sap/cds');

const N = 'ccentrik.employee.timesheet.schema.timesheet.';
const EMP = N + 'EmployeeMaster';
const PROJECT = N + 'Project';
const RES = N + 'ProjectResource';
const LEAVE = N + 'LeaveRequest';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
    await cds.connect.to('db');
    const { UPDATE, UPSERT, INSERT, DELETE, SELECT } = cds.ql;

    const OVERRIDE = N + 'ResourceOverride';
    const DEMO_PIDS = ['PRJ-DEMO1', 'PRJ-DEMO2', 'PRJ-DEMO3'];
    // Idempotent: clear any previous demo rows first.
    await DELETE.from(RES).where({ project_projectId: { in: DEMO_PIDS } });
    await DELETE.from(PROJECT).where({ projectId: { in: DEMO_PIDS } });
    await DELETE.from(LEAVE).where({ leaveId: 'EMP1004-LV-DEMO' });
    await DELETE.from(OVERRIDE).where({ project_projectId: { in: DEMO_PIDS } });

    // 1. Employee skills + capacity tweaks.
    const skills = {
        EMP1001: { skills: 'Node.js, SAP UI5, HANA, JavaScript', monthlyCapacityHours: 160, monthlyTrainingHours: 0 },
        EMP1003: { skills: 'Node.js, React, Sales', monthlyCapacityHours: 160, monthlyTrainingHours: 0 },
        EMP1004: { skills: 'Excel, SAP FICO, Accounting', monthlyCapacityHours: 160, monthlyTrainingHours: 16 },
        EMP1005: { skills: 'Project Management, Scrum, Node.js', monthlyCapacityHours: 160, monthlyTrainingHours: 0 },
        EMP1002: { skills: 'Recruitment, HR Ops', monthlyCapacityHours: 160, monthlyTrainingHours: 8 },
        EMP1008: { skills: 'Recruitment, Onboarding, Scrum', monthlyCapacityHours: 160, monthlyTrainingHours: 0 },
        EMP1006: { skills: 'Strategy, Leadership, Finance', monthlyCapacityHours: 160, monthlyTrainingHours: 0 }
    };
    for (const [id, v] of Object.entries(skills)) {
        await UPDATE(EMP).set(v).where({ employeeId: id });
    }
    console.log('✓ skills/capacity set for', Object.keys(skills).join(', '));

    // 2. Two demo projects (Active so allocations consume capacity).
    const projects = [
        { projectId: 'PRJ-DEMO1', projectName: 'Apollo Platform', customerName: 'Acme Corp', status: 'Active',
          priority: 'High', startDate: addDays(-10), endDate: addDays(50), requiredSkills: 'Node.js, HANA, SAP UI5',
          pocName: 'Vineet', poc_employeeId: 'EMP1005' },
        { projectId: 'PRJ-DEMO2', projectName: 'Helios Portal', customerName: 'Globex', status: 'Active',
          priority: 'Medium', startDate: addDays(-5), endDate: addDays(20), requiredSkills: 'React, Node.js',
          pocName: 'Vineet', poc_employeeId: 'EMP1005' },
        { projectId: 'PRJ-DEMO3', projectName: 'Orion CRM', customerName: 'Initech', status: 'Active',
          priority: 'High', startDate: addDays(-3), endDate: addDays(35), requiredSkills: 'Scrum, Project Management',
          pocName: 'Vineet', poc_employeeId: 'EMP1005' }
    ];
    for (const p of projects) await INSERT.into(PROJECT).entries(p);
    console.log('✓ demo projects:', projects.map(p => p.projectId).join(', '));

    // 3. Allocations — EMP1001 is deliberately overallocated (75% + 50% = 125%).
    const cap = {}; (await SELECT.from(EMP).columns('employeeId', 'monthlyCapacityHours')).forEach(e => { cap[e.employeeId] = Number(e.monthlyCapacityHours) || 160; });
    const dept = {}; (await SELECT.from(EMP).columns('employeeId', 'employeeName', 'department')).forEach(e => { dept[e.employeeId] = e; });
    const allocs = [
        { pid: 'PRJ-DEMO1', emp: 'EMP1001', bw: 75, end: addDays(50) },
        { pid: 'PRJ-DEMO2', emp: 'EMP1001', bw: 50, end: addDays(20) },  // → 125% total (Overallocated, not overridden)
        { pid: 'PRJ-DEMO2', emp: 'EMP1003', bw: 50, end: addDays(20) },  // → base 50%
        { pid: 'PRJ-DEMO1', emp: 'EMP1003', bw: 75, end: addDays(50), override: { before: 50, reason: 'Critical client delivery — temporary bandwidth' } }, // → 125% (Overridden)
        { pid: 'PRJ-DEMO1', emp: 'EMP1004', bw: 25, end: addDays(50) },  // → ~33% (Available, low)
        { pid: 'PRJ-DEMO3', emp: 'EMP1005', bw: 100, end: addDays(35) }, // → 100% (Nearly Full)
        { pid: 'PRJ-DEMO3', emp: 'EMP1008', bw: 50, end: addDays(35) },  // → 50%  (Busy)
        { pid: 'PRJ-DEMO1', emp: 'EMP1002', bw: 25, end: addDays(50) }   // → ~26% (Available)
    ];
    const projName = {}; (await SELECT.from(PROJECT).columns('projectId', 'projectName')).forEach(p => { projName[p.projectId] = p.projectName; });
    for (const a of allocs) {
        await UPSERT.into(RES).entries({
            allocationId: `${a.pid}-${a.emp}`, project_projectId: a.pid, employee_employeeId: a.emp,
            employeeName: dept[a.emp].employeeName, department: dept[a.emp].department || 'Others',
            bandwidth: a.bw, startDate: addDays(-5), endDate: a.end,
            allocatedHours: Math.round(a.bw / 100 * cap[a.emp] * 100) / 100,
            isOverridden: a.override ? 1 : 0, overrideReason: a.override ? a.override.reason : null
        });
        if (a.override) {
            await INSERT.into(OVERRIDE).entries({
                overrideId: `${a.pid}-OVR-${a.emp}-${Date.now()}`, project_projectId: a.pid, projectName: projName[a.pid] || a.pid,
                employee_employeeId: a.emp, employeeName: dept[a.emp].employeeName,
                utilizationBefore: a.override.before, utilizationAfter: a.override.before + a.bw,
                reason: a.override.reason, overriddenById: 'EMP1005', overriddenByName: 'Vineet', overriddenAt: new Date().toISOString()
            });
        }
    }
    console.log('✓ allocations seeded (EMP1001 overallocated 125%; EMP1003 overridden to 125%)');

    // ── Budget allocation per demo project (funds the departments of seeded
    // resources) so Manage Resources can show assignable employees. Resource
    // assignment is restricted to budget-approved departments.
    const PB = N + 'ProjectBudget';
    await DELETE.from(PB).where({ project_projectId: { in: DEMO_PIDS } });
    const fundedByProject = {};
    allocs.forEach(a => {
        const dp = dept[a.emp].department || 'Others';
        (fundedByProject[a.pid] = fundedByProject[a.pid] || new Set()).add(dp);
    });
    for (const pid of DEMO_PIDS) {
        const depts = [...(fundedByProject[pid] || new Set())];
        if (!depts.length) continue;
        const deptBudgets = depts.map((dn, i) => ({ department: dn, amount: 200000 + i * 50000 }));
        const total = deptBudgets.reduce((s, x) => s + x.amount, 0) + 200000; // + headroom
        await UPSERT.into(PB).entries({
            budgetId: `${pid}-BUDGET`, project_projectId: pid, totalBudget: total,
            departmentBudgets: JSON.stringify(deptBudgets), otherBudgets: JSON.stringify([]),
            allocatedAt: new Date().toISOString(), allocatedByName: 'Founder Member'
        });
    }
    console.log('✓ project budgets seeded (departments funded for resource assignment)');

    // 4. Approved leave for EMP1004 this month (reduces effective capacity).
    await UPSERT.into(LEAVE).entries({
        leaveId: 'EMP1004-LV-DEMO', employee_employeeId: 'EMP1004', leaveType: 'Casual',
        fromDate: addDays(2), toDate: addDays(4), days: 3, reason: 'Demo leave',
        status: 'Approved'
    });
    console.log('✓ approved 3-day leave for EMP1004');

    console.log('\nDone. Restart the app and open Resource Planning.');
    process.exit(0);
})().catch(e => { console.error('Seed failed:', e); process.exit(1); });
