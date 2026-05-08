sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], (Controller, JSONModel) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const STATUS_STATE   = { "Open": "Information", "In Progress": "Warning", "Pending": "Warning", "Completed": "Success" };
    const PRIORITY_RANK  = { "High": 0, "Medium": 1, "Low": 2 };

    function formatDueLabel(sDue) {
        if (!sDue) return "No due date";
        try {
            const d = new Date(sDue);
            if (isNaN(d.getTime())) return sDue;
            return "Due " + d.toLocaleDateString("en-GB",
                { day: "numeric", month: "short", year: "numeric" });
        } catch (e) { return sDue; }
    }

    return Controller.extend("timesheet.app.controller.TaskDescription", {

        onInit() {
            this._oTdModel = new JSONModel({
                allTasks:           [],
                displayTasks:       [],
                employees:          [],
                employeeFilterList: [{ employeeId: "__me", employeeName: "My tasks" }],
                viewAsEmployee:     "__me",
                priorityFilter:     "",
                searchQuery:        "",
                totalLabel:         "0 tasks"
            });
            this.getView().setModel(this._oTdModel, "tdView");

            this.getOwnerComponent().getRouter()
                .getRoute("task-description")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._loadEmployees();
            this._loadTasks();
        },

        // ── Loading ──────────────────────────────────────────────────────────

        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return;
            oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    const list = aCtx.map(c => c.getObject())
                        .filter(e => e.isActive !== false)
                        .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
                    this._oTdModel.setProperty("/employees", list);
                    this._oTdModel.setProperty("/employeeFilterList",
                        [{ employeeId: "__me", employeeName: "My tasks" }].concat(list));
                })
                .catch(() => { /* ignore — manager-only feature */ });
        },

        _loadTasks() {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const local = (oTasksModel && oTasksModel.getProperty("/items")) || [];

            // Try backend (MyTasks) too — merge so both sources show up.
            const oModel = this.getOwnerComponent().getModel();
            const finish = (remote) => {
                const merged = this._mergeTasks(local, remote || []);
                this._oTdModel.setProperty("/allTasks", merged);
                this._applyFilter();
            };

            if (!oModel) { finish([]); return; }

            oModel.bindList("/MyTasks").requestContexts(0, 500)
                .then(aCtx => finish(aCtx.map(c => c.getObject())))
                .catch(() => finish([]));
        },

        _mergeTasks(local, remote) {
            const map = new Map();
            (remote || []).forEach(t => map.set(t.taskId, t));
            (local  || []).forEach(t => map.set(t.taskId, t));
            return Array.from(map.values());
        },

        // ── Filters ──────────────────────────────────────────────────────────

        onSearch(oEvent) {
            this._oTdModel.setProperty("/searchQuery",
                (oEvent.getParameter("newValue") || "").toLowerCase());
            this._applyFilter();
        },

        onPriorityFilterChange(oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            this._oTdModel.setProperty("/priorityFilter", sKey);
            this._applyFilter();
        },

        onEmployeeFilterChange() {
            this._applyFilter();
        },

        _currentEmployeeId() {
            const userRole = (this.getView().getModel("appView") &&
                              this.getView().getModel("appView").getProperty("/userRole")) ||
                             this.getOwnerComponent().getModel("appView") &&
                             this.getOwnerComponent().getModel("appView").getProperty("/userRole");

            const sViewAs  = this._oTdModel.getProperty("/viewAsEmployee");

            // Manager previewing a specific employee
            if (userRole === "manager" && sViewAs && sViewAs !== "__me") {
                return sViewAs;
            }
            // For employees we don't know the actual logged-in employeeId
            // (no auth wired). Return null → show all assigned to anyone the
            // employee could be. Falls back to "show all" behaviour for now.
            return null;
        },

        _applyFilter() {
            const all      = this._oTdModel.getProperty("/allTasks") || [];
            const sQuery   = this._oTdModel.getProperty("/searchQuery") || "";
            const sPrio    = this._oTdModel.getProperty("/priorityFilter") || "";
            const sEmpId   = this._currentEmployeeId();

            const employees = this._oTdModel.getProperty("/employees") || [];
            const empMap = new Map(employees.map(e => [e.employeeId, e.employeeName]));

            const filtered = all
                .filter(t => {
                    const tEmp = t.assignedTo_employeeId ||
                                 (t.assignedTo && t.assignedTo.employeeId) ||
                                 t.assignedTo;
                    if (sEmpId && tEmp !== sEmpId) return false;
                    if (sPrio && t.priority !== sPrio) return false;
                    if (sQuery) {
                        const hay = ((t.taskName || "") + " " +
                                     (t.taskDescription || "") + " " +
                                     (t.taskId || "")).toLowerCase();
                        if (!hay.includes(sQuery)) return false;
                    }
                    return true;
                })
                .map(t => Object.assign({}, t, {
                    assigneeName: empMap.get(
                        t.assignedTo_employeeId ||
                        (t.assignedTo && t.assignedTo.employeeId) ||
                        t.assignedTo
                    ) || "Unassigned",
                    dueLabel: formatDueLabel(t.dueDate)
                }))
                .sort((a, b) => {
                    const ra = PRIORITY_RANK[a.priority] ?? 99;
                    const rb = PRIORITY_RANK[b.priority] ?? 99;
                    if (ra !== rb) return ra - rb;
                    // Within same priority, earliest due date first
                    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                    return da - db;
                });

            this._oTdModel.setProperty("/displayTasks", filtered);
            this._oTdModel.setProperty("/totalLabel",
                filtered.length + (filtered.length === 1 ? " task" : " tasks"));
        },

        // ── Download manager-attached file ────────────────────────────────────
        // Tries the server first (single-shot consume — backend frees the
        // bytes after a successful download). Falls back to a local data URL
        // when running in pure local-dev with no backend write.
        onDownloadTaskAttachment(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.taskId) return;

            const showError = (msg) => sap.ui.require(["sap/m/MessageToast"], (T) => T.show(msg));
            const triggerDownload = (dataUrl, name) => {
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = name || "attachment";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            };

            // Hide the link in the local UI as soon as the bytes are consumed.
            const markConsumed = () => {
                const oTasksModel = this.getOwnerComponent().getModel("tasks");
                const items = (oTasksModel.getProperty("/items") || []).slice();
                const idx = items.findIndex(t => t.taskId === task.taskId);
                if (idx >= 0) {
                    items[idx] = Object.assign({}, items[idx], {
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: ""
                    });
                    oTasksModel.setProperty("/items", items);
                    this.getOwnerComponent().persistTasks();
                }
                this._loadTasks && this._loadTasks();
            };

            fetch("/employee/consumeTaskAttachment", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify({ taskId: task.taskId })
            })
                .then(r => {
                    if (r.ok) return r.json();
                    if (r.status === 404 && task.attachmentDataUrl) {
                        // Fallback: backend has nothing, but the file is still
                        // in this browser's local store (local-dev mode).
                        triggerDownload(task.attachmentDataUrl, task.attachmentName);
                        markConsumed();
                        return null;
                    }
                    return Promise.reject(r.status);
                })
                .then(data => {
                    if (!data) return;
                    const v = data.value || data;
                    if (!v || !v.dataBase64) {
                        showError("Attachment is not available for download.");
                        return;
                    }
                    triggerDownload("data:" + (v.mimeType || "application/octet-stream") + ";base64," + v.dataBase64,
                                    v.fileName);
                    markConsumed();
                })
                .catch(() => {
                    if (task.attachmentDataUrl) {
                        triggerDownload(task.attachmentDataUrl, task.attachmentName);
                        markConsumed();
                    } else {
                        showError("Attachment is not available for download.");
                    }
                });
        },

        // ── Open detail page ─────────────────────────────────────────────────

        onOpenDetails(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.taskId) return;
            this.getOwnerComponent().getRouter()
                .navTo("task-detail", { taskId: task.taskId });
        },

        // ── Status updates by employee ───────────────────────────────────────

        onSetStatusOpen(oEvent)        { this._setStatusFromEvent(oEvent, "Open"); },
        onSetStatusInProgress(oEvent)  { this._setStatusFromEvent(oEvent, "In Progress"); },
        onSetStatusCompleted(oEvent)   { this._setStatusFromEvent(oEvent, "Completed"); },

        _setStatusFromEvent(oEvent, sStatus) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || task.status === sStatus) return;

            this._updateTaskStatus(task.taskId, sStatus);
        },

        _updateTaskStatus(sTaskId, sStatus) {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const items = (oTasksModel.getProperty("/items") || []).slice();
            const idx = items.findIndex(t => t.taskId === sTaskId);
            if (idx < 0) {
                // Task only exists in the backend OData source — nothing to
                // persist locally yet. Add a stub so the change survives a refresh.
                const all = this._oTdModel.getProperty("/allTasks") || [];
                const remote = all.find(t => t.taskId === sTaskId);
                if (remote) {
                    items.push(Object.assign({}, remote, {
                        status: sStatus,
                        statusUpdatedAt: new Date().toISOString()
                    }));
                }
            } else {
                items[idx] = Object.assign({}, items[idx], {
                    status: sStatus,
                    statusUpdatedAt: new Date().toISOString()
                });
            }
            oTasksModel.setProperty("/items", items);
            this.getOwnerComponent().persistTasks();

            // Update local view immediately
            const all = (this._oTdModel.getProperty("/allTasks") || []).map(t =>
                t.taskId === sTaskId ? Object.assign({}, t, { status: sStatus }) : t
            );
            this._oTdModel.setProperty("/allTasks", all);
            this._applyFilter();

            sap.ui.require(["sap/m/MessageToast"], (MessageToast) => {
                MessageToast.show("Status updated to " + sStatus + ".");
            });
        },

        // ── Formatters / nav ─────────────────────────────────────────────────

        formatPriorityState(sValue) { return PRIORITY_STATE[sValue] || "None"; },
        formatStatusState(sValue)   { return STATUS_STATE[sValue]   || "None"; },

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        }
    });
});
