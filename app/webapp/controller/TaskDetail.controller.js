sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], (Controller, JSONModel, MessageToast) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const STATUS_STATE   = { "Open": "Information", "In Progress": "Warning", "Pending": "Warning", "Completed": "Success" };

    function todayISO() {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${d.getFullYear()}-${m}-${day}`;
    }
    function emptyForm() {
        return { updateDate: todayISO(), notes: "", attachmentName: "", attachmentMime: "", attachmentDataUrl: "" };
    }
    function fmtDate(sIso) {
        if (!sIso) return "—";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
    function fmtDue(sIso) {
        if (!sIso) return "No due date";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    }

    return Controller.extend("timesheet.app.controller.TaskDetail", {

        onInit() {
            this._oTdModel = new JSONModel({ taskId: "", task: {}, updates: [], form: emptyForm(), canPost: true });
            this.getView().setModel(this._oTdModel, "tdView");
            this.getOwnerComponent().getRouter()
                .getRoute("task-detail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched(oEvent) {
            const sTaskId = oEvent.getParameter("arguments").taskId;
            this._oTdModel.setProperty("/taskId", sTaskId);
            this._oTdModel.setProperty("/form", emptyForm());
            const oFU = this.byId("uplFile"); if (oFU) oFU.clear();
            this._loadTask(sTaskId).then(() => { this._refreshCanPost(); this._loadUpdates(sTaskId); });
        },

        _loadTask(sTaskId) {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const local = (oTasksModel && oTasksModel.getProperty("/items")) || [];
            const fromLocal = local.find(t => t.taskId === sTaskId);
            const oModel = this.getOwnerComponent().getModel();
            const finish = (task) => {
                if (!task) { this._oTdModel.setProperty("/task", { taskName: "Task not found" }); return Promise.resolve(); }
                return this._loadEmployees().then(empMap => {
                    const empId = task.assignedTo_employeeId || (task.assignedTo && task.assignedTo.employeeId) || task.assignedTo;
                    this._oTdModel.setProperty("/task", Object.assign({}, task, {
                        assigneeName: empMap.get(empId) || "Unassigned",
                        assignedToEmpId: empId,
                        dueLabel: fmtDue(task.dueDate)
                    }));
                });
            };
            if (fromLocal) return Promise.resolve(finish(fromLocal));
            if (!oModel) return Promise.resolve(finish(null));
            return oModel.bindList("/MyTasks").requestContexts(0, 500)
                .then(aCtx => finish(aCtx.map(c => c.getObject()).find(t => t.taskId === sTaskId)))
                .catch(() => finish(null));
        },

        _loadEmployees() {
            if (this._empMapPromise) return this._empMapPromise;
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return Promise.resolve(new Map());
            this._empMapPromise = oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    const m = new Map();
                    aCtx.forEach(c => { const o = c.getObject(); if (o && o.employeeId) m.set(o.employeeId, o.employeeName); });
                    return m;
                })
                .catch(() => new Map());
            return this._empMapPromise;
        },

        _refreshCanPost() {
            const oAppModel = this.getOwnerComponent().getModel("appView") ||
                              (this.getView() && this.getView().getModel("appView"));
            const sRole = (oAppModel && oAppModel.getProperty("/userRole")) || "employee";
            const sCurrentEmpId = this.getOwnerComponent().getCurrentEmployeeId &&
                                  this.getOwnerComponent().getCurrentEmployeeId();
            const sAssignee = this._oTdModel.getProperty("/task/assignedToEmpId");
            const bCanPost = (sCurrentEmpId && sAssignee && sCurrentEmpId === sAssignee) || (sRole !== "manager");
            this._oTdModel.setProperty("/canPost", !!bCanPost);
        },

        _loadUpdates(sTaskId) {
            const oUpdatesModel = this.getOwnerComponent().getModel("taskUpdates");
            const byTaskId = (oUpdatesModel && oUpdatesModel.getProperty("/byTaskId")) || {};
            const local = (byTaskId[sTaskId] || []).slice();
            const enrich = (arr) => {
                this._loadEmployees().then(empMap => {
                    const enriched = arr.map(u => Object.assign({}, u, {
                        updatedByName: empMap.get(u.updatedBy_employeeId || u.updatedBy) || "Employee",
                        dateLabel: fmtDate(u.updateDate || u.createdAt)
                    })).sort((a, b) => (b.updateDate || b.createdAt || "").localeCompare(a.updateDate || a.createdAt || ""));
                    this._oTdModel.setProperty("/updates", enriched);
                });
            };
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) { enrich(local); return; }
            try {
                oModel.bindList("/TaskUpdates").requestContexts(0, 500)
                    .then(aCtx => {
                        const remote = aCtx.map(c => c.getObject()).filter(u => u.task_taskId === sTaskId);
                        enrich(this._mergeUpdates(local, remote));
                    })
                    .catch(() => enrich(local));
            } catch (e) { enrich(local); }
        },

        _mergeUpdates(local, remote) {
            const map = new Map();
            (remote || []).forEach(u => map.set(u.updateId, u));
            (local || []).forEach(u => map.set(u.updateId, u));
            return Array.from(map.values());
        },

        onFileSelected(oEvent) {
            const oFiles = oEvent.getParameter("files");
            if (!oFiles || !oFiles.length) return;
            const file = oFiles[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                this._oTdModel.setProperty("/form/attachmentName", file.name);
                this._oTdModel.setProperty("/form/attachmentMime", file.type || "application/octet-stream");
                this._oTdModel.setProperty("/form/attachmentDataUrl", e.target.result);
            };
            reader.readAsDataURL(file);
        },

        onClearForm() {
            this._oTdModel.setProperty("/form", emptyForm());
            const oFU = this.byId("uplFile"); if (oFU) oFU.clear();
        },

        onPostUpdate() {
            const form = this._oTdModel.getProperty("/form");
            if (!form.notes || !form.notes.trim()) { MessageToast.show("Please describe today's progress before posting."); return; }
            if (!form.updateDate) { MessageToast.show("Please select an update date."); return; }

            const sTaskId = this._oTdModel.getProperty("/taskId");
            const sUserId = this.getOwnerComponent().getCurrentEmployeeId &&
                            this.getOwnerComponent().getCurrentEmployeeId();
            const update = {
                updateId: this._nextUpdateId(sTaskId),
                task_taskId: sTaskId,
                updateDate: form.updateDate,
                notes: form.notes.trim(),
                attachmentName: form.attachmentName || "",
                attachmentMimeType: form.attachmentMime || "",
                attachmentDataUrl: form.attachmentDataUrl || "",
                updatedBy_employeeId: sUserId,
                createdAt: new Date().toISOString()
            };

            const oUpdatesModel = this.getOwnerComponent().getModel("taskUpdates");
            const byTaskId = Object.assign({}, oUpdatesModel.getProperty("/byTaskId") || {});
            byTaskId[sTaskId] = (byTaskId[sTaskId] || []).slice();
            byTaskId[sTaskId].push(update);
            oUpdatesModel.setProperty("/byTaskId", byTaskId);
            this.getOwnerComponent().persistTaskUpdates();

            this._writeBackend(update).catch(() => { });

            this.onClearForm();
            this._loadUpdates(sTaskId);
            MessageToast.show("Update posted.");
        },

        _writeBackend(update) {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) return Promise.resolve();
            try {
                oModel.bindList("/TaskUpdates").create({
                    updateId: update.updateId,
                    task_taskId: update.task_taskId,
                    updateDate: update.updateDate,
                    notes: update.notes,
                    attachmentName: update.attachmentName,
                    attachmentMimeType: update.attachmentMimeType,
                    updatedBy_employeeId: update.updatedBy_employeeId
                });
                return oModel.submitBatch ? oModel.submitBatch(oModel.getUpdateGroupId()) : Promise.resolve();
            } catch (e) { return Promise.reject(e); }
        },

        _nextUpdateId(sTaskId) {
            const oUpdatesModel = this.getOwnerComponent().getModel("taskUpdates");
            const all = (oUpdatesModel.getProperty("/byTaskId") || {})[sTaskId] || [];
            return sTaskId + "-U" + String(all.length + 1).padStart(3, "0") + "-" + Date.now().toString(36);
        },

        // Single-shot download of the manager attachment from HANA.
        // Falls back to a local data URL if running offline.
        onDownloadTaskAttachment() {
            const task = this._oTdModel.getProperty("/task") || {};
            if (!task.taskId) { MessageToast.show("Attachment is not available for download."); return; }

            const triggerDownload = (dataUrl, name) => {
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = name || "attachment";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            };
            const markConsumed = () => {
                this._oTdModel.setProperty("/task/attachmentName",     "");
                this._oTdModel.setProperty("/task/attachmentMimeType", "");
                this._oTdModel.setProperty("/task/attachmentDataUrl",  "");
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
            };

            fetch("/employee/consumeTaskAttachment", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify({ taskId: task.taskId })
            })
                .then(r => {
                    if (r.ok) return r.json();
                    if (r.status === 404 && task.attachmentDataUrl) {
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
                        MessageToast.show("Attachment is not available for download.");
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
                        MessageToast.show("Attachment is not available for download.");
                    }
                });
        },

        onDownloadAttachment(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const update = oCtx.getObject();
            if (!update.attachmentDataUrl) { MessageToast.show("Attachment is not available offline."); return; }
            const a = document.createElement("a");
            a.href = update.attachmentDataUrl;
            a.download = update.attachmentName || "attachment";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        },

        formatPriorityState(sValue) { return PRIORITY_STATE[sValue] || "None"; },
        formatStatusState(sValue)   { return STATUS_STATE[sValue]   || "None"; },

        onNavBack() {
            const oAppModel = this.getOwnerComponent().getModel("appView") ||
                              (this.getView() && this.getView().getModel("appView"));
            const sRole = (oAppModel && oAppModel.getProperty("/userRole")) || "employee";
            this.getOwnerComponent().getRouter().navTo(sRole === "manager" ? "task-status" : "task-description");
        }
    });
});