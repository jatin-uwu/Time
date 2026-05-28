sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Select",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/TextArea",
    "sap/m/Text",
    "sap/ui/unified/FileUploader",
    "sap/ui/core/Item",
    "sap/ui/core/Core"
], (Controller, JSONModel, MessageToast, MessageBox, Dialog, Button, Select, Label, VBox, HBox, TextArea, Text, FileUploader, Item, Core) => {
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
                // Fire-and-forget — fetch latest review per task in the
                // background. Updates the model in place once resolved.
                this._loadReviewsForTasks(merged);
            };

            if (!oModel) { finish([]); return; }

            oModel.bindList("/MyTasks").requestContexts(0, 500)
                .then(aCtx => finish(aCtx.map(c => c.getObject())))
                .catch(() => finish([]));
        },

        // Fetch the latest TaskReview row for every task that has a
        // reviewerStatus set. Decorates the task with reviewRemarks /
        // reviewDecision / reviewerName / reviewAttachmentName / reviewId so
        // the assignee can see what the reviewer wrote.
        _loadReviewsForTasks(tasks) {
            const reviewable = (tasks || []).filter(t =>
                t.reviewerStatus === "Issue Found" ||
                t.reviewerStatus === "Reviewed" ||
                t.status === "In Review"
            );
            if (!reviewable.length) return;

            Promise.all(reviewable.map(t =>
                fetch("/employee/getTaskReview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ taskId: t.taskId }),
                    credentials: "include"
                })
                    .then(r => r.ok ? r.json() : null)
                    .then(j => ({ taskId: t.taskId, review: (j && (j.value || j)) || null }))
                    .catch(() => ({ taskId: t.taskId, review: null }))
            )).then((results) => {
                const all = this._oTdModel.getProperty("/allTasks") || [];
                const next = all.map(t => {
                    const hit = results.find(r => r.taskId === t.taskId);
                    if (!hit || !hit.review || !hit.review.reviewId) return t;
                    const rv = hit.review;
                    return Object.assign({}, t, {
                        reviewId:             rv.reviewId || "",
                        reviewDecision:       rv.decision || "",
                        reviewRemarks:        rv.remarks || "",
                        reviewerName:         rv.reviewerName || t.reviewerName || "",
                        reviewAttachmentName: rv.attachmentName || ""
                    });
                });
                this._oTdModel.setProperty("/allTasks", next);
                this._applyFilter();
            });
        },

        _mergeTasks(local, remote) {
            // Remote (DB) always wins. Also normalises legacy "Open" status
            // to "Not Started" so the Select dropdown always finds a valid key.
            const norm = t => {
                if (!t || !t.taskId) return t;
                return (t.status === "Open")
                    ? Object.assign({}, t, { status: "Not Started" })
                    : t;
            };
            const map = new Map();
            (local  || []).forEach(t => { const n = norm(t); if (n && n.taskId) map.set(n.taskId, n); });
            (remote || []).forEach(t => { const n = norm(t); if (n && n.taskId) map.set(n.taskId, n); });
            return Array.from(map.values());
        },

        // ── Filters ──────────────────────────────────────────────────────────

        onSearch(oEvent) {
            this._oTdModel.setProperty("/searchQuery",
                (oEvent.getParameter("newValue") || "").toLowerCase());
            this._applyFilter();
        },

        onPriorityFilter(oEvent) {
            const sText = oEvent.getSource().getText();
            this._oTdModel.setProperty("/priorityFilter", sText === "All" ? "" : sText);
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
            const oSelect  = oEvent.getSource();
            const sNewKey  = oEvent.getParameter("selectedItem").getKey();
            const oCtx     = oSelect.getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task) return;

            // "In Review" opens the reviewer-selection dialog
            if (sNewKey === "In Review") {
                this._openReviewerDialog(task);
                oSelect.setSelectedKey(task.status || "Not Started");
                return;
            }

            if (task.status === sNewKey) return;

            // Open confirmation dialog — backend is called only when user clicks Save
            this._openStatusConfirmDialog(task, sNewKey, oSelect);
        },

        // ── Status confirmation dialog ────────────────────────────────────────
        // Opens when employee picks a non-"In Review" status from the dropdown.
        // Backend is called only when the user explicitly clicks Save, so the
        // DB and the UI are always in sync — no optimistic-update reverts.

        _openStatusConfirmDialog(task, sNewStatus, oSelect) {
            const sOldStatus = task.status || "Not Started";

            const oSaveBtn = new Button({
                type: "Emphasized",
                text: "Save",
                press: () => {
                    oDialog.setBusy(true);
                    oSaveBtn.setEnabled(false);

                    this._saveStatusToBackend(task.taskId, sNewStatus, "", "")
                        .then(() => {
                            const patch = {
                                status:          sNewStatus,
                                statusUpdatedAt: new Date().toISOString()
                            };
                            this._applyLocalStatusPatch(task.taskId, patch);
                            this._publishTaskStatusChanged(task.taskId, sNewStatus);
                            oDialog.close();
                            const label = {
                                "Not Started": "Task reset to Not Started.",
                                "In Progress": "Task is now In Progress.",
                                "Completed":   "Task marked as Completed.",
                                "Reopened":    "Task reopened."
                            };
                            MessageToast.show(label[sNewStatus] || "Status updated to " + sNewStatus + ".");
                        })
                        .catch((oErr) => {
                            oDialog.setBusy(false);
                            oSaveBtn.setEnabled(true);
                            oSelect.setSelectedKey(sOldStatus);
                            MessageBox.error(
                                "Could not save status: " +
                                (oErr && oErr.message ? oErr.message : String(oErr))
                            );
                        });
                }
            });

            const oDialog = new Dialog({
                title:        "Confirm Status Change",
                contentWidth: "380px",
                content: [
                    new VBox({
                        items: [
                            new Text({
                                text:     "Task:  " + (task.taskName || task.taskId),
                                wrapping: true
                            }),
                            new HBox({
                                items: [
                                    new Text({ text: sOldStatus }).addStyleClass("sapUiTinyMarginEnd"),
                                    new Text({ text: "→"        }).addStyleClass("sapUiSmallMarginEnd"),
                                    new Text({ text: sNewStatus })
                                ]
                            }).addStyleClass("sapUiSmallMarginTop")
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: oSaveBtn,
                endButton: new Button({
                    text:  "Cancel",
                    press: () => {
                        oSelect.setSelectedKey(sOldStatus);
                        oDialog.close();
                    }
                }),
                afterClose: () => oDialog.destroy()
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        // ── Reviewer actions (open dialog with remarks + optional attachment) ──

        onOpenReviewedDialog(oEvent) {
            const task = this._getTaskFromEvent(oEvent);
            if (!task) return;
            this._openReviewDecisionDialog({
                task,
                decision: "Reviewed",
                title:     "Mark as Reviewed",
                subtitle:  "Confirm this task has been reviewed and is complete.",
                buttonText: "Submit Review",
                buttonType: "Accept",
                action:     "submitReview"
            });
        },

        onOpenIssueDialog(oEvent) {
            const task = this._getTaskFromEvent(oEvent);
            if (!task) return;
            this._openReviewDecisionDialog({
                task,
                decision:  "IssueFound",
                title:     "Report Issue",
                subtitle:  "Describe the issue so the assignee can rework the task.",
                buttonText: "Submit Issue",
                buttonType: "Reject",
                action:     "reportIssue"
            });
        },

        _getTaskFromEvent(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return null;
            return oCtx.getObject();
        },

        _openReviewDecisionDialog(o) {
            const oForm = new JSONModel({
                taskId:     o.task.taskId,
                taskName:   o.task.taskName,
                remarks:    "",
                fileName:   "",
                mimeType:   "",
                dataBase64: "",
                busy:       false
            });

            const oRemarks = new TextArea({
                width: "100%",
                rows: 5,
                placeholder: "Enter remarks (required)…",
                value: "{form>/remarks}",
                growing: false
            });

            const oFileUpload = new FileUploader({
                width: "100%",
                placeholder: "No file selected",
                buttonText: "Choose File",
                buttonOnly: false,
                fileType: ["pdf", "png", "jpg", "jpeg", "doc", "docx", "xls", "xlsx", "txt", "zip"],
                maximumFileSize: 5,
                change: (oEv) => {
                    const file = oEv.getParameter("files") && oEv.getParameter("files")[0];
                    if (!file) {
                        oForm.setProperty("/fileName", "");
                        oForm.setProperty("/mimeType", "");
                        oForm.setProperty("/dataBase64", "");
                        return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                        MessageToast.show("File must be under 5 MB.");
                        oFileUpload.clear();
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        oForm.setProperty("/fileName", file.name);
                        oForm.setProperty("/mimeType", file.type || "application/octet-stream");
                        oForm.setProperty("/dataBase64", ev.target.result);
                    };
                    reader.readAsDataURL(file);
                },
                typeMissmatch: () => MessageToast.show("Unsupported file type."),
                fileSizeExceed: () => MessageToast.show("File must be under 5 MB.")
            });

            const oSubmitBtn = new Button({
                type: o.buttonType,
                text: o.buttonText,
                icon: o.decision === "Reviewed" ? "sap-icon://accept" : "sap-icon://alert",
                enabled: "{= ${form>/busy} === false }",
                press: () => {
                    const sRemarks = (oForm.getProperty("/remarks") || "").trim();
                    if (!sRemarks) {
                        MessageToast.show("Please enter remarks.");
                        return;
                    }
                    oForm.setProperty("/busy", true);
                    oSubmitBtn.setEnabled(false);
                    this._submitReviewDecision({
                        action:     o.action,
                        decision:   o.decision,
                        taskId:     oForm.getProperty("/taskId"),
                        remarks:    sRemarks,
                        fileName:   oForm.getProperty("/fileName"),
                        mimeType:   oForm.getProperty("/mimeType"),
                        dataBase64: oForm.getProperty("/dataBase64")
                    }).then(() => {
                        oDialog.close();
                    }).catch((err) => {
                        oForm.setProperty("/busy", false);
                        oSubmitBtn.setEnabled(true);
                        MessageBox.error(err && err.message ? err.message : String(err));
                    });
                }
            });

            const oDialog = new Dialog({
                title: o.title,
                contentWidth: "440px",
                content: [
                    new VBox({
                        items: [
                            new Text({ text: o.subtitle }).addStyleClass("sapUiSmallMarginBottom"),
                            new Text({ text: "Task: " + o.task.taskName,
                                       wrapping: true }).addStyleClass("sapUiTinyMarginBottom"),
                            new Label({ text: "Remarks *", labelFor: oRemarks.getId() })
                                .addStyleClass("sapUiTinyMarginTop"),
                            oRemarks,
                            new Label({ text: "Attachment (optional)", labelFor: oFileUpload.getId() })
                                .addStyleClass("sapUiSmallMarginTop"),
                            oFileUpload,
                            new Text({
                                text: "Attach a screenshot, document, or any supporting file (max 5 MB).",
                                wrapping: true
                            }).addStyleClass("sapUiTinyMarginTop tsHintText")
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: oSubmitBtn,
                endButton: new Button({
                    text: "Cancel",
                    press: () => oDialog.close()
                }),
                afterClose: () => oDialog.destroy()
            });
            oDialog.setModel(oForm, "form");
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _submitReviewDecision({ action, decision, taskId, remarks, fileName, mimeType, dataBase64 }) {
            const payload = {
                taskId,
                remarks,
                fileName: fileName || "",
                mimeType: mimeType || "",
                dataBase64: dataBase64 || ""
            };

            return fetch("/employee/" + action, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify(payload),
                credentials: "include"
            })
                .then(async (r) => {
                    if (!r.ok) {
                        const txt = await r.text();
                        let msg = txt;
                        try { msg = JSON.parse(txt).error?.message || txt; } catch (e) { /**/ }
                        throw new Error(msg || ("Request failed: " + r.status));
                    }
                    return r.json().catch(() => ({}));
                })
                .then(() => {
                    // Compute new target status locally for instant UI update
                    const newStatus = decision === "Reviewed" ? "Completed" : "In Progress";
                    const sReviewerStatus = decision === "Reviewed" ? "Reviewed" : "Issue Found";

                    // Apply the patch to local + display models AND broadcast on the
                    // EventBus so the Dashboard (if alive) re-fetches its summary.
                    this._applyLocalStatusPatch(taskId, {
                        status: newStatus,
                        reviewerStatus: sReviewerStatus,
                        statusUpdatedAt: new Date().toISOString()
                    });
                    this._publishTaskStatusChanged(taskId, newStatus);

                    MessageToast.show(
                        decision === "Reviewed"
                            ? "Task marked as Completed."
                            : "Issue reported — task sent back to assignee."
                    );
                });
        },

        // ── Reviewer Selection Dialog ─────────────────────────────────────────

        _openReviewerDialog(task) {
            // Use the full employees list — fall back to built-in directory if
            // the OData fetch hasn't completed yet. Exclude the assignee themselves.
            let reviewers = (this._oTdModel.getProperty("/employees") || []).slice();
            if (!reviewers.length) {
                reviewers = Object.values(
                    this.getOwnerComponent()._builtinEmployees || {}
                ).filter(e => e.isActive !== false);
            }

            const tAssignee = task.assignedTo_employeeId ||
                              (task.assignedTo && task.assignedTo.employeeId) ||
                              task.assignedTo;
            reviewers = reviewers.filter(e => e.employeeId !== tAssignee);

            if (!reviewers.length) {
                MessageBox.error("No other employees are available to assign as reviewer.");
                return;
            }

            // Pre-select existing reviewer (if already set)
            const existingReviewerId = task.reviewer_employeeId ||
                                       (task.reviewer && task.reviewer.employeeId) || "";

            // Build select control
            const oSelect = new Select({
                width: "100%",
                forceSelection: false,
                selectedKey: existingReviewerId
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
                        oDialog.setBusy(true);
                        this._saveStatusToBackend(task.taskId, "In Review", sReviewerId, "Pending")
                            .then(() => {
                                const patch = {
                                    status:              "In Review",
                                    statusUpdatedAt:     new Date().toISOString(),
                                    reviewer_employeeId: sReviewerId,
                                    reviewerStatus:      "Pending"
                                };
                                this._applyLocalStatusPatch(task.taskId, patch);
                                this._publishTaskStatusChanged(task.taskId, "In Review");
                                this._notifyReviewer(task.taskId, sReviewerId);
                                oDialog.close();
                                MessageToast.show("Task sent for review.");
                            })
                            .catch((oErr) => {
                                oDialog.setBusy(false);
                                MessageBox.error(
                                    "Could not send for review: " +
                                    (oErr && oErr.message ? oErr.message : String(oErr))
                                );
                            });
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


        // Patch local tasks model + view model + persist to localStorage.
        // Used both by the dropdown flow and the reviewer-dialog flow so the
        // UI stays consistent regardless of which path triggered the change.
        _applyLocalStatusPatch(sTaskId, patch) {
            const oTasksModel = this.getOwnerComponent().getModel("tasks");
            const items = (oTasksModel.getProperty("/items") || []).slice();
            const idx = items.findIndex(t => t.taskId === sTaskId);

            if (idx < 0) {
                // Task lives only in the backend — pull its full record from
                // allTasks (the raw merged list before display enrichment)
                // and save a local copy so future reloads keep the new status.
                const allRaw = this._oTdModel.getProperty("/allTasks") || [];
                const baseTask = allRaw.find(t => t.taskId === sTaskId);
                if (baseTask) {
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

            // Update the page-local model immediately so the card re-renders
            const allUpdated = (this._oTdModel.getProperty("/allTasks") || []).map(t =>
                t.taskId === sTaskId ? Object.assign({}, t, patch) : t
            );
            this._oTdModel.setProperty("/allTasks", allUpdated);
            this._applyFilter();
        },

        // Fire a global event so other views (Dashboard task-summary donut,
        // My-Tasks card, Task-Status manager view, etc.) can refresh without
        // waiting for a route match.
        _publishTaskStatusChanged(sTaskId, sStatus) {
            try {
                const oBus = Core.getEventBus ? Core.getEventBus() : sap.ui.getCore().getEventBus();
                oBus.publish("tasks", "statusChanged", {
                    taskId: sTaskId,
                    status: sStatus,
                    at:     Date.now()
                });
            } catch (e) { /* never break the UX over telemetry */ }
        },

        // Pure HTTP call — returns a Promise that resolves on success or rejects
        // with an Error on failure. Callers handle local-model updates and toasts.
        _saveStatusToBackend(sTaskId, sStatus, sReviewerId, sReviewerStatus) {
            return fetch("/employee/updateTaskStatus", {
                method:      "POST",
                credentials: "include",
                headers:     { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    taskId:         sTaskId,
                    status:         sStatus,
                    reviewerId:     sReviewerId     || "",
                    reviewerStatus: sReviewerStatus || ""
                })
            })
            .then(async (r) => {
                if (!r.ok) {
                    const txt = await r.text();
                    let msg = txt;
                    try { msg = JSON.parse(txt).error?.message || txt; } catch (e) { /**/ }
                    throw new Error("HTTP " + r.status + ": " + msg);
                }
                return r.json().catch(() => ({}));
            });
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

        // ── Download a reviewer's attachment via the dedicated action ────────
        onDownloadReviewAttachment(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("tdView");
            if (!oCtx) return;
            const task = oCtx.getObject();
            if (!task || !task.reviewId) {
                MessageToast.show("No review attachment available.");
                return;
            }
            fetch("/employee/getReviewAttachment", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ reviewId: task.reviewId }),
                credentials: "include"
            })
                .then(async r => {
                    if (!r.ok) {
                        const txt = await r.text();
                        throw new Error(txt || ("HTTP " + r.status));
                    }
                    return r.json();
                })
                .then(data => {
                    const v = (data && (data.value || data)) || {};
                    if (!v.dataBase64) {
                        MessageToast.show("Attachment is not available.");
                        return;
                    }
                    const dataUrl = "data:" + (v.mimeType || "application/octet-stream") +
                                    ";base64," + v.dataBase64;
                    const a = document.createElement("a");
                    a.href = dataUrl;
                    a.download = v.fileName || "review-attachment";
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                })
                .catch(e => MessageToast.show("Could not download attachment: " + (e.message || e)));
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