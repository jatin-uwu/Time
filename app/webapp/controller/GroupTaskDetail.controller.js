sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "timesheet/app/util/MessageBox",
    "timesheet/app/util/GroupChat"
], (Controller, JSONModel, MessageToast, Fragment, MessageBox, GroupChat) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const MEMBER_STATE   = { "pending": "None", "in_progress": "Warning", "ended": "Success" };
    const MEMBER_TEXT    = { "pending": "Pending", "in_progress": "In Progress", "ended": "Ended" };

    // Plain fetch caller for /employee actions (CSRF + JSON, no $batch — large
    // base64 attachments fail inside a $batch). Mirrors util/GroupChat.callEmp.
    async function callEmp(action, params) {
        let token = null;
        try {
            const h = await fetch("/employee/", { headers: { "X-CSRF-Token": "Fetch" }, credentials: "include" });
            token = h.headers.get("x-csrf-token");
        } catch (e) { /* ignore */ }
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers["X-CSRF-Token"] = token;
        const resp = await fetch("/employee/" + action, {
            method: "POST", headers, body: JSON.stringify(params || {}), credentials: "include"
        });
        if (!resp.ok) {
            let detail = resp.statusText;
            try { const j = await resp.json(); detail = (j.error && j.error.message) || detail; }
            catch (e) { try { detail = await resp.text(); } catch (e2) { /* */ } }
            throw new Error(detail);
        }
        const j = await resp.json().catch(() => ({}));
        return (j && j.value !== undefined) ? j.value : j;
    }

    function emptyPostForm() {
        return { title: "", notes: "", attachmentName: "", attachmentMime: "", attachmentDataUrl: "", busy: false };
    }

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
            this._oModel = new JSONModel({
                taskId: "", detail: { myStatus: null, assignees: [] },
                updates: [], documents: [], postForm: emptyPostForm(), busy: false
            });
            this.getView().setModel(this._oModel, "gtdView");
            this.getOwnerComponent().getRouter()
                .getRoute("group-task-detail").attachPatternMatched(this._onRouteMatched, this);
        },

        onExit() {
            this._stopPoll();
            if (this._chat) this._chat.destroy();
            if (this._pPostDialog) { this._pPostDialog.then(d => d.destroy()); this._pPostDialog = null; }
        },

        _onRouteMatched(oEvent) {
            const sTaskId = oEvent.getParameter("arguments").taskId;
            this._oModel.setProperty("/taskId", sTaskId);
            this.getOwnerComponent().getCurrentUser().then(() => {
                this._loadDetail(sTaskId);
                this._loadUpdates(sTaskId);
                this._loadTaskDocuments(sTaskId);
                this._startPoll();   // keep status + unread-chat dot live
            });
        },

        // Manager-attached reference documents for this group task.
        _loadTaskDocuments(sTaskId) {
            callEmp("getTaskDocuments", { taskId: sTaskId }).then((raw) => {
                let list = [];
                try { list = JSON.parse(raw || "[]"); } catch (e) { list = []; }
                this._oModel.setProperty("/documents", Array.isArray(list) ? list : []);
            }).catch(() => this._oModel.setProperty("/documents", []));
        },

        onDownloadDocument(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("gtdView");
            if (!oCtx) return;
            const doc = oCtx.getObject();
            if (!doc || !doc.documentId) return;
            callEmp("getTaskDocument", { documentId: doc.documentId }).then((v) => {
                if (!v || !v.dataBase64) { MessageToast.show("Document is not available."); return; }
                const a = document.createElement("a");
                a.href = "data:" + (v.mimeType || "application/octet-stream") + ";base64," + v.dataBase64;
                a.download = v.fileName || doc.fileName || "document";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }).catch(() => MessageToast.show("Could not download the document."));
        },

        // Light refresh so member statuses and the chat red-dot update live.
        _startPoll() {
            this._stopPoll();
            this._pollTimer = setInterval(() => {
                if (!/group-task-detail/.test(window.location.hash || "")) { this._stopPoll(); return; }
                const sTaskId = this._oModel.getProperty("/taskId");
                this._loadDetail(sTaskId);
                this._loadUpdates(sTaskId);
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
            // Opening the chat reads the messages → clear the dot immediately.
            this._oModel.setProperty("/detail/unreadChat", false);
            this._chat = this._chat || new GroupChat(this.getView(), this.getOwnerComponent());
            // Reload detail on close so the dot reflects any newer messages.
            this._chat.open(sTaskId, d.taskName, () => this._loadDetail(sTaskId));
        },

        // ── Task Updates ──────────────────────────────────────────────────
        _loadUpdates(sTaskId) {
            callEmp("getGroupTaskUpdates", { taskId: sTaskId }).then((raw) => {
                let d = {};
                try { d = JSON.parse(raw || "{}"); } catch (e) { d = {}; }
                const updates = (d.updates || []).map(u => Object.assign({}, u, {
                    initials:  initialsOf(u.updatedByName),
                    dateLabel: fmtDateTime(u.updatedAt)
                }));
                this._oModel.setProperty("/updates", updates);
            }).catch(() => { /* leave existing */ });
        },

        onPostUpdate() {
            this._oModel.setProperty("/postForm", emptyPostForm());
            const oFU = Fragment.byId(this.getView().getId() + "--postUpd", "uplGroupUpdateFile");
            if (oFU) oFU.clear();
            if (!this._pPostDialog) {
                this._pPostDialog = Fragment.load({
                    id: this.getView().getId() + "--postUpd",
                    name: "timesheet.app.view.fragment.PostUpdateDialog",
                    controller: this
                }).then((oDialog) => {
                    this.getView().addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pPostDialog.then((oDialog) => oDialog.open());
        },

        onUpdateFileSelected(oEvent) {
            const oFiles = oEvent.getParameter("files");
            if (!oFiles || !oFiles.length) return;
            const file = oFiles[0];
            if (file.size > 10 * 1024 * 1024) {
                MessageToast.show("Attachment exceeds the 10 MB limit.");
                oEvent.getSource().clear();
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                this._oModel.setProperty("/postForm/attachmentName", file.name);
                this._oModel.setProperty("/postForm/attachmentMime", file.type || "application/octet-stream");
                this._oModel.setProperty("/postForm/attachmentDataUrl", e.target.result);
            };
            reader.readAsDataURL(file);
        },

        onClearUpdateAttachment() {
            this._oModel.setProperty("/postForm/attachmentName", "");
            this._oModel.setProperty("/postForm/attachmentMime", "");
            this._oModel.setProperty("/postForm/attachmentDataUrl", "");
            const oFU = Fragment.byId(this.getView().getId() + "--postUpd", "uplGroupUpdateFile");
            if (oFU) oFU.clear();
        },

        onCancelUpdate() {
            if (this._pPostDialog) this._pPostDialog.then(d => d.close());
        },

        onSubmitUpdate() {
            const form = this._oModel.getProperty("/postForm") || {};
            const sNotes = (form.notes || "").trim();
            if (!sNotes) { MessageToast.show("Please enter an update message before posting."); return; }
            if (form.busy) return;

            const sTaskId = this._oModel.getProperty("/taskId");
            this._oModel.setProperty("/postForm/busy", true);
            callEmp("postGroupTaskUpdate", {
                taskId:     sTaskId,
                title:      (form.title || "").trim(),
                notes:      sNotes,
                fileName:   form.attachmentName || "",
                mimeType:   form.attachmentMime || "",
                dataBase64: form.attachmentDataUrl
                    ? String(form.attachmentDataUrl).replace(/^data:[^;]+;base64,/, "") : ""
            }).then(() => {
                this._oModel.setProperty("/postForm/busy", false);
                if (this._pPostDialog) this._pPostDialog.then(d => d.close());
                MessageToast.show("Update posted.");
                this._loadUpdates(sTaskId);   // refresh immediately, no page reload
                this._loadDetail(sTaskId);    // member status may flip to In Progress
                try { sap.ui.getCore().getEventBus().publish("groupTasks", "changed"); } catch (e) { /* */ }
            }).catch((err) => {
                this._oModel.setProperty("/postForm/busy", false);
                MessageBox.error((err && err.message) || "Could not post the update.");
            });
        },

        onDownloadUpdateAttachment(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("gtdView");
            const upd = oCtx && oCtx.getObject();
            if (!upd || !upd.updateId) return;
            callEmp("getTaskUpdateAttachment", { updateId: upd.updateId }).then((r) => {
                if (!r || !r.dataBase64) { MessageToast.show("Attachment is not available."); return; }
                const a = document.createElement("a");
                a.href = "data:" + (r.mimeType || "application/octet-stream") + ";base64," + r.dataBase64;
                a.download = r.fileName || upd.attachmentName || "attachment";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }).catch((e) => MessageToast.show("Could not download: " + ((e && e.message) || e)));
        },

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("group-tasks");
        }
    });
});
