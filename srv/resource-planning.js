// ══════════════════════════════════════════════════════════════════════════════
// Resource Planning & Recommendation engine (additive module).
//
// All heavy calculation (utilization, availability forecasting, recommendation
// scoring, KPIs) happens here in ONE bulk pass over the data — no per-employee
// DB round-trips and no frontend loops — so the Resource Allocation screen,
// recommendations and dashboard KPIs stay performant on large datasets.
//
// Capacity model (per employee, current calendar month):
//   effectiveCapacityHours = monthlyCapacityHours
//                            − approvedLeaveHours      (LeaveRequest, live)
//                            − trainingHours           (monthlyTrainingHours)
//                            − internalMeetingHours    (Meeting/MeetingParticipant, live)
//   allocatedHours         = Σ bandwidth% × monthlyCapacityHours over ACTIVE projects
//   freeHours              = effectiveCapacityHours − allocatedHours
//   utilizationPct         = allocatedHours / effectiveCapacityHours × 100
//
// Existing allocations (null start/end dates, no skills) remain fully valid:
// null dates → counted for the whole project; missing capacity fields default
// to 160h working / 0 training, exactly reproducing the pre-feature calc.
// ══════════════════════════════════════════════════════════════════════════════
const cds = require('@sap/cds');

const N = 'ccentrik.employee.timesheet.schema.timesheet.';
const EMPLOYEE = N + 'EmployeeMaster';
const LEAVE_REQUEST = N + 'LeaveRequest';
const PROJECT = N + 'Project';
const PROJECT_RESOURCE = N + 'ProjectResource';
const MEETING = N + 'Meeting';
const MEETING_PARTICIPANT = N + 'MeetingParticipant';
const HOLIDAY = N + 'HolidayMaster';
const COMPANY_EVENT = N + 'CompanyEvent';
const CONFIG = N + 'ResourcePlanningConfig';

const ACTIVE_PROJECT_STATUSES = ['Planning', 'Active', 'On Hold'];
const HOURS_PER_LEAVE_DAY = 8;
const DEFAULT_MONTHLY_CAPACITY = 160;

// ── Centralized config (single source of truth) ──────────────────────────────
// Recommendation weights, utilization threshold, working-time basis and the
// non-billable reserve all come from here — never hardcoded. Safe defaults are
// returned when no row exists so the engine works before admin setup.
const CONFIG_DEFAULTS = {
    skillWeight: 40, availabilityWeight: 30, experienceWeight: 15, certificationWeight: 10,
    previousProjectWeight: 5, utilizationWeight: 0,
    maxUtilizationThreshold: 100, standardDailyHours: 8, standardWorkingDays: 20, nonBillablePct: 0,
    monthlyOverhead: 10000
};
async function loadConfig() {
    try {
        const row = await SELECT.one.from(CONFIG).where({ configId: 'GLOBAL' });
        if (!row) return { ...CONFIG_DEFAULTS };
        return {
            skillWeight: Number(row.skillWeight) || 0,
            availabilityWeight: Number(row.availabilityWeight) || 0,
            utilizationWeight: Number(row.utilizationWeight) || 0,
            experienceWeight: Number(row.experienceWeight) || 0,
            certificationWeight: row.certificationWeight != null ? Number(row.certificationWeight) : 10,
            previousProjectWeight: row.previousProjectWeight != null ? Number(row.previousProjectWeight) : 5,
            maxUtilizationThreshold: Number(row.maxUtilizationThreshold) || 100,
            standardDailyHours: Number(row.standardDailyHours) || 8,
            standardWorkingDays: Number(row.standardWorkingDays) || 20,
            nonBillablePct: Number(row.nonBillablePct) || 0,
            monthlyOverhead: row.monthlyOverhead != null ? Number(row.monthlyOverhead) : 10000
        };
    } catch (e) { return { ...CONFIG_DEFAULTS }; }
}

// Fully-loaded internal cost RATE per hour (PM-safe — never exposes salary):
//   (monthlySalary + monthlyOverhead) / monthlyCapacityHours
// Falls back to hourlyCost + overhead/capacity when only hourlyCost is set, and
// returns 0 gracefully when no salary/cost is on file.
function loadedHourlyRate(salaryRow, capacityHours, monthlyOverhead) {
    const cap = Number(capacityHours) > 0 ? Number(capacityHours) : DEFAULT_MONTHLY_CAPACITY;
    const oh = Number(monthlyOverhead) || 0;
    const monthly = salaryRow ? Number(salaryRow.monthlySalary) || 0 : 0;
    const base = monthly > 0 ? monthly / cap : (salaryRow ? Number(salaryRow.hourlyCost) || 0 : 0);
    if (base <= 0) return 0;                       // no salary on file → no cost
    return Math.round((base + oh / cap) * 100) / 100;
}

// Salary-only "Cost Per Hour" (PM-safe — a rate, never the salary itself), WITHOUT
// overhead. Used by the redesigned Manage-Resources estimate, where the ₹/month
// miscellaneous overhead is added as a separate flat line:
//   Estimated Cost = (allocatedHours × baseHourlyRate) + (projectMonths × monthlyOverhead)
function baseHourlyRate(salaryRow, capacityHours) {
    const cap = Number(capacityHours) > 0 ? Number(capacityHours) : DEFAULT_MONTHLY_CAPACITY;
    const monthly = salaryRow ? Number(salaryRow.monthlySalary) || 0 : 0;
    const rate = monthly > 0 ? monthly / cap : (salaryRow ? Number(salaryRow.hourlyCost) || 0 : 0);
    return Math.round(rate * 100) / 100;
}

// ── Skill helpers ───────────────────────────────────────────────────────────
// Tags are comma-separated free text; normalise to a lower-cased set so
// "Node.js" matches "node.js " regardless of spacing/case.
function parseSkills(s) {
    return [...new Set(String(s || '')
        .split(/[,;]/).map(x => x.trim().toLowerCase()).filter(Boolean))];
}
// Fraction (0..1) of the project's required skills the employee possesses.
// No required skills → neutral 1 (skill is not a differentiator).
function skillMatchRatio(requiredSkills, employeeSkills) {
    const req = parseSkills(requiredSkills);
    if (!req.length) return { ratio: 1, matched: [], missing: [] };
    const have = new Set(parseSkills(employeeSkills));
    const matched = req.filter(r => have.has(r));
    return { ratio: matched.length / req.length, matched, missing: req.filter(r => !have.has(r)) };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function monthWindow(ref) {
    const d = ref ? new Date(ref) : new Date();
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); // last day
    return { start, end, startStr: start.toISOString().slice(0, 10), endStr: end.toISOString().slice(0, 10) };
}
function toDate(v) { return v ? new Date(v) : null; }
// Overlap (in days, inclusive) between [aS,aE] and [bS,bE].
function overlapDays(aS, aE, bS, bE) {
    const s = aS > bS ? aS : bS;
    const e = aE < bE ? aE : bE;
    if (e < s) return 0;
    return Math.round((e - s) / 86400000) + 1;
}

// All calendar-month windows between two dates (inclusive of both months).
function monthsInRange(fromStr, toStr) {
    const f = new Date(fromStr), t = new Date(toStr);
    const out = [];
    let y = f.getUTCFullYear(), m = f.getUTCMonth();
    const endY = t.getUTCFullYear(), endM = t.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
        out.push(monthWindow(new Date(Date.UTC(y, m, 15))));
        m++; if (m > 11) { m = 0; y++; }
        if (out.length > 60) break; // safety cap (5 years)
    }
    return out;
}
// Working (business) days of [rangeStart,rangeEnd] that fall inside a month window,
// excluding weekends and the supplied holiday set (YYYY-MM-DD strings).
function workingDaysInWindow(rangeStart, rangeEnd, win, holidaySet) {
    const s = rangeStart > win.start ? rangeStart : win.start;
    const e = rangeEnd < win.end ? rangeEnd : win.end;
    if (e < s) return 0;
    let count = 0;
    for (let d = new Date(s); d <= e; d = new Date(d.getTime() + 86400000)) {
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;               // weekend
        if (holidaySet && holidaySet.has(d.toISOString().slice(0, 10))) continue;
        count++;
    }
    return count;
}
// ── Monthly Allocation Engine ─────────────────────────────────────────────────
// Spread a milestone's total estimated hours across the calendar months in
// [startStr,endStr], proportional to each month's WORKING days. No weekly split.
// Returns [{ yearMonth:'YYYY-MM', hours, workingDays }]. The last month absorbs the
// rounding remainder so the parts always sum back to totalHours.
function generateMonthlyAllocations(startStr, endStr, totalHours, holidays) {
    totalHours = Number(totalHours) || 0;
    if (!startStr || !endStr || totalHours <= 0) return [];
    const rs = new Date(startStr), re = new Date(endStr);
    if (isNaN(rs) || isNaN(re) || re < rs) return [];
    const holidaySet = new Set(holidays || []);
    const months = monthsInRange(startStr, endStr);
    if (!months.length) return [];
    const wd = months.map(win => Math.max(0, workingDaysInWindow(rs, re, win, holidaySet)));
    const totalWd = wd.reduce((a, b) => a + b, 0);
    const out = [];
    if (totalWd <= 0) { return [{ yearMonth: months[0].startStr.slice(0, 7), hours: Math.round(totalHours * 100) / 100, workingDays: 0 }]; }
    let assigned = 0;
    months.forEach((win, i) => {
        let h;
        if (i === months.length - 1) h = Math.round((totalHours - assigned) * 100) / 100;
        else { h = Math.round(totalHours * wd[i] / totalWd * 100) / 100; assigned += h; }
        out.push({ yearMonth: win.startStr.slice(0, 7), hours: h, workingDays: wd[i] });
    });
    return out.filter(x => x.hours > 0 || x.workingDays > 0);
}

// ── Time-phased monthly plan (enterprise resource costing) ────────────────────
// Produces one row per calendar month in [start,end] with hours, FROZEN cost and
// the month's allocation %. Two modes:
//   • pct mode      → month cost = monthlyLoadedCost × pct% × (workingDays / fullMonthWorkingDays)
//   • totalHours    → spread hours by working days; cost = hours × loadedRate
// Partial (start/end) months are prorated by working days. Returns
// [{ yearMonth, hours, cost, pct, workingDays }].
function generateTimePhasedPlan(startStr, endStr, opts) {
    opts = opts || {};
    if (!startStr || !endStr) return [];
    const rs = new Date(startStr), re = new Date(endStr);
    if (isNaN(rs) || isNaN(re) || re < rs) return [];
    const holidaySet = new Set(opts.holidays || []);
    const capacity = Number(opts.capacity) > 0 ? Number(opts.capacity) : DEFAULT_MONTHLY_CAPACITY;
    const loadedRate = Number(opts.loadedRate) || 0;                 // ₹/hour fully-loaded
    const monthlyLoadedCost = Number(opts.monthlyLoadedCost) || (loadedRate * capacity);  // ₹/month
    const months = monthsInRange(startStr, endStr);
    if (!months.length) return [];
    const wdIn = months.map(win => Math.max(0, workingDaysInWindow(rs, re, win, holidaySet)));

    if (opts.pct != null) {
        const pct = Math.max(0, Number(opts.pct) || 0);
        return months.map((win, i) => {
            const fullWd = Math.max(1, workingDaysInWindow(win.start, win.end, win, holidaySet));
            const frac = Math.min(1, wdIn[i] / fullWd);
            const cost = Math.round(monthlyLoadedCost * pct / 100 * frac);
            const hours = Math.round(capacity * pct / 100 * frac * 100) / 100;
            return { yearMonth: win.startStr.slice(0, 7), hours, cost, pct, workingDays: wdIn[i] };
        }).filter(x => x.workingDays > 0 || x.hours > 0);
    }

    // Hours mode — distribute total hours by working days.
    const totalHours = Number(opts.totalHours) || 0;
    const totalWd = wdIn.reduce((a, b) => a + b, 0);
    if (totalHours <= 0) return [];
    if (totalWd <= 0) { const h = Math.round(totalHours * 100) / 100; return [{ yearMonth: months[0].startStr.slice(0, 7), hours: h, cost: Math.round(h * loadedRate), pct: Math.round(h / capacity * 100), workingDays: 0 }]; }
    let assigned = 0;
    return months.map((win, i) => {
        let h;
        if (i === months.length - 1) h = Math.round((totalHours - assigned) * 100) / 100;
        else { h = Math.round(totalHours * wdIn[i] / totalWd * 100) / 100; assigned += h; }
        return { yearMonth: win.startStr.slice(0, 7), hours: h, cost: Math.round(h * loadedRate), pct: Math.round(h / capacity * 100), workingDays: wdIn[i] };
    }).filter(x => x.hours > 0 || x.workingDays > 0);
}

// Does an allocation's [start,end] window overlap a month? Null dates (legacy /
// "for the whole project") always count — preserving existing behaviour.
function allocCoversMonth(a, win) {
    const s = toDate(a.startDate), e = toDate(a.endDate);
    if (!s && !e) return true;
    const aS = s || new Date(-8640000000000000);
    const aE = e || new Date(8640000000000000);
    return aE >= win.start && aS <= win.end;
}

// ── Raw non-working-time context, fetched ONCE for a set of employees ─────────
// Then reused to compute deductions for ANY month in memory — so a multi-month
// forecast doesn't re-query per month (performance for large populations/ranges).
async function fetchRawContext(ids) {
    const leaves = (await SELECT.from(LEAVE_REQUEST)
        .columns('employee_employeeId', 'fromDate', 'toDate')
        .where({ employee_employeeId: { in: ids }, status: 'Approved' }))
        .map(l => ({ emp: l.employee_employeeId, s: toDate(l.fromDate), e: toDate(l.toDate) }))
        .filter(l => l.s && l.e);
    let meetings = [];
    try {
        const parts = await SELECT.from(MEETING_PARTICIPANT).columns('meeting_meetingId', 'employee_employeeId', 'attendanceStatus').where({ employee_employeeId: { in: ids } });
        const mids = [...new Set(parts.map(p => p.meeting_meetingId).filter(Boolean))];
        const mrows = mids.length ? await SELECT.from(MEETING).columns('meetingId', 'startDateTime', 'endDateTime', 'status').where({ meetingId: { in: mids } }) : [];
        const mById = {}; mrows.forEach(m => { mById[m.meetingId] = m; });
        parts.forEach(p => {
            if (String(p.attendanceStatus) === 'Declined') return;
            const m = mById[p.meeting_meetingId];
            if (!m || m.status === 'Cancelled' || !m.startDateTime || !m.endDateTime) return;
            meetings.push({ emp: p.employee_employeeId, s: new Date(m.startDateTime), e: new Date(m.endDateTime) });
        });
    } catch (e) { /* meetings optional */ }
    let holidays = [], events = [];
    try { holidays = (await SELECT.from(HOLIDAY).columns('holidayDate')).map(h => String(h.holidayDate).slice(0, 10)); } catch (e) { /* optional */ }
    try { events = (await SELECT.from(COMPANY_EVENT).columns('fromDate', 'toDate')).map(ev => ({ s: toDate(ev.fromDate), e: toDate(ev.toDate) || toDate(ev.fromDate) })).filter(x => x.s); } catch (e) { /* optional */ }
    return { leaves, meetings, holidays, events };
}
// Per-month deductions for one employee, from pre-fetched raw context.
function deductionsForMonth(raw, empId, win, capacity, config) {
    const dailyHours = Number(config.standardDailyHours) || 8;
    const holDays = new Set(raw.holidays.filter(d => d >= win.startStr && d <= win.endStr));
    let eventDays = 0; raw.events.forEach(ev => { eventDays += overlapDays(ev.s, ev.e, win.start, win.end); });
    const holidayEventHours = Math.round((holDays.size + eventDays) * dailyHours);
    let leaveHours = 0; raw.leaves.forEach(l => { if (l.emp !== empId) return; const d = overlapDays(l.s, l.e, win.start, win.end); if (d > 0) leaveHours += d * HOURS_PER_LEAVE_DAY; });
    let meetingHours = 0; raw.meetings.forEach(m => { if (m.emp !== empId) return; if (m.s < win.start || m.s > win.end) return; meetingHours += Math.max(0, (m.e - m.s) / 3600000); });
    const reserveHours = Math.round(capacity * (Number(config.nonBillablePct) || 0) / 100);
    return { holidayEventHours, leaveHours: Math.round(leaveHours), meetingHours: Math.round(meetingHours), reserveHours };
}

// ── Core: compute the full utilization/availability profile for a set of ──────
// employees in a single bulk pass. Returns Map<employeeId, profile>.
async function computeProfiles(employeeIds, opts = {}) {
    const refDate = opts.refDate || null;
    const win = monthWindow(refDate);
    const today = refDate ? new Date(refDate) : new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const empWhere = (employeeIds && employeeIds.length)
        ? { employeeId: { in: employeeIds }, isActive: true }
        : { isActive: true };
    const employees = await SELECT.from(EMPLOYEE)
        .columns('employeeId', 'employeeName', 'department', 'designation', 'skills', 'certifications',
            'monthlyCapacityHours', 'monthlyTrainingHours')
        .where(empWhere);
    const ids = employees.map(e => e.employeeId);
    if (!ids.length) return new Map();

    // Bulk: allocations for these employees + their projects' status/dates/names.
    const allocs = await SELECT.from(PROJECT_RESOURCE)
        .columns('allocationId', 'project_projectId', 'employee_employeeId', 'bandwidth',
            'startDate', 'endDate')
        .where({ employee_employeeId: { in: ids } });
    const pids = [...new Set(allocs.map(a => a.project_projectId))];
    const projects = pids.length
        ? await SELECT.from(PROJECT).columns('projectId', 'projectName', 'status', 'startDate', 'endDate')
            .where({ projectId: { in: pids } })
        : [];
    const projById = {};
    projects.forEach(p => { projById[p.projectId] = p; });

    // Config + raw non-working-time context (fetched once, reused per month).
    const config = opts.config || await loadConfig();
    const raw = await fetchRawContext(ids);

    // Group active allocations per employee + count distinct past projects (any
    // status) per employee → project-experience signal for recommendations.
    const allocByEmp = {};
    const pastProjectsByEmp = {};
    allocs.forEach(a => {
        (pastProjectsByEmp[a.employee_employeeId] = pastProjectsByEmp[a.employee_employeeId] || new Set()).add(a.project_projectId);
        const proj = projById[a.project_projectId];
        if (!proj || !ACTIVE_PROJECT_STATUSES.includes(proj.status)) return; // freed capacity
        (allocByEmp[a.employee_employeeId] = allocByEmp[a.employee_employeeId] || []).push({ a, proj });
    });

    const out = new Map();
    for (const e of employees) {
        const capacity = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : DEFAULT_MONTHLY_CAPACITY;
        const ded = deductionsForMonth(raw, e.employeeId, win, capacity, config);
        const leaveHours = ded.leaveHours;
        const trainingHours = Math.max(0, Number(e.monthlyTrainingHours) || 0);
        const meetingHours = ded.meetingHours;
        const holidayEventHours = ded.holidayEventHours;
        const reserveHours = ded.reserveHours;
        // Effective Capacity = Capacity − Holidays/Events − Leave − Training − Internal − Reserve
        const effectiveCapacity = Math.max(0, capacity - holidayEventHours - leaveHours - trainingHours - meetingHours - reserveHours);

        // Only allocations whose window covers THIS month count toward "now" — so a
        // future-dated allocation no longer inflates today's utilization.
        const myAllocs = (allocByEmp[e.employeeId] || []).filter(x => allocCoversMonth(x.a, win));
        const totalBandwidth = myAllocs.reduce((s, x) => s + (Number(x.a.bandwidth) || 0), 0);
        const allocatedHours = Math.round(myAllocs.reduce((s, x) => s + (Number(x.a.bandwidth) || 0) / 100 * capacity, 0));
        const freeHours = Math.round(effectiveCapacity - allocatedHours);
        const utilizationPct = effectiveCapacity > 0
            ? Math.round(allocatedHours / effectiveCapacity * 100)
            : (allocatedHours > 0 ? 100 : 0);

        // Availability forecast.
        //   nextAvailableDate            = soonest date ANY capacity frees up
        //   afterCurrentProjectEndsDate  = date the employee is FULLY free (latest
        //                                  active-allocation end)
        const ends = myAllocs.map(x => toDate(x.a.endDate) || toDate(x.proj.endDate)).filter(Boolean);
        let nextAvailableDate = todayStr;
        if (totalBandwidth >= 100) {
            const earliestEnd = ends.length ? new Date(Math.min(...ends.map(d => d.getTime()))) : null;
            nextAvailableDate = earliestEnd ? new Date(earliestEnd.getTime() + 86400000).toISOString().slice(0, 10) : null;
        }
        const afterCurrentProjectEndsDate = ends.length ? new Date(Math.max(...ends.map(d => d.getTime())) + 86400000).toISOString().slice(0, 10) : todayStr;

        const availableToday = totalBandwidth < 100 && freeHours > 0;
        const weekAhead = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
        const monthAhead = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
        const availableNextWeek = availableToday || (nextAvailableDate != null && nextAvailableDate <= weekAhead);
        const availableNextMonth = availableToday || (nextAvailableDate != null && nextAvailableDate <= monthAhead);
        const experienceProjects = (pastProjectsByEmp[e.employeeId] ? pastProjectsByEmp[e.employeeId].size : 0);

        out.set(e.employeeId, {
            employeeId: e.employeeId, employeeName: e.employeeName,
            department: e.department || 'Unassigned', designation: e.designation || '',
            skills: parseSkills(e.skills),
            certifications: parseSkills(e.certifications),
            monthlyCapacityHours: capacity,
            leaveHours, trainingHours, meetingHours, holidayEventHours, reserveHours,
            effectiveCapacityHours: effectiveCapacity,
            allocatedHours, freeHours,
            utilizationPct,
            totalBandwidth,
            experienceProjects,
            currentProjects: myAllocs.map(x => ({
                projectId: x.proj.projectId, projectName: x.proj.projectName,
                bandwidth: Number(x.a.bandwidth) || 0,
                endDate: (toDate(x.a.endDate) || toDate(x.proj.endDate) || null)
                    ? (toDate(x.a.endDate) || toDate(x.proj.endDate)).toISOString().slice(0, 10) : null
            })),
            availableToday, availableNextWeek, availableNextMonth, nextAvailableDate, afterCurrentProjectEndsDate,
            status: statusBadge(utilizationPct, totalBandwidth),
            // Over-utilization band keyed off FTE allocation (what the POC controls).
            band: utilizationBand(totalBandwidth)
        });
    }
    return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Multi-month capacity timeline ─────────────────────────────────────────────
// For each month in [from,to], computes that month's OWN effective capacity vs the
// hours allocated in that month — so a sustained % that fits today but breaks in a
// future month (because of that month's leave/holidays) is flagged. Same engine,
// extended from "one month" to "a range". Returns Map<employeeId, {…, months[]}>.
async function computeCapacityTimeline(employeeIds, fromStr, toStr, opts = {}) {
    const config = opts.config || await loadConfig();
    const empWhere = (employeeIds && employeeIds.length)
        ? { employeeId: { in: employeeIds }, isActive: true } : { isActive: true };
    const employees = await SELECT.from(EMPLOYEE)
        .columns('employeeId', 'employeeName', 'department', 'monthlyCapacityHours', 'monthlyTrainingHours').where(empWhere);
    const ids = employees.map(e => e.employeeId);
    if (!ids.length) return new Map();

    const allocs = await SELECT.from(PROJECT_RESOURCE)
        .columns('project_projectId', 'employee_employeeId', 'bandwidth', 'startDate', 'endDate').where({ employee_employeeId: { in: ids } });
    const pids = [...new Set(allocs.map(a => a.project_projectId))];
    const projects = pids.length ? await SELECT.from(PROJECT).columns('projectId', 'projectName', 'status', 'endDate').where({ projectId: { in: pids } }) : [];
    const projById = {}; projects.forEach(p => { projById[p.projectId] = p; });
    const allocByEmp = {};
    allocs.forEach(a => {
        const proj = projById[a.project_projectId];
        if (!proj || !ACTIVE_PROJECT_STATUSES.includes(proj.status)) return;
        (allocByEmp[a.employee_employeeId] = allocByEmp[a.employee_employeeId] || []).push({ a, proj });
    });

    const raw = await fetchRawContext(ids);
    const months = monthsInRange(fromStr, toStr);
    const out = new Map();
    for (const e of employees) {
        const capacity = Number(e.monthlyCapacityHours) > 0 ? Number(e.monthlyCapacityHours) : DEFAULT_MONTHLY_CAPACITY;
        const training = Math.max(0, Number(e.monthlyTrainingHours) || 0);
        const mine = allocByEmp[e.employeeId] || [];
        const series = months.map(win => {
            const ded = deductionsForMonth(raw, e.employeeId, win, capacity, config);
            const eff = Math.max(0, capacity - ded.holidayEventHours - ded.leaveHours - training - ded.meetingHours - ded.reserveHours);
            const covering = mine.filter(x => allocCoversMonth(x.a, win));
            const totalBw = covering.reduce((s, x) => s + (Number(x.a.bandwidth) || 0), 0);
            const allocated = Math.round(covering.reduce((s, x) => s + (Number(x.a.bandwidth) || 0) / 100 * capacity, 0));
            const util = eff > 0 ? Math.round(allocated / eff * 100) : (allocated > 0 ? 100 : 0);
            const mIdx = win.start.getUTCMonth(), yr = win.start.getUTCFullYear();
            return {
                label: MONTH_NAMES[mIdx] + ' ' + yr, year: yr, month: mIdx + 1,
                effectiveCapacityHours: eff, allocatedHours: allocated, freeHours: eff - allocated,
                utilizationPct: util, status: statusBadge(util, totalBw),
                breach: allocated > eff,   // commitment exceeds that month's capacity
                leaveHours: ded.leaveHours, holidayEventHours: ded.holidayEventHours
            };
        });
        out.set(e.employeeId, {
            employeeId: e.employeeId, employeeName: e.employeeName, department: e.department || 'Unassigned',
            months: series,
            breachMonths: series.filter(m => m.breach).map(m => m.label),
            peakUtilization: series.reduce((mx, m) => Math.max(mx, m.utilizationPct), 0)
        });
    }
    return out;
}

// ── Status classification (enterprise bands) ──────────────────────────────────
//   Available 0–69 · Busy 70–89 · Nearly Full 90–100 · Overallocated >100
function statusBadge(utilizationPct, totalBandwidth) {
    if (utilizationPct > 100 || (totalBandwidth || 0) > 100) return 'Overallocated';
    if (utilizationPct >= 90) return 'Nearly Full';
    if (utilizationPct >= 70) return 'Busy';
    return 'Available';
}

// ── Utilization band (over-utilization risk view) ─────────────────────────────
//   0–100 Normal · 101–120 Over Utilized · 121–150 High Risk · >150 Critical
function utilizationBand(pct) {
    if (pct > 150) return { band: 'Critical', color: '#dc2626' };
    if (pct > 120) return { band: 'High Risk', color: '#ea580c' };
    if (pct > 100) return { band: 'Over Utilized', color: '#ca8a04' };
    return { band: 'Normal', color: '#16a34a' };
}

// ── Recommendation scoring (configurable 4-factor model) ──────────────────────
//   score = w_skill·skillMatch + w_avail·availability + w_util·(1−utilization)
//         + w_exp·experience            (weights from ResourcePlanningConfig)
// Factors are each 0..1; weights are normalised so any config still sums to 100%.
function scoreProfile(profile, requiredSkills, config, opts) {
    const cfg = config || CONFIG_DEFAULTS;
    opts = opts || {};
    const wSkill = Number(cfg.skillWeight) || 0;
    const wAvail = Number(cfg.availabilityWeight) || 0;
    const wUtil = Number(cfg.utilizationWeight) || 0;
    const wExp = Number(cfg.experienceWeight) || 0;
    const wCert = Number(cfg.certificationWeight) || 0;
    const wPrev = Number(cfg.previousProjectWeight) || 0;
    const wTotal = (wSkill + wAvail + wUtil + wExp + wCert + wPrev) || 1;

    const sm = skillMatchRatio(requiredSkills, profile.skills.join(','));
    // Availability: free now → 1; available within ~30 days → 0.5; else 0.
    const availability = profile.availableToday ? 1 : (profile.availableNextMonth ? 0.5 : 0);
    // Lower current utilization scores higher (more headroom).
    const utilHeadroom = Math.max(0, Math.min(1, 1 - (profile.utilizationPct || 0) / 100));
    // Project experience: saturates at 3 prior projects.
    const experience = Math.max(0, Math.min(1, (profile.experienceProjects || 0) / 3));
    // Certification: matches required certs when provided, else "has any valid cert".
    let certScore;
    const empCerts = profile.certifications || [];
    if (opts.requiredCerts && opts.requiredCerts.length) {
        const need = opts.requiredCerts.map(x => String(x).toLowerCase().trim());
        const have = empCerts.map(x => String(x).toLowerCase().trim());
        const hit = need.filter(n => have.some(h => h.indexOf(n) >= 0 || n.indexOf(h) >= 0)).length;
        certScore = need.length ? hit / need.length : (empCerts.length ? 1 : 0);
    } else certScore = empCerts.length ? 1 : 0;
    // Previous project: prior work with THIS client (if known) else any prior project.
    const prevScore = (opts.priorWithClient != null)
        ? (opts.priorWithClient ? 1 : 0)
        : ((profile.experienceProjects || 0) > 0 ? 1 : 0);

    const score = Math.round(
        (wSkill * sm.ratio + wAvail * availability + wUtil * utilHeadroom + wExp * experience + wCert * certScore + wPrev * prevScore) / wTotal * 100
    );
    return {
        score,
        availabilityPct: Math.round(availability * 100),
        utilizationHeadroomPct: Math.round(utilHeadroom * 100),
        experiencePct: Math.round(experience * 100),
        experienceProjects: profile.experienceProjects || 0,
        certificationPct: Math.round(certScore * 100),
        previousProjectPct: Math.round(prevScore * 100),
        skillMatchPct: Math.round(sm.ratio * 100),
        capacityPct: Math.round(utilHeadroom * 100),   // headroom = capacity component (back-compat)
        matchedSkills: sm.matched, missingSkills: sm.missing
    };
}

// ── Dashboard KPIs (computed from an array of profiles) ───────────────────────
function computeKpis(profiles) {
    const total = profiles.length;
    const byStatus = s => profiles.filter(p => p.status === s).length;
    const overallocated = byStatus('Overallocated');
    const nearlyFull = byStatus('Nearly Full');
    const busy = byStatus('Busy');
    const availableStatus = byStatus('Available');
    const available = profiles.filter(p => p.freeHours > 0 && p.status !== 'Overallocated').length;
    const availableThisWeek = profiles.filter(p => p.availableNextWeek).length;
    const availableNextMonth = profiles.filter(p => p.availableNextMonth).length;
    const avgUtil = total ? Math.round(profiles.reduce((s, p) => s + p.utilizationPct, 0) / total) : 0;
    // Over-utilization bands (keyed off FTE allocation %).
    const bw = p => p.totalBandwidth || 0;
    const fullyUtilized = profiles.filter(p => bw(p) === 100).length;
    const overUtilized = profiles.filter(p => bw(p) > 100).length;
    const critical = profiles.filter(p => bw(p) > 150).length;
    return {
        totalEmployees: total,
        availableResources: available,
        availableEmployees: availableStatus,   // status === 'Available'
        busyEmployees: busy,
        nearlyFullEmployees: nearlyFull,
        overallocatedResources: overallocated,
        averageUtilization: avgUtil,
        availableThisWeek,
        availableNextWeek: availableThisWeek,
        availableNextMonth,
        // Resource Utilization Overview cards.
        fullyUtilized,
        overUtilized,
        criticalUtilization: critical
    };
}

module.exports = {
    parseSkills, skillMatchRatio, computeProfiles, computeCapacityTimeline, statusBadge, utilizationBand, scoreProfile,
    computeKpis, loadConfig, loadedHourlyRate, baseHourlyRate, CONFIG_DEFAULTS, DEFAULT_MONTHLY_CAPACITY,
    generateMonthlyAllocations, generateTimePhasedPlan, workingDaysInWindow, monthsInRange, monthWindow,
};
