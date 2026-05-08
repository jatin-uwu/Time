sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Popover",
    "sap/ui/unified/Calendar"
], (Controller, JSONModel, MessageToast, MessageBox, Popover, Calendar) => {
    "use strict";

    const DAYS      = ["mon","tue","wed","thu","fri","sat","sun"];
    const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const EMPTY_APPROVED = () => ({ mon:false, tue:false, wed:false, thu:false, fri:false, sat:false, sun:false });

    const EMPTY_ROW = () => ({
        projectName: "", taskName: "", taskId: "",
        mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"",
        locked:   { mon:false, tue:false, wed:false, thu:false, fri:false, sat:false, sun:false },
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

    return Controller.extend("timesheet.app.controller.Timesheet", {

        onInit() {
            this._oViewModel = new JSONModel({
                weekStart:       null,
                weekStartFilter: "",
                weekRangeLabel:  "",
                grandTotal:      "0:00",
                canSubmit:       false,
                rowCount:        1,
                canGoPrev:       false,
                canGoNext:       false,
                days:            [],
                colTotals: { mon:"0:00", tue:"0:00", wed:"0:00", thu:"0:00",
                             fri:"0:00", sat:"0:00", sun:"0:00", total:"0:00" }
            });
            this.getView().setModel(this._oViewModel, "view");

            this._oRowsModel = new JSONModel({ rows: [EMPTY_ROW()] });
            this.getView().setModel(this._oRowsModel, "rows");

            this._oTasksModel = new JSONModel([]);
            this.getView().setModel(this._oTasksModel, "tasks");

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

            this._oViewModel.setProperty("/weekStart",       start);
            this._oViewModel.setProperty("/weekStartFilter", sFilter);
            this._oViewModel.setProperty("/weekRangeLabel",  `${toShortLabel(start)} - ${toShortLabel(end)}`);
            this._oViewModel.setProperty("/days",            buildDayLabels(start));
            this._oViewModel.setProperty("/canGoPrev",       start.getTime() > minWeek.getTime());
            this._oViewModel.setProperty("/canGoNext",       start.getTime() < maxWeek.getTime());

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
            const maxWeek = getAllowedMaxWeek();
            let   start   = getWeekStart(date);

            if (start.getTime() < minWeek.getTime()) start = new Date(minWeek);
            if (start.getTime() > maxWeek.getTime()) start = new Date(maxWeek);

            const end = new Date(start);
            end.setDate(start.getDate() + 6);

            this._oViewModel.setProperty("/weekStart",       start);
            this._oViewModel.setProperty("/weekStartFilter", toDateString(start));
            this._oViewModel.setProperty("/weekRangeLabel",  `${toShortLabel(start)} - ${toShortLabel(end)}`);
            this._oViewModel.setProperty("/days",            buildDayLabels(start));
            this._oViewModel.setProperty("/canGoPrev",       start.getTime() > minWeek.getTime());
            this._oViewModel.setProperty("/canGoNext",       start.getTime() < maxWeek.getTime());

            this._loadTimesheetData();
        },

        onCalendarPress(oEvent) {
            if (!this._oCalPopover) {
                const minWeek    = getAllowedMinWeek();
                const maxWeekEnd = new Date(getAllowedMaxWeek());
                maxWeekEnd.setDate(maxWeekEnd.getDate() + 6);

                this._oDashCal = new Calendar({
                    minDate: minWeek,
                    maxDate: maxWeekEnd,
                    select:  this.onCalendarWeekSelect.bind(this)
                });
                this._oCalPopover = new Popover({
                    showHeader: false,
                    placement:  "Bottom",
                    content:    [this._oDashCal]
                });
                this.getView().addDependent(this._oCalPopover);
            }
            this._oCalPopover.openBy(oEvent.getSource());
        },

        onCalendarWeekSelect(oEvent) {
            const oCal   = oEvent.getSource();
            const aDates = oCal.getSelectedDates();
            if (!aDates || !aDates.length) return;
            const oStart = aDates[0].getStartDate();
            if (!oStart) return;
            this._oCalPopover.close();
            this._setWeek(new Date(oStart));
        },

        _loadTimesheetData() {
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");

            const oLocksModel = this.getOwnerComponent().getModel("locked");
            const savedWeek   = oLocksModel.getProperty("/" + sWeekStart);

            if (savedWeek) {
                this._setRows(savedWeek);
                return;
            }

            const weekStart = this._oViewModel.getProperty("/weekStart");
            const weekDates = DAYS.map((_, i) => {
                const d = new Date(weekStart);
                d.setDate(weekStart.getDate() + i);
                return toDateString(d);
            });

            const oModel   = this.getOwnerComponent().getModel();
            const oBinding = oModel.bindList("/MyEntries", null, null, null, {
                $expand: "task",
                $filter: `timesheet/weekStartDate eq ${sWeekStart}`
            });

            oBinding.requestContexts(0, 200)
                .then(aCtx => {
                    const entries = aCtx.map(c => c.getObject());
                    this._setRows(entries.length > 0
                        ? this._pivotEntries(entries, weekDates)
                        : [EMPTY_ROW()]);
                })
                .catch(() => this._setRows([EMPTY_ROW()]));
        },

        _pivotEntries(entries, weekDates) {
            const rowMap = new Map();
            for (const entry of entries) {
                const taskId   = entry.task_taskId ?? "unknown";
                const taskName = entry.task?.taskName ?? "Unknown Task";
                const taskDesc = entry.task?.taskDescription ?? "";

                if (!rowMap.has(taskId)) {
                    rowMap.set(taskId, { taskId, projectName: taskName, taskName: taskDesc,
                        mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 });
                }
                const idx = weekDates.indexOf(entry.workDate);
                if (idx >= 0) rowMap.get(taskId)[DAYS[idx]] += parseFloat(entry.hoursWorked) || 0;
            }

            return Array.from(rowMap.values()).map(row => {
                const r = {
                    taskId:      row.taskId || "",
                    projectName: row.projectName,
                    taskName:    row.taskName,
                    locked:   { mon:false, tue:false, wed:false, thu:false, fri:false, sat:false, sun:false },
                    approved: EMPTY_APPROVED(),
                    _rowLocked: false
                };
                DAYS.forEach(d => { r[d] = row[d] > 0 ? this._toHHMM(row[d]) : ""; });
                return r;
            });
        },

        _fallbackTasks: [
            { taskId: "TASK001", taskName: "UI Development",  taskDescription: "Build weekly timesheet UI" },
            { taskId: "TASK002", taskName: "CAP Backend",     taskDescription: "Create CAP service and entities" },
            { taskId: "TASK003", taskName: "HR Review",       taskDescription: "Employee onboarding checklist" },
            { taskId: "TASK004", taskName: "Sales Followup",  taskDescription: "Client meeting updates" }
        ],

        _loadTasks() {
            const oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/MyTasks").requestContexts(0, 200)
                .then(aCtx => {
                    const tasks = aCtx.map(c => c.getObject());
                    this._oTasksModel.setData(tasks.length > 0 ? tasks : this._fallbackTasks);
                })
                .catch(() => {
                    this._oTasksModel.setData(this._fallbackTasks);
                });
        },

        onTaskSelect(oEvent) {
            const oComboBox = oEvent.getSource();
            const sKey      = oComboBox.getSelectedKey();
            const oContext  = oComboBox.getBindingContext("rows");
            if (!oContext) return;

            const sPath = oContext.getPath();
            if (sKey) {
                const task = this._oTasksModel.getData().find(t => t.taskId === sKey);
                if (task) {
                    this._oRowsModel.setProperty(sPath + "/taskId",      task.taskId);
                    this._oRowsModel.setProperty(sPath + "/projectName", task.taskName);
                    this._oRowsModel.setProperty(sPath + "/taskName",    task.taskDescription || "");
                }
            } else {
                this._oRowsModel.setProperty(sPath + "/taskId",      "");
                this._oRowsModel.setProperty(sPath + "/projectName", "");
                this._oRowsModel.setProperty(sPath + "/taskName",    "");
            }
        },

        _setRows(rows) {
            this._oRowsModel.setProperty("/rows", rows);
            this._refreshTotals(rows);
            this._updateRowCount();
        },

        onAddRow() {
            const rows = this._oRowsModel.getProperty("/rows");
            rows.push(EMPTY_ROW());
            this._oRowsModel.setProperty("/rows", rows);
            this._updateRowCount();
        },

        onSave() {
            const rows       = this._oRowsModel.getProperty("/rows");
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");

            const oLocksModel = this.getOwnerComponent().getModel("locked");
            const allLocks    = oLocksModel.getData();
            allLocks[sWeekStart] = JSON.parse(JSON.stringify(rows));
            oLocksModel.setData(allLocks);
            this.getOwnerComponent().persistLocked();

            MessageToast.show("Draft saved. You can continue filling the rest of the week.");
        },

        onSubmit() {
            const rows = this._oRowsModel.getProperty("/rows");

            const colDec = { mon:0, tue:0, wed:0, thu:0, fri:0 };
            rows.forEach(r => ["mon","tue","wed","thu","fri"].forEach(d => { colDec[d] += this._parseHHMM(r[d]); }));
            const missingDays = ["mon","tue","wed","thu","fri"].filter(d => colDec[d] === 0);
            if (missingDays.length > 0) {
                const names = { mon:"Monday", tue:"Tuesday", wed:"Wednesday", thu:"Thursday", fri:"Friday" };
                MessageBox.error(
                    "Please fill hours for: " + missingDays.map(d => names[d]).join(", ") + ".\n" +
                    "Monday to Friday must all have hours before submitting.",
                    { title: "Incomplete Timesheet" }
                );
                return;
            }

            const invalidRows = rows.filter(r =>
                DAYS.some(d => r[d] && r[d] !== "" && !r.locked[d]) && !r.taskId
            );
            if (invalidRows.length > 0) {
                MessageBox.error(
                    `${invalidRows.length} row(s) have hours entered but no task selected.\n` +
                    "Please choose a task from the dropdown for each filled row before submitting.",
                    { title: "Task Required" }
                );
                return;
            }

            const hasNew = rows.some(r => DAYS.some(d => r[d] && !r.locked[d]));
            if (!hasNew) {
                MessageToast.show("No new hours to submit.");
                return;
            }

            MessageBox.confirm(
                `Send timesheet for ${this._oViewModel.getProperty("/weekRangeLabel")} for approval?\n` +
                "Your timesheet will be sent to your manager for review.",
                {
                    title:    "Send for Approval",
                    actions:  [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: (sAction) => {
                        if (sAction === MessageBox.Action.OK) this._doSubmit(rows);
                    }
                }
            );
        },

        _doSubmit(rows) {
            const sWeekStart = this._oViewModel.getProperty("/weekStartFilter");

            const updatedRows = rows.map(row => {
                const locked   = { ...row.locked };
                const approved = { ...(row.approved || EMPTY_APPROVED()) };
                DAYS.forEach(d => { if (row[d] && row[d] !== "") locked[d] = true; });
                return { ...row, locked, approved, _rowLocked: DAYS.some(d => locked[d]) };
            });

            const oLocksModel = this.getOwnerComponent().getModel("locked");
            const allLocks    = oLocksModel.getData();
            allLocks[sWeekStart] = updatedRows;
            oLocksModel.setData(allLocks);

            this._oRowsModel.setProperty("/rows", updatedRows);

            const oHistoryModel = this.getOwnerComponent().getModel("history");
            const submissions   = oHistoryModel.getProperty("/submissions");
            const existingIdx   = submissions.findIndex(s => s.weekStart === sWeekStart);

            const sSubmitterId = this.getOwnerComponent().getCurrentEmployeeId();
            const record = {
                employeeName:   "Employee",
                submittedBy:    sSubmitterId,
                weekRange:      this._oViewModel.getProperty("/weekRangeLabel"),
                weekStart:      sWeekStart,
                submittedOn:    new Date().toLocaleString(),
                grandTotal:     this._oViewModel.getProperty("/grandTotal"),
                days:           this._oViewModel.getProperty("/days"),
                rows:           JSON.parse(JSON.stringify(updatedRows)),
                status:  "Pending",
                remarks: ""
            };

            // Resolve the submitter's display name + reporting manager so
            // approve/reject notifications can be routed properly later.
            this.getOwnerComponent().getEmployeeById(sSubmitterId).then(emp => {
                if (!emp) return;
                const subs = oHistoryModel.getProperty("/submissions") || [];
                const idx = subs.findIndex(s => s.weekStart === sWeekStart);
                if (idx < 0) return;
                subs[idx].employeeName = emp.employeeName || subs[idx].employeeName;
                subs[idx].reportsTo    = (emp.manager && emp.manager.employeeId) || emp.manager_employeeId || null;
                oHistoryModel.setProperty("/submissions", subs);
                this.getOwnerComponent().persistHistory();
            });

            if (existingIdx >= 0) {
                submissions[existingIdx] = record;
            } else {
                submissions.unshift(record);
            }
            oHistoryModel.setProperty("/submissions", submissions);

            this.getOwnerComponent().persistHistory();
            this.getOwnerComponent().persistLocked();

            MessageToast.show("Sent for approval! Your manager will review your timesheet.");
        },

        onHoursChange(oEvent) {
            const oInput   = oEvent.getSource();
            const sRaw     = oEvent.getParameter("value").trim();
            const sDayKey  = oInput.data("day");
            const oContext = oInput.getBindingContext("rows");
            if (!oContext) return;

            const decimal    = this._parseHHMM(sRaw);
            const sFormatted = decimal > 0 ? this._toHHMM(decimal) : "";

            this._oRowsModel.setProperty(oContext.getPath() + "/" + sDayKey, sFormatted);
            oInput.setValue(sFormatted);
            this._refreshTotals(this._oRowsModel.getProperty("/rows"));
        },

        _refreshTotals(rows) {
            const colDec = { mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 };
            rows.forEach(row => DAYS.forEach(d => { colDec[d] += this._parseHHMM(row[d]); }));

            const grand  = DAYS.reduce((s, d) => s + colDec[d], 0);
            const totals = {};
            DAYS.forEach(d => { totals[d] = this._toHHMM(colDec[d]); });
            totals.total = this._toHHMM(grand);

            this._oViewModel.setProperty("/colTotals",  totals);
            this._oViewModel.setProperty("/grandTotal", this._toHHMM(grand));

            const canSubmit = ["mon","tue","wed","thu","fri"].every(d => colDec[d] > 0);
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
