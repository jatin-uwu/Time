sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const STATUS_STATE   = { "Open": "Information", "In Progress": "Warning", "Pending": "Warning", "Completed": "Success" };

    function emptyForm() {
        return {
            taskName:           "",
            taskDescription:    "",
            assignedTo:         "",
            priority:           "Medium",
            status:             "Open",
            startDate:          "",
            dueDate:            "",
            attachmentName:     "",
            attachmentMime:     "",
            attachmentDataUrl:  ""
        };
    }

    return Controller.extend("timesheet.app.controller.TaskAssignment", {

        // ── Lifecycle ───────────────────────────────────────────────────
        onInit() {
            this._oTaModel = new JSONModel({
                form:                emptyForm(),
                employees:           [],
                employeeFilterList:  [{ employeeId: "", employeeName: "All employees" }],
                tasks:               [],
                filteredTasks:       [],
                assignedCount:       0,
                filterEmployee:      "",
                filterPriority:      "",
                searchQuery:         ""
            });
            this.getView().setModel(this._oTaModel, "taView");

            this.getOwnerComponent().getRouter()
                .getRoute("task-assignment")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._loadEmployees();
            this._loadTasks();
        },

        // ── Data loading ────────────────────────────────────────────────
        // Employees come from /Employees on EmployeeService. Falls back
        // gracefully (empty list) if the OData call fails — local-only
        // mode still works because the dropdown will simply show "no
        // options" until the next route hit.
        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) {
                this._oTaModel.setProperty("/employees", []);
                return;
            }
            oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    const list = aCtx.map(c => c.getObject())
                        .filter(e => e.isActive !== false)
                        .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
                    this._oTaModel.setProperty("/employees", list);
                    this._oTaModel.setProperty("/employeeFilterList",
                        [{ employeeId: "", employeeName: "All employees" }].concat(list));
                })
                .catch(() => {
                    this._oTaModel.setProperty("/employees", []);
                });
        },

        // Tasks: localStorage is the source of truth (so the UI works even
        // when the backend OData entity is unwritable). We *also* try to
        // merge in any remote tasks from ManagerService/Tasks or
        // EmployeeService/MyTasks for consistency.
        _loadTasks() {
            const oComponent  = this.getOwnerComponent();
            const oTasksModel = oComponent.getModel("tasks");
            const local       = (oTasksModel && oTasksModel.getProperty("/items")) || [];

            const tryRemote = (model, path) => {
                if (!model) return Promise.resolve(null);
                try {
                    return model.bindList(path).requestContexts(0, 500)
                        .then(aCtx => aCtx.map(c => c.getObject()))
                        .catch(() => null);
                } catch (e) { return Promise.resolve(null); }
            };

            const oMgrModel = oComponent.getModel("manager");
            const oEmpModel = oComponent.getModel();
            const p = oMgrModel
                ? tryRemote(oMgrModel, "/Tasks")
                : tryRemote(oEmpModel, "/MyTasks");

            p.then(remote => this._setTasks(this._mergeTasks(local, remote || [])));
        },

        _mergeTasks(local, remote) {
            const map = new Map();
            (remote || []).forEach(t => map.set(t.taskId, t));
            (local  || []).forEach(t => map.set(t.taskId, t));
            return Array.from(map.values());
        },

        _setTasks(arr) {
            const employees = this._oTaModel.getProperty("/employees") || [];
            const empMap = new Map(employees.map(e => [e.employeeId, e.employeeName]));

            const tasks = (arr || []).map(t => Object.assign({}, t, {
                assigneeName: empMap.get(getAssigneeId(t)) || "—"
            }));

            this._oTaModel.setProperty("/tasks", tasks);
            this._oTaModel.setProperty("/assignedCount", tasks.length);
            this._applyTaskFilter();
        },

        // ── Filtering / search ──────────────────────────────────────────
        onSearchTasks(oEvent) {
            this._oTaModel.setProperty("/searchQuery",
                (oEvent.getParameter("newValue") || "").toLowerCase());
            this._applyTaskFilter();
        },

        onFilterChange() { this._applyTaskFilter(); },

        _applyTaskFilter() {
            const tasks  = this._oTaModel.getProperty("/tasks") || [];
            const sEmp   = this._oTaModel.getProperty("/filterEmployee") || "";
            const sPrio  = this._oTaModel.getProperty("/filterPriority") || "";
            const sQuery = this._oTaModel.getProperty("/searchQuery") || "";

            const out = tasks.filter(t => {
                if (sEmp  && getAssigneeId(t) !== sEmp) return false;
                if (sPrio && t.priority !== sPrio)     return false;
                if (sQuery) {
                    const hay = ((t.taskName || "") + " " +
                                 (t.taskDescription || "") + " " +
                                 (t.taskId || "")).toLowerCase();
                    if (!hay.includes(sQuery)) return false;
                }
                return true;
            });
            this._oTaModel.setProperty("/filteredTasks", out);
        },

        // ── Form: file uploader ─────────────────────────────────────────
        onTaskFileSelected(oEvent) {
            const oFiles = oEvent.getParameter("files");
            if (!oFiles || !oFiles.length) return;
            const file = oFiles[0];

            const reader = new FileReader();
            reader.onload = (e) => {
                this._oTaModel.setProperty("/form/attachmentName",    file.name);
                this._oTaModel.setProperty("/form/attachmentMime",    file.type || "application/octet-stream");
                this._oTaModel.setProperty("/form/attachmentDataUrl", e.target.result);
            };
            reader.readAsDataURL(file);
        },

        onRemoveTaskFile() {
            this._oTaModel.setProperty("/form/attachmentName",    "");
            this._oTaModel.setProperty("/form/attachmentMime",    "");
            this._oTaModel.setProperty("/form/attachmentDataUrl", "");
            const oFU = this.byId("uplTaskFile");
            if (oFU) oFU.clear();
        },

        // ── Form: reset / submit ────────────────────────────────────────
        onResetForm() {
            this._oTaModel.setProperty("/form", emptyForm());
            const oFU = this.byId("uplTaskFile");
            if (oFU) oFU.clear();
        },

        onAssignTask() {
            const form = this._oTaModel.getProperty("/form");

            if (!form.taskName || !form.taskName.trim()) {
                MessageToast.show("Please enter a task name."); return;
            }
            if (!form.taskDescription || !form.taskDescription.trim()) {
                MessageToast.show("Please enter a task description."); return;
            }
            if (!form.assignedTo) {
                MessageToast.show("Please select an employee."); return;
            }
            if (!form.priority) {
                MessageToast.show("Please choose a priority."); return;
            }

            const newTask = this._buildTask(form);

            // 1) Persist locally so the employee's UI updates immediately.
            //    We store everything *except* the binary; the binary travels
            //    via /manager/uploadTaskAttachment so the file actually lives
            //    on the server (and is shared cross-device).
            this._persistLocalTask(this._stripBinary(newTask));

            // 2) Best-effort backend create (skipped silently when the
            //    OData entity is not writable in this deployment).
            this._createOnBackend(newTask)
                .then(() => this._uploadAttachment(newTask, form))
                .catch(() => {
                    // Even if create failed, try the upload — the row may
                    // already exist (e.g. local-store). Failure is silent.
                    this._uploadAttachment(newTask, form);
                });

            // 3) Trigger the assignment email (no-op if /manager action
            //    is not available).
            this._sendAssignmentEmail(newTask);

            // 4) UI feedback.
            this._loadTasks();
            this.onResetForm();
            MessageToast.show(`Task ${newTask.taskId} assigned to ${this._employeeName(form.assignedTo)}.`);
        },

        // Remove the heavy data URL before persisting locally; the
        // metadata is enough for the UI to show "Reference document".
        _stripBinary(task) {
            const t = Object.assign({}, task);
            delete t.attachmentDataUrl;
            return t;
        },

        // POSTs the file to /manager/uploadTaskAttachment. The action
        // requires the Manager scope and stores the bytes in HANA so the
        // assigned employee can download them on their own machine.
        _uploadAttachment(task, form) {
            if (!form || !form.attachmentDataUrl || !form.attachmentName) return;

            const cleaned = String(form.attachmentDataUrl).replace(/^data:[^;]+;base64,/, "");
            fetch("/manager/uploadTaskAttachment", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify({
                    taskId:     task.taskId,
                    fileName:   form.attachmentName,
                    mimeType:   form.attachmentMime || "application/octet-stream",
                    dataBase64: cleaned
                })
            })
                .then(r => r.ok ? r.json() : Promise.reject(r.status))
                .then(() => MessageToast.show(`Attachment uploaded for ${task.taskId}.`))
                .catch(() => {
                    /* Local-only fallback: keep the data URL in the local
                       task entry so the same browser can still download it. */
                    const oTasksModel = this.getOwnerComponent().getModel("tasks");
                    const items = (oTasksModel.getProperty("/items") || []).slice();
                    const idx = items.findIndex(t => t.taskId === task.taskId);
                    if (idx >= 0) {
                        items[idx] = Object.assign({}, items[idx], {
                            attachmentDataUrl: form.attachmentDataUrl
                        });
                        oTasksModel.setProperty("/items", items);
                        this.getOwnerComponent().persistTasks();
                    }
                });
        },

        _buildTask(form) {
            return {
                taskId:                 this._nextTaskId(),
                taskName:               form.taskName.trim(),
                taskDescription:        form.taskDescription.trim(),
                assignedTo_employeeId:  form.assignedTo,
                priority:               form.priority,
                status:                 "Open",
                startDate:              form.startDate || null,
                dueDate:                form.dueDate || null,
                assignedOn:             new Date().toISOString(),
                createdAt:              new Date().toISOString(),
                attachmentName:         form.attachmentName    || "",
                attachmentMimeType:     form.attachmentMime    || "",
                attachmentDataUrl:      form.attachmentDataUrl || ""
            };
        },

        _persistLocalTask(task) {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const items = (oTasksModel.getProperty("/items") || []).slice();
            items.push(task);
            oTasksModel.setProperty("/items", items);
            this.getOwnerComponent().persistTasks();
        },

        _createOnBackend(task) {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return Promise.resolve();
            try {
                oMgrModel.bindList("/Tasks").create({
                    taskId:                task.taskId,
                    taskName:              task.taskName,
                    taskDescription:       task.taskDescription,
                    assignedTo_employeeId: task.assignedTo_employeeId,
                    priority:              task.priority,
                    status:                task.status,
                    startDate:             task.startDate,
                    dueDate:               task.dueDate
                });
                return oMgrModel.submitBatch
                    ? oMgrModel.submitBatch(oMgrModel.getUpdateGroupId())
                    : Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        },

        _sendAssignmentEmail(task) {
            const payload = {
                taskId:          task.taskId,
                taskName:        task.taskName,
                taskDescription: task.taskDescription,
                priority:        task.priority,
                dueDate:         task.dueDate || "",
                assigneeId:      task.assignedTo_employeeId
            };
            fetch("/manager/notifyTaskAssignment", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify(payload)
            })
                .then(r => r.ok ? r.json() : Promise.reject(r.status))
                .then(data => {
                    const result = data && (data.value || data);
                    if (!result) return;
                    const m = (result.message || "").match(/https?:\/\/\S+/);
                    if (m) {
                        // eslint-disable-next-line no-console
                        console.log("%c[Email preview]", "color:#2563eb;font-weight:bold;", m[0]);
                    }
                    if (result.sent) {
                        MessageToast.show(
                            `Email sent to ${result.recipient}` +
                            (m ? " — preview URL printed in console." : "."),
                            { duration: 6000 }
                        );
                    } else if (result.recipient) {
                        MessageToast.show(`Notification logged for ${result.recipient}.`);
                    }
                })
                .catch(() => { /* mail action not available — silent */ });
        },

        _employeeName(sId) {
            const list = this._oTaModel.getProperty("/employees") || [];
            const e = list.find(x => x.employeeId === sId);
            return e ? e.employeeName : sId;
        },

        _nextTaskId() {
            const all = (this._oTaModel.getProperty("/tasks") || []).map(t => t.taskId || "");
            let max = 0;
            all.forEach(id => {
                const m = /^TASK(\d+)$/i.exec(id);
                if (m) max = Math.max(max, parseInt(m[1], 10));
            });
            return "TASK" + String(max + 1).padStart(3, "0");
        },

        // ── Delete ───────────────────────────────────────────────────────
        onDeleteTask(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("taView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            MessageBox.confirm(
                `Delete task "${task.taskName}" (${task.taskId})?`,
                {
                    title: "Delete Task",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        const oTasksModel = this.getOwnerComponent().getModel("tasks");
                        const items = (oTasksModel.getProperty("/items") || [])
                            .filter(t => t.taskId !== task.taskId);
                        oTasksModel.setProperty("/items", items);
                        this.getOwnerComponent().persistTasks();
                        this._loadTasks();
                        MessageToast.show("Task removed.");
                    }
                }
            );
        },

        // ── Formatters / nav ─────────────────────────────────────────────
        formatPriorityState(sValue) { return PRIORITY_STATE[sValue] || "None"; },
        formatStatusState(sValue)   { return STATUS_STATE[sValue]   || "None"; },

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("manager");
        }
    });

    // ── Module-private utilities ────────────────────────────────────────
    function getAssigneeId(t) {
        return t.assignedTo_employeeId ||
               (t.assignedTo && t.assignedTo.employeeId) ||
               t.assignedTo;
    }
});
