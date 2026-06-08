// ─────────────────────────────────────────────────────────────────────────────
// FILE: webapp/controller/History.controller.js
// Shows timesheet history using the same HTML table style as Timesheet.view
// Read-only — no editing, no save/submit
// ─────────────────────────────────────────────────────────────────────────────
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/HTML"
], function (Controller, JSONModel, MessageToast, HTML) {
    "use strict";

    const BASE_URL = "/employee";
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const STATUS_COLORS = {
        "Approved": { bg: "#e8f5e9", color: "#2e7d32", label: "Approved" },
        "Pending": { bg: "#fff8e1", color: "#f57f17", label: "Pending Approval" },
        "Rejected": { bg: "#ffebee", color: "#c62828", label: "Rejected" },
        "PrevWeekApproved": { bg: "#e8f5e9", color: "#2e7d32", label: "Approved" },
        "Draft": { bg: "#f5f5f5", color: "#616161", label: "Draft" },
        "None": { bg: "#f5f5f5", color: "#616161", label: "Not Submitted" }
    };

    function getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function toISODate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + d;
    }

    function toShortLabel(date) {
        return date.getDate() + " " + MONTHS[date.getMonth()];
    }

    return Controller.extend("timesheet.app.controller.History", {

        onInit: function () {
            this._oHistViewModel = new JSONModel({
                selectedWeekLabel: "",
                weekSelected: false,
                hasData: false,
                status: "",
                statusLabel: "",
                statusBg: "",
                statusColor: "",
                days: [
                    { name: "Mon", date: "" }, { name: "Tue", date: "" },
                    { name: "Wed", date: "" }, { name: "Thu", date: "" },
                    { name: "Fri", date: "" }, { name: "Sat", date: "" },
                    { name: "Sun", date: "" }
                ]
            });
            this.getView().setModel(this._oHistViewModel, "histView");
            this._csrfToken = null;
            this._histHtmlControlId = null;

            // Block future dates on calendar
            this.getView().addEventDelegate({
                onAfterRendering: function () {
                    const oCal = this.byId("histCenterCalendar");
                    if (oCal && oCal.setMaxDate) {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        oCal.setMaxDate(today);
                    }
                }.bind(this)
            });

            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("history").attachPatternMatched(function () {
                // Reset to calendar picker every time user navigates to this page
                this._oHistViewModel.setProperty("/weekSelected", false);
                this._oHistViewModel.setProperty("/hasData", false);
                this._clearHistTable();
                const oCal = this.byId("histCenterCalendar");
                if (oCal) oCal.removeAllSelectedDates();
            }.bind(this));
        },

        // ── Calendar toggle — go back to picker ──────────────────────────────
        onCalendarToggle: function () {
            this._oHistViewModel.setProperty("/weekSelected", false);
            const oCal = this.byId("histCenterCalendar");
            if (oCal) oCal.removeAllSelectedDates();
            this._clearHistTable();
        },

        // ── User picks a date ─────────────────────────────────────────────────
        onCalendarSelect: function (oEvent) {
            const oCal = oEvent.getSource();
            const aDates = oCal.getSelectedDates();
            if (!aDates || !aDates.length) return;

            const oStart = aDates[0].getStartDate();
            if (!oStart) return;

            const today = new Date(); today.setHours(0, 0, 0, 0);
            const currentWeek = getWeekStart(today);
            const pickedWeek = getWeekStart(new Date(oStart));

            if (pickedWeek.getTime() > currentWeek.getTime()) {
                MessageToast.show("Future weeks cannot be viewed.");
                oCal.removeAllSelectedDates();
                return;
            }

            this._oHistViewModel.setProperty("/weekSelected", true);
            this._loadWeekData(pickedWeek);
        },

        // ── Load from backend and render HTML table ───────────────────────────
        _loadWeekData: async function (weekStart) {
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const sWeekStart = toISODate(weekStart);
            const sWeekEnd = toISODate(weekEnd);
            const sLabel = toShortLabel(weekStart) + " \u2013 " + toShortLabel(weekEnd);

            this._oHistViewModel.setProperty("/selectedWeekLabel", sLabel);

            const view = this.getView();
            view.setBusy(true);

            try {
                const data = await this._callAction(BASE_URL + "/getTimesheetWeekData", {
                    weekStartDate: sWeekStart,
                    weekEndDate: sWeekEnd
                });

                const weekStatus = data.weekStatus || "None";
                const entries = JSON.parse(data.entries || "[]");
                const tasks = JSON.parse(data.tasks || "[]");

                // Status display config
                const sc = STATUS_COLORS[weekStatus] || STATUS_COLORS["None"];
                this._oHistViewModel.setProperty("/status", weekStatus);
                this._oHistViewModel.setProperty("/statusLabel", sc.label);
                this._oHistViewModel.setProperty("/statusBg", sc.bg);
                this._oHistViewModel.setProperty("/statusColor", sc.color);
                this._oHistViewModel.setProperty("/hasData", entries.length > 0);

                // Build week day dates array
                const weekDays = [];
                for (let i = 0; i < 7; i++) {
                    const d = new Date(weekStart);
                    d.setDate(weekStart.getDate() + i);
                    weekDays.push(toISODate(d));
                }

                // Build task lookup
                const taskMap = {};
                tasks.forEach(function (t) { taskMap[t.taskId] = t.taskName; });

                // Group entries — one row per task. Custom ("Others") entries have
                // no taskId, so group them by their free text and flag them.
                const rowMap = {};
                entries.forEach(function (e) {
                    const isCustom = !!e.isCustomTask;
                    const key = isCustom ? ("__custom__" + (e.customTaskText || "")) : e.task_taskId;
                    if (!rowMap[key]) {
                        rowMap[key] = {
                            taskName: isCustom ? (e.customTaskText || "Custom Task")
                                               : (taskMap[e.task_taskId] || e.task_taskId),
                            isCustom: isCustom,
                            entries: {}
                        };
                    }
                    rowMap[key].entries[e.workDate] = e.hoursWorked;
                });

                const rows = Object.values(rowMap);

                // Render the HTML table
                this._renderHistTable(weekDays, weekStart, rows, weekStatus, sc, sLabel);

            } catch (e) {
                MessageToast.show("Failed to load: " + (e.message || e));
                this._oHistViewModel.setProperty("/hasData", false);
                this._clearHistTable();
            } finally {
                view.setBusy(false);
            }
        },

        // ── Build the same styled HTML table as Timesheet ─────────────────────
        _renderHistTable: function (weekDays, weekStart, rows, weekStatus, sc, sLabel) {
            const container = this.byId("histTableContainer");
            if (!container) return;

            // Destroy old HTML control
            container.destroyItems();
            if (this._histHtmlControlId) {
                const old = sap.ui.getCore().byId(this._histHtmlControlId);
                if (old) old.destroy();
            }

            const today = toISODate(new Date());
            const ctrlId = this.getView().getId() + "--histHtmlTable";
            this._histHtmlControlId = ctrlId;

            // ── Status badge ──────────────────────────────────────────────
            const statusHtml =
                '<div style="display:flex;align-items:center;justify-content:space-between;'
                + 'margin-bottom:12px;">'
                + '<span style="font-size:0.95rem;color:#6a6d70;">' + sLabel + '</span>'
                + '<span style="padding:4px 14px;border-radius:20px;font-size:0.82rem;'
                + 'font-weight:600;background:' + sc.bg + ';color:' + sc.color + ';">'
                + sc.label + '</span>'
                + '</div>';

            // ── <thead> ───────────────────────────────────────────────────
            let thead = '<thead><tr style="background:#f5f6f7;border-bottom:2px solid #d9d9d9;">';
            thead += '<th style="width:220px;padding:10px 12px;text-align:left;font-weight:700;'
                + 'font-size:0.9rem;color:#32363a;border-right:1px solid #e5e5e5;">'
                + 'Project / Task</th>';

            weekDays.forEach(function (dateStr, idx) {
                const isSun = idx === 6;
                const isToday = dateStr === today;
                const bg = isToday ? "#dbeeff" : isSun ? "#fafafa" : "transparent";
                const col = isToday ? "#0854a0" : "#6a6d70";
                const fw = isToday ? "700" : "500";

                const d = new Date(dateStr + "T00:00:00");
                const dateDisp = d.getDate() + " " + MONTHS[d.getMonth()];

                thead += '<th style="width:110px;padding:10px 8px;text-align:center;background:'
                    + bg + ';border-right:1px solid #e5e5e5;">'
                    + '<div style="font-weight:' + fw + ';font-size:0.8rem;color:#32363a;">'
                    + DAY_NAMES[idx] + '</div>'
                    + '<div style="font-size:0.75rem;color:' + col + ';font-weight:' + fw + ';">'
                    + dateDisp + '</div>'
                    + (isSun ? '<div style="font-size:0.7rem;color:#a0a0a0;">Holiday</div>' : '')
                    + '</th>';
            });

            thead += '<th style="width:80px;padding:10px 8px;text-align:center;font-weight:700;'
                + 'font-size:0.9rem;color:#32363a;">Total</th></tr></thead>';

            // ── <tbody> data rows ─────────────────────────────────────────
            let tbody = '<tbody>';
            let weekTotal = 0;

            if (rows.length === 0) {
                tbody += '<tr><td colspan="9" style="padding:24px;text-align:center;'
                    + 'color:#6a6d70;font-size:0.875rem;">No entries found for this week.</td></tr>';
            } else {
                rows.forEach(function (row) {
                    let rowTotal = 0;
                    tbody += '<tr style="border-bottom:1px solid #e5e5e5;">';
                    // Escape the (possibly user-entered) task name before injecting.
                    const esc = String(row.taskName || "").replace(/[&<>"]/g, function (c) {
                        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
                    });
                    const tip = "This task was entered by the employee and was not assigned by a manager.";
                    const nameHtml = row.isCustom
                        ? '<span style="color:#6d28d9;font-weight:600;" title="' + tip + '">' + esc + '</span>'
                          + ' <span style="display:inline-block;background:#ede9fe;color:#6d28d9;'
                          + 'font-size:0.62rem;font-weight:700;padding:1px 8px;border-radius:10px;" title="' + tip + '">'
                          + 'Custom Task</span>'
                        : esc;
                    tbody += '<td style="padding:10px 12px;border-right:1px solid #e5e5e5;'
                        + 'font-size:0.875rem;color:#32363a;font-weight:500;">'
                        + nameHtml + '</td>';

                    weekDays.forEach(function (dateStr, idx) {
                        const isSun = idx === 6;
                        const isToday = dateStr === today;
                        const bg = isToday ? "#dbeeff" : isSun ? "#f5f5f5" : "transparent";
                        const hours = row.entries[dateStr];
                        const display = isSun ? "\u2014"
                            : (hours != null && hours > 0 ? hours : "");

                        rowTotal += (!isSun && hours) ? parseFloat(hours) : 0;

                        const cellColor = (!isSun && hours > 0) ? "#32363a" : "#aaa";
                        const cellFw = (!isSun && hours > 0) ? "500" : "400";

                        tbody += '<td style="padding:10px 8px;text-align:center;background:'
                            + bg + ';border-right:1px solid #e5e5e5;color:' + cellColor
                            + ';font-weight:' + cellFw + ';font-size:0.875rem;">'
                            + display + '</td>';
                    });

                    rowTotal = parseFloat(rowTotal.toFixed(2));
                    weekTotal += rowTotal;

                    tbody += '<td style="padding:10px 8px;text-align:center;font-weight:600;'
                        + 'color:#32363a;font-size:0.875rem;">'
                        + (rowTotal > 0 ? rowTotal : 0) + '</td>';
                    tbody += '</tr>';
                });
            }

            // ── Daily totals row ──────────────────────────────────────────
            tbody += '<tr style="background:#f5f6f7;border-top:2px solid #d9d9d9;font-weight:700;">';
            tbody += '<td style="padding:10px 12px;border-right:1px solid #e5e5e5;'
                + 'font-size:0.875rem;color:#32363a;">Daily Total</td>';

            weekDays.forEach(function (dateStr, idx) {
                const isSun = idx === 6;
                let dayTotal = 0;
                if (!isSun) {
                    rows.forEach(function (r) {
                        dayTotal += parseFloat(r.entries[dateStr] || 0);
                    });
                }
                dayTotal = parseFloat(dayTotal.toFixed(2));
                const col = dayTotal > 8 ? "#bb0000" : "#32363a";

                tbody += '<td style="padding:10px 8px;text-align:center;'
                    + 'border-right:1px solid #e5e5e5;color:' + col + ';">'
                    + (isSun ? "\u2014" : dayTotal) + '</td>';
            });

            weekTotal = parseFloat(weekTotal.toFixed(2));
            tbody += '<td style="padding:10px 8px;text-align:center;color:#32363a;">'
                + weekTotal + '</td>';
            tbody += '</tr></tbody>';

            // ── Assemble full HTML ────────────────────────────────────────
            const completeHtml =
                '<div style="width:100%;">'
                + statusHtml
                + '<div style="width:100%;overflow-x:auto;border-radius:6px;'
                + 'box-shadow:0 1px 4px rgba(0,0,0,0.1);">'
                + '<table style="width:100%;border-collapse:collapse;'
                + 'border:1px solid #d9d9d9;font-family:inherit;font-size:0.875rem;">'
                + thead + tbody
                + '</table></div></div>';

            const htmlCtrl = new HTML(ctrlId, { content: completeHtml });
            container.addItem(htmlCtrl);
        },

        _clearHistTable: function () {
            const container = this.byId("histTableContainer");
            if (container) container.destroyItems();
        },

        // ── HTTP helpers ──────────────────────────────────────────────────────
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
                let msg = "HTTP " + resp.status;
                try {
                    const e = await resp.json();
                    msg = (e.error && e.error.message) || msg;
                } catch (_) { }
                throw new Error(msg);
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