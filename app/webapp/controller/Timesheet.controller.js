// ─────────────────────────────────────────────────────────────────────────────
// FILE: webapp/controller/Timesheet.controller.js
// Namespace : timesheet.app  (matches manifest.json sap.app.id)
// Backend   : /employee  (CAP OData v4 EmployeeService)
// ─────────────────────────────────────────────────────────────────────────────
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
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
    "sap/ui/core/HTML"
], function (
    Controller, JSONModel,
    MessageBox, MessageToast,
    Input, Select, Text, Button, HBox, VBox, Label, ObjectStatus, Item, HTML
) {
    "use strict";

    const BASE_URL   = "/employee";
    const DAYS       = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const DAY_LABELS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

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
                weekStatus:             "None",
                weekStatusState:        "None",
                weekStatusIcon:         "",
                weekRangeLabel:         "",
                prevWeekRangeLabel:     "",
                isViewingPrevWeek:      false,
                isPrevWeekApproved:     false,
                canEdit:                false,
                canSubmit:              false,
                infoMessage:            "",
                infoMessageType:        "Information",
                showRequestPrevWeekBtn: false,
                showPrevWeekPending:    false,
                showFillPrevWeekBtn:    false,
                showPrevWeekDone:       false,
                prevWeekFillEnabled:    false
            }), "viewModel");

            // Internal state
            this._currentEmployee  = null;
            this._weekStartDate    = null;
            this._weekEndDate      = null;
            this._prevWeekStartDate = null;
            this._prevWeekEndDate   = null;
            this._timesheetId      = null;
            this._tasks            = [];
            this._rows             = [];
            this._dayUnlockReqs    = {};
            this._prevWeekRequest  = null;
            this._injectedControls = [];  // tracks placeAt controls for cleanup
            this._csrfToken        = null;

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
            const d    = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const day  = d.getDay();
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

        _computeWeekDates: function (refDate, offset) {
            const mon = this._getMondayOfWeek(refDate);
            if (offset === -1) mon.setDate(mon.getDate() - 7);
            const sun = new Date(mon);
            sun.setDate(mon.getDate() + 6);

            this._weekStartDate = this._toISODate(mon);
            this._weekEndDate   = this._toISODate(sun);

            // Always keep prev week dates for the bottom section
            const prevMon = new Date(this._getMondayOfWeek(new Date()));
            prevMon.setDate(prevMon.getDate() - 7);
            const prevSun = new Date(prevMon);
            prevSun.setDate(prevMon.getDate() + 6);
            this._prevWeekStartDate = this._toISODate(prevMon);
            this._prevWeekEndDate   = this._toISODate(prevSun);

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
            const mon  = new Date(this._weekStartDate + "T00:00:00");
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
                        weekEndDate:   this._weekEndDate
                    }
                );

                this._timesheetId   = data.timesheetId;
                this._tasks         = JSON.parse(data.tasks || "[]");
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
                if (!rowMap[e.task_taskId]) {
                    const task = this._tasks.find(function (t) {
                        return t.taskId === e.task_taskId;
                    });
                    rowMap[e.task_taskId] = {
                        taskId:   e.task_taskId,
                        taskName: task ? task.taskName : e.task_taskId,
                        entries:  {},
                        locked:   {}
                    };
                }
                rowMap[e.task_taskId].entries[e.workDate] = e.hoursWorked;
                rowMap[e.task_taskId].locked[e.workDate]  = !!e.isLocked;
            }.bind(this));

            this._rows = Object.values(rowMap);
            // Always have at least one empty row
            if (this._rows.length === 0) {
                this._rows.push({ taskId: null, taskName: null, entries: {}, locked: {} });
            }
        },

        // ══════════════════════════════════════════════════════════════════════
        // VIEW MODEL STATE
        // All setProperty calls use native booleans — never strings
        // ══════════════════════════════════════════════════════════════════════
        _updateViewModelState: function (weekStatus, isPrevWeekApproved) {
            const vm     = this.getView().getModel("viewModel");
            const isView = vm.getProperty("/isViewingPrevWeek");

            const stateMap = {
                "Draft":            { state: "None",    icon: "sap-icon://edit"    },
                "Pending":          { state: "Warning", icon: "sap-icon://pending" },
                "Approved":         { state: "Success", icon: "sap-icon://accept"  },
                "Rejected":         { state: "Error",   icon: "sap-icon://decline" },
                "PrevWeekApproved": { state: "Success", icon: "sap-icon://accept"  },
                "None":             { state: "None",    icon: ""                   }
            };
            const s = stateMap[weekStatus] || stateMap["None"];

            vm.setProperty("/weekStatus",         weekStatus);
            vm.setProperty("/weekStatusState",    s.state);
            vm.setProperty("/weekStatusIcon",     s.icon);
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
            const pr         = this._prevWeekRequest;
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
        },

        // ══════════════════════════════════════════════════════════════════════
        // GRID RENDERING  — builds a real HTML <table> via sap/ui/core/HTML
        //                   then injects SAP Select/Input via placeAt()
        // ══════════════════════════════════════════════════════════════════════
        _renderGrid: function () {
            this._destroyInjectedControls(); // MUST be first

            const vm         = this.getView().getModel("viewModel");
            const canEdit    = vm.getProperty("/canEdit");
            const today      = this._toISODate(new Date());
            const yesterday  = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();
            const weekDays   = this._getWeekDays();
            const isView     = vm.getProperty("/isViewingPrevWeek");
            const vid        = this.getView().getId();

            // Clear rows container
            const rowsContainer = this._clearContainer("timesheetRowsContainer");
            if (!rowsContainer) return;

            // Destroy old HTML control (prevents ID conflict on re-render)
            const tableId  = vid + "--tsTable";
            const oldTable = sap.ui.getCore().byId(tableId);
            if (oldTable) oldTable.destroy();

            // Hide static XML header/totals rows (table renders its own)
            const dayHeaderRow   = this.byId("dayHeaderRow");
            const dailyTotalsRow = this.byId("dailyTotalsRow");
            if (dayHeaderRow)   dayHeaderRow.setVisible(false);
            if (dailyTotalsRow) dailyTotalsRow.setVisible(false);

            // ── <thead> ───────────────────────────────────────────────────
            let thead = '<thead><tr style="background:#f5f6f7;border-bottom:2px solid #d9d9d9;">';
            thead += '<th style="width:220px;padding:10px 12px;text-align:left;font-weight:700;'
                   + 'font-size:0.9rem;color:#32363a;border-right:1px solid #e5e5e5;">'
                   + 'Project / Task</th>';

            weekDays.forEach(function (dateStr, idx) {
                const isSun      = idx === 6;
                const isToday    = dateStr === today    && !isView;
                const isYest     = dateStr === yesterday  && !isView;
                const isTwoDays  = dateStr === twoDaysAgo && !isView;
                const bg = isToday   ? "#dbeeff"
                         : (isYest || isTwoDays) ? "#f0faf0"
                         : isSun     ? "#fafafa"
                         : "transparent";
                const col = isToday ? "#0854a0" : "#6a6d70";
                const fw  = isToday ? "700" : "500";

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
                    const isSun     = dayIdx === 6;
                    const isToday   = dateStr === today    && !isView;
                    const isYest    = dateStr === yesterday  && !isView;
                    const isTwoDays = dateStr === twoDaysAgo && !isView;
                    const bg = isToday   ? "#dbeeff"
                             : (isYest || isTwoDays) ? "#f0faf0"
                             : isSun     ? "#f5f5f5"
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
                       + (rowTotal > 0 ? rowTotal : 0) + '</td>';
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
                    dayTotal   = parseFloat(dayTotal.toFixed(2));
                    weekTotal += dayTotal;
                }
                tbody += '<td style="padding:8px 6px;text-align:center;'
                       + 'border-right:1px solid #e5e5e5;color:'
                       + (dayTotal > 8 ? "#bb0000" : "#32363a") + ';" id="'
                       + vid + '--dayTotal_' + idx + '">'
                       + (isSun ? '\u2014' : dayTotal) + '</td>';
            }.bind(this));

            tbody += '<td style="padding:8px 8px;text-align:center;color:#32363a;" id="'
                   + vid + '--weekTotal">'
                   + parseFloat(weekTotal.toFixed(2)) + '</td>';
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
            const self     = this;
            const injected = { done: false };

            const htmlControl = new HTML(tableId, {
                content:        completeHtml,
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
            const vid        = this.getView().getId();
            const yesterday  = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();

            this._rows.forEach(function (row, rowIdx) {

                // ── Task Select ───────────────────────────────────────────
                const taskSpan = document.getElementById(vid + "--taskCell_" + rowIdx);
                if (taskSpan) {
                    const sel = new Select({
                        width:       "100%",
                        selectedKey: row.taskId || "",
                        enabled:     !!canEdit,
                        change: function (evt) {
                            this._rows[rowIdx].taskId   = evt.getParameter("selectedItem").getKey();
                            this._rows[rowIdx].taskName = evt.getParameter("selectedItem").getText();
                            this._recalcTotals(weekDays);
                        }.bind(this)
                    });
                    sel.addItem(new Item({ key: "", text: "-- Select Task --" }));
                    this._tasks.forEach(function (t) {
                        sel.addItem(new Item({ key: t.taskId, text: t.taskName }));
                    });
                    sel.placeAt(taskSpan);
                    this._injectedControls.push(sel);
                }

                // ── Hour Inputs ───────────────────────────────────────────
                weekDays.forEach(function (dateStr, dayIdx) {
                    if (dayIdx === 6) return; // Sunday — no input

                    const span = document.getElementById(
                        vid + "--inputCell_" + rowIdx + "_" + dayIdx
                    );
                    if (!span) return;

                    const isLocked = row.locked[dateStr] === true;
                    let   editable = false;

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

                    const existingVal = row.entries[dateStr];
                    const inp = new Input({
                        value:       existingVal != null ? String(existingVal) : "",
                        editable:    !!editable,
                        width:       "100%",
                        type:        "Number",
                        placeholder: editable ? "0" : "",
                        liveChange:  function (evt) {
                            const val = parseFloat(evt.getParameter("newValue")) || 0;
                            if (val < 0 || val > 24) {
                                evt.getSource().setValueState("Error");
                                evt.getSource().setValueStateText("Enter a value between 0 and 24");
                                return;
                            }
                            evt.getSource().setValueState("None");
                            if (!this._rows[rowIdx].entries) this._rows[rowIdx].entries = {};
                            this._rows[rowIdx].entries[dateStr] = val;
                            this._recalcTotals(weekDays);

                            // Update canSubmit
                            const vm2 = this.getView().getModel("viewModel");
                            const has = this._rows.some(function (r) {
                                return r.taskId &&
                                    Object.values(r.entries).some(function (h) { return h > 0; });
                            });
                            vm2.setProperty("/canSubmit", !!has);
                        }.bind(this)
                    });
                    inp.placeAt(span);
                    this._injectedControls.push(inp);
                }.bind(this));

            }.bind(this));
        },

        // ── Update totals by writing directly to DOM cells ────────────────────
        _recalcTotals: function (weekDays) {
            const wd  = weekDays || this._getWeekDays();
            const vid = this.getView().getId();
            let weekTotal = 0;

            wd.forEach(function (dateStr, idx) {
                if (idx === 6) return;
                let dayTotal = 0;
                this._rows.forEach(function (r) {
                    dayTotal += parseFloat(r.entries[dateStr] || 0);
                });
                dayTotal   = parseFloat(dayTotal.toFixed(2));
                weekTotal += dayTotal;

                const dc = document.getElementById(vid + "--dayTotal_" + idx);
                if (dc) {
                    dc.textContent = dayTotal;
                    dc.style.color = dayTotal > 8 ? "#bb0000" : "#32363a";
                }
            }.bind(this));

            // Row totals
            this._rows.forEach(function (row, rowIdx) {
                const rt   = this._calcRowTotal(row, wd);
                const rtEl = document.getElementById(vid + "--rowTotal_" + rowIdx);
                if (rtEl) rtEl.textContent = rt;
            }.bind(this));

            // Week total
            const wt = document.getElementById(vid + "--weekTotal");
            if (wt) wt.textContent = parseFloat(weekTotal.toFixed(2));
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
        // ADD ROW
        // Appends directly to existing table DOM — does NOT call _renderGrid
        // (calling _renderGrid would trigger afterRendering again → duplicate rows)
        // ══════════════════════════════════════════════════════════════════════
        onAddRow: function () {
            const rowIdx     = this._rows.length;
            const weekDays   = this._getWeekDays();
            const vm         = this.getView().getModel("viewModel");
            const canEdit    = vm.getProperty("/canEdit");
            const today      = this._toISODate(new Date());
            const yesterday  = this._getYesterday();
            const twoDaysAgo = this._getTwoDaysAgo();
            const isView     = vm.getProperty("/isViewingPrevWeek");
            const vid        = this.getView().getId();

            // Add empty row to data model
            this._rows.push({ taskId: null, taskName: null, entries: {}, locked: {} });

            // Find tbody of existing table
            const rowsContainerDom = this.byId("timesheetRowsContainer").getDomRef();
            if (!rowsContainerDom) return;
            const tbody    = rowsContainerDom.querySelector("tbody");
            if (!tbody)    return;
            const totalRow = tbody.querySelector("tr:last-child"); // daily totals row

            // Build new <tr>
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #e5e5e5";

            // Task cell
            const taskTd   = document.createElement("td");
            taskTd.style.cssText =
                "padding:6px 8px;border-right:1px solid #e5e5e5;vertical-align:middle;min-width:220px;";
            const taskSpan = document.createElement("span");
            taskSpan.id    = vid + "--taskCell_" + rowIdx;
            taskTd.appendChild(taskSpan);
            tr.appendChild(taskTd);

            // Day cells
            weekDays.forEach(function (dateStr, dayIdx) {
                const isSun     = dayIdx === 6;
                const isToday   = dateStr === today    && !isView;
                const isYest    = dateStr === yesterday  && !isView;
                const isTwoDays = dateStr === twoDaysAgo && !isView;
                const bg = isToday   ? "#dbeeff"
                         : (isYest || isTwoDays) ? "#f0faf0"
                         : isSun     ? "#f5f5f5"
                         : "transparent";

                const td = document.createElement("td");
                td.style.cssText =
                    "padding:4px 6px;text-align:center;background:" + bg +
                    ";border-right:1px solid #e5e5e5;vertical-align:middle;";

                if (isSun) {
                    td.innerHTML = '<span style="color:#bbb;font-size:1rem;">\u2014</span>';
                } else {
                    const span = document.createElement("span");
                    span.id    = vid + "--inputCell_" + rowIdx + "_" + dayIdx;
                    td.appendChild(span);
                }
                tr.appendChild(td);
            }.bind(this));

            // Row total cell
            const totalTd         = document.createElement("td");
            totalTd.style.cssText =
                "padding:6px 8px;text-align:center;font-weight:600;vertical-align:middle;color:#32363a;";
            totalTd.id            = vid + "--rowTotal_" + rowIdx;
            totalTd.textContent   = "0";
            tr.appendChild(totalTd);

            // Insert before the daily totals row
            tbody.insertBefore(tr, totalRow);

            // ── Inject SAP Select for new row ─────────────────────────────
            const taskSpanEl = document.getElementById(vid + "--taskCell_" + rowIdx);
            if (taskSpanEl) {
                const sel = new Select({
                    width:       "100%",
                    selectedKey: "",
                    enabled:     !!canEdit,
                    change: function (evt) {
                        this._rows[rowIdx].taskId   = evt.getParameter("selectedItem").getKey();
                        this._rows[rowIdx].taskName = evt.getParameter("selectedItem").getText();
                        this._recalcTotals(weekDays);
                    }.bind(this)
                });
                sel.addItem(new Item({ key: "", text: "-- Select Task --" }));
                this._tasks.forEach(function (t) {
                    sel.addItem(new Item({ key: t.taskId, text: t.taskName }));
                }.bind(this));
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

                const inp = new Input({
                    value:       "",
                    editable:    !!editable,
                    width:       "100%",
                    type:        "Number",
                    placeholder: editable ? "0" : "",
                    liveChange: function (evt) {
                        const val = parseFloat(evt.getParameter("newValue")) || 0;
                        if (val < 0 || val > 24) {
                            evt.getSource().setValueState("Error");
                            evt.getSource().setValueStateText("Enter a value between 0 and 24");
                            return;
                        }
                        evt.getSource().setValueState("None");
                        if (!this._rows[rowIdx].entries) this._rows[rowIdx].entries = {};
                        this._rows[rowIdx].entries[dateStr] = val;
                        this._recalcTotals(weekDays);
                        const vm2 = this.getView().getModel("viewModel");
                        const has = this._rows.some(function (r) {
                            return r.taskId &&
                                Object.values(r.entries).some(function (h) { return h > 0; });
                        });
                        vm2.setProperty("/canSubmit", !!has);
                    }.bind(this)
                });
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
            let   hasMissed  = false;

            weekDays.forEach(function (dateStr, idx) {
                if (idx === 6)        return; // skip Sunday (holiday)
                if (dateStr >= today) return; // skip today and future days

                // Yesterday and 2 days ago are directly editable — skip
                if (dateStr === yesterday || dateStr === twoDaysAgo) return;

                // Check if this day has any hours filled
                const dayTotal = this._rows.reduce(function (sum, r) {
                    return sum + parseFloat(r.entries[dateStr] || 0);
                }, 0);
                if (dayTotal > 0) return; // already filled

                const req = this._dayUnlockReqs[dateStr];
                let buttonEnabled, buttonText, buttonType;
                let statusText = null;

                if (!req) {
                    // No request yet — show request button
                    buttonEnabled = true;
                    buttonText    = "Request HR Approval \u2014 " +
                                   DAY_LABELS[idx] + ", " +
                                   this._formatDisplayDate(dateStr);
                    buttonType    = "Attention";
                } else if (req.status === "Pending") {
                    buttonEnabled = false;
                    buttonText    = "Request Sent \u2014 " + this._formatDisplayDate(dateStr);
                    buttonType    = "Default";
                    statusText    = "HR Approval Pending for " + this._formatDisplayDate(dateStr);
                } else if (req.status === "Approved") {
                    return; // cell is now editable directly
                } else if (req.status === "Rejected") {
                    buttonEnabled = true;
                    buttonText    = "Re-request HR Approval \u2014 " +
                                   DAY_LABELS[idx] + ", " +
                                   this._formatDisplayDate(dateStr);
                    buttonType    = "Negative";
                    statusText    = "HR request rejected for " + this._formatDisplayDate(dateStr);
                } else {
                    return;
                }

                hasMissed = true;

                const rowBox = new HBox({ alignItems: "Center" });
                rowBox.addStyleClass("sapUiSmallMarginBottom");

                if (statusText) {
                    const os = new ObjectStatus({
                        text:  statusText,
                        state: (req && req.status === "Rejected") ? "Error" : "Warning"
                    });
                    os.addStyleClass("sapUiSmallMarginEnd");
                    rowBox.addItem(os);
                }

                const btn = new Button({
                    text:    buttonText,
                    type:    buttonType,
                    icon:    "sap-icon://approvals",
                    enabled: !!buttonEnabled,
                    press:   (function (d) {
                        return function () { this._openHRUnlockDialog(d); }.bind(this);
                    }.bind(this))(dateStr)
                });
                rowBox.addItem(btn);
                container.addItem(rowBox);
            }.bind(this));

            if (hasMissed) {
                const lbl = new Label({
                    text:   "\u26A0\uFE0F Missed Days \u2014 HR Approval Required",
                    design: "Bold"
                });
                lbl.addStyleClass("sapUiSmallMarginTop sapUiSmallMarginBottom");
                container.insertItem(lbl, 0);
            }
        },

        // ══════════════════════════════════════════════════════════════════════
        // HR UNLOCK DIALOG
        // ══════════════════════════════════════════════════════════════════════
        _openHRUnlockDialog: async function (dateStr) {
            this._hrUnlockTargetDate = dateStr;

            const hrModel = this.getView().getModel("hrUnlockModel");
            hrModel.setProperty("/targetDate",      dateStr);
            hrModel.setProperty("/selectedHrId",    "");
            hrModel.setProperty("/employeeRemarks", "");

            // Load HR list on first open
            const hrListModel = this.getView().getModel("hrListModel");
            if (!hrListModel.getProperty("/hrEmployees").length) {
                await this._loadHREmployees();
            }

            this.byId("hrUnlockDialog").open();
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
                            employeeId:   e.employeeId,
                            employeeName: e.employeeName,
                            designation:  e.designation,
                            department:   e.department
                        };
                    })
                );
            } catch (e) {
                MessageBox.error("Could not load HR list: " + (e.message || e));
            }
        },

        onSubmitHRUnlockRequest: async function () {
            const hrId    = this.byId("hrApproverSelect").getSelectedKey();
            const hrModel = this.getView().getModel("hrUnlockModel");

            if (!hrId) {
                MessageBox.warning("Please select an HR approver.");
                return;
            }

            try {
                this.getView().setBusy(true);
                await this._callAction(BASE_URL + "/requestDayUnlock", {
                    targetDate:      this._hrUnlockTargetDate,
                    hrApproverId:    hrId,
                    employeeRemarks: hrModel.getProperty("/employeeRemarks")
                });
                MessageToast.show("HR unlock request sent successfully!");
                this.byId("hrUnlockDialog").close();
                await this._loadTimesheetData();
            } catch (e) {
                MessageBox.error("Failed to send HR unlock request: " + (e.message || e));
            } finally {
                this.getView().setBusy(false);
            }
        },

        onCloseHRUnlockDialog: function () {
            this.byId("hrUnlockDialog").close();
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

            this.byId("prevWeekDialog").open();
        },

        onConfirmPrevWeekRequest: async function () {
            const remarks = this.getView().getModel("prevWeekModel")
                .getProperty("/employeeRemarks");
            try {
                this.getView().setBusy(true);
                await this._callAction(BASE_URL + "/requestPrevWeekFill", {
                    weekStartDate:   this._prevWeekStartDate,
                    weekEndDate:     this._prevWeekEndDate,
                    employeeRemarks: remarks
                });
                MessageToast.show("Approval request sent to your manager!");
                this.byId("prevWeekDialog").close();
                await this._loadTimesheetData();
            } catch (e) {
                MessageBox.error("Failed to send request: " + (e.message || e));
            } finally {
                this.getView().setBusy(false);
            }
        },

        onClosePrevWeekDialog: function () {
            this.byId("prevWeekDialog").close();
        },

        // ══════════════════════════════════════════════════════════════════════
        // WEEK NAVIGATION
        // ══════════════════════════════════════════════════════════════════════
        onSwitchToPrevWeek: function () {
            const vm = this.getView().getModel("viewModel");
            vm.setProperty("/isViewingPrevWeek", true);
            this._weekStartDate = this._prevWeekStartDate;
            this._weekEndDate   = this._prevWeekEndDate;
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
                        timesheetId:   this._timesheetId,
                        weekStartDate: this._weekStartDate,
                        weekEndDate:   this._weekEndDate,
                        isPrevWeek:    !!vm.getProperty("/isViewingPrevWeek"),
                        entries:       JSON.stringify(validEntries)
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
            const vm            = this.getView().getModel("viewModel");
            const isViewingPrev = vm.getProperty("/isViewingPrevWeek");

            // Block submit before Friday for current week
            if (!isViewingPrev) {
                const dayOfWeek = new Date().getDay(); // 0=Sun ... 5=Fri ... 6=Sat
                if (dayOfWeek < 5) {
                    const names    = ["Sunday","Monday","Tuesday","Wednesday",
                                      "Thursday","Friday","Saturday"];
                    const daysLeft = 5 - dayOfWeek;
                    MessageBox.warning(
                        "You can only submit the weekly timesheet on Friday or later.\n\n" +
                        "Today is " + names[dayOfWeek] + " \u2014 " +
                        daysLeft + " day" + (daysLeft > 1 ? "s" : "") + " until Friday."
                    );
                    return;
                }
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
                actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: async function (action) {
                    if (action !== MessageBox.Action.OK) return;
                    try {
                        this.getView().setBusy(true);

                        // Save first, then submit
                        await this._callAction(BASE_URL + "/saveTimesheetEntries", {
                            timesheetId:   this._timesheetId,
                            weekStartDate: this._weekStartDate,
                            weekEndDate:   this._weekEndDate,
                            isPrevWeek:    !!isViewingPrev,
                            entries:       JSON.stringify(validEntries)
                        });

                        const msg = await this._callAction(
                            BASE_URL + "/submitTimesheetWeek", {
                                timesheetId: this._timesheetId,
                                isPrevWeek:  !!isViewingPrev
                            }
                        );

                        MessageBox.success(
                            typeof msg === "string"
                                ? msg
                                : "Timesheet submitted successfully!",
                            {
                                onClose: function () {
                                    this._loadTimesheetData();
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
                    timesheetId:   this._timesheetId,
                    weekStartDate: this._weekStartDate,
                    weekEndDate:   this._weekEndDate
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
                if (!row.taskId) return;
                Object.entries(row.entries).forEach(function (pair) {
                    const dateStr = pair[0];
                    const hours   = pair[1];
                    if (hours > 0) {
                        entries.push({
                            taskId:      row.taskId,
                            workDate:    dateStr,
                            hoursWorked: hours,
                            description: ""
                        });
                    }
                });
            });
            return entries;
        },

        _callAction: async function (url, payload) {
            const resp = await fetch(url, {
                method:  "POST",
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
                    method:  "GET",
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