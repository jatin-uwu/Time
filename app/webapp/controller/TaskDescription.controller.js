sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Select",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/ui/core/Item"
], (Controller, JSONModel, MessageToast, Dialog, Button, Select, Label, VBox, Item) => {
    "use strict";

    // ── Status constants ─────────────────────────────────────────────────────
    const STATUS_STATE = {
        "Not Started": "None",
        "In Progress": "Warning",
        "In Review":   "Information",
        "Completed":   "Success",
        "Reopened":    "Error"
    };
    const PRIORITY_STATE = { "High": "Error", "Medium": "Warning", "Low": "Success" };
    const PRIORITY_RANK  = { "High": 0, "Medium": 1, "Low": 2 };

    // Functional positions whose holders can act as reviewers
    const REVIEWER_DESIGNATIONS = [
        "Manager", "Founder", "HR Manager", "HR",
        "Senior Developer", "Tech Lead", "Team Lead"
    ];

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
                reviewerCandidates: [],   // functional-position employees for reviewer dialog
                employeeFilterList: [{ employeeId: "__me", employeeName: "My tasks" }],
                viewAsEmployee:     "__me",
                priorityFilter:     "",
                searchQuery:        "",
                totalLabel:         "0 tasks",
                currentEmployeeId:  ""
            });
            this.getView().setModel(this._oTdModel, "tdView");

            this.getOwnerComponent().getRouter()
                .getRoute("task-description")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            // Resolve current user first, then load data
            this.getOwnerComponent().getCurrentUser().then(user => {
                const sEmpId = this.getOwnerComponent().getCurrentEmployeeId();
                this._oTdModel.setProperty("/currentEmployeeId", sEmpId);
                this._loadEmployees();
                this._loadTasks();
            });
        },

        // ── Loading ──────────────────────────────────────────────────────────

        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel();
            const builtin = Object.values(this.getOwnerComponent()._builtinEmployees || {});

            const processEmployees = (list) => {
                const active = list
                    .filter(e => e.isActive !== false)
                    .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));

                this._oTdModel.setProperty("/employees", active);
                this._oTdModel.setProperty("/employeeFilterList",
                    [{ employeeId: "__me", employeeName: "My tasks" }].concat(active));

                // Reviewer candidates = functional-position employees only
                const reviewers = active.filter(e =>
                    REVIEWER_DESIGNATIONS.some(d =>
                        (e.designation || "").toLowerCase().includes(d.toLowerCase())
                    )
                );
                this._oTdModel.setProperty("/reviewerCandidates", reviewers);
            };

            if (!oModel) { processEmployees(builtin); return; }

            oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    const list = aCtx.map(c => c.getObject());
                    processEmployees(list.length ? list : builtin);
                })
                .catch(() => processEmployees(builtin));
        },

        _loadTasks() {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const local = (oTasksModel && oTasksModel.getProperty("/items")) || [];

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
            // Remote is the base; local entries override remote ones so that
            // any status the employee changed locally is never overwritten when
            // the route is re-matched and the backend is re-fetched.
            const map = new Map();
            (remote || []).forEach(t => map.set(t.taskId, t));
            (local  || []).forEach(t => {
                const existing = map.get(t.taskId);
                // Merge: keep all remote fields, override with local fields
                map.set(t.taskId, existing ? Object.assign({}, existing, t) : t);
            });
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
            // Always use the resolved employeeId from Component
            return this.getOwnerComponent().getCurrentEmployeeId() || null;
        },

        _currentUserRole() {
            try { return (localStorage.getItem("tsRole") || "employee").toLowerCase(); } catch (e) { return "employee"; }
        },

        _applyFilter() {
            const all      = this._oTdModel.getProperty("/allTasks") || [];
            const sQuery   = this._oTdModel.getProperty("/searchQuery") || "";
            const sPrio    = this._oTdModel.getProperty("/priorityFilter") || "";
            const sRole    = this._currentUserRole();
            const sMe      = this._currentEmployeeId();

            // Manager can preview as another employee
            let sFilterEmpId = null;
            if (sRole === "manager") {
                const sViewAs = this._oTdModel.getProperty("/viewAsEmployee");
                if (sViewAs && sViewAs !== "__me") sFilterEmpId = sViewAs;
                // "My tasks" for manager = tasks assigned to manager themselves
                else if (sViewAs === "__me" && sMe) sFilterEmpId = sMe;
            } else {
                // Regular employee: only see their own tasks (assigned OR they are reviewer)
                sFilterEmpId = sMe;
            }

            const employees = this._oTdModel.getProperty("/employees") || [];
            const empMap = new Map(employees.map(e => [e.employeeId, e.employeeName]));

            const filtered = all
                .filter(t => {
                    const tAssignee = t.assignedTo_employeeId ||
                                     (t.assignedTo && t.assignedTo.employeeId) ||
                                     t.assignedTo;
                    const tReviewer = t.reviewer_employeeId ||
                                     (t.reviewer && t.reviewer.employeeId) ||
                                     t.reviewer;

                    // Show task if current user is assignee OR reviewer
                    if (sFilterEmpId) {
                        const isAssignee = tAssignee === sFilterEmpId;
                        const isReviewer = tReviewer === sFilterEmpId;
                        if (!isAssignee && !isReviewer) return false;
                    }

                    if (sPrio && t.priority !== sPrio) return false;
                    if (sQuery) {
                        const hay = ((t.taskName || "") + " " +
                                     (t.taskDescription || "") + " " +
                                     (t.taskId || "")).toLowerCase();
                        if (!hay.includes(sQuery)) return false;
                    }
                    return true;
                })
                .map(t => {
                    const tAssignee = t.assignedTo_employeeId ||
                                     (t.assignedTo && t.assignedTo.employeeId) ||
                                     t.assignedTo;
                    const tReviewer = t.reviewer_employeeId ||
                                     (t.reviewer && t.reviewer.employeeId) ||
                                     t.reviewer;
                    const isAssignee       = tAssignee === sMe;
                    // Reviewer action row: ONLY show when current user IS the reviewer
                    // AND the task status is exactly "In Review"
                    const isReviewerActive = (tReviewer === sMe) && (t.status === "In Review");
                    return Object.assign({}, t, {
                        assigneeName:      empMap.get(tAssignee) || "Unassigned",
                        reviewerName:      empMap.get(tReviewer) || "",
                        dueLabel:          formatDueLabel(t.dueDate),
                        _isAssignee:       isAssignee,        // drives "Update status" row
                        _isReviewerActive: isReviewerActive   // drives "Review decision" row
                    });
                })
                .sort((a, b) => {
                    const ra = PRIORITY_RANK[a.priority] ?? 99;
                    const rb = PRIORITY_RANK[b.priority] ?? 99;
                    if (ra !== rb) return ra - rb;
                    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                    return da - db;
                });

            this._oTdModel.setProperty("/displayTasks", filtered);
            this._oTdModel.setProperty("/totalLabel",
                filtered.length + (filtered.length === 1 ? " task" : " tasks"));
        },

        // ── Status change via Select dropdown ────────────────────────────────

        onStatusChange(oEvent) {
            const sSelectedKey = oEvent.getParameter("selectedItem").getKey();
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || task.status === sSelectedKey) return;

            // If moving to "In Review" → open reviewer selection dialog
            if (sSelectedKey === "In Review") {
                this._openReviewerDialog(task, oEvent.getSource());
                // Reset the select back to current value (dialog will confirm)
                oEvent.getSource().setSelectedKey(task.status);
                return;
            }

            this._updateTaskStatus(task.taskId, sSelectedKey, null, null);
        },

        // ── Reviewer actions (for the person set as reviewer) ────────────────

        onMarkReviewed(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task) return;
            this._updateTaskStatus(task.taskId, "Completed", null, "Reviewed");
        },

        onReopenTask(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task) return;
            this._updateTaskStatus(task.taskId, "In Progress", null, "Reopened");
        },

        // ── Reviewer Selection Dialog ─────────────────────────────────────────

        _openReviewerDialog(task) {
            const reviewers = this._oTdModel.getProperty("/reviewerCandidates") || [];
            if (!reviewers.length) {
                MessageToast.show("No reviewers available.");
                return;
            }

            // Build select control
            const oSelect = new Select({
                width: "100%",
                forceSelection: false
            });
            oSelect.addItem(new Item({ key: "", text: "— Select reviewer —" }));
            reviewers.forEach(e => {
                oSelect.addItem(new Item({
                    key: e.employeeId,
                    text: e.employeeName + (e.designation ? " (" + e.designation + ")" : "")
                }));
            });

            const oDialog = new Dialog({
                title: "Select Reviewer",
                type: "Message",
                content: [
                    new VBox({
                        items: [
                            new Label({ text: "Choose who will review this task:", wrapping: true }),
                            oSelect
                        ]
                    }).addStyleClass("sapUiSmallMarginTop")
                ],
                beginButton: new Button({
                    type: "Emphasized",
                    text: "Send for Review",
                    press: () => {
                        const sReviewerId = oSelect.getSelectedKey();
                        if (!sReviewerId) {
                            MessageToast.show("Please select a reviewer.");
                            return;
                        }
                        oDialog.close();
                        this._updateTaskStatus(task.taskId, "In Review", sReviewerId, "Pending");
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: () => oDialog.close()
                }),
                afterClose: () => oDialog.destroy()
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        // ── Core status update ────────────────────────────────────────────────

        _updateTaskStatus(sTaskId, sStatus, sReviewerId, sReviewerStatus) {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const items = (oTasksModel.getProperty("/items") || []).slice();
            const idx = items.findIndex(t => t.taskId === sTaskId);

            const patch = {
                status:            sStatus,
                statusUpdatedAt:   new Date().toISOString()
            };
            if (sReviewerId !== undefined && sReviewerId !== null) {
                patch.reviewer_employeeId = sReviewerId;
            }
            if (sReviewerStatus !== undefined && sReviewerStatus !== null) {
                patch.reviewerStatus = sReviewerStatus;
            }

            if (idx < 0) {
                // Task lives only in the backend — pull its full record from
                // allTasks (the raw merged list before display enrichment)
                // and save a local copy so future reloads keep the new status.
                const allRaw = this._oTdModel.getProperty("/allTasks") || [];
                const baseTask = allRaw.find(t => t.taskId === sTaskId);
                if (baseTask) {
                    // Strip display-only fields added by _applyFilter before saving
                    const clean = Object.assign({}, baseTask);
                    delete clean.assigneeName;
                    delete clean.reviewerName;
                    delete clean.dueLabel;
                    delete clean._isAssignee;
                    delete clean._isReviewerActive;
                    items.push(Object.assign({}, clean, patch));
                }
            } else {
                items[idx] = Object.assign({}, items[idx], patch);
            }

            oTasksModel.setProperty("/items", items);
            this.getOwnerComponent().persistTasks();

            // Update live view immediately
            const allUpdated = (this._oTdModel.getProperty("/allTasks") || []).map(t =>
                t.taskId === sTaskId ? Object.assign({}, t, patch) : t
            );
            this._oTdModel.setProperty("/allTasks", allUpdated);
            this._applyFilter();

            // ── Persist to OData backend ──────────────────────────────────────
            this._patchTaskOnBackend(sTaskId, patch);

            // Notify the reviewer if task sent for review
            if (sStatus === "In Review" && sReviewerId) {
                this._notifyReviewer(sTaskId, sReviewerId);
            }

            const msgs = {
                "Not Started": "Task reset to Not Started.",
                "In Progress": "Task marked as In Progress.",
                "In Review":   "Task sent for review.",
                "Completed":   "Task marked as Completed."
            };
            MessageToast.show(msgs[sStatus] || "Status updated to " + sStatus + ".");
        },

        _patchTaskOnBackend(sTaskId, oPatch) {
            // Call the dedicated CAP action — plain PATCH on MyTasks projection
            // is blocked for the Employee role, so we use an unbound action instead.
            fetch("/employee/updateTaskStatus", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskId:         sTaskId,
                    status:         oPatch.status         || null,
                    reviewerId:     oPatch.reviewer_employeeId || null,
                    reviewerStatus: oPatch.reviewerStatus  || null
                })
            })
            .then(r => {
                if (!r.ok) r.text().then(t => console.error("updateTaskStatus failed:", r.status, t));
            })
            .catch(e => console.error("updateTaskStatus error:", e));
        },

        _notifyReviewer(sTaskId, sReviewerId) {
            // Add a notification in the local notifications model for the reviewer
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            if (!oNotifModel) return;
            const items = (oNotifModel.getProperty("/items") || []).slice();
            const all = this._oTdModel.getProperty("/allTasks") || [];
            const task = all.find(t => t.taskId === sTaskId);
            items.unshift({
                notificationId: sTaskId + "-REV-" + Date.now(),
                employee_employeeId: sReviewerId,
                type: "TASK_REVIEW_REQUESTED",
                title: "Review Requested",
                message: "You have been asked to review task: " + (task ? task.taskName : sTaskId),
                isRead: false,
                referenceId: sTaskId,
                notifiedAt: new Date().toISOString()
            });
            oNotifModel.setProperty("/items", items);
            this.getOwnerComponent().persistNotifications();

            // Also POST to backend notification endpoint if available
            fetch("/employee/createNotification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeId: sReviewerId,
                    type: "TASK_REVIEW_REQUESTED",
                    title: "Review Requested",
                    message: "You have been asked to review: " + (task ? task.taskName : sTaskId),
                    referenceId: sTaskId
                })
            }).catch(() => {/* silent */});
        },

        // ── Attachment download ───────────────────────────────────────────────

        onDownloadTaskAttachment(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.taskId) return;

            const showError = (msg) => MessageToast.show(msg);
            const triggerDownload = (dataUrl, name) => {
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = name || "attachment";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            };

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
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ taskId: task.taskId })
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
                    if (!v || !v.dataBase64) { showError("Attachment is not available."); return; }
                    triggerDownload("data:" + (v.mimeType || "application/octet-stream") +
                                    ";base64," + v.dataBase64, v.fileName);
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

        // ── Detail navigation ─────────────────────────────────────────────────

        onOpenDetails(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.taskId) return;
            this.getOwnerComponent().getRouter()
                .navTo("task-detail", { taskId: task.taskId });
        },

        // ── Formatters ────────────────────────────────────────────────────────

        formatPriorityState(sValue)  { return PRIORITY_STATE[sValue] || "None"; },
        formatStatusState(sValue)    { return STATUS_STATE[sValue]   || "None"; },

        /**
         * Returns true when the current user is the reviewer AND task is In Review
         * Used to show/hide the "Reviewed / Reopen" reviewer action buttons.
         */
        formatIsReviewerActions(sStatus, sReviewerEmpId) {
            const sMe = this._currentEmployeeId();
            return sStatus === "In Review" && sReviewerEmpId === sMe;
        },

        /**
         * Returns true when the current user is the ASSIGNEE
         * Used to show/hide the status Select dropdown.
         */
        formatIsAssigneeActions(sAssignedEmpId) {
            const sMe = this._currentEmployeeId();
            return sAssignedEmpId === sMe;
        },

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        }
    });
});