sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
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

    const STATUS_STATE = { "Pending": "Warning", "Approved": "Success", "Rejected": "Error" };

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
                allSubmissions:      [],
                submissions:         [],
                pendingCount:        0,
                showDetail:          false,
                pageTitle:           "Manager – Approvals",
                selectedEmployee:    "",
                selectedWeek:        "",
                selectedSubmittedOn: "",
                selectedStatus:      "",
                selectedRemarks:     "",
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
            // Always start on the list view when route is entered
            this._oMgrModel.setProperty("/showDetail",   false);
            this._oMgrModel.setProperty("/pageTitle",    "Manager – Approvals");
            this._selectedSub = null;
            this._loadSubmissions();
        },

        // ── Back button (list ← detail) ──────────────────────────────────────
        onNavBack() {
            this._oMgrModel.setProperty("/showDetail", false);
            this._oMgrModel.setProperty("/pageTitle",  "Manager – Approvals");
        },

        // ── Submission list ──────────────────────────────────────────────────

        _loadSubmissions() {
            const oComp = this.getOwnerComponent();
            // Wait for the JWT user, then filter to this manager's reportees.
            const ready = oComp.getCurrentUser ? oComp.getCurrentUser() : Promise.resolve(null);
            ready.then(() => {
                const oHistoryModel = oComp.getModel("history");
                const everyone      = oHistoryModel.getProperty("/submissions") || [];
                const sMyId         = oComp.getCurrentEmployeeId();

                // Show only submissions whose reportsTo points to this manager.
                // Submissions without reportsTo (legacy) are visible to all
                // managers — they pre-date the routing fix.
                const all = everyone.filter(s => !s.reportsTo || s.reportsTo === sMyId);

                const pending = all.filter(s => s.status === "Pending").length;
                this._oMgrModel.setProperty("/allSubmissions", all);
                this._oMgrModel.setProperty("/pendingCount",   pending);

                const oSeg = this.byId("statusFilter");
                const sKey = oSeg ? oSeg.getSelectedKey() : "Pending";
                this._applyFilter(sKey, all);
            });
        },

        _applyFilter(sKey, all) {
            const filtered = sKey === "All" ? all : all.filter(s => s.status === sKey);
            this._oMgrModel.setProperty("/submissions", filtered);
        },

        onFilterChange(oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            const all  = this._oMgrModel.getProperty("/allSubmissions");
            this._applyFilter(sKey, all);
            this._oMgrModel.setProperty("/hasSelection", false);
            this._selectedSub = null;
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

            this._buildTableRows(sub);
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
                if (!hasValue) { statusRow[d] = ""; return; }
                const isDayApproved = dataRows.some(r => (r.approved || {})[d] === true);
                statusRow[d] = isDayApproved ? "Approved" : status;
            });

            const allRows = [...dataRows, dayTotalRow, statusRow];
            this._oMgrModel.setProperty("/rows",     allRows);
            this._oMgrModel.setProperty("/rowCount", allRows.length);

            const oTable = this.byId("mgrTable");
            if (oTable) oTable.setFixedBottomRowCount(2);
        },

        // ── Approve ──────────────────────────────────────────────────────────

        onApprove() {
            const sub = this._selectedSub;
            if (!sub) return;

            MessageBox.confirm(
                `Approve the timesheet for ${sub.weekRange} submitted by ${sub.employeeName || "this employee"}?`,
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
            this._markApprovedInLocked(sub.weekStart);
            this._persistStatus(sub.weekStart, "Approved", "");
            this._postNotification(sub.weekStart, sub.weekRange, "approved", "");

            this._oMgrModel.setProperty("/selectedStatus",  "Approved");
            this._oMgrModel.setProperty("/selectedRemarks", "");
            this._rebuildStatus("Approved");
            this._loadSubmissions();
            MessageToast.show("Timesheet approved.");
        },

        // ── Reject ───────────────────────────────────────────────────────────

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
                                    text:     "Provide a reason for rejection. The employee will be notified and can edit their timesheet.",
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
                MessageToast.show("Please enter a rejection reason before confirming.");
                return;
            }

            const sub = this._selectedSub;
            this._oRejectDialog.close();

            this._persistStatus(sub.weekStart, "Rejected", sComment);
            this._unlockWeek(sub.weekStart);
            this._postNotification(sub.weekStart, sub.weekRange, "rejected", sComment);

            this._oMgrModel.setProperty("/selectedStatus",  "Rejected");
            this._oMgrModel.setProperty("/selectedRemarks", sComment);
            this._rebuildStatus("Rejected");
            this._loadSubmissions();

            MessageToast.show(`Timesheet rejected. ${sub.employeeName || "Employee"} has been notified.`);
        },

        // ── Mark approved days in locked model ───────────────────────────────
        _markApprovedInLocked(sWeekStart) {
            const oLocksModel = this.getOwnerComponent().getModel("locked");
            const allLocks    = oLocksModel.getData();
            const weekRows    = allLocks[sWeekStart];
            if (!weekRows) return;

            weekRows.forEach(row => {
                if (!row.approved) row.approved = { mon:false, tue:false, wed:false, thu:false, fri:false, sat:false, sun:false };
                DAYS.forEach(d => { if (row.locked[d]) row.approved[d] = true; });
            });
            oLocksModel.setData(allLocks);
            this.getOwnerComponent().persistLocked();
        },

        // ── Shared persistence helpers ────────────────────────────────────────

        _persistStatus(sWeekStart, sStatus, sRemarks) {
            const oHistoryModel = this.getOwnerComponent().getModel("history");
            const submissions   = oHistoryModel.getProperty("/submissions") || [];
            const idx = submissions.findIndex(s => s.weekStart === sWeekStart);
            if (idx >= 0) {
                submissions[idx].status  = sStatus;
                submissions[idx].remarks = sRemarks;
                this._selectedSub = submissions[idx];
                oHistoryModel.setProperty("/submissions", submissions);
                this.getOwnerComponent().persistHistory();
            }
        },

        _unlockWeek(sWeekStart) {
            const oLocksModel = this.getOwnerComponent().getModel("locked");
            const allLocks    = oLocksModel.getData();
            const weekRows    = allLocks[sWeekStart];
            if (!weekRows) return;

            weekRows.forEach(row => {
                const approved = row.approved || {};
                DAYS.forEach(d => { if (!approved[d]) row.locked[d] = false; });
                row._rowLocked = DAYS.some(d => row.locked[d]);
            });
            oLocksModel.setData(allLocks);
            this.getOwnerComponent().persistLocked();
        },

        _postNotification(sWeekStart, sWeekRange, sType, sComment) {
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            const items       = oNotifModel.getProperty("/items") || [];

            // The notification must go to the person who submitted the
            // timesheet — never the approver.
            const sub = this._selectedSub || {};
            const sRecipient = sub.submittedBy || null;

            const message = sType === "approved"
                ? `Your timesheet for ${sWeekRange} has been approved by your manager.`
                : `Your timesheet for ${sWeekRange} was rejected by your manager. Reason: ${sComment}`;

            const notif = {
                weekStart:           sWeekStart,
                weekRange:           sWeekRange,
                type:                sType,
                message,
                read:                false,
                timestamp:           new Date().toISOString(),
                recipientEmployeeId: sRecipient
            };

            // Replace any existing notification for the same week + recipient
            const existing = items.findIndex(n =>
                n.weekStart === sWeekStart &&
                (n.recipientEmployeeId || null) === (sRecipient || null));
            if (existing >= 0) { items[existing] = notif; } else { items.unshift(notif); }

            oNotifModel.setProperty("/items", items);
            this.getOwnerComponent().persistNotifications();
        },

        _rebuildStatus(sNewStatus) {
            if (!this._selectedSub) return;
            this._buildTableRows({ ...this._selectedSub, status: sNewStatus });
        },

        // ── Formatters ────────────────────────────────────────────────────────

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
            if (sType === "total")  return "tsColTotalCell";
            if (sType === "status") {
                const map = { "Approved": "tsStatusApproved", "Pending": "tsStatusPending", "Rejected": "tsStatusRejected" };
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
