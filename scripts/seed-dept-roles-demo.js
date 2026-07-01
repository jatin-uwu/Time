// Demo data for dynamic department→role resource planning.
// Adds active employees with a Department + Designation (= job role), exactly
// matching the spec examples, so roles are retrieved dynamically (not hardcoded).
//   SAP dept:        John/Sarah = SAP Technical Consultant, Mike = SAP Functional Consultant
//   Engineering dept: Alex = Frontend Developer, David = Backend Developer
// Run with the app stopped:  node scripts/seed-dept-roles-demo.js
const cds = require('@sap/cds');
const N = 'ccentrik.employee.timesheet.schema.timesheet.';
const EMP = N + 'EmployeeMaster';

const DEMO = [
    { id: 'EMP9001', name: 'John Mathew',  department: 'SAP',         designation: 'SAP Technical Consultant' },
    { id: 'EMP9002', name: 'Mike Sharma',  department: 'SAP',         designation: 'SAP Functional Consultant' },
    { id: 'EMP9003', name: 'Sarah Khan',   department: 'SAP',         designation: 'SAP Technical Consultant' },
    { id: 'EMP9004', name: 'Ravi Menon',   department: 'SAP',         designation: 'SAP Basis Consultant' },
    { id: 'EMP9005', name: 'Alex Carter',  department: 'Engineering', designation: 'Frontend Developer' },
    { id: 'EMP9006', name: 'David Lee',    department: 'Engineering', designation: 'Backend Developer' },
    { id: 'EMP9007', name: 'Priya Nair',   department: 'Engineering', designation: 'QA Engineer' }
];

(async () => {
    await cds.connect.to('db');
    const { UPSERT, SELECT } = cds.ql;
    for (const e of DEMO) {
        await UPSERT.into(EMP).entries({
            employeeId: e.id, employeeName: e.name, department: e.department, designation: e.designation,
            role: 'employee', email: e.name.toLowerCase().replace(/\s+/g, '.') + '@ccentrik.com',
            isActive: 1, status: 'Active', monthlyCapacityHours: 160, employmentType: 'Permanent',
            joiningDate: '2026-01-01'
        });
    }
    const sap = await rolesIn('SAP'); const eng = await rolesIn('Engineering');
    console.log('✓ seeded', DEMO.length, 'employees');
    console.log('  SAP roles (dynamic):', sap);
    console.log('  Engineering roles (dynamic):', eng);
    process.exit(0);

    async function rolesIn(dept) {
        const rows = await SELECT.from(EMP).columns('designation').where({ department: dept, isActive: 1 });
        return [...new Set((rows || []).map(r => r.designation).filter(Boolean))].sort();
    }
})().catch(e => { console.error('seed failed:', e); process.exit(1); });
