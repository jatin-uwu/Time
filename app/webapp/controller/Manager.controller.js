sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "timesheet/app/util/MessageBox",
    "sap/m/MessageToast",
    "timesheet/app/util/CustomDialog",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/m/Text",
    "sap/m/Label",
    "sap/m/TextArea"
], (Controller, JSONModel, MessageBox, MessageToast, Dialog, Button, VBox, Text, Label, TextArea) => {
    "use strict";

    const DAYS      = ["mon","tue","wed","thu","fri","sat","sun"];
    const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const STATUS_STATE = { "Pending": "Warning", "Submitted": "Warning", "Approved": "Success", "Rejected": "Error" };

    function toShortLabel(date) {
        return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    }

    function buildDayLabels(weekStart) {
        return DAY_NAMES.map((name, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            return { name, date: d.getDate() + " " + MONTHS[d.getMonth()] };
        });
    }

    return Controller.extend("timesheet.app.controller.Manager", {

        onInit() {
            this._oMgrModel = new JSONModel({
                allSubmissions:        [],
                submissions:           [],
                pendingCount:          0,
                prevWeekRequests:      [],
                allPrevWeekRequests:   [],
                prevWeekPendingCount:  0,
                leaveRequests:         [],
                allLeaveRequests:      [],
                leavePendingCount:     0,
                activeSection:         "timesheets",   // drives tab visibility
                showDetail:            false,
                pageTitle:             "Manager – Approvals",
                selectedEmployee:      "",
                selectedWeek:          "",
                selectedSubmittedOn:   "",
                selectedStatus:        "",
                selectedRemarks:       "",
                busy:                  false,
                days:  DAY_NAMES.map(n => ({ name: n, date: "" })),
                rows:     [],
                rowCount: 1
            });
            this.getView().setModel(this._oMgrModel, "mgrView");

            this.getOwnerComponent().getRouter()
                .getRoute("manager")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._oMgrModel.setProperty("/showDetail",     false);
            this._oMgrModel.setProperty("/pageTitle",      "Manager – Approvals");
            this._oMgrModel.setProperty("/activeSection",  "timesheets");
            this._selectedSub = null;
            this._loadSubmissions();
            this._loadPrevWeekRequests();
            this._loadLeaveRequests();
        },

        onNavBack() {
            this._oMgrModel.setProperty("/showDetail", false);
            this._oMgrModel.setProperty("/pageTitle",  "Manager – Approvals");
        },

        // ── Switch between Timesheets and Prev-Week tabs ──────────────────
        onSectionTabSelect(oEvent) {
            const sKey = oEvent.getParameter("selectedItem").getKey();
            this._oMgrModel.setProperty("/activeSection", sKey);
        },

        // ════════════════════════════════════════════════════════════════════
        // TIMESHEET APPROVALS
        // ════════════════════════════════════════════════════════════════════

        _loadSubmissions() {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) {
                this._loadFromLocalStorage();
                return;
            }

            this._oMgrModel.setProperty("/busy", true);

            oMgrModel.bindList("/PendingApprovals", null, null, null, {
                $expand: "employee"
            }).requestContexts(0, 200)
                .then(aCtx => {
                    const timesheets = aCtx.map(c => c.getObject()).filter(Boolean);
                    const submissions = timesheets.map(ts => {
                        const weekStart = ts.weekStartDate
                            ? new Date(ts.weekStartDate + "T00:00:00") : null;
                        const weekEnd   = ts.weekEndDate
                            ? new Date(ts.weekEndDate   + "T00:00:00") : null;
                        const weekRange = weekStart && weekEnd
                            ? `${toShortLabel(weekStart)} – ${toShortLabel(weekEnd)}`
                            : ts.weekStartDate || "";

                        return {
                            timesheetId:   ts.timesheetId,
                            employeeId:    ts.employee_employeeId,
                            employeeName:  (ts.employee && ts.employee.employeeName)
                                           || ts.employee_employeeId || "Employee",
                            weekStart:     ts.weekStartDate,
                            weekEnd:       ts.weekEndDate,
                            weekRange,
                            submittedOn:   ts.submittedOn
                                ? new Date(ts.submittedOn).toLocaleString() : "",
                            grandTotal:    "—",
                            status:        ts.status,
                            remarks:       ts.remarks || "",
                            _source:       "backend"
                        };
                    });

                    const pending = submissions.filter(s =>
                        s.status === "Submitted" || s.status === "Pending"
                    ).length;
                    this._oMgrModel.setProperty("/allSubmissions", submissions);
                    this._oMgrModel.setProperty("/pendingCount",   pending);
                    this._applyFilter(submissions);
                })
                .catch(() => this._loadFromLocalStorage())
                .finally(() => this._oMgrModel.setProperty("/busy", false));
        },

        _loadFromLocalStorage() {
            const oComp = this.getOwnerComponent();
            const sMyId = oComp.getCurrentEmployeeId();
            const all   = (oComp.getModel("history") &&
                           oComp.getModel("history").getProperty("/submissions")) || [];
            const mine  = all.filter(s => !s.reportsTo || s.reportsTo === sMyId);

            const pending = mine.filter(s => s.status === "Pending").length;
            this._oMgrModel.setProperty("/allSubmissions", mine);
            this._oMgrModel.setProperty("/pendingCount",   pending);
            this._applyFilter(mine);
        },

        _applyFilter(all) {
            const data     = all || (this._oMgrModel.getProperty("/allSubmissions") || []);
            const filtered = data.filter(s => s.status === "Pending" || s.status === "Submitted");
            this._oMgrModel.setProperty("/submissions", filtered);
        },

        onApprovalSelect(oEvent) {
            const oCtx = oEvent.getParameter("listItem").getBindingContext("mgrView");
            if (!oCtx) return;

            const sub = oCtx.getObject();
            this._selectedSub = sub;

            const sName = sub.employeeName || "Employee";
            this._oMgrModel.setProperty("/showDetail",          true);
            this._oMgrModel.setProperty("/pageTitle",           sName + " – " + sub.weekRange);
            this._oMgrModel.setProperty("/selectedEmployee",    sName);
            this._oMgrModel.setProperty("/selectedWeek",        sub.weekRange);
            this._oMgrModel.setProperty("/selectedSubmittedOn", sub.submittedOn);
            this._oMgrModel.setProperty("/selectedStatus",      sub.status);
            this._oMgrModel.setProperty("/selectedRemarks",     sub.remarks || "");

            if (sub._source === "backend") {
                this._loadEntriesFromBackend(sub);
            } else {
                this._buildTableRows(sub);
            }
        },

        // ── Inline Approve / Reject (table row buttons) ───────────────────
        onApproveTimesheetInline(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("mgrView");
            const sub  = oCtx.getObject();

            MessageBox.confirm(
                `Approve timesheet for ${sub.weekRange} submitted by ${sub.employeeName || "this employee"}?`,
                {
                    title:            "Approve Timesheet",
                    actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        this._oMgrModel.setProperty("/busy", true);
                        fetch("/manager/approveTimesheet", {
                            method:  "POST",
                            headers: { "Content-Type": "application/json", "Accept": "application/json" },
                            body:    JSON.stringify({ timesheetId: sub.timesheetId, remarks: "" })
                        })
                        .then(r => r.ok ? r.json() : Promise.reject(new Error("Approve failed: " + r.status)))
                        .then(() => {
                            this._loadSubmissions();
                            MessageToast.show("Timesheet approved.");
                        })
                        .catch(err => MessageBox.error((err && err.message) || "Approve failed."))
                        .finally(() => this._oMgrModel.setProperty("/busy", false));
                    }
                }
            );
        },

        onRejectTimesheetInline(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("mgrView");
            const sub  = oCtx.getObject();

            const oTA = new TextArea({
                placeholder: "Enter rejection reason (required)...",
                rows: 4,
                width: "100%"
            });

            const oDialog = new Dialog({
                title: "Reject Timesheet",
                content: [
                    new VBox({
                        items: [
                            new Text({
                                text: "Provide a reason for rejection. The employee will be notified.",
                                wrapping: true
                            }).addStyleClass("sapUiSmallMarginBottom"),
                            new Label({ text: "Reason", labelFor: oTA }),
                            oTA
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: new Button({
                    text: "Reject",
                    type: "Reject",
                    press: () => {
                        const sComment = oTA.getValue().trim();
                        if (!sComment) { MessageToast.show("Please enter a rejection reason."); return; }
                        oDialog.close();
                        oDialog.destroy();
                        this._oMgrModel.setProperty("/busy", true);
                        fetch("/manager/rejectTimesheet", {
                            method:  "POST",
                            headers: { "Content-Type": "application/json", "Accept": "application/json" },
                            body:    JSON.stringify({ timesheetId: sub.timesheetId, remarks: sComment })
                        })
                        .then(r => r.ok ? r.json() : Promise.reject(new Error("Reject failed: " + r.status)))
                        .then(() => {
                            this._loadSubmissions();
                            MessageToast.show(`Timesheet rejected. ${sub.employeeName || "Employee"} has been notified.`);
                        })
                        .catch(err => MessageBox.error((err && err.message) || "Reject failed."))
                        .finally(() => this._oMgrModel.setProperty("/busy", false));
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: () => { oDialog.close(); oDialog.destroy(); }
                })
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _loadEntriesFromBackend(sub) {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) { this._buildTableRows(sub); return; }

            this._oMgrModel.setProperty("/busy", true);

            oMgrModel.bindList("/ApprovalEntries", null, null, null, {
                $expand: "task",
                $filter: `timesheet_timesheetId eq '${sub.timesheetId}'`
            }).requestContexts(0, 200)
                .then(aCtx => {
                    const entries   = aCtx.map(c => c.getObject()).filter(Boolean);
                    const weekStart = new Date(sub.weekStart + "T00:00:00");
                    const weekDates = DAYS.map((_, i) => {
                        const d = new Date(weekStart);
                        d.setDate(weekStart.getDate() + i);
                        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                    });

                    const rowMap = new Map();
                    entries.forEach(entry => {
                        const taskId   = entry.task_taskId || "unknown";
                        const taskName = (entry.task && entry.task.taskName) || "Unknown Task";
                        const taskDesc = (entry.task && entry.task.taskDescription) || "";
                        if (!rowMap.has(taskId)) {
                            rowMap.set(taskId, { taskId, projectName: taskName, taskName: taskDesc,
                                mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 });
                        }
                        const idx = weekDates.indexOf(entry.workDate);
                        if (idx >= 0) rowMap.get(taskId)[DAYS[idx]] += parseFloat(entry.hoursWorked) || 0;
                    });

                    const dataRows = Array.from(rowMap.values()).map(row => {
                        const r = { taskId: row.taskId, projectName: row.projectName, taskName: row.taskName };
                        DAYS.forEach(d => { r[d] = row[d] > 0 ? this._toHHMM(row[d]) : ""; });
                        const rowDec = DAYS.reduce((sum, d) => sum + this._parseHHMM(r[d]), 0);
                        r._type      = "data";
                        r._weekTotal = this._toHHMM(rowDec);
                        return r;
                    });

                    const colDec = { mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 };
                    dataRows.forEach(row => DAYS.forEach(d => { colDec[d] += this._parseHHMM(row[d]); }));
                    const grand = DAYS.reduce((s, d) => s + colDec[d], 0);

                    const dayTotalRow = {
                        _type: "total", projectName: "Day Total(Hrs)", taskName: "",
                        _weekTotal: this._toHHMM(grand)
                    };
                    DAYS.forEach(d => { dayTotalRow[d] = this._toHHMM(colDec[d]); });

                    const status    = sub.status || "Submitted";
                    const statusRow = { _type: "status", projectName: "Status", taskName: "", _weekTotal: "" };
                    DAYS.forEach(d => {
                        statusRow[d] = dataRows.some(r => r[d] && r[d] !== "") ? status : "";
                    });

                    const allRows = [...dataRows, dayTotalRow, statusRow];
                    this._oMgrModel.setProperty("/days",     buildDayLabels(weekStart));
                    this._oMgrModel.setProperty("/rows",     allRows);
                    this._oMgrModel.setProperty("/rowCount", allRows.length);

                    const oTable = this.byId("mgrTable");
                    if (oTable) oTable.setFixedBottomRowCount(2);
                })
                .catch(() => this._buildTableRows(sub))
                .finally(() => this._oMgrModel.setProperty("/busy", false));
        },

        _buildTableRows(submission) {
            const weekStart = new Date(submission.weekStart + "T00:00:00");
            this._oMgrModel.setProperty("/days", buildDayLabels(weekStart));

            const dataRows = (submission.rows || []).map(row => {
                const rowDec = DAYS.reduce((sum, d) => sum + this._parseHHMM(row[d]), 0);
                return Object.assign({}, row, { _type: "data", _weekTotal: this._toHHMM(rowDec) });
            });

            const colDec = { mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 };
            dataRows.forEach(row => DAYS.forEach(d => { colDec[d] += this._parseHHMM(row[d]); }));
            const grand = DAYS.reduce((s, d) => s + colDec[d], 0);

            const dayTotalRow = {
                _type: "total", projectName: "Day Total(Hrs)", taskName: "",
                _weekTotal: this._toHHMM(grand)
            };
            DAYS.forEach(d => { dayTotalRow[d] = this._toHHMM(colDec[d]); });

            const status    = submission.status || "Pending";
            const statusRow = { _type: "status", projectName: "Status", taskName: "", _weekTotal: "" };
            DAYS.forEach(d => {
                const hasValue = dataRows.some(r => r[d] && r[d] !== "");
                statusRow[d] = hasValue ? status : "";
            });

            const allRows = [...dataRows, dayTotalRow, statusRow];
            this._oMgrModel.setProperty("/rows",     allRows);
            this._oMgrModel.setProperty("/rowCount", allRows.length);

            const oTable = this.byId("mgrTable");
            if (oTable) oTable.setFixedBottomRowCount(2);
        },

        // ── Approve Timesheet ─────────────────────────────────────────────
        onApprove() {
            const sub = this._selectedSub;
            if (!sub) return;

            MessageBox.confirm(
                `Approve timesheet for ${sub.weekRange} submitted by ${sub.employeeName || "this employee"}?`,
                {
                    title:   "Approve Timesheet",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: (sAction) => {
                        if (sAction === MessageBox.Action.OK) this._doApprove();
                    }
                }
            );
        },

        _doApprove() {
            const sub = this._selectedSub;
            if (!sub) return;

            this._oMgrModel.setProperty("/busy", true);

            fetch("/manager/approveTimesheet", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify({ timesheetId: sub.timesheetId, remarks: "" })
            })
            .then(r => r.ok ? r.json() : Promise.reject(new Error("Approve failed: " + r.status)))
            .then(() => {
                this._oMgrModel.setProperty("/selectedStatus",  "Approved");
                this._oMgrModel.setProperty("/selectedRemarks", "");
                this._loadSubmissions();
                this._rebuildStatus("Approved");
                MessageToast.show("Timesheet approved.");
            })
            .catch(err => MessageBox.error((err && err.message) || "Approve failed."))
            .finally(() => this._oMgrModel.setProperty("/busy", false));
        },

        // ── Reject Timesheet ──────────────────────────────────────────────
        onReject() {
            if (!this._oRejectTextArea) {
                this._oRejectTextArea = new TextArea({
                    placeholder: "Enter rejection reason (required)...",
                    rows:        4,
                    width:       "100%"
                });
                this._oRejectDialog = new Dialog({
                    title: "Reject Timesheet",
                    content: [
                        new VBox({
                            items: [
                                new Text({
                                    text:     "Provide a reason for rejection. The employee will be notified.",
                                    wrapping: true
                                }).addStyleClass("sapUiSmallMarginBottom"),
                                new Label({ text: "Reason", labelFor: this._oRejectTextArea }),
                                this._oRejectTextArea
                            ]
                        }).addStyleClass("sapUiSmallMargin")
                    ],
                    beginButton: new Button({
                        text:  "Reject",
                        type:  "Reject",
                        press: this._onRejectConfirm.bind(this)
                    }),
                    endButton: new Button({
                        text:  "Cancel",
                        press: () => this._oRejectDialog.close()
                    }),
                    afterClose: () => this._oRejectTextArea.setValue("")
                });
                this.getView().addDependent(this._oRejectDialog);
            }
            this._oRejectDialog.open();
        },

        _onRejectConfirm() {
            const sComment = this._oRejectTextArea.getValue().trim();
            if (!sComment) {
                MessageToast.show("Please enter a rejection reason.");
                return;
            }

            const sub = this._selectedSub;
            this._oRejectDialog.close();
            this._oMgrModel.setProperty("/busy", true);

            fetch("/manager/rejectTimesheet", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body:    JSON.stringify({ timesheetId: sub.timesheetId, remarks: sComment })
            })
            .then(r => r.ok ? r.json() : Promise.reject(new Error("Reject failed: " + r.status)))
            .then(() => {
                this._oMgrModel.setProperty("/selectedStatus",  "Rejected");
                this._oMgrModel.setProperty("/selectedRemarks", sComment);
                this._loadSubmissions();
                this._rebuildStatus("Rejected");
                MessageToast.show(`Timesheet rejected. ${sub.employeeName || "Employee"} has been notified.`);
            })
            .catch(err => MessageBox.error((err && err.message) || "Reject failed."))
            .finally(() => this._oMgrModel.setProperty("/busy", false));
        },

        // ════════════════════════════════════════════════════════════════════
        // PREV-WEEK FILL REQUESTS
        // ════════════════════════════════════════════════════════════════════

        _loadPrevWeekRequests() {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;

            oMgrModel.bindList("/PrevWeekRequests").requestContexts(0, 200)
                .then(aCtx => {
                    const all = aCtx.map(c => c.getObject()).filter(Boolean);

                    // Enrich with employee names
                    const oComp = this.getOwnerComponent();
                    const empPromises = all.map(r => {
                        if (oComp.getEmployeeById) {
                            return oComp.getEmployeeById(r.employee_employeeId)
                                .then(emp => {
                                    r.employeeName = emp ? emp.employeeName : r.employee_employeeId;
                                    return r;
                                })
                                .catch(() => {
                                    r.employeeName = r.employee_employeeId;
                                    return r;
                                });
                        }
                        r.employeeName = r.employee_employeeId;
                        return Promise.resolve(r);
                    });

                    Promise.all(empPromises).then(enriched => {
                        // Build human-readable week range
                        enriched.forEach(r => {
                            if (r.weekStartDate && r.weekEndDate) {
                                const ws = new Date(r.weekStartDate + "T00:00:00");
                                const we = new Date(r.weekEndDate   + "T00:00:00");
                                r.weekRange = `${toShortLabel(ws)} – ${toShortLabel(we)}`;
                            } else {
                                r.weekRange = r.weekStartDate || "";
                            }
                            r.requestedOn = r.requestedOn
                                ? new Date(r.requestedOn).toLocaleString() : "";
                        });

                        const pending = enriched.filter(r => r.status === "Pending").length;
                        this._oMgrModel.setProperty("/allPrevWeekRequests",  enriched);
                        this._oMgrModel.setProperty("/prevWeekPendingCount", pending);
                        this._oMgrModel.setProperty("/prevWeekRequests",     enriched.filter(r => r.status === "Pending"));
                    });
                })
                .catch(err => console.error("Failed to load prev-week requests:", err));
        },

        // ── Approve Prev-Week Request ─────────────────────────────────────
        onApprovePrevWeek(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("mgrView");
            const oItem = oCtx.getObject();

            MessageBox.confirm(
                `Approve prev-week fill request for ${oItem.employeeName} (${oItem.weekRange})?`,
                {
                    title:            "Approve Request",
                    actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        this._submitPrevWeekDecision(oItem, true, "");
                    }
                }
            );
        },

        // ── Reject Prev-Week Request ──────────────────────────────────────
        onRejectPrevWeek(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("mgrView");
            const oItem = oCtx.getObject();

            const oTA = new TextArea({
                placeholder: "Reason for rejection (optional)...",
                rows:        3,
                width:       "100%"
            });

            const oDialog = new Dialog({
                title: "Reject Prev-Week Request",
                content: [
                    new VBox({
                        items: [
                            new Text({
                                text:     "Provide a reason. The employee will be notified.",
                                wrapping: true
                            }).addStyleClass("sapUiSmallMarginBottom"),
                            new Label({ text: "Reason", labelFor: oTA }),
                            oTA
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: new Button({
                    text:  "Reject",
                    type:  "Reject",
                    press: () => {
                        const remarks = oTA.getValue().trim();
                        oDialog.close();
                        oDialog.destroy();
                        this._submitPrevWeekDecision(oItem, false, remarks);
                    }
                }),
                endButton: new Button({
                    text:  "Cancel",
                    press: () => {
                        oDialog.close();
                        oDialog.destroy();
                    }
                })
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _submitPrevWeekDecision(oItem, bApproved, sRemarks) {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;

            const oCtx = oMgrModel.bindContext("/approvePrevWeekRequest(...)");
            oCtx.setParameter("requestId",      oItem.requestId);
            oCtx.setParameter("approved",       bApproved);
            oCtx.setParameter("managerRemarks", sRemarks || "");

            oCtx.execute()
                .then(() => {
                    const sVerb = bApproved ? "approved" : "rejected";
                    MessageToast.show(`Prev-week request ${sVerb} successfully.`);

                    // Notify the employee
                    this._postPrevWeekNotification(oItem, bApproved, sRemarks);

                    this._loadPrevWeekRequests();
                })
                .catch(err => {
                    MessageBox.error(
                        (err && err.message) || "Could not process prev-week request.",
                        { title: "Error" }
                    );
                });
        },

        _postPrevWeekNotification(oItem, bApproved, sRemarks) {
            try {
                const oComp       = this.getOwnerComponent();
                const oNotifModel = oComp.getModel("notifications");
                if (!oNotifModel) return;

                const recipientId = oItem.employee_employeeId || oItem.employeeId || "";
                if (!recipientId) return;

                const items   = oNotifModel.getProperty("/items") || [];
                const message = bApproved
                    ? `Your request to fill the prev-week timesheet (${oItem.weekRange}) was approved.`
                    : `Your request to fill the prev-week timesheet (${oItem.weekRange}) was rejected.`
                        + (sRemarks ? ` Reason: ${sRemarks}` : "");

                items.unshift({
                    type:                bApproved ? "approved" : "rejected",
                    message,
                    weekRange:           oItem.weekRange,
                    recipientEmployeeId: recipientId,
                    read:                false,
                    timestamp:           new Date().toISOString()
                });

                oNotifModel.setProperty("/items", items);
                oComp.persistNotifications();
            } catch (e) {
                console.warn("Failed to push prev-week notification:", e);
            }
        },

        // ════════════════════════════════════════════════════════════════════
        // LEAVE APPROVALS
        // ════════════════════════════════════════════════════════════════════

        _loadLeaveRequests() {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;

            oMgrModel.bindList("/LeaveRequests").requestContexts(0, 500)
                .then(aCtx => {
                    const all = aCtx.map(c => c.getObject()).filter(Boolean);
                    const oComp = this.getOwnerComponent();
                    const empPromises = all.map(r => {
                        if (oComp.getEmployeeById) {
                            return oComp.getEmployeeById(r.employee_employeeId)
                                .then(emp => { r.employeeName = emp ? emp.employeeName : r.employee_employeeId; return r; })
                                .catch(() => { r.employeeName = r.employee_employeeId; return r; });
                        }
                        r.employeeName = r.employee_employeeId;
                        return Promise.resolve(r);
                    });
                    Promise.all(empPromises).then(enriched => {
                        const pending = enriched.filter(r => r.status === "Pending").length;
                        this._oMgrModel.setProperty("/allLeaveRequests",  enriched);
                        this._oMgrModel.setProperty("/leavePendingCount", pending);
                        this._oMgrModel.setProperty("/leaveRequests",     enriched.filter(r => r.status === "Pending"));
                    });
                })
                .catch(err => console.error("Failed to load leave requests:", err));
        },

        onApproveLeave(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("mgrView");
            const oItem = oCtx.getObject();
            MessageBox.confirm(
                `Approve ${oItem.leaveType} leave for ${oItem.employeeName} (${oItem.days} day(s))?`,
                {
                    title: "Confirm Approval",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        this._submitLeaveDecision(oItem, true, "");
                    }
                }
            );
        },

        onRejectLeave(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("mgrView");
            const oItem = oCtx.getObject();
            const oTA   = new TextArea({ placeholder: "Reason for rejection (optional)...", rows: 3, width: "100%" });
            const oDialog = new Dialog({
                title: "Reject Leave Request",
                content: [oTA],
                beginButton: new Button({
                    text: "Reject", type: "Reject",
                    press: () => {
                        const remarks = oTA.getValue();
                        oDialog.close();
                        oDialog.destroy();
                        this._submitLeaveDecision(oItem, false, remarks);
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: () => { oDialog.close(); oDialog.destroy(); }
                })
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _submitLeaveDecision(oItem, bApproved, sRemarks) {
            const oMgrModel = this.getOwnerComponent().getModel("manager");
            if (!oMgrModel) return;
            const oCtx = oMgrModel.bindContext("/approveLeave(...)");
            oCtx.setParameter("leaveId",  oItem.leaveId);
            oCtx.setParameter("approved", bApproved);
            oCtx.setParameter("remarks",  sRemarks || "");
            oCtx.execute()
                .then(() => {
                    MessageToast.show(`Leave request ${bApproved ? "approved" : "rejected"} successfully.`);
                    this._postLeaveNotification(oItem, bApproved, sRemarks);
                    this._loadLeaveRequests();
                })
                .catch(err => MessageBox.error((err && err.message) || "Could not process leave request.", { title: "Error" }));
        },

        _postLeaveNotification(oItem, bApproved, sRemarks) {
            try {
                const oComp       = this.getOwnerComponent();
                const oNotifModel = oComp.getModel("notifications");
                if (!oNotifModel) return;
                const recipientId = oItem.employee_employeeId
                    || (oItem.employee && oItem.employee.employeeId)
                    || oItem.employeeId || "";
                if (!recipientId) return;
                const fmtDate = (s) => s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
                const weekRange   = `${fmtDate(oItem.fromDate)} - ${fmtDate(oItem.toDate)}`;
                const sManagerId  = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : "";
                const sManagerName = oComp._builtinEmployees && oComp._builtinEmployees[sManagerId]
                    ? oComp._builtinEmployees[sManagerId].employeeName : "Your manager";
                const message = bApproved
                    ? `${sManagerName} approved your ${oItem.leaveType} Leave request (${oItem.days} day(s)) from ${weekRange}.`
                    : `${sManagerName} rejected your ${oItem.leaveType} Leave request (${oItem.days} day(s)) from ${weekRange}.`
                        + (sRemarks ? ` Reason: ${sRemarks}` : "");
                const items = oNotifModel.getProperty("/items") || [];
                items.unshift({ type: bApproved ? "LEAVE_APPROVED" : "LEAVE_REJECTED", message, weekRange, recipientEmployeeId: recipientId, read: false, timestamp: new Date().toISOString() });
                oNotifModel.setProperty("/items", items);
                oComp.persistNotifications();
            } catch (e) {
                console.warn("Failed to push leave notification from manager:", e);
            }
        },

        // ════════════════════════════════════════════════════════════════════
        // SHARED HELPERS
        // ════════════════════════════════════════════════════════════════════

        _rebuildStatus(sNewStatus) {
            if (!this._selectedSub) return;
            const updated = Object.assign({}, this._selectedSub, { status: sNewStatus });
            if (updated._source === "backend") {
                this._loadEntriesFromBackend(updated);
            } else {
                this._buildTableRows(updated);
            }
        },

        // ── Formatters ────────────────────────────────────────────────────
        formatStatusState(sStatus) {
            return STATUS_STATE[sStatus] || "None";
        },

        formatProjectClass(sType) {
            if (sType === "total")  return "tsProjectName tsColTotalLabel";
            if (sType === "status") return "tsProjectName tsStatusLabel";
            return "tsProjectName";
        },

        formatDayCellClass(sValue, sType) {
            if (!sValue) return "";
            if (sType === "total") return "tsColTotalCell";
            if (sType === "status") {
                const map = {
                    "Approved":  "tsStatusApproved",
                    "Submitted": "tsStatusPending",
                    "Pending":   "tsStatusPending",
                    "Rejected":  "tsStatusRejected"
                };
                return map[sValue] || "";
            }
            return "tsHistGreenCell";
        },

        formatWeekTotalClass(sType) {
            return sType !== "status" ? "tsRowTotal" : "";
        },

        _parseHHMM(s) {
            if (!s || s === "") return 0;
            if (String(s).includes(":")) {
                const [h, m] = String(s).split(":");
                return (parseInt(h) || 0) + (parseInt(m) || 0) / 60;
            }
            return parseFloat(s) || 0;
        },

        _toHHMM(decimal) {
            const h = Math.floor(decimal);
            const m = Math.round((decimal - h) * 60);
            return h + ":" + String(m).padStart(2, "0");
        }
    });
});
