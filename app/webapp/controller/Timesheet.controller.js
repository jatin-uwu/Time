// ─────────────────────────────────────────────────────────────────────────────
// FILE: webapp/controller/Timesheet.controller.js
// Namespace : timesheet.app  (matches manifest.json sap.app.id)
// Backend   : /employee  (CAP OData v4 EmployeeService)
// ─────────────────────────────────────────────────────────────────────────────
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "timesheet/app/util/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Input",
    "sap/m/Select",
    "sap/m/Text",
    "sap/m/Button",
    "sap/m/HBox",
    "sap/m/VBox",
    "sap/m/Label",
    "sap/m/ObjectStatus",
    "sap/ui/core/Item",
    "sap/ui/core/HTML",
    "timesheet/app/util/CustomDialog",
    "sap/m/TextArea",
    "sap/m/MessageStrip",
    "sap/ui/core/ListItem",
    "sap/m/ResponsivePopover"
], function (
    Controller, JSONModel,
    MessageBox, MessageToast,
    Input, Select, Text, Button, HBox, VBox, Label, ObjectStatus, Item, HTML,
    CustomDialog, TextArea, MessageStrip, ListItem, ResponsivePopover
) {
    "use strict";

    const BASE_URL = "/employee";
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // ── Duration formatting ───────────────────────────────────────────────────
    // Entries are stored internally as decimal hours (e.g. 7.5) so all existing
    // save/total/validation logic is untouched; the UI shows them as HH:MM.
    const MINUTE_OPTIONS = [0, 15, 30, 45];
    function pad2(n) { return String(n).padStart(2, "0"); }
    function decToHHMM(dec) {
        const d = parseFloat(dec) || 0;
        if (d <= 0) return "00:00";
        let h = Math.floor(d + 1e-9);
        let m = Math.round((d - h) * 60);
        if (m === 60) { h += 1; m = 0; }
        return pad2(h) + ":" + pad2(m);
    }
    // Split a decimal into { h, m } where m is snapped to the nearest allowed
    // option (00/15/30/45) so legacy free-typed decimals still preselect cleanly.
    function decToParts(dec) {
        const d = parseFloat(dec) || 0;
        let h = Math.floor(d + 1e-9);
        let m = Math.round((d - h) * 60);
        if (m === 60) { h += 1; m = 0; }
        if (MINUTE_OPTIONS.indexOf(m) === -1) {
            m = MINUTE_OPTIONS.reduce(function (a, b) {
                return Math.abs(b - m) < Math.abs(a - m) ? b : a;
            }, 0);
        }
        return { h: h, m: m };
    }

    return Controller.extend("timesheet.app.controller.Timesheet", {

        // ══════════════════════════════════════════════════════════════════════
        // LIFECYCLE
        // ══════════════════════════════════════════════════════════════════════
        onInit: function () {
            this._initModels();
            this._computeWeekDates(new Date());
            // Defer async load so UI5 lifecycle finishes first
            setTimeout(function () {
                this._loadTimesheetData();
            }.bind(this), 0);
        },

        // ── Initialise all JSON models and internal state ─────────────────────
        _initModels: function () {
            this.getView().setModel(new JSONModel({
                weekStatus: "None",
                weekStatusState: "None",
                weekStatusIcon: "",
                weekRangeLabel: "",
                prevWeekRangeLabel: "",
                isViewingPrevWeek: false,
                isPrevWeekApproved: false,
                canEdit: false,
                canSubmit: false,
                infoMessage: "",
                infoMessageType: "Information",
                showRequestPrevWeekBtn: false,
                showPrevWeekPending: false,
                showFillPrevWeekBtn: false,
                showPrevWeekDone: false,
                prevWeekFillEnabled: false
            }), "viewModel");

            // Internal state
            this._currentEmployee = null;
            this._weekStartDate = null;
            this._weekEndDate = null;
            this._prevWeekStartDate = null;
            this._prevWeekEndDate = null;
            this._timesheetId = null;
            this._tasks = [];
            this._rows = [];
            this._dayUnlockReqs = {};
            this._prevWeekRequest = null;
            this._injectedControls = [];  // tracks placeAt controls for cleanup
            this._csrfToken = null;

            // HR unlock dialog model
            this.getView().setModel(new JSONModel({
                targetDate: "", selectedHrId: "", employeeRemarks: ""
            }), "hrUnlockModel");

            // HR employees list model
            this.getView().setModel(new JSONModel({ hrEmployees: [] }), "hrListModel");

            // Previous week dialog model
            this.getView().setModel(new JSONModel({
                weekRangeLabel: "", managerName: "", employeeRemarks: "", infoText: ""
            }), "prevWeekModel");
        },

        // ══════════════════════════════════════════════════════════════════════
        // DATE HELPERS
        // NOTE: _toISODate uses local date parts (not toISOString) to avoid
        //       UTC shift for IST (India +5:30) which causes wrong week dates
        // ══════════════════════════════════════════════════════════════════════
        _toISODate: function (date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            const d = String(date.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + d;
        },

        _getMondayOfWeek: function (date) {
            const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const day = d.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            d.setDate(d.getDate() + diff);
            return d;
        },

        _formatDisplayDate: function (isoDate) {
            const d = new Date(isoDate + "T00:00:00");
            return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        },

        _getYesterday: function () {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return this._toISODate(d);
        },

        _getTwoDaysAgo: function () {
            const d = new Date();
            d.setDate(d.getDate() - 2);
            return this._toISODate(d);
        },

        _getAvailableTasks: function (currentRowIdx) {
            // Get taskIds already selected in OTHER rows
            const usedTaskIds = new Set();
            this._rows.forEach(function (row, idx) {
                if (idx !== currentRowIdx && row.taskId) {
                    usedTaskIds.add(row.taskId);
                }
            });
            // The task already chosen in THIS row (kept visible even if completed,
            // so an existing entry on a now-completed task still renders).
            const currentTaskId = (this._rows[currentRowIdx] && this._rows[currentRowIdx].taskId) || null;

            const isCompleted = function (t) {
                return String(t.status || "").toLowerCase().replace(/\s+/g, "") === "completed";
            };

            // Exclude tasks used in other rows and Completed tasks — a completed
            // task can no longer be worked on, so it must not be selectable.
            return this._tasks.filter(function (t) {
                if (usedTaskIds.has(t.taskId)) return false;
                if (isCompleted(t) && t.taskId !== currentTaskId) return false;
                return true;
            });
        },

        // ── Custom ("Others") task support ────────────────────────────────────
        // Shared change handler for a row's task Select. Selecting "Others" flags
        // the row as custom and reveals the free-text field; selecting a real task
        // clears it.
        _onTaskSelectChange: function (rowIdx, weekDays, canEdit) {
            return function (evt) {
                const key = evt.getParameter("selectedItem").getKey();
                const r = this._rows[rowIdx];
                if (key === "__OTHERS__") {
                    r.isCustom = true; r.taskId = null; r.taskName = "Others";
                } else {
                    r.isCustom = false; r.customTaskText = ""; r.taskId = key;
                    r.taskName = evt.getParameter("selectedItem").getText();
                }
                this._renderRowCustomInput(rowIdx, canEdit);
                this._recalcTotals(weekDays);
                this._refreshTaskDropdowns(weekDays, canEdit);
            }.bind(this);
        },

        // Render (or remove) the custom-task text field below a row's dropdown.
        // Shown only when the row is "Others": label, 30-char input with a live
        // counter, and a "Custom Task" badge with an explanatory tooltip.
        _renderRowCustomInput: function (rowIdx, canEdit) {
            const vid = this.getView().getId();
            const taskSpan = document.getElementById(vid + "--taskCell_" + rowIdx);
            if (!taskSpan) return;

            this._customInputs = this._customInputs || {};
            if (this._customInputs[rowIdx]) {
                this._customInputs[rowIdx].forEach(function (c) { try { c.destroy(); } catch (e) { /**/ } });
                this._customInputs[rowIdx] = null;
            }

            const row = this._rows[rowIdx];
            if (!row || !row.isCustom) return;

            const MAX = 30;
            const oCounter = new Text({ text: (row.customTaskText || "").length + "/" + MAX });
            oCounter.addStyleClass("tsCustomCounter");

            const oInput = new Input({
                width: "100%",
                value: row.customTaskText || "",
                editable: !!canEdit,
                maxLength: MAX,
                placeholder: "Enter task details...",
                liveChange: function (evt) {
                    let v = evt.getParameter("value") || "";
                    if (v.length > MAX) { v = v.slice(0, MAX); evt.getSource().setValue(v); }
                    this._rows[rowIdx].customTaskText = v;
                    oCounter.setText(v.length + "/" + MAX);
                    const ok = !!v.trim();
                    evt.getSource().setValueState(ok ? "None" : "Error");
                    if (!ok) evt.getSource().setValueStateText("Please enter task details (maximum 30 characters).");
                }.bind(this)
            });
            oInput.addStyleClass("tsCustomInput");

            const oLabel = new Label({ text: "Describe the task worked on" });
            oLabel.addStyleClass("tsCustomFieldLabel");
            const oBadge = new Label({ text: "Custom Task" });
            oBadge.addStyleClass("tsCustomBadge");
            oBadge.setTooltip("This task was entered by the employee and was not assigned by a manager.");
            const oHead = new HBox({ alignItems: "Center", justifyContent: "SpaceBetween", items: [oLabel, oBadge] });
            oHead.addStyleClass("tsCustomFieldHead");

            oHead.placeAt(taskSpan);
            oInput.placeAt(taskSpan);
            oCounter.placeAt(taskSpan);

            this._customInputs[rowIdx] = [oHead, oInput, oCounter];
            this._injectedControls.push(oHead, oInput, oCounter);
        },

        // True if any custom row has hours but no description — used to block save.
        _validateCustomTasks: function () {
            for (let i = 0; i < this._rows.length; i++) {
                const row = this._rows[i];
                if (!row.isCustom) continue;
                const hasHours = Object.values(row.entries || {}).some(function (h) { return h > 0; });
                if (hasHours && !(row.customTaskText && row.customTaskText.trim())) {
                    return false;
                }
            }
            return true;
        },

        _refreshTaskDropdowns: function (weekDays, canEdit) {
            // For each row, find its Select control and rebuild items
            // based on what other rows have selected
            this._rows.forEach(function (row, rowIdx) {
                // Find the Select control placed in this row's task cell
                const vid = this.getView().getId();
                const taskSpan = document.getElementById(vid + "--taskCell_" + rowIdx);
                if (!taskSpan) return;

                // Get the SAP Select placed inside this span
                const selectDom = taskSpan.querySelector(".sapMSlt");
                if (!selectDom) return;

                // Find the SAP control by its DOM ref
                const sel = sap.ui.getCore().byId(
                    selectDom.id.replace("-arrow", "").replace("-label", "")
                );
                // Walk up to find the Select control
                let sapCtrl = null;
                this._injectedControls.forEach(function (ctrl) {
                    if (ctrl instanceof Select && ctrl.getDomRef() &&
                        taskSpan.contains(ctrl.getDomRef())) {
                        sapCtrl = ctrl;
                    }
                });

                if (!sapCtrl) return;

                // Rebuild items
                sapCtrl.destroyItems();
                sapCtrl.addItem(new Item({ key: "", text: "-- Select Task --" }));
                this._getAvailableTasks(rowIdx).forEach(function (t) {
                    sapCtrl.addItem(new Item({ key: t.taskId, text: t.taskName }));
                });
                sapCtrl.addItem(new Item({ key: "__OTHERS__", text: "Others" }));

                // Re-select the current value (it may have been destroyed)
                if (row.isCustom) {
                    sapCtrl.setSelectedKey("__OTHERS__");
                } else if (row.taskId) {
                    sapCtrl.setSelectedKey(row.taskId);
                }
            }.bind(this));
        },

        _computeWeekDates: function (refDate, offset) {
            const mon = this._getMondayOfWeek(refDate);
            if (offset === -1) mon.setDate(mon.getDate() - 7);
            const sun = new Date(mon);
            sun.setDate(mon.getDate() + 6);

            this._weekStartDate = this._toISODate(mon);
            this._weekEndDate = this._toISODate(sun);

            // Always keep prev week dates for the bottom section
            const prevMon = new Date(this._getMondayOfWeek(new Date()));
            prevMon.setDate(prevMon.getDate() - 7);
            const prevSun = new Date(prevMon);
            prevSun.setDate(prevMon.getDate() + 6);
            this._prevWeekStartDate = this._toISODate(prevMon);
            this._prevWeekEndDate = this._toISODate(prevSun);

            const vm = this.getView().getModel("viewModel");
            vm.setProperty("/weekRangeLabel",
                this._formatDisplayDate(this._weekStartDate) +
                " \u2013 " +
                this._formatDisplayDate(this._weekEndDate));
            vm.setProperty("/prevWeekRangeLabel",
                this._formatDisplayDate(this._prevWeekStartDate) +
                " \u2013 " +
                this._formatDisplayDate(this._prevWeekEndDate));
        },

        _getWeekDays: function () {
            const days = [];
            const mon = new Date(this._weekStartDate + "T00:00:00");
            for (let i = 0; i < 7; i++) {
                const d = new Date(mon);
                d.setDate(mon.getDate() + i);
                days.push(this._toISODate(d));
            }
            return days;
        },

        // ══════════════════════════════════════════════════════════════════════
        // LOAD DATA
        // ══════════════════════════════════════════════════════════════════════
        _loadTimesheetData: async function () {
            const view = this.getView();
            view.setBusy(true);
            try {
                // Resolve current user once per session
                if (!this._currentEmployee) {
                    try {
                        const userResp = await this._callAction(
                            BASE_URL + "/getCurrentUser", {}
                        );
                        this._currentEmployee = userResp || {};
                    } catch (e) {
                        this._currentEmployee = {};
                        console.warn("getCurrentUser failed:", e.message);
                    }
                }

                // Load week data
                const data = await this._callAction(
                    BASE_URL + "/getTimesheetWeekData", {
                    weekStartDate: this._weekStartDate,
                    weekEndDate: this._weekEndDate
                }
                );

                this._timesheetId = data.timesheetId;
                this._tasks = JSON.parse(data.tasks || "[]");
                this._dayUnlockReqs = {};

                // Index unlock requests by date (keep most recent per date)
                JSON.parse(data.dayUnlockRequests || "[]").forEach(function (r) {
                    if (!this._dayUnlockReqs[r.targetDate] ||
                        r.requestedOn > this._dayUnlockReqs[r.targetDate].requestedOn) {
                        this._dayUnlockReqs[r.targetDate] = r;
                    }
                }.bind(this));

                this._prevWeekRequest = JSON.parse(data.prevWeekRequest || "null");

                this._buildRowsFromEntries(JSON.parse(data.entries || "[]"));
                this._updateViewModelState(data.weekStatus, !!data.isPrevWeekApproved);
                this._renderGrid();
                this._renderMissedDayActions();

            } catch (e) {
                MessageBox.error("Failed to load timesheet: " + (e.message || e));
            } finally {
                view.setBusy(false);
            }
        },

        // ── Build internal row array from flat DB entries ─────────────────────
        _buildRowsFromEntries: function (entries) {
            const rowMap = {};
            entries.forEach(function (e) {
                const isCustom = !!e.isCustomTask;
                // Custom ("Others") entries are grouped by their free text; normal
                // entries are grouped by taskId.
                const key = isCustom ? ("__custom__" + (e.customTaskText || "")) : e.task_taskId;
                if (!rowMap[key]) {
                    const task = isCustom ? null : this._tasks.find(function (t) {
                        return t.taskId === e.task_taskId;
                    });
                    rowMap[key] = {
                        taskId: isCustom ? null : e.task_taskId,
                        taskName: isCustom ? "Others" : (task ? task.taskName : e.task_taskId),
                        isCustom: isCustom,
                        customTaskText: isCustom ? (e.customTaskText || "") : "",
                        entries: {},
                        locked: {}
                    };
                }
                rowMap[key].entries[e.workDate] = e.hoursWorked;
                rowMap[key].locked[e.workDate] = !!e.isLocked;
            }.bind(this));

            this._rows = Object.values(rowMap);
            // Always have at least one empty row
            if (this._rows.length === 0) {
                this._rows.push({ taskId: null, taskName: null, isCustom: false, customTaskText: "", entries: {}, locked: {} });
            }
        },

        // ══════════════════════════════════════════════════════════════════════
        // VIEW MODEL STATE
        // All setProperty calls use native booleans — never strings
        // ══════════════════════════════════════════════════════════════════════
        _updateViewModelState: function (weekStatus, isPrevWeekApproved) {
            const vm = this.getView().getModel("viewModel");
            const isView = vm.getProperty("/isViewingPrevWeek");

            const stateMap = {
                "Draft": { state: "None", icon: "sap-icon://edit" },
                "Pending": { state: "Warning", icon: "sap-icon://pending" },
                "Approved": { state: "Success", icon: "sap-icon://accept" },
                "Rejected": { state: "Error", icon: "sap-icon://decline" },
                "PrevWeekApproved": { state: "Success", icon: "sap-icon://accept" },
                "None": { state: "None", icon: "" }
            };
            const s = stateMap[weekStatus] || stateMap["None"];

            vm.setProperty("/weekStatus", weekStatus);
            vm.setProperty("/weekStatusState", s.state);
            vm.setProperty("/weekStatusIcon", s.icon);
            vm.setProperty("/isPrevWeekApproved", !!isPrevWeekApproved);

            // canEdit
            let canEdit = false;
            if (isView) {
                canEdit = weekStatus === "PrevWeekApproved";
            } else {
                canEdit = ["Draft", "Rejected", "None"].includes(weekStatus);
            }
            vm.setProperty("/canEdit", canEdit);

            // canSubmit
            const hasEntries = this._rows.some(function (r) {
                return r.taskId && Object.values(r.entries).some(function (h) { return h > 0; });
            });
            vm.setProperty("/canSubmit", canEdit && hasEntries);

            // Info banner
            if (weekStatus === "Rejected") {
                vm.setProperty("/infoMessage",
                    "Your timesheet was rejected by the manager. Please review and resubmit.");
                vm.setProperty("/infoMessageType", "Error");
            } else if (weekStatus === "Pending") {
                vm.setProperty("/infoMessage",
                    "Timesheet submitted \u2014 awaiting manager approval.");
                vm.setProperty("/infoMessageType", "Warning");
            } else if (weekStatus === "Approved") {
                vm.setProperty("/infoMessage",
                    "Timesheet approved. Entries are locked.");
                vm.setProperty("/infoMessageType", "Success");
            } else {
                vm.setProperty("/infoMessage", "");
            }

            // Prev-week section button states
            const pr = this._prevWeekRequest;
            const prevStatus = pr ? pr.status : null;

            vm.setProperty("/showRequestPrevWeekBtn",
                !prevStatus || prevStatus === "Rejected");
            vm.setProperty("/showPrevWeekPending",
                prevStatus === "Pending");
            vm.setProperty("/showFillPrevWeekBtn",
                prevStatus === "Approved" && weekStatus !== "Approved");
            vm.setProperty("/showPrevWeekDone",
                prevStatus === "Completed" || (isView && weekStatus === "Approved"));
            vm.setProperty("/prevWeekFillEnabled",
                prevStatus === "Approved");
        },

        // ── Safely destroy a container's children ─────────────────────────────
        _clearContainer: function (controlId) {
            const ctrl = this.byId(controlId);
            if (!ctrl) return null;
            ctrl.destroyItems();
            return ctrl;
        },

        // ── Destroy all placeAt-injected SAP controls ─────────────────────────
        // Must be called before every _renderGrid to prevent duplicate rows
        _destroyInjectedControls: function () {
            if (this._injectedControls && this._injectedControls.length) {
                this._injectedControls.forEach(function (ctrl) {
                    try { ctrl.destroy(); } catch (e) { /* already destroyed */ }
                });
            }
            this._injectedControls = [];
            this._customInputs = {};   // custom-task field controls, rebuilt per render
        },

        // ══════════════════════════════════════════════════════════════════════
        // GRID RENDERING  — builds a real HTML <table> via sap/ui/core/HTML
        //                   then injects SAP Select/Input via placeAt()
        // ══════════════════════════════════════════════════════════════════════
        _renderGrid: function () {
            this._destroyInjectedControls(); // MUST be first

            const vm = this.getView().getModel("viewModel");
            const canEdit = vm.getProperty("/canEdit");
            const today = this._toISODate(new Date());
            const yesterday = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();
            const weekDays = this._getWeekDays();
            const isView = vm.getProperty("/isViewingPrevWeek");
            const vid = this.getView().getId();

            // Clear rows container
            const rowsContainer = this._clearContainer("timesheetRowsContainer");
            if (!rowsContainer) return;

            // Destroy old HTML control (prevents ID conflict on re-render)
            const tableId = vid + "--tsTable";
            const oldTable = sap.ui.getCore().byId(tableId);
            if (oldTable) oldTable.destroy();

            // Hide static XML header/totals rows (table renders its own)
            const dayHeaderRow = this.byId("dayHeaderRow");
            const dailyTotalsRow = this.byId("dailyTotalsRow");
            if (dayHeaderRow) dayHeaderRow.setVisible(false);
            if (dailyTotalsRow) dailyTotalsRow.setVisible(false);

            // ── <thead> ───────────────────────────────────────────────────
            let thead = '<thead><tr style="background:#f5f6f7;border-bottom:2px solid #d9d9d9;">';
            thead += '<th style="width:220px;padding:10px 12px;text-align:left;font-weight:700;'
                + 'font-size:0.9rem;color:#32363a;border-right:1px solid #e5e5e5;">'
                + 'Project / Task</th>';

            weekDays.forEach(function (dateStr, idx) {
                const isSun = idx === 6;
                const isToday = dateStr === today && !isView;
                const isYest = dateStr === yesterday && !isView;
                const isTwoDays = dateStr === twoDaysAgo && !isView;
                const bg = isToday ? "#dbeeff"
                    : (isYest || isTwoDays) ? "#f0faf0"
                        : isSun ? "#fafafa"
                            : "transparent";
                const col = isToday ? "#0854a0" : "#6a6d70";
                const fw = isToday ? "700" : "500";

                thead += '<th style="width:110px;padding:10px 8px;text-align:center;background:'
                    + bg + ';border-right:1px solid #e5e5e5;">'
                    + '<div style="font-weight:' + fw + ';font-size:0.8rem;color:#32363a;">'
                    + DAYS[idx] + '</div>'
                    + '<div style="font-size:0.75rem;color:' + col + ';font-weight:' + fw + ';">'
                    + this._formatDisplayDate(dateStr) + '</div>'
                    + (isSun ? '<div style="font-size:0.7rem;color:#a0a0a0;margin-top:2px;">Holiday</div>' : '')
                    + '</th>';
            }.bind(this));

            thead += '<th style="width:80px;padding:10px 8px;text-align:center;font-weight:700;'
                + 'font-size:0.9rem;color:#32363a;">Total</th></tr></thead>';

            // ── <tbody> data rows ─────────────────────────────────────────
            let tbody = '<tbody>';

            this._rows.forEach(function (row, rowIdx) {
                const rowTotal = this._calcRowTotal(row, weekDays);
                tbody += '<tr style="border-bottom:1px solid #e5e5e5;">';

                // Task cell — SAP Select injected after render
                tbody += '<td style="padding:6px 8px;border-right:1px solid #e5e5e5;'
                    + 'vertical-align:middle;min-width:220px;">'
                    + '<span id="' + vid + '--taskCell_' + rowIdx + '"></span></td>';

                weekDays.forEach(function (dateStr, dayIdx) {
                    const isSun = dayIdx === 6;
                    const isToday = dateStr === today && !isView;
                    const isYest = dateStr === yesterday && !isView;
                    const isTwoDays = dateStr === twoDaysAgo && !isView;
                    const bg = isToday ? "#dbeeff"
                        : (isYest || isTwoDays) ? "#f0faf0"
                            : isSun ? "#f5f5f5"
                                : "transparent";

                    tbody += '<td style="padding:4px 6px;text-align:center;background:' + bg
                        + ';border-right:1px solid #e5e5e5;vertical-align:middle;">';
                    if (isSun) {
                        tbody += '<span style="color:#bbb;font-size:1rem;">\u2014</span>';
                    } else {
                        // SAP Input injected after render
                        tbody += '<span id="' + vid + '--inputCell_' + rowIdx + '_' + dayIdx + '"></span>';
                    }
                    tbody += '</td>';
                }.bind(this));

                // Row total cell
                tbody += '<td style="padding:6px 8px;text-align:center;font-weight:600;'
                    + 'vertical-align:middle;color:#32363a;" id="'
                    + vid + '--rowTotal_' + rowIdx + '">'
                    + decToHHMM(rowTotal) + '</td>';
                tbody += '</tr>';
            }.bind(this));

            // ── Daily totals row ──────────────────────────────────────────
            let weekTotal = 0;
            tbody += '<tr style="background:#f5f6f7;border-top:2px solid #d9d9d9;font-weight:700;">';
            tbody += '<td style="padding:8px 12px;border-right:1px solid #e5e5e5;'
                + 'font-size:0.875rem;color:#32363a;">Daily Total</td>';

            weekDays.forEach(function (dateStr, idx) {
                const isSun = idx === 6;
                let dayTotal = 0;
                if (!isSun) {
                    this._rows.forEach(function (r) {
                        dayTotal += parseFloat(r.entries[dateStr] || 0);
                    });
                    dayTotal = parseFloat(dayTotal.toFixed(2));
                    weekTotal += dayTotal;
                }
                tbody += '<td style="padding:8px 6px;text-align:center;'
                    + 'border-right:1px solid #e5e5e5;color:'
                    + (dayTotal > 8 ? "#bb0000" : "#32363a") + ';" id="'
                    + vid + '--dayTotal_' + idx + '">'
                    + (isSun ? '\u2014' : decToHHMM(dayTotal)) + '</td>';
            }.bind(this));

            tbody += '<td style="padding:8px 8px;text-align:center;color:#32363a;" id="'
                + vid + '--weekTotal">'
                + decToHHMM(weekTotal) + '</td>';
            tbody += '</tr></tbody>';

            // ── Assemble complete HTML ────────────────────────────────────
            const completeHtml =
                '<div style="width:100%;overflow-x:auto;border-radius:6px;'
                + 'box-shadow:0 1px 4px rgba(0,0,0,0.1);">'
                + '<table style="width:100%;border-collapse:collapse;'
                + 'border:1px solid #d9d9d9;font-family:inherit;font-size:0.875rem;">'
                + thead + tbody
                + '</table></div>';

            // ── HTML control with afterRendering injection guard ───────────
            const self = this;
            const injected = { done: false };

            const htmlControl = new HTML(tableId, {
                content: completeHtml,
                afterRendering: function () {
                    if (injected.done) return;
                    injected.done = true;
                    self._injectSAPControls(weekDays, canEdit, today, isView);
                }
            });

            rowsContainer.addItem(htmlControl);
        },

        // ── Inject SAP Select + Input into rendered HTML table spans ──────────
        _injectSAPControls: function (weekDays, canEdit, today, isView) {
            const vid = this.getView().getId();
            const yesterday = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();

            this._rows.forEach(function (row, rowIdx) {

                // ── Task Select ───────────────────────────────────────────
                const taskSpan = document.getElementById(vid + "--taskCell_" + rowIdx);
                if (taskSpan) {
                    const sel = new Select({
                        width: "100%",
                        selectedKey: row.isCustom ? "__OTHERS__" : (row.taskId || ""),
                        enabled: !!canEdit,
                        change: this._onTaskSelectChange(rowIdx, weekDays, canEdit)
                    });
                    sel.addItem(new Item({ key: "", text: "-- Select Task --" }));
                    this._getAvailableTasks(rowIdx).forEach(function (t) {
                        sel.addItem(new Item({ key: t.taskId, text: t.taskName }));
                    });
                    // Permanent "Others" option — always available regardless of tasks.
                    sel.addItem(new Item({ key: "__OTHERS__", text: "Others" }));
                    sel.placeAt(taskSpan);
                    this._injectedControls.push(sel);
                    // Render the custom-task field for rows already marked custom.
                    this._renderRowCustomInput(rowIdx, canEdit);
                }

                // ── Hour Inputs ───────────────────────────────────────────
                weekDays.forEach(function (dateStr, dayIdx) {
                    if (dayIdx === 6) return; // Sunday — no input

                    const span = document.getElementById(
                        vid + "--inputCell_" + rowIdx + "_" + dayIdx
                    );
                    if (!span) return;

                    const isLocked = row.locked[dateStr] === true;
                    let editable = false;

                    if (canEdit) {
                        if (isView) {
                            // Viewing prev week — all days editable
                            editable = true;
                        } else {
                            // Current week: today, yesterday, 2 days ago
                            editable = (dateStr === today ||
                                dateStr === yesterday ||
                                dateStr === twoDaysAgo);
                            // Also editable if HR approved unlock
                            const ur = this._dayUnlockReqs[dateStr];
                            if (ur && ur.status === "Approved") editable = true;
                        }
                    }
                    if (isLocked) editable = false;

                    const inp = this._makeDurationCell(rowIdx, dateStr, dayIdx, editable, weekDays);
                    inp.placeAt(span);
                    this._injectedControls.push(inp);
                }.bind(this));

            }.bind(this));
        },

        // ── Update totals by writing directly to DOM cells ────────────────────
        _recalcTotals: function (weekDays) {
            const wd = weekDays || this._getWeekDays();
            const vid = this.getView().getId();
            let weekTotal = 0;

            wd.forEach(function (dateStr, idx) {
                if (idx === 6) return;
                let dayTotal = 0;
                this._rows.forEach(function (r) {
                    dayTotal += parseFloat(r.entries[dateStr] || 0);
                });
                dayTotal = parseFloat(dayTotal.toFixed(2));
                weekTotal += dayTotal;

                const dc = document.getElementById(vid + "--dayTotal_" + idx);
                if (dc) {
                    dc.textContent = decToHHMM(dayTotal);
                    dc.style.color = dayTotal > 8 ? "#bb0000" : "#32363a";
                }
            }.bind(this));

            // Row totals
            this._rows.forEach(function (row, rowIdx) {
                const rt = this._calcRowTotal(row, wd);
                const rtEl = document.getElementById(vid + "--rowTotal_" + rowIdx);
                if (rtEl) rtEl.textContent = decToHHMM(rt);
            }.bind(this));

            // Week total
            const wt = document.getElementById(vid + "--weekTotal");
            if (wt) wt.textContent = decToHHMM(weekTotal);
        },

        // Compat aliases
        _updateTotals: function (wd) { this._recalcTotals(wd); },
        _renderTotals: function (wd) { this._recalcTotals(wd); },

        _calcRowTotal: function (row, weekDays) {
            let total = 0;
            weekDays.forEach(function (d) { total += parseFloat(row.entries[d] || 0); });
            return parseFloat(total.toFixed(2));
        },

        // ══════════════════════════════════════════════════════════════════════
        // WORK-DURATION CELL  (HH:MM picker)
        // Each weekday cell is a read-only field that opens an "Enter Work
        // Duration" popover with Hours (00–12) and Minutes (00/15/30/45) drop-
        // downs. Values are kept internally as decimal hours.
        // ══════════════════════════════════════════════════════════════════════
        _makeDurationCell: function (rowIdx, dateStr, dayIdx, editable, weekDays) {
            const cur = this._rows[rowIdx].entries[dateStr];
            const display = (cur != null && parseFloat(cur) > 0) ? decToHHMM(cur) : "";
            const inp = new Input({
                value: display,
                placeholder: "--:--",
                editable: !!editable,
                showValueHelp: !!editable,
                valueHelpOnly: !!editable,   // whole field opens the picker; no typing
                width: "100%",
                textAlign: "Center",
                valueHelpRequest: function (evt) {
                    this._openDurationPopover(evt.getSource(), rowIdx, dateStr, weekDays);
                }.bind(this)
            });
            return inp;
        },

        _openDurationPopover: function (oControl, rowIdx, dateStr, weekDays) {
            const parts = decToParts(this._rows[rowIdx].entries[dateStr]);
            const curH = Math.min(parts.h, 12);   // selector caps at 12h
            const curM = parts.m;

            const hourSel = new Select({ width: "5.5rem", autoAdjustWidth: false });
            for (let h = 0; h <= 12; h++) {
                hourSel.addItem(new Item({ key: String(h), text: pad2(h) }));
            }
            hourSel.setSelectedKey(String(curH));

            const minSel = new Select({ width: "5.5rem", autoAdjustWidth: false });
            MINUTE_OPTIONS.forEach(function (m) {
                minSel.addItem(new Item({ key: String(m), text: pad2(m) }));
            });
            minSel.setSelectedKey(String(curM));

            const hoursCol = new VBox({ items: [new Label({ text: "Hours" }), hourSel] });
            const minsCol = new VBox({ items: [new Label({ text: "Minutes" }), minSel] });
            const colon = new Text({ text: ":" });
            colon.addStyleClass("sapUiSmallMarginBegin");
            colon.addStyleClass("sapUiSmallMarginEnd");
            const pickerRow = new HBox({
                alignItems: "End", justifyContent: "Center",
                items: [hoursCol, colon, minsCol]
            });
            const hint = new Text({ text: "Select how many hours you worked" });
            hint.addStyleClass("sapUiTinyMarginTop");
            const body = new VBox({ items: [pickerRow, hint] });
            body.addStyleClass("sapUiContentPadding");

            const okBtn = new Button({
                text: "OK", type: "Emphasized",
                press: function () {
                    const h = parseInt(hourSel.getSelectedKey(), 10) || 0;
                    const m = parseInt(minSel.getSelectedKey(), 10) || 0;
                    if (this._applyDuration(rowIdx, dateStr, h + m / 60, weekDays, oControl)) {
                        pop.close();
                    }
                }.bind(this)
            });
            const cancelBtn = new Button({ text: "Cancel", press: function () { pop.close(); } });

            const pop = new ResponsivePopover({
                title: "Enter Work Duration",
                placement: "Auto",
                contentWidth: "18rem",
                content: [body],
                beginButton: cancelBtn,
                endButton: okBtn,
                afterClose: function () { pop.destroy(); }
            });
            this.getView().addDependent(pop);
            pop.openBy(oControl);
        },

        // Validate + store a decimal-hours value for one cell, update its display
        // and the totals. Returns false (keeping the popover open) if rejected.
        _applyDuration: function (rowIdx, dateStr, dec, weekDays, oControl) {
            dec = parseFloat(dec) || 0;
            if (dec < 0 || dec > 24) {
                MessageToast.show("Enter a value between 0 and 24 hours.");
                return false;
            }
            const others = this._rows.reduce(function (sum, r, i) {
                return sum + (i === rowIdx ? 0 : parseFloat(r.entries[dateStr] || 0));
            }, 0);
            if (others + dec > 24) {
                MessageToast.show("Daily total cannot exceed 24 hours across all tasks.");
                return false;
            }
            if (!this._rows[rowIdx].entries) this._rows[rowIdx].entries = {};
            this._rows[rowIdx].entries[dateStr] = dec;
            if (oControl && oControl.setValue) oControl.setValue(dec > 0 ? decToHHMM(dec) : "");
            this._recalcTotals(weekDays);
            const vm2 = this.getView().getModel("viewModel");
            const has = this._rows.some(function (r) {
                return r.taskId &&
                    Object.values(r.entries).some(function (h) { return h > 0; });
            });
            vm2.setProperty("/canSubmit", !!has);
            return true;
        },

        // ══════════════════════════════════════════════════════════════════════
        // ADD ROW
        // Appends directly to existing table DOM — does NOT call _renderGrid
        // (calling _renderGrid would trigger afterRendering again → duplicate rows)
        // ══════════════════════════════════════════════════════════════════════
        onAddRow: function () {
            const rowIdx = this._rows.length;
            const weekDays = this._getWeekDays();
            const vm = this.getView().getModel("viewModel");
            const canEdit = vm.getProperty("/canEdit");
            const today = this._toISODate(new Date());
            const yesterday = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();
            const isView = vm.getProperty("/isViewingPrevWeek");
            const vid = this.getView().getId();

            // Add empty row to data model
            this._rows.push({ taskId: null, taskName: null, isCustom: false, customTaskText: "", entries: {}, locked: {} });

            // Find tbody of existing table
            const rowsContainerDom = this.byId("timesheetRowsContainer").getDomRef();
            if (!rowsContainerDom) return;
            const tbody = rowsContainerDom.querySelector("tbody");
            if (!tbody) return;
            const totalRow = tbody.querySelector("tr:last-child"); // daily totals row

            // Build new <tr>
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #e5e5e5";

            // Task cell
            const taskTd = document.createElement("td");
            taskTd.style.cssText =
                "padding:6px 8px;border-right:1px solid #e5e5e5;vertical-align:middle;min-width:220px;";
            const taskSpan = document.createElement("span");
            taskSpan.id = vid + "--taskCell_" + rowIdx;
            taskTd.appendChild(taskSpan);
            tr.appendChild(taskTd);

            // Day cells
            weekDays.forEach(function (dateStr, dayIdx) {
                const isSun = dayIdx === 6;
                const isToday = dateStr === today && !isView;
                const isYest = dateStr === yesterday && !isView;
                const isTwoDays = dateStr === twoDaysAgo && !isView;
                const bg = isToday ? "#dbeeff"
                    : (isYest || isTwoDays) ? "#f0faf0"
                        : isSun ? "#f5f5f5"
                            : "transparent";

                const td = document.createElement("td");
                td.style.cssText =
                    "padding:4px 6px;text-align:center;background:" + bg +
                    ";border-right:1px solid #e5e5e5;vertical-align:middle;";

                if (isSun) {
                    td.innerHTML = '<span style="color:#bbb;font-size:1rem;">\u2014</span>';
                } else {
                    const span = document.createElement("span");
                    span.id = vid + "--inputCell_" + rowIdx + "_" + dayIdx;
                    td.appendChild(span);
                }
                tr.appendChild(td);
            }.bind(this));

            // Row total cell
            const totalTd = document.createElement("td");
            totalTd.style.cssText =
                "padding:6px 8px;text-align:center;font-weight:600;vertical-align:middle;color:#32363a;";
            totalTd.id = vid + "--rowTotal_" + rowIdx;
            totalTd.textContent = "0";
            tr.appendChild(totalTd);

            // Insert before the daily totals row
            tbody.insertBefore(tr, totalRow);

            // ── Inject SAP Select for new row ─────────────────────────────
            const taskSpanEl = document.getElementById(vid + "--taskCell_" + rowIdx);
            if (taskSpanEl) {
                const sel = new Select({
                    width: "100%",
                    selectedKey: "",
                    enabled: !!canEdit,
                    change: this._onTaskSelectChange(rowIdx, weekDays, canEdit)
                });
                sel.addItem(new Item({ key: "", text: "-- Select Task --" }));
                this._getAvailableTasks(rowIdx).forEach(function (t) {
                    sel.addItem(new Item({ key: t.taskId, text: t.taskName }));
                }.bind(this));
                sel.addItem(new Item({ key: "__OTHERS__", text: "Others" }));
                sel.placeAt(taskSpanEl);
                this._injectedControls.push(sel);
            }

            // ── Inject SAP Inputs for new row ─────────────────────────────
            weekDays.forEach(function (dateStr, dayIdx) {
                if (dayIdx === 6) return;
                const span = document.getElementById(
                    vid + "--inputCell_" + rowIdx + "_" + dayIdx
                );
                if (!span) return;

                let editable = false;
                if (canEdit) {
                    editable = isView ? true
                        : (dateStr === today ||
                            dateStr === yesterday ||
                            dateStr === twoDaysAgo);
                    const ur = this._dayUnlockReqs[dateStr];
                    if (ur && ur.status === "Approved") editable = true;
                }

                const inp = this._makeDurationCell(rowIdx, dateStr, dayIdx, editable, weekDays);
                inp.placeAt(span);
                this._injectedControls.push(inp);
            }.bind(this));
        },

        // ══════════════════════════════════════════════════════════════════════
        // MISSED-DAY ACTIONS
        // Shows HR unlock buttons for days older than 2 days within current week
        // Yesterday and 2 days ago are directly editable — no HR needed
        // ══════════════════════════════════════════════════════════════════════
        _renderMissedDayActions: function () {
            const container = this._clearContainer("missedDayActionsContainer");
            if (!container) return;

            const vm = this.getView().getModel("viewModel");
            if (vm.getProperty("/isViewingPrevWeek")) return;

            const today      = this._toISODate(new Date());
            const yesterday  = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();
            const weekDays   = this._getWeekDays();
            const missedRows = [];

            weekDays.forEach(function (dateStr, idx) {
                if (idx === 6) return;
                if (dateStr >= today) return;
                if (dateStr === yesterday || dateStr === twoDaysAgo) return;

                const dayTotal = this._rows.reduce(function (sum, r) {
                    return sum + parseFloat(r.entries[dateStr] || 0);
                }, 0);
                if (dayTotal > 0) return;

                const req = this._dayUnlockReqs[dateStr];
                let buttonEnabled, buttonType, statusText = null, statusState = "Warning";

                if (!req) {
                    buttonEnabled = true;
                    buttonType    = "Attention";
                } else if (req.status === "Pending") {
                    buttonEnabled = false;
                    buttonType    = "Default";
                    statusText    = "HR Approval Pending";
                    statusState   = "Warning";
                } else if (req.status === "Approved") {
                    return;
                } else if (req.status === "Rejected") {
                    buttonEnabled = true;
                    buttonType    = "Negative";
                    statusText    = "HR Request Rejected";
                    statusState   = "Error";
                } else {
                    return;
                }

                missedRows.push({
                    dateStr, buttonEnabled, buttonType, statusText, statusState,
                    label: DAY_LABELS[idx] + ", " + this._formatDisplayDate(dateStr)
                });
            }.bind(this));

            if (!missedRows.length) return;

            const card = new VBox();
            card.addStyleClass("tsMissedDaysCard");

            const header = new HBox({ alignItems: "Center" });
            header.addStyleClass("tsMissedDaysHeader");
            const hIcon = new sap.ui.core.Icon({ src: "sap-icon://alert" });
            hIcon.addStyleClass("tsMissedDaysHeaderIcon");
            const hText = new Text({ text: "Missed Days — HR Approval Required" });
            hText.addStyleClass("tsMissedDaysHeaderText");
            header.addItem(hIcon);
            header.addItem(hText);
            card.addItem(header);

            missedRows.forEach(function (item) {
                const row = new HBox({ alignItems: "Center", justifyContent: "SpaceBetween" });
                row.addStyleClass("tsMissedDaysRow");

                const dateLabel = new Text({ text: item.label });
                dateLabel.addStyleClass("tsMissedDaysDate");
                row.addItem(dateLabel);

                const right = new HBox({ alignItems: "Center" });
                if (item.statusText) {
                    const badge = new ObjectStatus({ text: item.statusText, state: item.statusState });
                    badge.addStyleClass("sapUiTinyMarginEnd");
                    right.addItem(badge);
                }
                const actionText = item.buttonType === "Negative" ? "Re-request Approval"
                    : item.buttonEnabled ? "Request HR Approval" : "Request Sent";
                const btn = new Button({
                    text:    actionText,
                    type:    item.buttonType,
                    icon:    item.buttonType === "Negative" ? "sap-icon://refresh" : "sap-icon://paper-plane",
                    enabled: !!item.buttonEnabled,
                    press:   (function (d) {
                        return function () { this._openHRUnlockDialog(d); }.bind(this);
                    }.bind(this))(item.dateStr)
                });
                right.addItem(btn);
                row.addItem(right);
                card.addItem(row);
            }.bind(this));

            container.addItem(card);
        },

        // ══════════════════════════════════════════════════════════════════════
        // HR UNLOCK DIALOG
        // ══════════════════════════════════════════════════════════════════════
        _openHRUnlockDialog: async function (dateStr) {
            this._hrUnlockTargetDate = dateStr;

            // HR employees cannot self-approve their own missed days — route the
            // request to their reporting manager instead of picking an HR approver.
            // The manager approves it on the "Timesheet Fill Requests" tab.
            const oComp = this.getOwnerComponent();
            let user = oComp._oCurrentUser;
            if (!user && oComp.getCurrentUser) { try { user = await oComp.getCurrentUser(); } catch (e) { /* ignore */ } }
            const role = (user && user.role ? String(user.role) : "").toLowerCase();
            if (role === "hr") {
                const managerId = user && (user.managerId || user.manager_employeeId);
                if (!managerId) {
                    MessageBox.warning("No reporting manager is set on your profile. Please contact admin.");
                    return;
                }
                this._submitManagerUnlockRequest(dateStr, managerId);
                return;
            }

            const hrModel = this.getView().getModel("hrUnlockModel");
            hrModel.setProperty("/targetDate", dateStr);
            hrModel.setProperty("/selectedHrId", "");
            hrModel.setProperty("/employeeRemarks", "");

            // Load HR list on first open
            const hrListModel = this.getView().getModel("hrListModel");
            if (!hrListModel.getProperty("/hrEmployees").length) {
                await this._loadHREmployees();
            }

            this._getHrUnlockDialog().open();
        },

        // Lazily build the HR-unlock dialog (custom dialog control). Bound to the
        // same hrUnlockModel / hrListModel as before — logic unchanged.
        _getHrUnlockDialog: function () {
            if (this._oHrUnlockDialog) return this._oHrUnlockDialog;

            this._oHrApproverSelect = new Select({
                width: "100%",
                selectedKey: "{hrUnlockModel>/selectedHrId}"
            });
            this._oHrApproverSelect.bindItems({
                path: "hrListModel>/hrEmployees",
                template: new ListItem({
                    key: "{hrListModel>employeeId}",
                    text: "{hrListModel>employeeName}",
                    additionalText: "{hrListModel>designation}"
                })
            });

            this._oHrUnlockDialog = new CustomDialog({
                title: "Request HR Approval to Fill Missed Day",
                contentWidth: "480px",
                content: [
                    new VBox({
                        items: [
                            new Label({ text: "Missed Date", required: true }),
                            new Input({ editable: false, value: "{hrUnlockModel>/targetDate}" })
                                .addStyleClass("sapUiTinyMarginBottom"),
                            new Label({ text: "Select HR Approver", required: true })
                                .addStyleClass("sapUiSmallMarginTop"),
                            this._oHrApproverSelect,
                            new Label({ text: "Reason for Missing" })
                                .addStyleClass("sapUiSmallMarginTop"),
                            new TextArea({
                                rows: 3, width: "100%", maxLength: 255,
                                value: "{hrUnlockModel>/employeeRemarks}",
                                placeholder: "Briefly explain why this date was missed..."
                            }),
                            new MessageStrip({
                                text: "HR will receive an email. Once approved, you can fill this date.",
                                type: "Information", showIcon: true, showCloseButton: false
                            }).addStyleClass("sapUiSmallMarginTop")
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Send Request", type: "Emphasized", icon: "sap-icon://paper-plane",
                    press: this.onSubmitHRUnlockRequest.bind(this)
                }),
                endButton: new Button({
                    text: "Cancel", press: this.onCloseHRUnlockDialog.bind(this)
                })
            });
            this.getView().addDependent(this._oHrUnlockDialog);
            return this._oHrUnlockDialog;
        },

        _loadHREmployees: async function () {
            try {
                const resp = await fetch(
                    BASE_URL +
                    "/Employees?$filter=designation eq 'HR' or department eq 'HR'&$format=json"
                );
                const data = await resp.json();
                this.getView().getModel("hrListModel").setProperty(
                    "/hrEmployees",
                    (data.value || []).map(function (e) {
                        return {
                            employeeId: e.employeeId,
                            employeeName: e.employeeName,
                            designation: e.designation,
                            department: e.department
                        };
                    })
                );
            } catch (e) {
                MessageBox.error("Could not load HR list: " + (e.message || e));
            }
        },

        onSubmitHRUnlockRequest: async function () {
            const hrId = this._oHrApproverSelect
                ? this._oHrApproverSelect.getSelectedKey()
                : this.getView().getModel("hrUnlockModel").getProperty("/selectedHrId");
            const hrModel = this.getView().getModel("hrUnlockModel");

            if (!hrId) {
                MessageBox.warning("Please select an HR approver.");
                return;
            }

            try {
                this.getView().setBusy(true);
                await this._callAction(BASE_URL + "/requestDayUnlock", {
                    targetDate: this._hrUnlockTargetDate,
                    hrApproverId: hrId,
                    employeeRemarks: hrModel.getProperty("/employeeRemarks")
                });
                MessageToast.show("HR unlock request sent successfully!");
                if (this._oHrUnlockDialog) this._oHrUnlockDialog.close();
                await this._loadTimesheetData();
            } catch (e) {
                MessageBox.error("Failed to send HR unlock request: " + (e.message || e));
            } finally {
                this.getView().setBusy(false);
            }
        },

        onCloseHRUnlockDialog: function () {
            if (this._oHrUnlockDialog) this._oHrUnlockDialog.close();
        },

        // HR employee → route the missed-day request to their reporting manager.
        _submitManagerUnlockRequest: function (dateStr, managerId) {
            MessageBox.confirm(
                `Send a request to your reporting manager to fill your missed timesheet for ${dateStr}?`,
                {
                    title:            "Request Manager Approval",
                    actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: async (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        try {
                            this.getView().setBusy(true);
                            await this._callAction(BASE_URL + "/requestDayUnlock", {
                                targetDate:      dateStr,
                                hrApproverId:    managerId,
                                employeeRemarks: ""
                            });
                            MessageToast.show("Request sent to your reporting manager.");
                            await this._loadTimesheetData();
                        } catch (e) {
                            MessageBox.error("Failed to send request: " + (e.message || e));
                        } finally {
                            this.getView().setBusy(false);
                        }
                    }
                }
            );
        },

        // ══════════════════════════════════════════════════════════════════════
        // PREVIOUS WEEK DIALOG
        // ══════════════════════════════════════════════════════════════════════
        onRequestPrevWeekFill: async function () {
            const prevModel = this.getView().getModel("prevWeekModel");

            prevModel.setProperty("/weekRangeLabel",
                this._formatDisplayDate(this._prevWeekStartDate) +
                " \u2013 " +
                this._formatDisplayDate(this._prevWeekEndDate));
            prevModel.setProperty("/employeeRemarks", "");
            prevModel.setProperty("/infoText",
                "This will send an approval request to your manager. " +
                "You can fill the previous week timesheet only after manager approval.");

            // Resolve manager name
            let managerName = "(Unknown Manager)";
            if (this._currentEmployee && this._currentEmployee.managerId) {
                try {
                    const r = await fetch(
                        BASE_URL + "/Employees('" +
                        this._currentEmployee.managerId + "')?$format=json"
                    );
                    const d = await r.json();
                    managerName = d.employeeName || managerName;
                } catch (_) { /* non-critical */ }
            }
            prevModel.setProperty("/managerName", managerName);

            this._getPrevWeekDialog().open();
        },

        // Lazily build the previous-week approval dialog (custom dialog control).
        _getPrevWeekDialog: function () {
            if (this._oPrevWeekDialog) return this._oPrevWeekDialog;

            this._oPrevWeekDialog = new CustomDialog({
                title: "Request Previous Week Timesheet Approval",
                contentWidth: "460px",
                content: [
                    new VBox({
                        items: [
                            new MessageStrip({
                                text: "{prevWeekModel>/infoText}",
                                type: "Warning", showIcon: true, showCloseButton: false
                            }).addStyleClass("sapUiSmallMarginBottom"),
                            new Label({ text: "Previous Week" }),
                            new Input({ editable: false, value: "{prevWeekModel>/weekRangeLabel}" })
                                .addStyleClass("sapUiTinyMarginBottom"),
                            new Label({ text: "Your Manager" })
                                .addStyleClass("sapUiSmallMarginTop"),
                            new Input({ editable: false, value: "{prevWeekModel>/managerName}" })
                                .addStyleClass("sapUiTinyMarginBottom"),
                            new Label({ text: "Reason (optional)" })
                                .addStyleClass("sapUiSmallMarginTop"),
                            new TextArea({
                                rows: 3, width: "100%", maxLength: 255,
                                value: "{prevWeekModel>/employeeRemarks}",
                                placeholder: "Explain why the previous week was not submitted..."
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Send for Approval", type: "Emphasized", icon: "sap-icon://paper-plane",
                    press: this.onConfirmPrevWeekRequest.bind(this)
                }),
                endButton: new Button({
                    text: "Cancel", press: this.onClosePrevWeekDialog.bind(this)
                })
            });
            this.getView().addDependent(this._oPrevWeekDialog);
            return this._oPrevWeekDialog;
        },

        onConfirmPrevWeekRequest: async function () {
            const remarks = this.getView().getModel("prevWeekModel")
                .getProperty("/employeeRemarks");
            try {
                this.getView().setBusy(true);
                await this._callAction(BASE_URL + "/requestPrevWeekFill", {
                    weekStartDate: this._prevWeekStartDate,
                    weekEndDate: this._prevWeekEndDate,
                    employeeRemarks: remarks
                });
                MessageToast.show("Approval request sent to your manager!");
                if (this._oPrevWeekDialog) this._oPrevWeekDialog.close();
                await this._loadTimesheetData();
            } catch (e) {
                MessageBox.error("Failed to send request: " + (e.message || e));
            } finally {
                this.getView().setBusy(false);
            }
        },

        onClosePrevWeekDialog: function () {
            if (this._oPrevWeekDialog) this._oPrevWeekDialog.close();
        },

        // ══════════════════════════════════════════════════════════════════════
        // WEEK NAVIGATION
        // ══════════════════════════════════════════════════════════════════════
        onSwitchToPrevWeek: function () {
            const vm = this.getView().getModel("viewModel");
            vm.setProperty("/isViewingPrevWeek", true);
            this._weekStartDate = this._prevWeekStartDate;
            this._weekEndDate = this._prevWeekEndDate;
            vm.setProperty("/weekRangeLabel",
                this._formatDisplayDate(this._weekStartDate) +
                " \u2013 " +
                this._formatDisplayDate(this._weekEndDate) +
                " (Previous Week)");
            this._loadTimesheetData();
        },

        onSwitchToCurrentWeek: function () {
            const vm = this.getView().getModel("viewModel");
            vm.setProperty("/isViewingPrevWeek", false);
            this._computeWeekDates(new Date());
            this._loadTimesheetData();
        },

        // ══════════════════════════════════════════════════════════════════════
        // SAVE
        // ══════════════════════════════════════════════════════════════════════
        onSaveEntries: async function () {
            const vm = this.getView().getModel("viewModel");

            if (!vm.getProperty("/canEdit")) {
                MessageToast.show("Timesheet is locked and cannot be edited.");
                return;
            }

            if (!this._validateCustomTasks()) {
                MessageBox.error("Please enter task details (maximum 30 characters).");
                return;
            }

            const validEntries = this._collectValidEntries();
            if (!validEntries.length) {
                MessageBox.warning(
                    "Please select a task and fill at least one day with hours before saving."
                );
                return;
            }

            try {
                this.getView().setBusy(true);
                const result = await this._callAction(
                    BASE_URL + "/saveTimesheetEntries", {
                    timesheetId: this._timesheetId,
                    weekStartDate: this._weekStartDate,
                    weekEndDate: this._weekEndDate,
                    isPrevWeek: !!vm.getProperty("/isViewingPrevWeek"),
                    entries: JSON.stringify(validEntries)
                }
                );
                this._timesheetId = result.timesheetId;
                MessageToast.show("Saved " + result.saved + " entr" +
                    (result.saved === 1 ? "y" : "ies") + " successfully.");
                this._updateDashboardCharts();
                await this._loadTimesheetData();
            } catch (e) {
                MessageBox.error("Save failed: " + (e.message || e));
            } finally {
                this.getView().setBusy(false);
            }
        },

        // ══════════════════════════════════════════════════════════════════════
        // SUBMIT — only allowed on Friday or Saturday
        // ══════════════════════════════════════════════════════════════════════
        onSubmitTimesheet: function () {
            const vm = this.getView().getModel("viewModel");
            const isViewingPrev = vm.getProperty("/isViewingPrevWeek");

            // Block submit before Friday for current week
            if (!isViewingPrev) {
                const dayOfWeek = new Date().getDay(); // 0=Sun ... 5=Fri ... 6=Sat
                if (dayOfWeek < 5) {
                    const names = ["Sunday", "Monday", "Tuesday", "Wednesday",
                        "Thursday", "Friday", "Saturday"];
                    const daysLeft = 5 - dayOfWeek;
                    MessageBox.warning(
                        "You can only submit the xeekly timesheet on Friday or later.\n\n" +
                        "Today is " + names[dayOfWeek] + " \u2014 " +
                        daysLeft + " day" + (daysLeft > 1 ? "s" : "") + " until Friday."
                    );
                    return;
                }
            }

            if (!this._validateCustomTasks()) {
                MessageBox.error("Please enter task details (maximum 30 characters).");
                return;
            }

            const validEntries = this._collectValidEntries();
            if (!validEntries.length) {
                MessageBox.warning(
                    "Please select a task and fill at least one day with hours before submitting."
                );
                return;
            }

            const confirmMsg = isViewingPrev
                ? "This will save and finalise the previous week timesheet " +
                "(no further approval needed). Proceed?"
                : "This will submit your timesheet to your manager for approval. Proceed?";

            MessageBox.confirm(confirmMsg, {
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: async function (action) {
                    if (action !== MessageBox.Action.OK) return;
                    try {
                        this.getView().setBusy(true);

                        // Save first, then submit
                        await this._callAction(BASE_URL + "/saveTimesheetEntries", {
                            timesheetId: this._timesheetId,
                            weekStartDate: this._weekStartDate,
                            weekEndDate: this._weekEndDate,
                            isPrevWeek: !!isViewingPrev,
                            entries: JSON.stringify(validEntries)
                        });

                        const msg = await this._callAction(
                            BASE_URL + "/submitTimesheetWeek", {
                            timesheetId: this._timesheetId,
                            isPrevWeek: !!isViewingPrev
                        }
                        );

                        MessageBox.success(
                            typeof msg === "string" ? msg : "Timesheet submitted successfully!",
                            {
                                onClose: function () {
                                    if (isViewingPrev) {
                                        // Auto switch back to current week after prev week submit
                                        this.onSwitchToCurrentWeek();
                                    } else {
                                        this._loadTimesheetData();
                                    }
                                }.bind(this)
                            }
                        );
                        this._updateDashboardCharts();

                    } catch (e) {
                        MessageBox.error("Submit failed: " + (e.message || e));
                    } finally {
                        this.getView().setBusy(false);
                    }
                }.bind(this)
            });
        },

        // ── Notify dashboard via event bus ────────────────────────────────────
        _updateDashboardCharts: function () {
            try {
                sap.ui.getCore().getEventBus().publish("Timesheet", "DataChanged", {
                    timesheetId: this._timesheetId,
                    weekStartDate: this._weekStartDate,
                    weekEndDate: this._weekEndDate
                });
            } catch (e) {
                console.warn("EventBus publish failed:", e);
            }
        },

        // ══════════════════════════════════════════════════════════════════════
        // HELPERS
        // ══════════════════════════════════════════════════════════════════════
        _collectValidEntries: function () {
            const entries = [];
            this._rows.forEach(function (row) {
                const isCustom = !!row.isCustom;
                const customText = (row.customTaskText || "").trim();
                if (isCustom) { if (!customText) return; }
                else if (!row.taskId) return;

                Object.entries(row.entries).forEach(function (pair) {
                    const dateStr = pair[0];
                    const hours = pair[1];
                    if (hours > 0) {
                        const entry = { workDate: dateStr, hoursWorked: hours, description: "" };
                        if (isCustom) {
                            entry.isCustomTask = true;
                            entry.customTaskText = customText;
                        } else {
                            entry.taskId = row.taskId;
                        }
                        entries.push(entry);
                    }
                });
            });
            return entries;
        },

        _callAction: async function (url, payload) {
            const resp = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": await this._fetchCSRFToken()
                },
                body: JSON.stringify(payload)
            });

            if (!resp.ok) {
                let errMsg = "HTTP " + resp.status;
                try {
                    const errData = await resp.json();
                    errMsg = (errData.error && errData.error.message) || errMsg;
                } catch (_) { }
                throw new Error(errMsg);
            }

            const data = await resp.json();
            return data.value !== undefined ? data.value : data;
        },

        _fetchCSRFToken: async function () {
            if (this._csrfToken) return this._csrfToken;
            try {
                const r = await fetch(BASE_URL, {
                    method: "GET",
                    headers: { "X-CSRF-Token": "Fetch" }
                });
                this._csrfToken = r.headers.get("x-csrf-token") || "";
            } catch (_) {
                this._csrfToken = "";
            }
            return this._csrfToken;
        }
    });
});