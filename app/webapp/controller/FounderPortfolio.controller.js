sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage"
], function (Controller, FounderSidebar, FP) {
    "use strict";

    var CHARTJS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    // Indian-format compact currency: 48500000 → "₹4.85 Cr".
    function inrCompact(n) {
        n = Number(n) || 0;
        var a = Math.abs(n), sign = n < 0 ? "-" : "";
        if (a >= 1e7) return sign + "₹" + (a / 1e7).toFixed(2) + " Cr";
        if (a >= 1e5) return sign + "₹" + (a / 1e5).toFixed(2) + " L";
        if (a >= 1e3) return sign + "₹" + (a / 1e3).toFixed(1) + " K";
        return sign + "₹" + a.toFixed(0);
    }
    function inrFull(n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); }
    var PALETTE = ["#6366f1", "#34d399", "#38bdf8", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee", "#f472b6"];
    function healthColor(h) { return h >= 90 ? "#34d399" : h >= 70 ? "#fbbf24" : "#fb7185"; }
    function riskColor(r) { return r === "Low" ? "#34d399" : r === "Medium" ? "#fbbf24" : r === "High" ? "#fb923c" : "#fb7185"; }
    function healthDot(label) { return label === "Healthy" ? "🟢" : label === "At Risk" ? "🟡" : "🔴"; }

    return Controller.extend("timesheet.app.controller.FounderPortfolio", {

        onInit: function () {
            this._charts = [];
            this._data = null;
            this._filters = { status: "", client: "", pm: "" };
            window._fpaCtrl = this;
            this.getOwnerComponent().getRouter()
                .getRoute("founder-portfolio").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            FounderSidebar.attach(this);
            if (FP.shell && FP.shell.attach) { try { FP.shell.attach(this); } catch (e) { /* */ } }
            this._loadChartJs();
            this._refresh();
        },

        onExit: function () {
            this._destroyCharts();
            if (window._fpaCtrl === this) { window._fpaCtrl = null; }
        },

        // ── Data ────────────────────────────────────────────────────────────────
        _call: function (action, params) {
            return fetch("/project/" + action, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify(params || {})
            }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
                .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
        },

        _host: function () { return this.byId("portfolioHost"); },

        _refresh: function () {
            var that = this;
            this._call("getPortfolioAnalysis", {}).then(function (d) {
                if (!d || d.error) { var h = that._host(); if (h) h.setContent("<div class='fpaRoot'><div class='fdLoading'>" + esc((d && d.error) || "Could not load portfolio analysis.") + "</div></div>"); return; }
                that._data = d;
                that._render();
            }).catch(function (e) {
                var h = that._host();
                var msg = (e && e.message) ? e.message : "network error";
                if (h) h.setContent("<div class='fpaRoot'><div class='fdLoading'>Could not load portfolio analysis.<br/><span style='font-size:0.8rem;color:#fb7185'>(" + esc(msg) + ")</span></div></div>");
            });
        },

        // ── Render ────────────────────────────────────────────────────────────────
        _render: function () {
            if (!this._data) return;
            var d = this._data;
            var html = "<div class='fpaRoot'>" +
                this._buildHeader() +
                "<div class='fpaWrap'>" +
                this._buildKpis(d) +
                this._buildCharts() +
                this._buildTable(d) +
                "</div></div>";
            var h = this._host();
            if (!h) return;
            h.setContent(html);
            var that = this;
            setTimeout(function () { that._initCharts(); that._wire(); }, 60);
        },

        _buildHeader: function () {
            var d = this._data;
            var clients = Array.from(new Set((d.table || []).map(function (r) { return r.client; }))).sort();
            var pms = Array.from(new Set((d.table || []).map(function (r) { return r.pm; }))).sort();
            var opt = function (list, sel) { return list.map(function (v) { return "<option" + (v === sel ? " selected" : "") + ">" + esc(v) + "</option>"; }).join(""); };
            return "<div class='fpaHeader'>" +
                "<div class='fpaTitle'><div class='fpaH1'>Portfolio Analysis</div>" +
                "<div class='fpaH2'>Executive Command Center · real-time revenue, profitability &amp; delivery health</div></div>" +
                "<div class='fpaFilters'>" +
                "<select class='fpaSel' id='fpaStatus'><option value=''>All Statuses</option>" + opt(["Planning", "Active", "On Hold", "Completed"], this._filters.status) + "</select>" +
                "<select class='fpaSel' id='fpaClient'><option value=''>All Clients</option>" + opt(clients, this._filters.client) + "</select>" +
                "<select class='fpaSel' id='fpaPm'><option value=''>All Managers</option>" + opt(pms, this._filters.pm) + "</select>" +
                "<div class='fpaExport'><button class='fpaExpBtn' id='fpaExport'>⭳ Export ▾</button>" +
                "<div class='fpaExpMenu' id='fpaExpMenu'><a data-x='csv'>CSV</a><a data-x='excel'>Excel</a><a data-x='pdf'>PDF / Print</a></div></div>" +
                "</div></div>";
        },

        // ── KPIs + health ─────────────────────────────────────────────────────────
        _kpiCard: function (label, value, trend, positive) {
            var t = "";
            if (trend != null && trend !== "") {
                var up = positive !== false;
                t = "<div class='fpaKpiTrend " + (up ? "up" : "down") + "'>" + (up ? "↑" : "↓") + " " + esc(trend) + "</div>";
            }
            return "<div class='fpaKpi'><div class='fpaKpiL'>" + esc(label) + "</div>" +
                "<div class='fpaKpiV'>" + esc(value) + "</div>" + t + "</div>";
        },
        _finCard: function (label, value, sub) {
            return "<div class='fpaKpi fin'><div class='fpaKpiL'>" + esc(label) + "</div>" +
                "<div class='fpaKpiV'>" + esc(value) + "</div>" + (sub ? "<div class='fpaKpiSub'>" + esc(sub) + "</div>" : "") + "</div>";
        },

        _buildKpis: function (d) {
            var k = d.kpis || {}, f = d.financials || {}, he = d.health || {};
            var tr = k.trends || {};
            var trTxt = function (n) { return n > 0 ? (n + " vs last month") : ""; };

            var projectKpis =
                this._kpiCard("Total Projects", k.totalProjects, trTxt(tr.totalProjects), true) +
                this._kpiCard("Active Projects", k.activeProjects, trTxt(tr.activeProjects), true) +
                this._kpiCard("Completed", k.completedProjects, trTxt(tr.completedProjects), true) +
                this._kpiCard("Delayed", k.delayedProjects, k.delayedProjects ? "needs attention" : "", false) +
                this._kpiCard("At Risk", k.atRiskProjects, k.atRiskProjects ? "monitor" : "", false);

            var finKpis =
                this._finCard("Total Contract Value", inrCompact(f.totalContractValue)) +
                this._finCard("Forecasted Profit", inrCompact(f.forecastedProfit)) +
                this._finCard("Portfolio Margin", (f.portfolioMarginPct || 0) + "%") +
                this._finCard("Revenue Realized", inrCompact(f.revenueRealized)) +
                // ── Time-phased resource budget (enterprise) ──────────────────────
                this._finCard("Approved Budget", inrCompact(f.approvedBudget != null ? f.approvedBudget : f.executionBudget), "resource execution") +
                this._finCard("Estimated Cost", inrCompact(f.estimatedCost || 0), "spent + forecast") +
                this._finCard("Spent Cost", inrCompact(f.spentCost || 0), "historical (frozen)") +
                this._finCard("Forecast Remaining", inrCompact(f.forecastCost || 0), "future") +
                this._finCard("Available Budget", inrCompact(f.availableBudget != null ? f.availableBudget : 0), "approved − estimated") +
                this._finCard("Budget Utilization", (f.budgetUtilizationPct || 0) + "%");

            // Health gauge (SVG ring)
            var score = he.score || 0;
            var col = healthColor(score);
            var R = 54, C = 2 * Math.PI * R, off = C * (1 - score / 100);
            var gauge = "<div class='fpaHealth'>" +
                "<div class='fpaHealthTitle'>Portfolio Health</div>" +
                "<div class='fpaGauge'><svg width='140' height='140' viewBox='0 0 140 140'>" +
                "<circle cx='70' cy='70' r='" + R + "' fill='none' stroke='rgba(255,255,255,0.08)' stroke-width='12'/>" +
                "<circle cx='70' cy='70' r='" + R + "' fill='none' stroke='" + col + "' stroke-width='12' stroke-linecap='round'" +
                " stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + off.toFixed(1) + "' transform='rotate(-90 70 70)'/>" +
                "<text x='70' y='66' text-anchor='middle' fill='#fff' font-size='30' font-weight='800'>" + score + "</text>" +
                "<text x='70' y='88' text-anchor='middle' fill='#9fb0d6' font-size='12'>/ 100</text></svg></div>" +
                "<div class='fpaHealthLabel' style='color:" + col + "'>" + esc(he.label || "") + "</div></div>";

            return "<div class='fpaKpiSection'>" +
                "<div class='fpaSecHead'>Executive Summary</div>" +
                "<div class='fpaKpiRow projects'>" + projectKpis + "</div>" +
                "<div class='fpaKpiSplit'>" +
                "<div class='fpaKpiRow fin'>" + finKpis + "</div>" +
                gauge +
                "</div></div>";
        },

        // ── Charts scaffold ─────────────────────────────────────────────────────
        _chartCard: function (title, sub, id, cls) {
            return "<div class='fpaChartCard " + (cls || "") + "'>" +
                "<div class='fpaChartHead'><div class='fpaChartTitle'>" + esc(title) + "</div>" +
                (sub ? "<div class='fpaChartSub'>" + esc(sub) + "</div>" : "") + "</div>" +
                "<div class='fpaChartBox'><canvas id='" + id + "'></canvas></div></div>";
        },

        _buildCharts: function () {
            var d = this._data, ch = d.charts || {};
            // Milestones rendered as a list card (not a canvas).
            var ms = (ch.milestones || []);
            var msRows = ms.length ? ms.map(function (m) {
                return "<div class='fpaMsRow'><div class='fpaMsMain'><b>" + esc(m.milestone) + "</b>" +
                    (m.critical ? " <span class='fpaCrit'>critical</span>" : "") +
                    "<div class='fpaMsSub'>" + esc(m.project) + "</div></div>" +
                    "<div class='fpaMsMeta'><div>" + esc(String(m.dueDate || "").slice(0, 10)) + "</div>" +
                    "<div class='fpaMsRev'>" + inrCompact(m.revenueImpact) + "</div></div></div>";
            }).join("") : "<div class='fdCardSub' style='padding:8px 2px'>No milestones due in the next 30 days.</div>";

            return "<div class='fpaChartSection'>" +
                "<div class='fpaSecHead'>Business Intelligence</div>" +
                "<div class='fpaChartGrid'>" +
                this._chartCard("Project Status Distribution", "By lifecycle stage", "fpa_status", "sm") +
                this._chartCard("Revenue by Client", "Contract-value concentration", "fpa_client", "sm") +
                this._chartCard("Revenue vs Forecasted Cost", "Profitability per project (top 10)", "fpa_revcost", "lg") +
                this._chartCard("Top 5 Profitable Projects", "Projected profit", "fpa_top5", "md") +
                this._chartCard("Revenue Trend", "Monthly revenue realized · last 12 months", "fpa_revtrend", "md") +
                this._chartCard("Spend Trend", "Monthly actual spend · last 12 months", "fpa_spendtrend", "md") +
                this._chartCard("Projects Requiring Attention", "Where founder intervention is needed", "fpa_attention", "md") +
                "<div class='fpaChartCard md'><div class='fpaChartHead'><div class='fpaChartTitle'>Upcoming Milestones</div><div class='fpaChartSub'>Next 30 days</div></div>" +
                "<div class='fpaMsList'>" + msRows + "</div></div>" +
                "</div></div>";
        },

        // ── Executive table ─────────────────────────────────────────────────────
        _filteredRows: function () {
            var f = this._filters, rows = (this._data.table || []);
            var mapStatus = function (s) { return s === "MeetingScheduled" || s === "MeetingCompleted" || s === "BudgetAllocated" ? "Planning" : s; };
            return rows.filter(function (r) {
                if (f.status && mapStatus(r.status) !== f.status) return false;
                if (f.client && r.client !== f.client) return false;
                if (f.pm && r.pm !== f.pm) return false;
                return true;
            });
        },
        _buildTable: function () {
            var rows = this._filteredRows();
            var body = rows.length ? rows.map(function (r) {
                var comp = Math.max(0, Math.min(100, r.completion || 0));
                return "<tr>" +
                    "<td><b style='color:#e6edf8'>" + esc(r.name) + "</b></td>" +
                    "<td style='color:#9fb0d6'>" + esc(r.client) + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(r.pm) + "</td>" +
                    "<td><span class='fpaStatusChip'>" + esc(r.status) + "</span></td>" +
                    "<td>" + healthDot(r.healthLabel) + " <span style='color:" + healthColor(r.health) + ";font-weight:700'>" + r.health + "</span></td>" +
                    "<td><div class='fpaBar'><div class='fpaBarFill' style='width:" + comp + "%;background:" + healthColor(r.health) + "'></div></div><span class='fpaBarPct'>" + comp + "%</span></td>" +
                    "<td style='color:#e6edf8'>" + inrCompact(r.contractValue) + "</td>" +
                    "<td style='color:" + (r.projectedProfit >= 0 ? "#34d399" : "#fb7185") + "'>" + inrCompact(r.projectedProfit) + "</td>" +
                    "<td style='color:#c7d2e8'>" + (r.marginPct || 0) + "%</td>" +
                    "<td><span style='color:" + riskColor(r.risk) + ";font-weight:700;font-size:0.8rem'>" + esc(r.risk) + "</span></td>" +
                    "<td><button class='faBtn sm approve fpaView' data-id='" + esc(r.projectId) + "'>View</button></td>" +
                    "</tr>";
            }).join("") : "<tr><td colspan='11' style='text-align:center;color:#9fb0d6;padding:18px'>No projects match the current filters.</td></tr>";

            return "<div class='fpaTableSection'>" +
                "<div class='fpaSecHead'>Projects Overview <span class='fpaCount'>" + rows.length + "</span></div>" +
                "<div class='fpaTableWrap'><table class='fpaTable'><thead><tr>" +
                "<th>Project</th><th>Client</th><th>Manager</th><th>Status</th><th>Health</th><th>Completion</th>" +
                "<th>Contract</th><th>Fcst Profit</th><th>Margin</th><th>Risk</th><th>Actions</th>" +
                "</tr></thead><tbody>" + body + "</tbody></table></div></div>";
        },

        // ── Chart.js ──────────────────────────────────────────────────────────────
        _destroyCharts: function () { (this._charts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /* */ } }); this._charts = []; },
        _ctx: function (id) { var el = document.getElementById(id); return el ? el.getContext("2d") : null; },
        _initCharts: function () {
            this._destroyCharts();
            if (!window.Chart || !this._data) return;
            var C = window.Chart;
            C.defaults.color = "#9fb0d6";
            C.defaults.font.family = "Inter, Segoe UI, Arial, sans-serif";
            var grid = { color: "rgba(255,255,255,0.06)" };
            var ch = this._data.charts || {};

            // 1. Status distribution donut
            var sd = ch.statusDistribution || {};
            this._donut("fpa_status", ["Planning", "Ongoing", "On Hold", "Completed"],
                [sd.Planning || 0, sd.Ongoing || 0, sd["On Hold"] || 0, sd.Completed || 0],
                ["#6366f1", "#38bdf8", "#fbbf24", "#34d399"], (this._data.kpis || {}).totalProjects || 0, "Projects");

            // 2. Revenue by client donut
            var rc = ch.revenueByClient || [];
            this._donut("fpa_client", rc.map(function (x) { return x.name; }), rc.map(function (x) { return x.value; }),
                PALETTE, null, null, true);

            // 3. Revenue vs forecasted cost grouped bar
            var rvc = ch.revenueVsCost || [];
            this._bar("fpa_revcost", rvc.map(function (x) { return x.name; }), [
                { label: "Contract Value", data: rvc.map(function (x) { return x.contract; }), backgroundColor: "#34d399" },
                { label: "Forecasted Spend", data: rvc.map(function (x) { return x.forecast; }), backgroundColor: "#fb7185" }
            ], grid, false);

            // 4. Top 5 profitable horizontal bar
            var t5 = ch.top5Profitable || [];
            this._bar("fpa_top5", t5.map(function (x) { return x.name; }),
                [{ label: "Projected Profit", data: t5.map(function (x) { return x.profit; }), backgroundColor: "#a78bfa" }], grid, true);

            // 5 & 6 trends
            this._line("fpa_revtrend", (ch.revenueTrend || []).map(function (x) { return x.label; }), (ch.revenueTrend || []).map(function (x) { return x.value; }), "#34d399", grid);
            this._line("fpa_spendtrend", (ch.spendTrend || []).map(function (x) { return x.label; }), (ch.spendTrend || []).map(function (x) { return x.value; }), "#fb7185", grid);

            // 7. Attention horizontal bar
            var at = ch.attention || {};
            this._bar("fpa_attention", ["Delayed", "Over Budget", "Blocked", "Critical"],
                [{ label: "Projects", data: [at.delayed || 0, at.overBudget || 0, at.blocked || 0, at.critical || 0], backgroundColor: ["#fbbf24", "#fb923c", "#f472b6", "#fb7185"] }], grid, true, true);
        },
        _donut: function (id, labels, data, colors, centerNum, centerLabel, money) {
            var ctx = this._ctx(id); if (!ctx) return;
            var opts = {
                maintainAspectRatio: false, cutout: "64%",
                plugins: {
                    legend: { position: "bottom", labels: { boxWidth: 11, padding: 10, font: { size: 11 } } },
                    tooltip: money ? { callbacks: { label: function (c) { return c.label + ": " + inrCompact(c.raw); } } } : {}
                }
            };
            var cfg = { type: "doughnut", data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: "rgba(11,16,32,0.7)", borderWidth: 2 }] }, options: opts };
            if (centerNum != null) {
                cfg.plugins = [{
                    id: "center" + id, afterDraw: function (chart) {
                        var a = chart.chartArea; if (!a) return; var cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
                        var cc = chart.ctx; cc.save(); cc.textAlign = "center"; cc.fillStyle = "#fff"; cc.font = "800 24px Inter, Arial";
                        cc.fillText(String(centerNum), cx, cy - 2); cc.fillStyle = "#9fb0d6"; cc.font = "11px Inter, Arial";
                        cc.fillText(centerLabel || "", cx, cy + 16); cc.restore();
                    }
                }];
            }
            this._charts.push(new window.Chart(ctx, cfg));
        },
        _bar: function (id, labels, datasets, grid, horizontal, singleColorTooltipMoney) {
            var ctx = this._ctx(id); if (!ctx) return;
            var money = !singleColorTooltipMoney;
            var opts = {
                maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x",
                plugins: {
                    legend: { display: datasets.length > 1, position: "bottom", labels: { boxWidth: 11, padding: 10 } },
                    tooltip: { callbacks: { label: function (c) { return (c.dataset.label ? c.dataset.label + ": " : "") + (money ? inrCompact(c.raw) : c.raw); } } }
                },
                scales: {
                    x: { grid: horizontal ? grid : { display: false }, ticks: horizontal && money ? { callback: function (v) { return inrCompact(v); } } : {} },
                    y: { grid: horizontal ? { display: false } : grid, ticks: (!horizontal && money) ? { callback: function (v) { return inrCompact(v); } } : {} }
                }
            };
            this._charts.push(new window.Chart(ctx, { type: "bar", data: { labels: labels, datasets: datasets }, options: opts }));
        },
        _line: function (id, labels, data, color, grid) {
            var ctx = this._ctx(id); if (!ctx) return;
            var g = ctx.createLinearGradient(0, 0, 0, 220);
            g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
            this._charts.push(new window.Chart(ctx, {
                type: "line",
                data: { labels: labels, datasets: [{ data: data, borderColor: color, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 2, pointBackgroundColor: color }] },
                options: {
                    maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return inrCompact(c.raw); } } } },
                    scales: { y: { beginAtZero: true, grid: grid, ticks: { callback: function (v) { return inrCompact(v); } } }, x: { grid: { display: false } } }
                }
            }));
        },

        // ── Interactivity ─────────────────────────────────────────────────────────
        _wire: function () {
            var that = this;
            var bind = function (id, key) { var el = document.getElementById(id); if (el) el.onchange = function () { that._filters[key] = this.value; that._rerenderTable(); }; };
            bind("fpaStatus", "status"); bind("fpaClient", "client"); bind("fpaPm", "pm");

            var expBtn = document.getElementById("fpaExport"), expMenu = document.getElementById("fpaExpMenu");
            if (expBtn && expMenu) {
                expBtn.onclick = function (e) { e.stopPropagation(); expMenu.classList.toggle("open"); };
                document.addEventListener("click", function () { expMenu.classList.remove("open"); }, { once: true });
                Array.prototype.forEach.call(expMenu.querySelectorAll("a"), function (a) {
                    a.onclick = function () { expMenu.classList.remove("open"); that._export(a.getAttribute("data-x")); };
                });
            }
            this._wireViewButtons();
        },
        _wireViewButtons: function () {
            var that = this;
            Array.prototype.forEach.call(document.querySelectorAll(".fpaView"), function (b) {
                b.onclick = function () { that._openDrillDown(b.getAttribute("data-id")); };
            });
        },
        // Re-render just the table + rewire, so filter changes feel instant.
        _rerenderTable: function () {
            var host = document.querySelector(".fpaTableSection");
            if (!host) { this._render(); return; }
            var tmp = document.createElement("div"); tmp.innerHTML = this._buildTable();
            host.replaceWith(tmp.firstChild);
            this._wireViewButtons();
        },

        // ── Export ──────────────────────────────────────────────────────────────
        _export: function (kind) {
            var rows = this._filteredRows();
            var headers = ["Project", "Client", "Manager", "Status", "Health", "Completion %", "Contract Value", "Forecasted Profit", "Margin %", "Risk"];
            var data = rows.map(function (r) { return [r.name, r.client, r.pm, r.status, r.health, r.completion, r.contractValue, r.projectedProfit, r.marginPct, r.risk]; });
            if (kind === "pdf") { window.print(); return; }
            var sep = kind === "excel" ? "\t" : ",";
            var q = function (v) { v = String(v == null ? "" : v); return (sep === "," && /[",\n]/.test(v)) ? '"' + v.replace(/"/g, '""') + '"' : v; };
            var content = [headers.join(sep)].concat(data.map(function (row) { return row.map(q).join(sep); })).join("\n");
            var mime = kind === "excel" ? "application/vnd.ms-excel" : "text/csv";
            var ext = kind === "excel" ? "xls" : "csv";
            var blob = new Blob([content], { type: mime });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = "portfolio-projects." + ext;
            document.body.appendChild(a); a.click(); a.remove();
            FP.toast("Exported " + rows.length + " projects (" + ext.toUpperCase() + ").");
        },

        // ── Drill-down drawer ─────────────────────────────────────────────────────
        _openDrillDown: function (projectId) {
            var that = this;
            this._call("getPortfolioProjectDetail", { projectId: projectId }).then(function (d) {
                if (!d || d.error) { FP.toast((d && d.error) || "Could not load project.", false); return; }
                that._renderDrillDown(d);
            }).catch(function () { FP.toast("Could not load project.", false); });
        },
        _renderDrillDown: function (d) {
            var p = d.project || {}, f = d.financial || {}, dl = d.delivery || {}, ri = d.resourceInfo || {}, tl = d.timeline || {};
            var stat = function (l, v, col) { return "<div class='fpaStat'><div class='fpaStatL'>" + esc(l) + "</div><div class='fpaStatV'" + (col ? " style='color:" + col + "'" : "") + ">" + esc(v) + "</div></div>"; };
            var dt = function (v) { return v ? String(v).slice(0, 10) : "—"; };

            var financial = "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Financial</div><div class='fpaStatGrid'>" +
                stat("Contract Value", inrCompact(f.contractValue)) +
                stat("Execution Budget", inrCompact(f.executionBudget)) +
                stat("Current Spend", inrCompact(f.currentSpend)) +
                stat("Forecasted Spend", inrCompact(f.forecastedSpend)) +
                stat("Projected Profit", inrCompact(f.projectedProfit), f.projectedProfit >= 0 ? "#34d399" : "#fb7185") +
                stat("Projected Margin", (f.projectedMarginPct || 0) + "%") +
                stat("Budget Variance", inrCompact(f.budgetVariance), f.budgetVariance >= 0 ? "#34d399" : "#fb7185") +
                stat("Profit Variance", inrCompact(f.profitVariance), f.profitVariance >= 0 ? "#34d399" : "#fb7185") +
                stat("Revenue Realized", inrCompact(f.revenueRealized)) +
                stat("Revenue At Risk", inrCompact(f.revenueAtRisk), f.revenueAtRisk ? "#fb7185" : null) +
                "</div></div>";

            var upMs = (dl.upcomingMilestones || []).map(function (m) { return "<li>" + esc(m.name) + " <span class='fdCardSub'>· " + dt(m.dueDate) + (m.critical ? " · critical" : "") + "</span></li>"; }).join("") || "<li class='fdCardSub'>None</li>";
            var deMs = (dl.delayedMilestones || []).map(function (m) { return "<li style='color:#fb7185'>" + esc(m.name) + " <span class='fdCardSub'>· " + dt(m.dueDate) + "</span></li>"; }).join("") || "<li class='fdCardSub'>None</li>";
            var delivery = "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Delivery</div><div class='fpaStatGrid'>" +
                stat("Status", p.status) + stat("Completion", (dl.completion || 0) + "%") +
                stat("Health Score", (dl.healthScore || 0), healthColor(dl.healthScore || 0)) +
                stat("Blocked Tasks", dl.blockedTasks || 0) + stat("Overdue Tasks", dl.overdueTasks || 0) +
                "</div><div class='fpaMsCols'><div><div class='fpaMsColTitle'>Upcoming Milestones</div><ul>" + upMs + "</ul></div>" +
                "<div><div class='fpaMsColTitle'>Delayed Milestones</div><ul>" + deMs + "</ul></div></div></div>";

            var resList = (ri.list || []).map(function (r) { return "<li>" + esc(r.name) + " <span class='fdCardSub'>· " + esc(r.department || "") + " · " + r.bandwidth + "%</span></li>"; }).join("") || "<li class='fdCardSub'>No resources allocated</li>";
            var resource = "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Resources</div><div class='fpaStatGrid'>" +
                stat("Allocated", ri.allocated || 0) + stat("Utilization", (ri.utilizationPct || 0) + "%") +
                stat("Billable", (ri.billablePct || 0) + "%") + stat("Bench", (ri.benchPct || 0) + "%") +
                "</div><ul class='fpaResList'>" + resList + "</ul></div>";

            var timeline = "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Timeline</div><div class='fpaStatGrid'>" +
                stat("Planned Start", dt(tl.plannedStart)) + stat("Actual Start", dt(tl.actualStart)) +
                stat("Planned End", dt(tl.plannedEnd)) + stat("Forecasted End", dt(tl.forecastedEnd)) +
                stat("Go-Live", dt(tl.goLive)) +
                "</div></div>";

            var charts = "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Financial Trend</div>" +
                "<div class='fpaChartBox' style='height:220px'><canvas id='fpaDrawTrend'></canvas></div></div>";

            var body = "<div class='fpaDrawer'>" +
                "<div class='fpaDrawHead'><div><div class='fpaDrawName'>" + esc(p.name) + "</div>" +
                "<div class='fpaDrawMeta'>" + esc(p.client) + " · " + esc(p.pm) + " · " + esc(p.typeName) + "</div></div>" +
                "<div class='fpaDrawBadges'><span class='fpaBadge' style='color:" + healthColor(p.health) + "'>" + healthDot(p.healthLabel) + " " + p.health + "/100</span>" +
                "<span class='fpaBadge' style='color:" + riskColor(p.risk) + "'>" + esc(p.risk) + " risk</span></div></div>" +
                financial + delivery + resource + timeline + charts +
                "<div class='fmodFoot'><button class='faBtn ghost' id='fpaDrawClose'>Close</button></div></div>";

            var m = FP.modal({ title: "Project Drill-Down", body: body, wide: true, cls: "fmodCreateProject fpaDrawModal" });
            m.body.querySelector("#fpaDrawClose").addEventListener("click", m.close);
            var that = this;
            setTimeout(function () { that._drawTrend(d.trend || []); }, 60);
        },
        _drawTrend: function (trend) {
            if (!window.Chart) return;
            var ctx = this._ctx("fpaDrawTrend"); if (!ctx) return;
            var labels = trend.map(function (x) { return x.label; });
            this._charts.push(new window.Chart(ctx, {
                type: "line",
                data: {
                    labels: labels, datasets: [
                        { label: "Cumulative Burn", data: trend.map(function (x) { return x.burn; }), borderColor: "#fb7185", backgroundColor: "transparent", tension: 0.35, borderWidth: 2, pointRadius: 0 },
                        { label: "Monthly Spend", data: trend.map(function (x) { return x.spend; }), borderColor: "#38bdf8", backgroundColor: "transparent", tension: 0.35, borderWidth: 2, pointRadius: 0 },
                        { label: "Monthly Revenue", data: trend.map(function (x) { return x.revenue; }), borderColor: "#34d399", backgroundColor: "transparent", tension: 0.35, borderWidth: 2, pointRadius: 0 }
                    ]
                },
                options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 11, padding: 10 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + inrCompact(c.raw); } } } }, scales: { y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.06)" }, ticks: { callback: function (v) { return inrCompact(v); } } }, x: { grid: { display: false } } } }
            }));
        },

        // ── Chart.js loader ─────────────────────────────────────────────────────
        _loadChartJs: function () {
            if (window.Chart) return Promise.resolve(window.Chart);
            if (this._pChart) return this._pChart;
            var that = this;
            this._pChart = new Promise(function (resolve) {
                var s = document.createElement("script");
                s.src = CHARTJS_URL; s.async = true;
                s.onload = function () { resolve(window.Chart); if (that._data) that._initCharts(); };
                s.onerror = function () { that._pChart = null; resolve(null); };
                document.head.appendChild(s);
            });
            return this._pChart;
        }
    });
});
