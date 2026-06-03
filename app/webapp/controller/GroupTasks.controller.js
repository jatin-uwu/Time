sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "timesheet/app/util/GroupChat"
], (Controller, JSONModel, GroupChat) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };

    function fmtDue(sIso) {
        if (!sIso) return "No due date";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return "Due " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    }

    function initialsOf(sName) {
        if (!sName) return "?";
        const parts = String(sName).trim().split(/\s+/);
        const a = parts[0] && parts[0][0] ? parts[0][0] : "";
        const b = parts.length > 1 && parts[parts.length - 1][0] ? parts[parts.length - 1][0] : "";
        return (a + b).toUpperCase() || a.toUpperCase() || "?";
    }

    return Controller.extend("timesheet.app.controller.GroupTasks", {

        onInit() {
            this._oModel = new JSONModel({
                allTasks:    [],
                tasks:       [],
                totalLabel:  "0 group tasks",
                filterStatus: "",
                sortBy:      "due-asc"
            });
            this.getView().setModel(this._oModel, "groupView");

            this.getOwnerComponent().getRouter()
                .getRoute("group-tasks")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this.getOwnerComponent().getCurrentUser().then(() => this._loadGroupTasks());
        },

        _loadGroupTasks() {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return;
            const oCtx = oModel.bindContext("/getGroupTasks(...)");
            oCtx.execute().then(() => {
                let tasks = [];
                try {
                    const o = oCtx.getBoundContext().getObject();
                    const raw = (o && typeof o === "object" && "value" in o) ? o.value : o;
                    tasks = JSON.parse(raw || "[]");
                } catch (e) { tasks = []; }

                const enriched = tasks.map(t => {
                    const total = t.total || 0;
                    const ended = t.ended || 0;
                    return Object.assign({}, t, {
                        dueLabel:      fmtDue(t.dueDate),
                        priorityState: PRIORITY_STATE[t.priority] || "None",
                        statusState:   t.status === "Completed" ? "Success" : "Information",
                        progressText:  ended + " of " + total + " ended",
                        progressValue: total ? Math.round((ended / total) * 100) : 0,
                        progressState: t.status === "Completed" ? "Success" : "None",
                        assignees:     (t.assignees || []).map(a => Object.assign({}, a, {
                            initials: initialsOf(a.employeeName)
                        }))
                    });
                });

                this._oModel.setProperty("/allTasks", enriched);
                this._applyFilter();
            }).catch(() => {
                this._oModel.setProperty("/allTasks", []);
                this._applyFilter();
            });
        },

        _applyFilter() {
            const all    = this._oModel.getProperty("/allTasks") || [];
            const status = this._oModel.getProperty("/filterStatus") || "";
            const sortBy = this._oModel.getProperty("/sortBy") || "due-asc";

            let list = status ? all.filter(t => t.status === status) : all.slice();

            const key = t => t.dueDate || "9999-12-31";
            list.sort((a, b) => sortBy === "due-desc"
                ? key(b).localeCompare(key(a))
                : key(a).localeCompare(key(b)));

            this._oModel.setProperty("/tasks", list);
            this._oModel.setProperty("/totalLabel",
                all.length + (all.length === 1 ? " group task" : " group tasks"));
        },

        onStatusFilter(oEvent) {
            this._oModel.setProperty("/filterStatus", oEvent.getParameter("item").getKey());
            this._applyFilter();
        },

        onSortChange() { this._applyFilter(); },

        onOpenGroupTask(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("groupView");
            const task = oCtx && oCtx.getObject();
            if (!task || !task.taskId) return;
            this.getOwnerComponent().getRouter().navTo("group-task-detail", { taskId: task.taskId });
        },

        // Chat icon → open the chat popup directly (no navigation).
        onOpenGroupChat(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("groupView");
            const task = oCtx && oCtx.getObject();
            if (!task || !task.taskId) return;
            this._chat = this._chat || new GroupChat(this.getView(), this.getOwnerComponent());
            // Reload the list on close so the red dot clears after reading.
            this._chat.open(task.taskId, task.taskName, () => this._loadGroupTasks());
        },

        onExit() { if (this._chat) this._chat.destroy(); }
    });
});
