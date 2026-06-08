sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "timesheet/app/util/TimesheetPreview"
], (Controller, JSONModel, TimesheetPreview) => {
    "use strict";

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const STATUS_STATE = { "Pending": "Warning", "Submitted": "Warning", "Approved": "Success", "Rejected": "Error" };

    function toShortLabel(date) {
        return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    }

    return Controller.extend("timesheet.app.controller.ApprovalHistory", {

        onInit() {
            this._oModel = new JSONModel({
                activeTab:            "timesheets",
                empSearch:            "",
                statusFilter:         "",
                leaveTypeFilter:      "",
                dateFrom:             "",
                dateTo:               "",
                timesheetRecords:     [],
                prevWeekRecords:      [],
                leaveRecords:         [],
                allTimesheetRecords:  [],
                allPrevWeekRecords:   [],
                allLeaveRecords:      []
            });
            this.getView().setModel(this._oModel, "approvalHistView");

            this.getOwnerComponent().getRouter()
                .getRoute("approval-history")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._resetFiltersInternal();
            this._loadAll();
        },

        _loadAll() {
            this._pTeamIds = null; // refresh team scope on each (re)load
            this._loadTimesheetHistory();
            this._loadPrevWeekHistory();
            this._loadLeaveHistory();
        },

        // Set of employeeIds reporting to the logged-in manager.
        // /manager/Employees has a READ handler that already returns only the
        // manager's active direct reports — we reuse it to scope all 3 tabs.
        _getTeamIds() {
            if (this._pTeamIds) return this._pTeamIds;
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) { this._pTeamIds = Promise.resolve(null); return this._pTeamIds; }
            this._pTeamIds = oMgrModel.bindList("/Employees").requestContexts(0, 500)
                .then(aCtx => new Set(aCtx.map(c => c.getObject()).filter(Boolean).map(e => e.employeeId)))
                .catch(() => null); // null → no scoping (show all) rather than break
            return this._pTeamIds;
        },

        // Resolve an employee name via the component cache / builtin directory.
        _resolveName(sEmpId) {
            const oComp = this.getOwnerComponent();
            if (oComp.getEmployeeById) {
                return oComp.getEmployeeById(sEmpId)
                    .then(emp => (emp && emp.employeeName) || sEmpId)
                    .catch(() => sEmpId);
            }
            return Promise.resolve(sEmpId);
        },

        // ── Timesheet History ─────────────────────────────────────────────
        // FIX: PendingApprovals only returns status='Pending', so approved/
        // rejected history was never shown. Read ALL headers from /MyTimesheets
        // (unscoped projection) and scope to the manager's team client-side.
        _loadTimesheetHistory() {
            const oModel = this.getOwnerComponent().getModel(); // default /employee
            if (!oModel) return;

            Promise.all([
                this._getTeamIds(),
                oModel.bindList("/MyTimesheets").requestContexts(0, 1000)
            ])
                .then(([teamIds, aCtx]) => {
                    let all = aCtx.map(c => c.getObject()).filter(Boolean);
                    // Only items that went through (or are in) the approval flow.
                    all = all.filter(ts => ts.status && ts.status !== "Draft" && ts.status !== "PrevWeekApproved");
                    if (teamIds) all = all.filter(ts => teamIds.has(ts.employee_employeeId));
                    return Promise.all(all.map(ts =>
                        this._resolveName(ts.employee_employeeId).then(name => { ts.__name = name; return ts; })
                    ));
                })
                .then(rows => {
                    const records = rows.map(ts => {
                        const ws = ts.weekStartDate ? new Date(ts.weekStartDate + "T00:00:00") : null;
                        const we = ts.weekEndDate   ? new Date(ts.weekEndDate   + "T00:00:00") : null;
                        const decisionOn = ts.approvedOn || ts.rejectedOn || null;
                        return {
                            employeeName: ts.__name || ts.employee_employeeId || "—",
                            weekRange:    ws && we ? `${toShortLabel(ws)} – ${toShortLabel(we)}` : ts.weekStartDate || "",
                            submittedOn:  ts.submittedOn ? new Date(ts.submittedOn).toLocaleString() : "",
                            status:       ts.status || "—",
                            remarks:      ts.remarks || "",
                            weekStartDate: ts.weekStartDate || "",
                            // ── For the read-only preview ──
                            timesheetId:  ts.timesheetId || "",
                            employeeId:   ts.employee_employeeId || "",
                            approvalDate: decisionOn ? new Date(decisionOn).toLocaleString() : ""
                        };
                    });
                    records.sort((a, b) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""));
                    this._oModel.setProperty("/allTimesheetRecords", records);
                    this._applyTimesheetFilter();
                })
                .catch(err => console.error("ApprovalHistory: failed to load timesheet history:", err));
        },

        // ── Prev-Week History ─────────────────────────────────────────────
        _loadPrevWeekHistory() {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;

            Promise.all([
                this._getTeamIds(),
                oMgrModel.bindList("/PrevWeekRequests").requestContexts(0, 500)
            ])
                .then(([teamIds, aCtx]) => {
                    let all = aCtx.map(c => c.getObject()).filter(Boolean);
                    if (teamIds) all = all.filter(r => teamIds.has(r.employee_employeeId));
                    return Promise.all(all.map(r =>
                        this._resolveName(r.employee_employeeId).then(name => { r.employeeName = name; return r; })
                    ));
                })
                .then(enriched => {
                    const records = enriched.map(r => {
                        const ws = r.weekStartDate ? new Date(r.weekStartDate + "T00:00:00") : null;
                        const we = r.weekEndDate   ? new Date(r.weekEndDate   + "T00:00:00") : null;
                        return {
                            employeeName:    r.employeeName || r.employee_employeeId || "—",
                            weekRange:       ws && we ? `${toShortLabel(ws)} – ${toShortLabel(we)}` : r.weekStartDate || "",
                            requestedOn:     r.requestedOn ? new Date(r.requestedOn).toLocaleString() : "",
                            employeeRemarks: r.employeeRemarks || "",
                            status:          r.status || "—",
                            managerRemarks:  r.managerRemarks || r.remarks || "",
                            weekStartDate:   r.weekStartDate || ""
                        };
                    });
                    records.sort((a, b) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""));
                    this._oModel.setProperty("/allPrevWeekRecords", records);
                    this._applyPrevWeekFilter();
                })
                .catch(err => console.error("ApprovalHistory: failed to load prev-week history:", err));
        },

        // ── Leave History ─────────────────────────────────────────────────
        _loadLeaveHistory() {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;

            Promise.all([
                this._getTeamIds(),
                oMgrModel.bindList("/LeaveRequests").requestContexts(0, 500)
            ])
                .then(([teamIds, aCtx]) => {
                    let all = aCtx.map(c => c.getObject()).filter(Boolean);
                    if (teamIds) all = all.filter(r => teamIds.has(r.employee_employeeId));
                    return Promise.all(all.map(r =>
                        this._resolveName(r.employee_employeeId).then(name => { r.employeeName = name; return r; })
                    ));
                })
                .then(enriched => {
                    const records = enriched.map(r => ({
                        employeeName: r.employeeName || r.employee_employeeId || "—",
                        leaveType:    r.leaveType  || "—",
                        fromDate:     r.fromDate   || "",
                        toDate:       r.toDate     || "",
                        days:         r.days       || 0,
                        reason:       r.reason     || "",
                        status:       r.status     || "—",
                        remarks:      r.managerRemarks || r.remarks || ""
                    }));
                    records.sort((a, b) => (b.fromDate || "").localeCompare(a.fromDate || ""));
                    this._oModel.setProperty("/allLeaveRecords", records);
                    this._applyLeaveFilter();
                })
                .catch(err => console.error("ApprovalHistory: failed to load leave history:", err));
        },

        // ── Tab select ────────────────────────────────────────────────────
        onTabSelect(oEvent) {
            this._oModel.setProperty("/activeTab", oEvent.getParameter("selectedItem").getKey());
        },

        // ── Filter handlers ───────────────────────────────────────────────
        onEmployeeSearch(oEvent) {
            this._oModel.setProperty("/empSearch", oEvent.getParameter("query") || "");
            this._applyCurrentFilter();
        },

        onEmployeeSearchLive(oEvent) {
            this._oModel.setProperty("/empSearch", oEvent.getParameter("newValue") || "");
            this._applyCurrentFilter();
        },

        onStatusFilter(oEvent) {
            this._oModel.setProperty("/statusFilter", oEvent.getParameter("selectedItem").getKey());
            this._applyCurrentFilter();
        },

        onLeaveTypeFilter(oEvent) {
            this._oModel.setProperty("/leaveTypeFilter", oEvent.getParameter("selectedItem").getKey());
            this._applyLeaveFilter();
        },

        onDateFromChange(oEvent) {
            this._oModel.setProperty("/dateFrom", oEvent.getParameter("value") || "");
            this._applyCurrentFilter();
        },

        onDateToChange(oEvent) {
            this._oModel.setProperty("/dateTo", oEvent.getParameter("value") || "");
            this._applyCurrentFilter();
        },

        onResetFilters() {
            this._resetFiltersInternal();
            this._applyAllFilters();
        },

        _resetFiltersInternal() {
            this._oModel.setProperty("/empSearch",       "");
            this._oModel.setProperty("/statusFilter",    "");
            this._oModel.setProperty("/leaveTypeFilter", "");
            this._oModel.setProperty("/dateFrom",        "");
            this._oModel.setProperty("/dateTo",          "");
            const controls = ["empSearchField", "statusSelect", "leaveTypeSelect", "dateFromPicker", "dateToPicker"];
            controls.forEach(id => {
                const oCtrl = this.byId(id);
                if (oCtrl && oCtrl.setValue) oCtrl.setValue("");
                if (oCtrl && oCtrl.setSelectedKey) oCtrl.setSelectedKey("");
            });
        },

        // ── Filter application ────────────────────────────────────────────
        _applyCurrentFilter() {
            const sTab = this._oModel.getProperty("/activeTab");
            if      (sTab === "timesheets") this._applyTimesheetFilter();
            else if (sTab === "prevweek")   this._applyPrevWeekFilter();
            else                            this._applyLeaveFilter();
        },

        _applyAllFilters() {
            this._applyTimesheetFilter();
            this._applyPrevWeekFilter();
            this._applyLeaveFilter();
        },

        _applyTimesheetFilter() {
            const all    = this._oModel.getProperty("/allTimesheetRecords") || [];
            const search = (this._oModel.getProperty("/empSearch") || "").toLowerCase();
            const status = this._oModel.getProperty("/statusFilter") || "";
            const filtered = all.filter(r => {
                if (search && !(r.employeeName || "").toLowerCase().includes(search)) return false;
                if (status && r.status !== status) return false;
                return true;
            });
            this._oModel.setProperty("/timesheetRecords", filtered);
        },

        _applyPrevWeekFilter() {
            const all    = this._oModel.getProperty("/allPrevWeekRecords") || [];
            const search = (this._oModel.getProperty("/empSearch") || "").toLowerCase();
            const status = this._oModel.getProperty("/statusFilter") || "";
            const dFrom  = this._oModel.getProperty("/dateFrom") || "";
            const dTo    = this._oModel.getProperty("/dateTo")   || "";
            const filtered = all.filter(r => {
                if (search && !(r.employeeName || "").toLowerCase().includes(search)) return false;
                if (status && r.status !== status) return false;
                if (dFrom  && r.weekStartDate && r.weekStartDate < dFrom) return false;
                if (dTo    && r.weekStartDate && r.weekStartDate > dTo)   return false;
                return true;
            });
            this._oModel.setProperty("/prevWeekRecords", filtered);
        },

        _applyLeaveFilter() {
            const all       = this._oModel.getProperty("/allLeaveRecords") || [];
            const search    = (this._oModel.getProperty("/empSearch")       || "").toLowerCase();
            const status    = this._oModel.getProperty("/statusFilter")    || "";
            const leaveType = this._oModel.getProperty("/leaveTypeFilter") || "";
            const dFrom     = this._oModel.getProperty("/dateFrom")        || "";
            const dTo       = this._oModel.getProperty("/dateTo")          || "";
            const filtered = all.filter(r => {
                if (search    && !(r.employeeName || "").toLowerCase().includes(search)) return false;
                if (status    && r.status    !== status)    return false;
                if (leaveType && r.leaveType !== leaveType) return false;
                if (dFrom     && r.fromDate  && r.fromDate < dFrom) return false;
                if (dTo       && r.toDate    && r.toDate   > dTo)   return false;
                return true;
            });
            this._oModel.setProperty("/leaveRecords", filtered);
        },

        // ── Refresh ───────────────────────────────────────────────────────
        onRefresh() {
            this._loadAll();
        },

        // ── View a submitted timesheet (read-only preview) ────────────────
        onViewTimesheet(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("approvalHistView")
                || (oEvent.getParameter("listItem") && oEvent.getParameter("listItem").getBindingContext("approvalHistView"));
            if (!oCtx) return;
            const r = oCtx.getObject();
            TimesheetPreview.open(this.getOwnerComponent(), {
                timesheetId:  r.timesheetId,
                employeeName: r.employeeName,
                employeeId:   r.employeeId,
                weekRange:    r.weekRange,
                weekStart:    r.weekStartDate,
                submittedOn:  r.submittedOn,
                status:       r.status,
                remarks:      r.remarks,
                approvalDate: r.approvalDate
            });
        },

        // ── Formatter ─────────────────────────────────────────────────────
        formatStatusState(sStatus) {
            return STATUS_STATE[sStatus] || "None";
        }
    });
});
