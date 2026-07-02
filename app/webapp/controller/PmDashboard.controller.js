sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    var CHARTJS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function money(n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); }
    function moneyC(n) { n = Number(n) || 0; var a = Math.abs(n); if (a >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr"; if (a >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L"; if (a >= 1e3) return "₹" + (n / 1e3).toFixed(1) + " K"; return "₹" + n; }
    function healthColor(h) { return h >= 76 ? "#34d399" : h >= 51 ? "#fbbf24" : "#fb7185"; }
    function utilColor(u) { return u > 100 ? "#fb7185" : u >= 90 ? "#fbbf24" : u >= 70 ? "#34d399" : "#38bdf8"; }
    function sevColor(s) { return s === "Critical" ? "#fb7185" : s === "High" ? "#fb923c" : s === "Medium" ? "#fbbf24" : "#38bdf8"; }
    function prioColor(p) { return p === "Critical" ? "#fb7185" : p === "High" ? "#fb923c" : p === "Medium" ? "#fbbf24" : "#9fb0d6"; }

    return Controller.extend("timesheet.app.controller.PmDashboard", {
        onInit: function () {
            this._charts = [];
            this._pid = null;
            this._data = null;
            window._pmCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("pm-dashboard").attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { this._destroyCharts(); if (window._pmCtrl === this) window._pmCtrl = null; },
        _onMatched: function (e) {
            this._pid = e.getParameter("arguments").projectId;
            this._loadChartJs();
            this._refresh();
        },
        _host: function () { return this.byId("pmHost"); },
        _call: function (action, params) {
            return fetch("/project/" + action, { method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(params || {}) })
                .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
                .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
        },

        _refresh: function () {
            var that = this;
            this._call("getPmDashboard", { projectId: this._pid }).then(function (d) {
                if (!d || d.error) { that._renderDenied(d); return; }
                that._data = d; that._render();
            }).catch(function (e) {
                var m = (e && e.message) || "network error";
                var hint = /404/.test(m) ? "The dashboard service isn't registered yet — restart the server (cds watch)." : m;
                that._renderDenied({ error: "Could not load the project dashboard.", detail: hint });
            });
        },
        _renderDenied: function (d) {
            var h = this._host(); if (!h) return;
            var msg = (d && d.error) || "You are not authorized to access this project.";
            var detail = (d && d.detail) ? "<div class='pmDeniedDetail'>" + esc(d.detail) + "</div>" : "";
            h.setContent("<div class='fpaRoot pmDash'><div class='pmDenied'><div class='pmDeniedIcon'>🔒</div>" +
                "<div class='pmDeniedMsg'>" + esc(msg) + "</div>" + detail +
                "<button class='fpaExpBtn' onclick=\"window._pmCtrl.onBack()\">← Back to Projects</button></div></div>");
        },
        onBack: function () { try { this.getOwnerComponent().getRouter().navTo("projects"); } catch (e) { /* */ } },
        // Deep-link into the existing project workspace (all CRUD lives there).
        onOpenWorkspace: function () {
            var comp = this.getOwnerComponent();
            comp._openProjectId = this._pid;
            try { comp.getRouter().navTo("projects"); } catch (e) { /* */ }
        },
        onRefresh: function () { this._refresh(); },

        _render: function () {
            var d = this._data;
            var html = "<div class='fpaRoot pmDash'>" + this._header(d) + "<div class='fpaWrap'>" +
                this._summary(d) + this._overview(d) + this._chartsSection() + this._tasks(d) +
                this._resources(d) + this._milestones(d) + this._budget(d) + this._issues(d) +
                this._meetingsApprovals(d) + "</div></div>";
            var h = this._host(); if (!h) return;
            h.setContent(html);
            var that = this;
            setTimeout(function () { that._initCharts(); }, 60);
        },

        _header: function (d) {
            var o = d.overview;
            return "<div class='fpaHeader'><div class='fpaTitle'>" +
                "<div class='fcCrumb'>Projects <span>›</span> <b>" + esc(o.projectName) + "</b></div>" +
                "<div class='fpaH1'>" + esc(o.projectName) + "</div>" +
                "<div class='fpaH2'>Project Manager Dashboard · " + esc(o.clientName) + " · " + esc(o.projectType) + "</div></div>" +
                "<div class='fpaFilters'>" +
                "<button class='fpaSel' onclick=\"window._pmCtrl.onRefresh()\">⟳ Refresh</button>" +
                "<button class='fpaExpBtn' onclick=\"window._pmCtrl.onOpenWorkspace()\">Open Project Workspace</button>" +
                "</div></div>";
        },

        _kpi: function (label, value, sub, color) {
            return "<div class='fpaKpi'><div class='fpaKpiL'>" + esc(label) + "</div>" +
                "<div class='fpaKpiV'" + (color ? " style='color:" + color + "'" : "") + ">" + value + "</div>" +
                (sub ? "<div class='fpaKpiSub'>" + esc(sub) + "</div>" : "") + "</div>";
        },
        _summary: function (d) {
            var s = d.summary;
            var cards =
                this._kpi("Progress", s.progress + "%", "of tasks complete", "#38bdf8") +
                this._kpi("Health", s.healthScore + " / 100", s.healthLabel, healthColor(s.healthScore)) +
                this._kpi("Days Remaining", (s.daysRemaining == null ? "—" : s.daysRemaining), s.daysRemaining != null && s.daysRemaining < 0 ? "overdue" : "to end date", s.daysRemaining != null && s.daysRemaining < 0 ? "#fb7185" : "#c7d2e8") +
                this._kpi("Budget Utilization", s.budgetUtilizationPct + "%", "of approved budget", utilColor(s.budgetUtilizationPct)) +
                this._kpi("Resource Utilization", s.resourceUtilizationPct + "%", "avg team load", utilColor(s.resourceUtilizationPct)) +
                this._kpi("Open Risks", s.openRisks, "high / critical", s.openRisks ? "#fb7185" : "#34d399") +
                this._kpi("Open Issues", s.openIssues, "unresolved", s.openIssues ? "#fbbf24" : "#34d399") +
                this._kpi("Pending Approvals", s.pendingApprovals, "timesheets", s.pendingApprovals ? "#fbbf24" : "#34d399") +
                this._kpi("Upcoming Milestones", s.upcomingMilestones, "next up", "#a78bfa") +
                this._kpi("Pending Tasks", s.pendingTasks, "not complete", s.pendingTasks ? "#c7d2e8" : "#34d399");
            return "<div class='fpaKpiSection'><div class='fpaSecHead'>Project Summary</div><div class='pmKpiGrid'>" + cards + "</div></div>";
        },

        _overview: function (d) {
            var o = d.overview;
            var row = function (l, v) { return "<div class='fpaStat'><div class='fpaStatL'>" + esc(l) + "</div><div class='fpaStatV'>" + esc(v == null || v === "" ? "—" : v) + "</div></div>"; };
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Project Overview</div><div class='fpaStatGrid pmOverview'>" +
                row("Project Name", o.projectName) + row("Client", o.clientName) + row("Project Type", o.projectType) +
                row("Status", o.status) + row("Start Date", String(o.startDate || "").slice(0, 10)) + row("End Date", String(o.endDate || "").slice(0, 10)) +
                row("Duration", o.durationDays ? o.durationDays + " days" : "—") + row("Project POC", o.poc) +
                row("Delivery Manager", o.deliveryManager) + row("Team Size", o.teamSize) +
                "</div></div>";
        },

        _chartCard: function (title, sub, id, cls) {
            return "<div class='fpaChartCard " + (cls || "") + "'><div class='fpaChartHead'><div class='fpaChartTitle'>" + esc(title) + "</div>" +
                (sub ? "<div class='fpaChartSub'>" + esc(sub) + "</div>" : "") + "</div><div class='fpaChartBox'><canvas id='" + id + "'></canvas></div></div>";
        },
        _chartsSection: function () {
            return "<div class='fpaChartSection'><div class='fpaSecHead'>Analytics</div><div class='fpaChartGrid'>" +
                this._chartCard("Task Status Distribution", "By status", "pm_taskStatus", "sm") +
                this._chartCard("Milestone Progress", "Completed vs remaining", "pm_milestones", "sm") +
                this._chartCard("Resource Utilization", "Allocation % per member", "pm_resUtil", "lg") +
                this._chartCard("Budget Consumption", "Utilized vs remaining", "pm_budget", "md") +
                this._chartCard("Risk / Issue Severity", "Open issues by severity", "pm_severity", "sm") +
                this._chartCard("Task Completion Trend", "Last 6 months", "pm_trend", "md") +
                "</div></div>";
        },

        _tasks: function (d) {
            var st = d.tasks.stats;
            var chip = function (l, v, c) { return "<span class='pmChip' style='border-color:" + c + "40'><b style='color:" + c + "'>" + v + "</b> " + l + "</span>"; };
            var rows = d.tasks.list.length ? d.tasks.list.map(function (t) {
                return "<tr><td><b style='color:#e6edf8'>" + esc(t.taskName) + "</b></td>" +
                    "<td style='color:#9fb0d6'>" + esc(t.assignedTo) + "</td>" +
                    "<td><span style='color:" + prioColor(t.priority) + ";font-weight:700;font-size:0.8rem'>" + esc(t.priority) + "</span></td>" +
                    "<td style='color:#c7d2e8'>" + esc(t.status) + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(t.dueDate || "").slice(0, 10) || "—") + "</td>" +
                    "<td><div class='fpaBar'><div class='fpaBarFill' style='width:" + t.completionPct + "%;background:#38bdf8'></div></div><span class='fpaBarPct'>" + t.completionPct + "%</span></td></tr>";
            }).join("") : "<tr><td colspan='6' style='text-align:center;color:#9fb0d6;padding:14px'>No tasks yet.</td></tr>";
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Task Management</div>" +
                "<div class='pmChips'>" + chip("Total", st.total, "#c7d2e8") + chip("Completed", st.completed, "#34d399") +
                chip("Pending", st.pending + st.inProgress + st.review, "#38bdf8") + chip("Overdue", st.overdue, "#fb7185") + chip("Blocked", st.blocked, "#fb923c") + "</div>" +
                "<div class='fpaTableWrap'><table class='fpaTable'><thead><tr><th>Task</th><th>Assigned To</th><th>Priority</th><th>Status</th><th>Due Date</th><th>Completion</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
        },

        _resources: function (d) {
            var r = d.resources;
            var chip = function (l, v, c) { return "<span class='pmChip' style='border-color:" + c + "40'><b style='color:" + c + "'>" + v + "</b> " + l + "</span>"; };
            var rows = r.list.length ? r.list.map(function (x) {
                return "<tr><td><b style='color:#e6edf8'>" + esc(x.employeeName) + "</b></td>" +
                    "<td style='color:#9fb0d6'>" + esc(x.role) + "</td><td style='color:#9fb0d6'>" + esc(x.department) + "</td>" +
                    "<td style='color:#c7d2e8'>" + x.allocationPct + "%</td>" +
                    "<td><span style='color:" + utilColor(x.utilizationPct) + ";font-weight:700'>" + x.utilizationPct + "%</span></td>" +
                    "<td style='color:#9fb0d6'>" + x.availabilityPct + "%</td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(x.startDate || "").slice(0, 10) || "—") + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(x.endDate || "").slice(0, 10) || "—") + "</td></tr>";
            }).join("") : "<tr><td colspan='8' style='text-align:center;color:#9fb0d6;padding:14px'>No resources allocated yet.</td></tr>";
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Resource Management</div>" +
                "<div class='pmChips'>" + chip("Total", r.total, "#c7d2e8") + chip("Available", r.available, "#38bdf8") +
                chip("Fully Utilized", r.fullyUtilized, "#fbbf24") + chip("Underutilized", r.underutilized, "#34d399") + chip("Overallocated", r.overallocated, "#fb7185") + "</div>" +
                "<div class='fpaTableWrap'><table class='fpaTable'><thead><tr><th>Resource</th><th>Role</th><th>Department</th><th>Allocation</th><th>Utilization</th><th>Availability</th><th>Start</th><th>End</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
        },

        _milestones: function (d) {
            var m = d.milestones;
            var rows = m.list.length ? m.list.map(function (x) {
                var col = x.done ? "#34d399" : x.delayed ? "#fb7185" : "#38bdf8";
                return "<tr><td><b style='color:#e6edf8'>" + esc(x.name) + "</b></td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(x.targetDate || "").slice(0, 10) || "—") + "</td>" +
                    "<td><span style='color:" + col + ";font-weight:700;font-size:0.8rem'>" + esc(x.status) + (x.delayed ? " · delayed" : "") + "</span></td>" +
                    "<td><div class='fpaBar'><div class='fpaBarFill' style='width:" + x.completionPct + "%;background:" + col + "'></div></div><span class='fpaBarPct'>" + x.completionPct + "%</span></td>" +
                    "<td style='color:#9fb0d6'>" + esc(x.owner) + "</td></tr>";
            }).join("") : "<tr><td colspan='5' style='text-align:center;color:#9fb0d6;padding:14px'>No milestones defined.</td></tr>";
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Milestones <span class='fpaCount'>Current: " + esc(m.currentPhase) + "</span></div>" +
                "<div class='fpaTableWrap'><table class='fpaTable'><thead><tr><th>Milestone</th><th>Target Date</th><th>Status</th><th>Completion</th><th>Owner</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
        },

        _budget: function (d) {
            var b = d.budget;
            var card = function (l, v, c) { return "<div class='fpaKpi'><div class='fpaKpiL'>" + l + "</div><div class='fpaKpiV' style='color:" + c + "'>" + v + "</div></div>"; };
            var deptRows = b.deptAllocation.length ? b.deptAllocation.map(function (x) {
                var pct = b.approved > 0 ? Math.round(x.amount / b.approved * 100) : 0;
                return "<tr><td style='color:#e6edf8'>" + esc(x.name) + "</td><td style='text-align:right;color:#c7d2e8'>" + money(x.amount) + "</td><td style='text-align:right;color:#9fb0d6'>" + pct + "%</td></tr>";
            }).join("") : "<tr><td colspan='3' style='text-align:center;color:#9fb0d6;padding:12px'>No department allocation set.</td></tr>";
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Budget</div>" +
                "<div class='pmBudgetCards'>" + card("Approved Budget", money(b.approved), "#38bdf8") +
                card("Budget Utilized", money(b.utilized), utilColor(b.utilizationPct)) +
                card("Remaining Budget", money(b.remaining), "#34d399") +
                card("Utilization", b.utilizationPct + "%", utilColor(b.utilizationPct)) + "</div>" +
                "<div class='fpaTableWrap' style='margin-top:12px'><table class='fpaTable'><thead><tr><th>Department / Module</th><th style='text-align:right'>Allocated</th><th style='text-align:right'>% of Budget</th></tr></thead><tbody>" + deptRows + "</tbody></table></div></div>";
        },

        _issues: function (d) {
            var i = d.issues;
            var chip = function (l, v, c) { return "<span class='pmChip' style='border-color:" + c + "40'><b style='color:" + c + "'>" + v + "</b> " + l + "</span>"; };
            var rows = i.list.length ? i.list.map(function (x) {
                return "<tr><td><b style='color:#e6edf8'>" + esc(x.title) + "</b></td>" +
                    "<td><span style='color:" + sevColor(x.severity) + ";font-weight:700;font-size:0.8rem'>" + esc(x.severity) + "</span></td>" +
                    "<td style='color:#9fb0d6'>" + esc(x.owner) + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(x.createdAt || "").slice(0, 10) || "—") + "</td>" +
                    "<td style='color:#c7d2e8'>" + esc(x.status) + "</td></tr>";
            }).join("") : "<tr><td colspan='5' style='text-align:center;color:#9fb0d6;padding:14px'>No issues raised.</td></tr>";
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Risks &amp; Issues</div>" +
                "<div class='pmChips'>" + chip("Open", i.open, "#fbbf24") + chip("High", i.high, "#fb923c") + chip("Critical", i.critical, "#fb7185") + "</div>" +
                "<div class='fpaTableWrap'><table class='fpaTable'><thead><tr><th>Issue</th><th>Severity</th><th>Owner</th><th>Created</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
                "<div class='fdCardSub' style='margin-top:8px'>Raise / assign / resolve issues from the <a href='#' onclick=\"window._pmCtrl.onOpenWorkspace();return false;\" style='color:#38bdf8'>project workspace</a>.</div></div>";
        },

        _meetingsApprovals: function (d) {
            var m = d.meetings, s = d.summary;
            var stat = function (l, v, c) { return "<div class='fpaStat'><div class='fpaStatL'>" + l + "</div><div class='fpaStatV' style='color:" + (c || "#e6edf8") + "'>" + v + "</div></div>"; };
            return "<div class='fpaTableSection'><div class='fpaSecHead'>Meetings &amp; Approvals</div>" +
                "<div class='fpaStatGrid'>" +
                stat("Upcoming Meetings", m.upcoming, "#38bdf8") + stat("Today's Meetings", m.today, "#a78bfa") + stat("Completed Meetings", m.completed, "#34d399") +
                stat("Pending Timesheet Approvals", s.pendingApprovals, s.pendingApprovals ? "#fbbf24" : "#34d399") + "</div>" +
                "<div class='pmQuick'><div class='fpaSecHead' style='margin-top:16px'>Quick Actions</div><div class='pmQuickRow'>" +
                ["Create Task", "Allocate Resource", "Schedule Meeting", "Raise Issue", "Add Milestone", "Request Budget Change"].map(function (a) {
                    return "<button class='pmQuickBtn' onclick=\"window._pmCtrl.onOpenWorkspace()\">" + esc(a) + "</button>";
                }).join("") + "</div><div class='fdCardSub' style='margin-top:6px'>Quick actions open the project workspace where the operation is performed.</div></div></div>";
        },

        // ── Charts ────────────────────────────────────────────────────────────
        _destroyCharts: function () { (this._charts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /* */ } }); this._charts = []; },
        _ctx: function (id) { var el = document.getElementById(id); return el ? el.getContext("2d") : null; },
        _initCharts: function () {
            this._destroyCharts();
            if (!window.Chart || !this._data) return;
            var C = window.Chart; C.defaults.color = "#9fb0d6"; C.defaults.font.family = "Inter, Segoe UI, Arial, sans-serif";
            var grid = { color: "rgba(255,255,255,0.06)" };
            var ch = this._data.charts;
            var ts = ch.taskStatus;
            this._donut("pm_taskStatus", Object.keys(ts), Object.values(ts), ["#34d399", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185"]);
            this._donut("pm_milestones", ["Completed", "Remaining"], [ch.milestoneProgress.Completed, ch.milestoneProgress.Remaining], ["#34d399", "#334155"]);
            var ru = ch.resourceUtilization;
            this._bar("pm_resUtil", ru.map(function (x) { return x.name; }), ru.map(function (x) { return x.value; }), ru.map(function (x) { return utilColor(x.value); }), grid, false, false);
            this._bar("pm_budget", ["Utilized", "Remaining"], [ch.budgetConsumption.utilized, ch.budgetConsumption.remaining], ["#fb7185", "#34d399"], grid, false, true);
            var sv = ch.issueSeverity;
            this._pie("pm_severity", Object.keys(sv), Object.values(sv), Object.keys(sv).map(sevColor));
            this._line("pm_trend", ch.taskTrend.map(function (x) { return x.label; }), ch.taskTrend.map(function (x) { return x.value; }), "#38bdf8", grid);
        },
        _donut: function (id, labels, data, colors) {
            var ctx = this._ctx(id); if (!ctx) return;
            this._charts.push(new window.Chart(ctx, { type: "doughnut", data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: "rgba(11,16,32,0.7)", borderWidth: 2 }] },
                options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { boxWidth: 11, padding: 9, font: { size: 11 } } } } } }));
        },
        _pie: function (id, labels, data, colors) {
            var ctx = this._ctx(id); if (!ctx) return;
            this._charts.push(new window.Chart(ctx, { type: "pie", data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: "rgba(11,16,32,0.7)", borderWidth: 2 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 11, padding: 9, font: { size: 11 } } } } } }));
        },
        _bar: function (id, labels, data, colors, grid, horizontal, money) {
            var ctx = this._ctx(id); if (!ctx) return;
            this._charts.push(new window.Chart(ctx, { type: "bar", data: { labels: labels, datasets: [{ data: data, backgroundColor: colors }] },
                options: { maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x", plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return money ? moneyC(c.raw) : c.raw + "%"; } } } },
                    scales: { y: { grid: grid, ticks: { callback: function (v) { return money ? moneyC(v) : v; } } }, x: { grid: { display: false } } } } }));
        },
        _line: function (id, labels, data, color, grid) {
            var ctx = this._ctx(id); if (!ctx) return;
            var g = ctx.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
            this._charts.push(new window.Chart(ctx, { type: "line", data: { labels: labels, datasets: [{ data: data, borderColor: color, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 3, pointBackgroundColor: color }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: grid, ticks: { precision: 0 } }, x: { grid: { display: false } } } } }));
        },

        _loadChartJs: function () {
            if (window.Chart) return Promise.resolve(window.Chart);
            if (this._pChart) return this._pChart;
            var that = this;
            this._pChart = new Promise(function (resolve) {
                var s = document.createElement("script"); s.src = CHARTJS_URL; s.async = true;
                s.onload = function () { resolve(window.Chart); if (that._data) that._initCharts(); };
                s.onerror = function () { that._pChart = null; resolve(null); };
                document.head.appendChild(s);
            });
            return this._pChart;
        }
    });
});
