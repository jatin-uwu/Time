const cds = require('@sap/cds');
const founderEvents = require('./founder-events');
const rp = require('./resource-planning');   // Resource Planning & Recommendation engine

// Mutating events that should ping the Founder Dashboard to re-fetch (covers the
// CRUD verbs plus the named actions that change org data). Read-only actions are
// intentionally excluded so a dashboard refresh never triggers another refresh.
const FOUNDER_MUTATING_EVENTS = new Set([
    'CREATE', 'UPDATE', 'DELETE',
    'saveTimesheetEntries', 'submitTimesheetWeek', 'updateTaskStatus', 'applyLeave', 'approveLeave',
    'submitPerformanceRating', 'addEmployee', 'setEmployeeStatus', 'updateEmployee', 'createGroupTask',
    'postGroupTaskUpdate', 'postTaskUpdate', 'approveTimesheet', 'rejectTimesheet', 'approvePrevWeekRequest',
    'approveDayUnlock', 'requestDayUnlock', 'requestPrevWeekFill', 'reportIssue', 'submitReview',
    'markAttendance', 'uploadTaskDocument'
]);
function emitFounderPing(data, req) {
    try { if (req && FOUNDER_MUTATING_EVENTS.has(req.event)) founderEvents.ping(req.event); } catch (e) { /* never break the request */ }
}

// ── Thought for the Day ─────────────────────────────────────────────────────
// A fresh daily motivational quote from ZenQuotes (free, no API key), cached in
// the database so every employee and every app instance sees the SAME quote for
// the day and the external API is hit only ONCE per day for the whole system.
//
// Flow (lazy, on first request of the day):
//   1. In-memory short-circuit (per instance) to skip the DB read on repeat loads.
//   2. Read today's row from ThoughtOfTheDay → if present, serve it.
//   3. Not present → fetch from ZenQuotes, DELETE the previous day's row, UPSERT
//      today's row (so the table only ever holds the current day), serve it.
//   4. External API down → serve whatever row exists (last good), else a static
//      fallback. The dashboard therefore never breaks on an outage.
const THOUGHT_TABLE = 'ccentrik.employee.timesheet.schema.timesheet.ThoughtOfTheDay';
const THOUGHT_FALLBACKS = [
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
    { quote: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
    { quote: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
    { quote: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
    { quote: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
    { quote: 'Well done is better than well said.', author: 'Benjamin Franklin' }
];
let _thoughtMem = { date: null, quote: null, author: null };

function _todayKey() { return new Date().toISOString().slice(0, 10); }
function _dayHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function _fetchExternalQuote() {
    if (typeof fetch !== 'function') return null;
    try {
        const res = await fetch('https://zenquotes.io/api/today', { method: 'GET' });
        if (res.ok) {
            const arr = await res.json();
            const q = Array.isArray(arr) ? arr[0] : null;
            if (q && q.q) return { quote: String(q.q).trim(), author: q.a ? String(q.a).trim() : 'Unknown' };
        }
    } catch (e) {
        cds.log('thought').warn('ZenQuotes fetch failed:', e.message || e);
    }
    return null;
}

async function loadThoughtOfTheDay() {
    const today = _todayKey();

    // 1. Per-instance in-memory short-circuit.
    if (_thoughtMem.date === today && _thoughtMem.quote) {
        return { date: today, quote: _thoughtMem.quote, author: _thoughtMem.author || '' };
    }

    // 2. Today's quote already cached in the DB (stored by whichever request/instance
    //    was first today) → serve it; no external call.
    let row = await SELECT.one.from(THOUGHT_TABLE).where({ quoteDate: today });
    if (row && row.quote) {
        _thoughtMem = { date: today, quote: row.quote, author: row.author };
        return { date: today, quote: row.quote, author: row.author || '' };
    }

    // 3. First request of the day → fetch fresh, keep only today's row.
    const fresh = await _fetchExternalQuote();
    if (fresh) {
        try {
            await DELETE.from(THOUGHT_TABLE).where('quoteDate <>', today);   // drop yesterday's
            await UPSERT.into(THOUGHT_TABLE).entries({ quoteDate: today, quote: fresh.quote, author: fresh.author });
        } catch (e) {
            cds.log('thought').warn('store thought failed:', e.message || e);   // serving still works
        }
        _thoughtMem = { date: today, quote: fresh.quote, author: fresh.author };
        return { date: today, quote: fresh.quote, author: fresh.author };
    }

    // 4. External API unavailable → last good row if any, else a static fallback.
    row = await SELECT.one.from(THOUGHT_TABLE);
    if (row && row.quote) return { date: today, quote: row.quote, author: row.author || '' };
    const f = THOUGHT_FALLBACKS[Math.abs(_dayHash(today)) % THOUGHT_FALLBACKS.length];
    return { date: today, quote: f.quote, author: f.author };
}

const HEADER = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetHeader';
const ENTRY = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetEntry';
const EMPLOYEE = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeMaster';
const LEAVE_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.LeaveRequest';
const TASK = 'ccentrik.employee.timesheet.schema.timesheet.TaskMaster';
const PERFORMANCE_RATING = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
const NOTIFICATION = 'ccentrik.employee.timesheet.schema.timesheet.Notification';
const ATTENDANCE = 'ccentrik.employee.timesheet.schema.timesheet.AttendanceRecord';
const TASK_REVIEW = 'ccentrik.employee.timesheet.schema.timesheet.TaskReview';
const HOLIDAY = 'ccentrik.employee.timesheet.schema.timesheet.HolidayMaster';
const TASK_ASSIGNEE = 'ccentrik.employee.timesheet.schema.timesheet.TaskAssignee';
const TASK_MESSAGE = 'ccentrik.employee.timesheet.schema.timesheet.TaskMessage';
const TASK_ATTACHMENT = 'ccentrik.employee.timesheet.schema.timesheet.TaskAttachment';
const TASK_UPDATE = 'ccentrik.employee.timesheet.schema.timesheet.TaskUpdate';
const TASK_DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.TaskDocument';
const PREV_WEEK_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetPrevWeekRequest';
const DAY_UNLOCK_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.TimesheetDayUnlockRequest';
// ── Project Management (Phase 1) entities ──────────────────────────────────────
const PROJECT = 'ccentrik.employee.timesheet.schema.timesheet.Project';
const PROJECT_TYPE = 'ccentrik.employee.timesheet.schema.timesheet.ProjectTypeMaster';

// Default project types (seeded once if the master is empty). Configurable
// thereafter — adding a type is data, not code.
const DEFAULT_PROJECT_TYPES = [
    { code: 'SAP_IMPL', name: 'SAP Implementation Project', planningModel: 'Phase', hasRevenue: true, sortOrder: 1,
      departments: ['SAP'],   // roles derived dynamically from employees in these depts
      resourceCategories: [],
      phases: ['Discover', 'Explore', 'Realize', 'Deploy', 'Hypercare'],
      modules: ['SAP MM', 'SAP SD', 'SAP FI', 'SAP CO', 'SAP PP', 'SAP SuccessFactors', 'SAP Ariba', 'SAP BTP'] },
    { code: 'SOFTWARE_DEV', name: 'Software Development Project', planningModel: 'Sprint', hasRevenue: true, sortOrder: 2,
      departments: ['Engineering'], resourceCategories: [], phases: [], modules: [] },
    { code: 'SUPPORT', name: 'Support & Maintenance Project', planningModel: 'MonthlyCapacity', hasRevenue: true, sortOrder: 3,
      departments: ['Support'], resourceCategories: [], phases: [], modules: [] },
    { code: 'INTERNAL', name: 'Internal Project', planningModel: 'CostTracking', hasRevenue: false, sortOrder: 4,
      departments: [], resourceCategories: [], phases: [], modules: [] },
    { code: 'OTHER', name: 'Other', planningModel: 'MonthlyCapacity', hasRevenue: true, sortOrder: 5,
      departments: [], resourceCategories: [], phases: [], modules: [] }
];
// 7 standard cost categories the Execution Budget is allocated across.
const COST_CATEGORIES = ['Resource Cost', 'Infrastructure Cost', 'Licensing Cost', 'Vendor Cost', 'Travel Cost', 'Training Cost', 'Miscellaneous Cost'];

// Seed/refresh project types + backfill existing projects to OTHER. Runs once per
// process (guarded). Refreshes the 5 default types' category/phase/module lists so
// existing installs pick up new categories; custom types are left untouched.
let _typesEnsured = false;
async function ensureProjectTypes() {
    if (_typesEnsured) return;
    try {
        for (const t of DEFAULT_PROJECT_TYPES) {
            const cfg = {
                name: t.name, planningModel: t.planningModel, hasRevenue: t.hasRevenue,
                resourceCategories: JSON.stringify(t.resourceCategories), phases: JSON.stringify(t.phases),
                modules: JSON.stringify(t.modules || []), departments: JSON.stringify(t.departments || [])
            };
            const row = await SELECT.one.from(PROJECT_TYPE).columns('code').where({ code: t.code });
            if (row) await UPDATE(PROJECT_TYPE).set(cfg).where({ code: t.code });
            else await INSERT.into(PROJECT_TYPE).entries({ code: t.code, ...cfg, sortOrder: t.sortOrder, isActive: true });
        }
        // Backfill any project missing a type → OTHER (back-compat, no data loss).
        await UPDATE(PROJECT).set({ projectType_code: 'OTHER', projectTypeName: 'Other' }).where({ projectType_code: null });
        _typesEnsured = true;
    } catch (e) { cds.log('project').warn('ensureProjectTypes skipped:', e.message || e); }
}
const PROJECT_RESOURCE = 'ccentrik.employee.timesheet.schema.timesheet.ProjectResource';
const RESOURCE_MONTHLY_ALLOCATION = 'ccentrik.employee.timesheet.schema.timesheet.ResourceMonthlyAllocation';
const RESOURCE_OVERRIDE = 'ccentrik.employee.timesheet.schema.timesheet.ResourceOverride';
const RP_CONFIG = 'ccentrik.employee.timesheet.schema.timesheet.ResourcePlanningConfig';
const COMPANY_EVENT = 'ccentrik.employee.timesheet.schema.timesheet.CompanyEvent';
const MILESTONE = 'ccentrik.employee.timesheet.schema.timesheet.Milestone';
const MILESTONE_DEP = 'ccentrik.employee.timesheet.schema.timesheet.MilestoneDependency';
const MILESTONE_APPROVAL = 'ccentrik.employee.timesheet.schema.timesheet.MilestoneApproval';
const MS_TERMINAL = ['Completed', 'Completed Early', 'Cancelled'];
// ── Resource master data (hierarchical) ──────────────────────────────────────
const DEPT_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.DepartmentMaster';
const ROLE_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.RoleCategoryMaster';
const SPEC_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.SpecializationMaster';
const SKILL_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.SkillMaster';
const CERT_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.CertificationMaster';
const EMP_SKILL = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeSkill';
const EMP_CERT = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeCertification';
const PROJ_REQ = 'ccentrik.employee.timesheet.schema.timesheet.ProjectResourceRequirement';

// Default hierarchical seed — SAP fully fleshed out per spec; other departments get
// a sensible starter set. Idempotent: only inserts rows that don't already exist, so
// admin edits and existing data are never overwritten. Department NAMES intentionally
// match the existing free-text values so both worlds stay consistent.
const DEFAULT_RESOURCE_MASTERS = [
    { deptId: 'SAP', name: 'SAP', roles: [
        { roleId: 'SAP-BASIS', name: 'Basis Consultant', specs: ['HANA Administration', 'System Upgrade', 'Migration', 'Security'] },
        { roleId: 'SAP-TECH',  name: 'Technical Consultant', specs: ['ABAP', 'Fiori', 'BTP', 'CPI', 'PI/PO'] },
        { roleId: 'SAP-FUNC',  name: 'Functional Consultant', specs: ['MM', 'SD', 'FICO', 'PP', 'QM', 'EWM'] },
        { roleId: 'SAP-SEC',   name: 'Security Consultant', specs: ['GRC', 'Authorizations'] }
    ] },
    { deptId: 'ENG', name: 'Engineering', roles: [
        { roleId: 'ENG-FE',  name: 'Frontend Engineer', specs: ['React', 'SAPUI5', 'Angular'] },
        { roleId: 'ENG-BE',  name: 'Backend Engineer', specs: ['Node.js', 'Java', 'Python'] },
        { roleId: 'ENG-QA',  name: 'QA Engineer', specs: ['Automation', 'Manual', 'Performance'] }
    ] }
];
const DEFAULT_SKILLS = ['Node.js', 'Java', 'Python', 'React', 'SAPUI5', 'HANA', 'ABAP', 'Fiori', 'BTP', 'CPI', 'MM', 'SD', 'FICO', 'PP', 'QM', 'EWM'];
const DEFAULT_CERTS = ['SAP Certified Application Associate', 'SAP Certified Technology Associate', 'AWS Solutions Architect', 'Azure Fundamentals', 'PMP', 'Scrum Master (CSM)'];

let _resourceMastersEnsured = false;
// Seeds the hierarchy + catalogs once per process. Also backfills DepartmentMaster
// from any existing free-text employee departments not already mastered, so the
// admin sees every real department. Purely additive — never deletes/overwrites.
async function ensureResourceMasters() {
    if (_resourceMastersEnsured) return;
    try {
        for (const d of DEFAULT_RESOURCE_MASTERS) {
            const exists = await SELECT.one.from(DEPT_MASTER).columns('deptId').where({ deptId: d.deptId });
            if (!exists) await INSERT.into(DEPT_MASTER).entries({ deptId: d.deptId, name: d.name, sortOrder: 0, isActive: true });
            for (let ri = 0; ri < d.roles.length; ri++) {
                const r = d.roles[ri];
                const rExists = await SELECT.one.from(ROLE_MASTER).columns('roleId').where({ roleId: r.roleId });
                if (!rExists) await INSERT.into(ROLE_MASTER).entries({ roleId: r.roleId, department_deptId: d.deptId, name: r.name, sortOrder: ri, isActive: true });
                for (let si = 0; si < r.specs.length; si++) {
                    const specId = `${r.roleId}-${r.specs[si].replace(/[^A-Za-z0-9]+/g, '').toUpperCase()}`;
                    const sExists = await SELECT.one.from(SPEC_MASTER).columns('specId').where({ specId });
                    if (!sExists) await INSERT.into(SPEC_MASTER).entries({ specId, roleCategory_roleId: r.roleId, name: r.specs[si], sortOrder: si, isActive: true });
                }
            }
        }
        // Backfill DepartmentMaster from existing free-text employee departments.
        const empDepts = await SELECT.from(EMPLOYEE).columns('department').where({ isActive: true });
        const seen = new Set();
        for (const e of (empDepts || [])) {
            const name = String(e.department || '').trim();
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const id = name.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 20) || ('DEP' + seen.size);
            const dExists = await SELECT.one.from(DEPT_MASTER).where('lower(name) =', name.toLowerCase());
            if (!dExists) await INSERT.into(DEPT_MASTER).entries({ deptId: id, name, sortOrder: 99, isActive: true });
        }
        for (const s of DEFAULT_SKILLS) {
            const id = s.replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
            const ex = await SELECT.one.from(SKILL_MASTER).columns('skillId').where({ skillId: id });
            if (!ex) await INSERT.into(SKILL_MASTER).entries({ skillId: id, name: s, isActive: true });
        }
        for (const cN of DEFAULT_CERTS) {
            const id = cN.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 40);
            const ex = await SELECT.one.from(CERT_MASTER).columns('certId').where({ certId: id });
            if (!ex) await INSERT.into(CERT_MASTER).entries({ certId: id, name: cN, isActive: true });
        }
        _resourceMastersEnsured = true;
    } catch (e) { cds.log('resource-master').warn('ensureResourceMasters skipped:', e.message || e); }
}

// Builds the full Department → Role → Specialization tree (+ skill/cert catalogs)
// for the cascading HR dropdowns and the hierarchical Manage-Resource grid.
async function buildResourceHierarchy() {
    await ensureResourceMasters();
    const [depts, roles, specs, skills, certs] = await Promise.all([
        SELECT.from(DEPT_MASTER).where({ isActive: true }).orderBy('sortOrder asc', 'name asc'),
        SELECT.from(ROLE_MASTER).where({ isActive: true }).orderBy('sortOrder asc', 'name asc'),
        SELECT.from(SPEC_MASTER).where({ isActive: true }).orderBy('sortOrder asc', 'name asc'),
        SELECT.from(SKILL_MASTER).where({ isActive: true }).orderBy('name asc'),
        SELECT.from(CERT_MASTER).where({ isActive: true }).orderBy('name asc')
    ]);
    const specsByRole = {}; specs.forEach(s => { (specsByRole[s.roleCategory_roleId] = specsByRole[s.roleCategory_roleId] || []).push({ specId: s.specId, name: s.name }); });
    const rolesByDept = {}; roles.forEach(r => { (rolesByDept[r.department_deptId] = rolesByDept[r.department_deptId] || []).push({ roleId: r.roleId, name: r.name, specializations: specsByRole[r.roleId] || [] }); });
    return {
        departments: depts.map(d => ({ deptId: d.deptId, name: d.name, roles: rolesByDept[d.deptId] || [] })),
        skills: skills.map(s => ({ skillId: s.skillId, name: s.name })),
        certifications: certs.map(c => ({ certId: c.certId, name: c.name }))
    };
}

// Builds the EmployeeMaster patch for the optional resource-profile fields. Only
// keys actually supplied are included, so partial updates never wipe data.
function resourceProfilePatch(d) {
    const p = {};
    if (d.roleCategoryId !== undefined) p.roleCategory_roleId = d.roleCategoryId || null;
    if (d.specializationId !== undefined) p.specialization_specId = d.specializationId || null;
    if (d.subSpecialization !== undefined) p.subSpecialization = d.subSpecialization || null;
    if (d.yearsOfExperience !== undefined && d.yearsOfExperience !== null && d.yearsOfExperience !== '') p.yearsOfExperience = Number(d.yearsOfExperience) || 0;
    if (d.skills !== undefined) p.skills = String(d.skills || '').trim() || null;
    if (d.certifications !== undefined) p.certifications = String(d.certifications || '').trim() || null;
    if (d.languages !== undefined) p.languages = String(d.languages || '').trim() || null;
    if (d.baseAvailabilityPct !== undefined && d.baseAvailabilityPct !== null && d.baseAvailabilityPct !== '') p.baseAvailabilityPct = Math.max(0, Math.min(100, parseInt(d.baseAvailabilityPct, 10) || 100));
    return p;
}

// HR enters annual CTC → derive monthly + hourly cost and store in the salary
// master (single active row per employee). The Manage-Resources estimate uses
// this hourly cost; PMs never see the salary itself.
async function upsertSalaryFromCtc(employeeId, employeeName, ctc, capacityHours) {
    const annual = Number(ctc) || 0;
    if (!(annual > 0)) return;
    const cap = Number(capacityHours) > 0 ? Number(capacityHours) : 160;
    const monthly = Math.round((annual / 12) * 100) / 100;
    const hourly = Math.round((monthly / cap) * 100) / 100;
    await UPSERT.into(SALARY_MASTER).entries({
        salaryId: `${employeeId}-CTC`, employee_employeeId: employeeId, employeeName: employeeName || '',
        annualSalary: annual, monthlySalary: monthly, hourlyCost: hourly,
        effectiveFrom: new Date().toISOString().slice(0, 10), isActive: true
    });
}

// Re-syncs the normalized EmployeeSkill / EmployeeCertification link rows from the
// comma caches (matching catalog names → master ids). Non-fatal: the comma caches
// on EmployeeMaster remain the source of truth for the recommendation engine.
async function syncEmployeeLinks(empId, skillsCsv, certsCsv) {
    try {
        if (skillsCsv !== undefined) {
            await DELETE.from(EMP_SKILL).where({ employee_employeeId: empId });
            for (const n of String(skillsCsv || '').split(',').map(s => s.trim()).filter(Boolean)) {
                const sm = await SELECT.one.from(SKILL_MASTER).columns('skillId').where('lower(name) =', n.toLowerCase());
                await INSERT.into(EMP_SKILL).entries({ id: `${empId}-${sm ? sm.skillId : n.replace(/[^A-Za-z0-9]+/g, '').toUpperCase()}`.slice(0, 55), employee_employeeId: empId, skill_skillId: sm ? sm.skillId : null, skillName: n });
            }
        }
        if (certsCsv !== undefined) {
            await DELETE.from(EMP_CERT).where({ employee_employeeId: empId });
            for (const n of String(certsCsv || '').split(',').map(s => s.trim()).filter(Boolean)) {
                const cm = await SELECT.one.from(CERT_MASTER).columns('certId').where('lower(name) =', n.toLowerCase());
                await INSERT.into(EMP_CERT).entries({ id: `${empId}-${cm ? cm.certId : n.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 40)}`.slice(0, 55), employee_employeeId: empId, certification_certId: cm ? cm.certId : null, certName: n });
            }
        }
    } catch (e) { cds.log('resource-master').warn('syncEmployeeLinks skipped:', e.message || e); }
}

// Refresh the employee's denormalized `certifications` comma cache from the
// structured EmployeeCertification rows (keeps the recommendation/display consistent).
async function refreshCertCache(employeeId) {
    const rows = await SELECT.from(EMP_CERT).columns('certName').where({ employee_employeeId: employeeId });
    const names = [...new Set((rows || []).map(r => r.certName).filter(Boolean))];
    await UPDATE(EMPLOYEE).set({ certifications: names.join(', ') || null }).where({ employeeId });
}

// ── Talent Taxonomy (dynamic, LinkedIn-style) ────────────────────────────────
// Normalize: trim → collapse internal whitespace → UPPERCASE. This is the dedup
// key (NormalizedName) and the case-insensitive existence check.
function normalizeTaxonomy(s) { return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase(); }

// Per-type config: entity, key column, optional parent scope column. Skills and
// certifications are global; roles are scoped per department; modules per role.
const TAXONOMY = {
    role:          { entity: ROLE_MASTER, key: 'roleId',  prefix: 'R',  scope: 'department_deptId',    nameLen: 100 },
    module:        { entity: SPEC_MASTER, key: 'specId',  prefix: 'M',  scope: 'roleCategory_roleId',  nameLen: 100 },
    skill:         { entity: SKILL_MASTER, key: 'skillId', prefix: 'S', scope: null,                   nameLen: 100 },
    certification: { entity: CERT_MASTER, key: 'certId',  prefix: 'C',  scope: null,                   nameLen: 150 }
};
function taxonomyId(prefix, norm) {
    return `${prefix}-${norm.replace(/[^A-Z0-9]+/g, '').slice(0, 16)}-${Math.random().toString(36).slice(2, 7)}`;
}
// Search: partial, case-insensitive on normalizedName, ordered usageCount DESC,
// then name ASC. Optional parent scope (department for roles, role for modules).
async function searchTaxonomy(type, q, scopeVal) {
    const cfg = TAXONOMY[type]; if (!cfg) return { error: 'Unknown taxonomy type.' };
    await ensureResourceMasters();
    const norm = normalizeTaxonomy(q);
    const where = { isActive: true };
    if (cfg.scope && scopeVal) where[cfg.scope] = scopeVal;
    let rows = await SELECT.from(cfg.entity).where(where).orderBy('usageCount desc', 'name asc').limit(50);
    if (norm) rows = rows.filter(r => normalizeTaxonomy(r.name).includes(norm));
    const suggestions = rows.slice(0, 25).map(r => ({ id: r[cfg.key], name: r.name, normalizedName: r.normalizedName || normalizeTaxonomy(r.name), usageCount: r.usageCount || 0 }));
    const exactMatch = suggestions.some(s => s.normalizedName === norm);
    return { type, q, suggestions, exactMatch, normalized: norm };
}
// Upsert + usage increment. Normalizes, does a scoped case-insensitive existence
// check, returns the existing record (no duplicate) or creates a new UPPERCASE one.
// Every call increments usageCount (a value was selected/created).
async function upsertTaxonomy(type, name, scopeVal, extra) {
    const cfg = TAXONOMY[type]; if (!cfg) return { error: 'Unknown taxonomy type.' };
    await ensureResourceMasters();
    const norm = normalizeTaxonomy(name);
    if (!norm) return { error: 'Value is required.' };
    if (cfg.scope && !scopeVal) return { error: type === 'role' ? 'Select a department first.' : 'Select a role category first.' };
    const where = { normalizedName: norm };
    if (cfg.scope && scopeVal) where[cfg.scope] = scopeVal;
    let existing = await SELECT.one.from(cfg.entity).where(where);
    // Fallback: older rows may have null normalizedName → match by UPPER(name).
    if (!existing) {
        const scopeWhere = (cfg.scope && scopeVal) ? { [cfg.scope]: scopeVal } : {};
        const all = await SELECT.from(cfg.entity).where(scopeWhere);
        existing = all.find(r => normalizeTaxonomy(r.name) === norm);
    }
    if (existing) {
        await UPDATE(cfg.entity).set({ usageCount: (Number(existing.usageCount) || 0) + 1, normalizedName: norm }).where({ [cfg.key]: existing[cfg.key] });
        return { id: existing[cfg.key], name: existing.name, created: false };
    }
    const id = taxonomyId(cfg.prefix, norm);
    const row = { [cfg.key]: id, name: norm.slice(0, cfg.nameLen), normalizedName: norm, usageCount: 1, isActive: true };
    if (cfg.scope && scopeVal) row[cfg.scope] = scopeVal;                 // department/role parent
    if (type === 'module' && extra && extra.departmentId) { /* module inherits role's dept implicitly */ }
    await INSERT.into(cfg.entity).entries(row);
    return { id, name: row.name, created: true };
}

// Effective milestone status + schedule metrics (computed; stored status stays
// authoritative for Completed/Cancelled/Blocked). today is an ISO yyyy-mm-dd.
function milestoneStatus(m, progressPct, todayStr) {
    const stored = m.status || 'Not Started';
    if (stored === 'Cancelled' || stored === 'Blocked') return stored;
    if (stored === 'Completed' || stored === 'Completed Early') {
        return (m.actualEndDate && m.plannedEndDate && String(m.actualEndDate) < String(m.plannedEndDate)) ? 'Completed Early' : 'Completed';
    }
    const pEnd = m.plannedEndDate ? String(m.plannedEndDate).slice(0, 10) : null;
    const pStart = m.plannedStartDate ? String(m.plannedStartDate).slice(0, 10) : null;
    if (pEnd && todayStr > pEnd) return 'Delayed';
    const started = !!m.actualStartDate || (progressPct || 0) > 0 || stored === 'In Progress';
    if (started && pStart && pEnd && pEnd > pStart) {
        const total = (new Date(pEnd) - new Date(pStart)) || 1;
        const elapsedPct = Math.max(0, Math.min(100, Math.round((new Date(todayStr) - new Date(pStart)) / total * 100)));
        if (elapsedPct > (progressPct || 0) + 20) return 'At Risk';
        return 'In Progress';
    }
    if (started) return 'In Progress';
    if (pStart && todayStr >= pStart) return 'Planned';
    return 'Not Started';
}
const daysBetween = (aStr, bStr) => Math.round((new Date(aStr) - new Date(bStr)) / 86400000);
const PROJECT_TASK = 'ccentrik.employee.timesheet.schema.timesheet.ProjectTask';
const PROJECT_AUDIT = 'ccentrik.employee.timesheet.schema.timesheet.ProjectAuditLog';
const SALARY_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeSalaryMaster';
const PROJECT_ISSUE = 'ccentrik.employee.timesheet.schema.timesheet.ProjectIssue';
// ── Meeting entities (Microsoft Teams integration) ─────────────────────────────
const MEETING = 'ccentrik.employee.timesheet.schema.timesheet.Meeting';
const MEETING_PARTICIPANT = 'ccentrik.employee.timesheet.schema.timesheet.MeetingParticipant';
// ── Project chat entities ──────────────────────────────────────────────────────
const PROJECT_MESSAGE = 'ccentrik.employee.timesheet.schema.timesheet.ProjectMessage';
const PROJECT_ATTACHMENT = 'ccentrik.employee.timesheet.schema.timesheet.ProjectAttachment';
// ── Client portal & requirement entities ────────────────────────────────────────
const PROJECT_BUDGET = 'ccentrik.employee.timesheet.schema.timesheet.ProjectBudget';
const PROJECT_BUDGET_REQUEST = 'ccentrik.employee.timesheet.schema.timesheet.ProjectBudgetRequest';
const CLIENT_MASTER = 'ccentrik.employee.timesheet.schema.timesheet.ClientMaster';
const CLIENT_STATUS_HISTORY = 'ccentrik.employee.timesheet.schema.timesheet.ClientStatusHistory';
const REQUIREMENT = 'ccentrik.employee.timesheet.schema.timesheet.Requirement';
const REQUIREMENT_ATTACHMENT = 'ccentrik.employee.timesheet.schema.timesheet.RequirementAttachment';
const REQUIREMENT_COMMENT = 'ccentrik.employee.timesheet.schema.timesheet.RequirementComment';
const REQUIREMENT_AUDIT = 'ccentrik.employee.timesheet.schema.timesheet.RequirementAudit';
// Requirement status workflow (ordered).
const REQ_STATUSES = ['New', 'Assigned', 'Under Analysis', 'In Development', 'Under Testing', 'Awaiting Client Review', 'Approved', 'Rejected', 'Closed'];
// Project statuses that consume an employee's FTE bandwidth (Completed/Cancelled free it).
const ACTIVE_PROJECT_STATUSES = ['Planning', 'Active', 'On Hold'];
const VALID_BANDWIDTH = new Set([25, 50, 75, 100]);


const PRIORITY_PREFIX = {
    'High': '[HIGH PRIORITY]',
    'Medium': '[Medium Priority]',
    'Low': '[Low Priority]'
};

const {
    registerTimesheetHandlers,
    registerManagerTimesheetHandlers,
    registerHRTimesheetHandlers
} = require('./timesheet-handler');

const { startReminderCron } = require('./reminder-cron');

let _mailer = null;
function getMailer() {
    if (_mailer !== null) return _mailer;
    try {
        const nodemailer = require('nodemailer');
        const host = process.env.SMTP_HOST;
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!host || !user || !pass) { _mailer = false; return _mailer; }
        _mailer = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    } catch (e) { _mailer = false; }
    return _mailer;
}

async function createNotification(employeeId, type, title, message, referenceId) {
    try {
        const notificationId = `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        await INSERT.into(NOTIFICATION).entries({
            notificationId,
            employee_employeeId: employeeId,
            type, title, message,
            isRead: false,
            referenceId: referenceId || '',
            notifiedAt: new Date()
        });
    } catch (e) {
        cds.log('notif').warn('Could not create notification:', e.message || e);
    }
}

// ── Group-task shared helpers ────────────────────────────────────────────────

// Resolve the caller's EmployeeMaster row (by JWT email). Returns null if none.
async function resolveCaller(req) {
    const user = req.user || {};
    const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
    const uid = user.id || '';
    let emp = null;
    if (email) emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where('lower(email) =', email);
    return { email, uid, emp, employeeId: emp && emp.employeeId };
}

// ── Founder access-control helper ────────────────────────────────────────────
// A Founder may only view / manage employees who report DIRECTLY to them, i.e.
// EmployeeMaster.manager_employeeId === <the founder's own employeeId>. This is
// the single source of truth reused by every founder employee-selection action
// (assign task, submit rating, any future picker) so the same rule is enforced
// at the data layer — never relying on the UI to hide rows.
//
// Returns { founderId, ids:Set<employeeId>, employees:[…] }. ids is empty when
// the founder has no direct reports.
async function founderDirectReports(req) {
    const caller = await resolveCaller(req);
    const founderId = caller.employeeId || null;
    if (!founderId) return { founderId: null, ids: new Set(), employees: [] };
    const rows = await SELECT.from(EMPLOYEE)
        .columns('employeeId', 'employeeName', 'department', 'designation')
        .where({ manager_employeeId: founderId, isActive: true })
        .orderBy('employeeName');
    return {
        founderId,
        ids: new Set((rows || []).map(r => r.employeeId)),
        employees: rows || []
    };
}

// Load a group task plus its assignee rows and decide whether the caller is a
// member (an assignee OR the manager who created it). Solo tasks return null.
async function loadGroupContext(taskId, caller) {
    const task = await SELECT.one.from(TASK).where({ taskId });
    if (!task || task.taskType !== 'group') return { task: null };
    const rows = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: taskId });
    const mine = rows.find(r => r.assignee_employeeId === caller.employeeId) || null;
    const isCreator = !!(task.createdBy && (task.createdBy === caller.email || task.createdBy === caller.uid));
    return { task, rows, mine, isCreator, isMember: !!mine || isCreator };
}

// All recipients of a group task (every assignee + the creator), as employeeIds.
async function groupRecipientIds(task, rows) {
    const ids = new Set(rows.map(r => r.assignee_employeeId).filter(Boolean));
    if (task.createdBy) {
        const creator = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email: task.createdBy });
        if (creator && creator.employeeId) ids.add(creator.employeeId);
    }
    return ids;
}

// Coalesced chat notification: one unread row per (recipient, task). While it
// stays unread, new messages bump a counter instead of creating new rows.
async function notifyGroupChat(taskId, taskName, senderId, recipientIds) {
    for (const rid of recipientIds) {
        if (!rid || rid === senderId) continue;
        try {
            const existing = await SELECT.one.from(NOTIFICATION).where({
                employee_employeeId: rid, referenceId: taskId,
                type: 'GROUP_CHAT_MESSAGE', isRead: false
            });
            if (existing) {
                const c = (existing.msgCount || 1) + 1;
                await UPDATE(NOTIFICATION).set({
                    msgCount: c,
                    message: `${c} new messages in group task chat “${taskName}”`,
                    notifiedAt: new Date()
                }).where({ notificationId: existing.notificationId });
            } else {
                await INSERT.into(NOTIFICATION).entries({
                    notificationId: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
                    employee_employeeId: rid,
                    type: 'GROUP_CHAT_MESSAGE',
                    title: 'New chat message',
                    message: `1 new message in group task chat “${taskName}”`,
                    isRead: false,
                    referenceId: taskId,
                    notifiedAt: new Date(),
                    msgCount: 1
                });
            }
        } catch (e) { cds.log('notif').warn('chat notify failed:', e.message || e); }
    }
}

// Mark the caller's coalesced chat notification for a task as read (resets it).
async function markChatRead(taskId, employeeId) {
    if (!employeeId) return;
    try {
        await UPDATE(NOTIFICATION)
            .set({ isRead: true })
            .where({ employee_employeeId: employeeId, referenceId: taskId, type: 'GROUP_CHAT_MESSAGE', isRead: false });
    } catch (e) { /* best-effort */ }
}

// Coalesced project chat notification: one unread row per (recipient, project).
async function notifyProjectChat(projectId, projectName, senderId, recipientIds) {
    for (const rid of recipientIds) {
        if (!rid || rid === senderId) continue;
        try {
            const existing = await SELECT.one.from(NOTIFICATION).where({
                employee_employeeId: rid, referenceId: projectId,
                type: 'PROJECT_CHAT_MESSAGE', isRead: false
            });
            if (existing) {
                const c = (existing.msgCount || 1) + 1;
                await UPDATE(NOTIFICATION).set({
                    msgCount: c,
                    message: `${c} new messages in project chat "${projectName}"`,
                    notifiedAt: new Date()
                }).where({ notificationId: existing.notificationId });
            } else {
                await INSERT.into(NOTIFICATION).entries({
                    notificationId: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
                    employee_employeeId: rid,
                    type: 'PROJECT_CHAT_MESSAGE',
                    title: 'New project chat message',
                    message: `1 new message in project chat "${projectName}"`,
                    isRead: false,
                    referenceId: projectId,
                    notifiedAt: new Date(),
                    msgCount: 1
                });
            }
        } catch (e) { cds.log('notif').warn('project chat notify failed:', e.message || e); }
    }
}

async function markProjectChatReadFn(projectId, employeeId) {
    if (!employeeId) return;
    try {
        await UPDATE(NOTIFICATION)
            .set({ isRead: true })
            .where({ employee_employeeId: employeeId, referenceId: projectId, type: 'PROJECT_CHAT_MESSAGE', isRead: false });
    } catch (e) { /* best-effort */ }
}

// Read a LargeBinary column into a base64 string (handles Buffer / stream).
async function binaryToBase64(content) {
    if (!content) return '';
    if (Buffer.isBuffer(content)) return content.toString('base64');
    if (content instanceof Uint8Array) return Buffer.from(content).toString('base64');
    if (typeof content === 'string') return content;
    if (typeof content.pipe === 'function') {
        const chunks = [];
        for await (const chunk of content) chunks.push(chunk);
        return Buffer.concat(chunks).toString('base64');
    }
    return Buffer.from(content).toString('base64');
}

// Next free TASKnnn id (group tasks share the TaskMaster id space with solo).
async function nextGroupTaskId() {
    const rows = await SELECT.from(TASK).columns('taskId');
    let max = 0;
    rows.forEach(r => { const m = /^TASK(\d+)$/i.exec(r.taskId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'TASK' + String(max + 1).padStart(3, '0');
}

// An employee's group tasks, each surfaced with THAT employee's own progress as
// the status (pending→Not Started, in_progress→In Progress, ended→Completed) so
// dashboard counters (My Tasks / Task Summary) reflect their personal view.
async function myGroupTasks(employeeId) {
    if (!employeeId) return [];
    const rows = await SELECT.from(TASK_ASSIGNEE).where({ assignee_employeeId: employeeId });
    if (!rows.length) return [];
    const byTask = {}; rows.forEach(r => { byTask[r.task_taskId] = r; });
    const ids = Object.keys(byTask);
    const tasks = await SELECT.from(TASK).where({ taskId: { in: ids }, taskType: 'group' });
    const map = { pending: 'Not Started', in_progress: 'In Progress', ended: 'Completed' };
    return (tasks || []).map(t => Object.assign({}, t, {
        status: map[(byTask[t.taskId] || {}).status] || 'Not Started'
    }));
}

// Can the caller see a task's documents/updates? True for the assignee, the
// reviewer, any group member, or a manager. Used to gate task-document and
// update-attachment downloads (works for both solo and group tasks).
async function canAccessTask(req, taskId) {
    const caller = await resolveCaller(req);
    if (!caller.employeeId || !taskId) return { ok: false, caller, task: null };
    const task = await SELECT.one.from(TASK)
        .columns('taskId', 'taskType', 'status', 'assignedTo_employeeId', 'reviewer_employeeId')
        .where({ taskId });
    if (!task) return { ok: false, caller, task: null };
    const isManager = !!(req.user && req.user.is && req.user.is('Manager'));
    if (isManager) return { ok: true, caller, task };
    if (task.assignedTo_employeeId === caller.employeeId) return { ok: true, caller, task };
    if (task.reviewer_employeeId === caller.employeeId) return { ok: true, caller, task };
    if (task.taskType === 'group') {
        const ctx = await loadGroupContext(taskId, caller);
        if (ctx.isMember) return { ok: true, caller, task };
    }
    return { ok: false, caller, task };
}

// Maps a notification type to the sidebar menu route whose badge it should
// drive. DAY_UNLOCK_REQUEST is role-dependent (HR vs the reporting manager).
// Returns null for types with no dedicated badge — including group-task types,
// which already have their own "Group Tasks" counter.
function routeForNotif(type, isHR) {
    switch (type) {
        case 'GROUP_CHAT_MESSAGE':
        case 'GROUP_TASK_ASSIGNED':
        case 'GROUP_TASK_UPDATE':
        case 'GROUP_TASK_COMPLETED':   return 'group-tasks';
        case 'TASK_ASSIGNED':
        case 'TASK_REVIEW_REQUESTED':  return 'task-description';
        case 'TIMESHEET_SUBMITTED':
        case 'PREVWEEK_REQUEST':
        case 'LEAVE_REQUEST':          return 'manager';
        case 'DAY_UNLOCK_REQUEST':     return isHR ? 'hr-approvals' : 'manager';
        case 'TIMESHEET_APPROVED':
        case 'TIMESHEET_REJECTED':     return 'history';
        case 'PREVWEEK_APPROVED':
        case 'PREVWEEK_REJECTED':
        case 'DAY_UNLOCK_APPROVED':
        case 'DAY_UNLOCK_REJECTED':    return 'timesheet';
        case 'LEAVE_APPROVED':
        case 'LEAVE_REJECTED':         return 'leave-history';
        case 'PERFORMANCE_RATED':      return 'rating-history';
        default:                       return null;
    }
}

// Block any request from a deactivated account. getCurrentUser is allowed
// through so the UI can resolve identity, detect inactivity, and show the
// "account is inactive" message; every other operation is denied server-side.
async function blockIfInactive(req) {
    if (req.event === 'getCurrentUser') return;
    const user = req.user || {};
    const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
    if (!email) return;
    const emp = await SELECT.one.from(EMPLOYEE).columns('isActive').where('lower(email) =', email);
    if (!emp) {
        return req.reject(403, 'Access denied: your email is not registered in Employee Master.');
    }
    if (emp.isActive === false) {
        return req.reject(403, 'Your account is inactive. Please contact the administrator.');
    }
}

// Resolve the caller's email from the JWT (email/mail attribute, falling back to
// the technical user id). Centralised so every guard resolves identity the same
// way.
function callerEmail(user) {
    user = user || {};
    return (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
}

// Does the JWT carry the XSUAA scope that corresponds to this application role?
function hasScopeFor(user, role) {
    if (!user || !user.is) return false;
    switch (role) {
        case 'founder':  return user.is('Founder');
        case 'hr':       return user.is('HR');
        case 'manager':  return user.is('Manager');
        case 'employee': return user.is('Employee');
        case 'client':   return user.is('Client');
        default:         return false;
    }
}

// ── Two-factor authorization guard ──────────────────────────────────────────
// Returns a before-handler that grants access ONLY when BOTH are true:
//   (1) the JWT/XSUAA scope for `requiredRole` is present, AND
//   (2) the caller's authoritative role in EmployeeMaster.role === requiredRole.
// This closes the privilege-escalation gap where assigning an extra XSUAA role
// collection (e.g. Manager) to a user whose master role is HR would otherwise
// grant Manager access. The master table is the source of truth; XSUAA is a
// necessary-but-not-sufficient first factor.
// The caller's EFFECTIVE role = the authoritative EmployeeMaster.role, but only
// when the JWT also carries the matching XSUAA scope. A user whose master role
// is elevated but who lacks the scope (or vice-versa) is downgraded to the base
// 'employee' role when they at least hold the Employee scope, else 'unknown'.
// Used to drive UI routing so the frontend never sends a user to a dashboard the
// backend will deny.
function effectiveRole(user, emp) {
    const dbRole = (emp && emp.role || '').trim().toLowerCase();
    if (dbRole && hasScopeFor(user, dbRole)) return dbRole;
    if (user && user.is && user.is('Employee')) return 'employee';
    return 'unknown';
}

// The canonical application roles stored in EmployeeMaster.role. Authorization
// compares against these exact lowercase values, so anything written to the
// column must be normalised to one of them — 'HR' vs 'hr' must never diverge.
const VALID_ROLES = ['employee', 'manager', 'hr', 'founder'];
function normalizeRole(value) {
    const r = (value == null ? '' : String(value)).trim().toLowerCase();
    return VALID_ROLES.includes(r) ? r : null;
}

function requireMatchingRole(requiredRole) {
    return async function (req) {
        const user = req.user || {};
        const email = callerEmail(user);
        if (!email) return req.reject(403, 'Access denied: unable to resolve your identity.');

        const emp = await SELECT.one.from(EMPLOYEE).columns('role', 'isActive').where('lower(email) =', email);
        if (!emp) return req.reject(403, 'Access denied: no employee record is linked to your account.');
        if (emp.isActive === false) return req.reject(403, 'Your account is inactive. Please contact the administrator.');

        const dbRole = (emp.role || '').trim().toLowerCase();

        // Factor 1 — XSUAA scope (also enforced by @requires, re-checked defensively).
        if (!hasScopeFor(user, requiredRole)) {
            return req.reject(403, 'Access denied: missing the required authorization scope.');
        }
        // Factor 2 — authoritative role from EmployeeMaster must match exactly.
        if (dbRole !== requiredRole) {
            cds.log('auth').warn(
                `Blocked role mismatch for ${email}: JWT carries '${requiredRole}' scope but EmployeeMaster.role='${dbRole || 'none'}'.`
            );
            return req.reject(403, 'Access denied: your assigned role does not permit this operation.');
        }
    };
}

class EmployeeService extends cds.ApplicationService {
    async init() {

        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        this.on('getUserRole', async (req) => {
            const user = req.user || {};
            const email = callerEmail(user);
            const emp = email
                ? await SELECT.one.from(EMPLOYEE).columns('role').where('lower(email) =', email)
                : null;
            // Effective role cross-checks the master table against the JWT scope,
            // so an XSUAA-only role assignment can no longer report elevated access.
            return { role: effectiveRole(user, emp) };
        });

        this.on('getCurrentUser', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();

            let emp = null;
            if (email) {
                emp = await SELECT.one.from(EMPLOYEE).where('lower(email) =', email);
            }

            // ── Client identity path ──────────────────────────────────────────
            // If the login is not an employee but matches an active ClientMaster
            // row AND carries the Client XSUAA scope, sign in as a client. Clients
            // live entirely outside EmployeeMaster.
            if (!emp && email) {
                const client = await SELECT.one.from(CLIENT_MASTER).where('lower(email) =', email);
                if (client) {
                    let denied = null;
                    if (String(client.status || '').toLowerCase() === 'inactive') denied = 'inactive';
                    else if (!hasScopeFor(user, 'client')) denied = 'role-mismatch';
                    // Best-effort lastLogin stamp.
                    if (!denied) { try { await UPDATE(CLIENT_MASTER).set({ lastLogin: new Date() }).where({ clientId: client.clientId }); } catch (e) { /* */ } }
                    return {
                        email: client.email || email,
                        role: denied ? 'unknown' : 'client',
                        accessDenied: denied,
                        employeeId: '',
                        employeeName: client.contactPerson || client.clientName || 'Client',
                        designation: client.companyName || '',
                        address: '', mobileNumber: client.phoneNumber || '', managerId: '',
                        isActive: true,
                        clientId: client.clientId,
                        clientName: client.clientName || ''
                    };
                }
            }

            // ── Login gate ────────────────────────────────────────────────────
            // A user may sign in only when ALL of the following hold:
            //   (1) the email exists in EmployeeMaster,
            //   (2) the account is active, and
            //   (3) the master role is backed by the matching XSUAA/JWT scope.
            // Otherwise we return accessDenied + a reason so the UI can show an
            // error and sign the user out. (getCurrentUser itself stays reachable
            // so the UI can render that message; every other service is blocked
            // server-side by blockIfInactive / requireMatchingRole.)
            const dbRole = (emp && emp.role || '').trim().toLowerCase();
            let accessDenied = null;
            if (!emp)                          accessDenied = 'not-registered';
            else if (emp.isActive === false)   accessDenied = 'inactive';
            else if (!hasScopeFor(user, dbRole)) accessDenied = 'role-mismatch';

            // Only report an elevated role when the login is valid; otherwise
            // 'unknown' so nothing in the UI treats the session as privileged.
            const role = accessDenied ? 'unknown' : dbRole;

            if (!emp) {
                return {
                    email, role, accessDenied, employeeId: '',
                    employeeName: (user.attr && user.attr.given_name) || (email && email.split('@')[0]) || 'User',
                    designation: '', address: '', mobileNumber: '', managerId: '', isActive: true
                };
            }

            return {
                email: emp.email || email, role, accessDenied,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName || '',
                designation: emp.designation || '',
                address: emp.address || '',
                mobileNumber: emp.mobileNumber || '',
                managerId: emp.manager_employeeId || '',
                isActive: emp.isActive !== false
            };
        });

        // ── Thought for the Day (fresh daily quote from ZenQuotes, cached/day) ─
        this.on('getThoughtOfTheDay', async () => {
            return JSON.stringify(await loadThoughtOfTheDay());
        });

        // ── Company Newsletter (latest, visible to everyone) ──────────────────
        // Reuses the EmployeeDocument store: HR publishes via uploadEmployeeDocument
        // with documentType = 'Newsletter'; this returns the most recent one so any
        // authenticated user can open it from the dashboard.
        this.on('getLatestNewsletter', async () => {
            const empty = { hasNewsletter: false, newsletterId: '', fileName: '', mimeType: '', dataBase64: '', uploadedOn: '' };
            let doc;
            try {
                doc = await SELECT.one.from(DOCUMENT)
                    .columns('documentId', 'fileName', 'mimeType', 'content', 'createdAt')
                    .where({ documentType: 'Newsletter' })
                    .orderBy('createdAt desc');
            } catch (e) {
                cds.log('newsletter').warn('Could not query newsletter:', e.message || e);
                return empty;
            }
            if (!doc || !doc.content) return empty;

            let dataBase64 = '';
            try {
                const content = doc.content;
                if (Buffer.isBuffer(content)) dataBase64 = content.toString('base64');
                else if (content instanceof Uint8Array) dataBase64 = Buffer.from(content).toString('base64');
                else if (typeof content === 'string') dataBase64 = content;
                else if (content && typeof content.pipe === 'function') {
                    const chunks = [];
                    for await (const chunk of content) chunks.push(chunk);
                    dataBase64 = Buffer.concat(chunks).toString('base64');
                } else {
                    dataBase64 = Buffer.from(content).toString('base64');
                }
            } catch (e) {
                cds.log('newsletter').error('Could not read newsletter content:', e.message);
                return empty;
            }
            if (!dataBase64) return empty;

            return {
                hasNewsletter: true,
                newsletterId:  doc.documentId,
                fileName:      doc.fileName || 'newsletter',
                mimeType:      doc.mimeType || 'application/octet-stream',
                dataBase64,
                uploadedOn:    doc.createdAt ? String(doc.createdAt) : ''
            };
        });

        // Lightweight check (no binary) used to drive the "new newsletter" button.
        this.on('getNewsletterMeta', async () => {
            const empty = { hasNewsletter: false, newsletterId: '', fileName: '', uploadedOn: '' };
            let doc;
            try {
                doc = await SELECT.one.from(DOCUMENT)
                    .columns('documentId', 'fileName', 'createdAt')
                    .where({ documentType: 'Newsletter' })
                    .orderBy('createdAt desc');
            } catch (e) {
                cds.log('newsletter').warn('Could not query newsletter meta:', e.message || e);
                return empty;
            }
            if (!doc) return empty;
            return {
                hasNewsletter: true,
                newsletterId:  doc.documentId,
                fileName:      doc.fileName || 'newsletter',
                uploadedOn:    doc.createdAt ? String(doc.createdAt) : ''
            };
        });

        // ════════════════════════════════════════════════════════════════════
        //  GROUP TASKS  —  read + interaction (all scoped to the caller)
        // ════════════════════════════════════════════════════════════════════

        // List of group tasks visible to the caller: managers see the ones they
        // created; employees see the ones they're assigned to.
        this.on('getGroupTasks', async (req) => {
            const caller = await resolveCaller(req);
            const isManager = req.user && req.user.is && req.user.is('Manager');

            const tasks = await SELECT.from(TASK).where({ taskType: 'group' });
            if (!tasks.length) return JSON.stringify([]);
            const taskIds = tasks.map(t => t.taskId);
            const assignees = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: { in: taskIds } });

            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName');
            const nameMap = {}; emps.forEach(e => nameMap[e.employeeId] = e.employeeName);

            const visible = tasks.filter(t => {
                const isCreator = t.createdBy && (t.createdBy === caller.email || t.createdBy === caller.uid);
                if (isManager && isCreator) return true;
                return assignees.some(a => a.task_taskId === t.taskId && a.assignee_employeeId === caller.employeeId);
            });

            const out = visible.map(t => {
                const rows = assignees.filter(a => a.task_taskId === t.taskId);
                const ended = rows.filter(a => a.status === 'ended').length;
                return {
                    taskId: t.taskId, taskName: t.taskName, taskDescription: t.taskDescription,
                    priority: t.priority, status: t.status, dueDate: t.dueDate, completedAt: t.completedAt,
                    total: rows.length, ended,
                    assignees: rows.map(a => ({
                        employeeId: a.assignee_employeeId,
                        employeeName: nameMap[a.assignee_employeeId] || a.assignee_employeeId,
                        status: a.status, endedAt: a.endedAt
                    }))
                };
            });
            // Per-task unread chat flag (drives the red dot on the chat icon).
            try {
                const unread = await SELECT.from(NOTIFICATION).columns('referenceId').where({
                    employee_employeeId: caller.employeeId, type: 'GROUP_CHAT_MESSAGE', isRead: false
                });
                const unreadSet = new Set(unread.map(u => u.referenceId));
                out.forEach(t => { t.unreadChat = unreadSet.has(t.taskId); });
            } catch (e) { out.forEach(t => { t.unreadChat = false; }); }

            // Newest first by creation
            out.sort((a, b) => (b.taskId || '').localeCompare(a.taskId || ''));
            return JSON.stringify(out);
        });

        // Full detail for one group task + the caller's own membership flags.
        this.on('getGroupTaskDetail', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this task.');

            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email');
            const nameById = {}; const nameByEmail = {};
            emps.forEach(e => { nameById[e.employeeId] = e.employeeName; if (e.email) nameByEmail[e.email] = e.employeeName; });

            const rows = ctx.rows;
            const ended = rows.filter(a => a.status === 'ended').length;
            let unreadChat = false;
            try {
                const u = await SELECT.one.from(NOTIFICATION).columns('notificationId').where({
                    employee_employeeId: caller.employeeId, type: 'GROUP_CHAT_MESSAGE', isRead: false, referenceId: ctx.task.taskId
                });
                unreadChat = !!u;
            } catch (e) { /* default false */ }
            const detail = {
                taskId: ctx.task.taskId, taskName: ctx.task.taskName, taskDescription: ctx.task.taskDescription,
                priority: ctx.task.priority, status: ctx.task.status, dueDate: ctx.task.dueDate,
                completedAt: ctx.task.completedAt,
                createdByName: nameByEmail[ctx.task.createdBy] || 'Manager',
                total: rows.length, ended, unreadChat,
                isCreator: ctx.isCreator,
                myStatus: ctx.mine ? ctx.mine.status : null,
                // Only an assignee who has NOT yet ended their part may post
                // updates. The manager/creator who isn't a member, and any member
                // who already ended from their side, cannot post (enforced again
                // server-side in postGroupTaskUpdate — UI flag is convenience only).
                canPostUpdate: !!ctx.mine && ctx.mine.status !== 'ended',
                canEnd: !!ctx.mine && ctx.mine.status !== 'ended' && ctx.task.status !== 'completed',
                assignees: rows.map(a => ({
                    employeeId: a.assignee_employeeId,
                    employeeName: nameById[a.assignee_employeeId] || a.assignee_employeeId,
                    status: a.status, endedAt: a.endedAt, note: a.note
                }))
            };
            return JSON.stringify(detail);
        });

        // Employee ends their own part. When everyone has ended, the parent
        // task auto-completes. Lives here (server-side), never in the frontend.
        this.on('endMyTaskSide', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.mine) return req.error(403, 'You are not assigned to this task.');

            if (ctx.mine.status !== 'ended') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'ended', endedAt: new Date() }).where({ assignmentId: ctx.mine.assignmentId });
            }

            const rows = await SELECT.from(TASK_ASSIGNEE).where({ task_taskId: taskId });
            const allEnded = rows.length > 0 && rows.every(r => r.status === 'ended');
            let completed = false;
            if (allEnded && ctx.task.status !== 'completed') {
                await UPDATE(TASK).set({ status: 'completed', completedAt: new Date() }).where({ taskId });
                completed = true;
            }

            // Notifications
            try {
                const myName = caller.emp && caller.emp.employeeName || caller.employeeId;
                const recipients = await groupRecipientIds(ctx.task, rows);
                const creator = ctx.task.createdBy
                    ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ email: ctx.task.createdBy }) : null;
                if (creator && creator.employeeId && creator.employeeId !== caller.employeeId) {
                    await createNotification(creator.employeeId, 'GROUP_TASK_UPDATE', 'Group task update',
                        `${myName} ended their part of “${ctx.task.taskName}”.`, taskId);
                }
                if (completed) {
                    for (const rid of recipients) {
                        await createNotification(rid, 'GROUP_TASK_COMPLETED', 'Group task completed',
                            `All members have ended “${ctx.task.taskName}”. The task is complete.`, taskId);
                    }
                }
            } catch (e) { cds.log('group').warn('end notify failed:', e.message || e); }

            return { taskId, myStatus: 'ended', completed };
        });

        // Paginated chat history (newest page first; load older on scroll up).
        this.on('getGroupTaskMessages', async (req) => {
            const { taskId } = req.data;
            const page = Math.max(1, parseInt(req.data.page, 10) || 1);
            const pageSize = Math.min(100, Math.max(1, parseInt(req.data.pageSize, 10) || 50));
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this chat.');

            const all = await SELECT.from(TASK_MESSAGE).where({ task_taskId: taskId }).orderBy('sentAt desc', 'messageId desc');
            const total = all.length;
            const start = (page - 1) * pageSize;
            const slice = all.slice(start, start + pageSize);

            const msgIds = slice.map(m => m.messageId);
            let atts = [];
            if (msgIds.length) {
                atts = await SELECT.from(TASK_ATTACHMENT)
                    .columns('attachmentId', 'message_messageId', 'fileName', 'mimeType', 'fileSize')
                    .where({ message_messageId: { in: msgIds } });
            }
            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName');
            const nameMap = {}; emps.forEach(e => nameMap[e.employeeId] = e.employeeName);

            const messages = slice.slice().reverse().map(m => ({   // oldest-first within page
                messageId: m.messageId,
                senderId: m.sender_employeeId,
                senderName: nameMap[m.sender_employeeId] || m.sender_employeeId,
                // A deleted message keeps its slot but exposes no content/attachments.
                message: m.isDeleted ? '' : (m.message || ''),
                sentAt: m.sentAt,
                editedAt: m.isDeleted ? null : (m.editedAt || null),
                isDeleted: !!m.isDeleted,
                attachments: m.isDeleted ? [] : atts.filter(a => a.message_messageId === m.messageId).map(a => ({
                    attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize
                }))
            }));

            // Pinned message (one per task). Resolved from the FULL list so it shows
            // even when it lives on a different page. A deleted pin is treated as none.
            let pinned = null;
            if (ctx.task.pinnedMessageId) {
                const pm = all.find(x => x.messageId === ctx.task.pinnedMessageId);
                if (pm && !pm.isDeleted) {
                    pinned = {
                        messageId: pm.messageId,
                        senderName: nameMap[pm.sender_employeeId] || pm.sender_employeeId,
                        pinnedByName: ctx.task.pinnedByName || '',
                        message: pm.message || ''
                    };
                }
            }

            // Opening the chat clears the caller's coalesced "new messages" badge.
            await markChatRead(taskId, caller.employeeId);

            return JSON.stringify({ messages, pinned, hasMore: total > start + pageSize, total, page, pageSize });
        });

        // Post a chat message (text and/or attachments, ≤10 MB each).
        this.on('sendTaskMessage', async (req) => {
            const { taskId } = req.data;
            const sMsg = (req.data.message || '').trim();
            const atts = req.data.attachments || [];
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You cannot post to this chat.');
            if (!sMsg && !atts.length) return req.error(400, 'A message or an attachment is required.');

            const messageId = `${taskId}-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_MESSAGE).entries({
                messageId, task_taskId: taskId, sender_employeeId: caller.employeeId,
                message: sMsg || null, sentAt: new Date()
            });

            let n = 0;
            for (const a of atts) {
                if (!a || !a.dataBase64) continue;
                let buf;
                try { buf = Buffer.from(String(a.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { continue; }
                if (buf.length > 10 * 1024 * 1024) return req.error(400, `Attachment “${a.fileName || 'file'}” exceeds the 10 MB limit.`);
                n++;
                await INSERT.into(TASK_ATTACHMENT).entries({
                    attachmentId: `${messageId}-ATT-${n}`,
                    message_messageId: messageId,
                    fileName: a.fileName || 'file',
                    mimeType: a.mimeType || 'application/octet-stream',
                    fileSize: buf.length,
                    content: buf
                });
            }

            // A member who's actively chatting is "in progress" (not pending).
            if (ctx.mine && ctx.mine.status === 'pending') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'in_progress' })
                    .where({ assignmentId: ctx.mine.assignmentId, status: 'pending' });
            }

            // Coalesced chat notifications to everyone else.
            try {
                const recipients = await groupRecipientIds(ctx.task, ctx.rows);
                await notifyGroupChat(taskId, ctx.task.taskName, caller.employeeId, recipients);
            } catch (e) { cds.log('group').warn('chat notify failed:', e.message || e); }

            return { messageId };
        });

        // Download a chat attachment (membership-checked) as base64.
        this.on('getTaskAttachment', async (req) => {
            const { attachmentId } = req.data;
            if (!attachmentId) return req.error(400, 'attachmentId is required.');
            const att = await SELECT.one.from(TASK_ATTACHMENT).where({ attachmentId });
            if (!att) return req.error(404, 'Attachment not found.');
            const msg = await SELECT.one.from(TASK_MESSAGE).columns('task_taskId').where({ messageId: att.message_messageId });
            const caller = await resolveCaller(req);
            const ctx = msg ? await loadGroupContext(msg.task_taskId, caller) : { isMember: false };
            if (!ctx.isMember) return req.error(403, 'You do not have access to this attachment.');

            const dataBase64 = await binaryToBase64(att.content);
            if (!dataBase64) return req.error(404, 'Attachment has no content.');
            return { fileName: att.fileName, mimeType: att.mimeType || 'application/octet-stream', dataBase64 };
        });

        // Explicitly clear the caller's "new messages" badge for a task.
        this.on('markGroupChatRead', async (req) => {
            const caller = await resolveCaller(req);
            await markChatRead(req.data.taskId, caller.employeeId);
            return { ok: true };
        });

        // ── Edit a chat message (author only) ─────────────────────────────────
        this.on('editTaskMessage', async (req) => {
            const { messageId } = req.data;
            const newText = (req.data.message || '').trim();
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            if (!newText) return JSON.stringify({ error: 'Message cannot be empty.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be edited.' });
            const caller = await resolveCaller(req);
            if (msg.sender_employeeId !== caller.employeeId) {
                return JSON.stringify({ error: 'You can only edit your own messages.' });
            }
            await UPDATE(TASK_MESSAGE).set({ message: newText, editedAt: new Date() }).where({ messageId });
            return JSON.stringify({ ok: true, messageId });
        });

        // ── Delete a chat message (author only) — soft delete ─────────────────
        // The row is kept (preserving order/history); content + attachments are
        // dropped and, if it was the pinned message, the task is unpinned.
        this.on('deleteTaskMessage', async (req) => {
            const { messageId } = req.data;
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            const caller = await resolveCaller(req);
            if (msg.sender_employeeId !== caller.employeeId) {
                return JSON.stringify({ error: 'You can only delete your own messages.' });
            }
            await UPDATE(TASK_MESSAGE).set({ isDeleted: true, message: null, editedAt: new Date() }).where({ messageId });
            await DELETE.from(TASK_ATTACHMENT).where({ message_messageId: messageId });
            const task = await SELECT.one.from(TASK).columns('taskId', 'pinnedMessageId').where({ taskId: msg.task_taskId });
            if (task && task.pinnedMessageId === messageId) {
                await UPDATE(TASK).set({ pinnedMessageId: null, pinnedByName: null }).where({ taskId: msg.task_taskId });
            }
            return JSON.stringify({ ok: true, messageId });
        });

        // ── Pin a chat message (any group member) — one active pin per task ───
        this.on('pinTaskMessage', async (req) => {
            const { taskId, messageId } = req.data;
            if (!taskId || !messageId) return JSON.stringify({ error: 'taskId and messageId are required.' });
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return JSON.stringify({ error: 'Group task not found.' });
            if (!ctx.isMember) return JSON.stringify({ error: 'You do not have access to this chat.' });
            const msg = await SELECT.one.from(TASK_MESSAGE).columns('messageId', 'task_taskId', 'isDeleted').where({ messageId });
            if (!msg || msg.task_taskId !== taskId) return JSON.stringify({ error: 'Message not found in this task.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be pinned.' });
            const pinnedBy = (caller.emp && caller.emp.employeeName) || caller.employeeId || '';
            await UPDATE(TASK).set({ pinnedMessageId: messageId, pinnedByName: pinnedBy }).where({ taskId });
            return JSON.stringify({ ok: true, messageId, pinnedByName: pinnedBy });
        });

        // ── Unpin (any group member) ──────────────────────────────────────────
        this.on('unpinTaskMessage', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return JSON.stringify({ error: 'taskId is required.' });
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return JSON.stringify({ error: 'Group task not found.' });
            if (!ctx.isMember) return JSON.stringify({ error: 'You do not have access to this chat.' });
            await UPDATE(TASK).set({ pinnedMessageId: null, pinnedByName: null }).where({ taskId });
            return JSON.stringify({ ok: true });
        });

        // ── Group Task Updates ────────────────────────────────────────────────
        // List a group task's updates (newest first). Any member (assignee OR
        // the creator/manager) may VIEW. Each update carries the poster's name,
        // an optional profile photo (base64), timestamp and attachment metadata.
        this.on('getGroupTaskUpdates', async (req) => {
            const { taskId } = req.data;
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.isMember) return req.error(403, 'You do not have access to this task.');

            const rows = await SELECT.from(TASK_UPDATE)
                .where({ task_taskId: taskId })
                .orderBy('createdAt desc', 'updateId desc');

            // Resolve poster names + profile photos (deduped by employeeId).
            const ids = Array.from(new Set(rows.map(r => r.updatedBy_employeeId).filter(Boolean)));
            const nameById = {}; const photoById = {};
            if (ids.length) {
                const emps = await SELECT.from(EMPLOYEE)
                    .columns('employeeId', 'employeeName', 'profilePhoto', 'profilePhotoMimeType')
                    .where({ employeeId: { in: ids } });
                for (const e of emps) {
                    nameById[e.employeeId] = e.employeeName;
                    if (e.profilePhoto) {
                        const b64 = await binaryToBase64(e.profilePhoto);
                        if (b64) photoById[e.employeeId] = 'data:' + (e.profilePhotoMimeType || 'image/png') + ';base64,' + b64;
                    }
                }
            }

            const updates = rows.map(r => ({
                updateId: r.updateId,
                title: r.title || '',
                notes: r.notes || '',
                updatedAt: r.createdAt || r.updateDate,
                updatedById: r.updatedBy_employeeId,
                updatedByName: nameById[r.updatedBy_employeeId] || r.updatedBy_employeeId || 'Member',
                photoUrl: photoById[r.updatedBy_employeeId] || '',
                attachmentName: r.attachmentName || '',
                attachmentMimeType: r.attachmentMimeType || '',
                hasAttachment: !!r.attachmentName
            }));
            return JSON.stringify({ updates });
        });

        // Post a progress update on a group task. ONLY an assignee of the task
        // may post (creator/manager who isn't a member is rejected server-side).
        this.on('postGroupTaskUpdate', async (req) => {
            const { taskId } = req.data;
            const sNotes = (req.data.notes || '').trim();
            const sTitle = (req.data.title || '').trim();
            const caller = await resolveCaller(req);
            const ctx = await loadGroupContext(taskId, caller);
            if (!ctx.task) return req.error(404, 'Group task not found.');
            if (!ctx.mine) return req.error(403, 'Only members assigned to this task can post updates.');
            if (ctx.mine.status === 'ended') return req.error(403, 'You have ended this task from your side and can no longer post updates.');
            if (!sNotes) return req.error(400, 'An update message is required.');

            let buf = null;
            if (req.data.dataBase64) {
                try { buf = Buffer.from(String(req.data.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { buf = null; }
                if (buf && buf.length > 10 * 1024 * 1024) {
                    return req.error(400, 'Attachment exceeds the 10 MB limit.');
                }
            }

            const updateId = `${taskId}-UPD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_UPDATE).entries({
                updateId,
                task_taskId: taskId,
                updateDate: new Date().toISOString().slice(0, 10),
                title: sTitle || null,
                notes: sNotes,
                attachmentName: buf ? (req.data.fileName || 'attachment') : null,
                attachmentMimeType: buf ? (req.data.mimeType || 'application/octet-stream') : null,
                attachment: buf || null,
                updatedBy_employeeId: caller.employeeId
            });

            // Posting an update means the member is actively working → in_progress.
            if (ctx.mine.status === 'pending') {
                await UPDATE(TASK_ASSIGNEE).set({ status: 'in_progress' })
                    .where({ assignmentId: ctx.mine.assignmentId, status: 'pending' });
            }

            // Notify the other members + creator that a new update was posted.
            try {
                const myName = (caller.emp && caller.emp.employeeName) || caller.employeeId;
                const recipients = await groupRecipientIds(ctx.task, ctx.rows);
                for (const rid of recipients) {
                    if (!rid || rid === caller.employeeId) continue;
                    await createNotification(rid, 'GROUP_TASK_UPDATE', 'New task update',
                        `${myName} posted an update on “${ctx.task.taskName}”.`, taskId);
                }
            } catch (e) { cds.log('group').warn('update notify failed:', e.message || e); }

            return { updateId };
        });

        // Download a task-update attachment (access-checked) as base64. Works for
        // both solo and group tasks — the old version only allowed group members,
        // so solo-task update attachments 403'd and appeared "not downloadable".
        this.on('getTaskUpdateAttachment', async (req) => {
            const { updateId } = req.data;
            if (!updateId) return req.error(400, 'updateId is required.');
            const upd = await SELECT.one.from(TASK_UPDATE)
                .columns('updateId', 'task_taskId', 'attachmentName', 'attachmentMimeType', 'attachment')
                .where({ updateId });
            if (!upd) return req.error(404, 'Update not found.');
            const access = await canAccessTask(req, upd.task_taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this attachment.');
            const dataBase64 = await binaryToBase64(upd.attachment);
            if (!dataBase64) return req.error(404, 'Attachment has no content.');
            return {
                fileName: upd.attachmentName || 'attachment',
                mimeType: upd.attachmentMimeType || 'application/octet-stream',
                dataBase64
            };
        });

        // ── Multi-document task attachments ───────────────────────────────────
        // List metadata (no binary) for every document attached to a task.
        this.on('getTaskDocuments', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const access = await canAccessTask(req, taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this task.');
            const rows = await SELECT.from(TASK_DOCUMENT)
                .columns('documentId', 'fileName', 'mimeType', 'fileSize', 'createdAt')
                .where({ task_taskId: taskId })
                .orderBy('createdAt asc');
            return JSON.stringify((rows || []).map(r => ({
                documentId: r.documentId,
                fileName:   r.fileName || 'document',
                mimeType:   r.mimeType || 'application/octet-stream',
                fileSize:   r.fileSize || 0
            })));
        });

        // Non-destructive download of one task document as base64.
        this.on('getTaskDocument', async (req) => {
            const { documentId } = req.data;
            if (!documentId) return req.error(400, 'documentId is required.');
            const doc = await SELECT.one.from(TASK_DOCUMENT)
                .columns('documentId', 'task_taskId', 'fileName', 'mimeType', 'content')
                .where({ documentId });
            if (!doc) return req.error(404, 'Document not found.');
            const access = await canAccessTask(req, doc.task_taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this document.');
            const dataBase64 = await binaryToBase64(doc.content);
            if (!dataBase64) return req.error(404, 'Document has no content.');
            return {
                fileName: doc.fileName || 'document',
                mimeType: doc.mimeType || 'application/octet-stream',
                dataBase64
            };
        });

        // Post a progress update on a SOLO task, persisting the optional file
        // binary so it can be downloaded later by anyone with task access.
        this.on('postTaskUpdate', async (req) => {
            const { taskId } = req.data;
            const sNotes = (req.data.notes || '').trim();
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!sNotes) return req.error(400, 'An update note is required.');
            const access = await canAccessTask(req, taskId);
            if (!access.ok) return req.error(403, 'You do not have access to this task.');
            if (access.task && access.task.status === 'Completed') {
                return req.error(403, 'This task is Completed — updates are no longer allowed.');
            }

            let buf = null;
            if (req.data.dataBase64) {
                try { buf = Buffer.from(String(req.data.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { buf = null; }
                if (buf && buf.length > 10 * 1024 * 1024) {
                    return req.error(400, 'Attachment exceeds the 10 MB limit.');
                }
            }

            const updateId = `${taskId}-UPD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_UPDATE).entries({
                updateId,
                task_taskId: taskId,
                updateDate: req.data.updateDate || new Date().toISOString().slice(0, 10),
                notes: sNotes,
                attachmentName: buf ? (req.data.fileName || 'attachment') : null,
                attachmentMimeType: buf ? (req.data.mimeType || 'application/octet-stream') : null,
                attachment: buf || null,
                updatedBy_employeeId: access.caller.employeeId
            });
            return { updateId };
        });

        // Unread group-task notifications for the caller → "Group Tasks" badge.
        this.on('getGroupTasksUnread', async (req) => {
            const caller = await resolveCaller(req);
            if (!caller.employeeId) return { count: 0 };
            try {
                const rows = await SELECT.from(NOTIFICATION).columns('notificationId').where({
                    employee_employeeId: caller.employeeId,
                    isRead: false,
                    type: { in: ['GROUP_CHAT_MESSAGE', 'GROUP_TASK_ASSIGNED', 'GROUP_TASK_UPDATE', 'GROUP_TASK_COMPLETED'] }
                });
                return { count: rows.length };
            } catch (e) {
                return { count: 0 };
            }
        });

        // ── Sidebar menu badges (unread notifications per menu route) ─────────
        this.on('getSidebarBadges', async (req) => {
            const caller = await resolveCaller(req);
            if (!caller.employeeId) return JSON.stringify({});
            const isHR = !!(req.user && req.user.is && req.user.is('HR'));
            let rows = [];
            try {
                rows = await SELECT.from(NOTIFICATION).columns('type')
                    .where({ employee_employeeId: caller.employeeId, isRead: false });
            } catch (e) { return JSON.stringify({}); }
            const counts = {};
            rows.forEach(r => {
                const route = routeForNotif(r.type, isHR);
                if (route) counts[route] = (counts[route] || 0) + 1;
            });
            return JSON.stringify(counts);
        });

        // Clear a menu's badge by marking its related unread notifications read.
        this.on('markRouteNotificationsRead', async (req) => {
            const route = ((req.data && req.data.route) || '').trim();
            const caller = await resolveCaller(req);
            if (!caller.employeeId || !route) return { updated: 0 };
            const isHR = !!(req.user && req.user.is && req.user.is('HR'));
            let rows = [];
            try {
                rows = await SELECT.from(NOTIFICATION).columns('notificationId', 'type')
                    .where({ employee_employeeId: caller.employeeId, isRead: false });
            } catch (e) { return { updated: 0 }; }
            const ids = rows.filter(r => {
                if (routeForNotif(r.type, isHR) !== route) return false;
                // Group chat messages are cleared by opening the specific task's
                // chat (markChatRead), not by visiting the list — this preserves
                // each task's "unread chat" indicator.
                if (route === 'group-tasks' && r.type === 'GROUP_CHAT_MESSAGE') return false;
                return true;
            }).map(r => r.notificationId);
            if (!ids.length) return { updated: 0 };
            await UPDATE(NOTIFICATION).set({ isRead: true }).where({ notificationId: { in: ids } });
            return { updated: ids.length };
        });

        // ── Upload Profile Photo ──────────────────────────────────────────────
        // CAP's UPDATE().set() silently skips LargeBinary columns annotated
        // with @Core.MediaType in SQLite. We use raw SQL to bypass this.
        this.on('uploadProfilePhoto', async (req) => {
            const { dataBase64 } = req.data;
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');

            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!email) return req.error(401, 'Cannot identify user — no email in token.');

            // Resolve employeeId from email
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where('lower(email) =', email);
            if (!emp) return req.error(404, 'Employee record not found for this login.');

            // Parse "data:image/jpeg;base64,<data>"
            let mimeType = 'image/jpeg';
            let rawBase64 = dataBase64;
            const commaIdx = dataBase64.indexOf(',');
            if (commaIdx !== -1) {
                const header = dataBase64.substring(0, commaIdx); // "data:image/jpeg;base64"
                rawBase64 = dataBase64.substring(commaIdx + 1);   // raw base64 after comma
                const mimeMatch = header.match(/data:([^;]+);/);
                if (mimeMatch) mimeType = mimeMatch[1];
            }

            if (!mimeType.startsWith('image/')) {
                return req.error(400, 'Only image files are allowed.');
            }

            let buf;
            try { buf = Buffer.from(rawBase64, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }

            if (buf.length > 2 * 1024 * 1024) {
                return req.error(400, 'Profile photo must be under 2 MB.');
            }

            // ── Persist via CQN against the CDS entity (DB-agnostic) ──────────
            // The previous implementation used raw SQL with a hard-coded SQLite
            // physical table name, which does not exist on HANA → upload failed
            // only in the deployed environment. CQN lets CAP resolve the correct
            // table for whichever DB is bound (SQLite locally, HANA deployed).
            await UPDATE(EMPLOYEE)
                .set({ profilePhoto: buf, profilePhotoMimeType: mimeType })
                .where({ employeeId: emp.employeeId });

            cds.log('profile').info(
                `✓ Photo saved: emp=${emp.employeeId} | bytes=${buf.length} | mime=${mimeType}`
            );

            return { success: true, message: `Photo saved (${mimeType}, ${buf.length} bytes).` };
        });

        // ── Get Profile Photo ─────────────────────────────────────────────────
        // Also uses raw SQL so the BLOB is read correctly from SQLite.
        this.on('getProfilePhoto', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!email) return { dataBase64: '', mimeType: '' };

            // Resolve employeeId first (safe — no BLOB involved)
            const emp = await SELECT.one.from(EMPLOYEE)
                .columns('employeeId')
                .where('lower(email) =', email);
            if (!emp) return { dataBase64: '', mimeType: '' };

            // Read BLOB via CQN (DB-agnostic — works on SQLite and HANA alike).
            const row = await SELECT.one.from(EMPLOYEE)
                .columns('profilePhoto', 'profilePhotoMimeType')
                .where({ employeeId: emp.employeeId });

            cds.log('profile').info(
                `getProfilePhoto: emp=${emp.employeeId} | hasPhoto=${!!(row && row.profilePhoto)} | mime=${row && row.profilePhotoMimeType}`
            );

            if (!row || !row.profilePhoto) return { dataBase64: '', mimeType: '' };

            // Convert BLOB → base64.
            // The column may hold EITHER raw image binary OR base64 text stored
            // as bytes — CAP's LargeBinary handling base64-encodes Buffers when
            // written via raw SQL on SQLite, so existing rows hold base64 text.
            // Detect which form it is by checking image magic numbers and always
            // emit SINGLE-encoded base64 (re-encoding base64 text would corrupt
            // the data URL and show a broken image).
            let base64 = '';
            try {
                const photo = row.profilePhoto;
                let buf;
                if (Buffer.isBuffer(photo)) buf = photo;
                else if (photo instanceof Uint8Array) buf = Buffer.from(photo);
                else if (typeof photo === 'string') buf = Buffer.from(photo, 'utf8');
                else if (photo && typeof photo.pipe === 'function') {
                    // CAP returns LargeBinary as a Readable stream via CQN (both
                    // SQLite and HANA). Consume it into a Buffer before encoding —
                    // otherwise the bytes are lost and the photo comes back empty.
                    const chunks = [];
                    for await (const chunk of photo) chunks.push(chunk);
                    buf = Buffer.concat(chunks);
                } else {
                    buf = Buffer.from(photo);
                }
                if (!buf || !buf.length) return { dataBase64: '', mimeType: '' };

                const isRawImage =
                    (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) || // JPEG
                    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) || // PNG
                    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) || // GIF
                    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46);   // WEBP/RIFF

                base64 = isRawImage
                    ? buf.toString('base64')          // raw binary → encode once
                    : buf.toString('utf8').trim();    // already base64 text → use as-is
            } catch (e) {
                cds.log('profile').error('Could not encode photo:', e.message);
                return { dataBase64: '', mimeType: '' };
            }

            // Always guarantee a valid mimeType — never return empty
            const mimeType = (row.profilePhotoMimeType && row.profilePhotoMimeType.trim())
                ? row.profilePhotoMimeType.trim()
                : 'image/jpeg';

            return {
                dataBase64: `data:${mimeType};base64,${base64}`,
                mimeType
            };
        });

        this.on('submitTimesheet', async (req) => {
            const { timesheetId } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (!['Draft', 'Rejected'].includes(header.status)) {
                return req.error(400, `Cannot submit — current status is '${header.status}'. Only 'Draft' or 'Rejected' timesheets can be submitted.`);
            }
            await UPDATE(HEADER).set({ status: 'Pending', submittedOn: new Date() }).where({ timesheetId });
            await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Locked' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' submitted. Waiting for manager approval.`;
        });

        this.on('consumeTaskAttachment', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const task = await SELECT.one.from(TASK).columns('taskId', 'attachment', 'attachmentName', 'attachmentMimeType').where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);
            if (!task.attachment || !task.attachmentName) return req.error(404, 'No attachment available for this task.');
            let base64 = '';
            try {
                if (Buffer.isBuffer(task.attachment)) base64 = task.attachment.toString('base64');
                else if (typeof task.attachment === 'string') base64 = task.attachment;
                else if (task.attachment instanceof Uint8Array) base64 = Buffer.from(task.attachment).toString('base64');
                else base64 = Buffer.from(task.attachment).toString('base64');
            } catch (e) {
                cds.log('attach').error('Could not encode attachment:', e.message || e);
                return req.error(500, 'Could not read attachment.');
            }
            const result = { fileName: task.attachmentName, mimeType: task.attachmentMimeType || 'application/octet-stream', dataBase64: base64 };
            try {
                await UPDATE(TASK).set({ attachment: null, attachmentName: null, attachmentMimeType: null }).where({ taskId });
            } catch (e) {
                cds.log('attach').warn(`Failed to clear attachment for ${taskId}:`, e.message || e);
            }
            return result;
        });

        this.on('applyLeave', async (req) => {
            const { employeeId, leaveType, fromDate, toDate, days, reason, isUnpaid } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            if (!leaveType) return req.error(400, 'leaveType is required.');
            if (!fromDate) return req.error(400, 'fromDate is required.');
            if (!toDate) return req.error(400, 'toDate is required.');
            if (!days) return req.error(400, 'days is required.');
            if (!reason) return req.error(400, 'reason is required.');
            // Range sanity: end can't precede start, and day count must be positive.
            // (`!days` above already rejects 0/empty; this also catches negatives,
            // which are truthy.) We do NOT recompute `days` — the client computes
            // working-days (weekends/holidays excluded) and that value is kept.
            if (new Date(toDate) < new Date(fromDate)) {
                return req.error(400, 'The "to" date cannot be earlier than the "from" date.');
            }
            if (!(Number(days) > 0)) {
                return req.error(400, 'Number of leave days must be greater than zero.');
            }

            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            // Security: a leave can only be filed for oneself. The UI always sends
            // the caller's own id, so this guard is invisible to normal use — it
            // only blocks a forged request that names another employee. (If the
            // caller's email can't be resolved to a record we leave behaviour as
            // before, so no existing flow is broken.)
            {
                const user = req.user || {};
                const callerEmail = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
                const caller = callerEmail
                    ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', callerEmail)
                    : null;
                if (caller && caller.employeeId !== employeeId) {
                    return req.error(403, 'You can only apply for leave for yourself.');
                }
            }
            if (emp.designation && emp.designation.toLowerCase() === 'founder') {
                return req.error(403, 'Founders are not eligible to apply for leave.');
            }

            const leaveId = `${employeeId}-LV-${Date.now()}`;
            await INSERT.into(LEAVE_REQUEST).entries({
                leaveId, employee_employeeId: employeeId, leaveType, fromDate, toDate,
                days, reason, status: 'Pending', isUnpaid: isUnpaid || false
            });

            const cascadeStr = req.data.cascade || null;
            if (cascadeStr) cds.log('leave').info(`Cascade breakdown for ${leaveId}: ${cascadeStr}`);

            if (emp.manager_employeeId) {
                // Issue 2: in-app notification to the manager (always — independent
                // of SMTP, which is the reason leave notifications never appeared).
                await createNotification(
                    emp.manager_employeeId,
                    'LEAVE_REQUEST',
                    'New Leave Request',
                    `${emp.employeeName} requested ${leaveType} leave (${fromDate} to ${toDate}, ${days} day${days > 1 ? 's' : ''}).`,
                    leaveId
                );

                const manager = await SELECT.one.from(EMPLOYEE).where({ employeeId: emp.manager_employeeId });
                if (manager && manager.email) {
                    const mailer = getMailer();
                    const subject = `Leave Request from ${emp.employeeName}`;
                    const body = `Hi ${manager.employeeName || 'Manager'},\n\n${emp.employeeName} has applied for leave.\n\nLeave Type : ${leaveType}\nFrom       : ${fromDate}\nTo         : ${toDate}\nDays       : ${days}${isUnpaid ? ' (includes unpaid days)' : ''}\nReason     : ${reason}\n\nPlease login to the Timesheet app to approve or reject.\n\n— Timesheet System`;
                    if (mailer) {
                        try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: manager.email, subject, text: body }); }
                        catch (e) { cds.log('mail').warn('Leave notification email failed:', e.message); }
                    } else {
                        cds.log('leave').info(`[Email simulated] TO: ${manager.email}\n${body}`);
                    }
                }
            }
            return { leaveId, status: 'Pending', isUnpaid: isUnpaid || false };
        });

        this.on('getRecentNotifications', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return [];
            const rows = await SELECT.from(NOTIFICATION).where({ employee_employeeId: emp.employeeId }).orderBy({ notifiedAt: 'desc' }).limit(4);
            return (rows || []).map(n => ({
                notificationId: n.notificationId, type: n.type || '', title: n.title || '',
                message: n.message || '', isRead: n.isRead || false, referenceId: n.referenceId || '',
                notifiedAt: n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));
        });

        this.on('markAllNotificationsRead', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const empRow = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!empRow) return req.error(404, 'Employee not found.');

            // Count unread BEFORE updating (affectedRows not reliable in CDS)
            const unreadRows = await SELECT.from(NOTIFICATION)
                .columns('notificationId')
                .where({ employee_employeeId: empRow.employeeId, isRead: false });
            const updated = (unreadRows || []).length;

            if (updated > 0) {
                await UPDATE(NOTIFICATION)
                    .set({ isRead: true })
                    .where({ employee_employeeId: empRow.employeeId, isRead: false });
            }

            cds.log('notif').info(`${updated} notifications marked as read for ${empRow.employeeId}`);
            return { updated };
        });

        // ── Paginated notifications (bell icon + Notifications page) ───────────
        // Declared in the CDS but previously had no handler → 501, so the bell
        // and Notifications page received nothing even though rows existed in DB
        // (getRecentNotifications showed them). Implemented here.
        this.on('getNotifications', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { itemsJSON: '[]', totalCount: 0, unreadCount: 0 };

            const page     = Math.max(1, parseInt(req.data.page, 10) || 1);
            const pageSize = Math.max(1, parseInt(req.data.pageSize, 10) || 20);
            const offset   = (page - 1) * pageSize;

            const all = await SELECT.from(NOTIFICATION)
                .where({ employee_employeeId: emp.employeeId })
                .orderBy({ notifiedAt: 'desc' });

            const totalCount  = all.length;
            const unreadCount = all.filter(n => !n.isRead).length;
            const pageRows = all.slice(offset, offset + pageSize).map(n => ({
                notificationId: n.notificationId,
                type:           n.type || '',
                title:          n.title || '',
                message:        n.message || '',
                isRead:         n.isRead || false,
                referenceId:    n.referenceId || '',
                notifiedAt:     n.notifiedAt ? new Date(n.notifiedAt).toISOString() : ''
            }));

            return { itemsJSON: JSON.stringify(pageRows), totalCount, unreadCount };
        });

        // ── Mark a single notification as read ─────────────────────────────────
        this.on('markNotificationRead', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            const { notificationId } = req.data;
            if (!emp || !notificationId) return { success: false };
            await UPDATE(NOTIFICATION).set({ isRead: true })
                .where({ notificationId, employee_employeeId: emp.employeeId });
            return { success: true };
        });

        // ── Delete / dismiss a single notification ─────────────────────────────
        this.on('deleteNotification', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            const { notificationId } = req.data;
            if (!emp || !notificationId) return { success: false };
            await DELETE.from(NOTIFICATION)
                .where({ notificationId, employee_employeeId: emp.employeeId });
            return { success: true };
        });

        // ── Dashboard: Upcoming Teams Meetings (DB-based, next 7 days) ────────────
        const { formatMeetingForDisplay } = require('./services/teams-service');

        this.on('getUpcomingMeetings', async (req) => {
            const user  = req.user || {};
            const email = ((user.attr && (user.attr.email || user.attr.mail)) || user.id || '').trim().toLowerCase();
            if (!email) return JSON.stringify([]);
            try {
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
                if (!emp) return JSON.stringify([]);
                const now     = new Date().toISOString();
                const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                // Meetings where this employee is the organizer OR a participant.
                const asOrg = await SELECT.from(MEETING)
                    .columns('meetingId','title','agenda','startDateTime','endDateTime','organizerEmail','organizerName','status','teamsJoinUrl','project_projectId')
                    .where({ organizer_employeeId: emp.employeeId, status: { '<>': 'Cancelled' } })
                    .where({ startDateTime: { '>=': now } })
                    .where({ startDateTime: { '<=': in7days } });
                const asPart = await SELECT.from(MEETING_PARTICIPANT)
                    .columns('meeting_meetingId')
                    .where({ employee_employeeId: emp.employeeId });
                const partIds = asPart.map(p => p.meeting_meetingId);
                const asMember = partIds.length ? await SELECT.from(MEETING)
                    .columns('meetingId','title','agenda','startDateTime','endDateTime','organizerEmail','organizerName','status','teamsJoinUrl','project_projectId')
                    .where({ meetingId: { in: partIds }, status: { '<>': 'Cancelled' } })
                    .where({ startDateTime: { '>=': now } })
                    .where({ startDateTime: { '<=': in7days } }) : [];
                const seen = new Set(); const all = [];
                [...asOrg, ...asMember].forEach(m => { if (!seen.has(m.meetingId)) { seen.add(m.meetingId); all.push(m); } });
                all.sort((a, b) => String(a.startDateTime).localeCompare(String(b.startDateTime)));
                return JSON.stringify(all.map(formatMeetingForDisplay));
            } catch (e) {
                cds.log('teams').error('getUpcomingMeetings failed:', e.message);
                return JSON.stringify([]);
            }
        });

        this.on('getMyMeetings', async (req) => {
            const user  = req.user || {};
            const email = ((user.attr && (user.attr.email || user.attr.mail)) || user.id || '').trim().toLowerCase();
            const filter = req.data.filter || 'upcoming';
            if (!email) return JSON.stringify({ meetings: [] });
            try {
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
                if (!emp) return JSON.stringify({ meetings: [] });
                const now = new Date();
                // Meetings where employee is organizer OR participant.
                const asOrg = await SELECT.from(MEETING)
                    .columns('meetingId','title','agenda','startDateTime','endDateTime','organizerEmail','organizerName','status','teamsJoinUrl','project_projectId')
                    .where({ organizer_employeeId: emp.employeeId });
                const asPart = await SELECT.from(MEETING_PARTICIPANT).columns('meeting_meetingId').where({ employee_employeeId: emp.employeeId });
                const partIds = asPart.map(p => p.meeting_meetingId);
                const asMember = partIds.length ? await SELECT.from(MEETING)
                    .columns('meetingId','title','agenda','startDateTime','endDateTime','organizerEmail','organizerName','status','teamsJoinUrl','project_projectId')
                    .where({ meetingId: { in: partIds } }) : [];
                const seen = new Set(); const all = [];
                [...asOrg, ...asMember].forEach(m => { if (!seen.has(m.meetingId)) { seen.add(m.meetingId); all.push(m); } });
                // Apply filter.
                // Start of today (midnight) — used for date-only comparisons so past
                // meetings earlier today still appear in Today / This Week / This Month.
                const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
                const filtered = all.filter(m => {
                    const s = new Date(m.startDateTime);
                    if (filter === 'today') return s.toDateString() === now.toDateString();
                    if (filter === 'week') {
                        const weekEnd = new Date(startOfToday); weekEnd.setDate(startOfToday.getDate() + 7);
                        return s >= startOfToday && s <= weekEnd;
                    }
                    if (filter === 'month') {
                        return s.getFullYear() === now.getFullYear() && s.getMonth() === now.getMonth();
                    }
                    if (filter === 'completed') return m.status === 'Completed';
                    if (filter === 'cancelled') return m.status === 'Cancelled';
                    if (filter === 'ongoing')   return m.status === 'Scheduled' && s <= now && new Date(m.endDateTime) >= now;
                    if (filter === 'upcoming')  return s >= now && m.status === 'Scheduled';
                    return true; // 'all'
                });
                filtered.sort((a, b) => String(a.startDateTime).localeCompare(String(b.startDateTime)));
                // Get project names.
                const projIds = [...new Set(filtered.map(m => m.project_projectId).filter(Boolean))];
                const projs = projIds.length ? await SELECT.from(PROJECT).columns('projectId','projectName').where({ projectId: { in: projIds } }) : [];
                const projName = {}; projs.forEach(p => { projName[p.projectId] = p.projectName; });
                const meetings = filtered.map(m => formatMeetingForDisplay({ ...m, projectName: projName[m.project_projectId] || '' }));
                return JSON.stringify({ meetings });
            } catch (e) {
                cds.log('teams').error('getMyMeetings failed:', e.message);
                return JSON.stringify({ meetings: [] });
            }
        });

        this.on('getLeaveOverview', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { casual: 0, sick: 0, annual: 0, unpaid: 0, totalDays: 0, takenJSON: JSON.stringify([]) };
            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one.from(LEAVE_BALANCE).where({ employee_employeeId: emp.employeeId });
            const ALLOTMENT = { casual: 12, sick: 8, annual: 15, unpaid: 0 };
            const casual = balance ? (balance.casualLeave || 0) : ALLOTMENT.casual;
            const sick = balance ? (balance.sickLeave || 0) : ALLOTMENT.sick;
            const annual = balance ? (balance.annualLeave || 0) : ALLOTMENT.annual;
            const takenData = [
                { type: 'casual', label: 'Casual Leave', taken: Math.max(0, ALLOTMENT.casual - casual), balance: casual, color: '#16a34a' },
                { type: 'sick', label: 'Sick Leave', taken: Math.max(0, ALLOTMENT.sick - sick), balance: sick, color: '#3b82f6' },
                { type: 'annual', label: 'Annual Leave', taken: Math.max(0, ALLOTMENT.annual - annual), balance: annual, color: '#f59e0b' },
                { type: 'unpaid', label: 'Unpaid Leave', taken: 0, balance: 0, color: '#9ca3af' }
            ];
            return { casual, sick, annual, unpaid: 0, totalDays: casual + sick + annual, takenJSON: JSON.stringify(takenData) };
        });

        this.on('getWorkAnniversary', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'joiningDate').where('lower(email) =', email);
            if (!emp || !emp.joiningDate) return { yearsCompleted: 0, joiningDate: null, message: 'No joining date found.' };
            const joining = new Date(emp.joiningDate);
            const today = new Date();
            const totalDays = (today - joining) / (1000 * 60 * 60 * 24);
            const yearsCompleted = Math.max(0, totalDays / 365.25);
            return {
                yearsCompleted: parseFloat(yearsCompleted.toFixed(2)),
                joiningDate: emp.joiningDate,
                message: yearsCompleted >= 1
                    ? `Congratulations! You have completed ${Math.floor(yearsCompleted)} years with us.`
                    : `Welcome! You joined on ${joining.toLocaleDateString()}`
            };
        });

        this.on('getPerformanceRating', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { ratingValue: 0, ratingCategory: 'N/A', reviewMonth: 0, reviewYear: 0, reviewComment: '' };
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const ratings = await SELECT.from(PERF).where({ employee_employeeId: emp.employeeId }).orderBy('reviewYear desc', 'reviewMonth desc').limit(1);
            if (!ratings || ratings.length === 0) return { ratingValue: 0, ratingCategory: 'N/A', reviewMonth: 0, reviewYear: 0, reviewComment: '' };
            const r = ratings[0];
            const val = parseFloat(r.ratingValue) || 0;
            return {
                ratingValue: val,
                ratingCategory: val >= 4.5 ? 'Excellent' : val >= 3.5 ? 'Good' : val >= 2.5 ? 'Average' : val > 0 ? 'Needs Improvement' : 'N/A',
                reviewMonth: r.reviewMonth || 0, reviewYear: r.reviewYear || 0, reviewComment: r.reviewComment || ''
            };
        });

        this.on('getPerformanceTrend', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const year = req.data.year || new Date().getFullYear();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { trendJSON: JSON.stringify(Array(12).fill(null)) };
            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const ratings = await SELECT.from(PERF).where({ employee_employeeId: emp.employeeId, reviewYear: year }).orderBy('reviewMonth asc');
            const slots = Array(12).fill(null);
            ratings.forEach(r => { const idx = (r.reviewMonth || 1) - 1; if (idx >= 0 && idx < 12) slots[idx] = parseFloat(r.ratingValue) || null; });
            return { trendJSON: JSON.stringify(slots) };
        });

        this.on('getTaskSummary', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 };

            // Include tasks assigned to the employee AND tasks where they are the
            // reviewer (matches the Task Description table, which shows both).
            const [assignedTasks, reviewTasks, groupTasks] = await Promise.all([
                SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId }),
                SELECT.from(TASK).where({ reviewer_employeeId: emp.employeeId }),
                myGroupTasks(emp.employeeId)
            ]);
            const taskMap = new Map();
            [...(assignedTasks || []), ...(reviewTasks || []), ...(groupTasks || [])].forEach(t => {
                if (t && t.taskId) taskMap.set(t.taskId, t);
            });
            const tasks = Array.from(taskMap.values());

            let notStarted = 0, inProgress = 0, inReview = 0, completed = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                if (s === 'notstarted' || s === 'open' || s === 'pending') notStarted++;
                else if (s === 'inprogress') inProgress++;
                else if (s === 'inreview') inReview++;
                else if (s === 'completed') completed++;
                else notStarted++; // treat unknown as not started
            });

            return {
                total: tasks.length,
                notStarted, inProgress, inReview, completed
            };
        });

        this.on('getLeaveBalance', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { casualLeave: 0, sickLeave: 0, annualLeave: 0, total: 0 };
            const LEAVE_BALANCE = 'ccentrik.employee.timesheet.schema.timesheet.LeaveBalance';
            const balance = await SELECT.one.from(LEAVE_BALANCE).where({ employee_employeeId: emp.employeeId });
            if (balance) {
                const total = (balance.casualLeave || 0) + (balance.sickLeave || 0) + (balance.annualLeave || 0);
                return { casualLeave: balance.casualLeave || 0, sickLeave: balance.sickLeave || 0, annualLeave: balance.annualLeave || 0, total };
            }
            return { casualLeave: 6, sickLeave: 4, annualLeave: 8, total: 18 };
        });

        this.on('getMyTasks', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { totalPending: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0 };

            // Include tasks assigned to the employee AND tasks where they are the
            // reviewer (matches the Task Description table, which shows both).
            const [assignedTasks, reviewTasks, groupTasks] = await Promise.all([
                SELECT.from(TASK).where({ assignedTo_employeeId: emp.employeeId }),
                SELECT.from(TASK).where({ reviewer_employeeId: emp.employeeId }),
                myGroupTasks(emp.employeeId)
            ]);
            const taskMap = new Map();
            [...(assignedTasks || []), ...(reviewTasks || []), ...(groupTasks || [])].forEach(t => {
                if (t && t.taskId) taskMap.set(t.taskId, t);
            });
            const tasks = Array.from(taskMap.values());

            let totalPending = 0, highPriorityCount = 0, mediumPriorityCount = 0, lowPriorityCount = 0;
            (tasks || []).forEach(t => {
                const s = (t.status || '').toLowerCase().replace(/\s+/g, '');
                // Everything that isn't completed counts as pending
                if (s !== 'completed') {
                    totalPending++;
                    if (t.priority === 'High') highPriorityCount++;
                    else if (t.priority === 'Medium') mediumPriorityCount++;
                    else if (t.priority === 'Low') lowPriorityCount++;
                }
            });

            return { totalPending, highPriorityCount, mediumPriorityCount, lowPriorityCount };
        });

        this.on('markAttendance', async (req) => {
            const { attendanceDate, attendanceDay, attendanceTime } = req.data;
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            if (!attendanceDate) return req.error(400, 'attendanceDate is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where('lower(email) =', email);
            if (!emp) return req.error(404, 'Employee not found for this login.');
            const existing = await SELECT.one.from(ATTENDANCE).where({ employee_employeeId: emp.employeeId, attendanceDate });
            if (existing) return req.error(409, `Attendance already marked for ${attendanceDate} at ${existing.attendanceTime}.`);
            const attendanceId = `${emp.employeeId}-${attendanceDate}`;
            await INSERT.into(ATTENDANCE).entries({
                attendanceId, employee_employeeId: emp.employeeId, attendanceDate,
                attendanceDay: attendanceDay || '',
                attendanceTime: attendanceTime || new Date().toTimeString().split(' ')[0],
                status: 'Present'
            });
            cds.log('attend').info(`Attendance marked: ${emp.employeeId} (${emp.employeeName}) on ${attendanceDate} at ${attendanceTime}`);
            return { attendanceId, employeeId: emp.employeeId, employeeName: emp.employeeName, attendanceDate, attendanceDay, attendanceTime, message: `Attendance recorded successfully for ${attendanceDay}, ${attendanceDate}.` };
        });

        this.on('getAttendance', async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { attendancePercentage: 0, presentCount: 0, absentCount: 0, monthLabel: new Date().toLocaleString('default', { month: 'long' }) };
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const monthStr = String(month).padStart(2, '0');
            const records = await SELECT.from(ATTENDANCE).where(`employee_employeeId = '${emp.employeeId}' AND attendanceDate LIKE '${year}-${monthStr}-%'`);
            const presentCount = records.length;
            let workingDays = 0;
            const d = new Date(year, month - 1, 1);
            while (d <= now && d.getMonth() === month - 1) {
                const day = d.getDay();
                if (day !== 0 && day !== 6) workingDays++;
                d.setDate(d.getDate() + 1);
            }
            const absentCount = Math.max(0, workingDays - presentCount);
            const attendancePercentage = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 0;
            return { attendancePercentage, presentCount, absentCount, monthLabel: now.toLocaleString('default', { month: 'long' }) };
        });

        this.on('getTodayAttendance', async (req) => {
            const { attendanceDate } = req.data;
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
            if (!emp) return { alreadyMarked: false, attendanceTime: null, attendanceDay: null };
            const existing = await SELECT.one.from(ATTENDANCE).where({ employee_employeeId: emp.employeeId, attendanceDate });
            return { alreadyMarked: !!existing, attendanceTime: existing ? existing.attendanceTime : null, attendanceDay: existing ? existing.attendanceDay : null };
        });

        // Issue 2: no updates may be posted on a Completed task. Guards the
        // OData create path used by the solo Task Detail "Post an update" form.
        this.before('CREATE', 'TaskUpdates', async (req) => {
            const sTaskId = req.data && (req.data.task_taskId || (req.data.task && req.data.task.taskId));
            if (!sTaskId) return;
            const task = await SELECT.one.from(TASK).columns('status').where({ taskId: sTaskId });
            if (task && task.status === 'Completed') {
                return req.reject(403, 'This task is Completed — updates are no longer allowed.');
            }
        });

        this.on('updateTaskStatus', async (req) => {
            const { taskId, status, reviewerId, reviewerStatus } = req.data;

            cds.log('task').info('updateTaskStatus →', { taskId, status, reviewerId, reviewerStatus });

            if (!taskId) return req.error(400, 'taskId is required.');
            if (!status) return req.error(400, 'status is required.');

            const task = await SELECT.one.from(TASK).where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);

            // Issue 1: once a reviewer marks a task Completed it is locked.
            // Employees cannot move it back to In Progress / Not Started / etc.
            // (Reopening, if ever needed, happens only through the reviewer's
            // "Issue Found" flow on an In-Review task — never via this action.)
            if (task.status === 'Completed') {
                return req.error(403, 'This task is completed and locked. Its status can no longer be changed.');
            }

            // Only patch reviewer fields when a real (non-empty) value is supplied.
            // Sending an empty string would try to set reviewer_employeeId = ""
            // which violates the FK and causes the entire UPDATE to fail.
            const patch = { status, statusUpdatedAt: new Date() };
            if (reviewerId && String(reviewerId).trim()) patch.reviewer_employeeId = reviewerId;
            if (reviewerStatus && String(reviewerStatus).trim()) patch.reviewerStatus = reviewerStatus;

            cds.log('task').info('updateTaskStatus patch:', JSON.stringify(patch));
            await UPDATE(TASK).set(patch).where({ taskId });
            cds.log('task').info('updateTaskStatus done for', taskId);

            // Notify reviewer when task is sent for review
            if (status === 'In Review' && reviewerId) {
                await createNotification(
                    reviewerId,
                    'TASK_REVIEW_REQUESTED',
                    'Review Requested',
                    `You have been asked to review: "${task.taskName || taskId}"`,
                    taskId
                );
            }

            // Notify assignee when reviewer marks done or reopens
            if ((status === 'Completed' || status === 'In Progress') && task.assignedTo_employeeId) {
                await createNotification(
                    task.assignedTo_employeeId,
                    'TASK_ASSIGNED',
                    status === 'Completed' ? 'Task Reviewed ✓' : 'Task Reopened',
                    status === 'Completed'
                        ? `Your task "${task.taskName || taskId}" was reviewed and marked complete.`
                        : `Your task "${task.taskName || taskId}" was reopened by the reviewer.`,
                    taskId
                );
            }

            cds.log('task').info(`Task ${taskId} status → ${status} by ${req.user?.id}`);
            return { taskId, status };
        });

        // ── Review workflow: Reviewed / Issue Found ──────────────────────────
        // Shared implementation; `decision` decides the target status.
        const handleReviewDecision = async (req, decision) => {
            const { taskId, remarks, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!remarks || !String(remarks).trim()) {
                return req.error(400, 'Remarks are required.');
            }

            const task = await SELECT.one.from(TASK).where({ taskId });
            if (!task) return req.error(404, `Task '${taskId}' not found.`);
            if (task.status !== 'In Review') {
                return req.error(400, `Task '${taskId}' is not currently In Review (status: ${task.status}).`);
            }

            // Resolve reviewer from logged-in user
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const reviewer = email
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where('lower(email) =', email)
                : null;
            if (!reviewer) return req.error(401, 'Cannot identify reviewer.');

            // Only the assigned reviewer can submit a decision
            if (task.reviewer_employeeId && task.reviewer_employeeId !== reviewer.employeeId) {
                return req.error(403, 'You are not the assigned reviewer for this task.');
            }

            // Decode optional attachment
            let attachmentBuf = null;
            let storedName = null;
            let storedMime = null;
            if (dataBase64) {
                const cleaned = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
                try {
                    attachmentBuf = Buffer.from(cleaned, 'base64');
                    if (attachmentBuf.length > 5 * 1024 * 1024) {
                        return req.error(400, 'Attachment must be under 5 MB.');
                    }
                    storedName = fileName || 'review-attachment';
                    storedMime = mimeType || 'application/octet-stream';
                } catch (e) {
                    return req.error(400, 'dataBase64 is not valid base64.');
                }
            }

            const reviewId = `${taskId}-REV-${Date.now()}`;
            const reviewedOn = new Date();
            const newTaskStatus = decision === 'Reviewed' ? 'Completed' : 'In Progress';

            // Persist review row
            await INSERT.into(TASK_REVIEW).entries({
                reviewId,
                task_taskId: taskId,
                reviewer_employeeId: reviewer.employeeId,
                assignee_employeeId: task.assignedTo_employeeId || null,
                decision,
                remarks: String(remarks).trim(),
                attachmentName: storedName,
                attachmentMimeType: storedMime,
                attachment: attachmentBuf,
                reviewedOn
            });

            // Update task status (and keep reviewerStatus in sync for legacy UI)
            await UPDATE(TASK).set({
                status: newTaskStatus,
                reviewerStatus: decision === 'Reviewed' ? 'Reviewed' : 'Issue Found',
                statusUpdatedAt: reviewedOn
            }).where({ taskId });

            // Notify the original assignee
            if (task.assignedTo_employeeId) {
                const title = decision === 'Reviewed' ? 'Task Reviewed ✓' : 'Issue Found — please rework';
                const msg = decision === 'Reviewed'
                    ? `"${task.taskName || taskId}" was reviewed by ${reviewer.employeeName} and marked Completed.`
                    : `"${task.taskName || taskId}" was returned by ${reviewer.employeeName}. Reason: ${String(remarks).trim().slice(0, 200)}`;
                await createNotification(
                    task.assignedTo_employeeId,
                    decision === 'Reviewed' ? 'TASK_ASSIGNED' : 'TASK_ASSIGNED',
                    title, msg, taskId
                );
            }

            cds.log('task').info(`Task ${taskId} review submitted: ${decision} by ${reviewer.employeeId} → status ${newTaskStatus}`);
            return { reviewId, taskId, status: newTaskStatus };
        };

        this.on('submitReview', (req) => handleReviewDecision(req, 'Reviewed'));
        this.on('reportIssue', (req) => handleReviewDecision(req, 'IssueFound'));

        // Fetch the latest review for a task (no attachment payload — use getReviewAttachment).
        this.on('getTaskReview', async (req) => {
            const { taskId } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            const reviews = await SELECT.from(TASK_REVIEW)
                .where({ task_taskId: taskId })
                .orderBy('reviewedOn desc')
                .limit(1);
            const r = reviews && reviews[0];
            if (!r) return {};
            let reviewerName = '';
            if (r.reviewer_employeeId) {
                const e = await SELECT.one.from(EMPLOYEE)
                    .columns('employeeName')
                    .where({ employeeId: r.reviewer_employeeId });
                reviewerName = (e && e.employeeName) || '';
            }
            return {
                reviewId: r.reviewId || '',
                reviewerId: r.reviewer_employeeId || '',
                reviewerName,
                decision: r.decision || '',
                remarks: r.remarks || '',
                attachmentName: r.attachmentName || '',
                reviewedOn: r.reviewedOn ? new Date(r.reviewedOn).toISOString() : ''
            };
        });

        // Stream a review attachment as base64 (mirrors consumeTaskAttachment pattern).
        this.on('getReviewAttachment', async (req) => {
            const { reviewId } = req.data;
            if (!reviewId) return req.error(400, 'reviewId is required.');
            const r = await SELECT.one.from(TASK_REVIEW)
                .columns('reviewId', 'attachment', 'attachmentName', 'attachmentMimeType')
                .where({ reviewId });
            if (!r) return req.error(404, `Review '${reviewId}' not found.`);
            if (!r.attachment) return req.error(404, 'No attachment on this review.');
            let base64 = '';
            try {
                const a = r.attachment;
                if (Buffer.isBuffer(a)) base64 = a.toString('base64');
                else if (typeof a === 'string') base64 = a;
                else if (a instanceof Uint8Array) base64 = Buffer.from(a).toString('base64');
                else base64 = Buffer.from(a).toString('base64');
            } catch (e) {
                return req.error(500, 'Could not read attachment.');
            }
            return {
                fileName: r.attachmentName || 'attachment',
                mimeType: r.attachmentMimeType || 'application/octet-stream',
                dataBase64: base64
            };
        });

        await registerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

class ManagerService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'Manager' scope AND EmployeeMaster.role === 'manager'.
        this.before('*', requireMatchingRole('manager'));
        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        // Issue 4: a manager may create an INDIVIDUAL task only for an employee who
        // reports directly to them and is active. Enforced at the data layer so it
        // holds even if the UI is bypassed (direct OData CREATE on /manager/Tasks).
        this.before('CREATE', 'Tasks', async (req) => {
            const assigneeId = req.data && req.data.assignedTo_employeeId;
            if (!assigneeId) return;                       // unassigned drafts are unaffected
            const err = await this._assertAssignable(req, assigneeId);
            if (err) return req.reject(403, err);
        });

        this.on('approveTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (header.status !== 'Pending') return req.error(400, `Cannot approve — current status is '${header.status}'.`);
            // Issue 4: only the employee's assigned manager may approve.
            if (!(await this._managesEmployee(req, header.employee_employeeId))) {
                return req.error(403, 'You are not authorised to approve this timesheet.');
            }
            await UPDATE(HEADER).set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
            const hdr = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr) await createNotification(hdr.employee_employeeId, 'TIMESHEET_APPROVED', 'Timesheet Approved ✓', `Your timesheet ${timesheetId} has been approved.${remarks ? ' Remarks: ' + remarks : ''}`, timesheetId);
            await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Approved' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' approved.`;
        });

        this.on('submitPerformanceRating', async (req) => {
            const { employeeId, ratingValue, reviewMonth, reviewYear, reviewComment, ratingCategory } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            if (!ratingValue) return req.error(400, 'ratingValue is required.');
            if (!reviewMonth) return req.error(400, 'reviewMonth is required.');
            if (!reviewYear) return req.error(400, 'reviewYear is required.');

            // ── Validate manager is rating their own team member ──
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;
            if (!manager) return req.error(403, 'Manager record not found.');

            const emp = await SELECT.one.from(EMPLOYEE)
                .where({ employeeId, manager_employeeId: manager.employeeId, isActive: true });
            if (!emp) return req.error(403, `You are not authorised to rate employee '${employeeId}'.`);
            // ─────────────────────────────────────────────────────

            const PERF = 'ccentrik.employee.timesheet.schema.timesheet.PerformanceRating';
            const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const period = `${MN[reviewMonth] || reviewMonth} ${reviewYear}`;

            // Issue 5: one rating per employee per month — never overwrite history.
            const existing = await SELECT.one.from(PERF).where({ employee_employeeId: employeeId, reviewMonth, reviewYear });
            if (existing) {
                return req.error(409, `Rating for this employee has already been submitted for ${period}.`);
            }
            const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2, '0')}`;

            // Insert only. The deterministic ratingId is the primary key, so a
            // concurrent duplicate (race past the SELECT) fails here — caught and
            // surfaced as the same friendly "already submitted" message.
            try {
                await INSERT.into(PERF).entries({ ratingId, employee_employeeId: employeeId, ratingValue, reviewMonth, reviewYear, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' });
            } catch (e) {
                return req.error(409, `Rating for this employee has already been submitted for ${period}.`);
            }
            await createNotification(
                employeeId, 'PERFORMANCE_RATED', 'New Performance Rating ⭐',
                `${manager.employeeName || 'Your manager'} rated you ${ratingValue}/5` +
                    `${ratingCategory ? ' (' + ratingCategory + ')' : ''} for ${period}.` +
                    `${reviewComment ? ' Comment: ' + reviewComment : ''}`,
                ratingId
            );
            return { ratingId, message: `Rating submitted for ${employeeId} — ${reviewMonth}/${reviewYear}` };
        });

        
        this.on('notifyTaskAssignment', async (req) => {
            const { taskId, taskName, taskDescription, priority, dueDate, assigneeId } = req.data;
            const employee = await SELECT.one.from(EMPLOYEE).where({ employeeId: assigneeId });
            if (!employee) return req.error(404, `Employee '${assigneeId}' not found.`);
            if (!employee.email) return req.error(400, `Employee '${assigneeId}' has no email on file.`);
            const prefix = PRIORITY_PREFIX[priority] || `[${priority || 'Normal'} Priority]`;
            const subject = `${prefix} New task assigned: ${taskName}`;
            const body = `Hi ${employee.employeeName || ''},\n\nYou have been assigned a new task by your manager.\n\nTask ID:     ${taskId}\nTask:        ${taskName}\nPriority:    ${priority || 'Normal'}\n${dueDate ? `Due Date:    ${dueDate}\n` : ''}\nDescription:\n${taskDescription || '(no description)'}\n\nPlease open your Timesheet app to view the full details.\n\n— Timesheet System`;
            const from = process.env.SMTP_FROM || 'no-reply@timesheet.local';
            const mailer = getMailer();
            if (mailer) {
                try {
                    await mailer.sendMail({ from, to: employee.email, subject, text: body });
                    return { sent: true, recipient: employee.email, subject, message: 'Email sent.' };
                } catch (e) { cds.log('mail').error('Failed to send email:', e.message || e); }
            }
            await createNotification(assigneeId, 'TASK_ASSIGNED', `New Task: ${taskName}`, `You have been assigned "${taskName}" (${priority || 'Normal'} priority).`, taskId);
            cds.log('mail').info(`[Email simulated]\nFROM: ${from}\nTO: ${employee.email}\nSUBJECT: ${subject}\n${body}`);
            return { sent: false, recipient: employee.email, subject, message: 'SMTP not configured — email content was logged on the server.' };
        });

        this.on('rejectTimesheet', async (req) => {
            const { timesheetId, remarks } = req.data;
            const header = await SELECT.one.from(HEADER).where({ timesheetId });
            if (!header) return req.error(404, `Timesheet '${timesheetId}' not found.`);
            if (header.status !== 'Pending') return req.error(400, `Cannot reject — current status is '${header.status}'.`);
            // Issue 4: only the employee's assigned manager may reject.
            if (!(await this._managesEmployee(req, header.employee_employeeId))) {
                return req.error(403, 'You are not authorised to reject this timesheet.');
            }
            await UPDATE(HEADER).set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
            const hdr2 = await SELECT.one.from(HEADER).columns('employee_employeeId').where({ timesheetId });
            if (hdr2) await createNotification(hdr2.employee_employeeId, 'TIMESHEET_REJECTED', 'Timesheet Returned ✗', `Your timesheet ${timesheetId} was returned.${remarks ? ' Reason: ' + remarks : ''}`, timesheetId);
            await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' }).where({ timesheet_timesheetId: timesheetId });
            return `Timesheet '${timesheetId}' rejected. Employee can edit and resubmit.`;
        });

        this.on('uploadTaskAttachment', async (req) => {
            const { taskId, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!fileName) return req.error(400, 'fileName is required.');
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');
            const exists = await SELECT.one.from(TASK).columns('taskId').where({ taskId });
            if (!exists) return req.error(404, `Task '${taskId}' not found.`);
            const cleaned = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
            let buf;
            try { buf = Buffer.from(cleaned, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            await UPDATE(TASK).set({ attachment: buf, attachmentName: fileName, attachmentMimeType: mimeType || 'application/octet-stream' }).where({ taskId });
            cds.log('attach').info(`Attachment '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return `Attachment uploaded for task '${taskId}'.`;
        });

        // Attach ONE document to a task. Called once per file, so a manager can
        // attach multiple documents to the same task. Stored in TaskDocument and
        // downloadable (non-destructively) by every assignee/reviewer.
        this.on('uploadTaskDocument', async (req) => {
            const { taskId, fileName, mimeType, dataBase64 } = req.data;
            if (!taskId) return req.error(400, 'taskId is required.');
            if (!fileName) return req.error(400, 'fileName is required.');
            if (!dataBase64) return req.error(400, 'dataBase64 is required.');
            const exists = await SELECT.one.from(TASK).columns('taskId').where({ taskId });
            if (!exists) return req.error(404, `Task '${taskId}' not found.`);
            let buf;
            try { buf = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            if (buf.length > 10 * 1024 * 1024) return req.error(400, 'Document exceeds the 10 MB limit.');

            const user = req.user || {};
            const callerEmail = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const uploader = callerEmail
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', callerEmail)
                : null;

            const documentId = `${taskId}-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(TASK_DOCUMENT).entries({
                documentId,
                task_taskId: taskId,
                fileName,
                mimeType: mimeType || 'application/octet-stream',
                fileSize: buf.length,
                content: buf,
                uploadedBy_employeeId: uploader ? uploader.employeeId : null
            });
            cds.log('attach').info(`Task document '${fileName}' (${buf.length} bytes) stored for task ${taskId}`);
            return { documentId };
        });

        // ── Create a group task + seed its assignees (manager only) ────────────
        this.on('createGroupTask', async (req) => {
            const d = req.data || {};
            const assignees = (d.assignees || []).filter(a => a && a.employeeId);
            if (!d.taskName || !d.taskName.trim()) return req.error(400, 'Task name is required.');
            // De-duplicate employee ids defensively.
            const seen = new Set();
            const uniq = assignees.filter(a => (seen.has(a.employeeId) ? false : (seen.add(a.employeeId), true)));
            if (uniq.length < 2) return req.error(400, 'Select at least 2 employees for a group task.');

            // Issue 4: every member must report directly to the caller and be active.
            // Backend-enforced so a forged request can't add unrelated employees.
            for (const a of uniq) {
                const err = await this._assertAssignable(req, a.employeeId);
                if (err) return req.error(403, err);
            }

            const taskId = await nextGroupTaskId();
            await INSERT.into(TASK).entries({
                taskId,
                taskName: d.taskName.trim(),
                taskDescription: (d.taskDescription || '').trim(),
                priority: d.priority || 'Medium',
                status: 'In Progress',
                taskType: 'group',
                startDate: d.startDate || null,
                dueDate: d.dueDate || null
            });

            for (const a of uniq) {
                await INSERT.into(TASK_ASSIGNEE).entries({
                    assignmentId: `${taskId}-AS-${a.employeeId}`,
                    task_taskId: taskId,
                    assignee_employeeId: a.employeeId,
                    status: 'pending',
                    note: a.note || null
                });
            }

            // Notify each assignee they were added to a group task.
            for (const a of uniq) {
                await createNotification(a.employeeId, 'GROUP_TASK_ASSIGNED', 'New group task',
                    `You've been added to the group task “${d.taskName.trim()}”.`, taskId);
            }

            cds.log('group').info(`Group task ${taskId} created with ${uniq.length} assignees`);
            return { taskId };
        });

        this.on('approveLeave', async (req) => {
            const { leaveId, approved, remarks } = req.data;
            if (!leaveId) return req.error(400, 'leaveId is required.');
            const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
            if (!leave) return req.error(404, `Leave request '${leaveId}' not found.`);
            if (leave.status !== 'Pending') return req.error(400, `Leave is already '${leave.status}'.`);
            const newStatus = approved ? 'Approved' : 'Rejected';
            await UPDATE(LEAVE_REQUEST).set({ status: newStatus, managerRemarks: remarks || '', approvedOn: new Date() }).where({ leaveId });

            // Issue 2: in-app notification to the employee (always — independent of SMTP).
            await createNotification(
                leave.employee_employeeId,
                approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                approved ? 'Leave Approved ✓' : 'Leave Rejected ✗',
                approved
                    ? `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was approved.${remarks ? ' Remarks: ' + remarks : ''}`
                    : `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was rejected.${remarks ? ' Reason: ' + remarks : ''}`,
                leaveId
            );

            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId: leave.employee_employeeId });
            if (emp && emp.email) {
                const mailer = getMailer();
                const subject = `Your leave request has been ${newStatus}`;
                const body = `Hi ${emp.employeeName || ''},\n\nYour leave request has been ${newStatus.toLowerCase()} by your manager.\n\nLeave Type : ${leave.leaveType}\nFrom       : ${leave.fromDate}\nTo         : ${leave.toDate}\nDays       : ${leave.days}\n${remarks ? `Remarks    : ${remarks}\n` : ''}\n— Timesheet System`;
                if (mailer) {
                    try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: emp.email, subject, text: body }); }
                    catch (e) { cds.log('mail').warn('Leave approval email failed:', e.message); }
                } else { cds.log('leave').info(`[Email simulated] TO: ${emp.email}\n${body}`); }
            }
            cds.log('leave').info(`Leave ${leaveId} ${newStatus} by manager`);
            return { leaveId, status: newStatus };
        });
        // read manager associated employees for Employee Management and Team Attendance features
        this.on('READ', 'Employees', async (req) => {
            // Resolve logged-in manager from email
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();

            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;

            if (!manager) return req.error(404, 'Manager record not found.');

            // Return only employees reporting to this manager
            return await SELECT.from(EMPLOYEE)
                .columns('employeeId', 'employeeName', 'designation', 'email', 'isActive')
                .where({
                    manager_employeeId: manager.employeeId,
                    isActive: true
                })
                .orderBy('employeeName');
        });

        // ── Issue 4: strict manager-scoped visibility ─────────────────────────
        // The projections (PendingApprovals / PrevWeekRequests / LeaveRequests)
        // had no manager filter, so EVERY manager could see (and act on) other
        // managers' employees' requests. These before-READ hooks restrict every
        // read to the logged-in manager's own team. Using req.query.where keeps
        // OData $expand / paging / the projection's status filter intact.
        const _resolveManager = async (req) => {
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            return email
                ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email)
                : null;
        };
        const _teamIdsOf = async (managerId) => {
            const rows = await SELECT.from(EMPLOYEE).columns('employeeId')
                .where({ manager_employeeId: managerId });
            return rows.map(r => r.employeeId);
        };
        // Impossible value → guarantees an empty result set (avoids `IN ()`).
        const NO_MATCH = '___no_manager_match___';

        // Timesheet approvals: header has no manager field → scope via the
        // employee's manager (the manager's direct-report ids).
        this.before('READ', 'PendingApprovals', async (req) => {
            const mgr = await _resolveManager(req);
            if (!mgr) { req.query.where('employee_employeeId =', NO_MATCH); return; }
            const ids = await _teamIdsOf(mgr.employeeId);
            req.query.where('employee_employeeId in', ids.length ? ids : [NO_MATCH]);
        });

        // Leave requests: same scoping via the employee's manager.
        this.before('READ', 'LeaveRequests', async (req) => {
            const mgr = await _resolveManager(req);
            if (!mgr) { req.query.where('employee_employeeId =', NO_MATCH); return; }
            const ids = await _teamIdsOf(mgr.employeeId);
            req.query.where('employee_employeeId in', ids.length ? ids : [NO_MATCH]);
        });

        // Prev-week requests store the target manager directly → strict routing:
        // only the manager the request was assigned to can see it.
        this.before('READ', 'PrevWeekRequests', async (req) => {
            const mgr = await _resolveManager(req);
            req.query.where('manager_employeeId =', mgr ? mgr.employeeId : NO_MATCH);
        });

        // ── Team Attendance grid ──────────────────────────────────────────
        // Returns a per-employee, per-day status grid for the manager's team
        // for the requested month.  Cell statuses:
        //   P   = Present  (attendance record exists)
        //   A   = Absent   (working day, no attendance, no leave)
        //   H   = Holiday  (matches HolidayMaster row)
        //   W   = Weekend  (Saturday/Sunday)
        //   CL  = Casual Leave  (approved)
        //   SL  = Sick Leave    (approved)
        //   PL  = Paid Leave    (approved)
        //   ML  = Maternity Leave (approved)
        //   PtL = Paternity Leave (approved)
        this.on('getTeamAttendance', async (req) => {
            const { year, month } = req.data;
            if (!year || !month) return req.error(400, 'year and month are required.');
            if (month < 1 || month > 12) return req.error(400, 'month must be 1-12.');

            // 1. Resolve the logged-in manager
            const user = req.user || {};
            const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
            const manager = email
                ? await SELECT.one.from(EMPLOYEE).where('lower(email) =', email)
                : null;
            if (!manager) return req.error(404, 'Manager record not found.');

            // 2. All direct reports (active)
            const team = await SELECT.from(EMPLOYEE)
                .columns('employeeId', 'employeeName', 'designation', 'email')
                .where({ manager_employeeId: manager.employeeId, isActive: true });
            team.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

            if (!team.length) {
                return { employees: '[]', holidays: '[]', daysInMonth: new Date(year, month, 0).getDate() };
            }
            const teamIds = team.map(e => e.employeeId);

            // 3. Month boundaries (use UTC-aligned ISO dates so timezone never shifts a day)
            const daysInMonth = new Date(year, month, 0).getDate();
            const pad = (n) => String(n).padStart(2, '0');
            const isoStart = `${year}-${pad(month)}-01`;
            const isoEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;

            // 4. Fetch all relevant data in parallel
            const [attendance, leaves, holidays] = await Promise.all([
                SELECT.from(ATTENDANCE).where({ employee_employeeId: { in: teamIds } }),
                SELECT.from(LEAVE_REQUEST).where({ employee_employeeId: { in: teamIds }, status: 'Approved' }),
                SELECT.from(HOLIDAY)
            ]);

            // 5. Index attendance: empId → date → { time }
            const attMap = new Map();
            for (const a of attendance) {
                const dt = String(a.attendanceDate || '').slice(0, 10);
                if (dt < isoStart || dt > isoEnd) continue;
                if (!attMap.has(a.employee_employeeId)) attMap.set(a.employee_employeeId, new Map());
                attMap.get(a.employee_employeeId).set(dt, { time: a.attendanceTime || '' });
            }

            // 6. Index leaves: empId → date → leaveCode
            const leaveCode = (t) => {
                const lc = String(t || '').toLowerCase();
                if (lc.includes('casual')) return 'CL';
                if (lc.includes('sick')) return 'SL';
                if (lc.includes('paternity')) return 'PtL';
                if (lc.includes('maternity')) return 'ML';
                if (lc.includes('paid')) return 'PL';
                return 'L';
            };
            const leaveMap = new Map();
            for (const l of leaves) {
                const code = leaveCode(l.leaveType);
                const from = String(l.fromDate || '').slice(0, 10);
                const to = String(l.toDate || '').slice(0, 10);
                if (!from || !to) continue;
                // Walk each calendar date in the leave range that falls in this month.
                const startD = new Date(`${from}T00:00:00Z`);
                const endD = new Date(`${to}T00:00:00Z`);
                for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
                    const key = d.toISOString().slice(0, 10);
                    if (key < isoStart || key > isoEnd) continue;
                    if (!leaveMap.has(l.employee_employeeId)) leaveMap.set(l.employee_employeeId, new Map());
                    leaveMap.get(l.employee_employeeId).set(key, code);
                }
            }

            // 7. Index holidays: date → name (only those in this month)
            const holidayMap = new Map();
            for (const h of holidays) {
                const dt = String(h.holidayDate || '').slice(0, 10);
                if (dt >= isoStart && dt <= isoEnd) holidayMap.set(dt, h.holidayName);
            }

            // 8. Build per-employee day grid
            // "today" is computed once per request so the grid renders
            // future dates as a neutral "F" (no entry yet) rather than "A".
            const todayIso = new Date().toISOString().slice(0, 10);

            const result = team.map(emp => {
                const days = [];
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `${year}-${pad(month)}-${pad(d)}`;
                    const dow = new Date(`${key}T00:00:00Z`).getUTCDay(); // 0=Sun 6=Sat
                    let status, time = '';
                    if (holidayMap.has(key)) {
                        status = 'H';
                    } else if (dow === 0 || dow === 6) {
                        status = 'W';
                    } else if (key > todayIso) {
                        // Future working day — no entry yet, render as blank/grey.
                        status = 'F';
                    } else {
                        const att = attMap.get(emp.employeeId) && attMap.get(emp.employeeId).get(key);
                        if (att) {
                            status = 'P';
                            time = att.time || '';
                        } else {
                            const lv = leaveMap.get(emp.employeeId) && leaveMap.get(emp.employeeId).get(key);
                            status = lv || 'A';
                        }
                    }
                    days.push({ date: key, status, time });
                }
                return {
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName || '',
                    designation: emp.designation || '',
                    email: emp.email || '',
                    days
                };
            });

            const holidayArr = Array.from(holidayMap.entries())
                .map(([date, name]) => ({ date, name }))
                .sort((a, b) => a.date.localeCompare(b.date));

            return {
                employees: JSON.stringify(result),
                holidays: JSON.stringify(holidayArr),
                daysInMonth
            };
        });

        await registerManagerTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }

    // Issue 4: true only when the logged-in manager is the assigned manager of
    // the given employee. Used to gate approve/reject so a manager can never act
    // on another team's request, even via a direct API call.
    async _managesEmployee(req, sEmployeeId) {
        if (!sEmployeeId) return false;
        const user = req.user || {};
        const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
        if (!email) return false;
        const manager = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email);
        if (!manager) return false;
        const emp = await SELECT.one.from(EMPLOYEE)
            .columns('manager_employeeId').where({ employeeId: sEmployeeId });
        return !!(emp && emp.manager_employeeId === manager.employeeId);
    }

    // Issue 4: validate that the caller (a manager) may assign a task to
    // `employeeId`. The employee must exist, be active, AND report directly to the
    // caller. Returns null when allowed, otherwise a user-facing error message.
    // Used by both the individual-task CREATE guard and createGroupTask so the rule
    // is identical for solo and group assignment.
    async _assertAssignable(req, employeeId) {
        if (!employeeId) return 'An assignee is required.';
        const user = req.user || {};
        const email = (((user.attr && (user.attr.email || user.attr.mail)) || user.id || '') + '').trim().toLowerCase();
        const manager = email
            ? await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', email)
            : null;
        if (!manager) return 'Could not resolve your manager account.';
        const emp = await SELECT.one.from(EMPLOYEE)
            .columns('employeeId', 'manager_employeeId', 'isActive')
            .where({ employeeId });
        if (!emp) return `Employee '${employeeId}' not found.`;
        if (emp.isActive === false) return `Employee '${employeeId}' is inactive.`;
        if (emp.manager_employeeId !== manager.employeeId) {
            return 'You can only assign tasks to employees associated with your account.';
        }
        return null;
    }
}

const DOCUMENT = 'ccentrik.employee.timesheet.schema.timesheet.EmployeeDocument';
class HRService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'HR' scope AND EmployeeMaster.role === 'hr'.
        this.before('*', requireMatchingRole('hr'));
        this.before('*', blockIfInactive);
        this.after('*', emitFounderPing);

        const generateEmployeeId = async () => {
            const rows = await SELECT.from(EMPLOYEE).columns('employeeId');
            const max = rows.reduce((m, r) => { const n = parseInt(String(r.employeeId || '').replace(/\D/g, ''), 10); return Number.isFinite(n) && n > m ? n : m; }, 1000);
            return 'EMP' + (max + 1);
        };

        this.on('nextEmployeeId', async () => await generateEmployeeId());

        this.on('getResourceHierarchy', async () => {
            try { return JSON.stringify(await buildResourceHierarchy()); }
            catch (e) { return JSON.stringify({ error: 'Could not load resource hierarchy.' }); }
        });

        // Talent-taxonomy typeahead + create-if-not-exists.
        this.on('searchTaxonomy', async (req) => {
            const d = req.data || {};
            const scope = d.type === 'role' ? d.departmentId : (d.type === 'module' ? d.roleId : null);
            try { return JSON.stringify(await searchTaxonomy(d.type, d.q, scope)); }
            catch (e) { return JSON.stringify({ error: 'Search failed.' }); }
        });
        this.on('upsertTaxonomy', async (req) => {
            const d = req.data || {};
            const scope = d.type === 'role' ? d.departmentId : (d.type === 'module' ? d.roleId : null);
            try { return JSON.stringify(await upsertTaxonomy(d.type, d.name, scope, { departmentId: d.departmentId })); }
            catch (e) { return JSON.stringify({ error: 'Could not save the value.' }); }
        });
        this.on('searchLanguages', async (req) => {
            try {
                const q = normalizeTaxonomy(req.data.q || '');
                const rows = await SELECT.from(EMPLOYEE).columns('languages').where({ isActive: true });
                const set = new Set();
                (rows || []).forEach(r => String(r.languages || '').split(',').forEach(x => { const v = normalizeTaxonomy(x); if (v) set.add(v); }));
                let list = [...set]; if (q) list = list.filter(v => v.includes(q)); list.sort();
                return JSON.stringify({ suggestions: list.slice(0, 25) });
            } catch (e) { return JSON.stringify({ suggestions: [] }); }
        });

        this.on('addEmployee', async (req) => {
            const d = req.data || {};
            if (!d.employeeName) return req.error(400, 'employeeName is required.');
            if (!d.email) return req.error(400, 'email is required.');
            // Identity is resolved by matching the IdP-asserted email against this
            // column on every request, so store a single canonical form (trimmed,
            // lower-cased). Without this, a mismatched case means login works but
            // no per-user data (dashboard tiles, anniversary, leave…) ever resolves.
            const normEmail = String(d.email).trim().toLowerCase();
            const dup = await SELECT.one.from(EMPLOYEE).where('lower(email) =', normEmail);
            if (dup) return req.error(409, `An employee with email '${normEmail}' already exists.`);
            // Authoritative role — normalised to a canonical lowercase value so the
            // login/authorization checks match (e.g. 'HR' → 'hr'). Defaults to
            // 'employee' when omitted or invalid, never an elevated role.
            const role = normalizeRole(d.role) || 'employee';
            const newId = await generateEmployeeId();
            await INSERT.into(EMPLOYEE).entries({
                employeeId: newId, employeeName: d.employeeName, designation: d.designation || null, role,
                email: normEmail, address: d.address || null, mobileNumber: d.mobileNumber || null,
                manager_employeeId: d.managerEmployeeId || null, isActive: true,
                dateOfBirth: d.dateOfBirth || null, gender: d.gender || null, department: d.department || null,
                joiningDate: d.joiningDate || null, employmentType: d.employmentType || null,
                aadhaarNumber: d.aadhaarNumber || null, panNumber: d.panNumber || null, status: 'Active',
                emergencyContact: d.emergencyContact || null, bloodGroup: d.bloodGroup || null,
                bankAccountNumber: d.bankAccountNumber || null, bankName: d.bankName || null, bankIfsc: d.bankIfsc || null,
                // Work location + marital details (were previously collected but never saved).
                workLocation: d.workLocation || null, maritalStatus: d.maritalStatus || null,
                fatherName: d.fatherName || null, partnerName: d.partnerName || null,
                marriageDate: d.marriageDate || null, hasKids: d.hasKids || null,
                ...resourceProfilePatch(d)
            });
            await syncEmployeeLinks(newId, d.skills, d.certifications);
            await upsertSalaryFromCtc(newId, d.employeeName, d.ctc, 160);
            cds.log('hr').info(`HR created employee ${newId} (${d.employeeName})`);
            return { employeeId: newId };
        });

        this.on('uploadEmployeeDocument', async (req) => {
            const { employeeId, documentType, fileName, mimeType, description, dataBase64 } = req.data;
            if (!employeeId || !fileName || !dataBase64) return req.error(400, 'employeeId, fileName and dataBase64 are required.');
            const emp = await SELECT.one.from(EMPLOYEE).where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            let buf;
            try { buf = Buffer.from(dataBase64, 'base64'); }
            catch (e) { return req.error(400, 'dataBase64 is not valid base64.'); }
            const documentId = `${employeeId}-DOC-${Date.now()}`;
            await INSERT.into(DOCUMENT).entries({ documentId, employee_employeeId: employeeId, documentType: documentType || 'Other', fileName, mimeType: mimeType || 'application/octet-stream', description: description || null, content: buf });
            cds.log('hr').info(`Uploaded ${fileName} (${buf.length} bytes) for ${employeeId}`);
            return documentId;
        });

        this.on('getEmployeeDocument', async (req) => {
            const { documentId } = req.data;
            if (!documentId) return req.error(400, 'documentId is required.');
            const doc = await SELECT.one.from(DOCUMENT).columns('documentId', 'fileName', 'mimeType', 'content').where({ documentId });
            if (!doc) return req.error(404, `Document '${documentId}' not found.`);
            if (!doc.content) return req.error(404, 'Document has no content.');
            let dataBase64 = '';
            try {
                const content = doc.content;
                if (Buffer.isBuffer(content)) dataBase64 = content.toString('base64');
                else if (content instanceof Uint8Array) dataBase64 = Buffer.from(content).toString('base64');
                else if (typeof content === 'string') dataBase64 = content; // legacy base64 text
                else if (content && typeof content.pipe === 'function') {
                    // CAP returns LargeBinary as a Readable stream via CQN (both
                    // SQLite and HANA). Must consume it into a Buffer — the old
                    // Buffer.from(stream) failed, causing "Could not download".
                    const chunks = [];
                    for await (const chunk of content) chunks.push(chunk);
                    dataBase64 = Buffer.concat(chunks).toString('base64');
                } else {
                    dataBase64 = Buffer.from(content).toString('base64');
                }
            } catch (e) {
                cds.log('hr').error('Could not read document:', e.message);
                return req.error(500, 'Could not read document.');
            }
            if (!dataBase64) return req.error(404, 'Document has no content.');
            return { fileName: doc.fileName, mimeType: doc.mimeType || 'application/octet-stream', dataBase64 };
        });

        // ── Rich certifications (per-certificate document) ────────────────────
        this.on('saveEmployeeCertification', async (req) => {
            const d = req.data || {};
            if (!d.employeeId || !String(d.certName || '').trim()) return JSON.stringify({ error: 'Employee and certification name are required.' });
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ employeeId: d.employeeId });
            if (!emp) return JSON.stringify({ error: 'Employee not found.' });
            // Dedup + create in the certification taxonomy (case-insensitive).
            const up = await upsertTaxonomy('certification', d.certName, null, {});
            if (up.error) return JSON.stringify({ error: up.error });
            const id = `${d.employeeId}-${up.id}`.slice(0, 55);
            let buf = null, fileName = null, mime = null;
            if (d.dataBase64) {
                try { buf = Buffer.from(d.dataBase64, 'base64'); } catch (e) { return JSON.stringify({ error: 'Invalid file data.' }); }
                if (buf.length > 5 * 1024 * 1024) return JSON.stringify({ error: 'File exceeds 5MB.' });
                fileName = d.fileName || 'certificate'; mime = d.mimeType || 'application/octet-stream';
            }
            const row = {
                id, employee_employeeId: d.employeeId, certification_certId: up.id, certName: up.name,
                certificateNumber: String(d.certificateNumber || '').trim() || null, issuedBy: String(d.issuedBy || '').trim() || null,
                obtainedDate: d.issueDate || null, expiryDate: d.expiryDate || null
            };
            // Keep an existing file when none is re-supplied on edit.
            const existing = await SELECT.one.from(EMP_CERT).columns('id', 'documentFileName').where({ id });
            if (buf) { row.document = buf; row.documentFileName = fileName; row.documentMimeType = mime; }
            else if (!existing) { row.document = null; row.documentFileName = null; row.documentMimeType = null; }
            await UPSERT.into(EMP_CERT).entries(row);
            await refreshCertCache(d.employeeId);
            return JSON.stringify({ ok: true, id, certName: up.name });
        });

        this.on('getEmployeeCertifications', async (req) => {
            const rows = await SELECT.from(EMP_CERT)
                .columns('id', 'certName', 'certificateNumber', 'issuedBy', 'obtainedDate', 'expiryDate', 'documentFileName', 'documentMimeType')
                .where({ employee_employeeId: req.data.employeeId }).orderBy('certName asc');
            return JSON.stringify({
                certifications: (rows || []).map(r => ({
                    id: r.id, certName: r.certName, certificateNumber: r.certificateNumber || '', issuedBy: r.issuedBy || '',
                    issueDate: r.obtainedDate, expiryDate: r.expiryDate, fileName: r.documentFileName || '',
                    mimeType: r.documentMimeType || '', hasDocument: !!r.documentFileName
                }))
            });
        });

        this.on('getCertificationDocument', async (req) => {
            const doc = await SELECT.one.from(EMP_CERT).columns('documentFileName', 'documentMimeType', 'document').where({ id: req.data.id });
            if (!doc || !doc.document) return req.error(404, 'No document for this certification.');
            let dataBase64 = '';
            try {
                const c = doc.document;
                if (Buffer.isBuffer(c)) dataBase64 = c.toString('base64');
                else if (c instanceof Uint8Array) dataBase64 = Buffer.from(c).toString('base64');
                else if (typeof c === 'string') dataBase64 = c;
                else if (c && typeof c.pipe === 'function') { const chunks = []; for await (const ch of c) chunks.push(ch); dataBase64 = Buffer.concat(chunks).toString('base64'); }
                else dataBase64 = Buffer.from(c).toString('base64');
            } catch (e) { return req.error(500, 'Could not read document.'); }
            return { fileName: doc.documentFileName || 'certificate', mimeType: doc.documentMimeType || 'application/octet-stream', dataBase64 };
        });

        this.on('deleteEmployeeCertification', async (req) => {
            const row = await SELECT.one.from(EMP_CERT).columns('employee_employeeId').where({ id: req.data.id });
            if (!row) return JSON.stringify({ error: 'Certification not found.' });
            await DELETE.from(EMP_CERT).where({ id: req.data.id });
            await refreshCertCache(row.employee_employeeId);
            return JSON.stringify({ ok: true });
        });

        // ── Activate / deactivate an employee ─────────────────────────────────
        this.on('setEmployeeStatus', async (req) => {
            const { employeeId, isActive } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            const status = isActive ? 'Active' : 'Inactive';
            await UPDATE(EMPLOYEE).set({ isActive: !!isActive, status }).where({ employeeId });
            cds.log('hr').info(`Employee ${employeeId} set ${status} by HR`);
            return { employeeId, isActive: !!isActive, status };
        });

        // ── Inline edit of an employee's profile fields ───────────────────────
        // Only fields that are actually provided (non-null/non-undefined) are
        // applied, so the drawer can send partial updates without wiping data.
        this.on('updateEmployee', async (req) => {
            const d = req.data || {};
            if (!d.employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId').where({ employeeId: d.employeeId });
            if (!emp) return req.error(404, `Employee '${d.employeeId}' not found.`);

            // Email uniqueness guard (if email is being changed). Normalize to the
            // same canonical form used for identity resolution on every request.
            if (d.email) {
                d.email = String(d.email).trim().toLowerCase();
                const dup = await SELECT.one.from(EMPLOYEE).columns('employeeId').where('lower(email) =', d.email);
                if (dup && dup.employeeId !== d.employeeId) {
                    return req.error(409, `Another employee already uses email '${d.email}'.`);
                }
            }

            const patch = {};
            const map = {
                employeeName: 'employeeName', designation: 'designation', email: 'email',
                address: 'address', mobileNumber: 'mobileNumber', department: 'department',
                employmentType: 'employmentType', emergencyContact: 'emergencyContact',
                managerEmployeeId: 'manager_employeeId'
            };
            Object.keys(map).forEach(k => {
                if (d[k] !== undefined && d[k] !== null) patch[map[k]] = d[k];
            });
            // Role is normalised to a canonical value; an invalid value is ignored
            // (left unchanged) rather than silently downgrading the employee.
            if (d.role !== undefined && d.role !== null && d.role !== '') {
                const nr = normalizeRole(d.role);
                if (!nr) return req.error(400, `Invalid role '${d.role}'. Allowed: ${VALID_ROLES.join(', ')}.`);
                patch.role = nr;
            }
            // Hierarchical resource-profile fields (additive).
            Object.assign(patch, resourceProfilePatch(d));
            const hasCtc = (d.ctc !== undefined && d.ctc !== null && d.ctc !== '');
            if (!Object.keys(patch).length && !hasCtc) return { employeeId: d.employeeId, message: 'Nothing to update.' };

            if (Object.keys(patch).length) {
                await UPDATE(EMPLOYEE).set(patch).where({ employeeId: d.employeeId });
                await syncEmployeeLinks(d.employeeId, d.skills, d.certifications);
            }
            if (hasCtc) {
                const e2 = await SELECT.one.from(EMPLOYEE).columns('employeeName', 'monthlyCapacityHours').where({ employeeId: d.employeeId });
                await upsertSalaryFromCtc(d.employeeId, e2 && e2.employeeName, d.ctc, e2 && e2.monthlyCapacityHours);
            }
            cds.log('hr').info(`Employee ${d.employeeId} updated by HR (${Object.keys(patch).join(', ')})`);
            return { employeeId: d.employeeId, message: 'Employee updated successfully.' };
        });

        // ── Reset password ────────────────────────────────────────────────────
        // Identities are managed by the IdP (XSUAA in prod, mocked in dev) — there
        // is no local password store, so we return an informative message.
        this.on('resetEmployeePassword', async (req) => {
            const { employeeId } = req.data;
            if (!employeeId) return req.error(400, 'employeeId is required.');
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'email').where({ employeeId });
            if (!emp) return req.error(404, `Employee '${employeeId}' not found.`);
            return {
                success: false,
                message: `Passwords are managed by the identity provider. Please trigger a reset for ${emp.email || employeeId} from the IdP / SAP BTP cockpit.`
            };
        });

        await registerHRTimesheetHandlers(this, getMailer, createNotification);
        return super.init();
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FOUNDER ANALYTICS  —  whole-org executive metrics computed live from the
//  CDS entities. Heavy lifting is done in JS (DB-portable) over modest data.
// ═════════════════════════════════════════════════════════════════════════════
function _monKey(y, m) { return y + '-' + String(m).padStart(2, '0'); }
function _last6Months() {
    const out = []; const d = new Date();
    for (let i = 5; i >= 0; i--) {
        const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push({ y: dd.getFullYear(), m: dd.getMonth() + 1,
            label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dd.getMonth()] });
    }
    return out;
}
function _mondayISO(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
}
function _pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function _avg(arr) { return arr.length ? (arr.reduce((s, x) => s + x, 0) / arr.length) : 0; }
function _healthStatus(score) {
    return score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';
}
function _heatColor(score) { return score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red'; }

async function loadFounderData() {
    const [emps, tasks, leaves, headers, ratings] = await Promise.all([
        SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'designation', 'department', 'isActive', 'status', 'joiningDate'),
        SELECT.from(TASK).columns('taskId', 'taskName', 'taskDescription', 'status', 'assignedTo_employeeId', 'dueDate', 'priority', 'statusUpdatedAt', 'taskType'),
        SELECT.from(LEAVE_REQUEST).columns('leaveId', 'employee_employeeId', 'leaveType', 'days', 'status', 'fromDate'),
        SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId', 'status', 'weekStartDate', 'submittedOn'),
        SELECT.from(PERFORMANCE_RATING).columns('ratingId', 'employee_employeeId', 'ratingValue', 'reviewMonth', 'reviewYear', 'ratingCategory', 'reviewComment')
    ]);
    return { emps: emps || [], tasks: tasks || [], leaves: leaves || [], headers: headers || [], ratings: ratings || [] };
}

// Latest rating value per employee, plus a current/previous month average.
function ratingStats(ratings, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const rs = ratings.filter(r => !setIds || setIds.has(r.employee_employeeId));
    const latestByEmp = {};
    rs.forEach(r => {
        const k = r.employee_employeeId;
        const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0);
        if (!latestByEmp[k] || ord > latestByEmp[k].ord) latestByEmp[k] = { ord, val: parseFloat(r.ratingValue) || 0 };
    });
    const latestVals = Object.values(latestByEmp).map(x => x.val).filter(v => v > 0);
    const current = +(_avg(latestVals)).toFixed(2);
    // previous = avg of ratings from the previous calendar month
    const now = new Date(); const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevVals = rs.filter(r => r.reviewYear === pm.getFullYear() && r.reviewMonth === (pm.getMonth() + 1))
        .map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const previous = +(_avg(prevVals)).toFixed(2) || +(current * 0.96).toFixed(2);
    const growthPct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
    return { current, previous, growthPct };
}

function taskStats(tasks, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ts = tasks.filter(t => !setIds || setIds.has(t.assignedTo_employeeId));
    const today = new Date().toISOString().slice(0, 10);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    let completed = 0, inProgress = 0, pending = 0, overdue = 0;
    ts.forEach(t => {
        const s = norm(t.status);
        const isDone = (s === 'completed');
        if (!isDone && t.dueDate && String(t.dueDate).slice(0, 10) < today) { overdue++; return; }
        if (isDone) completed++;
        else if (s === 'inprogress' || s === 'inreview') inProgress++;
        else pending++;
    });
    const total = ts.length;
    return {
        total, completed, inProgress, pending, overdue,
        completedPct: _pct(completed, total), inProgressPct: _pct(inProgress, total),
        pendingPct: _pct(pending, total), overduePct: _pct(overdue, total)
    };
}

function timesheetCompliance(headers, activeEmpIds) {
    const week = _mondayISO(new Date());
    const submittedStatuses = new Set(['Submitted', 'Pending', 'Approved', 'AutoApproved']);
    const submittedSet = new Set(
        headers.filter(h => String(h.weekStartDate).slice(0, 10) === week && submittedStatuses.has(h.status))
            .map(h => h.employee_employeeId)
    );
    const expected = activeEmpIds.length;
    const submitted = activeEmpIds.filter(id => submittedSet.has(id)).length;
    const missing = Math.max(0, expected - submitted);
    return { submitted, missing, expected, submittedPct: _pct(submitted, expected), missingPct: _pct(missing, expected), submittedSet };
}

function leaveStats(leaves, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ls = leaves.filter(l => (!setIds || setIds.has(l.employee_employeeId)) && l.status === 'Approved');
    const cat = { Casual: 0, Sick: 0, Earned: 0, Other: 0 };
    const usedByEmp = {};
    ls.forEach(l => {
        const d = Number(l.days) || 0;
        usedByEmp[l.employee_employeeId] = (usedByEmp[l.employee_employeeId] || 0) + d;
        const t = String(l.leaveType || '').toLowerCase();
        if (t.includes('casual')) cat.Casual += d;
        else if (t.includes('sick')) cat.Sick += d;
        else if (t.includes('paid') || t.includes('earned') || t.includes('annual')) cat.Earned += d;
        else cat.Other += d;
    });
    const totalUsed = cat.Casual + cat.Sick + cat.Earned + cat.Other;
    const ANNUAL_QUOTA = 21; // per employee
    const totalQuota = Math.max(1, (empIds ? empIds.length : Object.keys(usedByEmp).length || 1) * ANNUAL_QUOTA);
    const usedPct = Math.min(100, _pct(totalUsed, totalQuota));
    return { byType: cat, totalUsed, usedPct, availablePct: 100 - usedPct, usedByEmp };
}

function ratingTrend(ratings, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const rs = ratings.filter(r => !setIds || setIds.has(r.employee_employeeId));
    const byMon = {};
    rs.forEach(r => {
        const k = _monKey(r.reviewYear || 0, r.reviewMonth || 0);
        (byMon[k] = byMon[k] || []).push(parseFloat(r.ratingValue) || 0);
    });
    return _last6Months().map(mm => {
        const k = _monKey(mm.y, mm.m);
        const v = byMon[k] ? +(_avg(byMon[k])).toFixed(2) : null;
        return { label: mm.label, value: v };
    });
}

function taskCompletionTrend(tasks, empIds) {
    const setIds = empIds ? new Set(empIds) : null;
    const ts = tasks.filter(t => !setIds || setIds.has(t.assignedTo_employeeId));
    const total = Math.max(1, ts.length);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    return _last6Months().map(mm => {
        const monthEnd = new Date(mm.y, mm.m, 0).toISOString().slice(0, 10);
        const doneBy = ts.filter(t => norm(t.status) === 'completed' &&
            (!t.statusUpdatedAt || String(t.statusUpdatedAt).slice(0, 10) <= monthEnd)).length;
        return { label: mm.label, value: _pct(doneBy, total) };
    });
}

function departmentBreakdown(data) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const activeIds = emps.filter(e => e.isActive !== false).map(e => e.employeeId);
    const depMap = {};
    emps.forEach(e => {
        const dep = (e.department || 'Unassigned').trim() || 'Unassigned';
        (depMap[dep] = depMap[dep] || []).push(e);
    });
    const comp = timesheetCompliance(headers, activeIds);
    return Object.keys(depMap).map(dep => {
        const list = depMap[dep];
        const ids = list.map(e => e.employeeId);
        const rstat = ratingStats(ratings, ids);
        const tstat = taskStats(tasks, ids);
        const deptActive = ids.filter(id => list.find(e => e.employeeId === id && e.isActive !== false));
        const deptSubmitted = ids.filter(id => comp.submittedSet.has(id)).length;
        const tsPct = _pct(deptSubmitted, Math.max(1, ids.filter(id => list.find(e => e.employeeId === id && e.isActive !== false)).length));
        const health = Math.round(
            0.35 * (rstat.current / 5 * 100) + 0.35 * tstat.completedPct + 0.30 * tsPct
        );
        return {
            department: dep,
            employees: list.length,
            active: list.filter(e => e.isActive !== false).length,
            avgRating: rstat.current,
            taskCompletion: tstat.completedPct,
            timesheetCompliance: tsPct,
            healthScore: health,
            status: _heatStatusLabel(health)
        };
    }).sort((a, b) => b.healthScore - a.healthScore);
}
function _heatStatusLabel(s) { return s >= 80 ? 'Excellent' : s >= 60 ? 'Needs Attention' : 'Critical'; }

function buildOverall(data) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const total = emps.length;
    const active = emps.filter(e => e.isActive !== false).length;
    const inactive = total - active;
    const activeIds = emps.filter(e => e.isActive !== false).map(e => e.employeeId);
    const activePct = _pct(active, total);

    const rstat = ratingStats(ratings);
    const tstat = taskStats(tasks);
    const comp = timesheetCompliance(headers, activeIds);
    const lstat = leaveStats(leaves, emps.map(e => e.employeeId));

    const productivityScore = Math.round(0.5 * tstat.completedPct + 0.3 * comp.submittedPct + 0.2 * (rstat.current / 5 * 100));
    const leaveBalancePct = lstat.availablePct;
    const healthScore = Math.round(
        0.30 * (rstat.current / 5 * 100) + 0.25 * tstat.completedPct +
        0.20 * comp.submittedPct + 0.10 * leaveBalancePct + 0.15 * activePct
    );

    const depts = departmentBreakdown(data);
    const deptNames = Array.from(new Set(emps.map(e => (e.department || 'Unassigned').trim() || 'Unassigned')));

    // Risk center
    const today = new Date().toISOString().slice(0, 10);
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const overdueTasks = tasks.filter(t => norm(t.status) !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today).length;
    const excessiveLeave = Object.entries(lstat.usedByEmp).filter(([id, d]) => d > 15)
        .map(([id]) => { const e = emps.find(x => x.employeeId === id); return e ? e.employeeName : id; });
    const lowDepts = depts.filter(d => d.healthScore < 60).map(d => d.department);

    const leadDept = depts[0] ? depts[0].department : '—';
    const highestLeaveDept = (() => {
        const byDept = {};
        emps.forEach(e => { const dep = (e.department || 'Unassigned').trim() || 'Unassigned'; byDept[dep] = byDept[dep] || 0; });
        Object.entries(lstat.usedByEmp).forEach(([id, d]) => {
            const e = emps.find(x => x.employeeId === id); if (!e) return;
            const dep = (e.department || 'Unassigned').trim() || 'Unassigned'; byDept[dep] = (byDept[dep] || 0) + d;
        });
        const top = Object.entries(byDept).sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : '—';
    })();

    const aiInsight =
        `There are currently ${active} active employees across ${deptNames.length} department${deptNames.length !== 1 ? 's' : ''}. ` +
        `Organization-wide task completion stands at ${tstat.completedPct}%, while timesheet compliance remains ${comp.submittedPct >= 80 ? 'strong' : 'moderate'} at ${comp.submittedPct}%. ` +
        `Average employee rating is ${rstat.current.toFixed(2)}/5${rstat.growthPct ? `, ${rstat.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(rstat.growthPct)}% from last month` : ''}. ` +
        `The ${leadDept} department currently leads overall performance, while ${highestLeaveDept} has the highest leave utilization.`;

    return {
        employees: { total, active, inactive, activePct },
        rating: rstat,
        tasks: tstat,
        timesheet: { submitted: comp.submitted, missing: comp.missing, submittedPct: comp.submittedPct, missingPct: comp.missingPct },
        leave: { usedPct: lstat.usedPct, availablePct: lstat.availablePct, totalUsed: lstat.totalUsed, byType: lstat.byType },
        productivityScore,
        healthScore, healthStatus: _healthStatus(healthScore), healthTrendPct: rstat.growthPct,
        aiInsight,
        performanceTrend: ratingTrend(ratings),
        taskCompletionTrend: taskCompletionTrend(tasks),
        taskStatusDistribution: { completed: tstat.completed, inProgress: tstat.inProgress, pending: tstat.pending, overdue: tstat.overdue },
        leaveAnalytics: lstat.byType,
        departmentRanking: depts.map(d => ({ department: d.department, rating: d.avgRating, taskCompletion: d.taskCompletion, timesheetCompliance: d.timesheetCompliance, healthScore: d.healthScore })),
        heatmap: depts.map(d => ({ department: d.department, healthScore: d.healthScore, color: _heatColor(d.healthScore), status: d.status })),
        topDepartments: depts.slice(0, 5).map((d, i) => ({ rank: i + 1, department: d.department, healthScore: d.healthScore, taskCompletion: d.taskCompletion, avgRating: d.avgRating })),
        riskCenter: {
            overdueTasks,
            missingTimesheets: comp.missing,
            lowPerformingDepartments: lowDepts,
            excessiveLeave,
            inactiveEmployees: inactive
        },
        departments: deptNames
    };
}

function buildDepartment(data, department) {
    const { emps, tasks, leaves, headers, ratings } = data;
    const list = emps.filter(e => ((e.department || 'Unassigned').trim() || 'Unassigned') === department);
    const ids = list.map(e => e.employeeId);
    const activeIds = list.filter(e => e.isActive !== false).map(e => e.employeeId);
    const rstat = ratingStats(ratings, ids);
    const tstat = taskStats(tasks, ids);
    const comp = timesheetCompliance(headers, activeIds);
    const lstat = leaveStats(leaves, ids);

    // Latest rating per employee for top/bottom performers
    const latestByEmp = {};
    ratings.filter(r => ids.includes(r.employee_employeeId)).forEach(r => {
        const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0);
        if (!latestByEmp[r.employee_employeeId] || ord > latestByEmp[r.employee_employeeId].ord)
            latestByEmp[r.employee_employeeId] = { ord, val: parseFloat(r.ratingValue) || 0 };
    });
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const today = new Date().toISOString().slice(0, 10);
    const perEmp = list.map(e => {
        const completed = tasks.filter(t => t.assignedTo_employeeId === e.employeeId && norm(t.status) === 'completed').length;
        return { employeeName: e.employeeName, rating: (latestByEmp[e.employeeId] || {}).val || 0, completedTasks: completed, isActive: e.isActive !== false };
    });
    const top5 = perEmp.slice().sort((a, b) => b.rating - a.rating || b.completedTasks - a.completedTasks).slice(0, 5);
    const lowRated = perEmp.filter(p => p.rating > 0 && p.rating < 3).map(p => p.employeeName);
    const overdueDept = tasks.filter(t => ids.includes(t.assignedTo_employeeId) && norm(t.status) !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today).length;

    return {
        department,
        overview: {
            total: list.length, active: list.filter(e => e.isActive !== false).length,
            avgRating: rstat.current, taskCompletionPct: tstat.completedPct,
            timesheetCompliancePct: comp.submittedPct, leaveUtilizationPct: lstat.usedPct
        },
        ratingTrend: ratingTrend(ratings, ids),
        taskCompletionTrend: taskCompletionTrend(tasks, ids),
        leaveAnalytics: lstat.byType,
        taskStatusDistribution: { completed: tstat.completed, inProgress: tstat.inProgress, pending: tstat.pending, overdue: tstat.overdue },
        // Roster for the employee drill-down picker (Founder → Department → Employee).
        employees: list.map(e => ({
            employeeId: e.employeeId, employeeName: e.employeeName,
            designation: e.designation || '', isActive: e.isActive !== false,
            rating: (latestByEmp[e.employeeId] || {}).val || 0,
            completedTasks: tasks.filter(t => t.assignedTo_employeeId === e.employeeId && norm(t.status) === 'completed').length
        })).sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
        top5,
        risk: {
            lowRated,
            pendingReviews: list.length - Object.keys(latestByEmp).length,
            overdueTasks: overdueDept,
            missingTimesheets: comp.missing
        }
    };
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTIVE EMPLOYEE ANALYTICS — strategic profile (no operational records).
// All metrics are derived live from Ratings / Tasks / Timesheets / Leave so the
// same formulas apply to an employee, a department and the whole company, making
// the benchmarks directly comparable. No new tables / entities.
// ════════════════════════════════════════════════════════════════════════════
const _TS_OK = new Set(['Submitted', 'Pending', 'Approved', 'AutoApproved', 'PrevWeekApproved']);
function _normStatus(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
function _lastNMondays(n) {
    const out = []; const base = new Date(_mondayISO(new Date()));
    for (let i = 0; i < n; i++) { const d = new Date(base); d.setDate(base.getDate() - i * 7); out.push(_mondayISO(d)); }
    return out;
}
// Timesheet compliance for a set of employees over the last N weeks (avg %).
function _complianceForIds(headers, ids, weeks) {
    if (!ids.length) return 0;
    const mondays = _lastNMondays(weeks || 8);
    const submitted = {}; // empId -> Set(weekStart)
    headers.forEach(h => {
        if (!ids.includes(h.employee_employeeId)) return;
        if (!_TS_OK.has(h.status)) return;
        const w = String(h.weekStartDate).slice(0, 10);
        (submitted[h.employee_employeeId] = submitted[h.employee_employeeId] || new Set()).add(w);
    });
    const perEmp = ids.map(id => {
        const set = submitted[id] || new Set();
        const hit = mondays.filter(w => set.has(w)).length;
        return _pct(hit, mondays.length);
    });
    return Math.round(_avg(perEmp));
}
// Core metric bundle for any set of employee ids (employee / department / company).
function scopeMetrics(data, ids) {
    const { tasks, leaves, headers, ratings } = data;
    const set = new Set(ids);
    const today = new Date().toISOString().slice(0, 10);

    // Rating (avg of each employee's latest) + month-over-month growth.
    const rs = ratings.filter(r => set.has(r.employee_employeeId));
    const latestByEmp = {};
    rs.forEach(r => { const ord = (r.reviewYear || 0) * 12 + (r.reviewMonth || 0); const k = r.employee_employeeId; if (!latestByEmp[k] || ord > latestByEmp[k].ord) latestByEmp[k] = { ord, val: parseFloat(r.ratingValue) || 0 }; });
    const avgRating = +(_avg(Object.values(latestByEmp).map(x => x.val).filter(v => v > 0))).toFixed(2);
    const now = new Date(); const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const curMonthVals = rs.filter(r => r.reviewYear === now.getFullYear() && r.reviewMonth === now.getMonth() + 1).map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const prevMonthVals = rs.filter(r => r.reviewYear === pm.getFullYear() && r.reviewMonth === pm.getMonth() + 1).map(r => parseFloat(r.ratingValue) || 0).filter(v => v > 0);
    const curM = +(_avg(curMonthVals)).toFixed(2) || avgRating;
    const prevM = +(_avg(prevMonthVals)).toFixed(2);
    const growthPct = prevM > 0 ? Math.round(((curM - prevM) / prevM) * 100) : 0;
    const ratingPct = avgRating / 5 * 100;

    // Tasks: completion + deadline adherence (on-time).
    const ts = tasks.filter(t => set.has(t.assignedTo_employeeId));
    let completed = 0, overdue = 0;
    ts.forEach(t => { const s = _normStatus(t.status); const done = s === 'completed' || s === 'ended'; const od = !done && t.dueDate && String(t.dueDate).slice(0, 10) < today; if (od) overdue++; else if (done) completed++; });
    const taskCompletionPct = _pct(completed, ts.length);
    const onTimePct = (completed + overdue) > 0 ? _pct(completed, completed + overdue) : 100;

    // Timesheet compliance (last 8 weeks) + leave utilisation.
    const compliancePct = _complianceForIds(headers, ids, 8);
    const usedDays = leaves.filter(l => set.has(l.employee_employeeId) && l.status === 'Approved').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const leaveUtilPct = Math.min(100, _pct(usedDays, Math.max(1, ids.length * 21)));

    // Composite executive scores.
    const productivity = Math.round(0.5 * taskCompletionPct + 0.3 * compliancePct + 0.2 * ratingPct);
    const reliability = Math.round(0.4 * compliancePct + 0.3 * taskCompletionPct + 0.3 * onTimePct);
    const health = Math.round(0.30 * ratingPct + 0.25 * taskCompletionPct + 0.20 * compliancePct + 0.10 * (100 - leaveUtilPct) + 0.15 * onTimePct);

    return { avgRating, ratingPct, growthPct, taskCompletionPct, onTimePct, compliancePct, leaveUtilPct, usedDays, overdue, productivity, reliability, health, count: ids.length };
}
// 6-month trend of health / productivity / reliability for one employee.
function employeeTrends(data, id) {
    const { tasks, ratings, headers, leaves } = data;
    const rs = ratings.filter(r => r.employee_employeeId === id);
    const ts = tasks.filter(t => t.assignedTo_employeeId === id);
    const totalTasks = Math.max(1, ts.length);
    const today = new Date().toISOString().slice(0, 10);
    let comp = 0, overd = 0;
    ts.forEach(t => { const s = _normStatus(t.status); const done = s === 'completed' || s === 'ended'; const od = !done && t.dueDate && String(t.dueDate).slice(0, 10) < today; if (od) overd++; else if (done) comp++; });
    const onTime = (comp + overd) > 0 ? _pct(comp, comp + overd) : 100;
    const usedDays = leaves.filter(l => l.employee_employeeId === id && l.status === 'Approved').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const leaveBal = 100 - Math.min(100, _pct(usedDays, 21));

    return _last6Months().map(mm => {
        const monthEnd = new Date(mm.y, mm.m, 0).toISOString().slice(0, 10);
        const ord = mm.y * 12 + mm.m;
        const upto = rs.filter(r => ((r.reviewYear || 0) * 12 + (r.reviewMonth || 0)) <= ord)
            .sort((a, b) => ((b.reviewYear || 0) * 12 + (b.reviewMonth || 0)) - ((a.reviewYear || 0) * 12 + (a.reviewMonth || 0)));
        const ratingPct = upto.length ? (parseFloat(upto[0].ratingValue) || 0) / 5 * 100 : 0;
        const doneBy = ts.filter(t => _normStatus(t.status) === 'completed' && (!t.statusUpdatedAt || String(t.statusUpdatedAt).slice(0, 10) <= monthEnd)).length;
        const taskPct = _pct(doneBy, totalTasks);
        // compliance: mondays within this calendar month that were submitted
        const monthMondays = []; let d = new Date(mm.y, mm.m - 1, 1);
        while (d.getMonth() === mm.m - 1) { if (d.getDay() === 1) monthMondays.push(_mondayISO(d)); d.setDate(d.getDate() + 1); }
        const submittedSet = new Set(headers.filter(h => h.employee_employeeId === id && _TS_OK.has(h.status)).map(h => String(h.weekStartDate).slice(0, 10)));
        const compliancePct = monthMondays.length ? _pct(monthMondays.filter(w => submittedSet.has(w)).length, monthMondays.length) : 0;
        return {
            label: mm.label,
            health: Math.round(0.30 * ratingPct + 0.25 * taskPct + 0.20 * compliancePct + 0.10 * leaveBal + 0.15 * onTime),
            productivity: Math.round(0.5 * taskPct + 0.3 * compliancePct + 0.2 * ratingPct),
            reliability: Math.round(0.4 * compliancePct + 0.3 * taskPct + 0.3 * onTime)
        };
    });
}
// Contribution band (no raw rank) relative to all active employees.
function contributionBand(data, id) {
    const active = data.emps.filter(e => e.isActive !== false);
    const scoreOf = m => 0.4 * m.ratingPct + 0.35 * m.taskCompletionPct + 0.25 * m.reliability;
    const scored = active.map(e => ({ id: e.employeeId, s: scoreOf(scopeMetrics(data, [e.employeeId])) })).sort((a, b) => b.s - a.s);
    const idx = scored.findIndex(x => x.id === id);
    if (idx === -1) return { band: 'Average', label: 'Average Contributor', score: 0 };
    const frac = (idx + 1) / scored.length, my = scored[idx].s, avg = _avg(scored.map(x => x.s));
    let band, label;
    if (frac <= 0.05) { band = 'Top 5%'; label = 'High Performer'; }
    else if (frac <= 0.10) { band = 'Top 10%'; label = 'High Performer'; }
    else if (frac <= 0.25) { band = 'Top 25%'; label = 'Consistent Contributor'; }
    else if (my >= avg) { band = 'Average'; label = 'Average Contributor'; }
    else { band = 'Needs Attention'; label = 'Needs Attention'; }
    return { band, label, score: Math.round(my) };
}

function buildEmployee(data, employeeId) {
    const emp = data.emps.find(e => e.employeeId === employeeId);
    if (!emp) return null;
    const dept = (emp.department || 'Unassigned').trim() || 'Unassigned';
    const deptIds = data.emps.filter(e => ((e.department || 'Unassigned').trim() || 'Unassigned') === dept).map(e => e.employeeId);
    const companyIds = data.emps.map(e => e.employeeId);

    const me = scopeMetrics(data, [employeeId]);
    const dm = scopeMetrics(data, deptIds);
    const cm = scopeMetrics(data, companyIds);
    const trends = employeeTrends(data, employeeId);
    const contribution = contributionBand(data, employeeId);

    // ── Risk assessment ──
    const factors = []; let pts = 0;
    if (me.growthPct < 0) { factors.push(`Declining ratings (${me.growthPct}% MoM)`); pts += 1; }
    if (me.overdue > 0) { factors.push(`${me.overdue} overdue task${me.overdue > 1 ? 's' : ''}`); pts += 1; if (me.overdue > 3) pts += 1; }
    if (me.compliancePct < 70) { factors.push(`Low timesheet compliance (${me.compliancePct}%)`); pts += 1; }
    if (me.productivity < 50) { factors.push(`Low productivity (${me.productivity})`); pts += 2; }
    if (me.usedDays > 15) { factors.push(`Excessive leave usage (${me.usedDays} days)`); pts += 1; }
    const riskLevel = pts >= 4 ? 'High Risk' : pts >= 2 ? 'Medium Risk' : 'Low Risk';

    // ── Executive insight (dynamic) ──
    const name = emp.employeeName || employeeId;
    const ratingVsCo = me.avgRating - cm.avgRating;
    const prodVsCo = me.productivity - cm.productivity;
    const trendDelta = trends.length ? (trends[trends.length - 1].health - trends[0].health) : 0;
    const insight =
        `${name} currently ${prodVsCo >= 0 && ratingVsCo >= 0 ? 'performs above' : (prodVsCo < 0 && ratingVsCo < 0 ? 'performs below' : 'performs in line with')} ` +
        `both department and company averages. ` +
        `Productivity ${trendDelta >= 0 ? 'has improved' : 'has declined'} by ${Math.abs(trendDelta)} point${Math.abs(trendDelta) !== 1 ? 's' : ''} over the last six months ` +
        `while reliability stands at ${me.reliability}/100 (company ${cm.reliability}). ` +
        `Rating and task-completion metrics place ${name} in the “${contribution.label}” category` +
        `${contribution.band !== 'Average' && contribution.band !== 'Needs Attention' ? ` (${contribution.band})` : ''}. ` +
        `${factors.length ? 'Risk indicators: ' + factors.join('; ') + '.' : 'No operational risks have been identified.'}`;

    return {
        employeeId, employeeName: name,
        designation: emp.designation || '', department: dept,
        isActive: emp.isActive !== false, joiningDate: emp.joiningDate || '',
        healthScore: me.health, healthStatus: _healthStatus(me.health),
        growthPct: me.growthPct,
        kpis: {
            rating: { employee: me.avgRating, department: dm.avgRating, company: cm.avgRating },
            productivity: { employee: me.productivity, department: dm.productivity, company: cm.productivity },
            reliability: { employee: me.reliability, department: dm.reliability, company: cm.reliability },
            leaveUtil: { employee: me.leaveUtilPct, department: dm.leaveUtilPct, company: cm.leaveUtilPct }
        },
        benchmarks: {
            rating: { employee: +(me.ratingPct).toFixed(0), department: +(dm.ratingPct).toFixed(0), company: +(cm.ratingPct).toFixed(0) },
            productivity: { employee: me.productivity, department: dm.productivity, company: cm.productivity },
            reliability: { employee: me.reliability, department: dm.reliability, company: cm.reliability },
            leaveUtil: { employee: me.leaveUtilPct, department: dm.leaveUtilPct, company: cm.leaveUtilPct }
        },
        contribution,
        risk: { level: riskLevel, factors },
        trends: {
            months: trends.map(t => t.label),
            health: trends.map(t => t.health),
            productivity: trends.map(t => t.productivity),
            reliability: trends.map(t => t.reliability)
        },
        insight
    };
}

class FounderService extends cds.ApplicationService {
    async init() {

        // Two-factor authorization: XSUAA 'Founder' scope AND EmployeeMaster.role === 'founder'.
        this.before('*', requireMatchingRole('founder'));
        this.before('*', blockIfInactive);

        this.on('getFounderAnalytics', async () => {
            try {
                const data = await loadFounderData();
                return JSON.stringify({ generatedAt: new Date().toISOString(), company: { name: 'Ccentrik' }, overall: buildOverall(data) });
            } catch (e) {
                cds.log('founder').error('getFounderAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute analytics.' });
            }
        });

        this.on('getDepartmentAnalytics', async (req) => {
            try {
                const data = await loadFounderData();
                const deptNames = Array.from(new Set(data.emps.map(e => (e.department || 'Unassigned').trim() || 'Unassigned')));
                const department = (req.data.department && deptNames.indexOf(req.data.department) !== -1) ? req.data.department : (deptNames[0] || 'Unassigned');
                return JSON.stringify({ generatedAt: new Date().toISOString(), departments: deptNames, department: buildDepartment(data, department) });
            } catch (e) {
                cds.log('founder').error('getDepartmentAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute department analytics.' });
            }
        });

        // Drill-down: a single employee's performance + tasks (Founder only).
        this.on('getEmployeeAnalytics', async (req) => {
            try {
                if (!req.data.employeeId) return JSON.stringify({ error: 'employeeId is required.' });
                const data = await loadFounderData();
                const emp = buildEmployee(data, req.data.employeeId);
                if (!emp) return JSON.stringify({ error: 'Employee not found.' });
                return JSON.stringify({ generatedAt: new Date().toISOString(), employee: emp });
            } catch (e) {
                cds.log('founder').error('getEmployeeAnalytics failed:', e.message || e);
                return JSON.stringify({ error: 'Could not compute employee analytics.' });
            }
        });

        // Org-wide pending approvals (timesheets + leaves) across every employee.
        this.on('getFounderApprovals', async (req) => {
            try {
                // Authority scope: only requests from employees whose DIRECT
                // reporting manager is this founder are visible. Requests from anyone
                // else (incl. indirect reports under another manager) are filtered out.
                const { ids: scopeIds } = await founderDirectReports(req);
                const inScope = (empId) => scopeIds.has(empId);

                const [emps, headersAll, leavesAll, prevWeeksAll, dayUnlocksAll] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(HEADER).where({ status: { in: ['Pending', 'Submitted'] } }),
                    SELECT.from(LEAVE_REQUEST).where({ status: 'Pending' }),
                    SELECT.from(PREV_WEEK_REQUEST).where({ status: 'Pending' }),
                    SELECT.from(DAY_UNLOCK_REQUEST).where({ status: 'Pending' })
                ]);
                const headers = (headersAll || []).filter(h => inScope(h.employee_employeeId));
                const leaves = (leavesAll || []).filter(l => inScope(l.employee_employeeId));
                const prevWeeks = (prevWeeksAll || []).filter(r => inScope(r.employee_employeeId));
                const dayUnlocks = (dayUnlocksAll || []).filter(r => inScope(r.employee_employeeId));

                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const ts = (headers || []).map(h => ({
                    timesheetId: h.timesheetId,
                    employee: nm[h.employee_employeeId] || h.employee_employeeId, department: dp[h.employee_employeeId] || '—',
                    week: (h.weekStartDate || '') + ' – ' + (h.weekEndDate || ''),
                    weekStart: h.weekStartDate || '', weekEnd: h.weekEndDate || '',
                    submittedOn: h.submittedOn ? new Date(h.submittedOn).toLocaleString() : '', status: h.status
                }));
                const lv = (leaves || []).map(l => ({
                    leaveId: l.leaveId,
                    employee: nm[l.employee_employeeId] || l.employee_employeeId, department: dp[l.employee_employeeId] || '—',
                    leaveType: l.leaveType, from: l.fromDate, to: l.toDate, days: l.days,
                    reason: l.reason || '', status: l.status
                }));
                // Timesheet "fill requests" — previous-week + missed-day unlock requests,
                // org-wide, so the Founder sees requests routed to them (or anyone).
                const fillRequests = []
                    .concat((prevWeeks || []).map(r => ({
                        kind: 'prevweek', requestId: r.requestId,
                        employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Previous Week Fill', detail: (r.weekStartDate || '') + ' → ' + (r.weekEndDate || ''),
                        reason: r.employeeRemarks || '', requestedOn: r.requestedOn ? new Date(r.requestedOn).toLocaleString() : ''
                    })))
                    .concat((dayUnlocks || []).map(r => ({
                        kind: 'dayunlock', requestId: r.requestId,
                        employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Missed Day Unlock', detail: r.targetDate || '',
                        reason: r.employeeRemarks || '', requestedOn: r.requestedOn ? new Date(r.requestedOn).toLocaleString() : ''
                    })));
                return JSON.stringify({
                    timesheets: ts, leaves: lv, fillRequests,
                    counts: { timesheets: ts.length, leaves: lv.length, fillRequests: fillRequests.length }
                });
            } catch (e) { return JSON.stringify({ timesheets: [], leaves: [], fillRequests: [], counts: { timesheets: 0, leaves: 0, fillRequests: 0 } }); }
        });

        // ── Approval HISTORY — decisions the founder already made ─────────────
        // Same direct-report scope as getFounderApprovals, but returns the
        // Approved/Rejected records with the decision, the employee's original
        // reason, the founder's remarks and the decision date. Read-only.
        this.on('getFounderApprovalHistory', async (req) => {
            try {
                const { ids: scopeIds } = await founderDirectReports(req);
                const inScope = (id) => scopeIds.has(id);
                const decided = { in: ['Approved', 'Rejected', 'AutoApproved'] };
                const [emps, headers, leaves, prevWeeks, dayUnlocks] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(HEADER).where({ status: decided }),
                    SELECT.from(LEAVE_REQUEST).where({ status: { in: ['Approved', 'Rejected'] } }),
                    SELECT.from(PREV_WEEK_REQUEST).where({ status: { in: ['Approved', 'Rejected'] } }),
                    SELECT.from(DAY_UNLOCK_REQUEST).where({ status: { in: ['Approved', 'Rejected'] } })
                ]);
                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const fmt = (d) => d ? new Date(d).toLocaleString() : '';
                const sortDesc = (a, b) => (b._ord || 0) - (a._ord || 0);
                const ordOf = (d) => d ? new Date(d).getTime() : 0;

                const timesheets = (headers || []).filter(h => inScope(h.employee_employeeId)).map(h => ({
                    employee: nm[h.employee_employeeId] || h.employee_employeeId, department: dp[h.employee_employeeId] || '—',
                    week: (h.weekStartDate || '') + ' – ' + (h.weekEndDate || ''), status: h.status,
                    remarks: h.remarks || '', decidedOn: fmt(h.approvedOn || h.rejectedOn), _ord: ordOf(h.approvedOn || h.rejectedOn)
                })).sort(sortDesc);

                const lv = (leaves || []).filter(l => inScope(l.employee_employeeId)).map(l => ({
                    employee: nm[l.employee_employeeId] || l.employee_employeeId, department: dp[l.employee_employeeId] || '—',
                    leaveType: l.leaveType, from: l.fromDate, to: l.toDate, days: l.days, reason: l.reason || '',
                    status: l.status, remarks: l.managerRemarks || '', decidedOn: fmt(l.approvedOn), _ord: ordOf(l.approvedOn)
                })).sort(sortDesc);

                const fillRequests = []
                    .concat((prevWeeks || []).filter(r => inScope(r.employee_employeeId)).map(r => ({
                        kind: 'prevweek', employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Previous Week Fill', detail: (r.weekStartDate || '') + ' → ' + (r.weekEndDate || ''),
                        reason: r.employeeRemarks || '', status: r.status, remarks: r.managerRemarks || '', decidedOn: fmt(r.resolvedOn), _ord: ordOf(r.resolvedOn)
                    })))
                    .concat((dayUnlocks || []).filter(r => inScope(r.employee_employeeId)).map(r => ({
                        kind: 'dayunlock', employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                        title: 'Missed Day Unlock', detail: r.targetDate || '',
                        reason: r.employeeRemarks || '', status: r.status, remarks: r.hrRemarks || '', decidedOn: fmt(r.resolvedOn), _ord: ordOf(r.resolvedOn)
                    }))).sort(sortDesc);

                return JSON.stringify({
                    timesheets, leaves: lv, fillRequests,
                    counts: { timesheets: timesheets.length, leaves: lv.length, fillRequests: fillRequests.length }
                });
            } catch (e) { return JSON.stringify({ timesheets: [], leaves: [], fillRequests: [], counts: { timesheets: 0, leaves: 0, fillRequests: 0 } }); }
        });

        // Org-wide task list with status + assignee.
        this.on('getFounderTasks', async () => {
            try {
                const [emps, tasks] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(TASK).columns('taskId', 'taskName', 'taskDescription', 'assignedTo_employeeId', 'status', 'priority', 'startDate', 'dueDate', 'taskType')
                ]);
                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const today = new Date().toISOString().slice(0, 10);
                const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
                let completed = 0, inProgress = 0, pending = 0, overdue = 0;
                const rows = (tasks || []).map(t => {
                    const s = norm(t.status); const isDone = s === 'completed' || s === 'ended';
                    const isOverdue = !isDone && t.dueDate && String(t.dueDate).slice(0, 10) < today;
                    if (isOverdue) overdue++; else if (isDone) completed++; else if (s === 'inprogress' || s === 'inreview') inProgress++; else pending++;
                    return {
                        taskId: t.taskId, taskName: t.taskName || t.taskId, description: t.taskDescription || '',
                        assignee: nm[t.assignedTo_employeeId] || t.assignedTo_employeeId || 'Unassigned',
                        department: dp[t.assignedTo_employeeId] || '—',
                        type: t.taskType || 'solo',
                        status: t.status || 'Not Started', priority: t.priority || 'Medium',
                        startDate: t.startDate || '', dueDate: t.dueDate || '', overdue: !!isOverdue
                    };
                });
                const departments = Array.from(new Set(emps.map(e => (e.department || '').trim()).filter(Boolean))).sort();
                return JSON.stringify({ tasks: rows, departments, counts: { total: rows.length, completed, inProgress, pending, overdue } });
            } catch (e) { return JSON.stringify({ tasks: [], counts: { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 } }); }
        });

        // Org-wide performance ratings.
        this.on('getFounderRatings', async () => {
            try {
                const [emps, ratings] = await Promise.all([
                    SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department'),
                    SELECT.from(PERFORMANCE_RATING).columns('ratingId', 'employee_employeeId', 'ratingValue', 'reviewMonth', 'reviewYear', 'reviewComment', 'ratingCategory')
                ]);
                const nm = {}, dp = {}; emps.forEach(e => { nm[e.employeeId] = e.employeeName; dp[e.employeeId] = e.department || '—'; });
                const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const rows = (ratings || []).map(r => ({
                    employeeId: r.employee_employeeId,
                    employee: nm[r.employee_employeeId] || r.employee_employeeId, department: dp[r.employee_employeeId] || '—',
                    rating: parseFloat(r.ratingValue) || 0, category: r.ratingCategory || '—',
                    month: r.reviewMonth, year: r.reviewYear,
                    period: (MON[r.reviewMonth] || '') + ' ' + (r.reviewYear || ''), comment: r.reviewComment || ''
                })).sort((a, b) => b.rating - a.rating);
                const avg = rows.length ? +(rows.reduce((s, x) => s + x.rating, 0) / rows.length).toFixed(2) : 0;
                // Department averages (for the executive overview cards).
                const byDept = {};
                rows.forEach(r => { (byDept[r.department] = byDept[r.department] || []).push(r.rating); });
                const departmentOverview = Object.keys(byDept).map(d => ({
                    department: d, count: byDept[d].length,
                    average: +(byDept[d].reduce((s, x) => s + x, 0) / byDept[d].length).toFixed(2)
                })).sort((a, b) => b.average - a.average);
                return JSON.stringify({ ratings: rows, count: rows.length, average: avg, departmentOverview });
            } catch (e) { return JSON.stringify({ ratings: [], count: 0, average: 0 }); }
        });

        // Active-employee directory for the assign-task / submit-rating pickers.
        // Scoped to the founder's DIRECT reports only (manager = this founder) —
        // see founderDirectReports(). The dropdown therefore never exposes
        // employees from other reporting hierarchies.
        this.on('getFounderEmployees', async (req) => {
            try {
                const { employees: emps } = await founderDirectReports(req);
                const departments = Array.from(new Set((emps || []).map(e => (e.department || '').trim()).filter(Boolean))).sort();
                return JSON.stringify({
                    employees: (emps || []).map(e => ({
                        employeeId: e.employeeId, employeeName: e.employeeName,
                        department: e.department || '—', designation: e.designation || ''
                    })),
                    departments
                });
            } catch (e) { return JSON.stringify({ employees: [], departments: [] }); }
        });

        // ── Founder write actions (org-wide; same tables + notifications) ──────────

        // Approve / reject ANY timesheet (founder oversees the whole org).
        this.on('founderDecideTimesheet', async (req) => {
            try {
                const { timesheetId, approve, remarks } = req.data;
                if (!timesheetId) return JSON.stringify({ error: 'timesheetId is required.' });
                const header = await SELECT.one.from(HEADER).where({ timesheetId });
                if (!header) return JSON.stringify({ error: `Timesheet '${timesheetId}' not found.` });
                const { ids: scopeIds } = await founderDirectReports(req);
                if (!scopeIds.has(header.employee_employeeId)) return JSON.stringify({ error: 'This timesheet is not within your reporting hierarchy.' });
                // The approvals list surfaces both 'Pending' and 'Submitted' (the two
                // awaiting-decision states), so accept either — only an already
                // Approved/Rejected timesheet is blocked here.
                if (!['Pending', 'Submitted'].includes(header.status)) {
                    return JSON.stringify({ error: `Cannot act — current status is '${header.status}'.` });
                }
                if (approve) {
                    await UPDATE(HEADER).set({ status: 'Approved', approvedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
                    await UPDATE(ENTRY).set({ isLocked: true, entryStatus: 'Approved' }).where({ timesheet_timesheetId: timesheetId });
                    await createNotification(header.employee_employeeId, 'TIMESHEET_APPROVED', 'Timesheet Approved ✓',
                        `Your timesheet ${timesheetId} has been approved by the Founder.${remarks ? ' Remarks: ' + remarks : ''}`, timesheetId);
                } else {
                    await UPDATE(HEADER).set({ status: 'Rejected', rejectedOn: new Date(), remarks: remarks || '' }).where({ timesheetId });
                    await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' }).where({ timesheet_timesheetId: timesheetId });
                    await createNotification(header.employee_employeeId, 'TIMESHEET_REJECTED', 'Timesheet Returned ✗',
                        `Your timesheet ${timesheetId} was returned by the Founder.${remarks ? ' Reason: ' + remarks : ''}`, timesheetId);
                }
                founderEvents.ping('founderDecideTimesheet');
                return JSON.stringify({ ok: true, timesheetId, status: approve ? 'Approved' : 'Rejected' });
            } catch (e) { cds.log('founder').error('founderDecideTimesheet:', e.message || e); return JSON.stringify({ error: 'Could not update the timesheet.' }); }
        });

        // Approve / reject ANY leave request.
        this.on('founderDecideLeave', async (req) => {
            try {
                const { leaveId, approve, remarks } = req.data;
                if (!leaveId) return JSON.stringify({ error: 'leaveId is required.' });
                const leave = await SELECT.one.from(LEAVE_REQUEST).where({ leaveId });
                if (!leave) return JSON.stringify({ error: `Leave request '${leaveId}' not found.` });
                const { ids: scopeIds } = await founderDirectReports(req);
                if (!scopeIds.has(leave.employee_employeeId)) return JSON.stringify({ error: 'This leave request is not within your reporting hierarchy.' });
                if (leave.status !== 'Pending') return JSON.stringify({ error: `Leave is already '${leave.status}'.` });
                const newStatus = approve ? 'Approved' : 'Rejected';
                await UPDATE(LEAVE_REQUEST).set({ status: newStatus, managerRemarks: remarks || '', approvedOn: new Date() }).where({ leaveId });
                await createNotification(leave.employee_employeeId,
                    approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                    approve ? 'Leave Approved ✓' : 'Leave Rejected ✗',
                    approve
                        ? `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was approved by the Founder.${remarks ? ' Remarks: ' + remarks : ''}`
                        : `Your ${leave.leaveType} leave (${leave.fromDate} to ${leave.toDate}) was rejected by the Founder.${remarks ? ' Reason: ' + remarks : ''}`,
                    leaveId);
                founderEvents.ping('founderDecideLeave');
                return JSON.stringify({ ok: true, leaveId, status: newStatus });
            } catch (e) { cds.log('founder').error('founderDecideLeave:', e.message || e); return JSON.stringify({ error: 'Could not update the leave request.' }); }
        });

        // Approve / reject a timesheet "fill request" (previous-week or missed-day).
        // Mirrors the Manager/HR logic so the same records + notifications update.
        this.on('founderDecideFillRequest', async (req) => {
            try {
                const { kind, requestId, approve, remarks } = req.data;
                if (!requestId) return JSON.stringify({ error: 'requestId is required.' });

                const { ids: scopeIds } = await founderDirectReports(req);

                if (kind === 'prevweek') {
                    const request = await SELECT.one.from(PREV_WEEK_REQUEST).where({ requestId });
                    if (!request) return JSON.stringify({ error: `Request '${requestId}' not found.` });
                    if (!scopeIds.has(request.employee_employeeId)) return JSON.stringify({ error: 'This request is not within your reporting hierarchy.' });
                    if (request.status !== 'Pending') return JSON.stringify({ error: `Request is already '${request.status}'.` });
                    const newStatus = approve ? 'Approved' : 'Rejected';
                    let tsId = null;
                    if (approve) {
                        tsId = `${request.employee_employeeId}-${request.weekStartDate}`;
                        const existingHdr = await SELECT.one.from(HEADER).where({ timesheetId: tsId });
                        if (!existingHdr) {
                            await INSERT.into(HEADER).entries({
                                timesheetId: tsId, employee_employeeId: request.employee_employeeId,
                                weekStartDate: request.weekStartDate, weekEndDate: request.weekEndDate,
                                status: 'PrevWeekApproved', submissionType: 'Weekly', isAutoApproved: false
                            });
                        } else if (['Draft', 'Rejected'].includes(existingHdr.status)) {
                            await UPDATE(HEADER).set({ status: 'PrevWeekApproved' }).where({ timesheetId: tsId });
                        }
                    }
                    await UPDATE(PREV_WEEK_REQUEST)
                        .set({ status: newStatus, managerRemarks: remarks || '', resolvedOn: new Date(), timesheetId: tsId || null })
                        .where({ requestId });
                    await createNotification(request.employee_employeeId,
                        approve ? 'PREVWEEK_APPROVED' : 'PREVWEEK_REJECTED',
                        approve ? 'Previous Week Timesheet Approved ✓' : 'Previous Week Request Rejected ✗',
                        approve
                            ? `The Founder approved your request — you can now fill your timesheet for ${request.weekStartDate}.`
                            : `Your previous-week request for ${request.weekStartDate} was rejected.${remarks ? ' Reason: ' + remarks : ''}`,
                        requestId);
                    founderEvents.ping('founderDecideFillRequest');
                    return JSON.stringify({ ok: true, requestId, status: newStatus });
                }

                if (kind === 'dayunlock') {
                    const request = await SELECT.one.from(DAY_UNLOCK_REQUEST).where({ requestId });
                    if (!request) return JSON.stringify({ error: `Request '${requestId}' not found.` });
                    if (!scopeIds.has(request.employee_employeeId)) return JSON.stringify({ error: 'This request is not within your reporting hierarchy.' });
                    if (request.status !== 'Pending') return JSON.stringify({ error: `Request is already '${request.status}'.` });
                    const newStatus = approve ? 'Approved' : 'Rejected';
                    await UPDATE(DAY_UNLOCK_REQUEST).set({ status: newStatus, hrRemarks: remarks || '', resolvedOn: new Date() }).where({ requestId });
                    if (approve) {
                        const mon = _mondayISO(new Date());
                        const tsId = `${request.employee_employeeId}-${mon}`;
                        await UPDATE(ENTRY).set({ isLocked: false, entryStatus: 'Open' })
                            .where({ timesheet_timesheetId: tsId, workDate: request.targetDate });
                    }
                    await createNotification(request.employee_employeeId,
                        approve ? 'DAY_UNLOCK_APPROVED' : 'DAY_UNLOCK_REJECTED',
                        approve ? `Day ${request.targetDate} Unlocked ✓` : `Day ${request.targetDate} Unlock Rejected ✗`,
                        approve
                            ? `The Founder approved your request to fill ${request.targetDate}.`
                            : `The Founder rejected your unlock request for ${request.targetDate}.${remarks ? ' Reason: ' + remarks : ''}`,
                        requestId);
                    founderEvents.ping('founderDecideFillRequest');
                    return JSON.stringify({ ok: true, requestId, status: newStatus });
                }

                return JSON.stringify({ error: 'Unknown request kind.' });
            } catch (e) { cds.log('founder').error('founderDecideFillRequest:', e.message || e); return JSON.stringify({ error: 'Could not update the request.' }); }
        });

        // Assign a NEW solo task to any employee (writes to the same TaskMaster table).
        this.on('founderAssignTask', async (req) => {
            try {
                const d = req.data || {};
                if (!d.taskName || !d.taskName.trim()) return JSON.stringify({ error: 'Task name is required.' });
                if (!d.assigneeId) return JSON.stringify({ error: 'Please choose an assignee.' });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId: d.assigneeId });
                if (!emp) return JSON.stringify({ error: `Employee '${d.assigneeId}' not found.` });
                // Access control: the assignee must report directly to this founder.
                const { ids: reportIds } = await founderDirectReports(req);
                if (!reportIds.has(d.assigneeId)) return JSON.stringify({ error: 'You can only assign tasks to employees who report to you.' });
                // (Optional) reviewer, when supplied, must also be a direct report.
                if (d.reviewerId && String(d.reviewerId).trim() && !reportIds.has(String(d.reviewerId).trim())) {
                    return JSON.stringify({ error: 'The reviewer must be an employee who reports to you.' });
                }
                const taskId = await nextGroupTaskId();
                await INSERT.into(TASK).entries({
                    taskId,
                    taskName: d.taskName.trim(),
                    taskDescription: (d.taskDescription || '').trim(),
                    assignedTo_employeeId: d.assigneeId,
                    reviewer_employeeId: (d.reviewerId && String(d.reviewerId).trim()) ? d.reviewerId : null,
                    priority: d.priority || 'Medium',
                    status: 'Not Started',
                    taskType: 'solo',
                    startDate: d.startDate || null,
                    dueDate: d.dueDate || null,
                    statusUpdatedAt: new Date()
                });
                await createNotification(d.assigneeId, 'TASK_ASSIGNED', `New Task: ${d.taskName.trim()}`,
                    `The Founder assigned you "${d.taskName.trim()}" (${d.priority || 'Medium'} priority)${d.dueDate ? ', due ' + d.dueDate : ''}.`, taskId);
                founderEvents.ping('founderAssignTask');
                return JSON.stringify({ ok: true, taskId });
            } catch (e) { cds.log('founder').error('founderAssignTask:', e.message || e); return JSON.stringify({ error: 'Could not assign the task.' }); }
        });

        // Submit / update a performance rating for any employee (PerformanceRating table).
        this.on('founderSubmitRating', async (req) => {
            try {
                const { employeeId, ratingValue, reviewMonth, reviewYear, reviewComment, ratingCategory } = req.data;
                if (!employeeId) return JSON.stringify({ error: 'employeeId is required.' });
                if (!ratingValue) return JSON.stringify({ error: 'ratingValue is required.' });
                if (!reviewMonth) return JSON.stringify({ error: 'reviewMonth is required.' });
                if (!reviewYear) return JSON.stringify({ error: 'reviewYear is required.' });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId });
                if (!emp) return JSON.stringify({ error: `Employee '${employeeId}' not found.` });
                // Access control: founders may only rate their direct reports.
                const { ids: rateableIds } = await founderDirectReports(req);
                if (!rateableIds.has(employeeId)) return JSON.stringify({ error: 'You can only rate employees who report to you.' });
                const ratingId = `${employeeId}-${reviewYear}-${String(reviewMonth).padStart(2, '0')}`;
                const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const period = `${MN[reviewMonth] || reviewMonth} ${reviewYear}`;

                // Issue 5: one rating per employee per month — never overwrite history.
                const existing = await SELECT.one.from(PERFORMANCE_RATING).where({ employee_employeeId: employeeId, reviewMonth, reviewYear });
                if (existing) {
                    return JSON.stringify({ error: `Rating for this employee has already been submitted for ${period}.` });
                }
                try {
                    await INSERT.into(PERFORMANCE_RATING).entries({ ratingId, employee_employeeId: employeeId, ratingValue, reviewMonth, reviewYear, reviewComment: reviewComment || '', ratingCategory: ratingCategory || '' });
                } catch (e) {
                    return JSON.stringify({ error: `Rating for this employee has already been submitted for ${period}.` });
                }
                await createNotification(employeeId, 'PERFORMANCE_RATED', 'New Performance Rating ⭐',
                    `The Founder rated you ${ratingValue}/5${ratingCategory ? ' (' + ratingCategory + ')' : ''} for ${period}.${reviewComment ? ' Comment: ' + reviewComment : ''}`,
                    ratingId);
                founderEvents.ping('founderSubmitRating');
                return JSON.stringify({ ok: true, ratingId });
            } catch (e) { cds.log('founder').error('founderSubmitRating:', e.message || e); return JSON.stringify({ error: 'Could not submit the rating.' }); }
        });

        return super.init();
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Project Management module (Phase 1) — helpers + service. Fully additive.
// ══════════════════════════════════════════════════════════════════════════════

// Auto-generate the next PRJ-#### id (gap-tolerant).
async function nextProjectId() {
    const rows = await SELECT.from(PROJECT).columns('projectId');
    let max = 0;
    (rows || []).forEach(r => { const m = /PRJ-(\d+)/.exec(r.projectId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'PRJ-' + String(max + 1).padStart(4, '0');
}
async function nextProjectTaskId(projectId) {
    const rows = await SELECT.from(PROJECT_TASK).columns('taskId').where({ project_projectId: projectId });
    let max = 0;
    (rows || []).forEach(r => { const m = /-T-(\d+)$/.exec(r.taskId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return `${projectId}-T-${String(max + 1).padStart(3, '0')}`;
}
async function nextBudgetRequestId(projectId) {
    const rows = await SELECT.from(PROJECT_BUDGET_REQUEST).columns('requestId').where({ project_projectId: projectId });
    let max = 0;
    (rows || []).forEach(r => { const m = /-BR-(\d+)$/.exec(r.requestId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return `${projectId}-BR-${String(max + 1).padStart(3, '0')}`;
}

// Read + parse the ProjectBudget row and derive the unallocated pool.
// Returns { row, totalBudget, deptArr, otherArr, allocated, unallocated }.
async function readProjectBudget(projectId) {
    const row = await SELECT.one.from(PROJECT_BUDGET).where({ budgetId: `${projectId}-BUDGET` });
    let deptArr = [], otherArr = [];
    if (row) {
        try { deptArr = JSON.parse(row.departmentBudgets || '[]') || []; } catch (_) { deptArr = []; }
        try { otherArr = JSON.parse(row.otherBudgets || '[]') || []; } catch (_) { otherArr = []; }
    }
    const totalBudget = row ? Number(row.totalBudget) || 0 : 0;
    const sumDept = deptArr.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const sumOther = otherArr.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const allocated = sumDept + sumOther;
    return { row, totalBudget, deptArr, otherArr, allocated, unallocated: Math.round((totalBudget - allocated) * 100) / 100 };
}

// Inclusive whole-month span of a date range (≥ 1). Drives planned-cost spread.
function monthsBetweenInclusive(s, e) {
    if (!s || !e) return 1;
    const a = new Date(s), b = new Date(e);
    const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
    return Math.max(1, m);
}
// Traffic-light helper.
function healthColor(ratio, greenBelow, yellowBelow) {
    if (ratio < greenBelow) return 'Green';
    if (ratio < yellowBelow) return 'Yellow';
    return 'Red';
}
// Actual cost consumed by a project = Σ(logged hours on its tasks × active hourlyCost).
// Returns { actualCost, actualHours, hourly } (hourly map reused by planned-cost calc).
async function projectActualCost(projectId) {
    const tasks = await SELECT.from(PROJECT_TASK).columns('taskId').where({ project_projectId: projectId });
    const taskIds = tasks.map(t => t.taskId);
    const entries = taskIds.length ? await SELECT.from(ENTRY).columns('timesheet_timesheetId', 'projectTask_taskId', 'hoursWorked').where({ projectTask_taskId: { in: taskIds } }) : [];
    const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
    const headers = tsIds.length ? await SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId').where({ timesheetId: { in: tsIds } }) : [];
    const empOfTs = {}; headers.forEach(h => { empOfTs[h.timesheetId] = h.employee_employeeId; });
    const salaries = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'hourlyCost', 'isActive');
    const hourly = {}; salaries.forEach(s => { if (s.isActive !== false) hourly[s.employee_employeeId] = Number(s.hourlyCost) || 0; });
    let cost = 0, hours = 0;
    entries.forEach(e => { const emp = empOfTs[e.timesheet_timesheetId]; const h = Number(e.hoursWorked) || 0; hours += h; cost += h * (hourly[emp] || 0); });
    return { actualCost: Math.round(cost), actualHours: Math.round(hours), hourly };
}
// Full financial forecast for a project (single source of truth for health + dashboards).
async function projectFinancials(p, hourly) {
    const res = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'bandwidth', 'totalAllocationCost').where({ project_projectId: p.projectId });
    // Snapshot-based allocated resource cost (frozen at allocation time).
    const allocatedResourceCost = Math.round((res || []).reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0));
    const caps = {}; if (res.length) {
        (await SELECT.from(EMPLOYEE).columns('employeeId', 'monthlyCapacityHours').where({ employeeId: { in: res.map(r => r.employee_employeeId) } }))
            .forEach(e => { caps[e.employeeId] = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : 160; });
    }
    const months = monthsBetweenInclusive(p.startDate, p.endDate);
    let plannedResourceCost = 0;
    res.forEach(r => { const cap = caps[r.employee_employeeId] || 160; const hrs = (Number(r.bandwidth) || 0) / 100 * cap * months; plannedResourceCost += hrs * (hourly[r.employee_employeeId] || 0); });
    plannedResourceCost = Math.round(plannedResourceCost);

    let catArr = [];
    const bRow = await SELECT.one.from(PROJECT_BUDGET).columns('categoryBudgets').where({ budgetId: `${p.projectId}-BUDGET` });
    if (bRow) { try { catArr = JSON.parse(bRow.categoryBudgets || '[]') || []; } catch (_) {} }
    const nonResourcePlanned = catArr.filter(x => String(x.category) !== 'Resource Cost').reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const allocatedBudget = catArr.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    const contractValue = Number(p.contractValue) || 0;
    const executionBudget = Number(p.executionBudget) || Number(p.budget) || 0;
    const profitReserve = Number(p.profitReserveAmount) || 0;
    const expectedMarginPct = Number(p.profitMarginPct) || 0;
    const projectedTotalCost = plannedResourceCost + nonResourcePlanned;
    const projectedMargin = contractValue - projectedTotalCost;
    const projectedMarginPct = contractValue > 0 ? Math.round(projectedMargin / contractValue * 100) : 0;
    return {
        contractValue, profitReserve, executionBudget, expectedMarginPct, allocatedBudget,
        allocatedResourceCost, remainingBudget: Math.round(executionBudget - allocatedResourceCost),
        plannedResourceCost, nonResourcePlanned, projectedTotalCost,
        projectedMargin, projectedMarginPct,
        budgetVariance: Math.round(executionBudget - projectedTotalCost),
        profitVariance: Math.round(projectedMargin - profitReserve)
    };
}

// Distinct job ROLES (= EmployeeMaster.designation) of ACTIVE employees in the
// given departments (or all departments when the list is empty). This is the
// single dynamic source of roles — never hardcoded.
//   SELECT DISTINCT designation FROM EmployeeMaster
//   WHERE isActive AND status NOT IN (Inactive,Resigned) [AND department IN (...)]
async function rolesForDepartments(deptList) {
    const where = { isActive: true };
    if (deptList && deptList.length) where.department = { in: deptList };
    const rows = await SELECT.from(EMPLOYEE).columns('designation', 'status').where(where);
    const set = new Set();
    (rows || []).forEach(r => {
        const st = String(r.status || 'Active').toLowerCase();
        if (st === 'inactive' || st === 'resigned') return;
        const d = String(r.designation || '').trim();
        if (d) set.add(d);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
}
// The configured department(s) a project type draws from (admin master data).
async function typeDepartments(projectTypeCode) {
    try {
        const t = await SELECT.one.from(PROJECT_TYPE).columns('departments').where({ code: projectTypeCode || 'OTHER' });
        return JSON.parse((t && t.departments) || '[]') || [];
    } catch (_) { return []; }
}

// Departments that received a budget allocation (> 0) for a project. Resource
// assignment is restricted to these departments. Returns a lower-cased Set plus
// the original display names (for the "Eligible Departments" UI hint).
async function fundedDepartments(projectId) {
    const b = await readProjectBudget(projectId);
    const names = [];
    (b.deptArr || []).forEach(d => {
        const name = String(d.department || d.name || '').trim();
        if (name && (Number(d.amount) || 0) > 0) names.push(name);
    });
    return { set: new Set(names.map(n => n.toLowerCase())), names: [...new Set(names)].sort((a, b2) => a.localeCompare(b2)) };
}

// Department utilization % for a project = avg committed FTE bandwidth (capped 100) across
// that department's allocated members. Mirrors getProjectResourcePlanning.
async function deptUtilizationPct(projectId, department) {
    const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'department').where({ project_projectId: projectId });
    const members = resources.filter(r => (r.department || 'Unassigned') === department);
    if (!members.length) return 0;
    const ids = members.map(r => r.employee_employeeId);
    const totalBw = await committedBandwidthByEmployee(ids);   // excludes cancelled/completed projects
    const utils = members.map(m => Math.min(100, totalBw[m.employee_employeeId] || 0));
    return Math.round(utils.reduce((s, v) => s + v, 0) / utils.length);
}

// Immutable audit entry — never throws into the caller.
async function projectAudit(projectId, userName, action, oldValue, newValue) {
    try {
        await INSERT.into(PROJECT_AUDIT).entries({
            logId: `${projectId}-LOG-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
            project_projectId: projectId, userName: userName || '', action,
            oldValue: oldValue == null ? null : String(oldValue),
            newValue: newValue == null ? null : String(newValue), at: new Date()
        });
    } catch (e) { cds.log('project').warn('audit failed:', e.message || e); }
}

// Project email — reuses the existing mailer; falls back to log (same as the rest
// of the app). Notification is always created regardless of SMTP.
async function sendProjectMail(employeeId, email, subject, body, refId, notifType) {
    await createNotification(employeeId, notifType || 'PROJECT_UPDATE', subject, body, refId);
    const mailer = getMailer();
    if (mailer && email) {
        try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: email, subject, text: body }); }
        catch (e) { cds.log('project').warn('project email failed:', e.message || e); }
    }
}

// ── Calendar invite (.ics) + meeting-email helpers ──────────────────────────
// Convert a wall-clock ISO string in `tz` to the equivalent UTC Date.
function zonedToUtc(localISO, tz) {
    if (!localISO) return null;
    const s = String(localISO).replace(' ', 'T');
    const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
    const base = new Date(hasTz ? s : s + 'Z');
    if (isNaN(base)) return null;
    if (hasTz) return base;
    try {
        const shown = new Date(base.toLocaleString('en-US', { timeZone: tz || 'Asia/Kolkata' }));
        return new Date(base.getTime() + (base.getTime() - shown.getTime()));
    } catch (e) { return base; }
}
function _icsStamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function _icsEsc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }

// Build a Teams/Outlook-compatible VCALENDAR for one meeting.
function buildMeetingIcs(m, attendees, opts) {
    opts = opts || {};
    const method = opts.method || 'REQUEST';
    const tz = m.timeZone || 'Asia/Kolkata';
    const start = zonedToUtc(m.startDateTime, tz);
    const end = zonedToUtc(m.endDateTime, tz) || (start ? new Date(start.getTime() + 3600000) : null);
    const now = new Date();
    const joinUrl = m.teamsJoinUrl || '';
    const loc = m.meetingMode === 'InPerson' ? (m.location || '') : (joinUrl ? 'Microsoft Teams Meeting' : '');
    const descParts = [];
    if (m.meetingType) descParts.push('Type: ' + m.meetingType);
    if (m.agenda) descParts.push('Agenda: ' + m.agenda);
    if (joinUrl) descParts.push('Join Microsoft Teams Meeting: ' + joinUrl);
    if (m.meetingMode === 'InPerson' && m.location) descParts.push('Location: ' + m.location);
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ccentrik//Timesheet//EN',
        'CALSCALE:GREGORIAN', 'METHOD:' + method,
        'BEGIN:VEVENT',
        'UID:' + m.meetingId + '@ccentrik',
        'SEQUENCE:' + (opts.sequence || 0),
        'DTSTAMP:' + _icsStamp(now),
        start ? 'DTSTART:' + _icsStamp(start) : '',
        end ? 'DTEND:' + _icsStamp(end) : '',
        'SUMMARY:' + _icsEsc(m.title),
        'DESCRIPTION:' + _icsEsc(descParts.join('\n')),
        loc ? 'LOCATION:' + _icsEsc(loc) : '',
        (m.organizerEmail ? 'ORGANIZER;CN=' + _icsEsc(m.organizerName || m.organizerEmail) + ':mailto:' + m.organizerEmail : '')
    ];
    (attendees || []).forEach(a => {
        if (a.email) lines.push('ATTENDEE;CN=' + _icsEsc(a.name || a.email) + ';RSVP=TRUE:mailto:' + a.email);
    });
    lines.push('STATUS:' + (opts.cancelled ? 'CANCELLED' : 'CONFIRMED'));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.filter(Boolean).join('\r\n');
}

// Email a meeting invitation (+ .ics calendar attachment) to every attendee.
// attendees: [{ name, email }]. Best-effort; never throws into the caller.
async function sendMeetingInvites(m, attendees, opts) {
    opts = opts || {};
    const mailer = getMailer();
    const recips = (attendees || []).map(a => a.email).filter(Boolean);
    if (!mailer || !recips.length) return;
    const cancelled = !!opts.cancelled;
    const method = cancelled ? 'CANCEL' : (opts.method || 'REQUEST');
    const modeLine = m.meetingMode === 'InPerson'
        ? `Location : ${m.location || '—'}`
        : `Join Link: ${m.teamsJoinUrl || '—'}`;
    const subject = (cancelled ? '[Cancelled] ' : '') + `${m.title}${m.meetingType ? ' · ' + m.meetingType : ''}`;
    const text =
        `${cancelled ? 'This meeting has been cancelled.\n\n' : ''}` +
        `Meeting  : ${m.title}\n` +
        `Type     : ${m.meetingType || '—'}\n` +
        (m.agenda ? `Agenda   : ${m.agenda}\n` : '') +
        `Date     : ${new Date(m.startDateTime).toLocaleString('en-IN')}\n` +
        `Timezone : ${m.timeZone || 'Asia/Kolkata'}\n` +
        `Mode     : ${m.meetingMode === 'InPerson' ? 'In Person' : 'Microsoft Teams'}\n` +
        `${modeLine}\n` +
        `Organizer: ${m.organizerName || ''} <${m.organizerEmail || ''}>\n`;
    const html =
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222">` +
        (cancelled ? `<p style="color:#c0392b;font-weight:600">This meeting has been cancelled.</p>` : '') +
        `<h2 style="margin:0 0 4px">${_icsEsc(m.title)}</h2>` +
        (m.meetingType ? `<div style="color:#666;margin-bottom:10px">${_icsEsc(m.meetingType)}</div>` : '') +
        (m.agenda ? `<p><b>Agenda:</b> ${_icsEsc(m.agenda)}</p>` : '') +
        `<p><b>Date:</b> ${new Date(m.startDateTime).toLocaleString('en-IN')}<br/>` +
        `<b>Timezone:</b> ${_icsEsc(m.timeZone || 'Asia/Kolkata')}<br/>` +
        `<b>Mode:</b> ${m.meetingMode === 'InPerson' ? 'In Person' : 'Microsoft Teams'}</p>` +
        (m.meetingMode === 'InPerson'
            ? `<p><b>Location:</b> ${_icsEsc(m.location || '—')}</p>`
            : (m.teamsJoinUrl ? `<p><a href="${m.teamsJoinUrl}" style="background:#5b5fc7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Join Microsoft Teams Meeting</a></p>` : '')) +
        `<p style="color:#888">Organizer: ${_icsEsc(m.organizerName || '')} &lt;${_icsEsc(m.organizerEmail || '')}&gt;</p></div>`;
    const ics = buildMeetingIcs(m, attendees, { method, cancelled, sequence: opts.sequence || 0 });
    try {
        await mailer.sendMail({
            from: process.env.SMTP_FROM || 'no-reply@timesheet.local',
            to: recips.join(','), subject, text, html,
            icalEvent: { method, filename: 'invite.ics', content: ics },
            attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=' + method }]
        });
    } catch (e) { cds.log('meeting').warn('meeting invite email failed:', e.message || e); }
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL & REQUIREMENT — shared helpers (used by ClientService +
// ProjectService). Authorization is enforced by each caller; these helpers
// assume the caller has already been authorized for the requirement.
// ════════════════════════════════════════════════════════════════════════════

// Resolve the logged-in client by email → ClientMaster. Mirrors projectCaller.
async function clientCaller(req) {
    const caller = await resolveCaller(req);
    const email = caller.email;
    let client = null;
    if (email) client = await SELECT.one.from(CLIENT_MASTER).where('lower(email) =', email);
    return {
        email,
        clientId: client && client.clientId,
        clientName: client && client.clientName,
        contactPerson: client && client.contactPerson,
        client,
        active: !!client && String(client.status || '').toLowerCase() !== 'inactive'
    };
}

async function nextRequirementId(projectId) {
    const rows = await SELECT.from(REQUIREMENT).columns('requirementId').where({ project_projectId: projectId });
    let max = 0;
    (rows || []).forEach(r => { const m = /-REQ-(\d+)$/.exec(r.requirementId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return `${projectId}-REQ-${String(max + 1).padStart(3, '0')}`;
}

// Immutable requirement audit entry — never throws into the caller.
async function reqAudit(requirementId, userName, action, oldValue, newValue) {
    try {
        await INSERT.into(REQUIREMENT_AUDIT).entries({
            auditId: `${requirementId}-AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
            requirement_requirementId: requirementId, userName: userName || '', action,
            oldValue: oldValue == null ? null : String(oldValue),
            newValue: newValue == null ? null : String(newValue), at: new Date()
        });
    } catch (e) { cds.log('requirement').warn('req audit failed:', e.message || e); }
}

// Best-effort email to a client contact (no in-app Notification row — those are
// keyed to EmployeeMaster). Internal users are notified via createNotification.
async function sendClientMail(client, subject, body) {
    const mailer = getMailer();
    if (mailer && client && client.email) {
        try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'no-reply@timesheet.local', to: client.email, subject, text: body }); }
        catch (e) { cds.log('requirement').warn('client email failed:', e.message || e); }
    }
}

// Notify the relevant internal stakeholders (assigned employee + project POC)
// of a requirement event, and email the owning client.
async function notifyRequirement(reqRow, projectRow, clientRow, subject, body, notifType) {
    const targets = new Set();
    if (reqRow.assignedTo_employeeId) targets.add(reqRow.assignedTo_employeeId);
    if (projectRow && projectRow.poc_employeeId) targets.add(projectRow.poc_employeeId);
    for (const empId of targets) {
        await createNotification(empId, notifType || 'REQUIREMENT_UPDATE', subject, body, reqRow.requirementId).catch(() => {});
    }
    if (clientRow) await sendClientMail(clientRow, subject, body);
}

// Assemble the full requirement detail JSON (attachments meta, flat comments,
// audit history, project + assignee info). Shared by client + internal reads.
async function buildRequirementDetailJSON(reqRow) {
    const project = await SELECT.one.from(PROJECT)
        .columns('projectId', 'projectName', 'currentPhase', 'status', 'poc_employeeId', 'pocName')
        .where({ projectId: reqRow.project_projectId });

    const atts = await SELECT.from(REQUIREMENT_ATTACHMENT)
        .columns('attachmentId', 'fileName', 'mimeType', 'fileSize', 'version', 'uploadedByName', 'createdAt')
        .where({ requirement_requirementId: reqRow.requirementId }).orderBy('createdAt asc');

    const comments = await SELECT.from(REQUIREMENT_COMMENT)
        .where({ requirement_requirementId: reqRow.requirementId }).orderBy('createdAt asc');

    const history = await SELECT.from(REQUIREMENT_AUDIT)
        .columns('auditId', 'userName', 'action', 'oldValue', 'newValue', 'at')
        .where({ requirement_requirementId: reqRow.requirementId }).orderBy('at asc');

    return {
        requirementId: reqRow.requirementId,
        projectId: reqRow.project_projectId,
        projectName: project ? project.projectName : '',
        currentPhase: project ? (project.currentPhase || project.status) : '',
        title: reqRow.title,
        description: reqRow.description,
        businessJustification: reqRow.businessJustification,
        priority: reqRow.priority,
        expectedDeliveryDate: reqRow.expectedDeliveryDate,
        category: reqRow.category,
        module: reqRow.module,
        remarks: reqRow.remarks,
        status: reqRow.status,
        assignedToId: reqRow.assignedTo_employeeId || '',
        assignedToName: reqRow.assignedToName || '',
        assignedByName: reqRow.assignedByName || '',
        assignedDate: reqRow.assignedDate || null,
        approvalComments: reqRow.approvalComments || '',
        createdAt: reqRow.createdAt,
        clientName: reqRow.clientName || (reqRow.client_clientId || ''),
        attachments: (atts || []).map(a => ({
            attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType,
            fileSize: a.fileSize, version: a.version, uploadedByName: a.uploadedByName, uploadedAt: a.createdAt
        })),
        comments: (comments || []).map(c => ({
            commentId: c.commentId, authorName: c.authorName, authorRole: c.authorRole,
            message: c.isDeleted ? '' : (c.message || ''), isDeleted: !!c.isDeleted,
            hasAttachment: !!c.attachmentName, attachmentName: c.attachmentName || '',
            at: c.createdAt
        })),
        history: (history || []).map(h => ({
            action: h.action, userName: h.userName, oldValue: h.oldValue, newValue: h.newValue, at: h.at
        }))
    };
}

// Add a flat comment to a requirement (author = client OR employee). Returns id.
async function addRequirementCommentRow(requirementId, { authorName, authorRole, authorEmployeeId, message, fileName, mimeType, dataBase64 }) {
    const text = (message || '').trim();
    let buf = null;
    if (dataBase64) {
        try { buf = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); } catch (e) { buf = null; }
        if (buf && buf.length > 10 * 1024 * 1024) throw new Error('Attachment exceeds the 10 MB limit.');
    }
    if (!text && !buf) throw new Error('A comment or an attachment is required.');
    const commentId = `${requirementId}-CMT-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    await INSERT.into(REQUIREMENT_COMMENT).entries({
        commentId, requirement_requirementId: requirementId,
        authorName: authorName || '', authorRole: authorRole || '',
        authorEmployee_employeeId: authorEmployeeId || null,
        message: text || null,
        attachmentName: buf ? (fileName || 'file') : null,
        attachmentMimeType: buf ? (mimeType || 'application/octet-stream') : null,
        attachment: buf || null
    });
    return commentId;
}

// Sum an employee's allocated bandwidth across ACTIVE projects (optionally
// excluding one project, e.g. when re-allocating within the same project).
async function usedBandwidth(employeeId, excludeProjectId) {
    const rows = await SELECT.from(PROJECT_RESOURCE).columns('project_projectId', 'bandwidth').where({ employee_employeeId: employeeId });
    if (!rows.length) return 0;
    const pids = [...new Set(rows.map(r => r.project_projectId))];
    const projs = await SELECT.from(PROJECT).columns('projectId', 'status').where({ projectId: { in: pids } });
    const activeSet = new Set((projs || []).filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).map(p => p.projectId));
    return rows.filter(r => activeSet.has(r.project_projectId) && r.project_projectId !== excludeProjectId)
        .reduce((s, r) => s + (Number(r.bandwidth) || 0), 0);
}

// Total committed FTE bandwidth per employee, counting ONLY capacity-consuming
// projects (ACTIVE_PROJECT_STATUSES). Allocations on Cancelled or Completed projects
// are excluded, so cancelling a project immediately frees that employee's capacity.
// Returns { employeeId: totalBandwidth }.
async function committedBandwidthByEmployee(employeeIds) {
    const map = {};
    if (!employeeIds || !employeeIds.length) return map;
    const rows = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'project_projectId', 'bandwidth').where({ employee_employeeId: { in: employeeIds } });
    if (!rows.length) return map;
    const pids = [...new Set(rows.map(r => r.project_projectId))];
    const projs = await SELECT.from(PROJECT).columns('projectId', 'status').where({ projectId: { in: pids } });
    const activeSet = new Set((projs || []).filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).map(p => p.projectId));
    rows.forEach(r => { if (!activeSet.has(r.project_projectId)) return; map[r.employee_employeeId] = (map[r.employee_employeeId] || 0) + (Number(r.bandwidth) || 0); });
    return map;
}

// Resolve caller + their EmployeeMaster role/active flag in one shot.
async function projectCaller(req) {
    const caller = await resolveCaller(req);
    if (!caller.employeeId) return { ...caller, role: null, name: '', active: false };
    const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'role', 'isActive')
        .where({ employeeId: caller.employeeId });
    return { ...caller, role: (emp && emp.role || '').toLowerCase(), name: emp && emp.employeeName || caller.email, active: !(emp && emp.isActive === false) };
}
// Two-factor founder check: XSUAA Founder scope AND EmployeeMaster role 'founder'.
function isFounderCaller(req, c) { return hasScopeFor(req.user, 'founder') && c.role === 'founder'; }

// ── Executive / high-authority detection ────────────────────────────────────
// Founder/CEO/Executive/Super-Admin-style users have org-wide visibility and must
// NOT be assignable as project resources (they monitor, they aren't allocated).
// The app's only org-wide role is 'founder'; designation is also checked so a
// free-text "CEO"/"Executive"/"Super Admin" title is caught even if the role
// column wasn't set. Used by getAllocatableEmployees + allocateResources and any
// other resource-selection surface.
const EXECUTIVE_ROLES = new Set(['founder']);
// Only true C-suite / org-wide titles — deliberately NOT a bare "executive" so
// normal titles like "Sales Executive" / "Account Executive" are unaffected.
const EXECUTIVE_DESIGNATION_RX = /(\bfounder\b|\bco-?founder\b|\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|chief\s+\w+\s+officer|chief\s+executive|executive\s+officer|c-level|super\s*admin|managing\s+director)/i;
function isExecutiveEmployee(emp) {
    if (!emp) return false;
    if (EXECUTIVE_ROLES.has(String(emp.role || '').toLowerCase())) return true;
    return EXECUTIVE_DESIGNATION_RX.test(String(emp.designation || ''));
}
// Weighted task progress (status weighted by estimated hours):
//   Progress% = Σ(estimatedHours × statusWeight) / Σ(estimatedHours) × 100
// Status weights: Not Started 0 · In Progress 0.5 · (In) Review 0.8 · Completed 1 · Blocked 0.
// Edge cases: no tasks → 0; total estimate 0 → 0; all completed → 100.
const STATUS_WEIGHT = {
    'not started': 0, 'inprogress': 0.5, 'in progress': 0.5,
    'review': 0.8, 'in review': 0.8, 'completed': 1, 'blocked': 0
};
const projectProgress = (tasks) => {
    const t = tasks || []; if (!t.length) return 0;
    let earned = 0, total = 0;
    t.forEach(x => {
        const est = Number(x.estimatedHours) || 0;
        const w = STATUS_WEIGHT[String(x.status || '').toLowerCase().trim()];
        earned += est * (w == null ? 0 : w);
        total += est;
    });
    if (total <= 0) return 0;
    return Math.round((earned / total) * 100);
};

// Executive "AI" health summary — a deterministic narrative generated from the
// project metrics (no external LLM). Returns { health, text }.
function projectHealthSummary(m) {
    const health = (m.status === 'Completed') ? 'Completed'
        : (m.openCritical > 0 || m.budgetPct > 100) ? 'Critical'
            : (m.openHigh > 0 || m.progress < 40 || m.budgetPct > 90) ? 'At Risk'
                : 'On Track';
    const parts = [];
    parts.push(`Project is currently ${m.progress}% complete and ` +
        (health === 'Completed' ? 'is Completed.' : health === 'On Track' ? 'remains On Track.' : `is flagged ${health}.`));
    if (m.budget > 0) parts.push(`Budget utilization is ${m.budgetPct}%.`);
    if (m.openCritical || m.openHigh) parts.push(`${m.openCritical} critical and ${m.openHigh} high-severity issue(s) remain open.`);
    else parts.push('No high-severity issues are open.');
    if (m.plannedHours > 0) parts.push(`Resource utilization is ${m.workedPct < 60 ? 'below plan' : m.workedPct > 110 ? 'over plan' : 'healthy'} with ${m.workedPct}% of planned effort consumed.`);
    parts.push(health === 'Critical' ? 'Immediate leadership attention is recommended.'
        : health === 'At Risk' ? 'Delivery forecast is at risk — monitor closely.'
            : health === 'Completed' ? 'Delivery is complete.'
                : 'Current delivery forecast indicates the project can be achieved on schedule.');
    return { health, text: parts.join(' ') };
}

class ProjectService extends cds.ApplicationService {
    async init() {
        this.before('*', blockIfInactive);   // inactive accounts blocked (same as everywhere)
        ensureProjectTypes();   // seed types + backfill existing projects (fire-and-forget)

        // List active project types (for the creation dropdown + type-driven config).
        this.on('getProjectTypes', async (req) => {
            await ensureProjectTypes();
            const rows = await SELECT.from(PROJECT_TYPE).where({ isActive: true }).orderBy('sortOrder asc', 'name asc');
            return JSON.stringify({
                types: (rows || []).map(t => {
                    let cats = [], phs = [], mods = [], depts = [];
                    try { cats = JSON.parse(t.resourceCategories || '[]'); } catch (_) {}
                    try { phs = JSON.parse(t.phases || '[]'); } catch (_) {}
                    try { mods = JSON.parse(t.modules || '[]'); } catch (_) {}
                    try { depts = JSON.parse(t.departments || '[]'); } catch (_) {}
                    return { code: t.code, name: t.name, planningModel: t.planningModel, hasRevenue: t.hasRevenue !== false, resourceCategories: cats, departments: depts, phases: phs, modules: mods };
                })
            });
        });

        // Distinct active job ROLES (designations) — for a department, or for a
        // project's type departments. Backend query only (no UI filtering of all rows).
        this.on('getDepartmentRoles', async (req) => {
            const d = req.data || {};
            let depts = [];
            if (d.projectId) { const p = await SELECT.one.from(PROJECT).columns('projectType_code').where({ projectId: d.projectId }); depts = await typeDepartments(p && p.projectType_code); }
            else if (d.department) depts = [d.department];
            const roles = await rolesForDepartments(depts);
            return JSON.stringify({ departments: depts, roles });
        });

        // ══════════════════════════════════════════════════════════════════════
        // MILESTONE MANAGEMENT — additive, integrated with budget/cost/resource/
        // timesheet engines. Resource & task milestone links are optional, so
        // projects without milestones keep working exactly as before.
        // ══════════════════════════════════════════════════════════════════════
        const nextMilestoneId = async (pid) => {
            const rows = await SELECT.from(MILESTONE).columns('milestoneId').where({ project_projectId: pid });
            let max = 0; rows.forEach(r => { const mm = String(r.milestoneId).match(/-M-(\d+)$/); if (mm) max = Math.max(max, +mm[1]); });
            return `${pid}-M-${String(max + 1).padStart(3, '0')}`;
        };
        // PM / Product-Manager / Founder may manage milestones (app has no separate
        // Product-Manager role → manager + founder + the project POC qualify).
        const msAccess = async (req, c, pid) => {
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'startDate', 'endDate', 'executionBudget', 'budget', 'projectType_code').where({ projectId: pid });
            if (!p) return { error: 'Project not found.' };
            const isPoc = p.poc_employeeId === c.employeeId;
            return { p, isPoc, canManage: isFounderCaller(req, c) || c.role === 'manager' || c.role === 'founder' || isPoc };
        };

        // Per-project milestone metrics (progress / budget / cost / delay / deps) —
        // single source used by list, dashboard and reports. Server-side aggregation.
        async function computeMilestoneRollups(projectId) {
            const today = new Date().toISOString().slice(0, 10);
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'executionBudget', 'budget').where({ projectId });
            const executionBudget = project ? (Number(project.executionBudget) || Number(project.budget) || 0) : 0;
            const ms = await SELECT.from(MILESTONE).where({ project_projectId: projectId }).orderBy('sequence asc', 'plannedStartDate asc');
            if (!ms.length) return { milestones: [], executionBudget };
            const msIds = ms.map(m => m.milestoneId);
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'milestone_milestoneId', 'totalAllocationCost').where({ project_projectId: projectId });
            const tasks = await SELECT.from(PROJECT_TASK).columns('taskId', 'assignedTo_employeeId', 'milestone_milestoneId', 'status', 'estimatedHours', 'actualHours').where({ project_projectId: projectId });
            const taskIds = tasks.map(t => t.taskId);
            const entries = taskIds.length ? await SELECT.from(ENTRY).columns('timesheet_timesheetId', 'projectTask_taskId', 'hoursWorked').where({ projectTask_taskId: { in: taskIds } }) : [];
            const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
            const headers = tsIds.length ? await SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId').where({ timesheetId: { in: tsIds } }) : [];
            const empOfTs = {}; headers.forEach(h => { empOfTs[h.timesheetId] = h.employee_employeeId; });
            const config = await rp.loadConfig(); const overhead = Number(config.monthlyOverhead) || 0;
            const salaries = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'monthlySalary', 'hourlyCost', 'isActive').where({ isActive: true });
            const salByEmp = {}; salaries.forEach(s => { salByEmp[s.employee_employeeId] = s; });
            const caps = await SELECT.from(EMPLOYEE).columns('employeeId', 'monthlyCapacityHours');
            const capByEmp = {}; caps.forEach(e => { capByEmp[e.employeeId] = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : 160; });
            const rateOf = emp => rp.loadedHourlyRate(salByEmp[emp], capByEmp[emp] || 160, overhead);

            const resByMs = {}, taskByMs = {}, taskMs = {}, taskEmp = {};
            resources.forEach(r => { if (r.milestone_milestoneId) (resByMs[r.milestone_milestoneId] = resByMs[r.milestone_milestoneId] || []).push(r); });
            tasks.forEach(t => { taskMs[t.taskId] = t.milestone_milestoneId; taskEmp[t.taskId] = t.assignedTo_employeeId; if (t.milestone_milestoneId) (taskByMs[t.milestone_milestoneId] = taskByMs[t.milestone_milestoneId] || []).push(t); });
            const actualCostByMs = {}, actualHrsByMs = {};
            entries.forEach(e => { const k = taskMs[e.projectTask_taskId]; if (!k) return; const hrs = Number(e.hoursWorked) || 0; const emp = empOfTs[e.timesheet_timesheetId] || taskEmp[e.projectTask_taskId]; actualHrsByMs[k] = (actualHrsByMs[k] || 0) + hrs; actualCostByMs[k] = (actualCostByMs[k] || 0) + hrs * rateOf(emp); });

            const deps = await SELECT.from(MILESTONE_DEP).columns('dependencyId', 'milestone_milestoneId', 'predecessor_milestoneId').where({ milestone_milestoneId: { in: msIds } });
            const depByMs = {}; deps.forEach(d => { (depByMs[d.milestone_milestoneId] = depByMs[d.milestone_milestoneId] || []).push(d); });
            const nameById = {}; ms.forEach(m => { nameById[m.milestoneId] = m.name; });
            const statusById = {}; // computed below, needed for dependency-ready flag

            const out = ms.map(m => {
                const mid = m.milestoneId;
                const res = resByMs[mid] || [], mtasks = taskByMs[mid] || [];
                const allocatedCost = Math.round(res.reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0));
                const actualCost = Math.round(actualCostByMs[mid] || 0);
                let progress = Number(m.progressPct) || 0;
                if (m.progressMode === 'task') progress = projectProgress(mtasks);
                else if (m.progressMode === 'timesheet') { const est = mtasks.reduce((s, t) => s + (Number(t.estimatedHours) || 0), 0); progress = est > 0 ? Math.min(100, Math.round((actualHrsByMs[mid] || 0) / est * 100)) : 0; }
                const effStatus = milestoneStatus(m, progress, today);
                statusById[mid] = effStatus;
                const pEnd = m.plannedEndDate ? String(m.plannedEndDate).slice(0, 10) : null;
                const delayDays = (pEnd && today > pEnd && !MS_TERMINAL.includes(effStatus)) ? daysBetween(today, pEnd) : 0;
                const earlyDays = (effStatus === 'Completed Early' && m.actualEndDate && pEnd) ? daysBetween(pEnd, String(m.actualEndDate).slice(0, 10)) : 0;
                const plannedBudget = Number(m.plannedBudget) || 0;
                const forecastCost = Math.max(allocatedCost, actualCost);
                return {
                    milestoneId: mid, name: m.name, description: m.description || '', sequence: m.sequence || 0,
                    plannedStartDate: m.plannedStartDate, plannedEndDate: m.plannedEndDate, actualStartDate: m.actualStartDate, actualEndDate: m.actualEndDate,
                    status: effStatus, storedStatus: m.status, progressPct: progress, progressMode: m.progressMode || 'manual',
                    ownerId: m.owner_employeeId || '', ownerName: m.ownerName || '', remarks: m.remarks || '',
                    isCritical: m.isCritical === true, isBillable: m.isBillable !== false, approvalStatus: m.approvalStatus || 'None',
                    plannedBudget, allocatedCost, actualCost, forecastCost, remainingBudget: Math.round(plannedBudget - actualCost), budgetVariance: Math.round(plannedBudget - forecastCost),
                    taskCount: mtasks.length, resourceCount: new Set(res.map(r => r.employee_employeeId)).size, delayDays, earlyDays,
                    dependencies: (depByMs[mid] || []).map(d => ({ dependencyId: d.dependencyId, predecessorId: d.predecessor_milestoneId, predecessorName: nameById[d.predecessor_milestoneId] || d.predecessor_milestoneId }))
                };
            });
            // Mark which milestones are blocked by incomplete predecessors.
            out.forEach(o => { o.predecessorsComplete = (o.dependencies || []).every(d => MS_TERMINAL.includes(statusById[d.predecessorId])); });
            return { milestones: out, executionBudget };
        }

        // ── List milestones + dashboard summary (single call) ─────────────────────
        this.on('getMilestones', async (req) => {
            const c = await projectCaller(req);
            const acc = await msAccess(req, c, req.data.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            const roll = await computeMilestoneRollups(req.data.projectId);
            const ms = roll.milestones;
            const allocatedPlanned = ms.reduce((s, m) => s + (m.plannedBudget || 0), 0);
            const dashboard = {
                total: ms.length,
                completed: ms.filter(m => m.status === 'Completed' || m.status === 'Completed Early').length,
                delayed: ms.filter(m => m.status === 'Delayed').length,
                atRisk: ms.filter(m => m.status === 'At Risk').length,
                inProgress: ms.filter(m => m.status === 'In Progress').length,
                upcoming: ms.filter(m => m.status === 'Not Started' || m.status === 'Planned').length,
                blocked: ms.filter(m => m.status === 'Blocked').length,
                executionBudget: roll.executionBudget,
                milestoneBudgetAllocated: allocatedPlanned,
                milestoneBudgetUnallocated: Math.round(roll.executionBudget - allocatedPlanned),
                totalActualCost: ms.reduce((s, m) => s + (m.actualCost || 0), 0),
                totalForecastCost: ms.reduce((s, m) => s + (m.forecastCost || 0), 0)
            };
            return JSON.stringify({ milestones: ms, dashboard, canManage: acc.canManage, executionBudget: roll.executionBudget });
        });

        // ── Auto-seed milestones from the project type's phases ───────────────────
        this.on('seedMilestones', async (req) => {
            const c = await projectCaller(req);
            const acc = await msAccess(req, c, req.data.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised to manage milestones.' });
            const existing = await SELECT.from(MILESTONE).columns('milestoneId').where({ project_projectId: req.data.projectId });
            if (existing.length) return JSON.stringify({ ok: true, created: 0, message: 'Milestones already exist.' });
            await ensureProjectTypes();
            const pt = await SELECT.one.from(PROJECT_TYPE).columns('phases').where({ code: acc.p.projectType_code || 'OTHER' });
            let phases = []; try { phases = JSON.parse((pt && pt.phases) || '[]') || []; } catch (_) {}
            if (!phases.length) phases = ['Delivery'];   // default single milestone for non-phase types
            // Spread phases evenly across the project window.
            const start = acc.p.startDate ? new Date(acc.p.startDate) : new Date();
            const end = acc.p.endDate ? new Date(acc.p.endDate) : new Date(start.getTime() + 90 * 86400000);
            const span = Math.max(1, Math.round((end - start) / 86400000));
            const step = Math.floor(span / phases.length);
            let created = 0;
            for (let i = 0; i < phases.length; i++) {
                const ps = new Date(start.getTime() + i * step * 86400000);
                const pe = (i === phases.length - 1) ? end : new Date(start.getTime() + ((i + 1) * step - 1) * 86400000);
                await INSERT.into(MILESTONE).entries({
                    milestoneId: `${req.data.projectId}-M-${String(i + 1).padStart(3, '0')}`, project_projectId: req.data.projectId,
                    name: phases[i], sequence: i + 1, status: 'Not Started', progressPct: 0, progressMode: 'task',
                    plannedStartDate: ps.toISOString().slice(0, 10), plannedEndDate: pe.toISOString().slice(0, 10),
                    isBillable: true, plannedBudget: 0, approvalStatus: 'None'
                });
                // Finish-to-start dependency chain.
                if (i > 0) await INSERT.into(MILESTONE_DEP).entries({ dependencyId: `${req.data.projectId}-M-${String(i + 1).padStart(3, '0')}-DEP`, milestone_milestoneId: `${req.data.projectId}-M-${String(i + 1).padStart(3, '0')}`, predecessor_milestoneId: `${req.data.projectId}-M-${String(i).padStart(3, '0')}` });
                created++;
            }
            await projectAudit(req.data.projectId, c.name, 'Milestones Seeded', null, `${created} milestone(s)`);
            return JSON.stringify({ ok: true, created });
        });

        // ── Create / update / delete ──────────────────────────────────────────────
        const validateMilestoneBudget = async (projectId, execBudget, excludeId, newPlanned) => {
            const rows = await SELECT.from(MILESTONE).columns('milestoneId', 'plannedBudget').where({ project_projectId: projectId });
            const sum = rows.filter(r => r.milestoneId !== excludeId).reduce((s, r) => s + (Number(r.plannedBudget) || 0), 0) + (Number(newPlanned) || 0);
            return sum <= execBudget ? null : `Milestone budgets (₹${sum.toLocaleString('en-IN')}) would exceed the project Execution Budget (₹${execBudget.toLocaleString('en-IN')}).`;
        };
        const datesWithinProject = (p, s, e) => {
            if (s && p.startDate && String(s) < String(p.startDate).slice(0, 10)) return 'Milestone start cannot be before the project start.';
            if (e && p.endDate && String(e) > String(p.endDate).slice(0, 10)) return 'Milestone end cannot be after the project end.';
            if (s && e && String(e) < String(s)) return 'Milestone end cannot be before its start.';
            return null;
        };

        this.on('createMilestone', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const acc = await msAccess(req, c, d.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised to create milestones.' });
            if (!String(d.name || '').trim()) return JSON.stringify({ error: 'Milestone name is required.' });
            const dErr = datesWithinProject(acc.p, d.plannedStartDate, d.plannedEndDate);
            if (dErr) return JSON.stringify({ error: dErr });
            const execBudget = Number(acc.p.executionBudget) || Number(acc.p.budget) || 0;
            if (Number(d.plannedBudget) > 0 && execBudget > 0) { const bErr = await validateMilestoneBudget(d.projectId, execBudget, null, d.plannedBudget); if (bErr) return JSON.stringify({ error: bErr }); }
            const cnt = (await SELECT.from(MILESTONE).columns('milestoneId').where({ project_projectId: d.projectId })).length;
            const milestoneId = await nextMilestoneId(d.projectId);
            let ownerName = ''; if (d.ownerId) { const o = await SELECT.one.from(EMPLOYEE).columns('employeeName').where({ employeeId: d.ownerId }); ownerName = o ? o.employeeName : ''; }
            await INSERT.into(MILESTONE).entries({
                milestoneId, project_projectId: d.projectId, name: String(d.name).trim(), description: (d.description || '').trim(),
                sequence: d.sequence != null ? Number(d.sequence) : cnt + 1, status: 'Not Started', progressPct: 0,
                progressMode: d.progressMode || 'manual', plannedStartDate: d.plannedStartDate || null, plannedEndDate: d.plannedEndDate || null,
                owner_employeeId: d.ownerId || null, ownerName, remarks: (d.remarks || '').trim(),
                isCritical: d.isCritical === true, isBillable: d.isBillable !== false, plannedBudget: Number(d.plannedBudget) || 0, approvalStatus: 'None'
            });
            await projectAudit(d.projectId, c.name, 'Milestone Created', null, String(d.name).trim());
            if (d.ownerId) await createNotification(d.ownerId, 'MILESTONE_CREATED', 'Milestone Assigned', `You own milestone "${String(d.name).trim()}" in project ${acc.p.projectName}.`, d.projectId);
            return JSON.stringify({ ok: true, milestoneId });
        });

        this.on('updateMilestone', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: d.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId);
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const set = {};
            if (d.name != null) set.name = String(d.name).trim();
            if (d.description != null) set.description = String(d.description).trim();
            if (d.remarks != null) set.remarks = String(d.remarks).trim();
            if (d.isCritical != null) set.isCritical = d.isCritical === true;
            if (d.isBillable != null) set.isBillable = d.isBillable === true;
            if (d.progressMode != null) set.progressMode = d.progressMode;
            if (d.sequence != null) set.sequence = Number(d.sequence);
            if (d.plannedStartDate !== undefined) set.plannedStartDate = d.plannedStartDate || null;
            if (d.plannedEndDate !== undefined) set.plannedEndDate = d.plannedEndDate || null;
            const s = d.plannedStartDate !== undefined ? d.plannedStartDate : m.plannedStartDate;
            const e = d.plannedEndDate !== undefined ? d.plannedEndDate : m.plannedEndDate;
            const dErr = datesWithinProject(acc.p, s && String(s).slice(0, 10), e && String(e).slice(0, 10));
            if (dErr) return JSON.stringify({ error: dErr });
            if (d.plannedBudget != null) {
                const execBudget = Number(acc.p.executionBudget) || Number(acc.p.budget) || 0;
                if (execBudget > 0) { const bErr = await validateMilestoneBudget(m.project_projectId, execBudget, d.milestoneId, d.plannedBudget); if (bErr) return JSON.stringify({ error: bErr }); }
                set.plannedBudget = Number(d.plannedBudget) || 0;
            }
            if (d.ownerId !== undefined) { set.owner_employeeId = d.ownerId || null; const o = d.ownerId ? await SELECT.one.from(EMPLOYEE).columns('employeeName').where({ employeeId: d.ownerId }) : null; set.ownerName = o ? o.employeeName : ''; }
            await UPDATE(MILESTONE).set(set).where({ milestoneId: d.milestoneId });
            await projectAudit(m.project_projectId, c.name, 'Milestone Updated', null, set.name || m.name);
            return JSON.stringify({ ok: true });
        });

        this.on('deleteMilestone', async (req) => {
            const c = await projectCaller(req);
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: req.data.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId);
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            // Detach (don't delete) resources/tasks → no data loss; they revert to project-level.
            await UPDATE(PROJECT_RESOURCE).set({ milestone_milestoneId: null }).where({ milestone_milestoneId: req.data.milestoneId });
            await UPDATE(PROJECT_TASK).set({ milestone_milestoneId: null }).where({ milestone_milestoneId: req.data.milestoneId });
            await DELETE.from(MILESTONE_DEP).where({ milestone_milestoneId: req.data.milestoneId });
            await DELETE.from(MILESTONE_DEP).where({ predecessor_milestoneId: req.data.milestoneId });
            await DELETE.from(MILESTONE_APPROVAL).where({ milestone_milestoneId: req.data.milestoneId });
            await DELETE.from(MILESTONE).where({ milestoneId: req.data.milestoneId });
            await projectAudit(m.project_projectId, c.name, 'Milestone Deleted', m.name, null);
            return JSON.stringify({ ok: true });
        });

        // ── Dependencies ──────────────────────────────────────────────────────────
        this.on('setMilestoneDependency', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: d.milestoneId });
            const pre = await SELECT.one.from(MILESTONE).where({ milestoneId: d.predecessorId });
            if (!m || !pre) return JSON.stringify({ error: 'Milestone not found.' });
            if (m.project_projectId !== pre.project_projectId) return JSON.stringify({ error: 'Milestones must belong to the same project.' });
            if (d.milestoneId === d.predecessorId) return JSON.stringify({ error: 'A milestone cannot depend on itself.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            // Prevent a simple cycle (predecessor already depends on this milestone).
            const reverse = await SELECT.one.from(MILESTONE_DEP).where({ milestone_milestoneId: d.predecessorId, predecessor_milestoneId: d.milestoneId });
            if (reverse) return JSON.stringify({ error: 'That would create a circular dependency.' });
            await UPSERT.into(MILESTONE_DEP).entries({ dependencyId: `${d.milestoneId}<-${d.predecessorId}`, milestone_milestoneId: d.milestoneId, predecessor_milestoneId: d.predecessorId });
            return JSON.stringify({ ok: true });
        });
        this.on('removeMilestoneDependency', async (req) => {
            const c = await projectCaller(req);
            const dep = await SELECT.one.from(MILESTONE_DEP).where({ dependencyId: req.data.dependencyId });
            if (!dep) return JSON.stringify({ error: 'Dependency not found.' });
            const m = await SELECT.one.from(MILESTONE).columns('project_projectId').where({ milestoneId: dep.milestone_milestoneId });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            await DELETE.from(MILESTONE_DEP).where({ dependencyId: req.data.dependencyId });
            return JSON.stringify({ ok: true });
        });

        // ── Progress + lifecycle (start / progress / complete) ────────────────────
        // Predecessor gate: a milestone cannot START before its predecessors complete.
        const predecessorsComplete = async (milestoneId) => {
            const deps = await SELECT.from(MILESTONE_DEP).columns('predecessor_milestoneId').where({ milestone_milestoneId: milestoneId });
            if (!deps.length) return true;
            const preds = await SELECT.from(MILESTONE).columns('milestoneId', 'status').where({ milestoneId: { in: deps.map(d => d.predecessor_milestoneId) } });
            return preds.every(p => MS_TERMINAL.includes(p.status));
        };
        this.on('startMilestone', async (req) => {
            const c = await projectCaller(req);
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: req.data.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            if (!(await predecessorsComplete(req.data.milestoneId))) return JSON.stringify({ error: 'Cannot start — a predecessor milestone is not yet completed.' });
            await UPDATE(MILESTONE).set({ status: 'In Progress', actualStartDate: m.actualStartDate || new Date().toISOString().slice(0, 10) }).where({ milestoneId: req.data.milestoneId });
            await projectAudit(m.project_projectId, c.name, 'Milestone Started', null, m.name);
            return JSON.stringify({ ok: true });
        });
        this.on('updateMilestoneProgress', async (req) => {
            const c = await projectCaller(req);
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: req.data.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const pct = Math.max(0, Math.min(100, Number(req.data.progressPct) || 0));
            const set = { progressPct: pct, progressMode: 'manual' };
            if (pct > 0 && !m.actualStartDate) set.actualStartDate = new Date().toISOString().slice(0, 10);
            if (pct > 0 && m.status === 'Not Started') set.status = 'In Progress';
            await UPDATE(MILESTONE).set(set).where({ milestoneId: req.data.milestoneId });
            return JSON.stringify({ ok: true, progressPct: pct });
        });

        // ── Completion (rules + override) ─────────────────────────────────────────
        this.on('completeMilestone', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: d.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const override = d.override === true;
            if (!override) {
                // Rule: all milestone tasks complete (when any tasks are assigned).
                const open = await SELECT.from(PROJECT_TASK).columns('taskId').where({ milestone_milestoneId: d.milestoneId, status: { '<>': 'Completed' } });
                if (open && open.length) return JSON.stringify({ error: `${open.length} task(s) in this milestone are not yet complete. Complete them or override.`, needsOverride: true });
                // Rule: approval must be Approved when an approval was requested.
                if (m.approvalStatus === 'Pending Approval') return JSON.stringify({ error: 'Milestone approval is still pending.', needsOverride: true });
                if (m.approvalStatus === 'Rejected' || m.approvalStatus === 'Rework Required') return JSON.stringify({ error: `Milestone approval is "${m.approvalStatus}".`, needsOverride: true });
            }
            const todayStr = new Date().toISOString().slice(0, 10);
            const early = m.plannedEndDate && todayStr < String(m.plannedEndDate).slice(0, 10);
            await UPDATE(MILESTONE).set({ status: early ? 'Completed Early' : 'Completed', progressPct: 100, actualEndDate: todayStr }).where({ milestoneId: d.milestoneId });
            await projectAudit(m.project_projectId, c.name, override ? 'Milestone Completed (override)' : 'Milestone Completed', null, m.name);
            if (acc.p.poc_employeeId) await createNotification(acc.p.poc_employeeId, 'MILESTONE_COMPLETED', 'Milestone Completed', `Milestone "${m.name}" was completed in project ${acc.p.projectName}.`, m.project_projectId);
            return JSON.stringify({ ok: true, status: early ? 'Completed Early' : 'Completed' });
        });

        // ── Approval workflow ─────────────────────────────────────────────────────
        this.on('requestMilestoneApproval', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: d.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const approverId = d.approverId || acc.p.poc_employeeId;
            let approverName = ''; if (approverId) { const a = await SELECT.one.from(EMPLOYEE).columns('employeeName').where({ employeeId: approverId }); approverName = a ? a.employeeName : ''; }
            await INSERT.into(MILESTONE_APPROVAL).entries({ approvalId: `${d.milestoneId}-APR-${Date.now()}`, milestone_milestoneId: d.milestoneId, approverRole: d.approverRole || 'Project Manager', approverId, approverName, status: 'Pending Approval', comments: (d.comments || '').trim() });
            await UPDATE(MILESTONE).set({ approvalStatus: 'Pending Approval' }).where({ milestoneId: d.milestoneId });
            if (approverId) await createNotification(approverId, 'MILESTONE_APPROVAL', 'Milestone Approval Requested', `Approval requested for milestone "${m.name}".`, m.project_projectId);
            await projectAudit(m.project_projectId, c.name, 'Milestone Approval Requested', null, m.name);
            return JSON.stringify({ ok: true });
        });
        this.on('decideMilestoneApproval', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const m = await SELECT.one.from(MILESTONE).where({ milestoneId: d.milestoneId });
            if (!m) return JSON.stringify({ error: 'Milestone not found.' });
            const acc = await msAccess(req, c, m.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const decision = d.decision;   // Approved | Rejected | Rework Required
            if (!['Approved', 'Rejected', 'Rework Required'].includes(decision)) return JSON.stringify({ error: 'Invalid decision.' });
            const apr = await SELECT.one.from(MILESTONE_APPROVAL).where({ milestone_milestoneId: d.milestoneId, status: 'Pending Approval' });
            if (apr) await UPDATE(MILESTONE_APPROVAL).set({ status: decision, comments: (d.comments || '').trim(), decidedAt: new Date() }).where({ approvalId: apr.approvalId });
            await UPDATE(MILESTONE).set({ approvalStatus: decision }).where({ milestoneId: d.milestoneId });
            await projectAudit(m.project_projectId, c.name, `Milestone ${decision}`, null, m.name);
            return JSON.stringify({ ok: true, status: decision });
        });

        // ── Resource transfer between milestones ──────────────────────────────────
        this.on('transferMilestoneResource', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const from = await SELECT.one.from(MILESTONE).columns('project_projectId', 'name').where({ milestoneId: d.fromMilestoneId });
            const to = await SELECT.one.from(MILESTONE).columns('project_projectId', 'name').where({ milestoneId: d.toMilestoneId });
            if (!from || !to) return JSON.stringify({ error: 'Milestone not found.' });
            if (from.project_projectId !== to.project_projectId) return JSON.stringify({ error: 'Milestones must be in the same project.' });
            const acc = await msAccess(req, c, from.project_projectId); if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            const allocationId = `${from.project_projectId}-${d.employeeId}`;
            const res = await SELECT.one.from(PROJECT_RESOURCE).where({ allocationId, milestone_milestoneId: d.fromMilestoneId });
            if (!res) return JSON.stringify({ error: 'That resource is not allocated to the source milestone.' });
            await UPDATE(PROJECT_RESOURCE).set({ milestone_milestoneId: d.toMilestoneId }).where({ allocationId });
            await projectAudit(from.project_projectId, c.name, 'Resource Transferred', `${res.employeeName}: ${from.name}`, to.name);
            return JSON.stringify({ ok: true });
        });

        // ── Phase 15: downloadable milestone reports (xlsx / pdf) ─────────────────
        this.on('generateMilestoneReport', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const acc = await msAccess(req, c, d.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            const reportType = String(d.reportType || 'status').toLowerCase();
            const format = String(d.format || 'xlsx').toLowerCase() === 'pdf' ? 'pdf' : 'xlsx';
            const msReport = require('./services/milestone-report');
            if (!msReport.REPORT_TYPES.includes(reportType)) return JSON.stringify({ error: `Unknown report type "${reportType}".` });
            const rollup = await computeMilestoneRollups(d.projectId);
            if (!rollup.milestones || !rollup.milestones.length) return JSON.stringify({ error: 'No milestones to report on.' });
            try {
                const file = await msReport.buildMilestoneReport({
                    project: { projectId: acc.p.projectId, projectName: acc.p.projectName },
                    rollup, reportType, format
                });
                return JSON.stringify({ ok: true, fileName: file.fileName, mime: file.mime, base64: file.buffer.toString('base64') });
            } catch (e) {
                cds.log('ms-report').error('Report generation failed:', e.message || e);
                return JSON.stringify({ error: 'Could not generate the report.' });
            }
        });

        // ── Phase 4: project resource requirements (demand side) ──────────────────
        this.on('getResourceHierarchy', async () => {
            try { return JSON.stringify(await buildResourceHierarchy()); }
            catch (e) { return JSON.stringify({ error: 'Could not load resource hierarchy.' }); }
        });

        this.on('getResourceRequirements', async (req) => {
            const c = await projectCaller(req);
            const acc = await msAccess(req, c, req.data.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            const rows = await SELECT.from(PROJ_REQ).where({ project_projectId: req.data.projectId }).orderBy('createdAt asc');
            return JSON.stringify({
                requirements: rows.map(r => ({
                    requirementId: r.requirementId, departmentId: r.department_deptId, departmentName: r.departmentName,
                    roleCategoryId: r.roleCategory_roleId, roleCategoryName: r.roleCategoryName,
                    specializationId: r.specialization_specId, specializationName: r.specializationName,
                    requiredCount: r.requiredCount, requiredHours: r.requiredHours,
                    startDate: r.startDate, endDate: r.endDate, notes: r.notes, status: r.status
                })),
                canManage: acc.canManage
            });
        });

        this.on('createResourceRequirement', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const acc = await msAccess(req, c, d.projectId);
            if (acc.error) return JSON.stringify({ error: acc.error });
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised to define resource requirements.' });
            if (!d.departmentId) return JSON.stringify({ error: 'Department is required.' });
            // Resolve display names from the masters (denormalised for fast reads).
            const dept = await SELECT.one.from(DEPT_MASTER).columns('name').where({ deptId: d.departmentId });
            const role = d.roleCategoryId ? await SELECT.one.from(ROLE_MASTER).columns('name').where({ roleId: d.roleCategoryId }) : null;
            const spec = d.specializationId ? await SELECT.one.from(SPEC_MASTER).columns('name').where({ specId: d.specializationId }) : null;
            const cnt = (await SELECT.from(PROJ_REQ).columns('requirementId').where({ project_projectId: d.projectId })).length;
            const requirementId = `${d.projectId}-REQ-${String(cnt + 1).padStart(3, '0')}`;
            await INSERT.into(PROJ_REQ).entries({
                requirementId, project_projectId: d.projectId,
                department_deptId: d.departmentId, departmentName: dept ? dept.name : d.departmentId,
                roleCategory_roleId: d.roleCategoryId || null, roleCategoryName: role ? role.name : null,
                specialization_specId: d.specializationId || null, specializationName: spec ? spec.name : null,
                requiredCount: Math.max(1, parseInt(d.requiredCount, 10) || 1),
                requiredHours: Number(d.requiredHours) || 0,
                startDate: d.startDate || null, endDate: d.endDate || null, notes: (d.notes || '').trim() || null, status: 'Open'
            });
            await projectAudit(d.projectId, c.name, 'Resource Requirement Added', null, `${dept ? dept.name : ''} ${role ? '· ' + role.name : ''} ${spec ? '· ' + spec.name : ''} ×${Math.max(1, parseInt(d.requiredCount, 10) || 1)}`);
            return JSON.stringify({ ok: true, requirementId });
        });

        this.on('deleteResourceRequirement', async (req) => {
            const c = await projectCaller(req);
            const r = await SELECT.one.from(PROJ_REQ).columns('requirementId', 'project_projectId').where({ requirementId: req.data.requirementId });
            if (!r) return JSON.stringify({ error: 'Requirement not found.' });
            const acc = await msAccess(req, c, r.project_projectId);
            if (!acc.canManage) return JSON.stringify({ error: 'Not authorised.' });
            await DELETE.from(PROJ_REQ).where({ requirementId: req.data.requirementId });
            return JSON.stringify({ ok: true });
        });

        // ── Founder: create a project + assign POC ──────────────────────────────
        this.on('createProject', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can create projects.' });
            const d = req.data || {};
            const name = (d.projectName || '').trim();
            if (!name) return JSON.stringify({ error: 'Project Name is required.' });
            if (!d.startDate) return JSON.stringify({ error: 'Start Date is required.' });
            if (d.endDate && String(d.endDate) < String(d.startDate)) return JSON.stringify({ error: 'End Date cannot be before Start Date.' });
            if (d.goLiveDate && d.endDate && String(d.goLiveDate) > String(d.endDate)) return JSON.stringify({ error: 'Go-Live Date must be on or before the End Date.' });
            if (d.goLiveDate && String(d.goLiveDate) < String(d.startDate)) return JSON.stringify({ error: 'Go-Live Date cannot be before the Start Date.' });
            const dup = await SELECT.one.from(PROJECT).columns('projectId').where('lower(projectName) =', name.toLowerCase());
            if (dup) return JSON.stringify({ error: `A project named “${name}” already exists.` });
            if (!d.pocEmployeeId) return JSON.stringify({ error: 'Please select a POC.' });
            const poc = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email', 'isActive').where({ employeeId: d.pocEmployeeId });
            if (!poc) return JSON.stringify({ error: 'Selected POC was not found.' });
            if (poc.isActive === false) return JSON.stringify({ error: 'POC must be an active employee.' });
            // Client assignment is mandatory — every project belongs to one client.
            if (!d.clientId) return JSON.stringify({ error: 'Please select a Client for this project.' });
            const client = await SELECT.one.from(CLIENT_MASTER).columns('clientId', 'clientName', 'status').where({ clientId: d.clientId });
            if (!client) return JSON.stringify({ error: 'Selected client was not found.' });
            // Inactive/Blacklisted clients cannot receive new projects.
            const clientBlock = clientActionBlock(client.status);
            if (clientBlock) return JSON.stringify({ error: clientBlock });

            // ── Project Type (mandatory) — drives all downstream planning/budgeting.
            await ensureProjectTypes();
            const typeCode = d.projectType || 'OTHER';
            const ptype = await SELECT.one.from(PROJECT_TYPE).columns('code', 'name', 'hasRevenue').where({ code: typeCode, isActive: true });
            if (!ptype) return JSON.stringify({ error: 'Please select a valid Project Type.' });

            // ── Financial model: Contract Value → Profit Reserve → Execution Budget.
            // Internal/cost-tracking types carry no revenue → reserve 0, execution = entered budget.
            const contractValue = Math.max(0, Number(d.contractValue) || 0);
            let marginPct = Math.max(0, Math.min(100, Number(d.profitMarginPct) || 0));
            if (!ptype.hasRevenue) marginPct = 0;
            const profitReserve = Math.round(contractValue * marginPct) / 100;
            // Execution budget = contract − reserve (revenue types); else the contract value
            // itself acts as the cost ceiling for internal projects.
            const executionBudget = ptype.hasRevenue ? Math.round((contractValue - profitReserve) * 100) / 100 : contractValue;

            const projectId = await nextProjectId();
            await INSERT.into(PROJECT).entries({
                projectId, projectName: name, customerName: (client.clientName || '').trim(),
                description: (d.description || '').trim(), startDate: d.startDate || null, endDate: d.endDate || null,
                status: 'Planning', priority: d.priority || 'Medium',
                lifecycleStage: 'Planning',
                poc_employeeId: poc.employeeId, pocName: poc.employeeName || '', createdByName: c.name || 'Founder',
                client_clientId: client.clientId, clientName: client.clientName || '',
                projectType_code: ptype.code, projectTypeName: ptype.name,
                contractValue, profitMarginPct: marginPct, profitReserveAmount: profitReserve, executionBudget,
                // budget kept in sync with executionBudget for back-compat with all existing readers.
                budget: executionBudget, goLiveDate: d.goLiveDate || null, focusAreas: (d.focusAreas || '').trim()
            });
            await projectAudit(projectId, c.name, 'Project Created', null, name);
            await projectAudit(projectId, c.name, 'Project Type Set', null, ptype.name);
            if (contractValue > 0) await projectAudit(projectId, c.name, 'Financials Set', null,
                `Contract ₹${contractValue.toLocaleString('en-IN')} · Margin ${marginPct}% · Reserve ₹${profitReserve.toLocaleString('en-IN')} · Execution ₹${executionBudget.toLocaleString('en-IN')}`);
            await projectAudit(projectId, c.name, 'Client Assigned', null, client.clientName || client.clientId);
            await projectAudit(projectId, c.name, 'POC Assigned', null, poc.employeeName || poc.employeeId);
            await sendProjectMail(poc.employeeId, poc.email,
                'Project POC Assignment',
                `You have been assigned as Project POC for project ${name}.\n\nPlease login to access project details and allocate required resources.`,
                projectId, 'PROJECT_POC');
            founderEvents.ping('createProject');
            return JSON.stringify({ ok: true, projectId, projectName: name, pocName: poc.employeeName });
        });

        // ── Founder: change project status ──────────────────────────────────────
        this.on('updateProjectStatus', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can change project status.' });
            const { projectId, status } = req.data;
            const VALID = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'];
            if (!VALID.includes(status)) return JSON.stringify({ error: 'Invalid status.' });
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'status').where({ projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            // Once a project leaves Planning (onboarding complete), it can never be
            // moved back to Planning — that phase is a one-way gate.
            if (status === 'Planning' && p.status !== 'Planning')
                return JSON.stringify({ error: 'This project has already been activated and cannot be moved back to Planning.' });
            await UPDATE(PROJECT).set({ status }).where({ projectId });
            await projectAudit(projectId, c.name, 'Status Changed', p.status, status);

            // Cancelling (or completing) a project releases its committed bandwidth: all
            // capacity/utilization calculations count only ACTIVE_PROJECT_STATUSES projects,
            // so the allocations stop consuming capacity immediately while the roster is
            // preserved (and automatically reinstated if the project is reactivated).
            if (status === 'Cancelled' && p.status !== 'Cancelled') {
                const allocs = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: projectId });
                if ((allocs || []).length) await projectAudit(projectId, c.name, 'Resources Released', `${allocs.length} allocation(s)`, 'Project cancelled — capacity freed');
            }
            founderEvents.ping('updateProjectStatus');
            return JSON.stringify({ ok: true, projectId, status });
        });

        // ── Founder: complete the planning meeting → advance lifecycle ──────────
        this.on('completePlanningMeeting', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can complete the planning meeting.' });
            const { projectId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'planningMeetingId', 'lifecycleStage', 'status').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            if (project.status !== 'Planning') return JSON.stringify({ error: 'Project is not in Planning status.' });
            if (!project.planningMeetingId) return JSON.stringify({ error: 'No planning meeting scheduled. Schedule a meeting first.' });
            if (project.lifecycleStage !== 'MeetingScheduled') return JSON.stringify({ error: 'Planning meeting must be in Scheduled state.' });

            await UPDATE(MEETING).set({ status: 'Completed' }).where({ meetingId: project.planningMeetingId });
            await UPDATE(PROJECT).set({ lifecycleStage: 'MeetingCompleted' }).where({ projectId });
            await projectAudit(projectId, c.name, 'Planning Meeting Completed', 'MeetingScheduled', 'MeetingCompleted');
            return JSON.stringify({ ok: true, projectId, lifecycleStage: 'MeetingCompleted' });
        });

        // ── Founder: allocate project budget → advance lifecycle ─────────────────
        this.on('saveBudgetAllocation', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can allocate the budget.' });
            const { projectId, totalBudget, departmentBudgets, otherBudgets, categoryBudgets } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'lifecycleStage', 'status', 'executionBudget').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            // Budget may be allocated in Planning and edited afterwards while the project
            // is Active/On Hold. Only Completed/Cancelled projects are locked.
            if (['Completed', 'Cancelled'].includes(project.status)) return JSON.stringify({ error: 'Budget cannot be changed for a completed or cancelled project.' });
            // Prerequisite: the planning meeting must be completed. Once satisfied, the
            // lifecycle advances to MeetingCompleted → BudgetAllocated → Active, and every
            // later stage keeps the prerequisite satisfied — so EDITING an already-allocated
            // budget (on an Active project) must not re-trigger this check.
            const meetingDone = project.status !== 'Planning'
                || ['MeetingCompleted', 'BudgetAllocated', 'Active'].includes(project.lifecycleStage);
            if (!meetingDone) return JSON.stringify({ error: 'Complete the planning meeting before allocating budget.' });

            // The allocation ceiling is the EXECUTION BUDGET (contract − profit reserve),
            // NOT the contract value. Fall back to the entered total when no execution
            // budget was defined at creation (legacy projects).
            const execBudget = Number(project.executionBudget) || 0;
            const ceiling = execBudget > 0 ? execBudget : (Number(totalBudget) || 0);
            if (!(ceiling > 0)) return JSON.stringify({ error: 'No Execution Budget is defined for this project. Set the contract value & margin first.' });

            // Sum category allocation and enforce the ceiling server-side.
            let catArr = [];
            try { catArr = (typeof categoryBudgets === 'string') ? JSON.parse(categoryBudgets || '[]') : (categoryBudgets || []); } catch (_) { catArr = []; }
            const catSum = catArr.reduce((s, x) => s + (Number(x.amount) || 0), 0);
            if (catSum > ceiling) {
                return JSON.stringify({ error: `Allocated budget (₹${catSum.toLocaleString('en-IN')}) exceeds the Execution Budget (₹${ceiling.toLocaleString('en-IN')}) by ₹${(catSum - ceiling).toLocaleString('en-IN')}.` });
            }

            const budgetId = `${projectId}-BUDGET`;
            await UPSERT.into(PROJECT_BUDGET).entries({
                budgetId, project_projectId: projectId,
                totalBudget: ceiling,
                departmentBudgets: (typeof departmentBudgets === 'string') ? departmentBudgets : JSON.stringify(departmentBudgets || []),
                otherBudgets: (typeof otherBudgets === 'string') ? otherBudgets : JSON.stringify(otherBudgets || []),
                categoryBudgets: (typeof categoryBudgets === 'string') ? categoryBudgets : JSON.stringify(categoryBudgets || []),
                allocatedAt: new Date(), allocatedByName: c.name || 'Founder'
            });
            // ── Auto-activate on budget allocation ────────────────────────────────
            // Allocating the budget completes onboarding: the project automatically
            // moves Planning → Active (no manual status change). This unlocks the full
            // project dashboard and hides the lifecycle tracker on every screen (both
            // gate on status === 'Planning'). Re-saving an already-Active project's
            // budget just updates the numbers and leaves the status untouched.
            const wasPlanning = project.status === 'Planning';
            await UPDATE(PROJECT).set(wasPlanning
                ? { lifecycleStage: 'Active', status: 'Active' }
                : { lifecycleStage: project.lifecycleStage || 'Active' }
            ).where({ projectId });
            await projectAudit(projectId, c.name, 'Budget Allocated', null, `₹${catSum.toLocaleString('en-IN')} of ₹${ceiling.toLocaleString('en-IN')} execution budget`);
            if (wasPlanning) await projectAudit(projectId, c.name, 'Status Changed', 'Planning', 'Active — budget allocated, onboarding complete');

            // Notify POC that resource allocation can begin.
            if (project.poc_employeeId) {
                const poc = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where({ employeeId: project.poc_employeeId });
                if (poc) {
                    await createNotification(poc.employeeId, 'PROJECT_BUDGET_ALLOCATED', 'Budget Approved — Allocate Resources',
                        `Budget for project "${project.projectName}" has been approved. You can now allocate resources.`, projectId);
                    await sendProjectMail(poc.employeeId, poc.email,
                        'Budget Approved — Resource Allocation Can Begin',
                        `The project budget for "${project.projectName}" has been approved (Execution Budget: ₹${ceiling.toLocaleString('en-IN')}).\n\nResource planning can now begin. Please login to allocate resources.`,
                        projectId, 'PROJECT_BUDGET_ALLOCATED');
                }
            }
            return JSON.stringify({ ok: true, projectId, activated: wasPlanning, status: wasPlanning ? 'Active' : project.status, lifecycleStage: 'Active' });
        });

        // ── Get saved budget allocation for a project ─────────────────────────────
        this.on('getBudgetAllocation', async (req) => {
            const c = await projectCaller(req);
            const { projectId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId', 'budget',
                'projectType_code', 'projectTypeName', 'contractValue', 'profitMarginPct', 'profitReserveAmount', 'executionBudget').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            // Budget allocation is driven ENTIRELY by the project type's own
            // configuration (modules / resource categories / departments) — never by
            // generic org departments or employee designations. Priority:
            //   1. configured resourceCategories  2. configured modules  3. departments
            // If none are configured → empty (UI shows a proper empty state).
            await ensureProjectTypes();
            const ptype = await SELECT.one.from(PROJECT_TYPE).columns('planningModel', 'resourceCategories', 'modules', 'departments')
                .where({ code: project.projectType_code || 'OTHER' });
            const _parse = (s) => { try { return JSON.parse(s || '[]') || []; } catch (_) { return []; } };
            const cfgResourceCats = _parse(ptype && ptype.resourceCategories);
            const cfgModules = _parse(ptype && ptype.modules);
            const cfgDepts = _parse(ptype && ptype.departments);
            let typeResourceCategories, allocationUnitKind;
            if (cfgResourceCats.length) { typeResourceCategories = cfgResourceCats; allocationUnitKind = 'Resource Category'; }
            else if (cfgModules.length) { typeResourceCategories = cfgModules; allocationUnitKind = 'Module'; }
            else if (cfgDepts.length) { typeResourceCategories = cfgDepts; allocationUnitKind = 'Department'; }
            else { typeResourceCategories = []; allocationUnitKind = 'Department'; }
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: projectId });
            const isAlloc = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && project.poc_employeeId !== c.employeeId && !isAlloc)
                return JSON.stringify({ error: 'Access denied.' });
            const budget = await SELECT.one.from(PROJECT_BUDGET).where({ budgetId: `${projectId}-BUDGET` });
            let deptBudgets = [], otherBdgs = [], catBudgets = [];
            if (budget) {
                try { deptBudgets = JSON.parse(budget.departmentBudgets || '[]'); } catch (_) {}
                try { otherBdgs = JSON.parse(budget.otherBudgets || '[]'); } catch (_) {}
                try { catBudgets = JSON.parse(budget.categoryBudgets || '[]'); } catch (_) {}
            }
            // The allocation ceiling is the EXECUTION BUDGET (contract − reserve).
            // Falls back to Project.budget for legacy projects with no financial model.
            const executionBudget = Number(project.executionBudget) || Number(project.budget) || 0;
            const allocated = catBudgets.reduce((s, x) => s + (Number(x.amount) || 0), 0);
            return JSON.stringify({
                found: !!budget,
                budgetDefined: executionBudget > 0,
                // Financial model (carried from project creation).
                projectTypeName: project.projectTypeName || 'Other',
                contractValue: Number(project.contractValue) || 0,
                profitMarginPct: Number(project.profitMarginPct) || 0,
                profitReserveAmount: Number(project.profitReserveAmount) || 0,
                executionBudget,
                // Legacy total kept = executionBudget for older readers.
                totalBudget: executionBudget,
                // Allocation units driven ENTIRELY by Project Type config (SAP modules,
                // dev resource categories, …). Empty when the type has none configured.
                resourceCategories: typeResourceCategories,
                allocationUnitKind, // 'Module' | 'Resource Category' | 'Department'
                typeConfigured: typeResourceCategories.length > 0,
                planningModel: ptype ? ptype.planningModel : 'MonthlyCapacity',
                costCategories: COST_CATEGORIES.filter(x => x !== 'Resource Cost'),
                categories: COST_CATEGORIES,
                categoryBudgets: catBudgets, allocatedAmount: allocated, remainingAmount: executionBudget - allocated,
                departmentBudgets: deptBudgets, otherBudgets: otherBdgs,
                allocatedAt: budget ? budget.allocatedAt : null,
                allocatedByName: budget ? budget.allocatedByName : null
            });
        });

        // ── Founder: per-project Budget vs Actual analysis (Founder ONLY) ─────────
        // Actual cost = Σ(logged hours × active hourlyCost), grouped by department with
        // drill-down to individual employee cost. Paired against allocated dept budgets.
        this.on('getProjectBudgetAnalysis', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view budget analysis.' });
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'budget').where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });

            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: p.projectId });
            const tasks = await SELECT.from(PROJECT_TASK).columns('taskId').where({ project_projectId: p.projectId });
            const taskIds = tasks.map(t => t.taskId);
            const entries = taskIds.length ? await SELECT.from(ENTRY).columns('timesheet_timesheetId', 'projectTask_taskId', 'hoursWorked').where({ projectTask_taskId: { in: taskIds } }) : [];
            const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
            const headers = tsIds.length ? await SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId').where({ timesheetId: { in: tsIds } }) : [];
            const empOfTs = {}; headers.forEach(h => { empOfTs[h.timesheetId] = h.employee_employeeId; });
            const salaries = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'hourlyCost', 'isActive');
            const hourly = {}; salaries.forEach(s => { if (s.isActive !== false) hourly[s.employee_employeeId] = Number(s.hourlyCost) || 0; });

            // Worked hours per employee.
            const workedByEmp = {};
            entries.forEach(e => { const emp = empOfTs[e.timesheet_timesheetId]; if (!emp) return; workedByEmp[emp] = (workedByEmp[emp] || 0) + (Number(e.hoursWorked) || 0); });

            // Employee → department (allocated resources first; fall back to EmployeeMaster).
            const deptOfEmp = {}, nameOfEmp = {};
            resources.forEach(r => { deptOfEmp[r.employee_employeeId] = r.department || 'Unassigned'; nameOfEmp[r.employee_employeeId] = r.employeeName; });
            const empIds = [...new Set([...Object.keys(workedByEmp), ...resources.map(r => r.employee_employeeId)])];
            const missing = empIds.filter(id => !deptOfEmp[id] || !nameOfEmp[id]);
            if (missing.length) {
                const erows = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department').where({ employeeId: { in: missing } });
                erows.forEach(e => { if (!deptOfEmp[e.employeeId]) deptOfEmp[e.employeeId] = e.department || 'Unassigned'; if (!nameOfEmp[e.employeeId]) nameOfEmp[e.employeeId] = e.employeeName; });
            }

            // Allocated department budgets from the saved ProjectBudget row.
            const budgetRow = await SELECT.one.from(PROJECT_BUDGET).where({ budgetId: `${p.projectId}-BUDGET` });
            let deptAlloc = [], otherAlloc = [];
            if (budgetRow) {
                try { deptAlloc = JSON.parse(budgetRow.departmentBudgets || '[]'); } catch (_) {}
                try { otherAlloc = JSON.parse(budgetRow.otherBudgets || '[]'); } catch (_) {}
            }
            const totalBudget = budgetRow ? Number(budgetRow.totalBudget) || 0 : (Number(p.budget) || 0);
            const allocByDept = {}; (deptAlloc || []).forEach(d => { allocByDept[d.department || d.name || 'Unassigned'] = Number(d.amount) || 0; });

            // Aggregate actual cost + resources per department.
            const deptMap = {};
            empIds.forEach(id => {
                const dept = deptOfEmp[id] || 'Unassigned';
                const hrs = Math.round((workedByEmp[id] || 0) * 10) / 10;
                const rate = hourly[id] || 0;
                const cost = hrs * rate;
                if (!deptMap[dept]) deptMap[dept] = { department: dept, actual: 0, resources: [] };
                deptMap[dept].actual += cost;
                deptMap[dept].resources.push({ employeeId: id, employeeName: nameOfEmp[id] || id, workedHours: hrs, hourlyCost: Math.round(rate * 100) / 100, cost: Math.round(cost) });
            });
            // Ensure departments with an allocation but no spend still appear.
            Object.keys(allocByDept).forEach(d => { if (!deptMap[d]) deptMap[d] = { department: d, actual: 0, resources: [] }; });

            const byDepartment = Object.keys(deptMap).map(d => {
                const allocated = allocByDept[d] || 0;
                const actual = Math.round(deptMap[d].actual);
                return {
                    department: d, allocated: allocated, actual: actual,
                    remaining: Math.round(allocated - actual),
                    variance: Math.round(allocated - actual),
                    variancePct: allocated > 0 ? Math.round(((actual - allocated) / allocated) * 100) : (actual > 0 ? 100 : 0),
                    resources: deptMap[d].resources.sort((a, b) => b.cost - a.cost)
                };
            }).sort((a, b) => b.actual - a.actual);

            const totalActual = byDepartment.reduce((s, d) => s + d.actual, 0);
            const prog = projectProgress(tasks);
            const progFrac = Math.max(0.05, (Number(prog) || 0) / 100);
            const forecast = Math.round(totalActual / progFrac);

            // Allocated vs unallocated pool (derived from the budget JSON).
            const sumDept = (deptAlloc || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
            const sumOther = (otherAlloc || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);
            const allocatedBudget = Math.round(sumDept + sumOther);
            const unallocatedBudget = Math.round(totalBudget - allocatedBudget);

            // Additional-budget requests for this project, grouped by status.
            const reqRows = await SELECT.from(PROJECT_BUDGET_REQUEST).where({ project_projectId: p.projectId }).orderBy('createdAt desc');
            const mapReq = r => ({
                requestId: r.requestId, department: r.department,
                requestedAmount: Number(r.requestedAmount) || 0, approvedAmount: Number(r.approvedAmount) || 0,
                justification: r.justification || '', businessImpact: r.businessImpact || '',
                requestedByName: r.requestedByName, utilizationSnapshot: Number(r.utilizationSnapshot) || 0,
                founderComments: r.founderComments || '', status: r.status,
                requestDate: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
                decidedAt: r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : ''
            });
            const requests = {
                pending: reqRows.filter(r => r.status === 'Pending Founder Approval').map(mapReq),
                approved: reqRows.filter(r => r.status === 'Approved').map(mapReq),
                rejected: reqRows.filter(r => r.status === 'Rejected' || r.status === 'Withdrawn').map(mapReq)
            };

            return JSON.stringify({
                projectId: p.projectId, projectName: p.projectName,
                totalBudget: totalBudget, totalActual: totalActual,
                totalRemaining: Math.round(totalBudget - totalActual),
                allocatedBudget: allocatedBudget, unallocatedBudget: unallocatedBudget,
                utilizationPct: totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0,
                forecastAtCompletion: forecast, progressPct: Number(prog) || 0,
                byDepartment: byDepartment,
                otherBudgets: (otherAlloc || []).map(o => ({ category: o.category || o.name || 'Other', amount: Number(o.amount) || 0 })),
                requests: requests,
                hasBudget: !!budgetRow
            });
        });

        // ── POC operational resource-planning indicators (NO financial data) ──────
        // Capacity / utilization in hours & FTE %. Founder, POC or allocated employee.
        this.on('getProjectResourcePlanning', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: p.projectId }).orderBy('department asc', 'employeeName asc');
            const isPoc = p.poc_employeeId === c.employeeId;
            const isAllocated = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && !isPoc && !isAllocated) return JSON.stringify({ error: 'You do not have access to this project.' });

            // Single source of truth: utilization/capacity come from the central
            // engine (effective capacity = capacity − holidays/events − leave −
            // training − internal − reserve), NOT a flat 160h × bandwidth estimate.
            const empIds = resources.map(r => r.employee_employeeId);
            const profiles = await rp.computeProfiles(empIds);
            const allocPctByEmp = {}; resources.forEach(r => { allocPctByEmp[r.employee_employeeId] = Number(r.bandwidth) || 0; });

            const rows = resources.map(r => {
                const prof = profiles.get(r.employee_employeeId);
                const eff = prof ? prof.effectiveCapacityHours : rp.DEFAULT_MONTHLY_CAPACITY;
                const used = prof ? prof.allocatedHours : 0;
                return {
                    employeeId: r.employee_employeeId, employeeName: r.employeeName,
                    department: r.department || 'Unassigned',
                    utilizationPct: prof ? prof.utilizationPct : 0,
                    utilizedHours: used,
                    availableHours: prof ? prof.freeHours : eff,
                    standardHours: eff,
                    status: prof ? prof.status : 'Available',
                    projectAllocationPct: allocPctByEmp[r.employee_employeeId] || 0
                };
            });

            // Department roll-up (averaged engine utilization).
            const deptAgg = {};
            rows.forEach(r => { (deptAgg[r.department] = deptAgg[r.department] || []).push(r.utilizationPct); });
            const departments = Object.keys(deptAgg).map(d => {
                const arr = deptAgg[d]; const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
                return { department: d, utilizationPct: avg, capacityAvailablePct: Math.max(0, 100 - avg), memberCount: arr.length };
            }).sort((a, b) => b.utilizationPct - a.utilizationPct);

            return JSON.stringify({ projectId: p.projectId, standardHours: rp.DEFAULT_MONTHLY_CAPACITY, departments: departments, resources: rows });
        });

        // ══════════════════════════════════════════════════════════════════════
        // RESOURCE PLANNING & RECOMMENDATION (Phase 1 backend)
        // All calculation is bulk-computed in resource-planning.js — no per-row
        // DB round-trips, no frontend loops. Visible to Project Managers / Founder.
        // ══════════════════════════════════════════════════════════════════════
        const canPlanResources = (req, c) => isFounderCaller(req, c) || c.role === 'manager' || c.role === 'founder';

        // Resource Allocation screen feed: every active employee's utilization,
        // skills, current projects, free hours, availability + status, plus KPIs.
        // Server-side filtering keeps it performant for large directories.
        this.on('getResourcePool', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c)) return JSON.stringify({ error: 'Only Project Managers can view the resource pool.' });
            const d = req.data || {};
            const profiles = await rp.computeProfiles(null);
            const all = [...profiles.values()];
            let rows = all;
            if (d.department) rows = rows.filter(r => (r.department || '').toLowerCase() === String(d.department).toLowerCase());
            if (d.skill) { const sk = String(d.skill).toLowerCase(); rows = rows.filter(r => r.skills.some(s => s.includes(sk))); }
            if (d.nameSearch) {
                const q = String(d.nameSearch).toLowerCase();
                rows = rows.filter(r => (r.employeeName || '').toLowerCase().includes(q) || (r.employeeId || '').toLowerCase().includes(q));
            }
            if (d.minUtil != null && d.minUtil !== '') rows = rows.filter(r => r.utilizationPct >= Number(d.minUtil));
            if (d.maxUtil != null && d.maxUtil !== '') rows = rows.filter(r => r.utilizationPct <= Number(d.maxUtil));
            if (d.availabilityDate) rows = rows.filter(r => r.nextAvailableDate != null && r.nextAvailableDate <= String(d.availabilityDate));
            if (d.status) rows = rows.filter(r => r.status === d.status);
            rows.sort((a, b) => a.utilizationPct - b.utilizationPct || (a.employeeName || '').localeCompare(b.employeeName || ''));
            // KPIs always reflect the full pool, not the filtered subset.
            return JSON.stringify({ resources: rows, kpis: rp.computeKpis(all), total: rows.length, poolSize: all.length });
        });

        // Dashboard KPI tiles (full active workforce).
        this.on('getResourcePlanningKPIs', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c)) return JSON.stringify({ error: 'Not authorised.' });
            const profiles = await rp.computeProfiles(null);
            return JSON.stringify({ kpis: rp.computeKpis([...profiles.values()]) });
        });

        // Founder/Manager: over-utilized employees + override audit trail.
        // Powers the "Over-Utilized Employees" section + Resource Utilization
        // Overview cards on the resource dashboard.
        this.on('getOverUtilizedResources', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c)) return JSON.stringify({ error: 'Not authorised.' });
            const profiles = [...(await rp.computeProfiles(null)).values()];
            const kpis = rp.computeKpis(profiles);

            // Which employees have at least one overridden allocation.
            const overriddenRows = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'isOverridden').where({ isOverridden: true });
            const overriddenEmps = new Set((overriddenRows || []).map(r => r.employee_employeeId));

            const overUtilized = profiles
                .filter(p => p.totalBandwidth > 100)
                .sort((a, b) => b.totalBandwidth - a.totalBandwidth)
                .map(p => ({
                    employeeId: p.employeeId, employeeName: p.employeeName, department: p.department,
                    utilizationPct: p.totalBandwidth,            // FTE allocation %
                    band: p.band.band, color: p.band.color,
                    projects: p.currentProjects.map(x => x.projectName),
                    status: overriddenEmps.has(p.employeeId) ? 'Overridden' : 'Over-allocated'
                }));

            const audit = await SELECT.from(RESOURCE_OVERRIDE).orderBy('overriddenAt desc');
            const overrides = (audit || []).slice(0, 100).map(o => ({
                employeeName: o.employeeName, projectName: o.projectName,
                utilizationBefore: o.utilizationBefore, utilizationAfter: o.utilizationAfter,
                reason: o.reason, overriddenByName: o.overriddenByName,
                overriddenAt: o.overriddenAt ? new Date(o.overriddenAt).toLocaleString('en-IN') : ''
            }));
            return JSON.stringify({ kpis, overUtilized, overrides });
        });

        // Upcoming capacity risks + projects with resource shortages (engine-driven).
        this.on('getResourceCapacityRisks', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c)) return JSON.stringify({ error: 'Not authorised.' });
            const profiles = [...(await rp.computeProfiles(null)).values()];
            const byId = {}; profiles.forEach(p => { byId[p.employeeId] = p; });

            // Capacity risks: overallocated now, or fully booked but freeing soon (bench risk).
            const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
            const risks = [];
            profiles.forEach(p => {
                if (p.status === 'Overallocated') risks.push({ type: 'Overallocated', employeeName: p.employeeName, detail: `${p.utilizationPct}% utilized`, severity: 'high' });
                else if (p.totalBandwidth >= 100 && p.nextAvailableDate && p.nextAvailableDate <= soon) risks.push({ type: 'Rolling off soon', employeeName: p.employeeName, detail: `frees up ${p.nextAvailableDate}`, severity: 'medium' });
            });

            // Resource shortages: ACTIVE projects with no resources, or whose required
            // skills aren't covered by the allocated team.
            const projects = await SELECT.from(PROJECT).columns('projectId', 'projectName', 'status', 'requiredSkills').where({ status: { in: ACTIVE_PROJECT_STATUSES } });
            const allocs = await SELECT.from(PROJECT_RESOURCE).columns('project_projectId', 'employee_employeeId');
            const teamByProj = {}; (allocs || []).forEach(a => { (teamByProj[a.project_projectId] = teamByProj[a.project_projectId] || []).push(a.employee_employeeId); });
            const shortages = [];
            (projects || []).forEach(pr => {
                const team = teamByProj[pr.projectId] || [];
                if (!team.length) { shortages.push({ projectId: pr.projectId, projectName: pr.projectName, reason: 'No resources allocated' }); return; }
                const req = rp.parseSkills(pr.requiredSkills);
                if (req.length) {
                    const have = new Set();
                    team.forEach(id => (byId[id] ? byId[id].skills : []).forEach(s => have.add(s)));
                    const missing = req.filter(s => !have.has(s));
                    if (missing.length) shortages.push({ projectId: pr.projectId, projectName: pr.projectName, reason: `Missing skills: ${missing.join(', ')}` });
                }
            });
            return JSON.stringify({ risks, shortages });
        });

        // Project Health — Budget / Resource / Schedule / Profitability (green/yellow/red)
        // + the full cost forecast. Founder, POC or allocated employee.
        this.on('getProjectHealth', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: p.projectId });
            const isPoc = p.poc_employeeId === c.employeeId;
            const isAlloc = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && !isPoc && !isAlloc) return JSON.stringify({ error: 'You do not have access to this project.' });

            const { actualCost, actualHours, hourly } = await projectActualCost(p.projectId);
            const fin = await projectFinancials(p, hourly);
            const tasks = await SELECT.from(PROJECT_TASK).where({ project_projectId: p.projectId });
            const progress = projectProgress(tasks);

            // ── Schedule: progress vs elapsed time ───────────────────────────────
            const today = new Date();
            let elapsedPct = 0;
            if (p.startDate && p.endDate) {
                const s = new Date(p.startDate), e = new Date(p.endDate);
                elapsedPct = e > s ? Math.max(0, Math.min(100, Math.round((today - s) / (e - s) * 100))) : 100;
            }
            const overdue = tasks.filter(t => String(t.status || '').toLowerCase() !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today.toISOString().slice(0, 10)).length;
            const scheduleHealth = (p.status === 'Completed') ? 'Green'
                : (progress >= elapsedPct - 10 && overdue === 0) ? 'Green'
                    : (progress >= elapsedPct - 25) ? 'Yellow' : 'Red';

            // ── Budget: projected total cost vs execution budget ─────────────────
            const budgetRatio = fin.executionBudget > 0 ? fin.projectedTotalCost / fin.executionBudget : 0;
            const budgetHealth = fin.executionBudget <= 0 ? 'Yellow' : healthColor(budgetRatio, 0.9, 1.0001);

            // ── Profitability: projected margin% vs expected margin% ─────────────
            const profitabilityHealth = fin.contractValue <= 0 ? 'Green'
                : (fin.projectedMarginPct >= fin.expectedMarginPct) ? 'Green'
                    : (fin.projectedMarginPct >= fin.expectedMarginPct - 5) ? 'Yellow' : 'Red';

            // ── Resource: team utilization + skill shortage (engine) ─────────────
            let resourceHealth = 'Green';
            if (!resources.length) resourceHealth = 'Red';
            else {
                const profiles = [...(await rp.computeProfiles(resources.map(r => r.employee_employeeId))).values()];
                const over = profiles.filter(x => x.status === 'Overallocated').length;
                const nearly = profiles.filter(x => x.status === 'Nearly Full').length;
                resourceHealth = over > 0 ? 'Red' : nearly > 0 ? 'Yellow' : 'Green';
            }

            return JSON.stringify({
                projectId: p.projectId, projectName: p.projectName, projectTypeName: p.projectTypeName || 'Other',
                progress, elapsedPct, overdueTasks: overdue, actualCost, actualHours,
                ...fin,
                expectedProfit: fin.profitReserve,
                health: { budget: budgetHealth, resource: resourceHealth, schedule: scheduleHealth, profitability: profitabilityHealth }
            });
        });

        // Founder Financial Dashboard — per-project + portfolio rollup. Founder only.
        this.on('getFounderFinancials', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view financials.' });
            const projects = await SELECT.from(PROJECT).where({ status: { '<>': 'Cancelled' } }).orderBy('createdAt desc');
            const rows = [];
            const portfolio = { contractValue: 0, profitReserve: 0, executionBudget: 0, currentSpend: 0, forecastedSpend: 0, expectedProfit: 0, projectedProfit: 0 };
            for (const p of (projects || [])) {
                const { actualCost, hourly } = await projectActualCost(p.projectId);
                const fin = await projectFinancials(p, hourly);
                const actualMarginPct = fin.contractValue > 0 ? Math.round((fin.contractValue - actualCost) / fin.contractValue * 100) : 0;
                rows.push({
                    projectId: p.projectId, projectName: p.projectName, projectTypeName: p.projectTypeName || 'Other', status: p.status,
                    contractValue: fin.contractValue, profitReserve: fin.profitReserve, executionBudget: fin.executionBudget,
                    currentSpend: actualCost, forecastedSpend: fin.projectedTotalCost,
                    expectedMarginPct: fin.expectedMarginPct, projectedMarginPct: fin.projectedMarginPct, actualMarginPct,
                    expectedProfit: fin.profitReserve, projectedProfit: fin.projectedMargin,
                    budgetVariance: fin.budgetVariance, profitVariance: fin.profitVariance
                });
                portfolio.contractValue += fin.contractValue;
                portfolio.profitReserve += fin.profitReserve;
                portfolio.executionBudget += fin.executionBudget;
                portfolio.currentSpend += actualCost;
                portfolio.forecastedSpend += fin.projectedTotalCost;
                portfolio.expectedProfit += fin.profitReserve;
                portfolio.projectedProfit += fin.projectedMargin;
            }
            portfolio.budgetVariance = portfolio.executionBudget - portfolio.forecastedSpend;
            portfolio.profitVariance = portfolio.projectedProfit - portfolio.expectedProfit;
            portfolio.expectedMarginPct = portfolio.contractValue > 0 ? Math.round(portfolio.expectedProfit / portfolio.contractValue * 100) : 0;
            portfolio.projectedMarginPct = portfolio.contractValue > 0 ? Math.round(portfolio.projectedProfit / portfolio.contractValue * 100) : 0;
            return JSON.stringify({ portfolio, projects: rows });
        });

        // ── Per-project executive health + risk (shared by portfolio + drill-down)
        // Returns { health(0-100), healthLabel, risk, penalties, flags }.
        const projectHealth = (p, fin, tasks, hasResources, todayStr) => {
            const st = String(p.status || '');
            const isCompleted = st === 'Completed';
            const isActive = st === 'Active';
            const isOverdue = !isCompleted && p.endDate && String(p.endDate).slice(0, 10) < todayStr;
            const overBudget = fin.executionBudget > 0 && fin.projectedTotalCost > fin.executionBudget;
            const isCritical = String(p.priority || '') === 'Critical';
            const blocked = (tasks || []).filter(t => String(t.status || '').toLowerCase() === 'blocked').length;
            const delayP = isOverdue ? 25 : 0;
            const budgetP = overBudget ? 20 : 0;
            const riskP = (isCritical ? 15 : (String(p.priority) === 'High' ? 8 : 0)) + (blocked ? 10 : 0);
            const resP = (isActive && !hasResources) ? 10 : 0;
            const health = Math.max(0, Math.min(100, 100 - delayP - budgetP - riskP - resP));
            const score = delayP + budgetP + riskP + resP;
            const risk = score >= 45 ? 'Critical' : score >= 25 ? 'High' : score >= 10 ? 'Medium' : 'Low';
            return {
                health, healthLabel: health >= 90 ? 'Healthy' : health >= 70 ? 'At Risk' : 'Critical',
                risk, penalties: { delay: delayP, budget: budgetP, risk: riskP, resource: resP },
                isCompleted, isActive, isOverdue, overBudget, isCritical, blocked
            };
        };

        // ── Executive Portfolio Command Center ──────────────────────────────────
        // Single aggregation feeding every KPI, chart and table on the Founder
        // Portfolio Analysis dashboard. Reuses projectFinancials/projectActualCost
        // so numbers agree with the per-project financial screens.
        this.on('getPortfolioAnalysis', async (req) => {
          try {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view portfolio analysis.' });
            const today = new Date();
            const todayStr = today.toISOString().slice(0, 10);
            const curMonKey = todayStr.slice(0, 7);
            const projects = await SELECT.from(PROJECT).orderBy('createdAt desc');
            const clients = await SELECT.from(CLIENT_MASTER).columns('clientId', 'companyName', 'clientName');
            const clientNameById = {}; (clients || []).forEach(cl => { clientNameById[cl.clientId] = cl.companyName || cl.clientName || cl.clientId; });

            // 12-month buckets for revenue/spend trends.
            const months = [];
            for (let i = 11; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(-2) }); }
            const revByMonth = {}, spendByMonth = {}; months.forEach(m => { revByMonth[m.key] = 0; spendByMonth[m.key] = 0; });
            const spread = (startDate, endDate, total, bucket) => {
                if (!total) return;
                const s = startDate ? new Date(startDate) : today;
                let e = endDate ? new Date(endDate) : today; if (e > today) e = today;
                let ss = new Date(s.getFullYear(), s.getMonth(), 1);
                const keys = [];
                while (ss <= e) { const k = ss.toISOString().slice(0, 7); if (bucket[k] !== undefined) keys.push(k); ss = new Date(ss.getFullYear(), ss.getMonth() + 1, 1); }
                if (!keys.length) { if (bucket[curMonKey] !== undefined) bucket[curMonKey] += total; return; }
                const per = total / keys.length; keys.forEach(k => { bucket[k] += per; });
            };

            const statusBuckets = { Planning: 0, Ongoing: 0, 'On Hold': 0, Completed: 0 };
            const clientRev = {}; const table = []; const revVsCost = [];
            let totalContract = 0, forecastProfit = 0, currentSpendTot = 0, committedSpendTot = 0, execBudgetTot = 0, expectedProfitTot = 0, forecastSpendTot = 0, revenueRealized = 0, revenueAtRisk = 0;
            let cntTotal = 0, cntActive = 0, cntCompleted = 0, cntDelayed = 0, cntAtRisk = 0, cntOverBudget = 0, cntBlocked = 0, cntCritical = 0, cntUnderResourced = 0;
            let newTotal = 0, newActive = 0, newCompleted = 0;
            const projName = {}; (projects || []).forEach(p => { projName[p.projectId] = p.projectName; });

            for (const p of (projects || [])) {
              try {
                if (String(p.status) === 'Cancelled') continue;
                cntTotal++;
                const createdMon = p.createdAt ? String(p.createdAt).slice(0, 7) : '';
                if (createdMon === curMonKey) newTotal++;
                const { actualCost, hourly } = await projectActualCost(p.projectId);
                const fin = await projectFinancials(p, hourly);
                const tasks = await SELECT.from(PROJECT_TASK).columns('taskId', 'status', 'dueDate').where({ project_projectId: p.projectId });
                const completion = projectProgress(tasks);
                const resCount = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: p.projectId });
                const hasResources = (resCount || []).length > 0;
                const h = projectHealth(p, fin, tasks, hasResources, todayStr);

                const st = String(p.status || '');
                if (['Planning', 'MeetingScheduled', 'MeetingCompleted', 'BudgetAllocated'].includes(st)) statusBuckets.Planning++;
                else if (st === 'Active') statusBuckets.Ongoing++;
                else if (st === 'On Hold') statusBuckets['On Hold']++;
                else if (st === 'Completed') statusBuckets.Completed++;

                if (h.isActive) { cntActive++; if (createdMon === curMonKey) newActive++; }
                if (h.isCompleted) { cntCompleted++; if (createdMon === curMonKey) newCompleted++; }
                if (h.isOverdue) cntDelayed++;
                if (h.risk === 'High' || h.risk === 'Critical') cntAtRisk++;
                if (h.overBudget) cntOverBudget++;
                if (h.blocked) cntBlocked++;
                if (h.isCritical) cntCritical++;
                if (h.isActive && !hasResources) cntUnderResourced++;

                const forecastedSpend = Math.max(actualCost, fin.projectedTotalCost);
                const realized = Math.round(fin.contractValue * completion / 100);
                totalContract += fin.contractValue;
                forecastProfit += fin.projectedMargin;
                // Budget "consumed" is driven by committed resource allocation cost
                // (Σ totalAllocationCost); timesheet actuals are tracked separately.
                committedSpendTot += (Number(fin.allocatedResourceCost) || 0);
                currentSpendTot += actualCost;
                forecastSpendTot += forecastedSpend;
                execBudgetTot += fin.executionBudget;
                expectedProfitTot += fin.profitReserve;
                revenueRealized += realized;
                if (h.isOverdue || h.blocked > 0 || h.isCritical) revenueAtRisk += fin.contractValue;

                const cn = clientNameById[p.client_clientId] || p.clientName || 'Unassigned';
                clientRev[cn] = (clientRev[cn] || 0) + fin.contractValue;
                spread(p.startDate, p.endDate, realized, revByMonth);
                spread(p.startDate, p.endDate, actualCost, spendByMonth);
                revVsCost.push({ name: p.projectName, contract: fin.contractValue, forecast: forecastedSpend });
                table.push({
                    projectId: p.projectId, name: p.projectName, client: cn, pm: p.pocName || '—',
                    status: st, health: h.health, healthLabel: h.healthLabel, completion,
                    contractValue: fin.contractValue, projectedProfit: fin.projectedMargin,
                    marginPct: fin.projectedMarginPct, risk: h.risk
                });
              } catch (perr) {
                cds.log('portfolio').warn('Skipped project ' + (p && p.projectId) + ' in portfolio analysis:', perr.message || perr);
              }
            }

            const denom = cntTotal || 1;
            const portDelay = 30 * (cntDelayed / denom), portBudget = 25 * (cntOverBudget / denom), portRisk = 25 * (cntAtRisk / denom), portRes = 20 * (cntUnderResourced / denom);
            const portfolioHealth = Math.max(0, Math.round(100 - portDelay - portBudget - portRisk - portRes));

            const clientArr = Object.keys(clientRev).map(k => ({ name: k, value: Math.round(clientRev[k]) })).sort((a, b) => b.value - a.value);
            const topClients = clientArr.slice(0, 6);
            const othersVal = clientArr.slice(6).reduce((s, x) => s + x.value, 0);
            if (othersVal > 0) topClients.push({ name: 'Others', value: othersVal });

            const top5 = table.slice().sort((a, b) => b.projectedProfit - a.projectedProfit).slice(0, 5).map(t => ({ name: t.name, profit: t.projectedProfit }));
            const revVsCostTop = revVsCost.slice().sort((a, b) => b.contract - a.contract).slice(0, 10);

            const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
            const ms = await SELECT.from(MILESTONE).columns('milestoneId', 'name', 'project_projectId', 'plannedEndDate', 'status', 'plannedBudget', 'isCritical')
                .where('plannedEndDate >=', todayStr, 'and plannedEndDate <=', in30);
            const milestones = (ms || []).filter(m => String(m.status || '') !== 'Completed')
                .sort((a, b) => String(a.plannedEndDate).localeCompare(String(b.plannedEndDate))).slice(0, 12)
                .map(m => ({ project: projName[m.project_projectId] || m.project_projectId, milestone: m.name, dueDate: m.plannedEndDate, revenueImpact: Number(m.plannedBudget) || 0, critical: m.isCritical === true }));

            const pct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;
            return JSON.stringify({
                kpis: {
                    totalProjects: cntTotal, activeProjects: cntActive, completedProjects: cntCompleted,
                    delayedProjects: cntDelayed, atRiskProjects: cntAtRisk,
                    trends: { totalProjects: newTotal, activeProjects: newActive, completedProjects: newCompleted }
                },
                financials: {
                    totalContractValue: Math.round(totalContract), forecastedProfit: Math.round(forecastProfit),
                    portfolioMarginPct: pct(forecastProfit, totalContract),
                    revenueRealized: Math.round(revenueRealized), revenueAtRisk: Math.round(revenueAtRisk),
                    cashCollectionPct: pct(revenueRealized, totalContract),
                    budgetUtilizationPct: pct(committedSpendTot, execBudgetTot),
                    committedSpend: Math.round(committedSpendTot), actualSpend: Math.round(currentSpendTot),
                    currentSpend: Math.round(committedSpendTot), executionBudget: Math.round(execBudgetTot),
                    forecastedSpend: Math.round(forecastSpendTot), expectedProfit: Math.round(expectedProfitTot)
                },
                health: { score: portfolioHealth, label: portfolioHealth >= 90 ? 'Healthy' : portfolioHealth >= 70 ? 'Moderate' : 'Needs Attention', penalties: { delay: Math.round(portDelay), budget: Math.round(portBudget), risk: Math.round(portRisk), resource: Math.round(portRes) } },
                charts: {
                    statusDistribution: statusBuckets,
                    revenueByClient: topClients,
                    revenueVsCost: revVsCostTop,
                    top5Profitable: top5,
                    revenueTrend: months.map(m => ({ label: m.label, value: Math.round(revByMonth[m.key]) })),
                    spendTrend: months.map(m => ({ label: m.label, value: Math.round(spendByMonth[m.key]) })),
                    attention: { delayed: cntDelayed, overBudget: cntOverBudget, blocked: cntBlocked, critical: cntCritical },
                    milestones
                },
                table: table.sort((a, b) => b.contractValue - a.contractValue)
            });
          } catch (err) {
            cds.log('portfolio').error('getPortfolioAnalysis failed:', err);
            return JSON.stringify({ error: 'Portfolio analysis failed: ' + (err && err.message ? err.message : String(err)) });
          }
        });

        // ── Portfolio drill-down: full financial + delivery + resource detail ────
        this.on('getPortfolioProjectDetail', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view this.' });
            const p = await SELECT.one.from(PROJECT).where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const today = new Date();
            const todayStr = today.toISOString().slice(0, 10);
            const { actualCost, hourly } = await projectActualCost(p.projectId);
            const fin = await projectFinancials(p, hourly);
            const tasks = await SELECT.from(PROJECT_TASK).columns('taskId', 'status', 'dueDate').where({ project_projectId: p.projectId });
            const completion = projectProgress(tasks);
            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: p.projectId });
            const h = projectHealth(p, fin, tasks, resources.length > 0, todayStr);
            const forecastedSpend = Math.max(actualCost, fin.projectedTotalCost);
            const projectedProfit = fin.contractValue - forecastedSpend;
            const client = p.client_clientId ? await SELECT.one.from(CLIENT_MASTER).columns('companyName', 'clientName').where({ clientId: p.client_clientId }) : null;
            const allMs = await SELECT.from(MILESTONE).columns('name', 'plannedEndDate', 'actualEndDate', 'status', 'isCritical', 'plannedBudget').where({ project_projectId: p.projectId }).orderBy('sequence asc');
            const upcoming = (allMs || []).filter(m => String(m.status) !== 'Completed' && m.plannedEndDate && String(m.plannedEndDate).slice(0, 10) >= todayStr).slice(0, 6);
            const delayed = (allMs || []).filter(m => String(m.status) !== 'Completed' && m.plannedEndDate && String(m.plannedEndDate).slice(0, 10) < todayStr);

            // Resource utilisation / billable split.
            const totalBw = resources.reduce((s, r) => s + (Number(r.bandwidth) || 0), 0);
            const billableBw = resources.reduce((s, r) => s + ((r.isBillable === false) ? 0 : (Number(r.bandwidth) || 0)), 0);

            // Monthly spend/revenue trend across the project's own duration.
            const months = [];
            const start = p.startDate ? new Date(p.startDate) : today;
            let cur = new Date(start.getFullYear(), start.getMonth(), 1);
            const end = p.endDate ? new Date(p.endDate) : today;
            while (cur <= end && months.length < 24) { months.push({ key: cur.toISOString().slice(0, 7), label: cur.toLocaleString('en-US', { month: 'short' }) + " '" + String(cur.getFullYear()).slice(-2) }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
            const nMon = months.length || 1;
            const spendPer = Math.round(actualCost / nMon), revPer = Math.round(fin.contractValue * completion / 100 / nMon);
            let cumBurn = 0;
            const trend = months.map(m => { cumBurn += spendPer; return { label: m.label, spend: spendPer, revenue: revPer, burn: cumBurn }; });

            return JSON.stringify({
                project: {
                    projectId: p.projectId, name: p.projectName, client: client ? (client.companyName || client.clientName) : (p.clientName || '—'),
                    pm: p.pocName || '—', status: p.status, priority: p.priority, typeName: p.projectTypeName || 'Other',
                    health: h.health, healthLabel: h.healthLabel, risk: h.risk, completion
                },
                financial: {
                    contractValue: fin.contractValue, executionBudget: fin.executionBudget, currentSpend: actualCost,
                    forecastedSpend, projectedProfit, projectedMarginPct: fin.contractValue > 0 ? Math.round(projectedProfit / fin.contractValue * 100) : 0,
                    budgetVariance: fin.executionBudget - forecastedSpend, profitVariance: projectedProfit - fin.profitReserve,
                    expectedProfit: fin.profitReserve, profitReserve: fin.profitReserve,
                    revenueRealized: Math.round(fin.contractValue * completion / 100),
                    revenueAtRisk: (h.isOverdue || h.blocked > 0 || h.isCritical) ? fin.contractValue : 0
                },
                delivery: {
                    status: p.status, completion, healthScore: h.health,
                    upcomingMilestones: upcoming.map(m => ({ name: m.name, dueDate: m.plannedEndDate, critical: m.isCritical === true })),
                    delayedMilestones: delayed.map(m => ({ name: m.name, dueDate: m.plannedEndDate })),
                    blockedTasks: h.blocked, overdueTasks: (tasks || []).filter(t => String(t.status || '').toLowerCase() !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < todayStr).length
                },
                resourceInfo: {
                    allocated: resources.length,
                    utilizationPct: Math.min(100, Math.round(totalBw)),
                    billablePct: totalBw > 0 ? Math.round(billableBw / totalBw * 100) : 0,
                    benchPct: totalBw > 0 ? Math.round((totalBw - billableBw) / totalBw * 100) : 0,
                    list: resources.map(r => ({ name: r.employeeName, department: r.department, bandwidth: Number(r.bandwidth) || 0, role: r.role || '' }))
                },
                timeline: {
                    plannedStart: p.startDate, actualStart: p.actualStartDate || p.startDate,
                    plannedEnd: p.endDate, forecastedEnd: p.forecastedEndDate || p.endDate, goLive: p.goLiveDate || null
                },
                trend
            });
        });

        // Multi-month capacity timeline for ONE employee (range optional).
        this.on('getCapacityForecast', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c)) return JSON.stringify({ error: 'Not authorised.' });
            const d = req.data || {};
            const from = d.fromDate || new Date().toISOString().slice(0, 10);
            const to = d.toDate || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
            const tl = await rp.computeCapacityTimeline([d.employeeId], from, to);
            const row = tl.get(d.employeeId);
            return JSON.stringify(row || { months: [] });
        });

        // Per-project month-by-month capacity forecast for every allocated resource,
        // over the project's own duration. Flags the months a commitment breaks.
        this.on('getProjectCapacityForecast', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'startDate', 'endDate').where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'employeeName', 'department', 'bandwidth').where({ project_projectId: p.projectId });
            const isAllocated = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && p.poc_employeeId !== c.employeeId && !isAllocated)
                return JSON.stringify({ error: 'You do not have access to this project.' });
            if (!resources.length) return JSON.stringify({ projectId: p.projectId, months: [], resources: [] });

            const today = new Date().toISOString().slice(0, 10);
            const from = (p.startDate && String(p.startDate) > today) ? String(p.startDate).slice(0, 10) : today;
            const to = p.endDate ? String(p.endDate).slice(0, 10) : new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
            const tl = await rp.computeCapacityTimeline(resources.map(r => r.employee_employeeId), from, to);
            const first = tl.values().next().value;
            const monthLabels = first ? first.months.map(m => m.label) : [];
            const rows = resources.map(r => {
                const row = tl.get(r.employee_employeeId) || { months: [], breachMonths: [], peakUtilization: 0 };
                return {
                    employeeId: r.employee_employeeId, employeeName: r.employeeName, department: r.department,
                    thisProjectPct: Number(r.bandwidth) || 0,
                    months: row.months, breachMonths: row.breachMonths, peakUtilization: row.peakUtilization
                };
            });
            return JSON.stringify({ projectId: p.projectId, projectName: p.projectName, monthLabels, resources: rows });
        });

        // ── Resource Planning admin config (weights/threshold/working basis) ──────
        // Read is open to planners; write is Founder/HR only. Drives the engine.
        this.on('getResourcePlanningConfig', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c) && c.role !== 'hr') return JSON.stringify({ error: 'Not authorised.' });
            const cfg = await rp.loadConfig();
            const canEdit = isFounderCaller(req, c) || c.role === 'founder' || c.role === 'hr';
            return JSON.stringify({ config: cfg, canEdit });
        });

        this.on('saveResourcePlanningConfig', async (req) => {
            const c = await projectCaller(req);
            if (!(isFounderCaller(req, c) || c.role === 'founder' || c.role === 'hr'))
                return JSON.stringify({ error: 'Only the Founder or HR can change resource planning settings.' });
            const d = req.data || {};
            const num = (v, dft) => (v == null || v === '' || isNaN(Number(v))) ? dft : Number(v);
            const entry = {
                configId: 'GLOBAL',
                skillWeight: num(d.skillWeight, 60), availabilityWeight: num(d.availabilityWeight, 20),
                utilizationWeight: num(d.utilizationWeight, 10), experienceWeight: num(d.experienceWeight, 10),
                maxUtilizationThreshold: num(d.maxUtilizationThreshold, 100),
                standardDailyHours: num(d.standardDailyHours, 8), standardWorkingDays: num(d.standardWorkingDays, 20),
                nonBillablePct: num(d.nonBillablePct, 0),
                monthlyOverhead: num(d.monthlyOverhead, 10000)
            };
            if (entry.skillWeight + entry.availabilityWeight + entry.utilizationWeight + entry.experienceWeight <= 0)
                return JSON.stringify({ error: 'Recommendation weights cannot all be zero.' });
            await UPSERT.into(RP_CONFIG).entries(entry);
            return JSON.stringify({ ok: true, config: entry });
        });

        // ── Company events (non-working time that reduces capacity for everyone) ──
        this.on('getCompanyEvents', async (req) => {
            const c = await projectCaller(req);
            if (!canPlanResources(req, c) && c.role !== 'hr') return JSON.stringify({ error: 'Not authorised.' });
            const rows = await SELECT.from(COMPANY_EVENT).orderBy('fromDate desc');
            return JSON.stringify({
                events: (rows || []).map(e => ({ eventId: e.eventId, eventName: e.eventName,
                    fromDate: e.fromDate, toDate: e.toDate, description: e.description })),
                canEdit: isFounderCaller(req, c) || c.role === 'founder' || c.role === 'hr'
            });
        });

        this.on('saveCompanyEvent', async (req) => {
            const c = await projectCaller(req);
            if (!(isFounderCaller(req, c) || c.role === 'founder' || c.role === 'hr'))
                return JSON.stringify({ error: 'Only the Founder or HR can manage company events.' });
            const d = req.data || {};
            if (!String(d.eventName || '').trim()) return JSON.stringify({ error: 'Event name is required.' });
            if (!d.fromDate) return JSON.stringify({ error: 'Start date is required.' });
            if (d.toDate && String(d.toDate) < String(d.fromDate)) return JSON.stringify({ error: 'End date cannot be before start date.' });
            const eventId = d.eventId || `EVT-${Date.now()}`;
            await UPSERT.into(COMPANY_EVENT).entries({
                eventId, eventName: String(d.eventName).trim(), fromDate: d.fromDate,
                toDate: d.toDate || d.fromDate, description: (d.description || '').trim()
            });
            return JSON.stringify({ ok: true, eventId });
        });

        this.on('deleteCompanyEvent', async (req) => {
            const c = await projectCaller(req);
            if (!(isFounderCaller(req, c) || c.role === 'founder' || c.role === 'hr'))
                return JSON.stringify({ error: 'Only the Founder or HR can manage company events.' });
            await DELETE.from(COMPANY_EVENT).where({ eventId: req.data.eventId });
            return JSON.stringify({ ok: true });
        });

        // Recommend & rank employees for a project allocation. Skill weight 70% +
        // capacity weight 30%. requiredSkills override the project's stored skills
        // when provided (lets the PM tune the search live).
        // ══════════════════════════════════════════════════════════════════════
        // RESOURCE DEMAND PLANNING (Phase 6) — Founder demand-vs-supply analytics.
        // Reuses the existing Phase-4 requirement CRUD (getResourceRequirements /
        // createResourceRequirement / deleteResourceRequirement); adds only the
        // company-wide supply/shortage/hiring aggregation.
        // ══════════════════════════════════════════════════════════════════════
        this.on('getResourceDemandOverview', async (req) => {
          try {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view resource demand.' });
            const reqs = await SELECT.from(PROJ_REQ).where({ status: 'Open' });
            const projIds = [...new Set((reqs || []).map(r => r.project_projectId))];
            const projNames = {};
            if (projIds.length) (await SELECT.from(PROJECT).columns('projectId', 'projectName').where({ projectId: { in: projIds } })).forEach(p => { projNames[p.projectId] = p.projectName; });

            // Supply: active employees + availability profiles.
            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department', 'designation', 'skills').where({ isActive: true });
            const profiles = await rp.computeProfiles(emps.map(e => e.employeeId));
            const norm = s => String(s || '').toLowerCase().trim();
            // Match an employee to a requirement (department + role/spec keyword).
            const matches = (emp, r) => {
                const dept = norm(r.departmentName);
                if (dept && norm(emp.department).indexOf(dept) === -1 && dept.indexOf(norm(emp.department)) === -1) return false;
                const key = norm(r.specializationName || r.roleCategoryName);
                if (!key) return true;
                const hay = (norm(emp.designation) + ' ' + norm(emp.skills) + ' ' + norm(emp.department));
                return hay.indexOf(key) >= 0;
            };

            let totalHeads = 0, totalHours = 0, totalShortage = 0, totalHiring = 0;
            const availableSet = new Set();
            const demand = (reqs || []).map(r => {
                totalHeads += Number(r.requiredCount) || 0;
                totalHours += Number(r.requiredHours) || 0;
                const matched = emps.filter(e => matches(e, r));
                const available = matched.filter(e => { const p = profiles.get(e.employeeId); return p && (p.availableToday || p.availableNextMonth); });
                available.forEach(e => availableSet.add(e.employeeId));
                const need = Number(r.requiredCount) || 1;
                const structuralGap = Math.max(0, need - matched.length);          // must hire (no such skill on bench)
                const availabilityGap = Math.max(0, Math.min(need, matched.length) - available.length); // have skill but busy
                totalShortage += structuralGap + availabilityGap;
                totalHiring += structuralGap;
                return {
                    requirementId: r.requirementId, projectName: projNames[r.project_projectId] || r.project_projectId,
                    department: r.departmentName, role: r.roleCategoryName, specialization: r.specializationName,
                    requiredCount: need, requiredHours: Number(r.requiredHours) || 0,
                    matchedCount: matched.length, availableCount: available.length,
                    structuralGap, availabilityGap,
                    recommended: available.slice(0, 5).map(e => { const p = profiles.get(e.employeeId) || {}; return { employeeId: e.employeeId, employeeName: e.employeeName, freeHours: p.freeHours || 0, utilizationPct: p.utilizationPct || 0 }; })
                };
            });
            return JSON.stringify({
                kpis: {
                    totalDemandHeads: totalHeads, totalDemandHours: Math.round(totalHours),
                    availableResources: availableSet.size, resourceShortages: totalShortage, hiringRequirements: totalHiring,
                    openRequirements: (reqs || []).length
                },
                demand
            });
          } catch (err) {
            cds.log('resource-demand').error('getResourceDemandOverview failed:', err);
            return JSON.stringify({ error: 'Could not load resource demand: ' + (err && err.message ? err.message : String(err)) });
          }
        });

        this.on('recommendResources', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            let requiredSkills = d.requiredSkills;
            let requiredRole = (d.requiredRole || '').trim();
            let projectTypeName = '';
            let excludeIds = new Set();
            let isPoc = false;
            if (d.projectId) {
                const p = await SELECT.one.from(PROJECT).columns('projectId', 'requiredSkills', 'poc_employeeId', 'projectTypeName').where({ projectId: d.projectId });
                if (!p) return JSON.stringify({ error: 'Project not found.' });
                isPoc = p.poc_employeeId === c.employeeId;
                if (requiredSkills == null || requiredSkills === '') requiredSkills = p.requiredSkills;
                projectTypeName = p.projectTypeName || '';
                // Don't recommend employees already allocated to this project.
                const existing = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: d.projectId });
                excludeIds = new Set((existing || []).map(r => r.employee_employeeId));
            }
            if (!canPlanResources(req, c) && !isPoc) {
                return JSON.stringify({ error: 'Not authorised to recommend resources.' });
            }
            const neededBandwidth = Number(d.neededBandwidth) || 0;
            // Single source of truth: same engine + same configurable weights.
            const config = await rp.loadConfig();
            const overhead = Number(config.monthlyOverhead) || 0;
            const profiles = await rp.computeProfiles(null, { config });
            // Role-match needs the employee's designation — fetch once, in bulk.
            const desigRows = await SELECT.from(EMPLOYEE).columns('employeeId', 'designation');
            const desigById = {}; (desigRows || []).forEach(r => { desigById[r.employeeId] = String(r.designation || '').toLowerCase(); });
            // PM-safe cost rates (no salary). Estimate = rate × needed hrs over project months.
            const salaryRows = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'monthlySalary', 'hourlyCost', 'isActive').where({ isActive: true });
            const salaryByEmp = {}; (salaryRows || []).forEach(s => { salaryByEmp[s.employee_employeeId] = s; });
            let recoMonths = 1;
            if (d.projectId) { const pr = await SELECT.one.from(PROJECT).columns('startDate', 'endDate').where({ projectId: d.projectId }); if (pr) recoMonths = monthsBetweenInclusive(pr.startDate, pr.endDate); }
            const roleLc = requiredRole.toLowerCase();
            const roleTokens = roleLc.split(/[\s,/]+/).filter(t => t.length > 2);
            const ranked = [...profiles.values()]
                .filter(p => !excludeIds.has(p.employeeId))
                .map(p => {
                    const sc = rp.scoreProfile(p, requiredSkills, config);
                    // Role match: does the employee's designation (or skills) contain the
                    // required role tokens? Acts as a tie-break + visible signal.
                    const hay = (desigById[p.employeeId] || '') + ' ' + (p.skills || []).join(' ');
                    const roleMatched = roleLc && (hay.indexOf(roleLc) !== -1 || roleTokens.some(t => hay.indexOf(t) !== -1));
                    const fitsBandwidth = neededBandwidth <= 0 || (p.totalBandwidth + neededBandwidth) <= 100;
                    // Blend a small role bonus into the score so a role match ranks higher.
                    const blended = roleLc ? Math.min(100, sc.score + (roleMatched ? 8 : 0)) : sc.score;
                    // Budget-aware: PM-safe cost rate + estimated cost for needed bandwidth.
                    const costRatePerHour = rp.loadedHourlyRate(salaryByEmp[p.employeeId], p.monthlyCapacityHours, overhead);
                    const estHours = (neededBandwidth > 0 ? neededBandwidth : 100) / 100 * (p.monthlyCapacityHours || rp.DEFAULT_MONTHLY_CAPACITY) * recoMonths;
                    const estimatedAllocationCost = Math.round(costRatePerHour * estHours);
                    return { ...p, ...sc, score: blended, roleMatched: !!roleMatched, requiredRole,
                        costRatePerHour, estimatedAllocationCost,
                        fitsBandwidth, recommended: sc.skillMatchPct >= 50 && p.freeHours > 0 && fitsBandwidth && (!roleLc || roleMatched) };
                })
                .sort((a, b) => (b.roleMatched - a.roleMatched)
                    || b.score - a.score
                    || b.skillMatchPct - a.skillMatchPct
                    || b.freeHours - a.freeHours
                    || (a.employeeName || '').localeCompare(b.employeeName || ''));
            return JSON.stringify({
                requiredSkills: rp.parseSkills(requiredSkills),
                requiredRole, projectTypeName,
                neededBandwidth,
                recommendations: ranked.slice(0, Number(d.limit) > 0 ? Number(d.limit) : 25)
            });
        });

        // ── POC: request additional department budget (→ Founder approval) ────────
        this.on('requestAdditionalBudget', async (req) => {
            const c = await projectCaller(req);
            const { projectId, department, requestedAmount, justification, businessImpact } = req.data;
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId').where({ projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            if (p.poc_employeeId !== c.employeeId) return JSON.stringify({ error: 'Only the project POC can request additional budget.' });
            // Validate against the organisation's real departments (+ 'Other').
            const deptRows = await SELECT.from(EMPLOYEE).columns('department').where({ isActive: true });
            const validDepts = new Set(['Other']);
            (deptRows || []).forEach(r => { const dd = String(r.department || '').trim(); if (dd) validDepts.add(dd); });
            if (!validDepts.has(department)) return JSON.stringify({ error: 'Please select a valid department.' });
            const amount = Number(requestedAmount) || 0;
            if (!(amount > 0)) return JSON.stringify({ error: 'Requested amount must be greater than 0.' });
            if (!String(justification || '').trim()) return JSON.stringify({ error: 'Justification is required.' });
            if (!String(businessImpact || '').trim()) return JSON.stringify({ error: 'Business impact is required.' });

            const dup = await SELECT.one.from(PROJECT_BUDGET_REQUEST).columns('requestId')
                .where({ project_projectId: projectId, department, status: 'Pending Founder Approval' });
            if (dup) return JSON.stringify({ error: `A ${department} budget request is already pending Founder approval.` });

            const util = await deptUtilizationPct(projectId, department);
            const requestId = await nextBudgetRequestId(projectId);
            await INSERT.into(PROJECT_BUDGET_REQUEST).entries({
                requestId, project_projectId: projectId, department,
                requestedAmount: amount, justification: String(justification).trim(), businessImpact: String(businessImpact).trim(),
                requestedById: c.employeeId, requestedByName: c.name || '',
                status: 'Pending Founder Approval', approvedAmount: 0, utilizationSnapshot: util
            });
            await projectAudit(projectId, c.name, 'Budget Request Created', null, `${department}: ₹${amount.toLocaleString('en-IN')}`);

            // Notify all active founders.
            const founders = await SELECT.from(EMPLOYEE).columns('employeeId', 'email').where({ role: 'founder', isActive: true });
            for (const f of (founders || [])) {
                await sendProjectMail(f.employeeId, f.email, 'Additional Budget Request',
                    `Project "${p.projectName}" has requested additional ${department} budget (₹${amount.toLocaleString('en-IN')}).\n\nJustification: ${String(justification).trim()}\n\nPlease review and approve/reject in the project's Budget Analysis.`,
                    projectId, 'BUDGET_REQUEST');
            }
            return JSON.stringify({ ok: true, requestId });
        });

        // ── POC: withdraw a still-pending request ─────────────────────────────────
        this.on('withdrawBudgetRequest', async (req) => {
            const c = await projectCaller(req);
            const r = await SELECT.one.from(PROJECT_BUDGET_REQUEST).where({ requestId: req.data.requestId });
            if (!r) return JSON.stringify({ error: 'Request not found.' });
            const p = await SELECT.one.from(PROJECT).columns('poc_employeeId').where({ projectId: r.project_projectId });
            if (!p || p.poc_employeeId !== c.employeeId) return JSON.stringify({ error: 'Only the requesting POC can withdraw this request.' });
            if (r.status !== 'Pending Founder Approval') return JSON.stringify({ error: 'Only pending requests can be withdrawn.' });
            await UPDATE(PROJECT_BUDGET_REQUEST).set({ status: 'Withdrawn', decidedAt: new Date() }).where({ requestId: r.requestId });
            await projectAudit(r.project_projectId, c.name, 'Budget Request Withdrawn', 'Pending Founder Approval', 'Withdrawn');
            return JSON.stringify({ ok: true });
        });

        // ── List budget requests for a project (POC sees own amounts; no project budget) ──
        this.on('getMyBudgetRequests', async (req) => {
            const c = await projectCaller(req);
            const projectId = req.data.projectId;
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: projectId });
            const isPoc = p.poc_employeeId === c.employeeId;
            const isAllocated = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && !isPoc && !isAllocated) return JSON.stringify({ error: 'You do not have access to this project.' });
            const rows = await SELECT.from(PROJECT_BUDGET_REQUEST).where({ project_projectId: projectId }).orderBy('createdAt desc');
            return JSON.stringify({
                isPoc,
                requests: (rows || []).map(r => ({
                    requestId: r.requestId, department: r.department,
                    requestedAmount: Number(r.requestedAmount) || 0,
                    approvedAmount: Number(r.approvedAmount) || 0,
                    status: r.status, founderComments: r.founderComments || '',
                    requestedByName: r.requestedByName,
                    requestDate: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
                    decidedAt: r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : ''
                }))
            });
        });

        // ── Founder: approve (full/partial) or reject a budget request ────────────
        this.on('decideBudgetRequest', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can decide budget requests.' });
            const { requestId, decision, approvedAmount, comments } = req.data;
            const r = await SELECT.one.from(PROJECT_BUDGET_REQUEST).where({ requestId });
            if (!r) return JSON.stringify({ error: 'Request not found.' });
            if (r.status !== 'Pending Founder Approval') return JSON.stringify({ error: 'This request has already been decided.' });
            const projectId = r.project_projectId;
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'projectName').where({ projectId });

            if (decision === 'reject') {
                if (!String(comments || '').trim()) return JSON.stringify({ error: 'Rejection comments are required.' });
                await UPDATE(PROJECT_BUDGET_REQUEST).set({ status: 'Rejected', founderComments: String(comments).trim(), decidedByName: c.name || 'Founder', decidedAt: new Date() }).where({ requestId });
                await projectAudit(projectId, c.name, 'Budget Request Rejected', `${r.department}: ₹${Number(r.requestedAmount).toLocaleString('en-IN')}`, String(comments).trim());
                const poc = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'email').where({ employeeId: r.requestedById });
                if (poc) await sendProjectMail(poc.employeeId, poc.email, 'Additional Budget Request Rejected',
                    `Your additional ${r.department} budget request for "${p.projectName}" has been rejected.\n\nFounder comments: ${String(comments).trim()}`,
                    projectId, 'BUDGET_REQUEST_DECISION');
                return JSON.stringify({ ok: true, status: 'Rejected' });
            }

            if (decision !== 'approve') return JSON.stringify({ error: 'Invalid decision.' });
            const approve = (approvedAmount == null || Number(approvedAmount) === 0) ? Number(r.requestedAmount) || 0 : Number(approvedAmount);
            if (!(approve > 0)) return JSON.stringify({ error: 'Approved amount must be greater than 0.' });
            if (approve > (Number(r.requestedAmount) || 0)) return JSON.stringify({ error: 'Approved amount cannot exceed the requested amount.' });

            const b = await readProjectBudget(projectId);
            if (!b.row) return JSON.stringify({ error: 'No budget has been allocated for this project yet.' });
            if (approve > b.unallocated) return JSON.stringify({ error: 'Insufficient unallocated budget available.' });

            // Add to the department allocation (create the entry if absent).
            const deptArr = b.deptArr.slice();
            let entry = deptArr.find(d => (d.department || d.name) === r.department);
            const deptBefore = entry ? Number(entry.amount) || 0 : 0;
            if (entry) entry.amount = deptBefore + approve;
            else deptArr.push({ department: r.department, amount: approve });
            const deptAfter = deptBefore + approve;

            await UPDATE(PROJECT_BUDGET).set({ departmentBudgets: JSON.stringify(deptArr) }).where({ budgetId: `${projectId}-BUDGET` });
            await UPDATE(PROJECT_BUDGET_REQUEST).set({
                status: 'Approved', approvedAmount: approve, founderComments: String(comments || '').trim(),
                decidedByName: c.name || 'Founder', decidedAt: new Date(),
                deptBudgetBefore: deptBefore, deptBudgetAfter: deptAfter,
                unallocatedBefore: b.unallocated, unallocatedAfter: Math.round((b.unallocated - approve) * 100) / 100
            }).where({ requestId });
            await projectAudit(projectId, c.name, 'Budget Request Approved',
                `${r.department}: ₹${deptBefore.toLocaleString('en-IN')}`,
                `${r.department}: ₹${deptAfter.toLocaleString('en-IN')} (+₹${approve.toLocaleString('en-IN')})`);

            const poc = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'email').where({ employeeId: r.requestedById });
            if (poc) {
                const partial = approve < (Number(r.requestedAmount) || 0);
                await sendProjectMail(poc.employeeId, poc.email, 'Additional Budget Request Approved',
                    `Your additional ${r.department} budget request for "${p.projectName}" has been ${partial ? 'partially ' : ''}approved (₹${approve.toLocaleString('en-IN')}).` +
                    (String(comments || '').trim() ? `\n\nFounder comments: ${String(comments).trim()}` : ''),
                    projectId, 'BUDGET_REQUEST_DECISION');
            }
            return JSON.stringify({ ok: true, status: 'Approved', approvedAmount: approve, deptBudgetAfter: deptAfter, unallocated: Math.round((b.unallocated - approve) * 100) / 100 });
        });

        // ── Distinct organisation departments (drives budget department pickers) ──
        this.on('getDepartments', async (req) => {
            const rows = await SELECT.from(EMPLOYEE).columns('department').where({ isActive: true });
            const set = new Set();
            (rows || []).forEach(r => { const d = String(r.department || '').trim(); if (d) set.add(d); });
            return JSON.stringify({ departments: [...set].sort((a, b) => a.localeCompare(b)) });
        });

        // ── List active managers for planning-meeting participant picker ───────────
        this.on('getManagersForMeeting', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view managers.' });
            const managers = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department', 'designation', 'email')
                .where({ role: 'manager', isActive: true }).orderBy('department asc', 'employeeName asc');
            return JSON.stringify({ managers: managers || [] });
        });

        // ── Founder: create + assign a project task ─────────────────────────────
        this.on('createProjectTask', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId').where({ projectId: d.projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            // Only the Founder or the assigned project POC can create/assign tasks.
            if (!(isFounderCaller(req, c) || project.poc_employeeId === c.employeeId))
                return JSON.stringify({ error: 'Only the Founder or the project POC can assign tasks.' });
            if (!(d.taskName || '').trim()) return JSON.stringify({ error: 'Task Name is required.' });
            if (!d.assignedToId) return JSON.stringify({ error: 'Please assign the task to an allocated employee.' });
            // Estimated hours drive the weighted progress calc → must be > 0.
            if (!(Number(d.estimatedHours) > 0)) return JSON.stringify({ error: 'Estimated Hours must be greater than 0.' });
            // Assignee MUST be allocated to this project.
            const alloc = await SELECT.one.from(PROJECT_RESOURCE).columns('allocationId').where({ project_projectId: d.projectId, employee_employeeId: d.assignedToId });
            if (!alloc) return JSON.stringify({ error: 'You can only assign tasks to employees allocated to this project.' });
            if (d.dueDate && d.startDate && String(d.dueDate) < String(d.startDate)) return JSON.stringify({ error: 'Due Date cannot be before Start Date.' });
            const assignee = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where({ employeeId: d.assignedToId });

            const taskId = await nextProjectTaskId(d.projectId);
            await INSERT.into(PROJECT_TASK).entries({
                taskId, project_projectId: d.projectId, taskName: d.taskName.trim(),
                description: (d.description || '').trim(), assignedTo_employeeId: d.assignedToId,
                assignedToName: assignee ? assignee.employeeName : d.assignedToId,
                priority: d.priority || 'Medium', status: 'Not Started',
                startDate: d.startDate || null, dueDate: d.dueDate || null,
                estimatedHours: Number(d.estimatedHours) || 0, actualHours: 0,
                milestone_milestoneId: d.milestoneId || null   // optional milestone scope
            });
            await projectAudit(d.projectId, c.name, 'Task Created', null, d.taskName.trim());
            await projectAudit(d.projectId, c.name, 'Task Assigned', null, (assignee && assignee.employeeName) || d.assignedToId);
            if (assignee) await sendProjectMail(assignee.employeeId, assignee.email,
                'New Project Task Assigned',
                `You have been assigned the task “${d.taskName.trim()}” in project ${project.projectName}.`,
                taskId, 'PROJECT_TASK_ASSIGNED');
            founderEvents.ping('createProjectTask');
            return JSON.stringify({ ok: true, taskId });
        });

        // ── POC (or Founder): employees available to allocate, grouped by dept ──
        this.on('getAllocatableEmployees', async (req) => {
            const c = await projectCaller(req);
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId', 'projectType_code', 'executionBudget', 'budget', 'startDate', 'endDate').where({ projectId: req.data.projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            const allowed = isFounderCaller(req, c) || project.poc_employeeId === c.employeeId;
            if (!allowed) return JSON.stringify({ error: 'Only the project POC can allocate resources.' });

            // PM-safe cost rates (fully-loaded, no salary exposed) + budget consumption.
            const config = await rp.loadConfig();
            const overhead = Number(config.monthlyOverhead) || 0;
            const projMonths = monthsBetweenInclusive(project.startDate, project.endDate);
            const salaryRows = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'monthlySalary', 'hourlyCost', 'isActive').where({ isActive: true });
            const salaryByEmp = {}; (salaryRows || []).forEach(s => { salaryByEmp[s.employee_employeeId] = s; });
            const executionBudget = Number(project.executionBudget) || Number(project.budget) || 0;

            // Roles are derived DYNAMICALLY from active employees' designations in the
            // project type's department(s). Type with departments configured → role-driven
            // (eligible = active employees in those depts); type OTHER → legacy funded-dept gate.
            await ensureProjectTypes();
            const ptype = await SELECT.one.from(PROJECT_TYPE).columns('planningModel', 'phases', 'modules').where({ code: project.projectType_code || 'OTHER' });
            const parseJ = s => { try { return JSON.parse(s || '[]') || []; } catch (_) { return []; } };
            const typeDepts = await typeDepartments(project.projectType_code);
            const typeDeptSet = new Set(typeDepts.map(x => String(x).trim().toLowerCase()));
            const typeAware = typeDepts.length > 0;        // department-driven (SAP / Dev / …)
            const typeCategories = typeAware ? await rolesForDepartments(typeDepts) : [];

            const funded = typeAware ? null : await fundedDepartments(req.data.projectId);
            // Funded roles = dynamic roles that received budget (>0); else all dynamic roles.
            let fundedCategories = typeCategories;
            if (typeAware) {
                const b = await readProjectBudget(req.data.projectId);
                let catArr = []; try { catArr = JSON.parse((b.row && b.row.categoryBudgets) || '[]') || []; } catch (_) {}
                const fundedSet = new Set(catArr.filter(x => (Number(x.amount) || 0) > 0).map(x => String(x.category)));
                const funcats = typeCategories.filter(cat => fundedSet.has(cat));
                if (funcats.length) fundedCategories = funcats;
            }

            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department', 'isActive', 'role', 'designation', 'monthlyCapacityHours', 'status', 'roleCategory_roleId', 'specialization_specId', 'yearsOfExperience', 'certifications', 'baseAvailabilityPct').where({ isActive: true });
            // Master name maps for the hierarchical (Dept → Role → Spec) grid.
            const roleNameRows = await SELECT.from(ROLE_MASTER).columns('roleId', 'name');
            const specNameRows = await SELECT.from(SPEC_MASTER).columns('specId', 'name');
            const roleNameById = {}; roleNameRows.forEach(r => { roleNameById[r.roleId] = r.name; });
            const specNameById = {}; specNameRows.forEach(s => { specNameById[s.specId] = s.name; });
            const existing = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'bandwidth', 'role', 'phase', 'module', 'totalAllocationCost').where({ project_projectId: req.data.projectId });
            const onProject = {}; existing.forEach(r => { onProject[r.employee_employeeId] = r; });
            const allocatedResourceCost = (existing || []).reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0);

            const list = [];
            for (const e of (emps || [])) {
                // Exclude the designated POC (the POC is a distinct role, never a
                // resource) and any executive/high-authority user (org-wide access).
                if (e.employeeId === project.poc_employeeId) continue;
                if (isExecutiveEmployee(e)) continue;
                const st = String(e.status || 'Active').toLowerCase();
                if (st === 'inactive' || st === 'resigned') continue;
                if (typeAware) {
                    // Role-driven: only employees in the project type's department(s).
                    if (!typeDeptSet.has(String(e.department || '').trim().toLowerCase())) continue;
                } else if (!funded.set.has(String(e.department || '').trim().toLowerCase())) {
                    continue;   // legacy: restrict to budget-approved departments
                }
                const usedElsewhere = await usedBandwidth(e.employeeId, req.data.projectId); // excludes this project
                const ex = onProject[e.employeeId];
                const here = ex ? (ex.bandwidth || 0) : 0;
                const capacity = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : rp.DEFAULT_MONTHLY_CAPACITY;
                const costRatePerHour = rp.loadedHourlyRate(salaryByEmp[e.employeeId], capacity, overhead);
                // Salary-only Cost Per Hour (overhead shown separately as flat misc).
                const costPerHour = rp.baseHourlyRate(salaryByEmp[e.employeeId], capacity);
                list.push({
                    employeeId: e.employeeId, employeeName: e.employeeName, department: e.department || 'Others',
                    designation: e.designation || '',
                    currentAllocation: usedElsewhere + here,            // total incl this project
                    available: Math.max(0, 100 - usedElsewhere - here), // remaining after current
                    allocatedHere: here,
                    role: ex ? (ex.role || '') : '', phase: ex ? (ex.phase || '') : '', module: ex ? (ex.module || '') : '',
                    // ── Hierarchical classification + profile (for the Dept→Role→Spec grid) ──
                    roleCategoryId: e.roleCategory_roleId || '', roleCategoryName: roleNameById[e.roleCategory_roleId] || '',
                    specializationId: e.specialization_specId || '', specializationName: specNameById[e.specialization_specId] || '',
                    yearsOfExperience: Number(e.yearsOfExperience) || 0,
                    certifications: e.certifications || '',
                    baseAvailabilityPct: (e.baseAvailabilityPct != null ? e.baseAvailabilityPct : 100),
                    // PM-safe cost: rate only (never salary). Monthly hours = capacity;
                    // total project months drive the full estimated allocation cost.
                    costRatePerHour, costPerHour, monthlyCapacityHours: capacity
                });
            }
            // Recommendation ordering (Phase 8): within each group the best candidates
            // float up — higher availability, lower utilization, more experience, then
            // certified, then name. The hierarchical grid preserves this order per spec.
            list.sort((a, b) =>
                (b.available - a.available) ||
                (a.currentAllocation - b.currentAllocation) ||
                ((Number(b.yearsOfExperience) || 0) - (Number(a.yearsOfExperience) || 0)) ||
                (((b.certifications ? 1 : 0)) - ((a.certifications ? 1 : 0))) ||
                (a.employeeName || '').localeCompare(b.employeeName || '')
            );
            // Group by ROLE (designation) for role-driven projects, else by department.
            const groups = {};
            list.forEach(x => { const key = typeAware ? (x.designation || 'Unassigned Role') : x.department; (groups[key] = groups[key] || []).push(x); });
            const departments = Object.keys(groups).sort().map(g => ({ department: g, employees: groups[g] }));

            // ── Data-driven Department → Role → Employees structure (authoritative) ──
            // Built entirely from employee master classification; the frontend renders
            // whatever this returns, so new departments/roles appear with no code change.
            // Roles with no employees never appear (only present employees create groups).
            // showModule is data-derived: a role shows the Module column when any of its
            // employees carries a specialization — no hardcoded "Functional" check.
            const deptRoleMap = {};
            list.forEach(e => {
                const dep = e.department || 'Others';
                const role = e.roleCategoryName || e.designation || 'Unclassified';
                deptRoleMap[dep] = deptRoleMap[dep] || {};
                (deptRoleMap[dep][role] = deptRoleMap[dep][role] || []).push(e);
            });
            const grouped = Object.keys(deptRoleMap).sort().map(dep => ({
                department: dep,
                roles: Object.keys(deptRoleMap[dep]).sort().map(role => {
                    const employees = deptRoleMap[dep][role];
                    return { roleName: role, showModule: employees.some(x => x.specializationName), employees };
                })
            }));
            return JSON.stringify({
                projectId: req.data.projectId, departments, grouped,
                typeAware,
                // Type-aware → eligible "categories" (roles); legacy → eligible departments.
                eligibleCategories: typeAware ? fundedCategories : [],
                eligibleDepartments: typeAware ? [] : funded.names,
                budgetDefined: typeAware ? true : funded.names.length > 0,
                // Type-driven planning config for the allocation UI.
                planningModel: ptype ? ptype.planningModel : 'MonthlyCapacity',
                roleOptions: typeAware ? fundedCategories : [],
                phaseOptions: ptype ? parseJ(ptype.phases) : [],
                moduleOptions: ptype ? parseJ(ptype.modules) : [],
                // Cost / budget consumption (PM-safe — rates only, no salary).
                executionBudget,
                allocatedResourceCost: Math.round(allocatedResourceCost),
                remainingBudget: Math.round(executionBudget - allocatedResourceCost),
                projectMonths: projMonths,
                // Monthly overhead (already folded into costRatePerHour) — surfaced so
                // the UI can DECOMPOSE the estimate into Base + Misc without changing totals.
                monthlyOverhead: Math.round(overhead)
            });
        });

        // ── POC (or Founder): allocate resources (FTE bandwidth validated) ──────
        this.on('allocateResources', async (req) => {
            const c = await projectCaller(req);
            const { projectId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'pocName', 'status', 'lifecycleStage', 'projectType_code', 'executionBudget', 'budget', 'startDate', 'endDate', 'client_clientId').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            const allowed = isFounderCaller(req, c) || project.poc_employeeId === c.employeeId;
            if (!allowed) return JSON.stringify({ error: 'Only the project POC can allocate resources.' });
            // Block new resource allocation when the owning client is Inactive/Blacklisted.
            if (project.client_clientId) {
                const projClient = await SELECT.one.from(CLIENT_MASTER).columns('status').where({ clientId: project.client_clientId });
                const allocBlock = projClient && clientActionBlock(projClient.status);
                if (allocBlock) return JSON.stringify({ error: allocBlock });
            }
            // Block resource allocation for Planning projects until budget is allocated.
            if (project.status === 'Planning' && project.lifecycleStage !== 'BudgetAllocated')
                return JSON.stringify({ error: 'Budget must be allocated before resources can be assigned. Complete the planning meeting and budget allocation first.' });

            const allocations = (req.data.allocations || []).filter(a => a && a.employeeId);
            if (!allocations.length) return JSON.stringify({ error: 'No allocations provided.' });

            // ── Cost context (PM-safe, fully-loaded rate snapshots) ──────────────────
            const costConfig = await rp.loadConfig();
            const monthlyOverhead = Number(costConfig.monthlyOverhead) || 0;
            const projMonths = monthsBetweenInclusive(project.startDate, project.endDate);
            const executionBudget = Number(project.executionBudget) || Number(project.budget) || 0;
            const salaryRows = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'monthlySalary', 'hourlyCost', 'isActive').where({ isActive: true });
            const salaryByEmp = {}; (salaryRows || []).forEach(s => { salaryByEmp[s.employee_employeeId] = s; });
            const empCapRows = await SELECT.from(EMPLOYEE).columns('employeeId', 'monthlyCapacityHours').where({ employeeId: { in: allocations.map(a => a.employeeId) } });
            const capByEmp = {}; (empCapRows || []).forEach(e => { capByEmp[e.employeeId] = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : rp.DEFAULT_MONTHLY_CAPACITY; });
            // Computes the frozen cost snapshot for one allocation line.
            // Estimated Cost = (allocatedHours × Cost Per Hour) + (projectMonths × misc).
            // Cost Per Hour is salary-only (no overhead); the ₹/month overhead is added as
            // a flat miscellaneous line per allocated resource (matches the UI estimate).
            const costFor = (empId, bw) => {
                const cap = capByEmp[empId] || rp.DEFAULT_MONTHLY_CAPACITY;
                const rate = rp.baseHourlyRate(salaryByEmp[empId], cap);
                const hours = (Number(bw) || 0) / 100 * cap * projMonths;   // total hours over the project
                const misc = projMonths * monthlyOverhead;                  // flat misc per resource
                return { rate, total: Math.round(rate * hours + misc) };
            };

            // Eligibility model (mirrors getAllocatableEmployees):
            //  • Type-aware projects (SAP/Dev) → any active employee; role must be one
            //    of the project type's resource categories (backend-enforced).
            //  • Type = OTHER → legacy "funded departments" gate.
            // Role-driven if the project type maps to department(s); roles + eligible
            // employees both come dynamically from those departments' active staff.
            await ensureProjectTypes();
            const allocTypeDepts = await typeDepartments(project.projectType_code);
            const allocTypeDeptSet = new Set(allocTypeDepts.map(x => String(x).trim().toLowerCase()));
            const typeAware = allocTypeDepts.length > 0;
            const typeCatSet = new Set((typeAware ? await rolesForDepartments(allocTypeDepts) : []).map(x => String(x).toLowerCase()));
            const funded = typeAware ? null : await fundedDepartments(projectId);

            // Override is a privileged action — only the Founder may knowingly create
            // an overallocation (>100% FTE). POCs always get a hard block + warning.
            const wantsOverride = req.data.allowOverride === true;
            // The project POC (and the Founder) may override capacity limits when
            // business need demands it — every override is tracked + audited.
            const canOverride = isFounderCaller(req, c) || project.poc_employeeId === c.employeeId;
            const overrideReason = String(req.data.overrideReason || '').trim();
            if (wantsOverride && !canOverride) {
                return JSON.stringify({ error: 'Only the project POC or Founder can override allocation capacity limits.' });
            }

            // Validate ALL first (atomic-ish: block the whole save on any violation).
            // Hard errors (bad bandwidth / inactive employee) always block. Capacity
            // overflows are collected; if any exist and override isn't granted, return
            // a structured warning so the UI can prompt for confirmation.
            const overallocations = [];
            for (const a of allocations) {
                const bw = Number(a.bandwidth) || 0;
                if (!VALID_BANDWIDTH.has(bw)) return JSON.stringify({ error: `Bandwidth must be 25, 50, 75 or 100 (got ${a.bandwidth}).` });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'isActive', 'employeeName', 'role', 'designation', 'department').where({ employeeId: a.employeeId });
                if (!emp) return JSON.stringify({ error: `Employee '${a.employeeId}' not found.` });
                if (emp.isActive === false) return JSON.stringify({ error: `Employee '${emp.employeeName}' is inactive.` });
                // The POC is never a resource; executives are never allocated.
                if (a.employeeId === project.poc_employeeId) return JSON.stringify({ error: `${emp.employeeName} is the project POC and cannot also be assigned as a resource.` });
                if (isExecutiveEmployee(emp)) return JSON.stringify({ error: `${emp.employeeName} is an executive/high-authority user and cannot be assigned as a project resource.` });
                if (typeAware) {
                    // Employee must belong to one of the type's departments, and the role
                    // (if given) must be a real designation in those departments. Both
                    // backend-enforced — defeats UI manipulation.
                    if (!allocTypeDeptSet.has(String(emp.department || '').trim().toLowerCase())) {
                        return JSON.stringify({ error: `${emp.employeeName} is not in a department mapped to this project type (${allocTypeDepts.join(', ')}).` });
                    }
                    const roleVal = String(a.role || '').trim();
                    if (roleVal && !typeCatSet.has(roleVal.toLowerCase())) {
                        return JSON.stringify({ error: `"${roleVal}" is not a valid role for this project type's departments.` });
                    }
                } else {
                    // Legacy: department must have an approved budget allocation.
                    if (!funded.set.has(String(emp.department || '').trim().toLowerCase())) {
                        return JSON.stringify({ error: 'Resources can only be assigned from departments that have approved budget allocations for this project.' });
                    }
                }
                const usedElsewhere = await usedBandwidth(a.employeeId, projectId);
                if (usedElsewhere + bw > 100) {
                    overallocations.push({
                        employeeId: a.employeeId, employeeName: emp.employeeName,
                        usedElsewhere, requested: bw, total: usedElsewhere + bw
                    });
                }
            }
            if (overallocations.length && !(wantsOverride && canOverride)) {
                return JSON.stringify({
                    warning: true,
                    overallocations,
                    canOverride,
                    requiresReason: true,
                    message: canOverride
                        ? 'One or more allocations exceed 100% capacity. Provide a reason to override and continue.'
                        : 'One or more allocations exceed 100% capacity. Reduce the bandwidth, or ask the POC/Founder to override.'
                });
            }
            // A reason is mandatory whenever an override is actually performed.
            if (overallocations.length && wantsOverride && !overrideReason) {
                return JSON.stringify({ warning: true, overallocations, canOverride, requiresReason: true,
                    message: 'A reason is required to override utilization limits.' });
            }
            const overrodeIds = new Set(overallocations.map(o => o.employeeId));

            // ── Budget cost validation ───────────────────────────────────────────────
            // Projected resource cost AFTER this save = existing allocations not in this
            // batch + the batch's cost. Reject if it exceeds the Execution Budget.
            if (executionBudget > 0) {
                const batchEmpIds = new Set(allocations.map(a => a.employeeId));
                const others = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'totalAllocationCost').where({ project_projectId: projectId });
                let projectedCost = (others || []).filter(r => !batchEmpIds.has(r.employee_employeeId)).reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0);
                for (const a of allocations) projectedCost += costFor(a.employeeId, a.bandwidth).total;
                if (projectedCost > executionBudget) {
                    return JSON.stringify({ error: `This allocation costs ₹${Math.round(projectedCost).toLocaleString('en-IN')} which exceeds the Execution Budget of ₹${executionBudget.toLocaleString('en-IN')} by ₹${Math.round(projectedCost - executionBudget).toLocaleString('en-IN')}. Reduce the allocation.` });
                }
            }

            const newlyAdded = [];
            for (const a of allocations) {
                const bw = Number(a.bandwidth);
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department', 'email', 'monthlyCapacityHours').where({ employeeId: a.employeeId });
                const allocationId = `${projectId}-${a.employeeId}`;
                const prev = await SELECT.one.from(PROJECT_RESOURCE).columns('bandwidth', 'status', 'role', 'phase', 'module', 'milestone_milestoneId').where({ allocationId });
                // Derived & persisted for fast dashboard reads (recomputed every save).
                const capacity = Number(emp.monthlyCapacityHours) > 0 ? Number(emp.monthlyCapacityHours) : 160;
                const allocatedHours = Math.round(bw / 100 * capacity * 100) / 100;
                const isOverride = overrodeIds.has(a.employeeId);
                // Cost snapshots — frozen at allocation time for historical accuracy.
                const cst = costFor(a.employeeId, bw);
                await UPSERT.into(PROJECT_RESOURCE).entries({
                    allocationId, project_projectId: projectId, employee_employeeId: a.employeeId,
                    employeeName: emp.employeeName || '', department: emp.department || 'Others', bandwidth: bw,
                    startDate: a.startDate || null, endDate: a.endDate || null, allocatedHours,
                    role: (a.role != null ? String(a.role).trim() : (prev ? prev.role : null)) || null,
                    phase: (a.phase != null ? String(a.phase).trim() : (prev ? prev.phase : null)) || null,
                    module: (a.module != null ? String(a.module).trim() : (prev ? prev.module : null)) || null,
                    milestone_milestoneId: (a.milestoneId != null ? (a.milestoneId || null) : (prev ? prev.milestone_milestoneId : null)),
                    status: prev ? (prev.status || 'Active') : 'Active',   // preserve historical status
                    hourlyCostSnapshot: cst.rate, overheadSnapshot: monthlyOverhead, totalAllocationCost: cst.total,
                    isOverridden: isOverride, overrideReason: isOverride ? overrideReason : null
                });
                if (isOverride) {
                    const o = overallocations.find(x => x.employeeId === a.employeeId);
                    // Immutable override audit record (Founder-visible).
                    await INSERT.into(RESOURCE_OVERRIDE).entries({
                        overrideId: `${projectId}-OVR-${a.employeeId}-${Date.now()}`,
                        project_projectId: projectId, projectName: project.projectName || projectId,
                        employee_employeeId: a.employeeId, employeeName: emp.employeeName || '',
                        utilizationBefore: o.usedElsewhere, utilizationAfter: o.total,
                        reason: overrideReason, overriddenById: c.employeeId, overriddenByName: c.name || '',
                        overriddenAt: new Date()
                    });
                    await projectAudit(projectId, c.name, 'Utilization Override',
                        `${o.usedElsewhere}% → ${o.total}%`, `${emp.employeeName}: ${overrideReason}`);
                }
                if (prev) {
                    if (Number(prev.bandwidth) !== bw) await projectAudit(projectId, c.name, 'Allocation Changed', prev.bandwidth + '%', bw + '%');
                } else {
                    await projectAudit(projectId, c.name, 'Resource Added', null, `${emp.employeeName} @ ${bw}%`);
                    newlyAdded.push(emp);
                    await sendProjectMail(emp.employeeId, emp.email,
                        'Project Resource Allocation',
                        `You have been allocated to project ${project.projectName}.\n\nAllocated Bandwidth: ${bw}%\nProject POC: ${project.pocName || ''}`,
                        projectId, 'PROJECT_ALLOCATION');
                }
            }
            // Auto-activate Planning project on first resource allocation.
            if (project.status === 'Planning') {
                await UPDATE(PROJECT).set({ status: 'Active', lifecycleStage: 'Active' }).where({ projectId });
                await projectAudit(projectId, c.name, 'Status Changed', 'Planning', 'Active');
            }
            founderEvents.ping('allocateResources');
            return JSON.stringify({ ok: true, projectId, allocated: allocations.length, notified: newlyAdded.length, activated: project.status === 'Planning', overridden: overallocations.length });
        });

        // ══════════════════════════════════════════════════════════════════════
        // RESOURCE PLANNING v2 — milestone-hours allocation + monthly engine +
        // hard/soft split + hours-based availability forecast. Fully additive:
        // it populates ResourceMonthlyAllocation and keeps the derived bandwidth on
        // ProjectResource so every existing dashboard/report keeps working.
        // ══════════════════════════════════════════════════════════════════════

        // Allocate a resource to a MILESTONE with total estimated hours. The system
        // auto-generates month-wise allocations by working days (no weekly split).
        this.on('allocateResourceToMilestone', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'status', 'startDate', 'endDate', 'executionBudget', 'budget').where({ projectId: d.projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            if (!(isFounderCaller(req, c) || project.poc_employeeId === c.employeeId))
                return JSON.stringify({ error: 'Only the project POC or Founder can allocate resources.' });
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'department', 'monthlyCapacityHours', 'isActive').where({ employeeId: d.employeeId });
            if (!emp || emp.isActive === false) return JSON.stringify({ error: 'Employee not found or inactive.' });
            const ms = await SELECT.one.from(MILESTONE).columns('milestoneId', 'name', 'plannedStartDate', 'plannedEndDate').where({ milestoneId: d.milestoneId });
            if (!ms) return JSON.stringify({ error: 'Milestone not found.' });
            const hours = Math.max(0, Number(d.estimatedHours) || 0);
            if (hours <= 0) return JSON.stringify({ error: 'Estimated hours must be greater than 0.' });
            const type = d.allocationType === 'Soft' ? 'Soft' : 'Hard';
            const start = ms.plannedStartDate || project.startDate;
            const end = ms.plannedEndDate || project.endDate;
            if (!start || !end) return JSON.stringify({ error: 'The milestone (or project) needs start and end dates before hours can be allocated.' });

            let holidays = [];
            try { holidays = (await SELECT.from(HOLIDAY).columns('holidayDate')).map(h => String(h.holidayDate).slice(0, 10)); } catch (e) { /* */ }
            const monthly = rp.generateMonthlyAllocations(String(start).slice(0, 10), String(end).slice(0, 10), hours, holidays);
            if (!monthly.length) return JSON.stringify({ error: 'Could not generate a monthly plan for this milestone window.' });

            const cap = Number(emp.monthlyCapacityHours) > 0 ? Number(emp.monthlyCapacityHours) : 160;
            const allocationId = `${d.projectId}-${d.employeeId}-${d.milestoneId}`.slice(0, 45);

            // ── Availability guard (HARD only): no month may exceed capacity unless
            // an override is supplied. Soft reservations never block.
            if (type === 'Hard' && !d.force) {
                const others = await SELECT.from(RESOURCE_MONTHLY_ALLOCATION)
                    .columns('yearMonth', 'allocatedHours', 'allocationType', 'allocation_allocationId')
                    .where({ employee_employeeId: d.employeeId, allocationType: 'Hard' });
                const bookedByMonth = {};
                (others || []).forEach(r => { if (r.allocation_allocationId === allocationId) return; bookedByMonth[r.yearMonth] = (bookedByMonth[r.yearMonth] || 0) + Number(r.allocatedHours || 0); });
                const clash = monthly.find(m => (bookedByMonth[m.yearMonth] || 0) + m.hours > cap);
                if (clash) {
                    return JSON.stringify({
                        error: `${emp.employeeName} would be over-allocated in ${clash.yearMonth}: ${Math.round((bookedByMonth[clash.yearMonth] || 0) + clash.hours)}h booked vs ${cap}h capacity. Provide an override reason to proceed, or reduce hours / use a Soft reservation.`,
                        overallocation: true, month: clash.yearMonth
                    });
                }
            }

            const peakMonth = Math.max(...monthly.map(m => m.hours));
            const bandwidth = Math.max(0, Math.min(100, Math.round(peakMonth / cap * 100)));

            // ── Cost & budget consumption ─────────────────────────────────────────
            // Cost = estimatedHours × fully-loaded hourly rate ((salary+overhead)/capacity).
            // Only HARD allocations consume budget; SOFT is a tentative reservation (₹0),
            // so committed budget = Σ totalAllocationCost stays hard-only automatically.
            const cfg = await rp.loadConfig();
            const overhead = Number(cfg.monthlyOverhead) || 0;
            const salRow = await SELECT.one.from(SALARY_MASTER).columns('employee_employeeId', 'monthlySalary', 'hourlyCost', 'isActive').where({ employee_employeeId: d.employeeId });
            const rate = rp.loadedHourlyRate((salRow && salRow.isActive !== false) ? salRow : null, cap, overhead);
            const allocCost = type === 'Hard' ? Math.round(rate * hours) : 0;

            // Budget guard (HARD only): committed cost may not exceed the execution
            // budget unless an override reason is provided.
            const execB = Number(project.executionBudget) || Number(project.budget) || 0;
            const priorRows = await SELECT.from(PROJECT_RESOURCE).columns('allocationId', 'totalAllocationCost').where({ project_projectId: d.projectId });
            const priorCommitted = (priorRows || []).filter(r => r.allocationId !== allocationId).reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0);
            if (type === 'Hard' && !d.force && allocCost > 0 && execB > 0 && priorCommitted + allocCost > execB) {
                return JSON.stringify({
                    error: `Allocating ${emp.employeeName} for ${hours}h (₹${allocCost.toLocaleString('en-IN')}) would exceed the execution budget — committed ₹${(priorCommitted + allocCost).toLocaleString('en-IN')} vs ₹${execB.toLocaleString('en-IN')}. Provide an override reason, reduce the hours, or use a Soft reservation.`,
                    budgetOverrun: true, committed: Math.round(priorCommitted + allocCost), executionBudget: execB
                });
            }

            await UPSERT.into(PROJECT_RESOURCE).entries({
                allocationId, project_projectId: d.projectId, employee_employeeId: d.employeeId,
                employeeName: emp.employeeName, department: emp.department || '',
                milestone_milestoneId: d.milestoneId, estimatedHours: hours, allocationType: type,
                bandwidth, startDate: String(start).slice(0, 10), endDate: String(end).slice(0, 10),
                status: 'Active', role: d.role || null,
                hourlyCostSnapshot: Math.round(rate), overheadSnapshot: overhead, totalAllocationCost: allocCost,
                isOverridden: !!d.force, overrideReason: d.force ? (d.overrideReason || 'Override') : null
            });
            // Regenerate the month-wise rows for this allocation.
            await DELETE.from(RESOURCE_MONTHLY_ALLOCATION).where({ allocation_allocationId: allocationId });
            for (const m of monthly) {
                await INSERT.into(RESOURCE_MONTHLY_ALLOCATION).entries({
                    monthlyId: `${allocationId}-${m.yearMonth.replace('-', '')}`,
                    allocation_allocationId: allocationId, project_projectId: d.projectId,
                    employee_employeeId: d.employeeId, milestone_milestoneId: d.milestoneId,
                    yearMonth: m.yearMonth, allocatedHours: m.hours, allocationType: type
                });
            }
            await projectAudit(d.projectId, c.name, 'Resource Allocated (hours)', null,
                `${emp.employeeName} · ${ms.name} · ${hours}h (${type}) · ₹${allocCost.toLocaleString('en-IN')}`);
            founderEvents.ping('allocateResourceToMilestone');
            const committedNow = priorCommitted + allocCost;
            return JSON.stringify({
                ok: true, allocationId, allocationType: type, bandwidth, monthly,
                cost: allocCost, hourlyRate: Math.round(rate),
                committedBudget: Math.round(committedNow), executionBudget: execB,
                remainingBudget: Math.round(Math.max(0, execB - committedNow))
            });
        });

        // Hours-based availability forecast (current + next N months) with the
        // hard/soft split. Scope: explicit employees, a project's team, or the caller.
        this.on('getResourceForecast', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            let empIds = (d.employeeIds && d.employeeIds.length) ? d.employeeIds : null;
            if (!empIds && d.projectId) {
                const rs = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: d.projectId });
                empIds = [...new Set((rs || []).map(r => r.employee_employeeId))];
            }
            if (!empIds || !empIds.length) empIds = [c.employeeId];
            const nMonths = Math.max(1, Math.min(12, Number(d.months) || 3));
            const now = new Date();
            const fromStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
            const toStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + nMonths, 0)).toISOString().slice(0, 10);

            const tl = await rp.computeCapacityTimeline(empIds, fromStr, toStr);
            const rma = await SELECT.from(RESOURCE_MONTHLY_ALLOCATION)
                .columns('employee_employeeId', 'yearMonth', 'allocatedHours', 'allocationType')
                .where({ employee_employeeId: { in: empIds } });
            const hardBy = {}, softBy = {};
            (rma || []).forEach(r => {
                const k = r.employee_employeeId + '|' + r.yearMonth;
                if (r.allocationType === 'Soft') softBy[k] = (softBy[k] || 0) + Number(r.allocatedHours || 0);
                else hardBy[k] = (hardBy[k] || 0) + Number(r.allocatedHours || 0);
            });
            const forecast = [];
            for (const [empId, row] of tl) {
                const months = (row.months || []).map(m => {
                    const ym = m.year + '-' + String(m.month).padStart(2, '0');
                    const eff = Math.round(m.effectiveCapacityHours);
                    const hard = Math.round(hardBy[empId + '|' + ym] || 0);
                    const soft = Math.round(softBy[empId + '|' + ym] || 0);
                    return {
                        yearMonth: ym, label: m.label, effectiveCapacityHours: eff,
                        hardHours: hard, softHours: soft,
                        availableHours: Math.max(0, eff - hard),
                        utilizationPct: eff > 0 ? Math.round(hard / eff * 100) : (hard > 0 ? 100 : 0),
                        overbooked: hard > eff
                    };
                });
                forecast.push({ employeeId: empId, employeeName: row.employeeName, department: row.department, months });
            }
            return JSON.stringify({ from: fromStr, to: toStr, months: nMonths, forecast });
        });

        // ── POC (or Founder): remove a resource ─────────────────────────────────
        this.on('removeResource', async (req) => {
            const c = await projectCaller(req);
            const { projectId, employeeId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'pocName').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            const allowed = isFounderCaller(req, c) || project.poc_employeeId === c.employeeId;
            if (!allowed) return JSON.stringify({ error: 'Only the project POC can remove resources.' });
            // Match ANY allocation for this employee on this project — both the legacy
            // bandwidth id (projectId-employeeId) and milestone-hours ids
            // (projectId-employeeId-milestoneId) — so deallocation works for both models.
            const row = await SELECT.one.from(PROJECT_RESOURCE).columns('employeeName', 'employee_employeeId')
                .where({ project_projectId: projectId, employee_employeeId: employeeId });
            if (!row) return JSON.stringify({ error: 'This employee is not allocated to the project.' });

            // ── Deallocation validation ─────────────────────────────────────────
            // Block if the employee still owns open (non-completed) tasks in this project.
            const openTasks = await SELECT.from(PROJECT_TASK).columns('taskId', 'taskName', 'status')
                .where({ project_projectId: projectId, assignedTo_employeeId: employeeId, status: { '<>': 'Completed' } });
            if (openTasks && openTasks.length) {
                return JSON.stringify({
                    error: `Cannot deallocate ${row.employeeName}: ${openTasks.length} open task(s) are still assigned in this project. Reassign or complete them first.`,
                    blocked: true, openTasks: openTasks.map(t => ({ taskId: t.taskId, taskName: t.taskName, status: t.status }))
                });
            }
            // Block if there are pending (Draft/Submitted) project timesheet entries.
            const projTaskRows = await SELECT.from(PROJECT_TASK).columns('taskId').where({ project_projectId: projectId, assignedTo_employeeId: employeeId });
            const projTaskIds = projTaskRows.map(t => t.taskId);
            if (projTaskIds.length) {
                const entries = await SELECT.from(ENTRY).columns('timesheet_timesheetId')
                    .where({ projectTask_taskId: { in: projTaskIds } });
                const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
                if (tsIds.length) {
                    const pendingHdrs = await SELECT.from(HEADER).columns('timesheetId')
                        .where({ timesheetId: { in: tsIds }, status: { in: ['Pending', 'Submitted'] } });
                    if (pendingHdrs && pendingHdrs.length) {
                        return JSON.stringify({
                            error: `Cannot deallocate ${row.employeeName}: there are pending (unapproved) project timesheet entries. Wait for approval before deallocating.`,
                            blocked: true
                        });
                    }
                }
            }

            await DELETE.from(PROJECT_RESOURCE).where({ allocationId: `${projectId}-${employeeId}` });
            // Also clear any milestone-hours allocations + their monthly rows for this
            // employee on this project (Resource Planning v2 additive cleanup).
            await DELETE.from(RESOURCE_MONTHLY_ALLOCATION).where({ project_projectId: projectId, employee_employeeId: employeeId });
            await DELETE.from(PROJECT_RESOURCE).where({ project_projectId: projectId, employee_employeeId: employeeId });
            await projectAudit(projectId, c.name, 'Resource Removed', row.employeeName, null);
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'email').where({ employeeId: employeeId });
            if (emp) await sendProjectMail(emp.employeeId, emp.email,
                'Project Deallocation',
                `You have been deallocated from project ${project.projectName} by ${project.pocName || c.name}.`,
                projectId, 'PROJECT_DEALLOCATION');
            founderEvents.ping('removeResource');
            return JSON.stringify({ ok: true });
        });

        // ── Assigned employee (or Founder): update task status / actual hours ───
        this.on('updateProjectTaskStatus', async (req) => {
            const c = await projectCaller(req);
            const { taskId, status, actualHours } = req.data;
            const VALID = ['Not Started', 'In Progress', 'In Review', 'Completed', 'Blocked'];
            if (!VALID.includes(status)) return JSON.stringify({ error: 'Invalid status.' });
            const task = await SELECT.one.from(PROJECT_TASK).where({ taskId });
            if (!task) return JSON.stringify({ error: 'Task not found.' });
            if (!isFounderCaller(req, c) && task.assignedTo_employeeId !== c.employeeId) {
                return JSON.stringify({ error: 'You can only update tasks assigned to you.' });
            }
            const patch = { status };
            if (actualHours !== undefined && actualHours !== null && actualHours !== '') patch.actualHours = Number(actualHours) || 0;
            patch.completedAt = (status === 'Completed') ? new Date() : null;
            await UPDATE(PROJECT_TASK).set(patch).where({ taskId });
            await projectAudit(task.project_projectId, c.name, 'Status Changed', task.status, status);
            founderEvents.ping('updateProjectTaskStatus');
            return JSON.stringify({ ok: true, taskId, status });
        });

        // ── Scoped project list (Founder: all · POC: assigned · Employee: allocated)
        this.on('getProjects', async (req) => {
            const c = await projectCaller(req);
            let projects = await SELECT.from(PROJECT).orderBy('createdAt desc');
            if (!isFounderCaller(req, c)) {
                const myAlloc = await SELECT.from(PROJECT_RESOURCE).columns('project_projectId').where({ employee_employeeId: c.employeeId });
                const allowedIds = new Set(myAlloc.map(r => r.project_projectId));
                projects = (projects || []).filter(p => {
                    if (p.poc_employeeId === c.employeeId) return true;          // POC sees all their projects
                    if (allowedIds.has(p.projectId) && p.status !== 'Planning') return true; // Employees only see Active+ allocated projects
                    return false;
                });
            }
            const ids = projects.map(p => p.projectId);
            const tasks = ids.length ? await SELECT.from(PROJECT_TASK).columns('taskId', 'project_projectId', 'status', 'estimatedHours', 'actualHours').where({ project_projectId: { in: ids } }) : [];
            const byProj = {}; tasks.forEach(t => { (byProj[t.project_projectId] = byProj[t.project_projectId] || []).push(t); });

            // ── Budget utilization per project (consumed = hourlyCost × logged hours) ──
            const taskProj = {}; tasks.forEach(t => { taskProj[t.taskId] = t.project_projectId; });
            const allTaskIds = tasks.map(t => t.taskId);
            const entries = allTaskIds.length ? await SELECT.from(ENTRY).columns('timesheet_timesheetId', 'projectTask_taskId', 'hoursWorked').where({ projectTask_taskId: { in: allTaskIds } }) : [];
            const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
            const headers = tsIds.length ? await SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId').where({ timesheetId: { in: tsIds } }) : [];
            const empOfTs = {}; headers.forEach(h => { empOfTs[h.timesheetId] = h.employee_employeeId; });
            const salaries = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'hourlyCost', 'isActive');
            const hourly = {}; salaries.forEach(s => { if (s.isActive !== false) hourly[s.employee_employeeId] = Number(s.hourlyCost) || 0; });
            const consumedByProj = {};
            entries.forEach(e => {
                const pid = taskProj[e.projectTask_taskId]; const emp = empOfTs[e.timesheet_timesheetId];
                if (!pid || !emp) return;
                consumedByProj[pid] = (consumedByProj[pid] || 0) + (Number(e.hoursWorked) || 0) * (hourly[emp] || 0);
            });

            const rows = projects.map(p => {
                const allocated = Number(p.budget) || 0;
                const consumed = Math.round(consumedByProj[p.projectId] || 0);
                return {
                    projectId: p.projectId, projectName: p.projectName, customerName: p.customerName,
                    status: p.status, priority: p.priority, startDate: p.startDate, endDate: p.endDate,
                    pocName: p.pocName, progress: projectProgress(byProj[p.projectId] || []),
                    taskCount: (byProj[p.projectId] || []).length,
                    budgetAllocated: allocated, budgetConsumed: consumed,
                    budgetPct: allocated > 0 ? Math.round((consumed / allocated) * 100) : 0,
                    lifecycleStage: p.lifecycleStage || 'Planning'
                };
            });
            return JSON.stringify({ projects: rows, isFounder: isFounderCaller(req, c), isPocOf: projects.filter(p => p.poc_employeeId === c.employeeId).map(p => p.projectId) });
        });

        // ══════════════════════════════════════════════════════════════════════
        // PROJECT MANAGER DASHBOARD — project-specific operational view for the
        // assigned PM (project POC). Access-gated to that POC + Founder/admin ONLY.
        // Deliberately PM-SAFE: never exposes contract value, profit, margin or
        // any portfolio/founder financials — only operational budget (approved /
        // utilized / remaining / department split).
        // ══════════════════════════════════════════════════════════════════════
        this.on('getPmDashboard', async (req) => {
          try {
            const c = await projectCaller(req);
            const { projectId } = req.data;
            const p = await SELECT.one.from(PROJECT).where({ projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            // ── Access control ────────────────────────────────────────────────
            const isFounder = isFounderCaller(req, c);
            const isPoc = p.poc_employeeId === c.employeeId;
            if (!isFounder && !isPoc) return JSON.stringify({ error: 'You are not authorized to access this project.', unauthorized: true });

            const today = new Date(); const todayStr = today.toISOString().slice(0, 10);
            const clientRow = p.client_clientId ? await SELECT.one.from(CLIENT_MASTER).columns('companyName', 'clientName').where({ clientId: p.client_clientId }) : null;

            // ── Tasks ─────────────────────────────────────────────────────────
            const tasks = await SELECT.from(PROJECT_TASK).where({ project_projectId: projectId });
            const norm = s => String(s || '').toLowerCase().trim();
            const taskStats = { total: tasks.length, completed: 0, inProgress: 0, review: 0, pending: 0, blocked: 0, overdue: 0 };
            tasks.forEach(t => {
                const s = norm(t.status);
                if (s === 'completed') taskStats.completed++;
                else if (s === 'in progress' || s === 'inprogress') taskStats.inProgress++;
                else if (s === 'in review' || s === 'review') taskStats.review++;
                else if (s === 'blocked') taskStats.blocked++;
                else taskStats.pending++;
                if (s !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < todayStr) taskStats.overdue++;
            });
            const pendingTasks = taskStats.total - taskStats.completed;
            const progress = projectProgress(tasks);

            // ── Resources + utilization ───────────────────────────────────────
            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: projectId }).orderBy('department asc', 'employeeName asc');
            const util = await committedBandwidthByEmployee(resources.map(r => r.employee_employeeId));
            let over = 0, full = 0, underU = 0;
            const resList = resources.map(r => {
                const u = Math.round(util[r.employee_employeeId] || 0);
                if (u > 100) over++; else if (u >= 90) full++; else underU++;
                return {
                    employeeId: r.employee_employeeId, employeeName: r.employeeName, department: r.department || '—',
                    role: r.role || '—', allocationPct: Number(r.bandwidth) || 0, utilizationPct: u,
                    availabilityPct: Math.max(0, 100 - u),
                    startDate: r.startDate || p.startDate || null, endDate: r.endDate || p.endDate || null
                };
            });

            // ── Milestones ────────────────────────────────────────────────────
            const ms = await SELECT.from(MILESTONE).where({ project_projectId: projectId }).orderBy('sequence asc');
            const msList = ms.map(m => {
                const done = norm(m.status) === 'completed' || norm(m.status) === 'completed early';
                const delayed = !done && m.plannedEndDate && String(m.plannedEndDate).slice(0, 10) < todayStr;
                return { name: m.name, targetDate: m.plannedEndDate, status: m.status || 'Not Started',
                    completionPct: Number(m.progressPct) || 0, owner: m.ownerName || '—', done, delayed,
                    upcoming: !done && !delayed && m.plannedEndDate && String(m.plannedEndDate).slice(0, 10) >= todayStr };
            });
            const msCompleted = msList.filter(m => m.done).length;
            const msDelayed = msList.filter(m => m.delayed).length;
            const msUpcoming = msList.filter(m => m.upcoming).length;
            const currentPhase = (msList.find(m => !m.done) || {}).name || (msList.length ? 'All milestones complete' : '—');

            // ── Budget (PM-safe: no contract/profit) ──────────────────────────
            const { actualCost } = await projectActualCost(projectId);   // timesheet actual spend
            const execBudget = Number(p.executionBudget) || Number(p.budget) || 0;
            // Committed budget = Σ resource allocation cost (hours × loaded rate; Hard only).
            // This is what "consumes" the budget the moment a resource is allocated by hours.
            const allocCostRows = await SELECT.from(PROJECT_RESOURCE).columns('totalAllocationCost').where({ project_projectId: projectId });
            const committed = Math.round((allocCostRows || []).reduce((s, r) => s + (Number(r.totalAllocationCost) || 0), 0));
            let deptAlloc = [];
            const bRow = await SELECT.one.from(PROJECT_BUDGET).columns('categoryBudgets', 'departmentBudgets').where({ budgetId: `${projectId}-BUDGET` });
            if (bRow) {
                try {
                    const cat = JSON.parse(bRow.categoryBudgets || '[]') || [];
                    const dep = JSON.parse(bRow.departmentBudgets || '[]') || [];
                    const src = (dep.length ? dep : cat);
                    deptAlloc = src.map(x => ({ name: x.department || x.category || x.name || '—', amount: Number(x.amount) || 0 })).filter(x => x.amount > 0);
                } catch (_) { /* */ }
            }
            const budget = {
                approved: execBudget,
                committed,                     // consumed by resource allocation (hours × rate)
                utilized: committed,           // primary "utilized" = committed allocation cost
                actualSpend: actualCost,       // timesheet actuals (secondary reference)
                remaining: Math.max(0, execBudget - committed),
                utilizationPct: execBudget > 0 ? Math.round(committed / execBudget * 100) : 0,
                deptAllocation: deptAlloc
            };

            // ── Issues (used as the risk/issue register) ──────────────────────
            const issues = await SELECT.from(PROJECT_ISSUE).where({ project_projectId: projectId }).orderBy('createdAt desc');
            const openIssues = issues.filter(i => !['resolved', 'closed'].includes(norm(i.status)));
            const sevCount = { Critical: 0, High: 0, Medium: 0, Low: 0 };
            openIssues.forEach(i => { const s = i.severity || 'Medium'; if (sevCount[s] != null) sevCount[s]++; });
            const issueList = issues.slice(0, 50).map(i => ({ issueId: i.issueId, title: i.title, severity: i.severity || 'Medium',
                owner: i.ownerName || '—', status: i.status || 'Open', createdAt: i.createdAt }));

            // ── Meetings ──────────────────────────────────────────────────────
            const mtgs = await SELECT.from(MEETING).where({ project_projectId: projectId }).orderBy('startDateTime asc');
            let mUpcoming = 0, mToday = 0, mCompleted = 0;
            const upcomingMeetings = [];
            mtgs.forEach(m => {
                if (m.status === 'Completed') mCompleted++;
                else if (m.status === 'Scheduled') {
                    mUpcoming++;
                    const isToday = String(m.startDateTime || '').slice(0, 10) === todayStr;
                    if (isToday) mToday++;
                    if (upcomingMeetings.length < 5) upcomingMeetings.push({
                        title: m.title, meetingType: m.meetingType || '', startDateTime: m.startDateTime,
                        isToday, teamsJoinUrl: m.teamsJoinUrl || null, meetingMode: m.meetingMode || 'Teams'
                    });
                }
            });

            // ── Approvals (pending timesheets from allocated members) ─────────
            let pendingTimesheets = 0;
            try {
                const memberIds = resources.map(r => r.employee_employeeId);
                if (memberIds.length) {
                    const subs = await SELECT.from(HEADER).columns('timesheetId', 'status').where({ employee_employeeId: { in: memberIds }, status: 'Submitted' });
                    pendingTimesheets = (subs || []).length;
                }
            } catch (_) { /* */ }

            // ── Health score (0-100) ──────────────────────────────────────────
            const daysTotal = p.startDate && p.endDate ? Math.max(1, (new Date(p.endDate) - new Date(p.startDate)) / 86400000) : 0;
            const daysElapsed = p.startDate ? Math.max(0, (today - new Date(p.startDate)) / 86400000) : 0;
            const timePct = daysTotal ? Math.min(100, Math.round(daysElapsed / daysTotal * 100)) : 0;
            // Component scores (higher = better).
            const schedScore = Math.max(0, 100 - Math.max(0, timePct - progress) * 1.5);       // ahead/behind schedule
            const budgetScore = budget.utilizationPct <= 100 ? 100 - Math.max(0, budget.utilizationPct - progress) : Math.max(0, 100 - (budget.utilizationPct - 100) * 2);
            const resScore = over > 0 ? Math.max(0, 100 - over * 20) : 100;
            const riskScore = Math.max(0, 100 - (sevCount.Critical * 25 + sevCount.High * 12 + sevCount.Medium * 5));
            const taskScore = taskStats.total ? Math.max(0, 100 - Math.round(taskStats.overdue / taskStats.total * 100) - taskStats.blocked * 8) : 100;
            const mileScore = msList.length ? Math.max(0, 100 - msDelayed * 20) : 100;
            const healthScore = Math.round((schedScore * 0.2 + budgetScore * 0.2 + resScore * 0.15 + riskScore * 0.15 + taskScore * 0.15 + mileScore * 0.15));
            const healthLabel = healthScore >= 76 ? 'Healthy' : healthScore >= 51 ? 'At Risk' : 'Critical';

            const daysRemaining = p.endDate ? Math.round((new Date(p.endDate) - today) / 86400000) : null;

            // ── Task completion trend (last 6 months, by completedAt/modifiedAt) ─
            const months = [];
            for (let i = 5; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }) }); }
            const trendMap = {}; months.forEach(m => trendMap[m.key] = 0);
            tasks.forEach(t => { if (norm(t.status) === 'completed') { const k = String(t.modifiedAt || t.createdAt || '').slice(0, 7); if (trendMap[k] != null) trendMap[k]++; } });

            return JSON.stringify({
                canEdit: isFounder || isPoc, isFounder,
                overview: {
                    projectId: p.projectId, projectName: p.projectName,
                    clientName: clientRow ? (clientRow.companyName || clientRow.clientName) : (p.clientName || p.customerName || '—'),
                    projectType: p.projectTypeName || 'Other', startDate: p.startDate, endDate: p.endDate,
                    durationDays: daysTotal ? Math.round(daysTotal) : null, status: p.status,
                    poc: p.pocName || '—', deliveryManager: p.pocName || '—', teamSize: resources.length
                },
                summary: {
                    progress, healthScore, healthLabel, daysRemaining,
                    budgetUtilizationPct: budget.utilizationPct,
                    resourceUtilizationPct: resources.length ? Math.round(resList.reduce((s, r) => s + r.utilizationPct, 0) / resList.length) : 0,
                    openRisks: openIssues.filter(i => (i.severity === 'Critical' || i.severity === 'High')).length,
                    openIssues: openIssues.length, pendingApprovals: pendingTimesheets,
                    upcomingMilestones: msUpcoming, pendingTasks
                },
                tasks: { stats: taskStats, list: tasks.slice(0, 100).map(t => ({
                    taskId: t.taskId, taskName: t.taskName, assignedTo: t.assignedToName || '—',
                    priority: t.priority || 'Medium', status: t.status || 'Not Started', dueDate: t.dueDate,
                    completionPct: norm(t.status) === 'completed' ? 100 : (Number(t.actualHours) > 0 && Number(t.estimatedHours) > 0 ? Math.min(99, Math.round(t.actualHours / t.estimatedHours * 100)) : 0)
                })) },
                resources: { total: resources.length, overallocated: over, fullyUtilized: full, underutilized: underU, available: resList.filter(r => r.availabilityPct > 0).length, list: resList },
                milestones: { total: msList.length, completed: msCompleted, delayed: msDelayed, upcoming: msUpcoming, currentPhase, list: msList },
                budget,
                issues: { open: openIssues.length, high: sevCount.High, critical: sevCount.Critical, severity: sevCount, list: issueList },
                meetings: { upcoming: mUpcoming, today: mToday, completed: mCompleted, list: upcomingMeetings },
                charts: {
                    taskStatus: { Completed: taskStats.completed, 'In Progress': taskStats.inProgress, Review: taskStats.review, Pending: taskStats.pending, Blocked: taskStats.blocked },
                    milestoneProgress: { Completed: msCompleted, Remaining: Math.max(0, msList.length - msCompleted) },
                    resourceUtilization: resList.map(r => ({ name: r.employeeName, value: r.utilizationPct })),
                    budgetConsumption: { utilized: budget.utilized, remaining: budget.remaining },
                    issueSeverity: sevCount,
                    taskTrend: months.map(m => ({ label: m.label, value: trendMap[m.key] }))
                }
            });
          } catch (err) {
            cds.log('pm-dashboard').error('getPmDashboard failed:', err);
            return JSON.stringify({ error: 'Could not load the project dashboard: ' + (err && err.message ? err.message : String(err)) });
          }
        });

        // ── Project detail (access-checked): project + resources + tasks + progress
        this.on('getProjectDetail', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: p.projectId }).orderBy('department asc', 'employeeName asc');
            const tasks = await SELECT.from(PROJECT_TASK).where({ project_projectId: p.projectId }).orderBy('taskId asc');
            const isPoc = p.poc_employeeId === c.employeeId;
            const isAllocated = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && !isPoc && !isAllocated) return JSON.stringify({ error: 'You do not have access to this project.' });
            // Task counts for the progress / dashboard cards.
            const today = new Date().toISOString().slice(0, 10);
            const norm = s => String(s || '').toLowerCase().trim();
            const taskStats = { total: tasks.length, completed: 0, ongoing: 0, pending: 0, blocked: 0, inReview: 0, overdue: 0 };
            tasks.forEach(t => {
                const s = norm(t.status);
                if (s === 'completed') taskStats.completed++;
                else if (s === 'in progress' || s === 'inprogress') taskStats.ongoing++;
                else if (s === 'in review' || s === 'review') taskStats.inReview++;
                else if (s === 'blocked') taskStats.blocked++;
                else taskStats.pending++;
                if (s !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today) taskStats.overdue++;
            });
            // Total committed FTE per resource (across all active projects) → utilization badge.
            const resUtil = await committedBandwidthByEmployee(resources.map(r => r.employee_employeeId));
            // Milestone id → name map for the optional milestone tag on each allocation.
            const projMilestones = await SELECT.from(MILESTONE).columns('milestoneId', 'name', 'sequence').where({ project_projectId: p.projectId }).orderBy('sequence asc');
            const msNameById = {}; projMilestones.forEach(m => { msNameById[m.milestoneId] = m.name; });
            return JSON.stringify({
                project: {
                    projectId: p.projectId, projectName: p.projectName, customerName: p.customerName,
                    description: p.description, startDate: p.startDate, endDate: p.endDate,
                    status: p.status, priority: p.priority, pocName: p.pocName, createdByName: p.createdByName,
                    lifecycleStage: p.lifecycleStage || 'Planning', planningMeetingId: p.planningMeetingId || null,
                    poc_employeeId: p.poc_employeeId,
                    // Project-type-driven planning + financial model.
                    projectType: p.projectType_code || 'OTHER', projectTypeName: p.projectTypeName || 'Other',
                    contractValue: Number(p.contractValue) || 0, profitMarginPct: Number(p.profitMarginPct) || 0,
                    profitReserveAmount: Number(p.profitReserveAmount) || 0, executionBudget: Number(p.executionBudget) || 0
                },
                progress: projectProgress(tasks),
                taskStats: taskStats,
                canManage: isFounderCaller(req, c), isPoc,
                resources: resources.map(r => {
                    const totalUtil = resUtil[r.employee_employeeId] || 0;
                    return { employeeId: r.employee_employeeId, employeeName: r.employeeName, department: r.department,
                        bandwidth: r.bandwidth, utilizationPct: totalUtil, isOverridden: r.isOverridden === true,
                        role: r.role || '', phase: r.phase || '', module: r.module || '',
                        milestoneId: r.milestone_milestoneId || '', milestoneName: msNameById[r.milestone_milestoneId] || '' };
                }),
                milestones: projMilestones.map(m => ({ milestoneId: m.milestoneId, name: m.name, sequence: m.sequence })),
                tasks: (tasks || []).map(t => ({
                    taskId: t.taskId, taskName: t.taskName, description: t.description, assignedTo: t.assignedTo_employeeId,
                    assignedToName: t.assignedToName, priority: t.priority, status: t.status, startDate: t.startDate,
                    dueDate: t.dueDate, estimatedHours: t.estimatedHours, actualHours: t.actualHours,
                    mine: t.assignedTo_employeeId === c.employeeId
                }))
            });
        });

        // ── Founder: project dashboard ──────────────────────────────────────────
        this.on('getProjectDashboard', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view the project dashboard.' });
            const [projects, tasks, resources] = await Promise.all([
                SELECT.from(PROJECT).columns('projectId', 'status', 'endDate'),
                SELECT.from(PROJECT_TASK).columns('project_projectId', 'status'),
                SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'project_projectId')
            ]);
            const today = new Date().toISOString().slice(0, 10);
            const isDone = s => String(s || '').toLowerCase() === 'completed';
            const completedProjects = projects.filter(p => p.status === 'Completed').length;
            const activeProjects = projects.filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).length;
            const delayed = projects.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled' && p.endDate && String(p.endDate).slice(0, 10) < today).length;
            const openTasks = tasks.filter(t => !isDone(t.status)).length;
            const completedTasks = tasks.filter(t => isDone(t.status)).length;
            // Active resource headcount counts only employees on capacity-consuming projects.
            const activeProjIds = new Set(projects.filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).map(p => p.projectId));
            const activeResourceEmps = new Set(resources.filter(r => activeProjIds.has(r.project_projectId)).map(r => r.employee_employeeId));
            return JSON.stringify({
                totalProjects: projects.length, activeProjects, completedProjects, delayedProjects: delayed,
                resourceCount: activeResourceEmps.size,
                openTasks, completedTasks
            });
        });

        // ── Audit log (Founder or the project POC) ──────────────────────────────
        this.on('getProjectAuditLog', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            if (!isFounderCaller(req, c) && p.poc_employeeId !== c.employeeId) return JSON.stringify({ error: 'You do not have access to this audit log.' });
            const rows = await SELECT.from(PROJECT_AUDIT).where({ project_projectId: p.projectId }).orderBy('at desc');
            return JSON.stringify({
                entries: (rows || []).map(r => ({
                    userName: r.userName, action: r.action, oldValue: r.oldValue, newValue: r.newValue,
                    at: r.at ? new Date(r.at).toLocaleString() : ''
                }))
            });
        });

        // ── Executive dashboard: budget, effort, issues, AI summary ─────────────
        this.on('getProjectExecutive', async (req) => {
            const c = await projectCaller(req);
            const p = await SELECT.one.from(PROJECT).where({ projectId: req.data.projectId });
            if (!p) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).where({ project_projectId: p.projectId });
            const isPoc = p.poc_employeeId === c.employeeId;
            const isAllocated = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && !isPoc && !isAllocated) return JSON.stringify({ error: 'You do not have access to this project.' });

            // Dashboard / execution metrics are hidden until the project is Active.
            // While in Planning, only the lifecycle/planning screens are available.
            if (p.status === 'Planning') {
                return JSON.stringify({ planning: true, status: p.status, lifecycleStage: p.lifecycleStage || 'Planning',
                    message: 'The project dashboard becomes available once the Planning Phase is complete and the project is Active.' });
            }

            const tasks = await SELECT.from(PROJECT_TASK).where({ project_projectId: p.projectId });
            const issues = await SELECT.from(PROJECT_ISSUE).where({ project_projectId: p.projectId }).orderBy('createdAt desc');

            // ── Worked hours from APPROVED-or-saved timesheets linked to this project ──
            const taskIds = tasks.map(t => t.taskId);
            const entries = taskIds.length
                ? await SELECT.from(ENTRY).columns('timesheet_timesheetId', 'projectTask_taskId', 'hoursWorked').where({ projectTask_taskId: { in: taskIds } })
                : [];
            const tsIds = [...new Set(entries.map(e => e.timesheet_timesheetId))];
            const headers = tsIds.length ? await SELECT.from(HEADER).columns('timesheetId', 'employee_employeeId').where({ timesheetId: { in: tsIds } }) : [];
            const empOfTs = {}; headers.forEach(h => { empOfTs[h.timesheetId] = h.employee_employeeId; });

            // Active hourly cost per employee.
            const salaries = await SELECT.from(SALARY_MASTER).columns('employee_employeeId', 'hourlyCost', 'isActive');
            const hourly = {}; salaries.forEach(s => { if (s.isActive !== false) hourly[s.employee_employeeId] = Number(s.hourlyCost) || 0; });

            // Worked hours per employee + total consumed cost.
            const workedByEmp = {};
            entries.forEach(e => { const emp = empOfTs[e.timesheet_timesheetId]; if (!emp) return; workedByEmp[emp] = (workedByEmp[emp] || 0) + (Number(e.hoursWorked) || 0); });
            let totalConsumed = 0, totalWorked = 0;
            Object.keys(workedByEmp).forEach(emp => { totalWorked += workedByEmp[emp]; totalConsumed += workedByEmp[emp] * (hourly[emp] || 0); });

            // Assigned (estimated) hours per employee.
            const assignedByEmp = {}; let totalAssignedHours = 0;
            tasks.forEach(t => { const a = t.assignedTo_employeeId, est = Number(t.estimatedHours) || 0; if (a) assignedByEmp[a] = (assignedByEmp[a] || 0) + est; totalAssignedHours += est; });

            // Names (resources + any assigned/worked employee not in resources).
            const empIds = new Set([...Object.keys(assignedByEmp), ...Object.keys(workedByEmp), ...resources.map(r => r.employee_employeeId)]);
            if (p.poc_employeeId) empIds.add(p.poc_employeeId);   // ensure manager card resolves
            const nameMap = {}; resources.forEach(r => { nameMap[r.employee_employeeId] = r.employeeName; });
            const empRows = empIds.size ? await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'designation', 'email').where({ employeeId: { in: [...empIds] } }) : [];
            const desig = {}, emailOf = {}; empRows.forEach(e => { nameMap[e.employeeId] = e.employeeName; desig[e.employeeId] = e.designation; emailOf[e.employeeId] = e.email; });

            // Manager (POC) profile photo as a data URL for the manager card.
            let pocPhoto = '';
            if (p.poc_employeeId) {
                const pocRow = await SELECT.one.from(EMPLOYEE).columns('profilePhoto', 'profilePhotoMimeType').where({ employeeId: p.poc_employeeId });
                if (pocRow && pocRow.profilePhoto) {
                    const b64 = await binaryToBase64(pocRow.profilePhoto);
                    if (b64) pocPhoto = (String(b64).indexOf('data:') === 0) ? b64 : ('data:' + (pocRow.profilePhotoMimeType || 'image/jpeg') + ';base64,' + b64);
                }
            }

            // Assigned-vs-worked effort comparison (dual bar).
            const effort = [...empIds].map(id => ({
                employeeId: id, employeeName: nameMap[id] || id,
                assignedHours: Math.round((assignedByEmp[id] || 0) * 10) / 10,
                workedHours: Math.round((workedByEmp[id] || 0) * 10) / 10
            })).sort((a, b) => b.assignedHours - a.assignedHours);

            // Task stats.
            const today = new Date().toISOString().slice(0, 10);
            const norm = s => String(s || '').toLowerCase().trim();
            const taskStats = { total: tasks.length, completed: 0, ongoing: 0, pending: 0, blocked: 0, inReview: 0, overdue: 0 };
            tasks.forEach(t => {
                const s = norm(t.status);
                if (s === 'completed') taskStats.completed++;
                else if (s === 'in progress' || s === 'inprogress') taskStats.ongoing++;
                else if (s === 'in review' || s === 'review') taskStats.inReview++;
                else if (s === 'blocked') taskStats.blocked++;
                else taskStats.pending++;
                if (s !== 'completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today) taskStats.overdue++;
            });

            // Issues.
            const issueCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
            const openIssues = issues.filter(i => i.status !== 'Closed' && i.status !== 'Resolved');
            openIssues.forEach(i => { if (issueCounts[i.severity] !== undefined) issueCounts[i.severity]++; });

            const progress = projectProgress(tasks);
            const budget = Number(p.budget) || 0;
            const budgetPct = budget > 0 ? Math.round((totalConsumed / budget) * 100) : 0;
            const workedPct = totalAssignedHours > 0 ? Math.round((totalWorked / totalAssignedHours) * 100) : 0;
            const ai = projectHealthSummary({ progress, status: p.status, budget, budgetPct, openHigh: issueCounts.High, openCritical: issueCounts.Critical, plannedHours: totalAssignedHours, workedPct });

            // Financial figures are Founder-only. POC / allocated employees get operational
            // hours but never budget or cost amounts.
            const isFounder = isFounderCaller(req, c);
            const budgetBlock = isFounder
                ? { allocated: budget, consumed: Math.round(totalConsumed), remaining: Math.round(Math.max(0, budget - totalConsumed)), utilizationPct: budgetPct }
                : { allocated: 0, consumed: 0, remaining: 0, utilizationPct: 0 };
            const resourceSummary = isFounder
                ? { totalAssigned: resources.length, active: resources.filter(r => workedByEmp[r.employee_employeeId] > 0).length, costConsumed: Math.round(totalConsumed), costRemaining: Math.round(Math.max(0, budget - totalConsumed)), totalWorkedHours: Math.round(totalWorked * 10) / 10, totalAssignedHours: Math.round(totalAssignedHours * 10) / 10 }
                : { totalAssigned: resources.length, active: resources.filter(r => workedByEmp[r.employee_employeeId] > 0).length, totalWorkedHours: Math.round(totalWorked * 10) / 10, totalAssignedHours: Math.round(totalAssignedHours * 10) / 10 };

            return JSON.stringify({
                project: { projectId: p.projectId, projectName: p.projectName, customerName: p.customerName, description: p.description, status: p.status, priority: p.priority },
                badge: ai.health, progress, aiSummary: ai.text,
                dates: { start: p.startDate, end: p.endDate, goLive: p.goLiveDate },
                financialAccess: isFounder,
                budget: budgetBlock,
                manager: { employeeId: p.poc_employeeId, name: p.pocName, designation: desig[p.poc_employeeId] || '', email: emailOf[p.poc_employeeId] || '', photo: pocPhoto },
                taskStats,
                resourceSummary: resourceSummary,
                effort,
                focusAreas: String(p.focusAreas || '').split(',').map(x => x.trim()).filter(Boolean),
                issueCounts,
                issues: issues.map(i => ({ issueId: i.issueId, title: i.title, severity: i.severity, ownerName: i.ownerName, status: i.status, createdAt: i.createdAt ? new Date(i.createdAt).toLocaleDateString() : '' })),
                canManage: isFounder
            });
        });

        // ── Issues ──────────────────────────────────────────────────────────────
        this.on('createProjectIssue', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId: d.projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            const isPoc = project.poc_employeeId === c.employeeId;
            if (!isFounderCaller(req, c) && !isPoc) return JSON.stringify({ error: 'Only the Founder or project POC can raise issues.' });
            if (!(d.title || '').trim()) return JSON.stringify({ error: 'Issue title is required.' });
            const SEV = ['Critical', 'High', 'Medium', 'Low'];
            const severity = SEV.includes(d.severity) ? d.severity : 'Medium';
            const owner = d.ownerId ? await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId: d.ownerId }) : null;
            const existing = await SELECT.from(PROJECT_ISSUE).columns('issueId').where({ project_projectId: d.projectId });
            const issueId = `${d.projectId}-ISS-${String(existing.length + 1).padStart(3, '0')}`;
            await INSERT.into(PROJECT_ISSUE).entries({
                issueId, project_projectId: d.projectId, title: d.title.trim(), description: (d.description || '').trim(),
                severity, owner_employeeId: owner ? owner.employeeId : null, ownerName: owner ? owner.employeeName : '', status: 'Open'
            });
            await projectAudit(d.projectId, c.name, 'Issue Raised', null, `${severity}: ${d.title.trim()}`);
            founderEvents.ping('createProjectIssue');
            return JSON.stringify({ ok: true, issueId });
        });
        this.on('updateProjectIssue', async (req) => {
            const c = await projectCaller(req);
            const { issueId, status } = req.data;
            const STAT = ['Open', 'In Progress', 'Resolved', 'Closed'];
            if (!STAT.includes(status)) return JSON.stringify({ error: 'Invalid issue status.' });
            const iss = await SELECT.one.from(PROJECT_ISSUE).where({ issueId });
            if (!iss) return JSON.stringify({ error: 'Issue not found.' });
            const project = await SELECT.one.from(PROJECT).columns('poc_employeeId').where({ projectId: iss.project_projectId });
            if (!isFounderCaller(req, c) && !(project && project.poc_employeeId === c.employeeId)) return JSON.stringify({ error: 'Not authorised.' });
            await UPDATE(PROJECT_ISSUE).set({ status }).where({ issueId });
            await projectAudit(iss.project_projectId, c.name, 'Issue Updated', iss.status, status);
            founderEvents.ping('updateProjectIssue');
            return JSON.stringify({ ok: true });
        });

        // ── Employee salary master (Founder/HR) ─────────────────────────────────
        this.on('upsertEmployeeSalary', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c) && c.role !== 'hr') return JSON.stringify({ error: 'Only Founder or HR can manage salaries.' });
            const d = req.data || {};
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId: d.employeeId });
            if (!emp) return JSON.stringify({ error: 'Employee not found.' });
            const annual = Number(d.annualSalary) || 0;
            const hourly = Number(d.hourlyCost) || (annual > 0 ? Math.round((annual / 2080) * 100) / 100 : 0);   // 52 weeks × 40 hrs = 2080 standard annual hours
            const eff = d.effectiveFrom || new Date().toISOString().slice(0, 10);
            const salaryId = `${emp.employeeId}-${eff}`;
            // Deactivate prior active rows, then upsert the new active one.
            await UPDATE(SALARY_MASTER).set({ isActive: false }).where({ employee_employeeId: emp.employeeId });
            await UPSERT.into(SALARY_MASTER).entries({
                salaryId, employee_employeeId: emp.employeeId, employeeName: emp.employeeName,
                annualSalary: annual, monthlySalary: annual > 0 ? Math.round((annual / 12) * 100) / 100 : 0,
                hourlyCost: hourly, effectiveFrom: eff, effectiveTo: null, isActive: true
            });
            return JSON.stringify({ ok: true, salaryId, hourlyCost: hourly });
        });
        this.on('getEmployeeSalaries', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c) && c.role !== 'hr') return JSON.stringify({ error: 'Not authorised.' });
            const rows = await SELECT.from(SALARY_MASTER).where({ isActive: true }).orderBy('employeeName asc');
            return JSON.stringify({ salaries: rows.map(r => ({ employeeId: r.employee_employeeId, employeeName: r.employeeName, annualSalary: r.annualSalary, hourlyCost: r.hourlyCost, effectiveFrom: r.effectiveFrom })) });
        });

        // ────────────────────────────────────────────────────────────────────────────
        // Microsoft Teams Meeting handlers
        // Authorization: Founder or project POC can schedule/edit/cancel.
        //                All project members can view (via getProjectMeetings).
        // ────────────────────────────────────────────────────────────────────────────

        const { createMeeting: teamsMkMeeting, updateMeeting: teamsUpdMeeting,
                cancelMeeting: teamsCxlMeeting, formatMeetingForDisplay: fmtMtg, MOCK_MODE } = require('./services/teams-service');

        // ── Helper: generate next meeting ID ──────────────────────────────────────
        async function nextMeetingId(projectId) {
            const rows = await SELECT.from(MEETING).columns('meetingId').where({ project_projectId: projectId });
            const max = rows.reduce((n, r) => {
                const m = r.meetingId.match(/-(\d+)$/);
                return m ? Math.max(n, parseInt(m[1], 10)) : n;
            }, 0);
            return `MTG-${projectId}-${String(max + 1).padStart(3, '0')}`;
        }

        // ── Schedule a Teams meeting ──────────────────────────────────────────────
        this.on('scheduleMeeting', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'status', 'lifecycleStage', 'planningMeetingId').where({ projectId: d.projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            if (!(isFounderCaller(req, c) || project.poc_employeeId === c.employeeId))
                return JSON.stringify({ error: 'Only the project POC or Founder can schedule meetings.' });

            const isDraft = d.isDraft === true;
            const mode = (d.meetingMode === 'InPerson') ? 'InPerson' : 'Teams';
            const tz = (d.timeZone || 'Asia/Kolkata').trim();

            // Validation.
            if (!(d.title || '').trim()) return JSON.stringify({ error: 'Meeting title is required.' });
            if (!d.startDateTime)        return JSON.stringify({ error: 'Date and Start time are required.' });
            if (!isDraft) {
                if (!d.endDateTime)          return JSON.stringify({ error: 'End time is required.' });
                if (d.endDateTime <= d.startDateTime) return JSON.stringify({ error: 'End time must be after start time.' });
                if (new Date(d.startDateTime) < new Date()) return JSON.stringify({ error: 'Cannot schedule a meeting in the past.' });
                if (mode === 'InPerson' && !(d.location || '').trim()) return JSON.stringify({ error: 'Meeting location is required for an in-person meeting.' });
            }

            // ── Participants: internal (employees) + external guests ──────────────
            const requiredSet = new Set((d.requiredIds || []).filter(Boolean));
            const partSet = new Set((d.participantIds || []).filter(Boolean));
            if (project.poc_employeeId) { partSet.add(project.poc_employeeId); requiredSet.add(project.poc_employeeId); }
            const participantIds = [...partSet];
            const partEmps = participantIds.length
                ? await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where({ employeeId: { in: participantIds }, isActive: true })
                : [];
            // External participants: JSON array of { name, email }.
            let externals = [];
            try { externals = JSON.parse(d.externalJson || '[]') || []; } catch (e) { externals = []; }
            const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            externals = externals.filter(x => x && x.email && EMAIL_RE.test(String(x.email).trim()))
                .map(x => ({ name: (x.name || '').trim(), email: String(x.email).trim().toLowerCase() }));
            const badExternal = (JSON.parse(d.externalJson || '[]') || []).some(x => x && x.email && !EMAIL_RE.test(String(x.email).trim()));
            if (badExternal) return JSON.stringify({ error: 'One or more external participant emails are invalid.' });
            if (!partEmps.length && !externals.length && !isDraft) return JSON.stringify({ error: 'At least one participant is required.' });

            // ── Overlap check for internal participants (skip for drafts) ─────────
            if (!isDraft && partEmps.length) {
                const overlapIds = partEmps.map(e => e.employeeId);
                const clashParts = await SELECT.from(MEETING_PARTICIPANT).columns('meeting_meetingId', 'employee_employeeId', 'employeeName')
                    .where({ employee_employeeId: { in: overlapIds } });
                if (clashParts.length) {
                    const clashMtgIds = [...new Set(clashParts.map(p => p.meeting_meetingId))];
                    const clashMtgs = await SELECT.from(MEETING).columns('meetingId', 'startDateTime', 'endDateTime', 'status')
                        .where({ meetingId: { in: clashMtgIds }, status: { in: ['Scheduled'] } });
                    const s0 = new Date(d.startDateTime).getTime(), e0 = new Date(d.endDateTime).getTime();
                    const overlapMtg = clashMtgs.find(mm => {
                        const s1 = new Date(mm.startDateTime).getTime(), e1 = new Date(mm.endDateTime).getTime();
                        return s0 < e1 && s1 < e0;
                    });
                    if (overlapMtg) {
                        const who = clashParts.filter(p => p.meeting_meetingId === overlapMtg.meetingId).map(p => p.employeeName).filter(Boolean)[0] || 'a participant';
                        return JSON.stringify({ error: `${who} already has an overlapping meeting at this time. Please choose a different slot.` });
                    }
                }
            }

            const organizerEmail = c.email || '';
            // ── Teams meeting: only for Teams mode & non-draft. Manual link fallback. ─
            let teamsData = { teamsMeetingId: null, teamsJoinUrl: (d.manualJoinUrl || '').trim() || null, teamsDialIn: null };
            let manualLink = !!(d.manualJoinUrl || '').trim();
            let teamsError = null;
            if (mode === 'Teams' && !isDraft && !manualLink) {
                try {
                    teamsData = await teamsMkMeeting({
                        title: d.title.trim(), agenda: (d.agenda || '').trim(),
                        startDateTime: d.startDateTime, endDateTime: d.endDateTime,
                        organizerEmail,
                        participants: [...partEmps.map(e => ({ email: e.email, name: e.employeeName })), ...externals]
                    });
                } catch (e) {
                    cds.log('teams').error('Graph API createMeeting failed:', e.message);
                    // Don't break scheduling — surface a flag so the UI can offer a manual link.
                    teamsError = e.message || 'Teams integration unavailable';
                    if (!(d.manualJoinUrl || '').trim()) {
                        return JSON.stringify({ error: `Could not create the Teams meeting (${teamsError}). You can enter a Teams link manually, or save as In Person.`, teamsFailed: true });
                    }
                }
            }

            const meetingId = await nextMeetingId(d.projectId);
            await INSERT.into(MEETING).entries({
                meetingId, project_projectId: d.projectId,
                title: d.title.trim(), meetingType: (d.meetingType || '').trim(),
                agenda: (d.agenda || '').trim(),
                startDateTime: d.startDateTime, endDateTime: d.endDateTime || null,
                timeZone: tz, meetingMode: mode, location: (d.location || '').trim(),
                organizerEmail, organizerName: c.name || '',
                organizer_employeeId: c.employeeId,
                status: isDraft ? 'Draft' : 'Scheduled',
                manualLink,
                teamsMeetingId: teamsData.teamsMeetingId,
                teamsJoinUrl:   mode === 'Teams' ? teamsData.teamsJoinUrl : null,
                teamsDialIn:    teamsData.teamsDialIn || null
            });
            // Insert internal participants.
            for (const emp of partEmps) {
                await INSERT.into(MEETING_PARTICIPANT).entries({
                    participantId: `${meetingId}-${emp.employeeId}`, meeting_meetingId: meetingId,
                    employee_employeeId: emp.employeeId,
                    employeeName: emp.employeeName, employeeEmail: emp.email,
                    isExternal: false, isRequired: requiredSet.has(emp.employeeId), attendanceStatus: 'Invited'
                });
                if (!isDraft) await createNotification(emp.employeeId, 'MEETING_CREATED', 'Meeting Scheduled',
                    `You are invited to "${d.title.trim()}" on ${new Date(d.startDateTime).toLocaleString('en-IN')}.`, meetingId);
            }
            // Insert external participants (no employee link).
            let extSeq = 0;
            for (const ex of externals) {
                await INSERT.into(MEETING_PARTICIPANT).entries({
                    participantId: `${meetingId}-EXT-${++extSeq}`, meeting_meetingId: meetingId,
                    employeeName: ex.name || ex.email, employeeEmail: ex.email,
                    isExternal: true, isRequired: false, attendanceStatus: 'Invited'
                });
            }

            // ── Email invites + .ics calendar (skip drafts) ───────────────────────
            if (!isDraft) {
                const mtgRow = await SELECT.one.from(MEETING).where({ meetingId });
                const attendees = [
                    ...partEmps.map(e => ({ name: e.employeeName, email: e.email })),
                    ...externals
                ];
                await sendMeetingInvites(mtgRow, attendees, { method: 'REQUEST', sequence: 0 });
            }

            // Advance planning lifecycle on the first scheduled (non-draft) meeting.
            if (!isDraft && project.status === 'Planning' && (!project.lifecycleStage || project.lifecycleStage === 'Planning') && !project.planningMeetingId) {
                await UPDATE(PROJECT).set({ lifecycleStage: 'MeetingScheduled', planningMeetingId: meetingId }).where({ projectId: d.projectId });
                await projectAudit(d.projectId, c.name, 'Planning Meeting Scheduled', 'Planning', d.title.trim());
            }
            founderEvents.ping('scheduleMeeting');
            return JSON.stringify({
                ok: true, meetingId, isDraft, meetingMode: mode,
                teamsJoinUrl: mode === 'Teams' ? teamsData.teamsJoinUrl : null,
                manualLink, teamsError, isMock: MOCK_MODE,
                message: isDraft ? 'Draft saved.' : (mode === 'InPerson' ? 'In-person meeting scheduled. Invites sent.'
                    : (MOCK_MODE ? 'Meeting created (dev mock — no real Teams meeting). Invites sent.' : 'Teams meeting created. Invites sent.'))
            });
        });

        // ── Update a scheduled meeting ────────────────────────────────────────────
        this.on('updateMeetingDetails', async (req) => {
            const c = await projectCaller(req);
            const d = req.data || {};
            const mtg = await SELECT.one.from(MEETING).where({ meetingId: d.meetingId });
            if (!mtg) return JSON.stringify({ error: 'Meeting not found.' });
            const project = await SELECT.one.from(PROJECT).columns('poc_employeeId').where({ projectId: mtg.project_projectId });
            if (!(isFounderCaller(req, c) || (project && project.poc_employeeId === c.employeeId)))
                return JSON.stringify({ error: 'Only the project POC or Founder can edit meetings.' });
            if (mtg.status === 'Cancelled') return JSON.stringify({ error: 'Cannot edit a cancelled meeting.' });
            if (!(d.title || '').trim()) return JSON.stringify({ error: 'Title is required.' });
            const newStart = d.startDateTime || mtg.startDateTime;
            const newEnd = d.endDateTime || mtg.endDateTime;
            if (newEnd && newStart && newEnd <= newStart)
                return JSON.stringify({ error: 'End time must be after start time.' });

            const newMode = d.meetingMode ? (d.meetingMode === 'InPerson' ? 'InPerson' : 'Teams') : (mtg.meetingMode || 'Teams');
            const manualJoin = (d.manualJoinUrl || '').trim();
            const set = {
                title: d.title.trim(),
                meetingType: d.meetingType != null ? String(d.meetingType).trim() : mtg.meetingType,
                agenda: (d.agenda || '').trim(),
                startDateTime: newStart, endDateTime: newEnd,
                timeZone: d.timeZone ? String(d.timeZone).trim() : (mtg.timeZone || 'Asia/Kolkata'),
                meetingMode: newMode,
                location: d.location != null ? String(d.location).trim() : mtg.location
            };

            // Teams: try to update the existing meeting; if unsupported/failed, create
            // a fresh one and invalidate the old link (per spec).
            if (newMode === 'Teams') {
                if (manualJoin) { set.teamsJoinUrl = manualJoin; set.manualLink = true; }
                else if (mtg.teamsMeetingId && !mtg.manualLink) {
                    try {
                        await teamsUpdMeeting({ teamsMeetingId: mtg.teamsMeetingId, organizerEmail: mtg.organizerEmail,
                            title: set.title, agenda: set.agenda, startDateTime: newStart, endDateTime: newEnd });
                    } catch (e) {
                        cds.log('teams').warn('updateMeeting failed, recreating:', e.message);
                        try {
                            const parts0 = await SELECT.from(MEETING_PARTICIPANT).where({ meeting_meetingId: d.meetingId });
                            const fresh = await teamsMkMeeting({ title: set.title, agenda: set.agenda, startDateTime: newStart, endDateTime: newEnd,
                                organizerEmail: mtg.organizerEmail, participants: parts0.map(p => ({ email: p.employeeEmail, name: p.employeeName })) });
                            set.teamsMeetingId = fresh.teamsMeetingId; set.teamsJoinUrl = fresh.teamsJoinUrl; set.manualLink = false;
                        } catch (e2) { /* keep old link */ }
                    }
                } else if (!mtg.teamsMeetingId) {
                    // Switching In-Person → Teams: create a new meeting.
                    try {
                        const parts0 = await SELECT.from(MEETING_PARTICIPANT).where({ meeting_meetingId: d.meetingId });
                        const fresh = await teamsMkMeeting({ title: set.title, agenda: set.agenda, startDateTime: newStart, endDateTime: newEnd,
                            organizerEmail: mtg.organizerEmail, participants: parts0.map(p => ({ email: p.employeeEmail, name: p.employeeName })) });
                        set.teamsMeetingId = fresh.teamsMeetingId; set.teamsJoinUrl = fresh.teamsJoinUrl; set.manualLink = false;
                    } catch (e) { /* leave without link; UI can add manual */ }
                }
            } else {
                // In-Person: drop any Teams link.
                set.teamsJoinUrl = null;
            }

            await UPDATE(MEETING).set(set).where({ meetingId: d.meetingId });

            const parts = await SELECT.from(MEETING_PARTICIPANT).where({ meeting_meetingId: d.meetingId });
            for (const p of parts) {
                if (p.employee_employeeId) await createNotification(p.employee_employeeId, 'MEETING_UPDATED', 'Meeting Updated',
                    `Meeting "${set.title}" has been updated. New time: ${new Date(newStart).toLocaleString('en-IN')}.`, d.meetingId);
            }
            // Resend updated invite + .ics (bump SEQUENCE so calendars refresh).
            if (mtg.status !== 'Draft') {
                const updated = await SELECT.one.from(MEETING).where({ meetingId: d.meetingId });
                await sendMeetingInvites(updated, parts.map(p => ({ name: p.employeeName, email: p.employeeEmail })), { method: 'REQUEST', sequence: Date.now() % 100000 });
            }
            founderEvents.ping('updateMeeting');
            return JSON.stringify({ ok: true, teamsJoinUrl: set.teamsJoinUrl !== undefined ? set.teamsJoinUrl : mtg.teamsJoinUrl });
        });

        // ── Cancel a meeting ──────────────────────────────────────────────────────
        this.on('cancelProjectMeeting', async (req) => {
            const c = await projectCaller(req);
            const { meetingId } = req.data;
            const mtg = await SELECT.one.from(MEETING).where({ meetingId });
            if (!mtg) return JSON.stringify({ error: 'Meeting not found.' });
            const project = await SELECT.one.from(PROJECT).columns('poc_employeeId').where({ projectId: mtg.project_projectId });
            if (!(isFounderCaller(req, c) || (project && project.poc_employeeId === c.employeeId)))
                return JSON.stringify({ error: 'Only the project POC or Founder can cancel meetings.' });
            if (mtg.status === 'Cancelled') return JSON.stringify({ error: 'Meeting is already cancelled.' });

            try {
                await teamsCxlMeeting({ teamsMeetingId: mtg.teamsMeetingId, organizerEmail: mtg.organizerEmail });
            } catch (e) {
                cds.log('teams').warn('Graph API cancelMeeting failed (marking cancelled anyway):', e.message);
            }

            await UPDATE(MEETING).set({ status: 'Cancelled' }).where({ meetingId });
            const parts = await SELECT.from(MEETING_PARTICIPANT).where({ meeting_meetingId: meetingId });
            for (const p of parts) {
                if (p.employee_employeeId) await createNotification(p.employee_employeeId, 'MEETING_CANCELLED',
                    'Meeting Cancelled', `Meeting "${mtg.title}" has been cancelled.`, meetingId);
            }
            // Send a cancellation calendar update (.ics METHOD:CANCEL) to all attendees.
            if (mtg.status !== 'Draft') {
                await sendMeetingInvites(mtg, parts.map(p => ({ name: p.employeeName, email: p.employeeEmail })), { cancelled: true, sequence: Date.now() % 100000 });
            }
            founderEvents.ping('cancelMeeting');
            return JSON.stringify({ ok: true });
        });

        // ── DEV-ONLY: complete every onboarding meeting & advance the workflow ─────
        // Never registered in production so it can never be invoked there.
        if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
            this.on('completeAllProjectMeetings', async (req) => {
                const c = await projectCaller(req);
                const { projectId } = req.data;
                const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId', 'status', 'lifecycleStage').where({ projectId });
                if (!project) return JSON.stringify({ error: 'Project not found.' });
                if (!(isFounderCaller(req, c) || project.poc_employeeId === c.employeeId))
                    return JSON.stringify({ error: 'Not authorised.' });
                // Mark all non-cancelled meetings completed.
                await UPDATE(MEETING).set({ status: 'Completed' }).where({ project_projectId: projectId, status: { in: ['Scheduled', 'Draft'] } });
                // Advance onboarding: if still in the meeting phase, jump to MeetingCompleted
                // so the next action (Allocate Budget) is unlocked.
                if (project.status === 'Planning' && ['Planning', 'MeetingScheduled'].includes(project.lifecycleStage || 'Planning')) {
                    await UPDATE(PROJECT).set({ lifecycleStage: 'MeetingCompleted' }).where({ projectId });
                    await projectAudit(projectId, c.name, 'Meetings Completed (dev)', project.lifecycleStage, 'MeetingCompleted');
                }
                founderEvents.ping('completeAllMeetings');
                return JSON.stringify({ ok: true, message: 'All meetings marked completed. Onboarding advanced.' });
            });
        }

        // ── Get all meetings for a project ────────────────────────────────────────
        this.on('getProjectMeetings', async (req) => {
            const c = await projectCaller(req);
            const { projectId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: projectId });
            const isAlloc = resources.some(r => r.employee_employeeId === c.employeeId);
            if (!isFounderCaller(req, c) && project.poc_employeeId !== c.employeeId && !isAlloc)
                return JSON.stringify({ error: 'You do not have access to this project.' });

            const mtgs = await SELECT.from(MEETING)
                .where({ project_projectId: projectId })
                .orderBy('startDateTime asc');
            const isPocCaller = project.poc_employeeId === c.employeeId;
            const result = [];
            for (const m of mtgs) {
                const parts = await SELECT.from(MEETING_PARTICIPANT).where({ meeting_meetingId: m.meetingId });
                // Join is allowed only for selected participants, the organizer, or
                // the POC (Founder also permitted). Everyone else may view details only.
                const isParticipant = parts.some(p => p.employee_employeeId === c.employeeId);
                const isOrganizer = m.organizer_employeeId === c.employeeId;
                const canJoin = isFounderCaller(req, c) || isPocCaller || isOrganizer || isParticipant;
                result.push({ ...fmtMtg(m), canJoin,
                    participants: parts.map(p => ({ employeeId: p.employee_employeeId, employeeName: p.employeeName, employeeEmail: p.employeeEmail, attendanceStatus: p.attendanceStatus })) });
            }
            const canManage = isFounderCaller(req, c) || isPocCaller;
            return JSON.stringify({ meetings: result, canManage });
        });

        // ── Project Chat ────────────────────────────────────────────────────────────
        // Access: Founder, project POC, or any allocated resource can read/write.
        // Reuses the same coalesced-notification + soft-delete patterns as group chat.

        const _projChatAccess = async (req, projectId) => {
            const c = await projectCaller(req);
            const project = await SELECT.one.from(PROJECT)
                .columns('projectId', 'projectName', 'poc_employeeId', 'pinnedMessageId', 'pinnedByName')
                .where({ projectId });
            if (!project) return { ok: false, error: 'Project not found.' };
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId').where({ project_projectId: projectId });
            const isAlloc = resources.some(r => r.employee_employeeId === c.employeeId);
            const canAccess = isFounderCaller(req, c) || project.poc_employeeId === c.employeeId || isAlloc;
            if (!canAccess) return { ok: false, error: 'You do not have access to this project chat.' };
            const recipientIds = [...new Set([project.poc_employeeId, ...resources.map(r => r.employee_employeeId)].filter(Boolean))];
            return { ok: true, c, project, recipientIds };
        };

        this.on('getProjectMessages', async (req) => {
            const { projectId } = req.data;
            const page = Math.max(1, parseInt(req.data.page, 10) || 1);
            const pageSize = Math.min(100, Math.max(1, parseInt(req.data.pageSize, 10) || 50));
            const acc = await _projChatAccess(req, projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });

            const all = await SELECT.from(PROJECT_MESSAGE)
                .where({ project_projectId: projectId })
                .orderBy('sentAt desc', 'messageId desc');
            const total = all.length;
            const start = (page - 1) * pageSize;
            const slice = all.slice(start, start + pageSize);

            const msgIds = slice.map(m => m.messageId);
            let atts = [];
            if (msgIds.length) {
                atts = await SELECT.from(PROJECT_ATTACHMENT)
                    .columns('attachmentId', 'message_messageId', 'fileName', 'mimeType', 'fileSize')
                    .where({ message_messageId: { in: msgIds } });
            }
            const emps = await SELECT.from(EMPLOYEE).columns('employeeId', 'employeeName');
            const nameMap = {}; emps.forEach(e => nameMap[e.employeeId] = e.employeeName);

            const messages = slice.slice().reverse().map(m => ({
                messageId: m.messageId,
                senderId: m.sender_employeeId,
                senderName: nameMap[m.sender_employeeId] || m.sender_employeeId,
                message: m.isDeleted ? '' : (m.message || ''),
                sentAt: m.sentAt,
                editedAt: m.isDeleted ? null : (m.editedAt || null),
                isDeleted: !!m.isDeleted,
                attachments: m.isDeleted ? [] : atts.filter(a => a.message_messageId === m.messageId).map(a => ({
                    attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize
                }))
            }));

            let pinned = null;
            if (acc.project.pinnedMessageId) {
                const pm = all.find(x => x.messageId === acc.project.pinnedMessageId);
                if (pm && !pm.isDeleted) {
                    pinned = {
                        messageId: pm.messageId,
                        senderName: nameMap[pm.sender_employeeId] || pm.sender_employeeId,
                        pinnedByName: acc.project.pinnedByName || '',
                        message: pm.message || ''
                    };
                }
            }

            await markProjectChatReadFn(projectId, acc.c.employeeId);
            return JSON.stringify({ messages, pinned, hasMore: total > start + pageSize, total, page, pageSize });
        });

        this.on('sendProjectMessage', async (req) => {
            const { projectId } = req.data;
            const sMsg = (req.data.message || '').trim();
            const atts = req.data.attachments || [];
            const acc = await _projChatAccess(req, projectId);
            if (!acc.ok) return req.error(403, acc.error);
            if (!sMsg && !atts.length) return req.error(400, 'A message or an attachment is required.');

            const messageId = `${projectId}-PMSG-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
            await INSERT.into(PROJECT_MESSAGE).entries({
                messageId, project_projectId: projectId, sender_employeeId: acc.c.employeeId,
                message: sMsg || null, sentAt: new Date()
            });

            let n = 0;
            for (const a of atts) {
                if (!a || !a.dataBase64) continue;
                let buf;
                try { buf = Buffer.from(String(a.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
                catch (e) { continue; }
                if (buf.length > 10 * 1024 * 1024) return req.error(400, `Attachment "${a.fileName || 'file'}" exceeds the 10 MB limit.`);
                n++;
                await INSERT.into(PROJECT_ATTACHMENT).entries({
                    attachmentId: `${messageId}-PATT-${n}`,
                    message_messageId: messageId,
                    fileName: a.fileName || 'file',
                    mimeType: a.mimeType || 'application/octet-stream',
                    fileSize: buf.length,
                    content: buf
                });
            }

            try {
                await notifyProjectChat(projectId, acc.project.projectName, acc.c.employeeId, acc.recipientIds);
            } catch (e) { cds.log('project').warn('project chat notify failed:', e.message || e); }

            return { messageId };
        });

        this.on('getProjectChatAttachment', async (req) => {
            const { attachmentId } = req.data;
            if (!attachmentId) return req.error(400, 'attachmentId is required.');
            const att = await SELECT.one.from(PROJECT_ATTACHMENT).where({ attachmentId });
            if (!att) return req.error(404, 'Attachment not found.');
            const msg = await SELECT.one.from(PROJECT_MESSAGE).columns('project_projectId').where({ messageId: att.message_messageId });
            if (msg) {
                const acc = await _projChatAccess(req, msg.project_projectId);
                if (!acc.ok) return req.error(403, acc.error);
            }
            const dataBase64 = await binaryToBase64(att.content);
            if (!dataBase64) return req.error(404, 'Attachment has no content.');
            return { fileName: att.fileName, mimeType: att.mimeType || 'application/octet-stream', dataBase64 };
        });

        this.on('markProjectChatRead', async (req) => {
            const c = await projectCaller(req);
            await markProjectChatReadFn(req.data.projectId, c.employeeId);
            return { ok: true };
        });

        this.on('editProjectMessage', async (req) => {
            const { messageId } = req.data;
            const newText = (req.data.message || '').trim();
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            if (!newText) return JSON.stringify({ error: 'Message cannot be empty.' });
            const msg = await SELECT.one.from(PROJECT_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be edited.' });
            const c = await projectCaller(req);
            if (msg.sender_employeeId !== c.employeeId) return JSON.stringify({ error: 'You can only edit your own messages.' });
            await UPDATE(PROJECT_MESSAGE).set({ message: newText, editedAt: new Date() }).where({ messageId });
            return JSON.stringify({ ok: true, messageId });
        });

        this.on('deleteProjectMessage', async (req) => {
            const { messageId } = req.data;
            if (!messageId) return JSON.stringify({ error: 'messageId is required.' });
            const msg = await SELECT.one.from(PROJECT_MESSAGE).where({ messageId });
            if (!msg) return JSON.stringify({ error: 'Message not found.' });
            const c = await projectCaller(req);
            if (msg.sender_employeeId !== c.employeeId) return JSON.stringify({ error: 'You can only delete your own messages.' });
            await UPDATE(PROJECT_MESSAGE).set({ isDeleted: true, message: null, editedAt: new Date() }).where({ messageId });
            await DELETE.from(PROJECT_ATTACHMENT).where({ message_messageId: messageId });
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'pinnedMessageId').where({ projectId: msg.project_projectId });
            if (project && project.pinnedMessageId === messageId) {
                await UPDATE(PROJECT).set({ pinnedMessageId: null, pinnedByName: null }).where({ projectId: msg.project_projectId });
            }
            return JSON.stringify({ ok: true, messageId });
        });

        this.on('pinProjectMessage', async (req) => {
            const { projectId, messageId } = req.data;
            if (!projectId || !messageId) return JSON.stringify({ error: 'projectId and messageId are required.' });
            const acc = await _projChatAccess(req, projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const msg = await SELECT.one.from(PROJECT_MESSAGE).columns('messageId', 'project_projectId', 'isDeleted').where({ messageId });
            if (!msg || msg.project_projectId !== projectId) return JSON.stringify({ error: 'Message not found in this project.' });
            if (msg.isDeleted) return JSON.stringify({ error: 'A deleted message cannot be pinned.' });
            const pinnedBy = (acc.c.emp && acc.c.emp.employeeName) || acc.c.name || acc.c.employeeId || '';
            await UPDATE(PROJECT).set({ pinnedMessageId: messageId, pinnedByName: pinnedBy }).where({ projectId });
            return JSON.stringify({ ok: true, messageId, pinnedByName: pinnedBy });
        });

        this.on('unpinProjectMessage', async (req) => {
            const { projectId } = req.data;
            if (!projectId) return JSON.stringify({ error: 'projectId is required.' });
            const acc = await _projChatAccess(req, projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            await UPDATE(PROJECT).set({ pinnedMessageId: null, pinnedByName: null }).where({ projectId });
            return JSON.stringify({ ok: true });
        });

        // ════════════════════════════════════════════════════════════════════════
        // CLIENT MASTER MANAGEMENT (Founder)
        // ════════════════════════════════════════════════════════════════════════
        this.on('getClientMasters', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can manage clients.' });
            const rows = await SELECT.from(CLIENT_MASTER).orderBy('clientName asc');
            // Attach a project count + total contract value per client.
            const projs = await SELECT.from(PROJECT).columns('projectId', 'client_clientId', 'contractValue');
            const countBy = {}, valueBy = {};
            (projs || []).forEach(p => {
                if (!p.client_clientId) return;
                countBy[p.client_clientId] = (countBy[p.client_clientId] || 0) + 1;
                valueBy[p.client_clientId] = (valueBy[p.client_clientId] || 0) + (Number(p.contractValue) || 0);
            });
            const clients = (rows || []).map(r => ({
                clientId: r.clientId, clientName: r.clientName, companyName: r.companyName,
                clientType: r.clientType, industry: r.industry, website: r.website,
                country: r.country, timeZone: r.timeZone,
                contactPerson: r.contactPerson, designation: r.designation,
                email: r.email, phoneNumber: r.phoneNumber,
                secondaryContactName: r.secondaryContactName, secondaryEmail: r.secondaryEmail,
                secondaryPhone: r.secondaryPhone, billingEmail: r.billingEmail,
                gstNumber: r.gstNumber, billingAddress: r.billingAddress,
                status: r.status, lastLogin: r.lastLogin, notes: r.notes,
                projectCount: countBy[r.clientId] || 0, contractValue: Math.round(valueBy[r.clientId] || 0),
                createdAt: r.createdAt, createdBy: r.createdBy,
                modifiedAt: r.modifiedAt, modifiedBy: r.modifiedBy
            }));
            // Portfolio summary for the Clients dashboard cards.
            const summary = { total: clients.length, active: 0, prospect: 0, inactive: 0, blacklisted: 0, totalContractValue: 0 };
            clients.forEach(cl => {
                const s = String(cl.status || '').toLowerCase();
                if (s === 'active') summary.active++;
                else if (s === 'prospect') summary.prospect++;
                else if (s === 'inactive') summary.inactive++;
                else if (s === 'blacklisted') summary.blacklisted++;
                summary.totalContractValue += cl.contractValue || 0;
            });
            return JSON.stringify({ clients, summary });
        });

        // ── Client validation helpers ─────────────────────────────────────────────
        const CLIENT_TYPES = ['Enterprise', 'SMB', 'Startup', 'Individual', 'Internal'];
        // Full lifecycle (edit-time). Creation is restricted to CREATE_STATUSES so a
        // client can never be born Inactive/Blacklisted.
        const CLIENT_STATUSES = ['Prospect', 'Active', 'Inactive', 'Blacklisted'];
        const CREATE_STATUSES = ['Prospect', 'Active'];

        // Next ClientStatusHistory id (CSH-000001).
        const nextHistoryId = async () => {
            const rows = await SELECT.from(CLIENT_STATUS_HISTORY).columns('historyId');
            let max = 0; (rows || []).forEach(r => { const m = /CSH-(\d+)/.exec(r.historyId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
            return 'CSH-' + String(max + 1).padStart(6, '0');
        };
        const logClientStatusChange = async (clientId, oldStatus, newStatus, reason, changedBy) => {
            if (!oldStatus && !newStatus) return;
            if (oldStatus === newStatus) return;
            await INSERT.into(CLIENT_STATUS_HISTORY).entries({
                historyId: await nextHistoryId(), client_clientId: clientId, clientId,
                oldStatus: oldStatus || '', newStatus: newStatus || '',
                reason: (reason || '').trim(), changedBy: changedBy || '', changedOn: new Date()
            });
        };
        // Gate business operations (new projects / resource allocation / invoices)
        // by client status. Returns an error string when blocked, else null.
        const clientActionBlock = (status) => {
            const s = String(status || '').toLowerCase();
            if (s === 'inactive') return 'This client is inactive and cannot receive new projects or resource allocations.';
            if (s === 'blacklisted') return 'This client has been blacklisted. All business operations are restricted.';
            return null;
        };
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
        // Reduce a phone to comparable digits (drop spaces, dashes, brackets, +).
        const phoneDigits = (s) => (s || '').replace(/[^\d]/g, '');

        // Locate potential duplicates by company name / email / phone. Returns the
        // matched client rows plus which fields collided so the UI can warn.
        const findClientDuplicates = async ({ companyName, email, phoneNumber, excludeId }) => {
            const co = (companyName || '').trim().toLowerCase();
            const em = (email || '').trim().toLowerCase();
            const ph = phoneDigits(phoneNumber);
            const all = await SELECT.from(CLIENT_MASTER)
                .columns('clientId', 'clientName', 'companyName', 'email', 'phoneNumber');
            const matches = [];
            (all || []).forEach(r => {
                if (excludeId && r.clientId === excludeId) return;
                const reasons = [];
                if (co && (r.companyName || '').trim().toLowerCase() === co) reasons.push('company name');
                if (em && (r.email || '').trim().toLowerCase() === em) reasons.push('email');
                if (ph && ph.length >= 7 && phoneDigits(r.phoneNumber) === ph) reasons.push('phone number');
                if (reasons.length) matches.push({ clientId: r.clientId, companyName: r.companyName || r.clientName, email: r.email, reasons });
            });
            return matches;
        };

        this.on('checkClientDuplicate', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can manage clients.' });
            const d = req.data || {};
            const matches = await findClientDuplicates({ companyName: d.companyName, email: d.email, phoneNumber: d.phoneNumber });
            return JSON.stringify({ duplicates: matches });
        });

        this.on('createClientMaster', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can create clients.' });
            const d = req.data || {};
            const t = (v) => (v == null ? '' : String(v)).trim();
            // companyName is the enterprise-facing required field; fall back to the
            // legacy clientName if only that was supplied.
            const companyName = t(d.companyName) || t(d.clientName);
            const email = t(d.email).toLowerCase();
            const phoneNumber = t(d.phoneNumber);
            const website = t(d.website);

            // ── Validation ────────────────────────────────────────────────────────
            if (companyName.length < 2) return JSON.stringify({ error: 'Company Name is required (minimum 2 characters).' });
            if (companyName.length > 100) return JSON.stringify({ error: 'Company Name must be 100 characters or fewer.' });
            if (!t(d.contactPerson)) return JSON.stringify({ error: 'Primary Contact Person is required.' });
            if (!email) return JSON.stringify({ error: 'Email is required (it is the client login identity).' });
            if (!EMAIL_RE.test(email)) return JSON.stringify({ error: 'Please enter a valid email address.' });
            if (!phoneNumber) return JSON.stringify({ error: 'Phone Number is required.' });
            if (website && !URL_RE.test(website)) return JSON.stringify({ error: 'Please enter a valid website URL.' });
            if (d.secondaryEmail && !EMAIL_RE.test(t(d.secondaryEmail).toLowerCase())) return JSON.stringify({ error: 'Secondary email is not a valid email address.' });
            if (d.billingEmail && !EMAIL_RE.test(t(d.billingEmail).toLowerCase())) return JSON.stringify({ error: 'Billing email is not a valid email address.' });

            const clientType = CLIENT_TYPES.includes(t(d.clientType)) ? t(d.clientType) : '';
            // New clients may only be Prospect or Active (default Prospect).
            const status = CREATE_STATUSES.includes(t(d.status)) ? t(d.status) : 'Prospect';

            // ── Hard uniqueness: email is the login identity, always enforced ──────
            const dupE = await SELECT.one.from(CLIENT_MASTER).columns('clientId').where('lower(email) =', email);
            if (dupE) return JSON.stringify({ error: `A client with email ${email} already exists.` });

            // ── Soft duplicate detection (company / phone) — bypassable via force ──
            if (!d.force) {
                const matches = await findClientDuplicates({ companyName, email, phoneNumber });
                if (matches.length) return JSON.stringify({ duplicate: true, duplicates: matches });
            }

            const rows = await SELECT.from(CLIENT_MASTER).columns('clientId');
            let max = 0; (rows || []).forEach(r => { const m = /CLT-(\d+)/.exec(r.clientId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
            const clientId = 'CLT-' + String(max + 1).padStart(4, '0');
            await INSERT.into(CLIENT_MASTER).entries({
                clientId,
                clientName: companyName, companyName,
                clientType, industry: t(d.industry), website, country: t(d.country), timeZone: t(d.timeZone),
                contactPerson: t(d.contactPerson), designation: t(d.designation),
                email, phoneNumber,
                secondaryContactName: t(d.secondaryContactName), secondaryEmail: t(d.secondaryEmail).toLowerCase(), secondaryPhone: t(d.secondaryPhone),
                billingEmail: t(d.billingEmail).toLowerCase(), gstNumber: t(d.gstNumber), billingAddress: t(d.billingAddress),
                status, notes: t(d.notes)
                // createdBy / createdAt populated automatically by the `managed` aspect.
            });
            // Seed the audit trail with the client's initial status.
            await logClientStatusChange(clientId, '', status, 'Client created', c.name || req.user.id);
            return JSON.stringify({ ok: true, clientId, clientName: companyName });
        });

        this.on('updateClientMaster', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can update clients.' });
            const d = req.data || {};
            const existing = await SELECT.one.from(CLIENT_MASTER).where({ clientId: d.clientId });
            if (!existing) return JSON.stringify({ error: 'Client not found.' });
            const set = {};
            const t = (v) => String(v).trim();
            if (d.companyName != null) { set.companyName = t(d.companyName); set.clientName = t(d.companyName); }
            else if (d.clientName != null) { set.clientName = t(d.clientName); set.companyName = t(d.clientName); }
            if (d.clientType != null && (d.clientType === '' || CLIENT_TYPES.includes(t(d.clientType)))) set.clientType = t(d.clientType);
            if (d.industry != null) set.industry = t(d.industry);
            if (d.website != null) { if (d.website && !URL_RE.test(t(d.website))) return JSON.stringify({ error: 'Please enter a valid website URL.' }); set.website = t(d.website); }
            if (d.country != null) set.country = t(d.country);
            if (d.timeZone != null) set.timeZone = t(d.timeZone);
            if (d.contactPerson != null) set.contactPerson = t(d.contactPerson);
            if (d.designation != null) set.designation = t(d.designation);
            if (d.phoneNumber != null) set.phoneNumber = t(d.phoneNumber);
            if (d.secondaryContactName != null) set.secondaryContactName = t(d.secondaryContactName);
            if (d.secondaryEmail != null) { if (d.secondaryEmail && !EMAIL_RE.test(t(d.secondaryEmail).toLowerCase())) return JSON.stringify({ error: 'Secondary email is not a valid email address.' }); set.secondaryEmail = t(d.secondaryEmail).toLowerCase(); }
            if (d.secondaryPhone != null) set.secondaryPhone = t(d.secondaryPhone);
            if (d.billingEmail != null) { if (d.billingEmail && !EMAIL_RE.test(t(d.billingEmail).toLowerCase())) return JSON.stringify({ error: 'Billing email is not a valid email address.' }); set.billingEmail = t(d.billingEmail).toLowerCase(); }
            if (d.gstNumber != null) set.gstNumber = t(d.gstNumber);
            if (d.billingAddress != null) set.billingAddress = t(d.billingAddress);
            // ── Status transition (audited) ───────────────────────────────────────
            let statusChanged = false, oldStatus = existing.status || '', newStatus = oldStatus;
            if (d.status && CLIENT_STATUSES.includes(d.status) && d.status !== oldStatus) {
                set.status = d.status; newStatus = d.status; statusChanged = true;
            }
            if (d.notes != null) set.notes = t(d.notes);
            await UPDATE(CLIENT_MASTER).set(set).where({ clientId: d.clientId });
            // Keep denormalised clientName on projects in sync.
            if (set.clientName) await UPDATE(PROJECT).set({ clientName: set.clientName }).where({ client_clientId: d.clientId });
            if (statusChanged) await logClientStatusChange(d.clientId, oldStatus, newStatus, d.reason, c.name || req.user.id);
            return JSON.stringify({ ok: true, statusChanged, oldStatus, newStatus });
        });

        this.on('deleteClientMaster', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can delete clients.' });
            const clientId = req.data.clientId;
            const existing = await SELECT.one.from(CLIENT_MASTER).columns('clientId', 'companyName', 'clientName', 'status').where({ clientId });
            if (!existing) return JSON.stringify({ error: 'Client not found.' });
            // Referential safety: never orphan projects.
            const projCount = await SELECT.from(PROJECT).columns('projectId').where({ client_clientId: clientId });
            if ((projCount || []).length) return JSON.stringify({ error: `This client has ${projCount.length} project(s) and cannot be deleted. Mark it Inactive or Blacklisted instead.` });
            await logClientStatusChange(clientId, existing.status || '', 'Deleted', req.data.reason || 'Client deleted', c.name || req.user.id);
            await DELETE.from(CLIENT_MASTER).where({ clientId });
            return JSON.stringify({ ok: true });
        });

        this.on('getClientStatusHistory', async (req) => {
            const c = await projectCaller(req);
            if (!isFounderCaller(req, c)) return JSON.stringify({ error: 'Only the Founder can view client history.' });
            const rows = await SELECT.from(CLIENT_STATUS_HISTORY).where({ clientId: req.data.clientId }).orderBy('changedOn desc');
            return JSON.stringify({
                history: (rows || []).map(r => ({
                    historyId: r.historyId, oldStatus: r.oldStatus, newStatus: r.newStatus,
                    reason: r.reason, changedBy: r.changedBy, changedOn: r.changedOn
                }))
            });
        });

        // ════════════════════════════════════════════════════════════════════════
        // REQUIREMENTS — internal visibility & handling (Founder / POC / employee)
        // ════════════════════════════════════════════════════════════════════════

        // Resolve a requirement and whether THIS caller may act on it.
        const _reqAccess = async (req, requirementId) => {
            const c = await projectCaller(req);
            const reqRow = await SELECT.one.from(REQUIREMENT).where({ requirementId });
            if (!reqRow) return { ok: false, error: 'Requirement not found.' };
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId').where({ projectId: reqRow.project_projectId });
            const isFounder = isFounderCaller(req, c);
            const isPoc = project && project.poc_employeeId === c.employeeId;
            const isAssignee = reqRow.assignedTo_employeeId && reqRow.assignedTo_employeeId === c.employeeId;
            if (!isFounder && !isPoc && !isAssignee) return { ok: false, error: 'You do not have access to this requirement.' };
            return { ok: true, c, reqRow, project, isFounder, isPoc, isAssignee };
        };

        this.on('getRequirementsInbox', async (req) => {
            const c = await projectCaller(req);
            const isFounder = isFounderCaller(req, c);
            const filter = (req.data.filter || 'all').toLowerCase();
            // Scope: founder = all; otherwise requirements where caller is POC or assignee.
            let reqs = await SELECT.from(REQUIREMENT).orderBy('createdAt desc');
            if (!isFounder) {
                const pocProjects = await SELECT.from(PROJECT).columns('projectId').where({ poc_employeeId: c.employeeId });
                const pocSet = new Set((pocProjects || []).map(p => p.projectId));
                reqs = (reqs || []).filter(r => pocSet.has(r.project_projectId) || r.assignedTo_employeeId === c.employeeId);
            }
            const now = Date.now();
            const list = (reqs || []).map(r => {
                const ageDays = r.createdAt ? Math.floor((now - new Date(r.createdAt).getTime()) / 86400000) : 0;
                const open = !['Approved', 'Closed', 'Rejected'].includes(r.status);
                const overdue = open && r.expectedDeliveryDate && String(r.expectedDeliveryDate) < new Date().toISOString().slice(0, 10);
                return {
                    requirementId: r.requirementId, projectId: r.project_projectId, title: r.title,
                    clientName: r.clientName || '', priority: r.priority, status: r.status,
                    category: r.category, module: r.module,
                    assignedToId: r.assignedTo_employeeId || '', assignedToName: r.assignedToName || '',
                    expectedDeliveryDate: r.expectedDeliveryDate, createdAt: r.createdAt, ageDays, open, overdue
                };
            });
            let filtered = list;
            if (filter === 'pending') filtered = list.filter(r => r.open);
            else if (filter === 'mine') filtered = list.filter(r => r.assignedToId === c.employeeId);
            else if (filter === 'awaiting-review') filtered = list.filter(r => r.status === 'Awaiting Client Review');
            else if (filter === 'overdue') filtered = list.filter(r => r.overdue);
            const counts = {
                all: list.length, pending: list.filter(r => r.open).length,
                mine: list.filter(r => r.assignedToId === c.employeeId).length,
                awaitingReview: list.filter(r => r.status === 'Awaiting Client Review').length,
                overdue: list.filter(r => r.overdue).length
            };
            return JSON.stringify({ requirements: filtered, counts, isFounder });
        });

        this.on('getProjectRequirements', async (req) => {
            const c = await projectCaller(req);
            const { projectId } = req.data;
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'poc_employeeId').where({ projectId });
            if (!project) return JSON.stringify({ error: 'Project not found.' });
            if (!isFounderCaller(req, c) && project.poc_employeeId !== c.employeeId) {
                // allow allocated employees to see the project's requirements they're assigned
                const reqs0 = await SELECT.from(REQUIREMENT).where({ project_projectId: projectId, assignedTo_employeeId: c.employeeId });
                return JSON.stringify({ requirements: (reqs0 || []).map(r => ({ requirementId: r.requirementId, title: r.title, status: r.status, priority: r.priority, assignedToName: r.assignedToName })) });
            }
            const reqs = await SELECT.from(REQUIREMENT).where({ project_projectId: projectId }).orderBy('createdAt desc');
            return JSON.stringify({
                requirements: (reqs || []).map(r => ({
                    requirementId: r.requirementId, title: r.title, status: r.status, priority: r.priority,
                    assignedToId: r.assignedTo_employeeId || '', assignedToName: r.assignedToName || '',
                    category: r.category, expectedDeliveryDate: r.expectedDeliveryDate, createdAt: r.createdAt
                }))
            });
        });

        this.on('getRequirementDetail', async (req) => {
            const acc = await _reqAccess(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const detail = await buildRequirementDetailJSON(acc.reqRow);
            detail.canAssign = acc.isFounder || acc.isPoc;
            detail.canUpdateStatus = acc.isFounder || acc.isPoc || acc.isAssignee;
            return JSON.stringify(detail);
        });

        this.on('assignRequirement', async (req) => {
            const acc = await _reqAccess(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            if (!acc.isFounder && !acc.isPoc) return JSON.stringify({ error: 'Only the Founder or project POC can assign requirements.' });
            const employeeId = req.data.employeeId;
            const alloc = await SELECT.one.from(PROJECT_RESOURCE).columns('allocationId').where({ project_projectId: acc.reqRow.project_projectId, employee_employeeId: employeeId });
            const isProjectPoc = acc.project && acc.project.poc_employeeId === employeeId;
            if (!alloc && !isProjectPoc) return JSON.stringify({ error: 'You can only assign to the POC or an employee allocated to this project.' });
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName', 'email').where({ employeeId });
            if (!emp) return JSON.stringify({ error: 'Employee not found.' });
            const newStatus = ['New', 'Assigned'].includes(acc.reqRow.status) ? 'Assigned' : acc.reqRow.status;
            await UPDATE(REQUIREMENT).set({
                assignedTo_employeeId: employeeId, assignedToName: emp.employeeName || employeeId,
                assignedByName: acc.c.name || 'Internal', assignedDate: new Date(), status: newStatus
            }).where({ requirementId: acc.reqRow.requirementId });
            await reqAudit(acc.reqRow.requirementId, acc.c.name, 'Assigned', acc.reqRow.assignedToName || '—', emp.employeeName);
            const clientRow = await SELECT.one.from(CLIENT_MASTER).where({ clientId: acc.reqRow.client_clientId });
            await notifyRequirement({ ...acc.reqRow, assignedTo_employeeId: employeeId }, acc.project, clientRow,
                'Requirement Assigned', `Requirement "${acc.reqRow.title}" has been assigned to ${emp.employeeName}.`, 'REQUIREMENT_ASSIGNED');
            return JSON.stringify({ ok: true });
        });

        this.on('updateRequirementStatus', async (req) => {
            const acc = await _reqAccess(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const status = req.data.status;
            // Internal users drive the workflow up to "Awaiting Client Review".
            // Approved / Rejected are client-only decisions (reviewRequirement).
            const INTERNAL_ALLOWED = ['Assigned', 'Under Analysis', 'In Development', 'Under Testing', 'Awaiting Client Review'];
            if (!INTERNAL_ALLOWED.includes(status)) return JSON.stringify({ error: 'That status cannot be set here. Approval/closure is decided by the client.' });
            const old = acc.reqRow.status;
            await UPDATE(REQUIREMENT).set({ status }).where({ requirementId: acc.reqRow.requirementId });
            await reqAudit(acc.reqRow.requirementId, acc.c.name, 'Status Changed', old, status);
            const clientRow = await SELECT.one.from(CLIENT_MASTER).where({ clientId: acc.reqRow.client_clientId });
            await notifyRequirement(acc.reqRow, acc.project, clientRow,
                'Requirement Status Updated', `Requirement "${acc.reqRow.title}" is now "${status}".`, 'REQUIREMENT_STATUS');
            return JSON.stringify({ ok: true, status });
        });

        this.on('addRequirementComment', async (req) => {
            const acc = await _reqAccess(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const role = acc.isFounder ? 'founder' : (acc.isPoc ? 'poc' : 'employee');
            try {
                const commentId = await addRequirementCommentRow(acc.reqRow.requirementId, {
                    authorName: acc.c.name, authorRole: role, authorEmployeeId: acc.c.employeeId,
                    message: req.data.message, fileName: req.data.fileName, mimeType: req.data.mimeType, dataBase64: req.data.dataBase64
                });
                await reqAudit(acc.reqRow.requirementId, acc.c.name, 'Comment Added', null, null);
                const clientRow = await SELECT.one.from(CLIENT_MASTER).where({ clientId: acc.reqRow.client_clientId });
                await notifyRequirement(acc.reqRow, acc.project, clientRow,
                    'New Requirement Comment', `${acc.c.name} commented on "${acc.reqRow.title}".`, 'REQUIREMENT_COMMENT');
                return JSON.stringify({ ok: true, commentId });
            } catch (e) { return JSON.stringify({ error: e.message }); }
        });

        this.on('getRequirementCommentAttachment', async (req) => {
            const cmt = await SELECT.one.from(REQUIREMENT_COMMENT).where({ commentId: req.data.commentId });
            if (!cmt) return req.error(404, 'Comment not found.');
            const acc = await _reqAccess(req, cmt.requirement_requirementId);
            if (!acc.ok) return req.error(403, acc.error);
            const dataBase64 = await binaryToBase64(cmt.attachment);
            if (!dataBase64) return req.error(404, 'No attachment.');
            return { fileName: cmt.attachmentName, mimeType: cmt.attachmentMimeType || 'application/octet-stream', dataBase64 };
        });

        this.on('getRequirementAttachment', async (req) => {
            const att = await SELECT.one.from(REQUIREMENT_ATTACHMENT).where({ attachmentId: req.data.attachmentId });
            if (!att) return req.error(404, 'Attachment not found.');
            const acc = await _reqAccess(req, att.requirement_requirementId);
            if (!acc.ok) return req.error(403, acc.error);
            const dataBase64 = await binaryToBase64(att.content);
            if (!dataBase64) return req.error(404, 'No content.');
            return { fileName: att.fileName, mimeType: att.mimeType || 'application/octet-stream', dataBase64 };
        });

        return super.init();
    }
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT SERVICE — external customer portal. Every handler resolves the caller's
// clientId and refuses any data that does not belong to it (backend isolation).
// ════════════════════════════════════════════════════════════════════════════
class ClientService extends cds.ApplicationService {
    async init() {
        // Load the requirement + verify it belongs to the calling client.
        const _ownReq = async (req, requirementId) => {
            const cc = await clientCaller(req);
            if (!cc.clientId) return { ok: false, error: 'Client account not recognised.' };
            if (!cc.active) return { ok: false, error: 'Your client account is inactive.' };
            const reqRow = await SELECT.one.from(REQUIREMENT).where({ requirementId });
            if (!reqRow) return { ok: false, error: 'Requirement not found.' };
            if (reqRow.client_clientId !== cc.clientId) return { ok: false, error: 'You do not have access to this requirement.' };
            const project = await SELECT.one.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId').where({ projectId: reqRow.project_projectId });
            return { ok: true, cc, reqRow, project };
        };
        // Verify a project belongs to the calling client.
        const _ownProject = async (req, projectId) => {
            const cc = await clientCaller(req);
            if (!cc.clientId) return { ok: false, error: 'Client account not recognised.' };
            if (!cc.active) return { ok: false, error: 'Your client account is inactive.' };
            const project = await SELECT.one.from(PROJECT).where({ projectId });
            if (!project) return { ok: false, error: 'Project not found.' };
            if (project.client_clientId !== cc.clientId) return { ok: false, error: 'You do not have access to this project.' };
            return { ok: true, cc, project };
        };

        // ── Dashboard ───────────────────────────────────────────────────────────
        this.on('getClientDashboard', async (req) => {
            const cc = await clientCaller(req);
            if (!cc.clientId) return JSON.stringify({ error: 'Client account not recognised.' });
            const projects = await SELECT.from(PROJECT).where({ client_clientId: cc.clientId }).orderBy('createdAt desc');
            const pids = (projects || []).map(p => p.projectId);
            // Progress per project (weighted task progress — reuse projectProgress).
            const projOut = [];
            let pendingReqs = 0, openChanges = 0;
            const allReqs = pids.length ? await SELECT.from(REQUIREMENT).where({ project_projectId: { in: pids } }) : [];
            for (const p of (projects || [])) {
                const tasks = await SELECT.from(PROJECT_TASK).columns('status', 'estimatedHours').where({ project_projectId: p.projectId });
                projOut.push({
                    projectId: p.projectId, projectName: p.projectName,
                    currentPhase: p.currentPhase || p.status, status: p.status,
                    progress: projectProgress(tasks), pocName: p.pocName || '—',
                    updatedAt: p.modifiedAt || p.createdAt
                });
            }
            (allReqs || []).forEach(r => {
                if (!['Approved', 'Closed', 'Rejected'].includes(r.status)) pendingReqs++;
                if (r.status === 'Awaiting Client Review') openChanges++;
            });
            const tiles = {
                totalProjects: projects.length,
                activeProjects: (projects || []).filter(p => p.status === 'Active').length,
                completedProjects: (projects || []).filter(p => p.status === 'Completed').length,
                pendingRequirements: pendingReqs,
                awaitingReview: openChanges
            };
            return JSON.stringify({ clientName: cc.clientName, contactPerson: cc.contactPerson, tiles, projects: projOut });
        });

        // ── Project detail (overview + read-only team) ────────────────────────────
        this.on('getClientProjectDetail', async (req) => {
            const acc = await _ownProject(req, req.data.projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const p = acc.project;
            const tasks = await SELECT.from(PROJECT_TASK).columns('status', 'estimatedHours').where({ project_projectId: p.projectId });
            // Read-only team list (name + designation + project role). NO bandwidth,
            // NO cost, NO internal data is exposed to the client.
            const resources = await SELECT.from(PROJECT_RESOURCE).columns('employee_employeeId', 'employeeName', 'department').where({ project_projectId: p.projectId });
            const empIds = (resources || []).map(r => r.employee_employeeId);
            const emps = empIds.length ? await SELECT.from(EMPLOYEE).columns('employeeId', 'designation').where({ employeeId: { in: empIds } }) : [];
            const desgBy = {}; (emps || []).forEach(e => desgBy[e.employeeId] = e.designation);
            const team = (resources || []).map(r => ({
                employeeName: r.employeeName,
                designation: desgBy[r.employee_employeeId] || '',
                roleInProject: r.employee_employeeId === p.poc_employeeId ? 'Project POC' : 'Team Member'
            }));
            if (p.poc_employeeId && !team.some(t => t.roleInProject === 'Project POC')) {
                const pocEmp = await SELECT.one.from(EMPLOYEE).columns('designation').where({ employeeId: p.poc_employeeId });
                team.unshift({ employeeName: p.pocName || 'POC', designation: pocEmp ? pocEmp.designation : '', roleInProject: 'Project POC' });
            }
            // Assignable people (id + name) for the client's requirement dropdown —
            // the POC plus allocated employees of THIS project only.
            const assignables = [];
            if (p.poc_employeeId) assignables.push({ employeeId: p.poc_employeeId, employeeName: (p.pocName || 'POC') + ' (POC)' });
            (resources || []).forEach(r => {
                if (r.employee_employeeId !== p.poc_employeeId) assignables.push({ employeeId: r.employee_employeeId, employeeName: r.employeeName });
            });
            return JSON.stringify({
                project: {
                    projectId: p.projectId, projectName: p.projectName, description: p.description,
                    currentPhase: p.currentPhase || p.status, status: p.status,
                    startDate: p.startDate, endDate: p.endDate, progress: projectProgress(tasks), pocName: p.pocName || '—'
                },
                team, assignables
            });
        });

        // ── Requirements list ─────────────────────────────────────────────────────
        this.on('getClientRequirements', async (req) => {
            const acc = await _ownProject(req, req.data.projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const filter = (req.data.filter || 'all').toLowerCase();
            const reqs = await SELECT.from(REQUIREMENT).where({ project_projectId: acc.project.projectId }).orderBy('createdAt desc');
            const list = (reqs || []).map(r => ({
                requirementId: r.requirementId, title: r.title, priority: r.priority, status: r.status,
                category: r.category, module: r.module, assignedToName: r.assignedToName || '—',
                expectedDeliveryDate: r.expectedDeliveryDate, createdAt: r.createdAt
            }));
            let filtered = list;
            if (filter === 'open') filtered = list.filter(r => !['Approved', 'Closed', 'Rejected'].includes(r.status));
            else if (filter === 'awaiting-review') filtered = list.filter(r => r.status === 'Awaiting Client Review');
            else if (filter === 'approved') filtered = list.filter(r => r.status === 'Approved' || r.status === 'Closed');
            return JSON.stringify({ requirements: filtered, projectName: acc.project.projectName });
        });

        this.on('getClientRequirementDetail', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const detail = await buildRequirementDetailJSON(acc.reqRow);
            detail.canReview = acc.reqRow.status === 'Awaiting Client Review';
            return JSON.stringify(detail);
        });

        // ── Create requirement (optionally assign immediately) ──────────────────────
        this.on('createRequirement', async (req) => {
            const acc = await _ownProject(req, req.data.projectId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const d = req.data || {};
            const title = (d.title || '').trim();
            if (!title) return JSON.stringify({ error: 'Requirement Title is required.' });
            if (!(d.description || '').trim()) return JSON.stringify({ error: 'Requirement Description is required.' });
            const requirementId = await nextRequirementId(acc.project.projectId);

            // Optional immediate assignment — must be the POC or an allocated employee.
            let assignedToId = null, assignedToName = null, status = 'New';
            if (d.assignedToId) {
                const alloc = await SELECT.one.from(PROJECT_RESOURCE).columns('allocationId').where({ project_projectId: acc.project.projectId, employee_employeeId: d.assignedToId });
                const isProjectPoc = acc.project.poc_employeeId === d.assignedToId;
                if (!alloc && !isProjectPoc) return JSON.stringify({ error: 'You can only assign to the POC or an employee on this project.' });
                const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId: d.assignedToId });
                if (emp) { assignedToId = emp.employeeId; assignedToName = emp.employeeName; status = 'Assigned'; }
            }
            await INSERT.into(REQUIREMENT).entries({
                requirementId, project_projectId: acc.project.projectId, client_clientId: acc.cc.clientId,
                title, description: (d.description || '').trim(),
                businessJustification: (d.businessJustification || '').trim(),
                priority: ['Critical', 'High', 'Medium', 'Low'].includes(d.priority) ? d.priority : 'Medium',
                expectedDeliveryDate: d.expectedDeliveryDate || null,
                category: (d.category || '').trim(), module: (d.module || '').trim(), remarks: (d.remarks || '').trim(),
                clientName: acc.cc.clientName,
                assignedTo_employeeId: assignedToId, assignedToName,
                assignedByName: assignedToId ? acc.cc.contactPerson || acc.cc.clientName : null,
                assignedDate: assignedToId ? new Date() : null,
                status
            });
            await reqAudit(requirementId, acc.cc.contactPerson || acc.cc.clientName, 'Created', null, title);
            if (assignedToId) await reqAudit(requirementId, acc.cc.contactPerson || acc.cc.clientName, 'Assigned', null, assignedToName);
            // Notify POC (+ assignee if any).
            const reqRow = { requirementId, assignedTo_employeeId: assignedToId, title };
            await notifyRequirement(reqRow, acc.project, null,
                'New Client Requirement', `${acc.cc.clientName} raised a requirement "${title}" on ${acc.project.projectName}.`, 'REQUIREMENT_CREATED');
            return JSON.stringify({ ok: true, requirementId });
        });

        this.on('assignClientRequirement', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const employeeId = req.data.employeeId;
            const alloc = await SELECT.one.from(PROJECT_RESOURCE).columns('allocationId').where({ project_projectId: acc.reqRow.project_projectId, employee_employeeId: employeeId });
            const isProjectPoc = acc.project && acc.project.poc_employeeId === employeeId;
            if (!alloc && !isProjectPoc) return JSON.stringify({ error: 'You can only assign to the POC or an employee on this project.' });
            const emp = await SELECT.one.from(EMPLOYEE).columns('employeeId', 'employeeName').where({ employeeId });
            if (!emp) return JSON.stringify({ error: 'Employee not found.' });
            const newStatus = ['New'].includes(acc.reqRow.status) ? 'Assigned' : acc.reqRow.status;
            await UPDATE(REQUIREMENT).set({
                assignedTo_employeeId: employeeId, assignedToName: emp.employeeName,
                assignedByName: acc.cc.contactPerson || acc.cc.clientName, assignedDate: new Date(), status: newStatus
            }).where({ requirementId: acc.reqRow.requirementId });
            await reqAudit(acc.reqRow.requirementId, acc.cc.contactPerson || acc.cc.clientName, 'Assigned', acc.reqRow.assignedToName || '—', emp.employeeName);
            await notifyRequirement({ ...acc.reqRow, assignedTo_employeeId: employeeId }, acc.project, null,
                'Requirement Assigned', `${acc.cc.clientName} assigned "${acc.reqRow.title}" to ${emp.employeeName}.`, 'REQUIREMENT_ASSIGNED');
            return JSON.stringify({ ok: true });
        });

        // ── Attachments ─────────────────────────────────────────────────────────────
        this.on('uploadRequirementAttachment', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const d = req.data || {};
            if (!d.dataBase64) return JSON.stringify({ error: 'No file content.' });
            let buf;
            try { buf = Buffer.from(String(d.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
            catch (e) { return JSON.stringify({ error: 'Invalid file content.' }); }
            if (buf.length > 10 * 1024 * 1024) return JSON.stringify({ error: 'Attachment exceeds the 10 MB limit.' });
            const existing = await SELECT.from(REQUIREMENT_ATTACHMENT).columns('attachmentId').where({ requirement_requirementId: acc.reqRow.requirementId });
            const n = (existing || []).length + 1;
            await INSERT.into(REQUIREMENT_ATTACHMENT).entries({
                attachmentId: `${acc.reqRow.requirementId}-ATT-${n}`,
                requirement_requirementId: acc.reqRow.requirementId,
                fileName: d.fileName || 'file', mimeType: d.mimeType || 'application/octet-stream',
                fileSize: buf.length, version: n, uploadedByName: acc.cc.contactPerson || acc.cc.clientName, content: buf
            });
            await reqAudit(acc.reqRow.requirementId, acc.cc.contactPerson || acc.cc.clientName, 'Document Uploaded', null, d.fileName || 'file');
            return JSON.stringify({ ok: true });
        });

        this.on('getRequirementAttachment', async (req) => {
            const att = await SELECT.one.from(REQUIREMENT_ATTACHMENT).where({ attachmentId: req.data.attachmentId });
            if (!att) return req.error(404, 'Attachment not found.');
            const acc = await _ownReq(req, att.requirement_requirementId);
            if (!acc.ok) return req.error(403, acc.error);
            const dataBase64 = await binaryToBase64(att.content);
            if (!dataBase64) return req.error(404, 'No content.');
            return { fileName: att.fileName, mimeType: att.mimeType || 'application/octet-stream', dataBase64 };
        });

        // ── Discussion ────────────────────────────────────────────────────────────────
        this.on('getRequirementComments', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const comments = await SELECT.from(REQUIREMENT_COMMENT).where({ requirement_requirementId: acc.reqRow.requirementId }).orderBy('createdAt asc');
            return JSON.stringify({
                comments: (comments || []).map(c => ({
                    commentId: c.commentId, authorName: c.authorName, authorRole: c.authorRole,
                    message: c.isDeleted ? '' : (c.message || ''), isDeleted: !!c.isDeleted,
                    hasAttachment: !!c.attachmentName, attachmentName: c.attachmentName || '', at: c.createdAt,
                    isMine: c.authorRole === 'client'
                }))
            });
        });

        this.on('addRequirementComment', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            try {
                const commentId = await addRequirementCommentRow(acc.reqRow.requirementId, {
                    authorName: acc.cc.contactPerson || acc.cc.clientName, authorRole: 'client', authorEmployeeId: null,
                    message: req.data.message, fileName: req.data.fileName, mimeType: req.data.mimeType, dataBase64: req.data.dataBase64
                });
                await reqAudit(acc.reqRow.requirementId, acc.cc.contactPerson || acc.cc.clientName, 'Comment Added', null, null);
                await notifyRequirement(acc.reqRow, acc.project, null,
                    'New Requirement Comment', `${acc.cc.clientName} commented on "${acc.reqRow.title}".`, 'REQUIREMENT_COMMENT');
                return JSON.stringify({ ok: true, commentId });
            } catch (e) { return JSON.stringify({ error: e.message }); }
        });

        this.on('getRequirementCommentAttachment', async (req) => {
            const cmt = await SELECT.one.from(REQUIREMENT_COMMENT).where({ commentId: req.data.commentId });
            if (!cmt) return req.error(404, 'Comment not found.');
            const acc = await _ownReq(req, cmt.requirement_requirementId);
            if (!acc.ok) return req.error(403, acc.error);
            const dataBase64 = await binaryToBase64(cmt.attachment);
            if (!dataBase64) return req.error(404, 'No attachment.');
            return { fileName: cmt.attachmentName, mimeType: cmt.attachmentMimeType || 'application/octet-stream', dataBase64 };
        });

        // ── Approval (client decision on "Awaiting Client Review") ──────────────────────
        this.on('reviewRequirement', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            if (acc.reqRow.status !== 'Awaiting Client Review') return JSON.stringify({ error: 'This requirement is not awaiting your review.' });
            const decision = (req.data.decision || '').toLowerCase();
            const comments = (req.data.comments || '').trim();
            if (!comments) return JSON.stringify({ error: 'Approval comments are mandatory.' });
            let newStatus;
            if (decision === 'approve') newStatus = 'Approved';
            else if (decision === 'reject') newStatus = 'Rejected';
            else if (decision === 'changes') newStatus = 'In Development';
            else return JSON.stringify({ error: 'Invalid decision.' });
            const set = { status: newStatus, approvalComments: comments };
            if (newStatus === 'Approved') set.closedAt = new Date();
            await UPDATE(REQUIREMENT).set(set).where({ requirementId: acc.reqRow.requirementId });
            const actionLabel = newStatus === 'Approved' ? 'Approved' : (newStatus === 'Rejected' ? 'Rejected' : 'Changes Requested');
            await reqAudit(acc.reqRow.requirementId, acc.cc.contactPerson || acc.cc.clientName, actionLabel, 'Awaiting Client Review', newStatus);
            await notifyRequirement(acc.reqRow, acc.project, null,
                `Requirement ${actionLabel}`, `${acc.cc.clientName} ${actionLabel.toLowerCase()} "${acc.reqRow.title}": ${comments}`, 'REQUIREMENT_REVIEW');
            return JSON.stringify({ ok: true, status: newStatus });
        });

        this.on('getRequirementHistory', async (req) => {
            const acc = await _ownReq(req, req.data.requirementId);
            if (!acc.ok) return JSON.stringify({ error: acc.error });
            const history = await SELECT.from(REQUIREMENT_AUDIT).where({ requirement_requirementId: acc.reqRow.requirementId }).orderBy('at asc');
            return JSON.stringify({ history: (history || []).map(h => ({ action: h.action, userName: h.userName, oldValue: h.oldValue, newValue: h.newValue, at: h.at })) });
        });

        return super.init();
    }
}

module.exports = { EmployeeService, ManagerService, HRService, FounderService, ProjectService, ClientService };
cds.on('served', () => startReminderCron(getMailer, createNotification));