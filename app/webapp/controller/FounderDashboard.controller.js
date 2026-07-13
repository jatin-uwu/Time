sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage"
], function (Controller, MessageToast, FounderSidebar, FP) {
    "use strict";

    var CHARTJS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    function statusColor(st) {
        return st === "Excellent" ? "#34d399" : st === "Good" ? "#38bdf8"
            : st === "Needs Attention" ? "#fbbf24" : "#fb7185";
    }
    function greetWord() {
        var h = new Date().getHours();
        return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
    }

    return Controller.extend("timesheet.app.controller.FounderDashboard", {

        onInit: function () {
            this._view = "overall";        // "overall" | "department"
            this._dept = null;
            this._emp = null;              // selected employee for drill-down
            this._empData = null;
            this._period = "Current Month";
            this._charts = [];
            this._overall = null;
            this._deptData = null;
            window._fdCtrl = this;

            this.getOwnerComponent().getRouter()
                .getRoute("founder-dashboard").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            FounderSidebar.attach(this);   // shared collapsible founder navigation
            FP.shell.attach(this);         // shared header shell (notifications/settings)
            this._loadChartJs();           // begin loading the chart lib early
            this._connectSSE();
            this._startPolling();
            this._refresh();
        },

        onExit: function () {
            this._destroyCharts();
            if (this._es) { try { this._es.close(); } catch (e) { /**/ } this._es = null; }
            if (this._poll) { clearInterval(this._poll); this._poll = null; }
            if (window._fdCtrl === this) { window._fdCtrl = null; }
        },

        // ── Data ──────────────────────────────────────────────────────────────
        _callFounder: function (action, params) {
            return fetch("/founder/" + action, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify(params || {})
            }).then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.text();
            }).then(function (t) {
                var j; try { j = JSON.parse(t); } catch (e) { j = null; }
                var v = (j && j.value !== undefined) ? j.value : j;
                return (typeof v === "string") ? JSON.parse(v) : v;
            });
        },

        _refresh: function () {
            var that = this;
            this._callFounder("getFounderAnalytics", {}).then(function (data) {
                if (!data || data.error) { return; }
                that._overall = data.overall || {};
                that._company = (data.company && data.company.name) || "Ccentrik";
                if (!that._dept && that._overall.departments && that._overall.departments.length) {
                    that._dept = that._overall.departments[0];
                }
                that._render();
            }).catch(function (e) {
                var h = that._host(); if (h) h.setContent("<div class='fdRoot'><div class='fdLoading'>Could not load executive analytics.</div></div>");
            });
        },

        _refreshDept: function () {
            var that = this;
            return this._callFounder("getDepartmentAnalytics", { department: this._dept, period: this._period })
                .then(function (data) {
                    if (!data || data.error) return;
                    that._deptData = data.department || {};
                    if (data.departments) that._deptNames = data.departments;
                    that._render();
                }).catch(function () { /* keep prior */ });
        },

        // ── Founder identity (for greeting/avatar) ──────────────────────────────
        _founderName: function () {
            var u = this.getOwnerComponent()._oCurrentUser;
            return (u && u.employeeName) ? u.employeeName : "Founder";
        },
        _initials: function (name) {
            var p = String(name || "F").trim().split(/\s+/);
            return ((p[0] && p[0][0]) || "F").toUpperCase() + (p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0].toUpperCase() : "");
        },

        // ── Host ────────────────────────────────────────────────────────────────
        _host: function () { return this.byId("founderHost"); },

        _render: function () {
            if (!this._overall) return;
            var o = this._overall;
            var name = this._founderName();
            var html = "<div class='fdRoot'>";
            html += this._buildHeader();
            html += "<div class='fdWrap'>";
            html += this._buildBanner(o, name);
            html += this._buildHero(o);
            html += this._buildToggle();
            html += (this._view === "overall") ? this._buildOverall(o) : this._buildDepartment();
            html += "</div></div>";

            var h = this._host();
            if (!h) return;
            // Render, then initialise charts + wire selects once the DOM actually exists.
            h.setContent(html);
            var that = this;
            this._afterHostRender(function () { that._initCharts(); that._wireSelects(); });
        },

        // Runs cb once the host's re-rendered DOM contains a <canvas> (or gives up on an
        // error/empty state). Reliable across UI5's async core:HTML rendering — a fixed
        // setTimeout races the render and can silently skip drawing.
        _afterHostRender: function (cb) {
            var that = this, n = 0;
            var tick = function () {
                var dom = that._host() && that._host().getDomRef();
                if (dom && dom.querySelector("canvas")) return cb();
                if (++n > 60) return;
                window.requestAnimationFrame(tick);
            };
            window.requestAnimationFrame(tick);
        },

        // ── Header ──────────────────────────────────────────────────────────────
        _buildHeader: function () {
            var name = this._founderName();
            return "" +
                "<div class='fdHeader'>" +
                  "<div class='fdBrand'>" +
                    "<img class='fdLogoImg' src='" + FP.logoUrl() + "' alt='Ccentrik'/>" +
                    "<div><div class='fdBrandName'>" + esc(this._company || "Ccentrik") + "</div>" +
                    "<div class='fdBrandSub'>Executive Command Center</div></div>" +
                  "</div>" +
                  "<div class='fdHeadActions'>" +
                    "<div class='fdIconBtn' title='Company Newsletter' onclick=\"window.FShell&&window.FShell.newsletter()\">\u{1F4F0}</div>" +
                    "<div class='fdIconBtn' title='Notifications' onclick=\"window.FShell&&window.FShell.notifications()\">\u{1F514}<span class='fdDot'></span></div>" +
                    "<div class='fdIconBtn' title='Upload profile picture' onclick=\"window.FShell&&window.FShell.uploadPhoto()\">\u{1F4F7}</div>" +
                    "<div class='fdIconBtn' title='Settings' onclick=\"window.FShell&&window.FShell.settings()\">⚙️</div>" +
                    FP.shell.avatarHtml({ title: name, onclick: "window.FShell&&window.FShell.settings()" }) +
                  "</div>" +
                "</div>";
        },

        // ── Welcome banner ──────────────────────────────────────────────────────
        _buildBanner: function (o, name) {
            var first = String(name).trim().split(/\s+/)[0];
            var eff = o.healthScore || 0;
            var growth = (o.rating && o.rating.growthPct) || 0;
            return "" +
                "<div class='fdBanner'>" +
                  "<div>" +
                    "<div class='fdGreeting'>" + greetWord() + ", <span>" + esc(first) + "</span></div>" +
                    "<div class='fdSubtitle'>Your organization is operating at <b style='color:#fff'>" + eff + "% efficiency</b> today.</div>" +
                  "</div>" +
                  "<div class='fdBannerStats'>" +
                    this._miniStat("Company Health", eff, (o.healthTrendPct >= 0 ? "+" : "") + (o.healthTrendPct || 0) + "%") +
                    this._miniStat("Productivity", (o.productivityScore || 0), "") +
                    this._miniStat("Org Growth", (growth >= 0 ? "+" : "") + growth + "%", "") +
                  "</div>" +
                "</div>";
        },
        _miniStat: function (label, value, up) {
            return "<div class='fdMiniStat fdGlass'><div class='v'>" + esc(value) + "</div>" +
                "<div class='l'>" + esc(label) + (up ? " <span class='up'>" + esc(up) + "</span>" : "") + "</div></div>";
        },

        // ── Hero: health ring + AI insights ─────────────────────────────────────
        _buildHero: function (o) {
            var score = o.healthScore || 0;
            var status = o.healthStatus || "—";
            var col = statusColor(status);
            var R = 88, C = 2 * Math.PI * R, off = C * (1 - score / 100);
            var ring =
                "<svg width='210' height='210' viewBox='0 0 210 210'>" +
                  "<circle cx='105' cy='105' r='" + R + "' stroke='rgba(255,255,255,0.10)' stroke-width='16' fill='none'/>" +
                  "<circle cx='105' cy='105' r='" + R + "' stroke='" + col + "' stroke-width='16' fill='none'" +
                    " stroke-linecap='round' stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + off.toFixed(1) + "'" +
                    " style='filter:drop-shadow(0 0 10px " + col + "88);transition:stroke-dashoffset 1s ease'/>" +
                "</svg>";
            var trend = (o.healthTrendPct >= 0 ? "+" : "") + (o.healthTrendPct || 0) + "% from last month";

            var hero = "<div class='fdHero'>";
            hero += "<div class='fdHealthCard fdGlass'>" +
                "<div class='fdHealthTitle'>Company Health Score</div>" +
                "<div class='fdRing'>" + ring +
                  "<div class='fdRingNum'><div class='fdScore'>" + score + "</div><div class='fdScoreMax'>/ 100</div></div>" +
                "</div>" +
                "<div class='fdHealthStatus' style='color:" + col + "'>" + esc(status) + "</div>" +
                "<div class='fdHealthTrend'>↑ " + esc(trend) + "</div>" +
                "</div>";

            hero += "<div class='fdInsightCard fdGlass'>" +
                "<div class='fdInsightHead'><span class='fdInsightBadge'>AI Insights</span>" +
                "<span class='fdInsightTitle'>Organizational Summary</span></div>" +
                "<div class='fdInsightText'>" + esc(o.aiInsight || "") + "</div>" +
                "</div>";
            hero += "</div>";
            return hero;
        },

        // ── Toggle ──────────────────────────────────────────────────────────────
        _buildToggle: function () {
            var ov = this._view === "overall" ? "active" : "";
            var dv = this._view === "department" ? "active" : "";
            return "<div class='fdToggleRow'>" +
                "<div class='fdToggle fdGlass'>" +
                  "<button class='" + ov + "' onclick=\"window._fdCtrl&&window._fdCtrl.onToggle('overall')\">Overall</button>" +
                  "<button class='" + dv + "' onclick=\"window._fdCtrl&&window._fdCtrl.onToggle('department')\">Department</button>" +
                "</div>" +
                "<div class='fdLiveTag'><span class='fdLiveDot'></span> Live — auto-updating</div>" +
                "</div>";
        },

        // ── Overall view ────────────────────────────────────────────────────────
        _buildOverall: function (o) {
            var h = "<div class='fdSection'>";
            h += this._buildKpis(o);

            // Row 1: line charts
            h += "<div class='fdGrid2'>" +
                this._chartCard("Performance Trend", "Monthly average ratings", "fdc_perf") +
                this._chartCard("Task Completion Trend", "Monthly completion %", "fdc_taskTrend") +
                "</div>";
            // Row 2: donuts
            h += "<div class='fdGrid2'>" +
                this._chartCard("Leave Analytics", "By leave type", "fdc_leave", "sm") +
                this._chartCard("Task Status Distribution", "Across the organization", "fdc_taskStatus", "sm") +
                "</div>";
            // Row 3: department ranking bar
            h += "<div class='fdGrid1'>" +
                this._chartCard("Department Performance Ranking", "Ratings · Task completion · Compliance", "fdc_deptRank") +
                "</div>";
            // Row 4: heatmap
            h += "<div class='fdCard fdGlass fdGrid1' style='display:block'>" +
                "<div class='fdCardHead'><div class='fdCardTitle'>Organizational Heatmap</div>" +
                "<div class='fdCardSub'>Department health</div></div>" + this._buildHeatmap(o) + "</div>";
            // Row 5: leaderboard
            h += "<div class='fdCard fdGlass fdGrid1' style='display:block'>" +
                "<div class='fdCardHead'><div class='fdCardTitle'>Top Performing Departments</div></div>" +
                this._buildLeaderboard(o) + "</div>";

            // Risk center
            h += this._buildRisk(o);
            h += "</div>";
            return h;
        },

        _buildKpis: function (o) {
            var e = o.employees || {}, r = o.rating || {}, t = o.tasks || {}, ts = o.timesheet || {}, l = o.leave || {};
            function card(ico, bg, label, value, sub, anim) {
                return "<div class='fdKpi fdGlass' style='animation-delay:" + anim + "ms'>" +
                    "<div class='k-top'><div class='k-ico' style='background:" + bg + "33;color:" + bg + "'>" + ico + "</div></div>" +
                    "<div class='k-label'>" + esc(label) + "</div><div class='k-value'>" + esc(value) + "</div>" +
                    "<div class='k-sub'>" + sub + "</div></div>";
            }
            var growth = r.growthPct || 0;
            return "<div class='fdKpis'>" +
                card("\u{1F465}", "#6366f1", "Active Employees", (e.active || 0), "<span>Total " + (e.total || 0) + "</span><span>Inactive " + (e.inactive || 0) + "</span>", 0) +
                card("⭐", "#f59e0b", "Average Rating", (r.current || 0).toFixed(2), "<span>Prev " + (r.previous || 0).toFixed(2) + "</span><span class='" + (growth >= 0 ? "pos" : "neg") + "'>" + (growth >= 0 ? "+" : "") + growth + "%</span>", 60) +
                card("✅", "#34d399", "Task Completion", (t.completedPct || 0) + "%", "<span>In Prog " + (t.inProgressPct || 0) + "%</span><span class='neg'>Overdue " + (t.overduePct || 0) + "%</span>", 120) +
                card("\u{1F4CB}", "#38bdf8", "Timesheet Compliance", (ts.submittedPct || 0) + "%", "<span class='neg'>Missing " + (ts.missingPct || 0) + "%</span>", 180) +
                card("\u{1F334}", "#a78bfa", "Leave Utilization", (l.usedPct || 0) + "%", "<span>Available " + (l.availablePct || 0) + "%</span>", 240) +
                card("⚡", "#fb7185", "Productivity Score", (o.productivityScore || 0), "<span>out of 100</span>", 300) +
                "</div>";
        },

        _chartCard: function (title, sub, canvasId, sz) {
            return "<div class='fdCard fdGlass'>" +
                "<div class='fdCardHead'><div class='fdCardTitle'>" + esc(title) + "</div><div class='fdCardSub'>" + esc(sub) + "</div></div>" +
                "<div class='fdChartBox " + (sz || "") + "'><canvas id='" + canvasId + "'></canvas></div></div>";
        },

        _buildHeatmap: function (o) {
            var cells = (o.heatmap || []).map(function (d) {
                return "<div class='fdHeatCell fdHeat-" + esc(d.color) + "'><div class='hd'>" + esc(d.department) + "</div>" +
                    "<div class='hs'>" + (d.healthScore || 0) + "</div><div class='hl'>" + esc(d.status) + "</div></div>";
            }).join("");
            return "<div class='fdHeat'>" + (cells || "<div class='fdCardSub'>No department data.</div>") + "</div>";
        },

        _buildLeaderboard: function (o) {
            var rows = (o.topDepartments || []).map(function (d) {
                var rk = d.rank <= 3 ? ("fdRank-" + d.rank) : "fdRank-n";
                return "<tr><td><span class='fdRank " + rk + "'>" + d.rank + "</span></td>" +
                    "<td style='font-weight:700;color:#fff'>" + esc(d.department) + "</td>" +
                    "<td>" + (d.healthScore || 0) + "</td><td>" + (d.taskCompletion || 0) + "%</td><td>" + (d.avgRating || 0).toFixed(2) + "</td></tr>";
            }).join("");
            return "<table class='fdLead'><thead><tr><th>Rank</th><th>Department</th><th>Health</th><th>Task %</th><th>Avg Rating</th></tr></thead>" +
                "<tbody>" + (rows || "<tr><td colspan='5' class='fdCardSub'>No data.</td></tr>") + "</tbody></table>";
        },

        _buildRisk: function (o) {
            var rc = o.riskCenter || {};
            function item(value, label, cls, tags) {
                return "<div class='fdRiskItem " + (cls || "") + "'><div class='rv'>" + esc(value) + "</div><div class='rl'>" + esc(label) + "</div>" +
                    (tags ? "<div class='rtags'>" + esc(tags) + "</div>" : "") + "</div>";
            }
            return "<div class='fdRisk fdGlass'>" +
                "<div class='fdRiskHead'>⚠️<span class='t'>Executive Risk Center</span><span class='b'>Founder Only</span></div>" +
                "<div class='fdRiskGrid'>" +
                  item(rc.overdueTasks || 0, "Overdue Tasks", (rc.overdueTasks > 0 ? "crit" : "")) +
                  item(rc.missingTimesheets || 0, "Missing Timesheets", (rc.missingTimesheets > 0 ? "warn" : "")) +
                  item((rc.lowPerformingDepartments || []).length, "Low Performing Depts", ((rc.lowPerformingDepartments || []).length ? "crit" : ""), (rc.lowPerformingDepartments || []).join(", ")) +
                  item((rc.excessiveLeave || []).length, "Excessive Leave", ((rc.excessiveLeave || []).length ? "warn" : ""), (rc.excessiveLeave || []).join(", ")) +
                  item(rc.inactiveEmployees || 0, "Inactive Employees", (rc.inactiveEmployees > 0 ? "warn" : "")) +
                "</div></div>";
        },

        // ── Department view ─────────────────────────────────────────────────────
        _buildDepartment: function () {
            var depts = this._overall.departments || [];
            var d = this._deptData;
            var opts = depts.map(function (x) { return "<option value='" + esc(x) + "'" + (x === this._dept ? " selected" : "") + ">" + esc(x) + "</option>"; }.bind(this)).join("");
            var periods = ["Current Month", "Previous Month", "Quarter", "Year"].map(function (p) {
                return "<option value='" + esc(p) + "'" + (p === this._period ? " selected" : "") + ">" + esc(p) + "</option>";
            }.bind(this)).join("");

            // Employee picker (drill-down) — populated from the department roster.
            var emps = (d && d.employees) || [];
            var empOpts = "<option value=''>— Select an employee —</option>" + emps.map(function (e) {
                return "<option value='" + esc(e.employeeId) + "'" + (e.employeeId === this._emp ? " selected" : "") + ">" +
                    esc(e.employeeName) + (e.designation ? " · " + esc(e.designation) : "") + "</option>";
            }.bind(this)).join("");

            var h = "<div class='fdSection'>";
            h += "<div class='fdToggleRow'><div class='fdFilters'>" +
                "<select id='fdDeptSel' class='fdSelect'>" + opts + "</select>" +
                "<select id='fdPeriodSel' class='fdSelect'>" + periods + "</select>" +
                (emps.length ? "<select id='fdEmpSel' class='fdSelect'>" + empOpts + "</select>" : "") +
                "</div><div class='fdSectionTitle' style='margin:0'>" + esc(this._dept || "") + " Analytics</div></div>";

            if (!d) { h += "<div class='fdCard fdGlass'><div class='fdLoading'>Loading department analytics…</div></div></div>"; return h; }

            // If an employee is selected, show their personal drill-down instead.
            if (this._emp) {
                h += this._empData
                    ? this._buildEmployeeDetail(this._empData)
                    : "<div class='fdCard fdGlass'><div class='fdLoading'>Loading employee analytics…</div></div>";
                h += "</div>";
                return h;
            }

            var ov = d.overview || {};
            // Overview cards
            h += "<div class='fdKpis'>" +
                this._dcard("\u{1F465}", "#6366f1", "Total Employees", ov.total || 0) +
                this._dcard("✅", "#34d399", "Active", ov.active || 0) +
                this._dcard("⭐", "#f59e0b", "Avg Rating", (ov.avgRating || 0).toFixed(2)) +
                this._dcard("\u{1F4C8}", "#38bdf8", "Task Completion", (ov.taskCompletionPct || 0) + "%") +
                this._dcard("\u{1F4CB}", "#a78bfa", "Compliance", (ov.timesheetCompliancePct || 0) + "%") +
                this._dcard("\u{1F334}", "#fb7185", "Leave Used", (ov.leaveUtilizationPct || 0) + "%") +
                "</div>";
            h += "<div class='fdGrid2'>" +
                this._chartCard("Department Rating Trend", "Monthly", "fdc_dRate") +
                this._chartCard("Department Task Trend", "Monthly completion %", "fdc_dTask") +
                "</div>";
            h += "<div class='fdGrid2'>" +
                this._chartCard("Department Leave Analytics", "By type", "fdc_dLeave", "sm") +
                this._chartCard("Department Task Distribution", "Status", "fdc_dStatus", "sm") +
                "</div>";
            // Top 5 + risk
            h += "<div class='fdGrid2'>";
            var t5 = (d.top5 || []).map(function (p) {
                return "<tr><td style='color:#fff;font-weight:600'>" + esc(p.employeeName) + "</td><td>" + (p.rating || 0).toFixed(2) + "</td><td>" + (p.completedTasks || 0) + "</td></tr>";
            }).join("");
            h += "<div class='fdCard fdGlass' style='display:block'><div class='fdCardHead'><div class='fdCardTitle'>Top 5 Performers</div></div>" +
                "<table class='fdLead'><thead><tr><th>Employee</th><th>Rating</th><th>Completed</th></tr></thead><tbody>" +
                (t5 || "<tr><td colspan='3' class='fdCardSub'>No data.</td></tr>") + "</tbody></table></div>";
            var rk = d.risk || {};
            h += "<div class='fdRisk fdGlass' style='margin-top:0'><div class='fdRiskHead'>⚠️<span class='t'>Risk Indicators</span></div>" +
                "<div class='fdRiskGrid' style='grid-template-columns:repeat(2,1fr)'>" +
                  this._risk2((rk.lowRated || []).length, "Low Ratings", (rk.lowRated || []).join(", ")) +
                  this._risk2(rk.pendingReviews || 0, "Pending Reviews") +
                  this._risk2(rk.overdueTasks || 0, "Overdue Tasks") +
                  this._risk2(rk.missingTimesheets || 0, "Missing Timesheets") +
                "</div></div>";
            h += "</div>";

            h += "</div>";
            return h;
        },
        // ── Employee Executive Analytics (strategic profile, no raw records) ────
        _initials2: function (name) {
            var p = String(name || "?").trim().split(/\s+/);
            return ((p[0] && p[0][0]) || "?").toUpperCase() + (p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0].toUpperCase() : "");
        },
        _ringSvg: function (score, color, size) {
            var R = size === "sm" ? 64 : 88, W = size === "sm" ? 12 : 16, BX = R + W / 2 + 6;
            var C = 2 * Math.PI * R, off = C * (1 - (score || 0) / 100);
            return "<svg width='" + (BX * 2) + "' height='" + (BX * 2) + "' viewBox='0 0 " + (BX * 2) + " " + (BX * 2) + "'>" +
                "<circle cx='" + BX + "' cy='" + BX + "' r='" + R + "' stroke='rgba(255,255,255,0.10)' stroke-width='" + W + "' fill='none'/>" +
                "<circle cx='" + BX + "' cy='" + BX + "' r='" + R + "' stroke='" + color + "' stroke-width='" + W + "' fill='none' stroke-linecap='round'" +
                  " stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + off.toFixed(1) + "'" +
                  " style='filter:drop-shadow(0 0 8px " + color + "88);transition:stroke-dashoffset 1s ease'/></svg>";
        },
        _contribColor: function (band) {
            return band === "Top 5%" || band === "Top 10%" ? "#34d399" : band === "Top 25%" ? "#38bdf8" : band === "Average" ? "#fbbf24" : "#fb7185";
        },
        _riskColor: function (level) { return level === "Low Risk" ? "#34d399" : level === "Medium Risk" ? "#fbbf24" : "#fb7185"; },
        _cmp: function (emp, comp) {
            var diff = Math.round((emp - comp) * 10) / 10;
            if (diff > 0) return "<span class='fdCmp up'>▲ " + Math.abs(diff) + " vs company</span>";
            if (diff < 0) return "<span class='fdCmp down'>▼ " + Math.abs(diff) + " vs company</span>";
            return "<span class='fdCmp eq'>= at company avg</span>";
        },
        // Executive KPI card: big employee value + dept/company benchmarks.
        _ekpi: function (ico, color, label, empVal, deptVal, coVal, suffix) {
            suffix = suffix || "";
            return "<div class='fdEkpi fdGlass'>" +
                "<div class='fdEkpiTop'><div class='k-ico' style='background:" + color + "33;color:" + color + "'>" + ico + "</div>" +
                  "<div class='fdEkpiLabel'>" + esc(label) + "</div></div>" +
                "<div class='fdEkpiVal'>" + esc(empVal) + suffix + "</div>" +
                this._cmp(parseFloat(empVal), parseFloat(coVal)) +
                "<div class='fdEkpiBench'><span>Dept <b>" + esc(deptVal) + suffix + "</b></span><span>Company <b>" + esc(coVal) + suffix + "</b></span></div>" +
                "</div>";
        },
        // One benchmark block: 3 bars (employee / department / company).
        _benchBlock: function (title, b, max, suffix, color) {
            suffix = suffix || "";
            var bar = function (lbl, val, c) {
                var w = Math.max(2, Math.min(100, (val / max) * 100));
                return "<div class='fdBenchRow'><span class='fdBenchLbl'>" + lbl + "</span>" +
                    "<div class='fdBenchTrack'><div class='fdBenchFill' style='width:" + w + "%;background:" + c + "'></div></div>" +
                    "<span class='fdBenchVal'>" + val + suffix + "</span></div>";
            };
            return "<div class='fdCard fdGlass' style='display:block'>" +
                "<div class='fdCardHead'><div class='fdCardTitle'>" + esc(title) + "</div></div>" +
                bar("Employee", b.employee, color) +
                bar("Department", b.department, "#8ea0c8") +
                bar("Company", b.company, "#6366f1") + "</div>";
        },
        _buildEmployeeDetail: function (e) {
            var k = e.kpis || {}, bm = e.benchmarks || {}, ct = e.contribution || {}, rk = e.risk || {};
            var hColor = statusColor(e.healthStatus);
            var cColor = this._contribColor(ct.band);
            var rColor = this._riskColor(rk.level);

            // Profile strip
            var h = "<div class='fdEmpHead fdGlass'>" +
                "<button class='fdEmpBack' onclick=\"window._fdCtrl&&window._fdCtrl.onEmpBack()\">← Back to " + esc(e.department || "Department") + "</button>" +
                "<div class='fdEmpProfile'>" +
                  "<div class='fdEmpAvatar'>" + esc(this._initials2(e.employeeName)) + "</div>" +
                  "<div><div class='fdEmpName'>" + esc(e.employeeName) +
                    " <span class='fdPillStatus " + (e.isActive ? "ok" : "crit") + "'>" + (e.isActive ? "Active" : "Inactive") + "</span></div>" +
                    "<div class='fdEmpMeta'>" + esc(e.designation || "—") + " · " + esc(e.department || "—") +
                    (e.joiningDate ? " · Joined " + esc(e.joiningDate) : "") + " · " + esc(e.employeeId) + "</div></div>" +
                "</div></div>";

            // Hero: health ring + executive insight
            h += "<div class='fdHero'>";
            h += "<div class='fdHealthCard fdGlass'>" +
                "<div class='fdHealthTitle'>Employee Health Score</div>" +
                "<div class='fdRing'>" + this._ringSvg(e.healthScore, hColor) +
                  "<div class='fdRingNum'><div class='fdScore'>" + (e.healthScore || 0) + "</div><div class='fdScoreMax'>/ 100</div></div></div>" +
                "<div class='fdHealthStatus' style='color:" + hColor + "'>" + esc(e.healthStatus || "—") + "</div>" +
                "<div class='fdEmpBadges'>" +
                  "<span class='fdEmpBadge' style='background:" + cColor + "22;color:" + cColor + ";border-color:" + cColor + "55'>" + esc(ct.label || "—") + "</span>" +
                  "<span class='fdEmpBadge' style='background:" + rColor + "22;color:" + rColor + ";border-color:" + rColor + "55'>" + esc(rk.level || "—") + "</span>" +
                "</div></div>";
            h += "<div class='fdInsightCard fdGlass'>" +
                "<div class='fdInsightHead'><span class='fdInsightBadge'>Executive Insight</span>" +
                "<span class='fdInsightTitle'>Strategic Summary</span></div>" +
                "<div class='fdInsightText'>" + esc(e.insight || "") + "</div></div>";
            h += "</div>";

            // Executive KPI cards
            h += "<div class='fdEkpis'>" +
                this._ekpi("⭐", "#f59e0b", "Performance Rating", (k.rating.employee || 0).toFixed(2), (k.rating.department || 0).toFixed(2), (k.rating.company || 0).toFixed(2)) +
                this._ekpi("⚡", "#38bdf8", "Productivity Score", (k.productivity.employee || 0), (k.productivity.department || 0), (k.productivity.company || 0)) +
                this._ekpi("\u{1F6E1}️", "#34d399", "Reliability Score", (k.reliability.employee || 0), (k.reliability.department || 0), (k.reliability.company || 0)) +
                this._contribCard(ct, cColor) +
                "</div>";

            // Benchmark comparison
            h += "<div class='fdSectionTitle'>Benchmark Comparison</div>";
            h += "<div class='fdGrid2'>" +
                this._benchBlock("Rating", bm.rating, 100, "%", "#f59e0b") +
                this._benchBlock("Productivity", bm.productivity, 100, "", "#38bdf8") + "</div>";
            h += "<div class='fdGrid2'>" +
                this._benchBlock("Reliability", bm.reliability, 100, "", "#34d399") +
                this._benchBlock("Leave Utilization", bm.leaveUtil, 100, "%", "#a78bfa") + "</div>";

            // Performance trends
            h += "<div class='fdSectionTitle'>Performance Trends</div>";
            h += "<div class='fdGrid2'>" +
                this._chartCard("Health Score Trend", "Monthly", "fdc_empHealth") +
                this._chartCard("Productivity Trend", "Monthly", "fdc_empProd") + "</div>";
            h += "<div class='fdGrid1'>" +
                this._chartCard("Reliability Trend", "Monthly — discipline & compliance", "fdc_empRel") + "</div>";

            // Risk assessment
            var factors = (rk.factors || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("");
            h += "<div class='fdRisk fdGlass'>" +
                "<div class='fdRiskHead'>⚠️<span class='t'>Risk Assessment</span>" +
                "<span class='b' style='background:" + rColor + "22;color:" + rColor + "'>" + esc(rk.level || "—") + "</span></div>" +
                (factors ? "<ul class='fdRiskList'>" + factors + "</ul>"
                         : "<div class='fdCardSub' style='padding:6px 2px'>No operational risks identified — metrics are within healthy ranges.</div>") +
                "</div>";

            return h;
        },
        _contribCard: function (ct, color) {
            return "<div class='fdEkpi fdGlass'>" +
                "<div class='fdEkpiTop'><div class='k-ico' style='background:" + color + "33;color:" + color + "'>\u{1F3C6}</div>" +
                  "<div class='fdEkpiLabel'>Contribution</div></div>" +
                "<div class='fdEkpiVal' style='color:" + color + "'>" + esc(ct.band || "—") + "</div>" +
                "<div class='fdContribLabel'>" + esc(ct.label || "") + "</div>" +
                "<div class='fdEkpiBench'><span>Composite score <b>" + (ct.score || 0) + "</b></span></div>" +
                "</div>";
        },

        _dcard: function (ico, bg, label, value) {
            return "<div class='fdKpi fdGlass'><div class='k-top'><div class='k-ico' style='background:" + bg + "33;color:" + bg + "'>" + ico + "</div></div>" +
                "<div class='k-label'>" + esc(label) + "</div><div class='k-value'>" + esc(value) + "</div></div>";
        },
        _risk2: function (v, l, tags) {
            return "<div class='fdRiskItem " + (v > 0 ? "warn" : "") + "'><div class='rv'>" + esc(v) + "</div><div class='rl'>" + esc(l) + "</div>" + (tags ? "<div class='rtags'>" + esc(tags) + "</div>" : "") + "</div>";
        },

        // ── Charts ──────────────────────────────────────────────────────────────
        _destroyCharts: function () {
            (this._charts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /**/ } });
            this._charts = [];
        },
        _ctx: function (id) { var el = document.getElementById(id); return el ? el.getContext("2d") : null; },
        _initCharts: function () {
            this._destroyCharts();
            if (!window.Chart) { return; }  // CDN blocked → KPIs/tables still work
            var C = window.Chart;
            C.defaults.color = "#9fb0d6";
            C.defaults.font.family = "Inter, Segoe UI, Arial, sans-serif";
            var grid = { color: "rgba(255,255,255,0.06)" };
            var noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
            var donutOpts = { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 14 } } } };

            if (this._view === "overall" && this._overall) {
                var o = this._overall;
                this._line("fdc_perf", (o.performanceTrend || []).map(function (x) { return x.label; }),
                    (o.performanceTrend || []).map(function (x) { return x.value; }), "#a78bfa", noLegend, grid, 5);
                this._line("fdc_taskTrend", (o.taskCompletionTrend || []).map(function (x) { return x.label; }),
                    (o.taskCompletionTrend || []).map(function (x) { return x.value; }), "#38bdf8", noLegend, grid, 100);
                var lv = o.leaveAnalytics || {};
                this._donut("fdc_leave", ["Casual", "Sick", "Earned", "Other"], [lv.Casual || 0, lv.Sick || 0, lv.Earned || 0, lv.Other || 0],
                    ["#6366f1", "#fb7185", "#34d399", "#fbbf24"], donutOpts);
                var sd = o.taskStatusDistribution || {};
                this._donut("fdc_taskStatus", ["Completed", "In Progress", "Pending", "Overdue"], [sd.completed || 0, sd.inProgress || 0, sd.pending || 0, sd.overdue || 0],
                    ["#34d399", "#38bdf8", "#fbbf24", "#fb7185"], donutOpts);
                this._deptRankChart(o, grid);
            } else if (this._view === "department" && this._emp && this._empData) {
                var tr = this._empData.trends || {}, lbl = tr.months || [];
                this._line("fdc_empHealth", lbl, tr.health || [], "#34d399", noLegend, grid, 100);
                this._line("fdc_empProd", lbl, tr.productivity || [], "#38bdf8", noLegend, grid, 100);
                this._line("fdc_empRel", lbl, tr.reliability || [], "#a78bfa", noLegend, grid, 100);
            } else if (this._view === "department" && this._deptData) {
                var d = this._deptData;
                this._line("fdc_dRate", (d.ratingTrend || []).map(function (x) { return x.label; }),
                    (d.ratingTrend || []).map(function (x) { return x.value; }), "#a78bfa", noLegend, grid, 5);
                this._line("fdc_dTask", (d.taskCompletionTrend || []).map(function (x) { return x.label; }),
                    (d.taskCompletionTrend || []).map(function (x) { return x.value; }), "#38bdf8", noLegend, grid, 100);
                var dl = d.leaveAnalytics || {};
                this._donut("fdc_dLeave", ["Casual", "Sick", "Earned", "Other"], [dl.Casual || 0, dl.Sick || 0, dl.Earned || 0, dl.Other || 0],
                    ["#6366f1", "#fb7185", "#34d399", "#fbbf24"], donutOpts);
                var ds = d.taskStatusDistribution || {};
                this._donut("fdc_dStatus", ["Completed", "In Progress", "Pending", "Overdue"], [ds.completed || 0, ds.inProgress || 0, ds.pending || 0, ds.overdue || 0],
                    ["#34d399", "#38bdf8", "#fbbf24", "#fb7185"], donutOpts);
            }
        },
        _line: function (id, labels, data, color, baseOpts, grid, maxY) {
            var ctx = this._ctx(id); if (!ctx) return;
            var g = ctx.createLinearGradient(0, 0, 0, 260);
            g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
            var opts = Object.assign({}, baseOpts, { scales: { y: { beginAtZero: true, suggestedMax: maxY, grid: grid }, x: { grid: { display: false } } } });
            this._charts.push(new window.Chart(ctx, {
                type: "line",
                data: { labels: labels, datasets: [{ data: data, borderColor: color, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 3, pointBackgroundColor: color, spanGaps: true }] },
                options: opts
            }));
        },
        _donut: function (id, labels, data, colors, opts) {
            var ctx = this._ctx(id); if (!ctx) return;
            this._charts.push(new window.Chart(ctx, {
                type: "doughnut",
                data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: "rgba(11,16,32,0.6)", borderWidth: 2 }] },
                options: opts
            }));
        },
        _deptRankChart: function (o, grid) {
            var ctx = this._ctx("fdc_deptRank"); if (!ctx) return;
            var ranks = o.departmentRanking || [];
            var labels = ranks.map(function (r) { return r.department; });
            this._charts.push(new window.Chart(ctx, {
                type: "bar",
                data: {
                    labels: labels,
                    datasets: [
                        { label: "Rating (x20)", data: ranks.map(function (r) { return Math.round((r.rating || 0) * 20); }), backgroundColor: "#a78bfa" },
                        { label: "Task %", data: ranks.map(function (r) { return r.taskCompletion || 0; }), backgroundColor: "#34d399" },
                        { label: "Compliance %", data: ranks.map(function (r) { return r.timesheetCompliance || 0; }), backgroundColor: "#38bdf8" }
                    ]
                },
                options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } } }, scales: { y: { beginAtZero: true, max: 100, grid: grid }, x: { grid: { display: false } } } }
            }));
        },

        // ── Interactivity ───────────────────────────────────────────────────────
        _wireSelects: function () {
            var that = this;
            var ds = document.getElementById("fdDeptSel");
            if (ds) ds.onchange = function () { that._dept = this.value; that._deptData = null; that._emp = null; that._empData = null; that._render(); that._refreshDept(); };
            var ps = document.getElementById("fdPeriodSel");
            if (ps) ps.onchange = function () { that._period = this.value; that._refreshDept(); };
            var es = document.getElementById("fdEmpSel");
            if (es) es.onchange = function () {
                that._emp = this.value || null; that._empData = null; that._render();
                if (that._emp) that._refreshEmp();
            };
        },
        _refreshEmp: function () {
            var that = this;
            return this._callFounder("getEmployeeAnalytics", { employeeId: this._emp })
                .then(function (data) {
                    if (!data || data.error) { return; }
                    that._empData = data.employee || {}; that._render();
                }).catch(function () { /* keep prior */ });
        },
        onEmpBack: function () { this._emp = null; this._empData = null; this._render(); },
        onToggle: function (view) {
            if (this._view === view) return;
            this._view = view;
            if (view === "department" && !this._deptData) { this._render(); this._refreshDept(); }
            else { this._render(); }
        },
        onNotifications: function () { if (window.FShell) window.FShell.notifications(); },
        onSettings: function () { if (window.FShell) window.FShell.settings(); },
        onProfile: function () { if (window.FShell) window.FShell.settings(); },

        // ── Chart.js loader ─────────────────────────────────────────────────────
        _loadChartJs: function () {
            if (window.Chart) return Promise.resolve(window.Chart);
            if (this._pChart) return this._pChart;
            var that = this;
            this._pChart = new Promise(function (resolve) {
                var s = document.createElement("script");
                s.src = CHARTJS_URL; s.async = true;
                s.onload = function () { resolve(window.Chart); if (that._overall || that._deptData) that._initCharts(); };
                s.onerror = function () { that._pChart = null; resolve(null); };  // graceful: KPIs/tables still render
                document.head.appendChild(s);
            });
            return this._pChart;
        },

        // ── Real-time ───────────────────────────────────────────────────────────
        _connectSSE: function () {
            if (this._es || typeof EventSource === "undefined") return;
            var that = this;
            try {
                this._es = new EventSource("/founder-stream", { withCredentials: true });
                this._es.addEventListener("ping", function () { that._debouncedRefresh(); });
                this._es.onerror = function () { /* browser auto-reconnects; polling covers gaps */ };
            } catch (e) { this._es = null; }
        },
        _debouncedRefresh: function () {
            var that = this;
            if (this._rt) clearTimeout(this._rt);
            this._rt = setTimeout(function () {
                that._refresh();
                if (that._view === "department") { that._refreshDept(); if (that._emp) that._refreshEmp(); }
            }, 700);
        },
        _startPolling: function () {
            if (this._poll) return;
            var that = this;
            this._poll = setInterval(function () {
                if (!/founder-dashboard/.test(window.location.hash || "")) return;
                that._refresh();
                if (that._view === "department") that._refreshDept();
            }, 45000);
        }
    });
});
