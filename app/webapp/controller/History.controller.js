sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/ActionSheet",
    "sap/m/Button"
], (Controller, JSONModel, ActionSheet, Button) => {
    "use strict";

    const DAYS      = ["mon","tue","wed","thu","fri","sat","sun"];
    const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const STATUS_CONFIG = {
        "Pending":  { type: "Attention", state: "Warning"  },
        "Approved": { type: "Accept",    state: "Success"  },
        "Rejected": { type: "Reject",    state: "Error"    }
    };

    function getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function toDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function toShortLabel(date) {
        return date.getDate() + " " + MONTHS[date.getMonth()];
    }

    function buildDayLabels(weekStart) {
        return DAY_NAMES.map((name, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            return { name: name, date: toShortLabel(d) };
        });
    }

    return Controller.extend("timesheet.app.controller.History", {

        onInit() {
            this._oHistViewModel = new JSONModel({
                selectedWeekLabel: "",
                noDataText:   "No timesheet was submitted for this week.",
                showCalendar: false,
                weekSelected: false,
                hasData:      false,
                status:       "Pending",
                statusType:   "Attention",
                statusState:  "Warning",
                days: [
                    { name:"Mon", date:"" }, { name:"Tue", date:"" },
                    { name:"Wed", date:"" }, { name:"Thu", date:"" },
                    { name:"Fri", date:"" }, { name:"Sat", date:"" },
                    { name:"Sun", date:"" }
                ],
                rows:     [],
                rowCount: 1
            });
            this.getView().setModel(this._oHistViewModel, "histView");
            this.getView().setModel(this.getOwnerComponent().getModel("history"), "history");

            // Block future weeks on the welcome calendar.
            this.getView().addEventDelegate({
                onAfterRendering: () => {
                    const oCal = this.byId("histCenterCalendar");
                    if (oCal && oCal.setMaxDate) {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        oCal.setMaxDate(today);
                    }
                }
            });
        },

        // ── Calendar toggle ──────────────────────────────────────────────
        // Always return to the centered welcome calendar (same as the
        // first-time view) so the user can pick a different week.
        onCalendarToggle() {
            this._oHistViewModel.setProperty("/showCalendar", false);
            this._oHistViewModel.setProperty("/weekSelected", false);

            // Clear any selected date on the centered calendar so the next pick
            // (even of the same date) fires the select event.
            const oCal = this.byId("histCenterCalendar");
            if (oCal) { oCal.removeAllSelectedDates(); }
        },

        onCalendarSelect(oEvent) {
            const oCal   = oEvent.getSource();
            const aDates = oCal.getSelectedDates();
            if (!aDates || !aDates.length) return;

            const oStart = aDates[0].getStartDate();
            if (!oStart) return;

            // Reject any pick whose week starts AFTER the current week.
            const today           = new Date(); today.setHours(0, 0, 0, 0);
            const currentWeek     = getWeekStart(today);
            const pickedWeek      = getWeekStart(new Date(oStart));
            if (pickedWeek.getTime() > currentWeek.getTime()) {
                sap.ui.require(["sap/m/MessageToast"], (MessageToast) => {
                    MessageToast.show("Future weeks can't be opened — please pick today or earlier.");
                });
                oCal.removeAllSelectedDates();
                return;
            }

            // Mark week as selected so the table view becomes visible
            this._oHistViewModel.setProperty("/weekSelected", true);
            this._oHistViewModel.setProperty("/showCalendar", false);
            this._loadWeekData(pickedWeek);
        },

        _loadWeekData(weekStart) {
            const sWeekStart = toDateString(weekStart);
            const weekEnd    = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);

            const days   = buildDayLabels(weekStart);
            const sLabel = toShortLabel(weekStart) + " – " + toShortLabel(weekEnd);

            this._oHistViewModel.setProperty("/days", days);
            this._oCurrentWeekStart = weekStart;

            const oComp         = this.getOwnerComponent();
            const oHistoryModel = oComp.getModel("history");
            const submissions   = oHistoryModel.getProperty("/submissions") || [];
            const sMyId         = oComp.getCurrentEmployeeId();
            // Only the user's own submissions, so a manager opening
            // History sees their own weeks (not their reportees').
            const submission    = submissions.find(s =>
                s.weekStart === sWeekStart &&
                (!s.submittedBy || s.submittedBy === sMyId)
            );

            const oTable = this.byId("histTable");

            if (!submission) {
                this._oHistViewModel.setProperty("/selectedWeekLabel", sLabel + " — No submission");
                this._oHistViewModel.setProperty("/noDataText", "No timesheet was submitted for this week.");
                this._oHistViewModel.setProperty("/rows",    []);
                this._oHistViewModel.setProperty("/rowCount", 1);
                this._oHistViewModel.setProperty("/hasData",  false);
                oTable.setFixedBottomRowCount(0);
                this._sCurrentWeekStart = null;
                this._oCurrentWeekStart = null;
                return;
            }

            // Enrich each data row with _type and _weekTotal
            const dataRows = (submission.rows || []).map(row => {
                const rowDec = DAYS.reduce((sum, d) => sum + this._parseHHMM(row[d]), 0);
                return Object.assign({}, row, { _type: "data", _weekTotal: this._toHHMM(rowDec) });
            });

            // Column-level totals
            const colDec = { mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 };
            dataRows.forEach(row => {
                DAYS.forEach(d => { colDec[d] += this._parseHHMM(row[d]); });
            });
            const grand = DAYS.reduce((s, d) => s + colDec[d], 0);

            // Day Total row (fixed at bottom -2)
            const dayTotalRow = {
                _type: "total", projectName: "Day Total(Hrs)", taskName: "",
                _weekTotal: this._toHHMM(grand)
            };
            DAYS.forEach(d => { dayTotalRow[d] = this._toHHMM(colDec[d]); });

            // Status row (fixed at bottom -1)
            const status    = submission.status || "Pending";
            const sc        = STATUS_CONFIG[status] || STATUS_CONFIG["Pending"];
            const statusRow = { _type: "status", projectName: "Status", taskName: "", _weekTotal: "" };
            DAYS.forEach(d => {
                statusRow[d] = dataRows.some(r => r[d] && r[d] !== "") ? status : "";
            });

            const allRows = [...dataRows, dayTotalRow, statusRow];

            this._oHistViewModel.setProperty("/selectedWeekLabel", sLabel);
            this._oHistViewModel.setProperty("/rows",              allRows);
            this._oHistViewModel.setProperty("/rowCount",          allRows.length);
            this._oHistViewModel.setProperty("/status",            status);
            this._oHistViewModel.setProperty("/statusType",        sc.type);
            this._oHistViewModel.setProperty("/statusState",       sc.state);
            this._oHistViewModel.setProperty("/hasData",           true);

            oTable.setFixedBottomRowCount(2);
            this._sCurrentWeekStart = sWeekStart;
        },

        onStatusPress(oEvent) {
            const oButton = oEvent.getSource();
            const that    = this;
            const oSheet  = new ActionSheet({
                title: "Update Status",
                buttons: [
                    new Button({ text: "Approved", type: "Accept",
                        press: function() { that._setStatus("Approved"); oSheet.close(); } }),
                    new Button({ text: "Pending",  type: "Attention",
                        press: function() { that._setStatus("Pending");  oSheet.close(); } }),
                    new Button({ text: "Rejected", type: "Reject",
                        press: function() { that._setStatus("Rejected"); oSheet.close(); } })
                ],
                cancelButton: new Button({ text: "Cancel", press: function() { oSheet.close(); } })
            });
            this.getView().addDependent(oSheet);
            oSheet.openBy(oButton);
        },

        _setStatus(sStatus) {
            const sc = STATUS_CONFIG[sStatus] || STATUS_CONFIG["Pending"];

            this._oHistViewModel.setProperty("/status",      sStatus);
            this._oHistViewModel.setProperty("/statusType",  sc.type);
            this._oHistViewModel.setProperty("/statusState", sc.state);

            if (this._sCurrentWeekStart) {
                const oHistoryModel = this.getOwnerComponent().getModel("history");
                const submissions   = oHistoryModel.getProperty("/submissions") || [];
                const idx = submissions.findIndex(s => s.weekStart === this._sCurrentWeekStart);
                if (idx >= 0) {
                    submissions[idx].status = sStatus;
                    oHistoryModel.setProperty("/submissions", submissions);
                    this.getOwnerComponent().persistHistory();
                }

                if (sStatus === "Rejected") {
                    this._unlockWeek(this._sCurrentWeekStart);
                    this._postRejectionNotification(this._sCurrentWeekStart);
                }
            }

            // Refresh table rows to reflect new status badges
            if (this._oCurrentWeekStart) {
                this._loadWeekData(this._oCurrentWeekStart);
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

        _postRejectionNotification(sWeekStart) {
            const sLabel      = this._oHistViewModel.getProperty("/selectedWeekLabel");
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            const items       = oNotifModel.getProperty("/items") || [];

            const notif = {
                weekStart: sWeekStart,
                weekRange: sLabel,
                type:      "rejected",
                message:   `Your timesheet for ${sLabel} was rejected. Please review and resubmit.`,
                read:      false,
                timestamp: new Date().toISOString()
            };
            const existing = items.findIndex(n => n.weekStart === sWeekStart);
            if (existing >= 0) {
                items[existing] = notif;
            } else {
                items.unshift(notif);
            }
            oNotifModel.setProperty("/items", items);
            this.getOwnerComponent().persistNotifications();
        },

        // ── Cell class formatters ────────────────────────────────────────

        formatProjectClass(sType) {
            if (sType === "total")  return "tsProjectName tsColTotalLabel";
            if (sType === "status") return "tsProjectName tsStatusLabel";
            return "tsProjectName";
        },

        formatDayCellClass(sValue, sType) {
            if (!sValue) return "";
            if (sType === "total") return "tsColTotalCell";
            if (sType === "status") {
                const map = { "Approved": "tsStatusApproved", "Pending": "tsStatusPending", "Rejected": "tsStatusRejected" };
                return map[sValue] || "";
            }
            return "tsHistGreenCell";
        },

        formatWeekTotalClass(sType) {
            return sType !== "status" ? "tsRowTotal" : "";
        },

        // ── Helpers ──────────────────────────────────────────────────────

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
