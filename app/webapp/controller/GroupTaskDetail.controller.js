sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "timesheet/app/util/GroupChat"
], (Controller, JSONModel, MessageToast, MessageBox, GroupChat) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const MEMBER_STATE   = { "pending": "None", "in_progress": "Warning", "ended": "Success" };
    const MEMBER_TEXT    = { "pending": "Pending", "in_progress": "In Progress", "ended": "Ended" };

    function fmtDue(sIso) {
        if (!sIso) return "No due date";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return "Due " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    }
    function fmtDateTime(sIso) {
        if (!sIso) return "";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function initialsOf(sName) {
        if (!sName) return "?";
        const parts = String(sName).trim().split(/\s+/);
        const a = parts[0] && parts[0][0] ? parts[0][0] : "";
        const b = parts.length > 1 && parts[parts.length - 1][0] ? parts[parts.length - 1][0] : "";
        return (a + b).toUpperCase() || a.toUpperCase() || "?";
    }
    function parseActionJson(oCtx) {
        try {
            const o = oCtx.getBoundContext().getObject();
            const raw = (o && typeof o === "object" && "value" in o) ? o.value : o;
            return JSON.parse(raw || "{}");
        } catch (e) { return null; }
    }

    return Controller.extend("timesheet.app.controller.GroupTaskDetail", {

        onInit() {
            this._oModel = new JSONModel({ taskId: "", detail: { myStatus: null, assignees: [] }, busy: false });
            this.getView().setModel(this._oModel, "gtdView");
            this.getOwnerComponent().getRouter()
                .getRoute("group-task-detail").attachPatternMatched(this._onRouteMatched, this);
        },

        onExit() { this._stopPoll(); if (this._chat) this._chat.destroy(); },

        _onRouteMatched(oEvent) {
            const sTaskId = oEvent.getParameter("arguments").taskId;
            this._oModel.setProperty("/taskId", sTaskId);
            this.getOwnerComponent().getCurrentUser().then(() => {
                this._loadDetail(sTaskId);
                this._startPoll();   // keep status + unread-chat dot live
            });
        },

        // Light refresh so member statuses and the chat red-dot update live.
        _startPoll() {
            this._stopPoll();
            this._pollTimer = setInterval(() => {
                if (!/group-task-detail/.test(window.location.hash || "")) { this._stopPoll(); return; }
                this._loadDetail(this._oModel.getProperty("/taskId"));
            }, 10000);
        },
        _stopPoll() { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } },

        _loadDetail(sTaskId) {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return;
            const oCtx = oModel.bindContext("/getGroupTaskDetail(...)");
            oCtx.setParameter("taskId", sTaskId);
            oCtx.execute().then(() => {
                const d = parseActionJson(oCtx) || {};
                const total = d.total || 0, ended = d.ended || 0;
                this._oModel.setProperty("/detail", Object.assign({}, d, {
                    taskId:        sTaskId,
                    dueLabel:      fmtDue(d.dueDate),
                    priorityState: PRIORITY_STATE[d.priority] || "None",
                    statusState:   d.status === "Completed" ? "Success" : "Information",
                    progressText:  ended + " of " + total + " ended",
                    progressValue: total ? Math.round((ended / total) * 100) : 0,
                    progressState: d.status === "Completed" ? "Success" : "None",
                    myStatus:      (d.myStatus === undefined ? null : d.myStatus),
                    assignees:     (d.assignees || []).map(a => Object.assign({}, a, {
                        initials:    initialsOf(a.employeeName),
                        statusText:  MEMBER_TEXT[a.status] || a.status,
                        statusState: MEMBER_STATE[a.status] || "None",
                        endedLabel:  a.endedAt ? ("Ended " + fmtDateTime(a.endedAt)) : ""
                    }))
                }));
            }).catch((err) => MessageBox.error((err && err.message) || "Could not load this group task."));
        },

        onEndMySide() {
            const sTaskId = this._oModel.getProperty("/taskId");
            if (!sTaskId) return;
            this._oModel.setProperty("/busy", true);
            const oCtx = this.getOwnerComponent().getModel().bindContext("/endMyTaskSide(...)");
            oCtx.setParameter("taskId", sTaskId);
            oCtx.execute().then(() => {
                this._oModel.setProperty("/busy", false);
                const r = (oCtx.getBoundContext() && oCtx.getBoundContext().getObject()) || {};
                MessageToast.show(r.completed ? "All members have ended — task completed."
                                              : "You have ended your part of this task.");
                this._loadDetail(sTaskId);
                try { sap.ui.getCore().getEventBus().publish("groupTasks", "changed"); } catch (e) { /* */ }
            }).catch((err) => {
                this._oModel.setProperty("/busy", false);
                MessageBox.error((err && err.message) || "Could not update your status.");
            });
        },

        onOpenChat() {
            const sTaskId = this._oModel.getProperty("/taskId");
            const d = this._oModel.getProperty("/detail") || {};
            this._chat = this._chat || new GroupChat(this.getView(), this.getOwnerComponent());
            // Reload detail on close so the red dot clears once messages are read.
            this._chat.open(sTaskId, d.taskName, () => this._loadDetail(sTaskId));
        },

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("group-tasks");
        }
    });
});
