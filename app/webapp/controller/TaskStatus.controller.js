sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], (Controller, JSONModel, Filter, FilterOperator) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const STATUS_STATE   = { "Open": "Information", "In Progress": "Warning", "Pending": "Warning", "Completed": "Success" };
    const STATUS_ICON    = {
        "Open":        "sap-icon://circle-task-2",
        "In Progress": "sap-icon://play",
        "Completed":   "sap-icon://accept",
        "Pending":     "sap-icon://pending"
    };

    function formatDate(sIso) {
        if (!sIso) return "—";
        try {
            const d = new Date(sIso);
            if (isNaN(d.getTime())) return sIso;
            return d.toLocaleDateString("en-GB",
                { day: "numeric", month: "short", year: "numeric" });
        } catch (e) { return sIso; }
    }

    function formatDateTime(sIso) {
        if (!sIso) return "—";
        try {
            const d = new Date(sIso);
            if (isNaN(d.getTime())) return sIso;
            return d.toLocaleString("en-GB",
                { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch (e) { return sIso; }
    }

    return Controller.extend("timesheet.app.controller.TaskStatus", {

        onInit() {
            this._oTsModel = new JSONModel({
                allTasks:           [],
                filteredTasks:      [],
                employees:          [],
                employeeFilterList: [{ employeeId: "", employeeName: "All employees" }],
                filterEmployee:     "",
                filterStatus:       "",
                searchQuery:        "",
                openCount:          0,
                inProgressCount:    0,
                completedCount:     0,
                totalLabel:         "0 tasks",
                isManagerView:      false
            });
            this.getView().setModel(this._oTsModel, "tsView");

            this.getOwnerComponent().getRouter()
                .getRoute("task-status")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        // Managers see every team member's tasks (with the employee filter);
        // employees/HR see only the tasks assigned to them.
        _resolveRole() {
            const oComp = this.getOwnerComponent();
            let sRole = (oComp._oCurrentUser && oComp._oCurrentUser.role) || "";
            if (!sRole) {
                try { sRole = (localStorage.getItem("tsRole") || "").toLowerCase(); } catch (e) { /* ignore */ }
            }
            return (sRole || "employee").toLowerCase();
        },

        _onRouteMatched() {
            // Personal view for everyone (managers included): this page shows
            // ONLY the logged-in user's own tasks. The all-employees view now
            // lives in the manager-only "Team Task Status" screen.
            this._oTsModel.setProperty("/isManagerView", false);
            this._oTsModel.setProperty("/employees", []);
            this._oTsModel.setProperty("/filterEmployee", "");
            // Resolve the user first so the self-scope filter has the right id.
            this.getOwnerComponent().getCurrentUser().then(() => this._loadTasks());
        },

        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return;
            oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    const list = aCtx.map(c => c.getObject())
                        .filter(e => e.isActive !== false)
                        .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
                    this._oTsModel.setProperty("/employees", list);
                    this._oTsModel.setProperty("/employeeFilterList",
                        [{ employeeId: "", employeeName: "All employees" }].concat(list));
                    this._applyFilter();
                })
                .catch(() => { });
        },

        _loadTasks() {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const local = (oTasksModel && oTasksModel.getProperty("/items")) || [];

            const oComp     = this.getOwnerComponent();
            const oModel    = oComp.getModel();
            const sSelfId   = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : null;

            const ownOnly = (list) => {
                if (!sSelfId) return list;
                return (list || []).filter(t => {
                    const tEmp = t.assignedTo_employeeId ||
                                 (t.assignedTo && t.assignedTo.employeeId) || t.assignedTo;
                    return tEmp === sSelfId;
                });
            };

            const finish = (remote) => {
                // Scope BOTH the local model and the remote result to self so the
                // list + counters only ever show the current user's own tasks.
                const merged = this._merge(ownOnly(local), ownOnly(remote || []));
                this._oTsModel.setProperty("/allTasks", merged);
                this._applyFilter();
            };

            if (!oModel) { finish([]); return; }

            // Always fetch only the current user's tasks.
            const aFilters = sSelfId
                ? [new Filter("assignedTo_employeeId", FilterOperator.EQ, sSelfId)]
                : [];

            oModel.bindList("/MyTasks", null, null, aFilters).requestContexts(0, 500)
                .then(aCtx => finish(aCtx.map(c => c.getObject())))
                .catch(() => finish([]));
        },

        _merge(local, remote) {
            // Remote (DB) wins on conflict — same reasoning as
            // TaskDescription._mergeTasks. Local entries only survive when
            // remote doesn't have them (offline / first-render case).
            const map = new Map();
            (local  || []).forEach(t => { if (t && t.taskId) map.set(t.taskId, t); });
            (remote || []).forEach(t => { if (t && t.taskId) map.set(t.taskId, t); });
            return Array.from(map.values());
        },

        // ── Filters ──────────────────────────────────────────────────────────

        onSearchTasks(oEvent) {
            this._oTsModel.setProperty("/searchQuery",
                (oEvent.getParameter("newValue") || "").toLowerCase());
            this._applyFilter();
        },

        onFilterChange()      { this._applyFilter(); },
        onStatusFilterChange(oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            this._oTsModel.setProperty("/filterStatus", sKey);
            this._applyFilter();
        },

        _applyFilter() {
            const tasks    = this._oTsModel.getProperty("/allTasks") || [];
            const sEmp     = this._oTsModel.getProperty("/filterEmployee") || "";
            const sStatus  = this._oTsModel.getProperty("/filterStatus") || "";
            const sQuery   = this._oTsModel.getProperty("/searchQuery") || "";

            const employees = this._oTsModel.getProperty("/employees") || [];
            const empMap = new Map(employees.map(e => [e.employeeId, e.employeeName]));

            const enriched = tasks
                // Group tasks are shown only in the dedicated Group Tasks view.
                .filter(t => t.taskType !== 'group')
                .map(t => {
                const empId = t.assignedTo_employeeId ||
                              (t.assignedTo && t.assignedTo.employeeId) ||
                              t.assignedTo;
                return Object.assign({}, t, {
                    assigneeName: empMap.get(empId) || "Unassigned",
                    assignedOnLabel: formatDate(t.assignedOn || t.createdAt || t.startDate),
                    statusUpdatedLabel: t.statusUpdatedAt ? formatDateTime(t.statusUpdatedAt) : "—"
                });
            });

            const filtered = enriched.filter(t => {
                const tEmp = t.assignedTo_employeeId ||
                             (t.assignedTo && t.assignedTo.employeeId) ||
                             t.assignedTo;
                if (sEmp     && tEmp !== sEmp)         return false;
                if (sStatus  && t.status !== sStatus)  return false;
                if (sQuery) {
                    const hay = ((t.taskName || "") + " " +
                                 (t.assigneeName || "") + " " +
                                 (t.taskId || "")).toLowerCase();
                    if (!hay.includes(sQuery)) return false;
                }
                return true;
            });

            // Sort: In Progress → Open → Pending → Completed; then assignedOn desc
            const RANK = { "In Progress": 0, "Open": 1, "Pending": 2, "Completed": 3 };
            filtered.sort((a, b) => {
                const ra = RANK[a.status] ?? 99;
                const rb = RANK[b.status] ?? 99;
                if (ra !== rb) return ra - rb;
                return (b.assignedOn || "").localeCompare(a.assignedOn || "");
            });

            this._oTsModel.setProperty("/filteredTasks", filtered);

            // Counters use the unfiltered set so the manager sees the whole picture
            this._oTsModel.setProperty("/openCount",
                enriched.filter(t => t.status === "Open").length);
            this._oTsModel.setProperty("/inProgressCount",
                enriched.filter(t => t.status === "In Progress").length);
            this._oTsModel.setProperty("/completedCount",
                enriched.filter(t => t.status === "Completed").length);
            this._oTsModel.setProperty("/totalLabel",
                enriched.length + (enriched.length === 1 ? " task tracked" : " tasks tracked"));
        },

        // ── Formatters / nav ─────────────────────────────────────────────────

        formatPriorityState(sValue) { return PRIORITY_STATE[sValue] || "None"; },
        formatStatusState(sValue)   { return STATUS_STATE[sValue]   || "None"; },
        formatStatusIcon(sValue)    { return STATUS_ICON[sValue]    || ""; },

        formatStatusAccentClass(sStatus) {
            const map = {
                "Open":        "tsAccentOpen",
                "In Progress": "tsAccentInProgress",
                "Completed":   "tsAccentCompleted",
                "Pending":     "tsAccentInProgress"
            };
            return map[sStatus] || "tsAccentDefault";
        },

        // ── Row navigation ───────────────────────────────────────────────────

        onRowPress(oEvent) {
            // Works for both itemPress (event has listItem) and the chevron
            // Button press (event source has the binding context).
            let oCtx = null;
            const oListItem = oEvent.getParameter && oEvent.getParameter("listItem");
            if (oListItem) oCtx = oListItem.getBindingContext("tsView");
            if (!oCtx && oEvent.getSource) oCtx = oEvent.getSource().getBindingContext("tsView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.taskId) return;
            // Opening from Task Status is view-only — no "Post an update" form.
            this.getOwnerComponent()._bAllowTaskPost = false;
            this.getOwnerComponent()._taskDetailSource = "task-status";
            this.getOwnerComponent().getRouter()
                .navTo("task-detail", { taskId: task.taskId });
        },

        formatStatusPillClass(sStatus) {
            const map = {
                "Open":        "tsPillOpen",
                "In Progress": "tsPillInProgress",
                "Completed":   "tsPillCompleted",
                "Pending":     "tsPillInProgress"
            };
            return map[sStatus] || "tsPillDefault";
        }
    });
});
