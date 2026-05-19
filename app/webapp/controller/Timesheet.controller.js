sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Popover",
    "sap/ui/unified/Calendar"
], (Controller, JSONModel, MessageToast, MessageBox, Popover, Calendar) => {
    "use strict";

    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const EMPTY_APPROVED = () => ({ mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false });

    const EMPTY_ROW = () => ({
        projectName: "", taskName: "", taskId: "",
        mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "",
        locked: { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false },
        approved: EMPTY_APPROVED(),
        _rowLocked: false
    });

    function getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function toDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function toShortLabel(date) {
        return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    }

    function buildDayLabels(weekStart) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return DAY_NAMES.map((name, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            d.setHours(0, 0, 0, 0);
            return { name, date: toShortLabel(d), isFuture: d > today };
        });
    }

    function getAllowedMinWeek() {
        const prev = getWeekStart(new Date());
        prev.setDate(prev.getDate() - 7);
        return prev;
    }

    function getAllowedMaxWeek() {
        return getWeekStart(new Date());
    }

    // ── Stable, unique entryId: empId + weekStart + taskId + dayIndex ────
    // Max 15 chars to fit the schema String(15).
    // Format: e.g. "1001270TASK0010" — empSuffix(4) + weekDay(3) + taskSuffix(7) + dayIdx(1)
    function makeEntryId(sEmpId, sWeekStart, sTaskId, dayIndex) {
        const emp = (sEmpId || "").replace(/\D/g, "").slice(-4).padStart(4, "0");
        const week = (sWeekStart || "").replace(/-/g, "").slice(2, 7); // YYMMD → 5 chars
        const task = (sTaskId || "").replace(/\D/g, "").slice(-3).padStart(3, "0");
        const day = String(dayIndex);
        return (emp + week + task + day).substring(0, 15);
    }

    return Controller.extend("timesheet.app.controller.Timesheet", {

        onInit() {
            this._oViewModel = new JSONModel({
                weekStart: null,
                weekStartFilter: "",
                weekRangeLabel: "",
                grandTotal: "0:00",
                canSubmit: false,
                rowCount: 1,
                canGoPrev: false,
                canGoNext: false,
                days: [],
                busy: false,
                colTotals: {
                    mon: "0:00", tue: "0:00", wed: "0:00", thu: "0:00",
                    fri: "0:00", sat: "0:00", sun: "0:00", total: "0:00"
                }
            });
            this.getView().setModel(this._oViewModel, "view");

            this._oRowsModel = new JSONModel({ rows: [EMPTY_ROW()] });
            this.getView().setModel(this._oRowsModel, "rows");

            this._oTasksModel = new JSONModel([]);
            this.getView().setModel(this._oTasksModel, "tasks");

            this._currentTimesheetId = null;
            this._setWeek(new Date());
            this._loadTasks();

            this.getOwnerComponent().getRouter()
                .getRoute("timesheet")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            const oComp = this.getOwnerComponent();
            if (oComp._pendingWeekStart) {
                const sFilter = oComp._pendingWeekStart;
                oComp._pendingWeekStart = null;
                this._setWeekByFilter(sFilter);
            } else {
                this._loadTimesheetData();
            }
        },

        _setWeekByFilter(sFilter) {
            const minWeek = getAllowedMinWeek();
            this._savedDays = null;  
            const maxWeek = getAllowedMaxWeek();
            const [y, m, d] = sFilter.split("-").map(Number);

            let start = null;
            for (let offset = 0; offset <= 1; offset++) {
                const monday = getWeekStart(new Date(y, m - 1, d + offset));
                if (toDateString(monday) === sFilter) { start = monday; break; }
            }
            if (!start) start = getWeekStart(new Date(y, m - 1, d + 1));
            if (start.getTime() < minWeek.getTime()) start = new Date(minWeek);
            if (start.getTime() > maxWeek.getTime()) start = new Date(maxWeek);

            const end = new Date(start);
            end.setDate(start.getDate() + 6);

            this._oViewModel.setProperty("/weekStart", start);
            this._oViewModel.setProperty("/weekStartFilter", sFilter);
            this._oViewModel.setProperty("/weekRangeLabel", `${toShortLabel(start)} - ${toShortLabel(end)}`);
            this._oViewModel.setProperty("/days", buildDayLabels(start));
            this._oViewModel.setProperty("/canGoPrev", start.getTime() > minWeek.getTime());
            this._oViewModel.setProperty("/canGoNext", start.getTime() < maxWeek.getTime());
            this._loadTimesheetData();
        },

        onPrevWeek() {
            const d = new Date(this._oViewModel.getProperty("/weekStart"));
            d.setDate(d.getDate() - 7);
            this._setWeek(d);
        },

        onNextWeek() {
            const d = new Date(this._oViewModel.getProperty("/weekStart"));
            d.setDate(d.getDate() + 7);
            this._setWeek(d);
        },

        onToday() { this._setWeek(new Date()); },

        _setWeek(date) {
            const minWeek = getAllowedMinWeek();
            this._savedDays = null;
            const maxWeek = getAllowedMaxWeek();
            let start = getWeekStart(date);
            if (start.getTime() < minWeek.getTime()) start = new Date(minWeek);
            if (start.getTime() > maxWeek.getTime()) start = new Date(maxWeek);

            const end = new Date(start);
            end.setDate(start.getDate() + 6);

            this._currentTimesheetId = null; // reset for new week

            this._oViewModel.setProperty("/weekStart", start);
            this._oViewModel.setProperty("/weekStartFilter", toDateString(start));
            this._oViewModel.setProperty("/weekRangeLabel", `${toShortLabel(start)} - ${toShortLabel(end)}`);
            this._oViewModel.setProperty("/days", buildDayLabels(start));
            this._oViewModel.setProperty("/canGoPrev", start.getTime() > minWeek.getTime());
            this._oViewModel.setProperty("/canGoNext", start.getTime() < maxWeek.getTime());
            this._loadTimesheetData();
        },

        onCalendarPress(oEvent) {
            if (!this._oCalPopover) {
                const minWeek = getAllowedMinWeek();
                const maxWeekEnd = new Date(getAllowedMaxWeek());
                maxWeekEnd.setDate(maxWeekEnd.getDate() + 6);

                this._oDashCal = new Calendar({
                    minDate: minWeek,
                    maxDate: maxWeekEnd,
                    select: this.onCalendarWeekSelect.bind(this)
                });
                this._oCalPopover = new Popover({
                    showHeader: false,
                    placement: "Bottom",
                    content: [this._oDashCal]
                });
                this.getView().addDependent(this._oCalPopover);
            }
            this._oCalPopover.openBy(oEvent.getSource());
        },

        onCalendarWeekSelect(oEvent) {
            const oCal = oEvent.getSource();
            const aDates = oCal.getSelectedDates();
            if (!aDates || !aDates.length) return;
            const oStart = aDates[0].getStartDate();
            if (!oStart) return;
            this._oCalPopover.close();
            this._setWeek(new Date(oStart));
        },

        // ── Load timesheet from backend ───────────────────────────────────
        _loadTimesheetData() {
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) { this._setRows([EMPTY_ROW()]); return; }

            this._oViewModel.setProperty("/busy", true);

            oModel.bindList("/MyTimesheets", null, null, null, {
                $filter: `weekStartDate eq ${sWeekStart}`
            }).requestContexts(0, 1)
                .then(aCtx => {
                    if (!aCtx || aCtx.length === 0) {
                        this._currentTimesheetId = null;
                        this._savedDays = null;
                        this._setRows([EMPTY_ROW()]);
                        return;
                    }
                    const header = aCtx[0].getObject();
                    this._currentTimesheetId = header.timesheetId;
                    this._currentStatus = header.status;

                    const weekStart = this._oViewModel.getProperty("/weekStart");
                    const weekDates = DAYS.map((_, i) => {
                        const d = new Date(weekStart);
                        d.setDate(weekStart.getDate() + i);
                        return toDateString(d);
                    });

                    return oModel.bindList("/MyEntries", null, null, null, {
                        $expand: "task",
                        $filter: `timesheet_timesheetId eq '${header.timesheetId}'`
                    }).requestContexts(0, 200)
                        .then(aEntries => {
                            const entries = aEntries.map(c => c.getObject());
                            this._setRows(entries.length > 0
                                ? this._pivotEntries(entries, weekDates, header.status)
                                : [EMPTY_ROW()]);
                        });
                })
                .catch(() => this._setRows([EMPTY_ROW()]))
                .finally(() => this._oViewModel.setProperty("/busy", false));
        },

        _pivotEntries(entries, weekDates, status) {
            const rowMap = new Map();
            const isLocked = status === "Submitted" || status === "Approved";

            for (const entry of entries) {
                const taskId = entry.task_taskId ?? "unknown";
                const taskName = entry.task?.taskName ?? "Unknown Task";
                const taskDesc = entry.task?.taskDescription ?? "";

                if (!rowMap.has(taskId)) {
                    rowMap.set(taskId, {
                        taskId, projectName: taskName, taskName: taskDesc,
                        mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0
                    });
                }
                const idx = weekDates.indexOf(entry.workDate);
                if (idx >= 0) rowMap.get(taskId)[DAYS[idx]] += parseFloat(entry.hoursWorked) || 0;
            }

            // ── Track which days have saved hours so new rows lock them ──
            this._savedDays = {
                mon: false, tue: false, wed: false,
                thu: false, fri: false, sat: false, sun: false
            };
            Array.from(rowMap.values()).forEach(row => {
                DAYS.forEach(d => {
                    if ((row[d] || 0) > 0) this._savedDays[d] = true;
                });
            });

            return Array.from(rowMap.values()).map(row => {
                const r = {
                    taskId: row.taskId, projectName: row.projectName, taskName: row.taskName,
                    locked: {
                        mon: isLocked, tue: isLocked, wed: isLocked, thu: isLocked,
                        fri: isLocked, sat: isLocked, sun: isLocked
                    },
                    approved: EMPTY_APPROVED(),
                    _rowLocked: isLocked
                };
                DAYS.forEach(d => { r[d] = row[d] > 0 ? this._toHHMM(row[d]) : ""; });
                return r;
            });
        },

        _fallbackTasks: [
            { taskId: "TASK001", taskName: "UI Development", taskDescription: "Build weekly timesheet UI" },
            { taskId: "TASK002", taskName: "CAP Backend", taskDescription: "Create CAP service and entities" },
            { taskId: "TASK003", taskName: "HR Review", taskDescription: "Employee onboarding checklist" },
            { taskId: "TASK004", taskName: "Sales Followup", taskDescription: "Client meeting updates" }
        ],

        _loadTasks() {
            const oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/MyTasks").requestContexts(0, 200)
                .then(aCtx => {
                    const tasks = aCtx.map(c => c.getObject());
                    this._oTasksModel.setData(tasks.length > 0 ? tasks : this._fallbackTasks);
                })
                .catch(() => this._oTasksModel.setData(this._fallbackTasks));
        },

        onTaskSelect(oEvent) {
            const oComboBox = oEvent.getSource();
            const sKey = oComboBox.getSelectedKey();
            const oContext = oComboBox.getBindingContext("rows");
            if (!oContext) return;

            const sPath = oContext.getPath();
            if (sKey) {
                const task = this._oTasksModel.getData().find(t => t.taskId === sKey);
                if (task) {
                    this._oRowsModel.setProperty(sPath + "/taskId", task.taskId);
                    this._oRowsModel.setProperty(sPath + "/projectName", task.taskName);
                    this._oRowsModel.setProperty(sPath + "/taskName", task.taskDescription || "");
                }
            } else {
                this._oRowsModel.setProperty(sPath + "/taskId", "");
                this._oRowsModel.setProperty(sPath + "/projectName", "");
                this._oRowsModel.setProperty(sPath + "/taskName", "");
            }
        },

        _setRows(rows) {
            this._oRowsModel.setProperty("/rows", rows);
            this._refreshTotals(rows);
            this._updateRowCount();
        },

        _newLockedRow() {
            const saved = this._savedDays || {};
            const locked = {};
            DAYS.forEach(d => { locked[d] = saved[d] === true; });
            return {
                projectName: "", taskName: "", taskId: "",
                mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "",
                locked,
                approved: EMPTY_APPROVED(),
                _rowLocked: false
            };
        },

        onAddRow() {
            const rows = this._oRowsModel.getProperty("/rows");
            rows.push(this._newLockedRow());  // ← was EMPTY_ROW()
            this._oRowsModel.setProperty("/rows", rows);
            this._updateRowCount();
        },

        onSave() {
            const rows = this._oRowsModel.getProperty("/rows");
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");
            this._oViewModel.setProperty("/busy", true);

            this._saveToBackend(rows, sWeekStart, "Draft")
                .then(() => {
                    // ── Sync to shared models so Dashboard bar chart updates ──
                    this._syncToDashboard(rows, sWeekStart);
                    MessageToast.show("Draft saved.");
                })
                .catch(err => MessageBox.error((err && err.message) || "Save failed."))
                .finally(() => this._oViewModel.setProperty("/busy", false));
        },

        _syncToDashboard(rows, sWeekStart) {
            const oComp = this.getOwnerComponent();

            // 1. Write to "locked" model — Dashboard reads this for bar chart
            const oLocksModel = oComp.getModel("locked");
            if (oLocksModel) {
                oLocksModel.setProperty("/" + sWeekStart, rows);
                oComp.persistLocked();
            }

            // 2. Write to "history" model — Dashboard reads this as fallback
            const oHistModel = oComp.getModel("history");
            if (oHistModel) {
                const submissions = oHistModel.getProperty("/submissions") || [];
                const existingIdx = submissions.findIndex(s => s.weekStart === sWeekStart);

                const entry = {
                    weekStart: sWeekStart,
                    rows: rows,
                    status: "Draft",
                    timesheetId: this._currentTimesheetId
                };

                if (existingIdx >= 0) {
                    submissions[existingIdx] = entry;
                } else {
                    submissions.push(entry);
                }

                oHistModel.setProperty("/submissions", submissions);
                oComp.persistHistory();
            }
            // Update _savedDays so immediately-added rows lock saved days
this._savedDays = { mon:false, tue:false, wed:false,
                    thu:false, fri:false, sat:false, sun:false };
rows.forEach(row => {
    DAYS.forEach(d => {
        if (this._parseHHMM(row[d]) > 0) this._savedDays[d] = true;
    });
});
        },

        onSubmit() {
            const rows = this._oRowsModel.getProperty("/rows");

            const colDec = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
            rows.forEach(r => ["mon", "tue", "wed", "thu", "fri"].forEach(d => { colDec[d] += this._parseHHMM(r[d]); }));
            const missingDays = ["mon", "tue", "wed", "thu", "fri"].filter(d => colDec[d] === 0);
            if (missingDays.length > 0) {
                const names = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" };
                MessageBox.error(
                    "Please fill hours for: " + missingDays.map(d => names[d]).join(", ") + ".",
                    { title: "Incomplete Timesheet" }
                );
                return;
            }

            const invalidRows = rows.filter(r =>
                DAYS.some(d => r[d] && r[d] !== "" && !r.locked[d]) && !r.taskId
            );
            if (invalidRows.length > 0) {
                MessageBox.error(
                    `${invalidRows.length} row(s) have hours but no task selected.`,
                    { title: "Task Required" }
                );
                return;
            }

            MessageBox.confirm(
                `Send timesheet for ${this._oViewModel.getProperty("/weekRangeLabel")} for approval?`,
                {
                    title: "Send for Approval",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: (sAction) => {
                        if (sAction === MessageBox.Action.OK) this._doSubmit(rows);
                    }
                }
            );
        },

        _doSubmit(rows) {
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");
            this._oViewModel.setProperty("/busy", true);

            this._saveToBackend(rows, sWeekStart, "Draft")
                .then(sTimesheetId => {
                    return fetch("/employee/submitTimesheet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Accept": "application/json" },
                        body: JSON.stringify({ timesheetId: sTimesheetId })
                    }).then(r => r.ok ? r.json() : Promise.reject(new Error("Submit action failed: " + r.status)));
                })
                .then(() => {
                    const updatedRows = this._oRowsModel.getProperty("/rows").map(row => {
                        const locked = { ...row.locked };
                        DAYS.forEach(d => { if (row[d] && row[d] !== "") locked[d] = true; });
                        return { ...row, locked, _rowLocked: DAYS.some(d => locked[d]) };
                    });
                    this._setRows(updatedRows);
                    this._syncToDashboard(updatedRows, sWeekStart);  // ← ADD THIS
                    MessageToast.show("Sent for approval! Your manager will review your timesheet.");
                })
                .catch(err => {
                    MessageBox.error(
                        (err && err.message) || "Failed to submit timesheet.",
                        { title: "Error" }
                    );
                })
                .finally(() => this._oViewModel.setProperty("/busy", false));
        },

        // ── Save header + entries to backend ─────────────────────────────
        // Strategy:
        //   1. POST header (ignore 409 = already exists)
        //   2. GET existing entryIds for this timesheet
        //   3. DELETE each existing entry individually
        //   4. POST new entries with stable, unique IDs
        _saveToBackend(rows, sWeekStart, sStatus) {
            const oComp = this.getOwnerComponent();
            const sEmpId = oComp.getCurrentEmployeeId();
            const weekStart = this._oViewModel.getProperty("/weekStart");
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const sWeekEnd = toDateString(weekEnd);

            // ── Stable timesheetId: empId + weekStart (no random) ────────
            // e.g. "EMP1002-20260511" → trimmed to 15 chars → "EMP1002-202605"
            const sTimesheetId = this._currentTimesheetId
                || (sEmpId + "-" + sWeekStart.replace(/-/g, "")).substring(0, 15);
            this._currentTimesheetId = sTimesheetId;

            // Build entry list — one entry per filled cell
            const entries = [];
            rows.forEach((row, rowIdx) => {
                if (!row.taskId) return;
                DAYS.forEach((day, dayIdx) => {
                    const val = this._parseHHMM(row[day]);
                    if (!val) return;
                    const workDate = new Date(weekStart);
                    workDate.setDate(weekStart.getDate() + dayIdx);

                    // ── Unique, stable entryId ───────────────────────────
                    // Uses rowIndex + dayIndex so it's always the same for
                    // the same cell on re-save. Max 15 chars.
                    // Format: TSIDprefix(8) + R(row,1) + D(day,1) → too short
                    // Better: empSuffix(4) + weekCompact(6) + row(2) + day(1) = 13 chars
                    const empNum = (sEmpId || "").replace(/\D/g, "").slice(-4).padStart(4, "0");
                    const wk = sWeekStart.replace(/-/g, "").slice(2); // 6 chars YYMMDD
                    const rPad = String(rowIdx).padStart(2, "0");
                    const dPad = String(dayIdx);
                    const entryId = (empNum + wk + rPad + dPad).substring(0, 15);

                    entries.push({
                        entryId,
                        timesheet_timesheetId: sTimesheetId,
                        task_taskId: row.taskId,
                        workDate: toDateString(workDate),
                        hoursWorked: val,
                        description: row.projectName || "",
                        entryStatus: "Open",
                        isLocked: false
                    });
                });
            });

            const headers = { "Content-Type": "application/json", "Accept": "application/json" };

// Step 1 — UPSERT header: try POST, fall back to PATCH if already exists
const headerBody = {
    timesheetId:         sTimesheetId,
    employee_employeeId: sEmpId,
    weekStartDate:       sWeekStart,
    weekEndDate:         sWeekEnd,
    status:              "Draft",
    submissionType:      "Weekly",
    isAutoApproved:      false
};

return fetch("/employee/MyTimesheets", {
    method: "POST", headers,
    body: JSON.stringify(headerBody)
})
.then(r => {
    // 201 = created, fine
    if (r.ok) return;
    // 409 (HANA) or 500 with PK error (SQLite) = already exists, PATCH it
    if (r.status === 409 || r.status === 500) {
        return fetch(`/employee/MyTimesheets('${sTimesheetId}')`, {
            method: "PATCH", headers,
            body: JSON.stringify({ status: "Draft" })
        }).then(pr => {
            if (!pr.ok) {
                return pr.text().then(t =>
                    Promise.reject(new Error(`Header PATCH failed ${pr.status}: ${t}`))
                );
            }
        });
    }
    return r.text().then(t =>
        Promise.reject(new Error(`Header POST failed ${r.status}: ${t}`))
    );
})

                // Step 2 — Get existing entries to delete
                .then(() => fetch(
                    `/employee/MyEntries?$filter=timesheet_timesheetId eq '${sTimesheetId}'&$select=entryId`,
                    { headers: { "Accept": "application/json" } }
                ))
                .then(r => r.ok ? r.json() : { value: [] })

                // Step 3 — Delete existing entries sequentially
                .then(data => {
                    const existing = data.value || [];
                    return existing.reduce((chain, e) =>
                        chain.then(() =>
                            fetch(`/employee/MyEntries('${e.entryId}')`, { method: "DELETE" })
                                .catch(() => { }) // ignore individual delete errors
                        ),
                        Promise.resolve()
                    );
                })

                // Step 4 — Insert new entries sequentially to avoid PK conflicts
                .then(() => entries.reduce((chain, entry) =>
                    chain.then(() =>
                        fetch("/employee/MyEntries", {
                            method: "POST", headers,
                            body: JSON.stringify(entry)
                        }).then(r => {
                            if (!r.ok) {
                                return r.text().then(t =>
                                    Promise.reject(new Error(`Entry POST failed ${r.status}: ${t}`))
                                );
                            }
                        })
                    ),
                    Promise.resolve()
                ))

                .then(() => sTimesheetId);
        },

        onHoursChange(oEvent) {
            const oInput = oEvent.getSource();
            const sRaw = oEvent.getParameter("value").trim();
            const sDayKey = oInput.data("day");
            const oContext = oInput.getBindingContext("rows");
            if (!oContext) return;

            const decimal = this._parseHHMM(sRaw);
            const sFormatted = decimal > 0 ? this._toHHMM(decimal) : "";

            this._oRowsModel.setProperty(oContext.getPath() + "/" + sDayKey, sFormatted);
            oInput.setValue(sFormatted);
            this._refreshTotals(this._oRowsModel.getProperty("/rows"));
        },

        _refreshTotals(rows) {
            const colDec = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
            rows.forEach(row => DAYS.forEach(d => { colDec[d] += this._parseHHMM(row[d]); }));

            const grand = DAYS.reduce((s, d) => s + colDec[d], 0);
            const totals = {};
            DAYS.forEach(d => { totals[d] = this._toHHMM(colDec[d]); });
            totals.total = this._toHHMM(grand);

            this._oViewModel.setProperty("/colTotals", totals);
            this._oViewModel.setProperty("/grandTotal", this._toHHMM(grand));

            const canSubmit = ["mon", "tue", "wed", "thu", "fri"].every(d => colDec[d] > 0);
            this._oViewModel.setProperty("/canSubmit", canSubmit);
        },

        _updateRowCount() {
            const n = this._oRowsModel.getProperty("/rows").length;
            this._oViewModel.setProperty("/rowCount", Math.max(n, 1));
        },

        formatNotLocked(bLocked) { return bLocked !== true; },
        formatDayEnabled(bLocked, bFuture) { return bLocked !== true && bFuture !== true; },

        formatRowTotal(...args) {
            const total = args.reduce((s, v) => s + this._parseHHMM(v), 0);
            return this._toHHMM(total);
        },

        formatValueState(sValue) { return sValue && sValue !== "" ? "Success" : "None"; },

        onViewToggle(oEvent) {
            if (oEvent.getParameter("item").getKey() === "day") {
                MessageToast.show("Day view – coming soon.");
            }
        },

        _parseHHMM(s) {
            if (!s || s === "") return 0;
            if (String(s).includes(":")) {
                const [h, m] = String(s).split(":");
                return (parseInt(h) || 0) + (parseInt(m) || 0) / 60;
            }
            return parseFloat(s) || 0;
        },

        _toHHMM(decimal) {
            const h = Math.floor(decimal);
            const m = Math.round((decimal - h) * 60);
            return `${h}:${String(m).padStart(2, "0")}`;
        },

        onNavToDashboard() {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        }
    });
});