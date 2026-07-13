sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "timesheet/app/util/ProjectChat"
], function (Controller, MessageToast, ProjectChat) {
    "use strict";

    function ppost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    var PRIORITIES = ["Low", "Medium", "High", "Critical"];
    var BANDWIDTHS = [25, 50, 75, 100];
    var TASK_STATUSES = ["Not Started", "In Progress", "In Review", "Completed", "Blocked"];
    var MTG_STATUS_COLOR = { Scheduled: "#2563eb", Completed: "#16a34a", Cancelled: "#dc2626" };

    function pprojpost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }

    return Controller.extend("timesheet.app.controller.Projects", {
        onInit: function () {
            window._projCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("projects").attachPatternMatched(this._onMatched, this);
        },
        onExit: function () {
            if (this._projChat) { this._projChat.destroy(); this._projChat = null; }
            (this._pmCharts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /* */ } });
            this._pmCharts = [];
            if (window._projCtrl === this) window._projCtrl = null;
        },
        _onMatched: function () {
            this._detail = null;
            // Deep-link from a notification: open the specific project directly.
            var comp = this.getOwnerComponent();
            var openId = comp._openProjectId; comp._openProjectId = null;
            if (openId) { this._view = "detail"; this._open(openId); }
            else { this._view = "list"; this._load(); }
        },
        _host: function () { return this.byId("projHost"); },

        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='pmWrap'><div class='pmLoading'>Loading projects…</div></div>");
            ppost("getProjects", {}).then(function (d) { that._data = d || { projects: [] }; that._view = "list"; that._render(); })
                .catch(function () { that._data = { projects: [] }; that._render(); });
        },
        _open: function (projectId) {
            var that = this;
            ppost("getProjectDetail", { projectId: projectId }).then(function (d) {
                if (d && d.error) {
                    // Record gone / inaccessible → friendly message, fall back to list.
                    MessageToast.show(/not found|no longer|access/i.test(d.error) ? "This item is no longer available." : d.error);
                    that._view = "list"; that._load();
                    return;
                }
                that._detail = d; that._planning = null; that._budgetReqs = null; that._forecast = null; that._pmDash = null; that._avail = null; that._view = "detail"; that._render();
                // PM Dashboard summary (KPIs/health/charts) rendered inline on the Overview tab.
                pprojpost("getPmDashboard", { projectId: projectId }).then(function (pm) {
                    that._pmDash = (pm && !pm.error) ? pm : { error: (pm && pm.error) || "unavailable" };
                    if ((that._detailTab || "overview") === "overview") that._render();
                }).catch(function () { that._pmDash = { error: "unavailable" }; if ((that._detailTab || "overview") === "overview") that._render(); });
                // Operational resource-planning indicators (capacity/utilization, no money).
                ppost("getProjectResourcePlanning", { projectId: projectId }).then(function (rp) {
                    that._planning = (rp && !rp.error) ? rp : null;
                    if (that._detailTab === "resources") that._render();
                }).catch(function () { that._planning = null; });
                // Multi-month capacity forecast over the project's duration.
                ppost("getProjectCapacityForecast", { projectId: projectId }).then(function (fc) {
                    that._forecast = (fc && !fc.error) ? fc : null;
                    if (that._detailTab === "resources") that._render();
                }).catch(function () { that._forecast = null; });
                // Additional-budget requests (POC sees own requested/approved amounts only).
                ppost("getMyBudgetRequests", { projectId: projectId }).then(function (br) {
                    that._budgetReqs = (br && !br.error) ? br : null;
                    if (that._detailTab === "resources") that._render();
                }).catch(function () { that._budgetReqs = null; });
            });
        },

        _render: function () {
            var h = this._host(); if (!h) return;
            if (this._view === "detail" && this._detail) {
                this._attachChartDelegate();
                h.setContent(this._renderDetail());
                // Charts are (re)drawn by the host's afterRendering delegate once the
                // DOM is live; here we just make sure the Chart.js lib is loading.
                if ((this._detailTab || "overview") === "overview" && this._pmDash && !this._pmDash.error && !window.Chart) this._ensureChartLib();
                return;
            }
            var list = (this._data && this._data.projects) || [];
            var header = "<div class='pmHeader'><div class='pmTitle'>My Projects</div>" +
                "<div class='pmSub'>Projects you lead or are allocated to</div></div>";
            var cards = list.length ? list.map(this._card.bind(this)).join("")
                : "<div class='pmEmpty'>You are not part of any project yet.</div>";
            h.setContent("<div class='pmWrap'>" + header + "<div class='pmCards'>" + cards + "</div></div>");
        },
        _bar: function (pct) {
            return "<div class='pmBar'><div class='pmBarFill' style='width:" + (pct || 0) + "%'></div></div>" +
                "<div class='pmBarLbl'>" + (pct || 0) + "% complete</div>";
        },
        _statusChip: function (s) {
            var bg = s === "Completed" ? "#dcfce7" : s === "On Hold" || s === "Cancelled" ? "#fef9c3" : "#dbeafe";
            var fg = s === "Completed" ? "#16a34a" : s === "On Hold" || s === "Cancelled" ? "#a16207" : "#2563eb";
            return "<span class='pmChip' style='background:" + bg + ";color:" + fg + "'>" + esc(s) + "</span>";
        },
        _card: function (p) {
            var poc = (this._data.isPocOf || []).indexOf(p.projectId) !== -1;
            var lcBadge = "";
            if (p.status === "Planning" && poc) {
                var lcLabels = { Planning: "Awaiting Meeting", MeetingScheduled: "Meeting Scheduled", MeetingCompleted: "Meeting Done", BudgetAllocated: "Allocate Resources" };
                var lc = lcLabels[p.lifecycleStage] || (p.lifecycleStage || "Planning");
                lcBadge = "<div class='pmLcBadge'>" + lc + "</div>";
            }
            return "<div class='pmCard' onclick=\"window._projCtrl.onOpen('" + esc(p.projectId) + "')\">" +
                "<div class='pmCardTop'><div class='pmCardName'>" + esc(p.projectName) +
                (poc ? " <span class='pmPoc'>POC</span>" : "") + "</div>" + this._statusChip(p.status) + "</div>" +
                lcBadge +
                "<div class='pmCardMeta'>" + esc(p.customerName || "—") + " · " + esc(p.projectId) + " · " + esc(p.priority) + "</div>" +
                this._bar(p.progress) + "<div class='pmCardFoot'>" + (p.taskCount || 0) + " task(s)</div></div>";
        },

        // ── PM Dashboard (rendered inline on the Overview tab, light theme) ──────
        _pmMoney: function (n) { n = Number(n) || 0; var a = Math.abs(n); if (a >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr"; if (a >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L"; if (a >= 1e3) return "₹" + (n / 1e3).toFixed(1) + " K"; return "₹" + n; },
        // Clean line-icon set (professional; no emojis).
        _pmSvg: function (k, sz) {
            sz = sz || 16;
            var P = {
                progress: "<path d='M3 3v18h18'/><rect x='7' y='11' width='3' height='7' rx='1'/><rect x='12' y='7' width='3' height='11' rx='1'/><rect x='17' y='13' width='3' height='5' rx='1'/>",
                health: "<path d='M22 12h-4l-3 8-4-16-3 8H4'/>",
                clock: "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
                wallet: "<rect x='3' y='6' width='18' height='13' rx='2'/><path d='M16 12h3'/><path d='M3 8V6a2 2 0 0 1 2-2h11'/>",
                users: "<path d='M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='8' r='4'/><path d='M22 20v-2a4 4 0 0 0-3-3.9'/>",
                alert: "<path d='M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z'/><path d='M12 9v4'/><path d='M12 17h.01'/>",
                bug: "<rect x='8' y='6' width='8' height='14' rx='4'/><path d='M8 12H4M20 12h-4M8 8 5 5M16 8l3-3M9 20l-2 2M15 20l2 2'/>",
                check: "<circle cx='12' cy='12' r='9'/><path d='m8 12 3 3 5-6'/>",
                flag: "<path d='M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z'/><path d='M4 22V4'/>",
                list: "<rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 8h8M8 12h8M8 16h5'/>",
                calendar: "<rect x='3' y='4' width='18' height='17' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/>",
                client: "<path d='M3 21V8l9-5 9 5v13'/><path d='M9 21v-6h6v6'/>",
                plus: "<path d='M12 5v14M5 12h14'/>"
            };
            return "<svg width='" + sz + "' height='" + sz + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (P[k] || "") + "</svg>";
        },
        _pmHealthColor: function (h) { return h >= 76 ? "#16a34a" : h >= 51 ? "#d97706" : "#dc2626"; },
        _pmUtilColor: function (u) { return u > 100 ? "#dc2626" : u >= 90 ? "#d97706" : u >= 70 ? "#16a34a" : "#2563eb"; },
        _pmHealthRing: function (score, size) {
            var col = this._pmHealthColor(score); var R = (size / 2) - 6; var C = 2 * Math.PI * R; var off = C * (1 - score / 100);
            return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 " + size + " " + size + "'>" +
                "<circle cx='" + (size / 2) + "' cy='" + (size / 2) + "' r='" + R + "' fill='none' stroke='#e5e7eb' stroke-width='7'/>" +
                "<circle cx='" + (size / 2) + "' cy='" + (size / 2) + "' r='" + R + "' fill='none' stroke='" + col + "' stroke-width='7' stroke-linecap='round'" +
                " stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + off.toFixed(1) + "' transform='rotate(-90 " + (size / 2) + " " + (size / 2) + ")'/>" +
                "<text x='50%' y='47%' text-anchor='middle' font-size='" + (size * 0.26) + "' font-weight='800' fill='#111827'>" + score + "</text>" +
                "<text x='50%' y='66%' text-anchor='middle' font-size='" + (size * 0.13) + "' fill='#6b7280'>/100</text></svg>";
        },
        _pmEmpty: function (iconKey, msg) { return "<div class='pmChartEmpty'><div class='pmChartEmptyIcon'>" + this._pmSvg(iconKey, 30) + "</div><div>" + esc(msg) + "</div></div>"; },
        _pmOverview: function (d) {
            var pm = this._pmDash, self = this;
            if (!pm) return "<div class='pmPanel' style='margin-top:14px'><div class='pmLoading'>Loading dashboard…</div></div>";
            if (pm.error) return "<div class='pmPanel' style='margin-top:14px'><div class='pmCardSub'>Dashboard data is unavailable for this project.</div></div>";
            var s = pm.summary, o = pm.overview, b = pm.budget, pid = o.projectId;

            // ── Hero header (identity + health ring + quick actions) ────────────
            var overdue = s.daysRemaining != null && s.daysRemaining < 0;
            var qa = function (label, tab, icon) { return "<button class='pmQa' onclick=\"window._projCtrl.onTab('" + tab + "')\"><span class='pmQaIco'>" + self._pmSvg(icon, 15) + "</span>" + label + "</button>"; };
            var meta = function (icon, txt) { return "<span><span class='pmMetaIco'>" + self._pmSvg(icon, 14) + "</span>" + txt + "</span>"; };
            var hero = "<div class='pmHero'>" +
                "<div class='pmHeroMain'>" +
                "<div class='pmHeroTop'><div class='pmHeroName'>" + esc(o.projectName) + "</div>" + this._statusChip(o.status) +
                "<span class='pmHeroType'>" + esc(o.projectType) + "</span></div>" +
                "<div class='pmHeroMeta'>" + meta("client", "<b>" + esc(o.clientName) + "</b>") + meta("users", "POC <b>" + esc(o.poc) + "</b>") +
                meta("calendar", "<b>" + esc(String(o.startDate || "").slice(0, 10)) + " → " + esc(String(o.endDate || "").slice(0, 10)) + "</b>") +
                meta("users", "Team <b>" + o.teamSize + "</b>") + "</div>" +
                "<div class='pmHeroStats'>" +
                "<div class='pmHeroStat'><span>Progress</span><b style='color:#2563eb'>" + s.progress + "%</b></div>" +
                "<div class='pmHeroStat'><span>Days Left</span><b style='color:" + (overdue ? "#dc2626" : "#111827") + "'>" + (s.daysRemaining == null ? "—" : (overdue ? Math.abs(s.daysRemaining) + " over" : s.daysRemaining)) + "</b></div>" +
                "<div class='pmHeroStat'><span>Budget Used</span><b style='color:" + this._pmUtilColor(s.budgetUtilizationPct) + "'>" + s.budgetUtilizationPct + "%</b></div>" +
                "<div class='pmHeroStat'><span>Team Load</span><b style='color:" + this._pmUtilColor(s.resourceUtilizationPct) + "'>" + s.resourceUtilizationPct + "%</b></div></div>" +
                "</div>" +
                "<div class='pmHeroHealth'><div class='pmHeroHealthRing'>" + this._pmHealthRing(s.healthScore, 116) + "</div>" +
                "<div class='pmHeroHealthLbl' style='color:" + this._pmHealthColor(s.healthScore) + "'>" + esc(s.healthLabel) + "</div>" +
                "<div class='pmCardSub'>Project Health</div></div>" +
                "</div>";

            // ── KPI cards (icon + accent + status) ─────────────────────────────
            var kpi = function (icon, l, v, sub, c) {
                return "<div class='pmKpiCard' style='--accent:" + c + "'><div class='pmKpiHead'><span class='pmKpiIcon' style='background:" + c + "1a;color:" + c + "'>" + self._pmSvg(icon, 15) + "</span><span class='pmKpiL'>" + esc(l) + "</span></div>" +
                    "<div class='pmKpiV' style='color:" + c + "'>" + v + "</div>" + (sub ? "<div class='pmKpiSub'>" + esc(sub) + "</div>" : "") + "</div>";
            };
            var cards =
                kpi("progress", "Progress", s.progress + "%", "tasks complete", "#2563eb") +
                kpi("health", "Health", s.healthScore + "/100", s.healthLabel, this._pmHealthColor(s.healthScore)) +
                kpi("clock", "Days Left", (s.daysRemaining == null ? "—" : (overdue ? Math.abs(s.daysRemaining) : s.daysRemaining)), overdue ? "overdue" : "to end date", overdue ? "#dc2626" : "#0ea5e9") +
                kpi("wallet", "Budget Util", s.budgetUtilizationPct + "%", "of approved", this._pmUtilColor(s.budgetUtilizationPct)) +
                kpi("users", "Resource Util", s.resourceUtilizationPct + "%", "avg team load", this._pmUtilColor(s.resourceUtilizationPct)) +
                kpi("alert", "Open Risks", s.openRisks, "high / critical", s.openRisks ? "#dc2626" : "#16a34a") +
                kpi("bug", "Open Issues", s.openIssues, "unresolved", s.openIssues ? "#d97706" : "#16a34a") +
                kpi("check", "Approvals", s.pendingApprovals, "pending", s.pendingApprovals ? "#d97706" : "#16a34a") +
                kpi("flag", "Milestones", s.upcomingMilestones, "upcoming", "#7c3aed") +
                kpi("list", "Pending Tasks", s.pendingTasks, "open", s.pendingTasks ? "#334155" : "#16a34a");

            // ── Charts (with empty states) ─────────────────────────────────────
            var taskTotal = pm.tasks.stats.total;
            var hasRes = (pm.charts.resourceUtilization || []).length > 0;
            var hasBudget = b.approved > 0;
            var chartCard = function (title, id, hasData, emptyIcon, emptyMsg) {
                var inner = hasData ? "<canvas id='" + id + "'></canvas>" : self._pmEmpty(emptyIcon, emptyMsg);
                return "<div class='pmChartCard'><div class='pmChartTitle'>" + title + "</div><div class='pmChartBox'>" + inner + "</div></div>";
            };
            var charts = "<div class='pmChartRow'>" +
                chartCard("Task Status Distribution", "pmc_task", taskTotal > 0, "list", "No task data available yet.") +
                chartCard("Resource Utilization", "pmc_res", hasRes, "users", "No resource allocation available yet.") +
                chartCard("Budget Consumption", "pmc_bud", hasBudget, "wallet", "No budget consumption data yet.") +
                "</div>";

            // ── Budget panel (Allocated / Consumed / Remaining) ────────────────
            var totalAlloc = (b.deptAllocation || []).reduce(function (t, x) { return t + x.amount; }, 0);
            var deptRows = (b.deptAllocation || []).length ? b.deptAllocation.map(function (x) {
                // Per-dept consumption isn't tracked; show project-level utilization ratio as a proxy.
                var consumed = Math.round(x.amount * (b.utilizationPct || 0) / 100);
                var rem = x.amount - consumed;
                var pct = b.approved > 0 ? Math.round(x.amount / b.approved * 100) : 0;
                return "<tr><td>" + esc(x.name) + "</td><td style='text-align:right'>" + self._pmMoney(x.amount) + "</td>" +
                    "<td style='text-align:right;color:#d97706'>" + self._pmMoney(consumed) + "</td><td style='text-align:right;color:#16a34a'>" + self._pmMoney(rem) + "</td>" +
                    "<td style='text-align:right;color:#6b7280'>" + pct + "%</td></tr>";
            }).join("") : "<tr><td colspan='5'>" + this._pmEmpty("wallet", "No department allocation set yet.") + "</td></tr>";
            var budgetPanel = "<div class='pmPanel pmSpan2'><div class='pmPanelHead'>Budget · Time-Phased</div>" +
                "<div class='pmMiniStats pmBudgetStats'>" +
                "<div><span>Approved</span><b>" + this._pmMoney(b.approved) + "</b></div>" +
                "<div><span>Estimated</span><b style='color:" + this._pmUtilColor(b.utilizationPct) + "'>" + this._pmMoney(b.estimated != null ? b.estimated : b.utilized) + "</b></div>" +
                "<div><span>Money Spent</span><b style='color:#16a34a'>" + this._pmMoney(b.moneySpent != null ? b.moneySpent : (b.spent || 0)) + "</b></div>" +
                "<div><span>Remaining Forecast</span><b style='color:#2563eb'>" + this._pmMoney(b.remainingResourceBudget != null ? b.remainingResourceBudget : (b.forecast || 0)) + "</b></div>" +
                "<div><span>Available</span><b style='color:#16a34a'>" + this._pmMoney(b.available != null ? b.available : b.remaining) + "</b></div>" +
                "<div><span>Utilization</span><b style='color:" + this._pmUtilColor(b.utilizationPct) + "'>" + b.utilizationPct + "%</b></div>" + "</div>" +
                "<div class='pmProgTrack'><div class='pmProgFill' style='width:" + Math.min(100, b.utilizationPct) + "%;background:" + this._pmUtilColor(b.utilizationPct) + "'></div></div>" +
                "<table class='pmMiniTable'><thead><tr><th>Department / Module</th><th style='text-align:right'>Allocated</th><th style='text-align:right'>Consumed</th><th style='text-align:right'>Remaining</th><th style='text-align:right'>%</th></tr></thead><tbody>" + deptRows + "</tbody></table></div>";

            // ── Meetings & milestones lists ────────────────────────────────────
            var mList = (pm.meetings.list || []);
            var mtgItems = mList.length ? mList.map(function (m) {
                var when = String(m.startDateTime || "").replace("T", " ").slice(0, 16);
                var join = m.teamsJoinUrl ? "<a href='" + esc(m.teamsJoinUrl) + "' target='_blank' class='pmListJoin'>Join</a>" : "";
                return "<div class='pmListItem'><div><b>" + esc(m.title) + "</b>" + (m.isToday ? " <span class='pmTodayTag'>Today</span>" : "") +
                    "<div class='pmListSub'>" + esc(m.meetingType || (m.meetingMode === "InPerson" ? "In Person" : "Teams")) + " · " + esc(when) + "</div></div>" + join + "</div>";
            }).join("") : this._pmEmpty("calendar", "No upcoming meetings.");
            var msUp = (pm.milestones.list || []).filter(function (x) { return x.upcoming || x.delayed; }).slice(0, 6);
            var msItems = msUp.length ? msUp.map(function (x) {
                var col = x.delayed ? "#dc2626" : "#2563eb";
                return "<div class='pmListItem'><div><b>" + esc(x.name) + "</b>" + (x.delayed ? " <span class='pmDelayTag'>Delayed</span>" : "") +
                    "<div class='pmListSub'>Target " + esc(String(x.targetDate || "").slice(0, 10)) + " · " + x.completionPct + "%</div></div>" +
                    "<div class='pmListPct' style='color:" + col + "'>" + x.completionPct + "%</div></div>";
            }).join("") : this._pmEmpty("flag", "No upcoming or delayed milestones.");
            var listsPanel = "<div class='pmPanel'><div class='pmPanelHead'>Upcoming Meetings <span class='pmCount'>" + pm.meetings.upcoming + "</span></div>" +
                "<div class='pmList'>" + mtgItems + "</div>" +
                "<div class='pmPanelHead' style='margin-top:14px'>Milestones <span class='pmPhaseTag'>" + esc(pm.milestones.currentPhase) + "</span></div>" +
                "<div class='pmList'>" + msItems + "</div></div>";

            return "<div class='pmDash'>" +
                "<div class='pmKpiRow'>" + cards + "</div>" + charts +
                "<div class='pmDashCols'>" + budgetPanel + listsPanel + "</div></div>";
        },
        _pmInitCharts: function () {
            if (!window.Chart || !this._pmDash || this._pmDash.error) return;
            (this._pmCharts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /* */ } });
            this._pmCharts = [];
            var ch = this._pmDash.charts, self = this;
            var mk = function (id, cfg) { var el = document.getElementById(id); if (!el) return; self._pmCharts.push(new window.Chart(el.getContext("2d"), cfg)); };
            var grid = { color: "rgba(0,0,0,0.06)" };
            window.Chart.defaults.color = "#475569";
            var ts = ch.taskStatus, tsTotal = Object.values(ts).reduce(function (a, b) { return a + b; }, 0);
            // Center-total plugin for the task donut.
            var centerText = { id: "pmCenter", afterDraw: function (chart) { var a = chart.chartArea; if (!a) return; var cc = chart.ctx, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2; cc.save(); cc.textAlign = "center"; cc.fillStyle = "#111827"; cc.font = "800 22px Inter, Arial"; cc.fillText(String(tsTotal), cx, cy - 2); cc.fillStyle = "#6b7280"; cc.font = "11px Inter, Arial"; cc.fillText("Tasks", cx, cy + 15); cc.restore(); } };
            if (tsTotal > 0) mk("pmc_task", { type: "doughnut", data: { labels: Object.keys(ts), datasets: [{ data: Object.values(ts), backgroundColor: ["#16a34a", "#2563eb", "#7c3aed", "#f59e0b", "#dc2626"], borderColor: "#fff", borderWidth: 2 }] },
                options: { maintainAspectRatio: false, cutout: "64%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 8, font: { size: 10 } } } } }, plugins: [centerText] });
            var ru = ch.resourceUtilization;
            if (ru.length) mk("pmc_res", { type: "bar", data: { labels: ru.map(function (x) { return x.name; }), datasets: [{ data: ru.map(function (x) { return x.value; }), backgroundColor: ru.map(function (x) { return self._pmUtilColor(x.value); }), borderRadius: 5, maxBarThickness: 46 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return "Allocation: " + c.raw + "%"; } } } }, scales: { y: { grid: grid, ticks: { callback: function (v) { return v + "%"; } } }, x: { grid: { display: false } } } } });
            var b = this._pmDash.budget;
            if (b.approved > 0) mk("pmc_bud", { type: "bar", data: { labels: ["Approved", "Utilized", "Remaining"], datasets: [{ data: [b.approved, b.utilized, b.remaining], backgroundColor: ["#2563eb", "#dc2626", "#16a34a"], borderRadius: 5, maxBarThickness: 60 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.label + ": " + self._pmMoney(c.raw) + (c.dataIndex === 1 ? "  (" + b.utilizationPct + "%)" : ""); } } } }, scales: { y: { grid: grid, ticks: { callback: function (v) { return self._pmMoney(v); } } }, x: { grid: { display: false } } } } });
        },
        // Attach ONCE to the HTML host: its afterRendering fires only after UI5 has
        // actually flushed the (re)rendered DOM — the reliable moment to (re)draw
        // charts on the fresh canvases. Replaces the old fragile setTimeout race.
        _attachChartDelegate: function () {
            if (this._chartDelegateAttached) return;
            var h = this._host(); if (!h) return;
            var that = this;
            h.addEventDelegate({ onAfterRendering: function () { that._maybeDrawCharts(); } });
            this._chartDelegateAttached = true;
        },
        // Draw the overview charts iff we're actually showing the overview with data.
        // Ensures Chart.js is loaded first (CDN), then initialises on the live DOM.
        _maybeDrawCharts: function () {
            if (this._view !== "detail" || (this._detailTab || "overview") !== "overview") return;
            if (!this._pmDash || this._pmDash.error) return;
            if (!document.querySelector(".pmChartRow")) return;   // overview DOM not present
            if (window.Chart) { this._pmInitCharts(); return; }
            this._ensureChartLib();
        },
        // Load the Chart.js library once; redraw once it's available.
        _ensureChartLib: function () {
            if (window.Chart || this._pmChartLoading) return;
            this._pmChartLoading = true;
            var that = this, s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"; s.async = true;
            s.onload = function () { that._pmChartLoading = false; that._maybeDrawCharts(); };
            s.onerror = function () { that._pmChartLoading = false; };
            document.head.appendChild(s);
        },

        _renderDetail: function () {
            var d = this._detail, p = d.project || {};
            var activeTab = this._detailTab || "overview";
            var back = "<button class='pmBtn ghost' onclick=\"window._projCtrl.onBack()\">← Back</button>";

            // Tab bar
            var TABS = [
                { key: "overview",   label: "Overview" },
                { key: "milestones", label: "Milestones" },
                { key: "requirements", label: "Requirements" },
                { key: "tasks",      label: "Tasks" },
                { key: "resources",  label: "Resources" },
                { key: "meetings",   label: "Meetings" },
                { key: "chat",       label: "💬 Chat" }
            ];
            var tabBar = "<div class='pmTabBar'>" + TABS.map(function (t) {
                return "<button class='pmTab" + (t.key === activeTab ? " active" : "") + "' onclick=\"window._projCtrl.onTab('" + t.key + "')\">" + t.label + "</button>";
            }).join("") + "</div>";

            var body = "";
            if (activeTab === "overview") {
                // Project Manager Dashboard (hero header + KPIs + charts + panels).
                body = this._pmOverview(d);
            } else if (activeTab === "resources") {
                body = this._renderResourcesTab(d);
            } else if (activeTab === "tasks") {
                body = this._renderSprintTab(d);
            } else if (activeTab === "milestones") {
                body = this._renderMilestonesTab();
            } else if (activeTab === "requirements") {
                body = this._renderRequirementsTab();
            } else if (activeTab === "meetings") {
                body = this._renderMeetingsTab();
            } else if (activeTab === "chat") {
                body = "<div class='pmPanel'><div class='pmPanelHead'>Project Chat</div>" +
                    "<div class='pmDesc' style='margin-bottom:12px;'>Chat with all project members — POC and allocated resources.</div>" +
                    "<button class='pmBtn primary' onclick=\"window._projCtrl.onOpenChat()\">💬 Open Project Chat</button></div>";
            }

            return "<div class='pmWrap'>" + back + tabBar + body + "</div>";
        },

        // Operational resource-planning panel — capacity & utilization only, NO money.
        // ── Resources tab = Available Resources + Allocated Resources sub-tabs ────
        onResSubTab: function (key) {
            this._resSubTab = key;
            if (key === "available" && !this._avail) this._loadAvailable();
            else this._render();
        },
        _loadAvailable: function () {
            var that = this, pid = this._detail && this._detail.project && this._detail.project.projectId;
            if (!pid) return;
            ppost("getAllocatableEmployees", { projectId: pid }).then(function (a) {
                that._avail = (a && !a.error) ? a : { departments: [], error: (a && a.error) };
                if ((that._detailTab || "") === "resources") that._render();
            }).catch(function () { that._avail = { departments: [] }; if ((that._detailTab || "") === "resources") that._render(); });
        },
        _renderResourcesTab: function (d) {
            var sub = this._resSubTab || "available";
            var p2 = d.project || {};
            var canAllocate = d.isPoc && !(p2.status === "Planning" && p2.lifecycleStage !== "BudgetAllocated");
            var subBar = "<div class='pmSubTabs'>" +
                "<button class='pmSubTab" + (sub === "available" ? " active" : "") + "' onclick=\"window._projCtrl.onResSubTab('available')\">Available Resources</button>" +
                "<button class='pmSubTab" + (sub === "allocated" ? " active" : "") + "' onclick=\"window._projCtrl.onResSubTab('allocated')\">Allocated Resources <span class='pmCount'>" + ((d.resources || []).length) + "</span></button>" +
                "</div>";
            var content = (sub === "allocated") ? this._renderAllocatedResources(d, canAllocate) : this._renderAvailableResources(d, canAllocate);
            return "<div class='pmPanel'>" + subBar + content + "</div>";
        },
        // Tab 1 — Available Resources (reuses the project's allocatable-employee pool:
        // availability, utilization, skills, dept, role, rate, recommendation + allocate).
        _renderAvailableResources: function (d, canAllocate) {
            var p2 = d.project || {};
            var lcNotice = (d.isPoc && p2.status === "Planning" && p2.lifecycleStage !== "BudgetAllocated")
                ? "<div class='pmLcNotice'>Resource allocation will be unlocked once the Founder completes the planning meeting and allocates the budget.</div>" : "";
            var head = "<div class='pmPanelHead'>Available Resources" +
                (canAllocate ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onAllocateByMilestone()\">＋ Allocate to Milestone</button>" : "") +
                " <button class='pmBtn ghost sm' onclick=\"window._projCtrl.onResourceForecast()\">Capacity Forecast</button></div>";
            if (!this._avail) { this._loadAvailable(); return head + "<div class='pmLoading'>Loading available resources…</div>"; }
            if (this._avail.error) return head + "<div class='pmMuted'>" + esc(this._avail.error) + "</div>";
            var groups = this._avail.departments || [];
            var emps = []; groups.forEach(function (g) { (g.employees || []).forEach(function (e) { emps.push(e); }); });
            if (!emps.length) return head + "<div class='pmMuted'>No available resources match this project's requirements.</div>";
            var hint = (this._avail.showingAll && this._avail.requirementDefined)
                ? "<div class='pmMuted' style='margin-bottom:6px'>No employees are tagged to the requirements' roles — showing all available employees.</div>"
                : (this._avail.demandMatched > 0 ? "<div class='pmMuted' style='margin-bottom:6px'>★ " + this._avail.demandMatched + " employee(s) match this project's Resource Requirements.</div>" : "");
            var rows = groups.map(function (g) {
                var grp = "<tr class='pmGroupRow'><td colspan='7'><b>" + esc(g.department) + "</b> <span class='pmCount'>" + (g.employees || []).length + "</span></td></tr>";
                return grp + (g.employees || []).map(function (e) {
                    var u = e.currentAllocation || 0, av = e.available != null ? e.available : Math.max(0, 100 - u);
                    var uc = u > 100 ? "#dc2626" : u >= 85 ? "#a16207" : "#16a34a";
                    var star = e.recommended ? "<span class='amStar' title='Matches a Resource Requirement'>★</span> " : "";
                    var skills = esc(e.skills || e.specializationName || "—");
                    return "<tr><td>" + star + esc(e.employeeName) + "<div class='pmMuted' style='font-size:0.68rem'>" + esc(e.employeeId) + "</div></td>" +
                        "<td>" + esc(e.roleCategoryName || e.designation || "—") + "</td>" +
                        "<td>" + skills + "</td>" +
                        "<td style='text-align:center;color:#16a34a'><b>" + av + "%</b></td>" +
                        "<td style='text-align:center;color:" + uc + "'>" + u + "%</td>" +
                        "<td style='text-align:right'>₹" + (Number(e.costRatePerHour) || 0).toLocaleString("en-IN") + "/hr</td>" +
                        "<td style='text-align:right'>" + (canAllocate ? "<button class='pmLink' onclick=\"window._projCtrl.onAllocateByMilestone()\">Allocate</button>" : "—") + "</td></tr>";
                }).join("");
            }).join("");
            return head + lcNotice + hint +
                "<table class='pmTable'><thead><tr><th>Employee</th><th>Role</th><th>Skills</th><th>Available</th><th>Utilization</th><th style='text-align:right'>Hourly Rate</th><th></th></tr></thead><tbody>" +
                rows + "</tbody></table>" + this._capacityPanel();
        },
        // Tab 2 — Allocated Resources (every allocation on THIS project, with the full
        // financial view + management actions). Reuses existing allocate/remove/replace.
        _renderAllocatedResources: function (d, canAllocate) {
            var that = this, msList = d.milestones || [];
            var head = "<div class='pmPanelHead'>Allocated Resources <span class='pmCount'>" + ((d.resources || []).length) + "</span>" +
                (canAllocate ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onAllocateByMilestone()\">＋ Allocate to Milestone</button>" : "") + "</div>";
            var res = d.resources || [];
            if (!res.length) return head + "<div class='pmMuted'>No resources allocated to this project yet.</div>";
            var rows = res.map(function (r) {
                var u = r.utilizationPct || 0;
                var ovr = r.isOverridden ? " <span class='pmOvrTag'>Overridden</span>" : "";
                var msCell;
                if (canAllocate && msList.length) {
                    var opts = "<option value=''>— Project-level —</option>" + msList.map(function (m) {
                        return "<option value='" + esc(m.milestoneId) + "'" + (r.milestoneId === m.milestoneId ? " selected" : "") + ">#" + (m.sequence || 0) + " " + esc(m.name) + "</option>";
                    }).join("");
                    msCell = "<select class='pmSelect' onchange=\"window._projCtrl.onResMilestone('" + esc(r.employeeId) + "', this.value, " + (r.bandwidth || 0) + ")\">" + opts + "</select>";
                } else { msCell = r.milestoneName ? esc(r.milestoneName) : "<span class='pmMuted'>Project-level</span>"; }
                var actions = "<button class='pmLink' onclick=\"window._projCtrl.onResourceDetails('" + esc(r.employeeId) + "','" + esc(r.milestoneId || "") + "')\">Details</button>";
                if (canAllocate && r.milestoneId) {
                    actions += "<button class='pmLink' onclick=\"window._projCtrl.onAdjustMilestoneResource('" + esc(r.milestoneId) + "','" + esc(r.employeeId) + "')\">Edit %</button>";
                    actions += "<button class='pmLink' onclick=\"window._projCtrl.onReplaceRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "','" + esc(r.milestoneId) + "','" + esc(r.milestoneName || "") + "'," + (r.bandwidth || 0) + ")\">Replace</button>";
                }
                if (canAllocate) actions += "<button class='pmLink danger' onclick=\"window._projCtrl.onRemoveRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "')\">Remove</button>";
                var statusChip = "<span class='pmResStatus " + (r.status === "Released" ? "rel" : "act") + "'>" + esc(r.status || "Active") + "</span>";
                return "<tr><td><b>" + esc(r.employeeName) + "</b>" + ovr + "<div class='pmMuted' style='font-size:0.68rem'>" + esc(r.employeeId) + " · " + esc(r.department || "") + "</div></td>" +
                    "<td>" + esc(r.role || r.roleCategoryName || "—") + "</td>" +
                    "<td>" + msCell + "</td>" +
                    "<td style='text-align:center'><b>" + (r.bandwidth || 0) + "%</b></td>" +
                    "<td style='text-align:center'>" + Math.round(r.estimatedHours || 0) + " h</td>" +
                    "<td style='text-align:right'>₹" + (Number(r.hourlyCost) || 0).toLocaleString("en-IN") + "</td>" +
                    "<td style='text-align:right'>" + that._inr2(r.estimatedCost != null ? r.estimatedCost : r.totalAllocationCost) + "</td>" +
                    "<td style='text-align:right;color:#16a34a'>" + that._inr2(r.moneySpent || 0) + "</td>" +
                    "<td style='text-align:right;color:#2563eb'>" + that._inr2(r.remainingForecast != null ? r.remainingForecast : r.totalAllocationCost) + "</td>" +
                    "<td style='text-align:center'>" + statusChip + "</td>" +
                    "<td class='pmMuted' style='font-size:0.7rem'>" + esc(String(r.allocationDate || "").slice(0, 10)) + "</td>" +
                    "<td><div class='pmMsActions'>" + actions + "</div></td></tr>";
            }).join("");
            return head +
                "<div style='overflow-x:auto'><table class='pmTable'><thead><tr>" +
                "<th>Employee</th><th>Role</th><th>Milestone</th><th>Alloc %</th><th>Hours</th><th style='text-align:right'>Hourly Cost</th><th style='text-align:right'>Estimated</th><th style='text-align:right'>Money Spent</th><th style='text-align:right'>Forecast Left</th><th>Status</th><th>Date</th><th>Actions</th>" +
                "</tr></thead><tbody>" + rows + "</tbody></table></div>";
        },
        // View Allocation Details + Cost Breakdown (+ history if the API provides it).
        onResourceDetails: function (employeeId, milestoneId) {
            var r = (this._detail.resources || []).filter(function (x) { return x.employeeId === employeeId && (x.milestoneId || "") === (milestoneId || ""); })[0]
                || (this._detail.resources || []).filter(function (x) { return x.employeeId === employeeId; })[0];
            if (!r) { MessageToast.show("Allocation not found."); return; }
            var that = this;
            var kv = function (k, v) { return "<div class='pmPvRow'><div class='pmPvK'>" + esc(k) + "</div><div class='pmPvV'>" + v + "</div></div>"; };
            var body =
                kv("Employee", esc(r.employeeName) + " <span class='pmMuted'>(" + esc(r.employeeId) + ")</span>") +
                kv("Department / Role", esc(r.department || "—") + " · " + esc(r.role || r.roleCategoryName || "—")) +
                kv("Milestone", esc(r.milestoneName || "Project-level")) +
                kv("Allocation %", (r.bandwidth || 0) + "%") +
                kv("Allocated Hours", Math.round(r.estimatedHours || 0) + " h") +
                kv("Window", esc(String(r.startDate || "—").slice(0, 10)) + " → " + esc(String(r.endDate || "—").slice(0, 10))) +
                kv("Hourly Cost", "₹" + (Number(r.hourlyCost) || 0).toLocaleString("en-IN") + "/hr") +
                "<div class='pmPvK' style='margin-top:8px'>Cost Breakdown</div>" +
                kv("Estimated Cost", "<b>" + that._inr2(r.estimatedCost != null ? r.estimatedCost : r.totalAllocationCost) + "</b>") +
                kv("Money Spent", "<b style='color:#16a34a'>" + that._inr2(r.moneySpent || 0) + "</b> <span class='pmMuted'>(accrues as milestone days elapse)</span>") +
                kv("Forecasted Remaining", "<b style='color:#2563eb'>" + that._inr2(r.remainingForecast != null ? r.remainingForecast : r.totalAllocationCost) + "</b>") +
                kv("Status", esc(r.status || "Active")) +
                kv("Allocation Date", esc(String(r.allocationDate || "—").slice(0, 10)));
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Allocation Details</div>" +
                "<div class='pmDialogBody pmPvBody' id='rdBody'>" + body + "</div>" +
                "<div class='pmDialogFoot'><button class='pmBtn primary' id='pmClose'>Close</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmClose").addEventListener("click", close);
        },

        _capacityPanel: function () {
            var rp = this._planning;
            if (!rp) return "";
            var blockBar = function (pct) {
                pct = Math.max(0, Math.min(100, pct || 0));
                var filled = Math.round(pct / 10);
                var bar = "";
                for (var i = 0; i < 10; i++) { bar += (i < filled) ? "█" : "░"; }
                return bar;
            };
            // Department capacity chips.
            var caps = (rp.departments || []).map(function (d) {
                var col = d.capacityAvailablePct >= 50 ? "#16a34a" : d.capacityAvailablePct >= 25 ? "#a16207" : "#dc2626";
                return "<div class='pmCapChip'><span class='pmCapDept'>" + esc(d.department) + "</span>" +
                    "<span class='pmCapVal' style='color:" + col + "'>" + d.capacityAvailablePct + "% available</span></div>";
            }).join("");
            var capBlock = caps
                ? "<div class='pmPanel'><div class='pmPanelHead'>Department Capacity</div><div class='pmCapGrid'>" + caps + "</div></div>"
                : "";
            // Department utilization bars.
            var utils = (rp.departments || []).map(function (d) {
                var col = d.utilizationPct >= 85 ? "#dc2626" : d.utilizationPct >= 60 ? "#a16207" : "#16a34a";
                return "<div class='pmUtilRow'><span class='pmUtilLbl'>" + esc(d.department) + "</span>" +
                    "<span class='pmUtilBar' style='color:" + col + "'>" + blockBar(d.utilizationPct) + "</span>" +
                    "<span class='pmUtilPct'>" + d.utilizationPct + "% Utilized</span></div>";
            }).join("");
            var utilBlock = utils
                ? "<div class='pmPanel'><div class='pmPanelHead'>Department Utilization</div>" + utils + "</div>"
                : "";
            // Resource availability table (hours, no money).
            var availRows = (rp.resources || []).map(function (r) {
                return "<tr><td>" + esc(r.employeeName) + "</td>" +
                    "<td>" + r.utilizedHours + " / " + r.standardHours + " hrs</td>" +
                    "<td><b>" + r.availableHours + " hrs</b></td>" +
                    "<td>" + r.projectAllocationPct + "%</td></tr>";
            }).join("");
            var availBlock = availRows
                ? "<div class='pmPanel'><div class='pmPanelHead'>Resource Availability</div>" +
                    "<table class='pmTable pmAvailTable'><thead><tr><th>Employee</th><th>Utilization</th><th>Available</th><th>This Project</th></tr></thead>" +
                    "<tbody>" + availRows + "</tbody></table>" +
                    "<div class='pmMuted' style='margin-top:8px'>Based on a standard " + rp.standardHours + "-hour month. Plan allocations against available capacity.</div></div>"
                : "";
            return capBlock + utilBlock + availBlock + this._forecastPanel() + this._budgetRequestPanel();
        },

        // Multi-month capacity forecast heatmap — each cell = a person's utilization
        // for that month (engine-computed against THAT month's effective capacity, so
        // a future month with leave/holidays is flagged red even if "today" looks ok).
        _forecastPanel: function () {
            var fc = this._forecast;
            if (!fc || !fc.resources || !fc.resources.length || !(fc.monthLabels || []).length) return "";
            var cellCol = function (m) {
                if (m.breach || m.utilizationPct > 100) return "#dc2626";
                if (m.utilizationPct >= 90) return "#ea580c";
                if (m.utilizationPct >= 70) return "#ca8a04";
                if (m.utilizationPct > 0) return "#16a34a";
                return "#94a3b8";
            };
            var head = "<tr><th>Employee</th>" + fc.monthLabels.map(function (l) { return "<th style='text-align:center'>" + esc(l) + "</th>"; }).join("") + "</tr>";
            var rows = fc.resources.map(function (r) {
                var cells = (r.months || []).map(function (m) {
                    var col = cellCol(m);
                    var title = m.label + ": " + m.allocatedHours + "h / " + m.effectiveCapacityHours + "h (" + m.utilizationPct + "%)" +
                        (m.breach ? " — OVER CAPACITY" : "") + (m.leaveHours ? " · leave " + m.leaveHours + "h" : "") + (m.holidayEventHours ? " · holidays " + m.holidayEventHours + "h" : "");
                    return "<td style='text-align:center' title='" + esc(title) + "'>" +
                        "<div class='pmFcCell' style='background:" + col + "'>" + m.utilizationPct + "%" + (m.breach ? " ⚠" : "") + "</div></td>";
                }).join("");
                var warn = (r.breachMonths || []).length ? "<div class='pmMuted' style='color:#dc2626'>breaks in " + r.breachMonths.map(esc).join(", ") + "</div>" : "";
                return "<tr><td><b>" + esc(r.employeeName) + "</b><div class='pmMuted'>peak " + (r.peakUtilization || 0) + "%</div>" + warn + "</td>" + cells + "</tr>";
            }).join("");
            return "<div class='pmPanel'><div class='pmPanelHead'>Capacity Forecast <span class='pmMuted'>(month-by-month over the project duration)</span></div>" +
                "<div class='pmFcScroll'><table class='pmTable pmFcTable'><thead>" + head + "</thead><tbody>" + rows + "</tbody></table></div>" +
                "<div class='pmMuted' style='margin-top:8px'>Each cell is utilization for that month vs. that month's effective capacity (after leave / holidays / events). 🔴 = the commitment exceeds capacity that month.</div></div>";
        },

        // Additional-budget request action + the POC's own request history (no project budget).
        _budgetRequestPanel: function () {
            var d = this._detail || {};
            if (!d.isPoc) return "";   // only the POC can request additional budget
            var br = this._budgetReqs || { requests: [] };
            var STATUS_COL = {
                "Pending Founder Approval": "#a16207", "Approved": "#16a34a",
                "Rejected": "#dc2626", "Withdrawn": "#64748b"
            };
            var rows = (br.requests || []).map(function (r) {
                var col = STATUS_COL[r.status] || "#64748b";
                var approved = (r.status === "Approved") ? "₹" + (r.approvedAmount || 0).toLocaleString("en-IN") : "—";
                var withdraw = (r.status === "Pending Founder Approval")
                    ? "<button class='pmLink danger' onclick=\"window._projCtrl.onWithdrawReq('" + esc(r.requestId) + "')\">Withdraw</button>" : "";
                var comments = r.founderComments ? "<div class='pmMuted' style='margin-top:2px'>💬 " + esc(r.founderComments) + "</div>" : "";
                return "<tr><td>" + esc(r.department) + comments + "</td>" +
                    "<td>₹" + (r.requestedAmount || 0).toLocaleString("en-IN") + "</td>" +
                    "<td>" + approved + "</td>" +
                    "<td><span style='color:" + col + ";font-weight:700;font-size:0.8rem'>" + esc(r.status) + "</span></td>" +
                    "<td>" + esc(r.requestDate || "") + "</td><td>" + withdraw + "</td></tr>";
            }).join("");
            var head = "<div class='pmPanelHead'>Additional Budget Requests" +
                " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onRequestBudget()\">＋ Request Additional Budget</button></div>";
            return "<div class='pmPanel'>" + head +
                (rows ? "<table class='pmTable'><thead><tr><th>Department</th><th>Requested</th><th>Approved</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>"
                    : "<div class='pmMuted'>No budget requests yet. If a department's capacity is insufficient, request additional budget for Founder approval.</div>") + "</div>";
        },

        onRequestBudget: function () {
            var that = this, pid = this._detail.project.projectId;
            ppost("getDepartments", {}).catch(function () { return {}; }).then(function (dres) {
                var DEPTS = (dres && dres.departments && dres.departments.length)
                    ? dres.departments.concat(["Other"])
                    : ["Engineering", "Executive", "Finance", "Human Resources", "Management", "Sales", "Other"];
                that._showBudgetRequestForm(pid, DEPTS);
            });
        },
        _showBudgetRequestForm: function (pid, DEPTS) {
            var that = this;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            var deptOpts = DEPTS.map(function (x) { return "<option>" + x + "</option>"; }).join("");
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Request Additional Budget</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Department</label><select class='pmFInput' id='brDept'>" + deptOpts + "</select>" +
                "<label class='pmFLbl'>Additional Budget Required (₹)</label><input type='number' min='1' step='1' class='pmFInput' id='brAmt' placeholder='e.g. 100000'/>" +
                "<label class='pmFLbl'>Justification</label><textarea class='pmFInput' id='brJust' rows='3' placeholder='e.g. Additional developers required; scope expansion; unexpected complexity'></textarea>" +
                "<label class='pmFLbl'>Business Impact</label><textarea class='pmFInput' id='brImpact' rows='2' placeholder='e.g. Project delivery delay; reduced quality; missed milestone'></textarea>" +
                "<div class='pmErr' id='brErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Submit Request</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            var showErr = function (m) { var e = ov.querySelector("#brErr"); e.textContent = "⚠ " + m; e.style.display = "block"; };
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                var dept = ov.querySelector("#brDept").value;
                var amt = parseFloat(ov.querySelector("#brAmt").value) || 0;
                var just = (ov.querySelector("#brJust").value || "").trim();
                var impact = (ov.querySelector("#brImpact").value || "").trim();
                if (amt <= 0) { showErr("Enter an amount greater than 0."); return; }
                if (!just) { showErr("Justification is required."); return; }
                if (!impact) { showErr("Business impact is required."); return; }
                btn.disabled = true; btn.textContent = "Submitting…";
                ppost("requestAdditionalBudget", { projectId: pid, department: dept, requestedAmount: amt, justification: just, businessImpact: impact })
                    .then(function (res) {
                        if (res && res.error) { btn.disabled = false; btn.textContent = "Submit Request"; showErr(res.error); return; }
                        close(); MessageToast.show("Budget request submitted for Founder approval."); that._open(pid);
                    }).catch(function () { btn.disabled = false; btn.textContent = "Submit Request"; showErr("Could not submit the request."); });
            });
        },

        onWithdrawReq: function (requestId) {
            var that = this, pid = this._detail.project.projectId;
            ppost("withdrawBudgetRequest", { requestId: requestId }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Request withdrawn."); that._open(pid);
            }).catch(function () { MessageToast.show("Could not withdraw the request."); });
        },

        onTab: function (key) {
            this._detailTab = key;
            if (key === "meetings") this._loadMeetings();
            else if (key === "milestones") this._loadMilestones();
            else if (key === "requirements") this._loadRequirements();
            else if (key === "overview") { this._render(); this._loadPmDash(); }   // refresh KPIs/charts on view
            else this._render();
        },

        // Refetch the PM dashboard (KPIs + chart data) so the Overview always reflects
        // the latest allocations/tasks/budget after any related action, then redraw.
        _loadPmDash: function () {
            var that = this, pid = this._detail && this._detail.project && this._detail.project.projectId;
            if (!pid) return;
            pprojpost("getPmDashboard", { projectId: pid }).then(function (pm) {
                that._pmDash = (pm && !pm.error) ? pm : { error: (pm && pm.error) || "unavailable" };
                if ((that._detailTab || "overview") === "overview") that._render();
            }).catch(function () { that._pmDash = { error: "unavailable" }; if ((that._detailTab || "overview") === "overview") that._render(); });
        },

        onOpenChat: function () {
            var d = this._detail;
            if (!d || !d.project) return;
            if (!this._projChat) {
                this._projChat = new ProjectChat(this.getView(), this.getOwnerComponent());
            }
            this._projChat.open(d.project.projectId, d.project.projectName);
        },

        // ════════════════════════════════════════════════════════════════════════
        // MILESTONES TAB (Phase 1) — list + dashboard tiles, lazy-loaded like meetings.
        // All writes go through the existing /project milestone actions; the rollup
        // engine computes status/progress/cost/delay server-side.
        // ════════════════════════════════════════════════════════════════════════
        _loadMilestones: function () {
            var that = this, pid = this._detail && this._detail.project && this._detail.project.projectId;
            if (!pid) return;
            ppost("getMilestones", { projectId: pid }).then(function (res) {
                that._milestones = (res && !res.error) ? res : { milestones: [], dashboard: {}, canManage: false };
                that._render();
            }).catch(function () { that._milestones = { milestones: [], dashboard: {}, canManage: false }; that._render(); });
        },

        _msStatusChip: function (s) {
            var map = {
                "Completed":       ["#dcfce7", "#16a34a"],
                "Completed Early": ["#dcfce7", "#15803d"],
                "In Progress":     ["#dbeafe", "#2563eb"],
                "Delayed":         ["#fee2e2", "#dc2626"],
                "At Risk":         ["#ffedd5", "#c2410c"],
                "Blocked":         ["#fce7f3", "#9d174d"],
                "Cancelled":       ["#f1f5f9", "#64748b"],
                "Planned":         ["#e0e7ff", "#4338ca"]
            };
            var c = map[s] || ["#f1f5f9", "#475569"];   // Not Started / unknown
            return "<span class='pmChip' style='background:" + c[0] + ";color:" + c[1] + "'>" + esc(s) + "</span>";
        },

        _msApprovalChip: function (s) {
            var map = {
                "Pending Approval": ["#fef9c3", "#a16207", "Approval Pending"],
                "Approved":         ["#dcfce7", "#16a34a", "✓ Approved"],
                "Rejected":         ["#fee2e2", "#dc2626", "✗ Rejected"],
                "Rework Required":  ["#ffedd5", "#c2410c", "↻ Rework Required"]
            };
            var c = map[s]; if (!c) return "";
            return "<span class='pmChip' style='background:" + c[0] + ";color:" + c[1] + ";font-size:0.7rem'>" + c[2] + "</span>";
        },

        _inr: function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); },
        _inr2: function (n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },

        _renderMilestonesTab: function () {
            var m = this._milestones;
            if (!m) return "<div class='pmPanel'><div class='pmLoading'>Loading milestones…</div></div>";
            var canManage = !!m.canManage, ms = m.milestones || [], db = m.dashboard || {};
            var that = this;

            // ── Dashboard tiles ──────────────────────────────────────────────────
            var tile = function (label, val, col) {
                return "<div class='pmMsTile'><div class='pmMsTileVal' style='color:" + (col || "#0f172a") + "'>" + val + "</div>" +
                    "<div class='pmMsTileLbl'>" + esc(label) + "</div></div>";
            };
            var tiles = "<div class='pmMsTiles'>" +
                tile("Total", db.total || 0, "#0f172a") +
                tile("Completed", db.completed || 0, "#16a34a") +
                tile("In Progress", db.inProgress || 0, "#2563eb") +
                tile("Delayed", db.delayed || 0, "#dc2626") +
                tile("At Risk", db.atRisk || 0, "#c2410c") +
                tile("Upcoming", db.upcoming || 0, "#475569") +
                "</div>";

            // ── Budget summary (only when an execution budget exists) ────────────
            var budgetBar = "";
            if ((db.executionBudget || 0) > 0) {
                var alloc = db.milestoneBudgetAllocated || 0, exec = db.executionBudget || 0;
                var pct = Math.min(100, Math.round(alloc / exec * 100));
                budgetBar = "<div class='pmBudgetBox'><div class='pmBudgetRow'>" +
                    "<span>Execution Budget <b>" + this._inr(exec) + "</b></span>" +
                    "<span>Allocated to Milestones <b>" + this._inr(alloc) + "</b></span>" +
                    "<span>Unallocated <b style='color:" + ((db.milestoneBudgetUnallocated || 0) < 0 ? "#dc2626" : "#16a34a") + "'>" + this._inr(db.milestoneBudgetUnallocated || 0) + "</b></span></div>" +
                    "<div class='pmBudgetTrack'><div class='pmBudgetFill' style='width:" + pct + "%;background:" + (alloc > exec ? "#dc2626" : "#16a34a") + "'></div></div></div>";
            }

            // ── Top information box ──────────────────────────────────────────────
            var infoBox = "<div class='pmInfoBox'><span class='pmInfoIco'>&#9432;</span>" +
                "<div>Plan and staff each milestone individually. <b>Costs</b> shown below are calculated automatically from the resources allocated to each milestone. " +
                "Use <b>Allocate Resources</b> to staff a milestone, then track its status, timeline and spend as work progresses. Employees are always allocated to milestones — never directly to the project.</div></div>";

            // ── Header + actions ─────────────────────────────────────────────────
            var leftActions = "";
            if (canManage) {
                leftActions = (ms.length === 0
                        ? " <button class='pmBtn ghost sm' onclick=\"window._projCtrl.onSeedMilestones()\">&#8635; Seed from Project Type</button>" : "") +
                    " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onMilestoneForm()\">＋ Add Milestone</button>";
            }
            // Right-side primary button — label/icon depend on whether any milestone
            // is already staffed (has allocations).
            var rightBtn = "";
            if (canManage && ms.length) {
                var hasAnyAllocation = ms.some(function (x) { return (x.resourceCount || 0) > 0; });
                rightBtn = hasAnyAllocation
                    ? "<button class='pmBtn primary' onclick=\"window._projCtrl.onAllocateByMilestone()\"><span class='pmBtnIco'>&#128101;</span> Manage Milestone Allocation</button>"
                    : "<button class='pmBtn primary' onclick=\"window._projCtrl.onAllocateByMilestone()\"><span class='pmBtnIco'>&#128100;&#43;</span> Allocate Resources for this Milestone</button>";
            }
            var head = "<div class='pmMsHeadBar'><div class='pmMsHeadLeft'>Milestones <span class='pmCount'>" + ms.length + "</span>" + leftActions + "</div>" +
                "<div class='pmMsHeadRight'>" + rightBtn + "</div></div>";

            if (!ms.length) {
                return "<div class='pmPanel'>" + infoBox + tiles + budgetBar + head +
                    "<div class='pmMuted'>No milestones yet." + (canManage ? " Seed them from the project type's phases, or add one manually." : "") + "</div></div>";
            }

            // ── Milestone rows ───────────────────────────────────────────────────
            var rows = ms.map(function (x) {
                var crit = x.isCritical ? " <span class='pmMsCrit' title='Critical path'>★</span>" : "";
                var bill = x.isBillable ? "" : " <span class='pmMuted' style='font-size:0.7rem'>(non-billable)</span>";
                var deps = (x.dependencies || []).length
                    ? "<div class='pmMuted' style='font-size:0.72rem'>after: " + x.dependencies.map(function (d) { return esc(d.predecessorName); }).join(", ") +
                        (x.predecessorsComplete ? "" : " <span style='color:#dc2626'>⛔ blocked</span>") + "</div>" : "";
                var timing = (x.delayDays > 0 ? "<span style='color:#dc2626;font-weight:700'>" + x.delayDays + "d late</span>"
                    : x.earlyDays > 0 ? "<span style='color:#16a34a;font-weight:700'>" + x.earlyDays + "d early</span>" : "<span class='pmMuted'>on track</span>");
                var dates = esc(x.plannedStartDate || "—") + " → " + esc(x.plannedEndDate || "—");
                var budgetCell = (x.plannedBudget > 0 || x.actualCost > 0)
                    ? that._inr(x.actualCost) + " / " + that._inr(x.plannedBudget) +
                        "<div class='pmMuted' style='font-size:0.7rem;color:" + ((x.budgetVariance || 0) < 0 ? "#dc2626" : "#16a34a") + "'>var " + that._inr(x.budgetVariance) + "</div>"
                    : "<span class='pmMuted'>—</span>";

                // Per-milestone action buttons (manage only).
                var btns = "";
                if (canManage) {
                    var terminal = (x.status === "Completed" || x.status === "Completed Early" || x.status === "Cancelled");
                    var notStarted = (x.status === "Not Started" || x.status === "Planned");
                    if (notStarted && x.predecessorsComplete)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onStartMilestone('" + esc(x.milestoneId) + "')\">Start</button>";
                    if (!terminal)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onCompleteMilestone('" + esc(x.milestoneId) + "',false)\">Complete</button>";
                    if (x.approvalStatus === "Pending Approval")
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onDecideApproval('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Decide</button>";
                    else if (!terminal)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onRequestApproval('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Request Approval</button>";
                    // Plan Resources (which roles/quantities this milestone needs vs the
                    // project baseline) and Manage Resources (allocate actual employees).
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onPlanMilestoneResources('" + esc(x.milestoneId) + "')\">Plan Resources</button>";
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onManageMilestoneResources('" + esc(x.milestoneId) + "')\">Manage Resources</button>";
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onManageDeps('" + esc(x.milestoneId) + "')\">Deps</button>";
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onMilestoneForm('" + esc(x.milestoneId) + "')\">Edit</button>";
                    btns += "<button class='pmLink danger' onclick=\"window._projCtrl.onDeleteMilestone('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Delete</button>";
                }
                // Preview is available to everyone (read-only detail view).
                btns += "<button class='pmBtn outline sm' onclick=\"window._projCtrl.onPreviewMilestone('" + esc(x.milestoneId) + "')\">Preview</button>";

                // Three financial values (daily model): Estimated / Money Spent / Remaining Forecast.
                var costCell = "<div><b>" + that._inr2(x.estimatedCost != null ? x.estimatedCost : (x.allocatedCost || 0)) + "</b> <span class='pmMuted' style='font-size:0.62rem'>est</span></div>" +
                    "<div style='font-size:0.72rem;color:#16a34a'>Spent " + that._inr2(x.moneySpent || 0) + "</div>" +
                    "<div style='font-size:0.72rem;color:#2563eb'>Forecast left " + that._inr2(x.remainingForecast != null ? x.remainingForecast : (x.allocatedCost || 0)) + "</div>";

                var planBadge = x.exceedsResourcePlan ? " <span class='pmPlanBadge' title='Milestone resource plan exceeds the project baseline'>⚠ Approval Recommended</span>" : "";
                return "<tr><td><b>#" + (x.sequence || 0) + " " + esc(x.name) + "</b>" + crit + bill + planBadge + deps +
                        (x.ownerName ? "<div class='pmMuted' style='font-size:0.72rem'>owner: " + esc(x.ownerName) + "</div>" : "") + "</td>" +
                    "<td>" + that._msStatusChip(x.status) +
                        (x.approvalStatus && x.approvalStatus !== "None" ? "<div style='margin-top:4px'>" + that._msApprovalChip(x.approvalStatus) + "</div>" : "") + "</td>" +
                    "<td>" + dates + "<div style='font-size:0.74rem;margin-top:2px'>" + timing + "</div></td>" +
                    "<td>" + costCell + "</td>" +
                    "<td><span class='pmResTasks'><span class='pmResIco'>&#128100;</span>" + (x.resourceCount || 0) + " - " + (x.taskCount || 0) + "/</span></td>" +
                    "<td><div class='pmMsActions'>" + btns + "</div></td></tr>";
            }).join("");

            // ── Reports toolbar (Phase 15) — downloadable xlsx / pdf ─────────────
            var RPT = [["status", "Status"], ["budget", "Budget"], ["resource", "Resource"], ["delay", "Delay Analysis"], ["forecast", "Forecast"], ["health", "Project Health"]];
            var reportsBar = "<div class='pmReportsBar'><span class='pmMuted'>Report:</span>" +
                "<select id='pmRptType' class='pmSelect'>" + RPT.map(function (r) { return "<option value='" + r[0] + "'>" + r[1] + "</option>"; }).join("") + "</select>" +
                "<button class='pmBtn ghost sm' onclick=\"window._projCtrl.onDownloadReport('xlsx')\">⬇ Excel</button>" +
                "<button class='pmBtn ghost sm' onclick=\"window._projCtrl.onDownloadReport('pdf')\">⬇ PDF</button></div>";

            return "<div class='pmPanel'>" + infoBox + tiles + budgetBar + head + reportsBar +
                "<table class='pmTable pmMsTable'><thead><tr><th>Milestone</th><th>Status</th><th>Timeline</th><th>Cost</th><th>Res/Tasks</th>" +
                "<th style='text-align:right'>Actions</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
        },

        // ── Download a milestone report (xlsx / pdf) ────────────────────────────
        onDownloadReport: function (format) {
            var pid = this._detail.project.projectId;
            var sel = document.getElementById("pmRptType");
            var reportType = sel ? sel.value : "status";
            MessageToast.show("Generating " + format.toUpperCase() + " report…");
            ppost("generateMilestoneReport", { projectId: pid, reportType: reportType, format: format }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                if (!res || !res.base64) { MessageToast.show("Report could not be generated."); return; }
                // base64 → Blob → trigger browser download.
                var bin = atob(res.base64), len = bin.length, bytes = new Uint8Array(len);
                for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
                var blob = new Blob([bytes], { type: res.mime || "application/octet-stream" });
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url; a.download = res.fileName || ("report." + format);
                document.body.appendChild(a); a.click();
                setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
            }).catch(function () { MessageToast.show("Could not generate the report."); });
        },

        // ── Read-only milestone preview (detail view) ───────────────────────────
        onPreviewMilestone: function (milestoneId) {
            var that = this;
            var x = ((this._milestones && this._milestones.milestones) || []).find(function (m) { return m.milestoneId === milestoneId; });
            if (!x) { MessageToast.show("Milestone not found."); return; }
            var prColors = { Low: "#64748b", Medium: "#2563eb", High: "#c2410c", Critical: "#dc2626" };
            var prBadge = "<span class='pmPrBadge' style='background:" + (prColors[x.priority] || "#2563eb") + "'>" + esc(x.priority || "Medium") + "</span>";
            var timing = (x.delayDays > 0 ? "<span style='color:#dc2626;font-weight:700'>" + x.delayDays + "d late</span>"
                : x.earlyDays > 0 ? "<span style='color:#16a34a;font-weight:700'>" + x.earlyDays + "d early</span>" : "<span style='color:#16a34a'>on track</span>");
            var kv = function (label, val) {
                return "<div class='pmPvRow'><div class='pmPvK'>" + esc(label) + "</div><div class='pmPvV'>" + val + "</div></div>";
            };
            var block = function (label, text) {
                return "<div class='pmPvBlock'><div class='pmPvK'>" + esc(label) + "</div><div class='pmPvText'>" + (text ? esc(text) : "<span class='pmMuted'>—</span>") + "</div></div>";
            };
            var deps = (x.dependencies || []).length
                ? x.dependencies.map(function (d) { return esc(d.predecessorName); }).join(", ") : "<span class='pmMuted'>None</span>";
            var body =
                kv("Status", that._msStatusChip(x.status) + (x.approvalStatus && x.approvalStatus !== "None" ? " " + that._msApprovalChip(x.approvalStatus) : "")) +
                kv("Priority", prBadge) +
                kv("Timeline", esc(x.plannedStartDate || "—") + " → " + esc(x.plannedEndDate || "—") + " &nbsp; " + timing) +
                kv("Owner", x.ownerName ? esc(x.ownerName) : "<span class='pmMuted'>Unassigned</span>") +
                kv("Estimated Cost", "<b>" + that._inr2(x.estimatedCost != null ? x.estimatedCost : (x.allocatedCost || 0)) + "</b> <span class='pmMuted'>(current allocation plan)</span>") +
                kv("Money Spent", "<b style='color:#16a34a'>" + that._inr2(x.moneySpent || 0) + "</b> <span class='pmMuted'>(actual — accrues as milestone days elapse)</span>") +
                kv("Remaining Forecast", "<b style='color:#2563eb'>" + that._inr2(x.remainingForecast != null ? x.remainingForecast : (x.allocatedCost || 0)) + "</b> <span class='pmMuted'>(Estimated − Money Spent)</span>") +
                kv("Planned Budget", that._inr2(x.plannedBudget || 0)) +
                kv("Resources / Tasks", (x.resourceCount || 0) + " resource(s) · " + (x.taskCount || 0) + " task(s)") +
                kv("Estimated Effort", (x.estimatedEffort || 0) + " hrs") +
                kv("Billable", x.isBillable ? "Yes" : "No") +
                kv("Critical Path", x.isCritical ? "Yes ★" : "No") +
                kv("Depends On", deps) +
                block("Description", x.description) +
                block("Completion Criteria", x.completionCriteria) +
                block("Deliverables", x.deliverables);
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>#" + (x.sequence || 0) + " " + esc(x.name) + "</div>" +
                "<div class='pmDialogBody pmPvBody'>" + body + "</div>" +
                "<div class='pmDialogFoot'><button class='pmBtn primary' id='pmClose'>Close</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmClose").addEventListener("click", close);
        },

        // ── Plan Resources for a milestone (execution plan vs project baseline) ──
        // Non-blocking: quantities may exceed the project plan (real-world temporary
        // increases) — deviations are flagged with warnings + budget impact, never
        // prevented. Reuses getMilestoneResources / saveMilestoneResources.
        onPlanMilestoneResources: function (milestoneId) {
            var that = this;
            ppost("getMilestoneResources", { milestoneId: milestoneId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                var reqs = d.requirements || [], unplanned = d.unplanned || [];
                if (!reqs.length && !unplanned.length) {
                    MessageToast.show("Define the project's Resource Requirements first — they are the baseline for milestone planning.");
                    that.onTab("requirements"); return;
                }
                var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
                // Per-requirement planning rows.
                var rowHtml = reqs.map(function (r) {
                    var rid = esc(r.requirementId);
                    return "<div class='mrpRow' data-req='" + rid + "'>" +
                        "<label class='mrpHead'><input type='checkbox' class='mrpChk' data-req='" + rid + "'" + (r.included ? " checked" : "") + "/> " +
                        "<span class='mrpRole'>" + esc(r.roleName) + "</span> <span class='pmMuted'>" + esc(r.departmentName || "") + " · planned " + r.plannedQuantity + " · " + r.hoursPerEmployee + "h/emp · " + inr(r.ratePerHour) + "/hr</span></label>" +
                        "<div class='mrpInputs' data-req='" + rid + "'" + (r.included ? "" : " style='display:none'") + ">" +
                        "<div class='mrpGrid'>" +
                        "<div><label>Quantity</label><input type='number' min='0' step='1' class='mrpI mrpQty' data-req='" + rid + "' value='" + (r.included ? r.milestoneQuantity : r.plannedQuantity) + "'/></div>" +
                        "<div><label>Hours/emp</label><input type='number' min='0' step='1' class='mrpI mrpHrs' data-req='" + rid + "' value='" + (r.hoursPerEmployee || "") + "'/></div>" +
                        "<div class='mrpNotesCell'><label>Notes</label><input type='text' class='mrpI mrpNotes' data-req='" + rid + "' value='" + esc(r.notes || "") + "'/></div>" +
                        "</div><div class='mrpStatus' data-req='" + rid + "'></div></div></div>";
                }).join("");
                var unplannedHtml = unplanned.length ? "<div class='mrpUnplanned'><b style='color:#dc2626'>Unplanned roles (requirement removed from project):</b>" +
                    unplanned.map(function (u) { return "<div class='pmMuted'>" + esc(u.roleName) + " — milestone qty " + u.milestoneQuantity + " · <span style='color:#dc2626'>not in the approved project plan</span></div>"; }).join("") + "</div>" : "";
                var auditHtml = (d.audit || []).length ? "<details class='mrpAudit'><summary>Change history (" + d.audit.length + ")</summary>" +
                    d.audit.map(function (a) { return "<div class='mrpAuditRow'><b>" + esc(a.roleName) + "</b>: " + a.previousQuantity + " → " + a.newQuantity + " <span class='pmMuted'>by " + esc(a.changedByName || "—") + " · " + esc(String(a.changedAt || "").slice(0, 16).replace("T", " ")) + (a.reason ? " · " + esc(a.reason) : "") + "</span></div>"; }).join("") + "</details>" : "";

                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>Plan Resources — " + esc(d.milestoneName || "") + "</div>" +
                    "<div class='pmDialogBody'>" +
                    "<div class='pmMuted' style='margin-bottom:6px'>Select the roles this milestone needs. The project resource requirements are the baseline — you may request more (temporary increases are allowed) and deviations are flagged, never blocked.</div>" +
                    "<div id='mrpBanner'></div>" +
                    "<div class='mrpRows'>" + rowHtml + "</div>" + unplannedHtml +
                    "<div class='mrpSummary' id='mrpSummary'></div>" +
                    "<label class='pmLbl' style='margin-top:8px'>Reason for changes <span class='pmMuted'>(optional — recorded in the audit trail)</span></label>" +
                    "<input type='text' id='mrpReason' class='pmInput' placeholder='e.g. Additional integration work identified'/>" +
                    auditHtml +
                    "<div id='mrpErr' class='pmErr' style='display:none'></div>" +
                    "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Save Plan</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { ov.remove(); };
                var $ = function (s) { return ov.querySelector(s); };
                ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
                $("#pmCancel").addEventListener("click", close);
                var reqById = {}; reqs.forEach(function (r) { reqById[r.requirementId] = r; });

                // Live validation + budget impact + summary (Parts 5–8).
                var recompute = function () {
                    var anyExceeds = false, totalAdditional = 0, summaryRows = "";
                    reqs.forEach(function (r) {
                        var rid = r.requirementId;
                        var chk = ov.querySelector(".mrpChk[data-req='" + rid + "']");
                        var included = chk.checked;
                        var qty = parseInt(ov.querySelector(".mrpQty[data-req='" + rid + "']").value, 10) || 0;
                        var hrs = parseFloat(ov.querySelector(".mrpHrs[data-req='" + rid + "']").value) || r.hoursPerEmployee || 0;
                        var st = ov.querySelector(".mrpStatus[data-req='" + rid + "']");
                        var planned = r.plannedQuantity, status, statusLabel, color;
                        if (!included || qty === 0) { status = "not-used"; }
                        else if (qty <= planned) { status = "within"; }
                        else { status = "exceeds"; anyExceeds = true; }
                        if (status === "within") {
                            st.innerHTML = "<span class='mrpOk'>✓ Within Project Resource Plan</span>";
                        } else if (status === "exceeds") {
                            var add = qty - planned, cost = Math.round(add * hrs * r.ratePerHour);
                            totalAdditional += cost;
                            st.innerHTML = "<div class='mrpWarn'>⚠ Milestone exceeds planned project requirement." +
                                "<div class='mrpWarnDetail'>Planned Quantity: <b>" + planned + "</b> · Requested: <b>" + qty + "</b> · Additional Required: <b>" + add + "</b>" +
                                " · Estimated Additional Cost: <b>" + inr(cost) + "</b> <span class='pmMuted'>(" + add + " × " + hrs + "h × " + inr(r.ratePerHour) + "/hr)</span></div>" +
                                "<div class='mrpWarnDetail'>This exceeds the originally approved project staffing plan. Please ensure additional budget and resource approval before proceeding.</div></div>";
                        } else { st.innerHTML = ""; }
                        // Summary row
                        var scolor = status === "within" ? "#16a34a" : status === "not-used" ? "#a16207" : "#c2410c";
                        var stxt = status === "within" ? "Within Plan" : status === "not-used" ? "Not Used" : "Exceeds Plan";
                        summaryRows += "<tr><td>" + esc(r.roleName) + "</td><td style='text-align:center'>" + planned + "</td><td style='text-align:center'>" + (included ? qty : 0) + "</td>" +
                            "<td><span class='mrpDot' style='background:" + scolor + "'></span>" + stxt + "</td></tr>";
                    });
                    (unplanned || []).forEach(function (u) {
                        summaryRows += "<tr><td>" + esc(u.roleName) + "</td><td style='text-align:center'>0</td><td style='text-align:center'>" + u.milestoneQuantity + "</td>" +
                            "<td><span class='mrpDot' style='background:#dc2626'></span>Unplanned Role</td></tr>";
                    });
                    if (unplanned && unplanned.length) anyExceeds = true;
                    $("#mrpSummary").innerHTML = "<div class='mrpSummaryHead'>Milestone Resource Summary</div>" +
                        "<table class='pmTable'><thead><tr><th>Role</th><th style='text-align:center'>Planned</th><th style='text-align:center'>Allocated</th><th>Status</th></tr></thead><tbody>" + summaryRows + "</tbody></table>" +
                        (totalAdditional > 0 ? "<div class='mrpTotalCost'>Estimated Additional Cost (over baseline): <b>" + inr(totalAdditional) + "</b></div>" : "");
                    $("#mrpBanner").innerHTML = anyExceeds
                        ? "<div class='mrpBanner'>⚠ <b>Resource Plan Changed — Additional Approval Recommended.</b> This milestone requests more than (or roles outside) the approved project resource plan.</div>"
                        : "<div class='mrpBannerOk'>✓ This milestone is within the approved project resource plan.</div>";
                };
                ov.querySelectorAll(".mrpChk").forEach(function (chk) {
                    chk.addEventListener("change", function () {
                        var rid = this.getAttribute("data-req");
                        ov.querySelector(".mrpInputs[data-req='" + rid + "']").style.display = this.checked ? "block" : "none";
                        recompute();
                    });
                });
                ov.querySelectorAll(".mrpI").forEach(function (i) { i.addEventListener("input", recompute); });
                recompute();

                $("#pmSave").addEventListener("click", function () {
                    var items = reqs.map(function (r) {
                        var rid = r.requirementId;
                        return {
                            requirementId: rid,
                            included: ov.querySelector(".mrpChk[data-req='" + rid + "']").checked,
                            quantity: parseInt(ov.querySelector(".mrpQty[data-req='" + rid + "']").value, 10) || 0,
                            hours: parseFloat(ov.querySelector(".mrpHrs[data-req='" + rid + "']").value) || 0,
                            notes: ov.querySelector(".mrpNotes[data-req='" + rid + "']").value || ""
                        };
                    });
                    var btn = this; btn.disabled = true; btn.textContent = "Saving…";
                    ppost("saveMilestoneResources", { milestoneId: milestoneId, items: JSON.stringify(items), reason: ($("#mrpReason").value || "").trim() })
                        .then(function (res) {
                            btn.disabled = false; btn.textContent = "Save Plan";
                            if (res && res.error) { var e = $("#mrpErr"); e.style.display = "block"; e.textContent = res.error; return; }
                            close();
                            MessageToast.show(res.exceedsResourcePlan ? "Plan saved — exceeds baseline, approval recommended." : "Milestone resource plan saved.");
                            that._loadMilestones();
                        }).catch(function () { btn.disabled = false; btn.textContent = "Save Plan"; var e = $("#mrpErr"); e.style.display = "block"; e.textContent = "Could not save the plan."; });
                });
            }).catch(function () { MessageToast.show("Could not load milestone resources."); });
        },

        // ── Manage Resources for a milestone (always available) ─────────────────
        // Reuses the existing allocate / remove / replace engines. Lists current
        // allocations for the milestone with adjust (%/hours/dates), remove, replace,
        // and an add-employees entry (the grouped multi-select allocation screen).
        onManageMilestoneResources: function (milestoneId) {
            var that = this, pid = this._detail.project.projectId;
            var msList = (this._milestones && this._milestones.milestones) || this._detail.milestones || [];
            var ms = msList.filter(function (m) { return m.milestoneId === milestoneId; })[0] || {};
            var mine = (this._detail.resources || []).filter(function (r) { return r.milestoneId === milestoneId; });
            // Summary cards from the milestone rollup.
            var sm = ((this._milestones && this._milestones.milestones) || []).filter(function (m) { return m.milestoneId === milestoneId; })[0] || ms;
            var totHrs = mine.reduce(function (s, r) { return s + (Number(r.milestoneAllocatedHours || r.estimatedHours) || 0); }, 0);
            var totSpentHrs = mine.reduce(function (s, r) { return s + (Number(r.actualSpentHours) || 0); }, 0);
            var cards = "<div class='mrGridCards'>" +
                "<div class='mrCard'><div class='mrCardVal'>" + mine.length + "</div><div class='mrCardLbl'>Employees</div></div>" +
                "<div class='mrCard'><div class='mrCardVal'>" + Math.round(totHrs) + " h</div><div class='mrCardLbl'>Allocated Hours</div></div>" +
                "<div class='mrCard'><div class='mrCardVal' style='color:#16a34a'>" + Math.round(totSpentHrs) + " h</div><div class='mrCardLbl'>Consumed</div></div>" +
                "<div class='mrCard'><div class='mrCardVal' style='color:#2563eb'>" + that._inr2(sm.remainingForecast || 0) + "</div><div class='mrCardLbl'>Forecast Remaining</div></div>" +
                "</div>";
            var rows = mine.length ? mine.map(function (r) {
                var projH = Number(r.projectAllocationHours) || 0;
                var mPct = Number(r.milestoneAllocationPercent) || (projH > 0 ? Math.round((Number(r.milestoneAllocatedHours || r.estimatedHours) || 0) / projH * 100) : 0);
                var mHrs = Number(r.milestoneAllocatedHours != null ? r.milestoneAllocatedHours : r.estimatedHours) || 0;
                return "<tr><td><b>" + esc(r.employeeName) + "</b><div class='pmMuted' style='font-size:0.7rem'>" + esc(r.employeeId) + " · " + esc(r.department || "") + "</div></td>" +
                    "<td>" + esc(r.role || r.roleCategoryName || "—") + "</td>" +
                    "<td style='text-align:center'>" + (projH ? projH + " h" : "—") + "</td>" +
                    "<td style='text-align:center'><b>" + mPct + "%</b></td>" +
                    "<td style='text-align:center'>" + Math.round(mHrs) + " h</td>" +
                    "<td style='text-align:center;color:#16a34a'>" + Math.round(Number(r.actualSpentHours) || 0) + " h</td>" +
                    "<td style='text-align:center;color:#2563eb'>" + Math.round(Number(r.forecastRemainingHours) || 0) + " h</td>" +
                    "<td style='text-align:right;color:#16a34a'>" + that._inr2(r.actualCost || 0) + "</td>" +
                    "<td style='text-align:right;color:#2563eb'>" + that._inr2(r.forecastCost != null ? r.forecastCost : r.remainingForecast) + "</td>" +
                    "<td style='text-align:right;white-space:nowrap'>" +
                    "<button class='pmLink' onclick=\"window._projCtrl.onAdjustMilestoneResource('" + esc(milestoneId) + "','" + esc(r.employeeId) + "')\">✏️ Edit</button>" +
                    "<button class='pmLink' onclick=\"window._projCtrl.onReplaceRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "','" + esc(milestoneId) + "','" + esc(ms.name || "") + "'," + mPct + ")\">Replace</button>" +
                    "<button class='pmLink danger' onclick=\"window._projCtrl.onRemoveRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "')\">Remove</button>" +
                    "</td></tr>";
            }).join("") : "<tr><td colspan='10' class='pmMuted' style='text-align:center;padding:14px'>No resources allocated to this milestone yet.</td></tr>";
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>Manage Resources — #" + (ms.sequence || 0) + " " + esc(ms.name || "") + "</div>" +
                "<div class='pmDialogBody'>" + cards +
                "<div style='text-align:right;margin-bottom:8px'><button class='pmBtn primary sm' onclick=\"window._projCtrl.onAddMilestoneResources('" + esc(milestoneId) + "')\">＋ Add Employees</button></div>" +
                "<div style='overflow-x:auto'><table class='pmTable'><thead><tr><th>Employee</th><th>Role</th><th>Project Hrs</th><th>Milestone %</th><th>Milestone Hrs</th><th>Spent</th><th>Forecast</th><th style='text-align:right'>Actual Cost</th><th style='text-align:right'>Forecast Cost</th><th style='text-align:right'>Actions</th></tr></thead>" +
                "<tbody>" + rows + "</tbody></table></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmClose'>Close</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmClose").addEventListener("click", close);
            this._manageOverlay = ov;   // so refreshes can re-open it
        },

        // Add employees to a specific milestone → the grouped multi-select screen.
        onAddMilestoneResources: function (milestoneId) {
            if (this._manageOverlay) { this._manageOverlay.remove(); this._manageOverlay = null; }
            var msList = (this._milestones && this._milestones.milestones) || this._detail.milestones || [];
            this._openAllocationScreen(this._detail.project.projectId, msList, milestoneId);
        },

        // Increase/decrease % or hours, extend/reduce dates for one milestone resource.
        // Reuses allocateResourceToMilestone (re-allocation recomputes cost/forecast).
        onAdjustMilestoneResource: function (milestoneId, employeeId) {
            var that = this, pid = this._detail.project.projectId;
            var ms = ((this._milestones && this._milestones.milestones) || this._detail.milestones || []).filter(function (m) { return m.milestoneId === milestoneId; })[0] || {};
            var r = (this._detail.resources || []).filter(function (x) { return x.milestoneId === milestoneId && x.employeeId === employeeId; })[0] || {};
            var projH = Number(r.projectAllocationHours) || 0;
            var curPct = Number(r.milestoneAllocationPercent) || (projH > 0 ? Math.round((Number(r.milestoneAllocatedHours || r.estimatedHours) || 0) / projH * 100) : 0);
            var spentH = Number(r.actualSpentHours) || 0;
            var rate = Number(r.hourlyCost) || 0;
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Edit Allocation — " + esc(r.employeeName || employeeId) + "</div>" +
                "<div class='pmDialogBody'>" +
                "<div class='adjInfo'>Project Allocation: <b>" + (projH || "—") + " h</b> · Actual Spent: <b style='color:#16a34a'>" + Math.round(spentH) + " h</b> <span class='pmMuted'>(never changes)</span></div>" +
                "<label class='pmLbl'>Milestone Allocation % <span class='pmMuted'>(of project hours)</span></label>" +
                "<input id='adjPct' type='number' min='1' max='100' step='5' class='pmInput' value='" + curPct + "'/>" +
                "<div class='adjPreview' id='adjPrev'></div>" +
                "<div class='pmFRow' style='margin-top:8px'><div><label class='pmLbl'>Start</label><input id='adjStart' type='date' class='pmInput' value='" + esc(String(r.startDate || ms.plannedStartDate || "").slice(0, 10)) + "'/></div>" +
                "<div><label class='pmLbl'>End</label><input id='adjEnd' type='date' class='pmInput' value='" + esc(String(r.endDate || ms.plannedEndDate || "").slice(0, 10)) + "'/></div></div>" +
                "<label class='amRadio' style='margin-top:8px'><input type='checkbox' id='adjOverride'/> Allow override (over-capacity / over-budget)</label>" +
                "<div id='adjErr' class='pmErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Apply</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            var $ = function (s) { return ov.querySelector(s); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);
            // Live preview: milestone hours = projectHours × %/100; spent unchanged; forecast = hours − spent.
            var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
            var preview = function () {
                var p = parseFloat($("#adjPct").value) || 0;
                var newHrs = Math.round(projH * (p / 100) * 100) / 100;
                var fRem = Math.max(0, Math.round((newHrs - spentH) * 100) / 100);
                var warn = (spentH > newHrs) ? "<div class='adjWarn'>⚠ Actual spent (" + Math.round(spentH) + "h) exceeds the new allocation (" + Math.round(newHrs) + "h).</div>" : "";
                $("#adjPrev").innerHTML =
                    "<div class='adjRow'><span>Milestone Hours</span><b>" + Math.round(newHrs) + " h</b></div>" +
                    "<div class='adjRow'><span>Actual Spent (frozen)</span><b style='color:#16a34a'>" + Math.round(spentH) + " h · " + inr(spentH * rate) + "</b></div>" +
                    "<div class='adjRow'><span>Forecast Remaining</span><b style='color:#2563eb'>" + Math.round(fRem) + " h · " + inr(fRem * rate) + "</b></div>" +
                    "<div class='adjRow adjTot'><span>New Estimated Cost</span><b>" + inr(newHrs * rate) + "</b></div>" + warn;
            };
            $("#adjPct").addEventListener("input", preview); preview();
            $("#pmSave").addEventListener("click", function () {
                var err = $("#adjErr");
                var p = parseFloat($("#adjPct").value) || 0;
                if (p <= 0 || p > 100) { err.style.display = "block"; err.textContent = "Enter a % between 1 and 100."; return; }
                var s = $("#adjStart").value || null, en = $("#adjEnd").value || null;
                if (s && en && en < s) { err.style.display = "block"; err.textContent = "End date is before start date."; return; }
                var newHrs = Math.round(projH * (p / 100) * 100) / 100;
                var payload = { projectId: pid, employeeId: employeeId, milestoneId: milestoneId, allocationType: r.allocationType || "Hard",
                    estimatedHours: newHrs, projectAllocationHours: projH, milestoneAllocationPercent: p,
                    startDate: s, endDate: en, force: $("#adjOverride").checked, overrideReason: $("#adjOverride").checked ? "Manage Resources adjustment" : "" };
                var btn = this; btn.disabled = true; btn.textContent = "Applying…";
                ppost("allocateResourceToMilestone", payload).then(function (res) {
                    btn.disabled = false; btn.textContent = "Apply";
                    if (res && (res.overallocation || res.budgetOverrun)) { err.style.display = "block"; err.textContent = res.error + " Enable “Allow override”."; return; }
                    if (res && res.error) { err.style.display = "block"; err.textContent = res.error; return; }
                    close(); MessageToast.show("Allocation updated to " + p + "%."); that._open(pid); that._loadMilestones();
                }).catch(function () { btn.disabled = false; btn.textContent = "Apply"; err.style.display = "block"; err.textContent = "Could not update."; });
            });
        },

        // ── Seed milestones from the project type's phases ──────────────────────
        onSeedMilestones: function () {
            var that = this, pid = this._detail.project.projectId;
            ppost("seedMilestones", { projectId: pid }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show(res.created ? (res.created + " milestone(s) created.") : (res.message || "Milestones already exist."));
                that._loadMilestones();
            }).catch(function () { MessageToast.show("Could not seed milestones."); });
        },

        // ── Create / Edit milestone dialog (shared) ─────────────────────────────
        onMilestoneForm: function (milestoneId) {
            var that = this, pid = this._detail.project.projectId;
            var existing = milestoneId ? ((this._milestones.milestones || []).find(function (x) { return x.milestoneId === milestoneId; }) || {}) : {};
            var isEdit = !!milestoneId;
            // Owner choices = allocated resources (+ keep current owner if not in list).
            var resources = (this._detail.resources || []).slice().sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
            var ownerOpts = "<option value=''>— No owner —</option>" + resources.map(function (r) {
                return "<option value='" + esc(r.employeeId) + "'" + (existing.ownerId === r.employeeId ? " selected" : "") + ">" + esc(r.employeeName) + "</option>";
            }).join("");
            if (existing.ownerId && !resources.some(function (r) { return r.employeeId === existing.ownerId; }))
                ownerOpts += "<option value='" + esc(existing.ownerId) + "' selected>" + esc(existing.ownerName || existing.ownerId) + "</option>";
            var modeOpts = ["manual", "task", "timesheet"].map(function (mo) {
                return "<option value='" + mo + "'" + ((existing.progressMode || "manual") === mo ? " selected" : "") + ">" + mo + "</option>";
            }).join("");
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>" + (isEdit ? "Edit Milestone" : "Add Milestone") + "</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Name *</label><input type='text' class='pmFInput' id='msName' value='" + esc(existing.name || "") + "' placeholder='e.g. Requirement Gathering'/>" +
                "<label class='pmFLbl'>Description</label><textarea class='pmFInput' id='msDesc' rows='2'>" + esc(existing.description || "") + "</textarea>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Planned Start</label><input type='date' class='pmFInput' id='msStart' value='" + esc(existing.plannedStartDate || "") + "'/></div>" +
                "<div><label class='pmFLbl'>Planned End</label><input type='date' class='pmFInput' id='msEnd' value='" + esc(existing.plannedEndDate || "") + "'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Sequence</label><input type='number' min='0' step='1' class='pmFInput' id='msSeq' value='" + (existing.sequence != null ? existing.sequence : "") + "'/></div>" +
                "<div><label class='pmFLbl'>Owner</label><select class='pmFInput' id='msOwner'>" + ownerOpts + "</select></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Progress Mode</label><select class='pmFInput' id='msMode'>" + modeOpts + "</select></div>" +
                "<div><label class='pmFLbl'>Planned Budget (₹)</label><input type='number' min='0' step='1' class='pmFInput' id='msBudget' value='" + (existing.plannedBudget || 0) + "'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Priority</label><select class='pmFInput' id='msPriority'>" +
                ["Low", "Medium", "High", "Critical"].map(function (p) { return "<option value='" + p + "'" + ((existing.priority || "Medium") === p ? " selected" : "") + ">" + p + "</option>"; }).join("") +
                "</select></div><div><label class='pmFLbl'>Estimated Effort (hrs)</label><input type='number' min='0' step='1' class='pmFInput' id='msEffort' value='" + (existing.estimatedEffort || 0) + "'/></div></div>" +
                "<label class='pmFLbl'>Completion Criteria</label><textarea class='pmFInput' id='msCrit2' rows='2' placeholder='Definition of done for this milestone'>" + esc(existing.completionCriteria || "") + "</textarea>" +
                "<label class='pmFLbl'>Deliverables</label><textarea class='pmFInput' id='msDeliv' rows='2' placeholder='Expected outputs (comma-separated or one per line)'>" + esc(existing.deliverables || "") + "</textarea>" +
                "<div class='pmTypeToggle'><label><input type='checkbox' id='msCrit'" + (existing.isCritical ? " checked" : "") + "/> Critical path</label>" +
                "<label><input type='checkbox' id='msBill'" + (existing.isBillable !== false ? " checked" : "") + "/> Billable</label></div>" +
                (isEdit ? "<label class='pmFLbl'>Remarks</label><textarea class='pmFInput' id='msRemarks' rows='2'>" + esc(existing.remarks || "") + "</textarea>" : "") +
                "<div class='pmErr' id='msErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>" + (isEdit ? "Save Changes" : "Create") + "</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            var showErr = function (msg) { var e = ov.querySelector("#msErr"); e.textContent = "⚠ " + msg; e.style.display = "block"; };
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                var name = (ov.querySelector("#msName").value || "").trim();
                if (!name) { showErr("Name is required."); return; }
                var start = ov.querySelector("#msStart").value || null;
                var end = ov.querySelector("#msEnd").value || null;
                if (start && end && end < start) { showErr("Planned End cannot be before Planned Start."); return; }
                var seqVal = ov.querySelector("#msSeq").value;
                var params = {
                    name: name, description: (ov.querySelector("#msDesc").value || "").trim(),
                    plannedStartDate: start, plannedEndDate: end,
                    ownerId: ov.querySelector("#msOwner").value || null,
                    isCritical: ov.querySelector("#msCrit").checked, isBillable: ov.querySelector("#msBill").checked,
                    plannedBudget: parseFloat(ov.querySelector("#msBudget").value) || 0,
                    progressMode: ov.querySelector("#msMode").value,
                    sequence: seqVal === "" ? null : parseInt(seqVal, 10),
                    priority: ov.querySelector("#msPriority").value,
                    estimatedEffort: parseFloat(ov.querySelector("#msEffort").value) || 0,
                    completionCriteria: (ov.querySelector("#msCrit2").value || "").trim(),
                    deliverables: (ov.querySelector("#msDeliv").value || "").trim()
                };
                if (isEdit) { params.milestoneId = milestoneId; params.remarks = (ov.querySelector("#msRemarks").value || "").trim(); }
                else { params.projectId = pid; }
                btn.disabled = true; btn.textContent = "Saving…";
                ppost(isEdit ? "updateMilestone" : "createMilestone", params).then(function (res) {
                    btn.disabled = false; btn.textContent = isEdit ? "Save Changes" : "Create";
                    if (res && res.error) { showErr(res.error); return; }
                    close(); MessageToast.show(isEdit ? "Milestone updated." : "Milestone created."); that._loadMilestones();
                }).catch(function () { btn.disabled = false; btn.textContent = isEdit ? "Save Changes" : "Create"; showErr("Could not save the milestone."); });
            });
        },

        onStartMilestone: function (milestoneId) {
            var that = this;
            ppost("startMilestone", { milestoneId: milestoneId }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Milestone started."); that._loadMilestones();
            }).catch(function () { MessageToast.show("Could not start the milestone."); });
        },

        onMsProgress: function (milestoneId, current) {
            var that = this;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Update Progress</div>" +
                "<div class='pmDialogBody'><label class='pmFLbl'>Progress %</label>" +
                "<input type='number' min='0' max='100' step='5' class='pmFInput' id='msPct' value='" + (current || 0) + "'/>" +
                "<div class='pmErr' id='msPErr' style='display:none'></div></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Update</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var pct = Math.max(0, Math.min(100, parseInt(ov.querySelector("#msPct").value, 10) || 0));
                this.disabled = true; this.textContent = "Updating…";
                ppost("updateMilestoneProgress", { milestoneId: milestoneId, progressPct: pct }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Progress updated."); that._loadMilestones();
                }).catch(function () { close(); MessageToast.show("Could not update progress."); });
            });
        },

        // Complete — server gates on open tasks / pending approval and asks for an
        // override when those rules aren't met; we surface that as a confirm dialog.
        onCompleteMilestone: function (milestoneId, override) {
            var that = this;
            ppost("completeMilestone", { milestoneId: milestoneId, override: !!override }).then(function (res) {
                if (res && res.error) {
                    if (res.needsOverride) { that._confirmOverrideComplete(milestoneId, res.error); return; }
                    MessageToast.show(res.error); return;
                }
                MessageToast.show("Milestone " + (res.status === "Completed Early" ? "completed early." : "completed.")); that._loadMilestones();
            }).catch(function () { MessageToast.show("Could not complete the milestone."); });
        },
        _confirmOverrideComplete: function (milestoneId, msg) {
            var that = this;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>⚠ Complete with Override</div>" +
                "<div class='pmDialogBody'><p>" + esc(msg) + "</p><p class='pmMuted'>Override the completion rules and mark this milestone complete anyway?</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmNo'>Cancel</button><button class='pmBtn danger' id='pmYes'>Override & Complete</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmNo").addEventListener("click", close);
            ov.querySelector("#pmYes").addEventListener("click", function () { close(); that.onCompleteMilestone(milestoneId, true); });
        },

        onDeleteMilestone: function (milestoneId, name) {
            var that = this;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Delete Milestone</div>" +
                "<div class='pmDialogBody'><p>Delete <b>" + esc(name) + "</b>?</p>" +
                "<p class='pmMuted'>Any resources or tasks linked to it revert to project-level (no data is lost).</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmNo'>Cancel</button><button class='pmBtn danger' id='pmYes'>Delete</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmNo").addEventListener("click", close);
            ov.querySelector("#pmYes").addEventListener("click", function () {
                this.disabled = true; this.textContent = "Deleting…";
                ppost("deleteMilestone", { milestoneId: milestoneId }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Milestone deleted."); that._loadMilestones();
                }).catch(function () { close(); MessageToast.show("Could not delete the milestone."); });
            });
        },

        // ── Dependency management (Phase 2) — finish-to-start predecessors ──────
        // A milestone cannot START until every predecessor reaches a terminal state.
        // Backend guards same-project, self-loop and simple cycles.
        onManageDeps: function (milestoneId) {
            var that = this;
            var all = (this._milestones.milestones || []);
            var me = all.find(function (x) { return x.milestoneId === milestoneId; }) || {};
            var current = me.dependencies || [];
            var currentIds = current.map(function (d) { return d.predecessorId; });
            // Candidate predecessors = other milestones not already a predecessor.
            var candidates = all.filter(function (x) { return x.milestoneId !== milestoneId && currentIds.indexOf(x.milestoneId) === -1; });

            var renderBody = function () {
                var list = current.length
                    ? current.map(function (d) {
                        return "<div class='pmDepRow'><span>↳ " + esc(d.predecessorName) + "</span>" +
                            "<button class='pmLink danger' onclick=\"window._projCtrl.onRemoveDep('" + esc(milestoneId) + "','" + esc(d.dependencyId) + "')\">Remove</button></div>";
                    }).join("")
                    : "<div class='pmMuted'>No predecessors. This milestone can start anytime.</div>";
                var addOpts = candidates.map(function (x) { return "<option value='" + esc(x.milestoneId) + "'>#" + (x.sequence || 0) + " " + esc(x.name) + "</option>"; }).join("");
                var adder = candidates.length
                    ? "<div class='pmFRow' style='margin-top:10px'><div style='flex:1'><label class='pmFLbl'>Add predecessor</label>" +
                        "<select class='pmFInput' id='depAdd'><option value=''>— Select milestone —</option>" + addOpts + "</select></div>" +
                        "<div style='display:flex;align-items:flex-end'><button class='pmBtn primary sm' id='depAddBtn'>Add</button></div></div>"
                    : "<div class='pmMuted' style='margin-top:8px'>No other milestones available to add as a predecessor.</div>";
                return "<div class='pmDepList'>" + list + "</div>" + adder;
            };

            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Dependencies — " + esc(me.name || "") + "</div>" +
                "<div class='pmDialogBody' id='depBody'>" + renderBody() + "</div>" +
                "<div class='pmDialogFoot'><button class='pmBtn primary' id='pmClose'>Done</button></div></div>";
            document.body.appendChild(ov);
            this._depOverlay = ov;
            var close = function () { ov.remove(); that._depOverlay = null; that._loadMilestones(); };
            ov.querySelector("#pmClose").addEventListener("click", close);
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            var bindAdd = function () {
                var btn = ov.querySelector("#depAddBtn");
                if (!btn) return;
                btn.addEventListener("click", function () {
                    var pre = ov.querySelector("#depAdd").value;
                    if (!pre) { MessageToast.show("Select a milestone."); return; }
                    btn.disabled = true; btn.textContent = "Adding…";
                    ppost("setMilestoneDependency", { milestoneId: milestoneId, predecessorId: pre }).then(function (res) {
                        if (res && res.error) { btn.disabled = false; btn.textContent = "Add"; MessageToast.show(res.error); return; }
                        var added = all.find(function (x) { return x.milestoneId === pre; }) || {};
                        current.push({ dependencyId: milestoneId + "<-" + pre, predecessorId: pre, predecessorName: added.name || pre });
                        currentIds.push(pre);
                        candidates = candidates.filter(function (x) { return x.milestoneId !== pre; });
                        ov.querySelector("#depBody").innerHTML = renderBody(); bindAdd();
                    }).catch(function () { btn.disabled = false; btn.textContent = "Add"; MessageToast.show("Could not add dependency."); });
                });
            };
            bindAdd();
        },
        onRemoveDep: function (milestoneId, dependencyId) {
            var that = this, ov = this._depOverlay;
            ppost("removeMilestoneDependency", { dependencyId: dependencyId }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Dependency removed.");
                // Refresh the dialog in place by reopening against fresh data.
                if (ov) { ov.remove(); that._depOverlay = null; }
                ppost("getMilestones", { projectId: that._detail.project.projectId }).then(function (m) {
                    that._milestones = (m && !m.error) ? m : that._milestones;
                    that.onManageDeps(milestoneId);
                });
            }).catch(function () { MessageToast.show("Could not remove dependency."); });
        },

        // ── Approval workflow (Phase 10) — request + decide ─────────────────────
        onRequestApproval: function (milestoneId, name) {
            var that = this, pid = this._detail.project.projectId;
            var ROLES = ["Project Manager", "Product Manager", "Client", "Founder"];
            var resources = (this._detail.resources || []).slice().sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
            var roleOpts = ROLES.map(function (r) { return "<option>" + r + "</option>"; }).join("");
            var approverOpts = "<option value=''>— Default (project POC) —</option>" + resources.map(function (r) {
                return "<option value='" + esc(r.employeeId) + "'>" + esc(r.employeeName) + " (" + esc(r.department) + ")</option>";
            }).join("");
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Request Approval — " + esc(name) + "</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Approver Role</label><select class='pmFInput' id='apRole'>" + roleOpts + "</select>" +
                "<label class='pmFLbl'>Notify (optional)</label><select class='pmFInput' id='apWho'>" + approverOpts + "</select>" +
                "<label class='pmFLbl'>Comments</label><textarea class='pmFInput' id='apCmt' rows='3' placeholder='Context for the approver…'></textarea>" +
                "<div class='pmErr' id='apErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Request Approval</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                btn.disabled = true; btn.textContent = "Requesting…";
                ppost("requestMilestoneApproval", {
                    milestoneId: milestoneId, approverRole: ov.querySelector("#apRole").value,
                    approverId: ov.querySelector("#apWho").value || null, comments: (ov.querySelector("#apCmt").value || "").trim()
                }).then(function (res) {
                    btn.disabled = false; btn.textContent = "Request Approval";
                    if (res && res.error) { var e = ov.querySelector("#apErr"); e.textContent = "⚠ " + res.error; e.style.display = "block"; return; }
                    close(); MessageToast.show("Approval requested."); that._loadMilestones();
                }).catch(function () { btn.disabled = false; btn.textContent = "Request Approval"; var e = ov.querySelector("#apErr"); e.textContent = "⚠ Could not request approval."; e.style.display = "block"; });
            });
        },
        onDecideApproval: function (milestoneId, name) {
            var that = this;
            var DECISIONS = [["Approved", "✓ Approve", "primary"], ["Rework Required", "↻ Request Rework", "ghost"], ["Rejected", "✗ Reject", "danger"]];
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Approval Decision — " + esc(name) + "</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Comments</label><textarea class='pmFInput' id='dcCmt' rows='3' placeholder='Reason / feedback (recommended for rework or rejection)…'></textarea>" +
                "<div class='pmErr' id='dcErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button>" +
                DECISIONS.map(function (d) { return "<button class='pmBtn " + d[2] + "' data-dec='" + d[0] + "'>" + d[1] + "</button>"; }).join("") +
                "</div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelectorAll("button[data-dec]").forEach(function (b) {
                b.addEventListener("click", function () {
                    var decision = this.getAttribute("data-dec");
                    ov.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
                    ppost("decideMilestoneApproval", { milestoneId: milestoneId, decision: decision, comments: (ov.querySelector("#dcCmt").value || "").trim() })
                        .then(function (res) {
                            if (res && res.error) { ov.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); var e = ov.querySelector("#dcErr"); e.textContent = "⚠ " + res.error; e.style.display = "block"; return; }
                            close(); MessageToast.show("Milestone " + decision + "."); that._loadMilestones();
                        }).catch(function () { ov.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); var e = ov.querySelector("#dcErr"); e.textContent = "⚠ Could not record the decision."; e.style.display = "block"; });
                });
            });
        },

        // ════════════════════════════════════════════════════════════════════════
        // REQUIREMENTS TAB (Phase 4) — declare Dept→Role→Spec demand for the project.
        // ════════════════════════════════════════════════════════════════════════
        _loadRequirements: function () {
            var that = this, pid = this._detail && this._detail.project && this._detail.project.projectId;
            if (!pid) return;
            // Load hierarchy once (for the add dialog), then the requirements.
            var hierP = this._resHier ? Promise.resolve(this._resHier) : ppost("getResourceHierarchy", {}).then(function (h) { that._resHier = (h && !h.error) ? h : { departments: [] }; return that._resHier; }).catch(function () { that._resHier = { departments: [] }; return that._resHier; });
            hierP.then(function () {
                return ppost("getResourceRequirements", { projectId: pid });
            }).then(function (res) {
                that._requirements = (res && !res.error) ? res : { requirements: [], canManage: false };
                that._render();
            }).catch(function () { that._requirements = { requirements: [], canManage: false }; that._render(); });
        },

        // Experience badge from a range string (Junior / Mid / Senior / Expert).
        _expBadge: function (range) {
            var s = String(range || "").toLowerCase();
            var lvl, col;
            if (/12|expert/.test(s)) { lvl = "Expert"; col = "#7c3aed"; }
            else if (/\b(8|9|10|11)\b|8\+|senior/.test(s)) { lvl = "Senior"; col = "#2563eb"; }
            else if (/\b(3|4|5|6|7)\b|mid/.test(s)) { lvl = "Mid Level"; col = "#16a34a"; }
            else { lvl = "Junior"; col = "#0891b2"; }
            return "<span class='rqExpBadge' style='--c:" + col + "'>● " + lvl + (range ? " <span class='rqExpYrs'>(" + esc(range) + ")</span>" : "") + "</span>";
        },
        // Allocation-driven status (Part 11).
        _reqStatusBadge: function (allocated, required, status) {
            if (status === "Closed" || status === "Fulfilled") return "<span class='rqStatus' style='--c:#64748b'>⚪ Closed</span>";
            if (allocated <= 0) return "<span class='rqStatus' style='--c:#dc2626'>🔴 Not Allocated</span>";
            if (allocated < required) return "<span class='rqStatus' style='--c:#d97706'>🟡 Partially Allocated</span>";
            if (allocated === required) return "<span class='rqStatus' style='--c:#16a34a'>🟢 Fully Allocated</span>";
            return "<span class='rqStatus' style='--c:#ea580c'>🟠 Over Allocated</span>";
        },
        _roleIcon: function (role) {
            var s = String(role || "").toLowerCase();
            if (/qa|test/.test(s)) return "🧪"; if (/basis|security|admin/.test(s)) return "🛡️";
            if (/fico|fi|finance|funds/.test(s)) return "💹"; if (/mm|sd|pp|functional|mdg/.test(s)) return "📦";
            if (/ui5|fiori|frontend|ux/.test(s)) return "🎨"; if (/cap|abap|backend|developer|engineer/.test(s)) return "👨‍💻";
            return "👤";
        },
        _renderRequirementsTab: function () {
            var r = this._requirements, that = this;
            if (!r) {
                // Loading skeletons.
                var sk = "<div class='rqGrid'>" + [0, 1, 2].map(function () { return "<div class='rqCard rqSkeleton'><div class='sk sk1'></div><div class='sk sk2'></div><div class='sk sk3'></div><div class='sk sk4'></div></div>"; }).join("") + "</div>";
                return "<div class='pmPanel'>" + sk + "</div>";
            }
            // The POC / founder can always add requirements. Fall back to the reliably-
            // loaded project-detail flags so the button is never hidden by a stale or
            // partial requirements payload.
            var d = this._detail || {};
            var canManage = !!r.canManage || !!(d.isPoc || d.canManage || (d.project && d.project.isPoc));
            var reqs = r.requirements || [];
            var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
            var head = "<div class='rqHead'><div class='rqHeadTitle'>Resource Requirements</div>" +
                (canManage ? "<button class='pmBtn primary' onclick=\"window._projCtrl.onAddRequirement()\">＋ Add Requirement</button>" : "") + "</div>";

            if (!reqs.length) {
                return "<div class='pmPanel'>" + head +
                    "<div class='rqEmpty'><div class='rqEmptyIco'>🗂️</div><div class='rqEmptyTitle'>No resource requirements yet</div>" +
                    "<div class='pmMuted'>Define what the project needs — Department, Role, Experience &amp; Skills — to build the staffing baseline.</div>" +
                    (canManage ? "<button class='pmBtn primary' style='margin-top:12px' onclick=\"window._projCtrl.onAddRequirement()\">＋ Add your first requirement</button>" : "") +
                    "</div></div>";
            }

            var cards = reqs.map(function (x) {
                var qty = x.requiredCount || 0;
                var estH = (x.estimatedHours != null ? x.estimatedHours : x.requiredHours) || 0;
                var totalH = (x.totalPlannedHours != null) ? x.totalPlannedHours : (qty * estH);
                var skillChips = (x.skills || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
                    .map(function (s) { return "<span class='rqChip'>" + esc(s) + "</span>"; }).join("");
                var acts = canManage
                    ? "<button class='rqIconBtn primary' title='Manage Allocation' onclick=\"window._projCtrl.onManageRequirementAllocation('" + esc(x.requirementId) + "')\">👥 Allocate</button>" +
                      "<button class='rqIconBtn' title='Edit Requirement' onclick=\"window._projCtrl.onEditRequirement('" + esc(x.requirementId) + "')\">✏️</button>" +
                      "<button class='rqIconBtn danger' title='Delete Requirement' onclick=\"window._projCtrl.onDeleteRequirement('" + esc(x.requirementId) + "','" + esc(x.roleCategoryName || "") + "')\">🗑️</button>"
                    : "";
                return "<div class='rqCard'>" +
                    "<div class='rqCardTop'><div class='rqRole'><span class='rqRoleIco'>" + that._roleIcon(x.roleCategoryName) + "</span>" +
                        "<div><div class='rqRoleName'>" + esc(x.roleCategoryName || "—") + "</div><div class='pmMuted' style='font-size:0.72rem'>" + esc(x.departmentName || "") + (x.skillCategory ? " · " + esc(x.skillCategory) : "") + "</div></div></div></div>" +
                    "<div class='rqExpRow'>" + that._expBadge(x.experienceRange) + "</div>" +
                    "<div class='rqMetrics'>" +
                        "<div><span class='rqMLbl'>👥 Required</span><span class='rqMVal'>" + qty + "</span></div>" +
                        "<div><span class='rqMLbl'>⏱ Effort / Emp</span><span class='rqMVal'>" + estH + " h</span></div>" +
                        "<div><span class='rqMLbl'>📈 Total Planned</span><span class='rqMVal'>" + totalH + " h</span></div>" +
                    "</div>" +
                    (skillChips ? "<div class='rqSkillsBlk'><div class='rqMLbl'>🏷 Required Skills</div><div class='rqChips'>" + skillChips + "</div></div>" : "") +
                    (acts ? "<div class='rqActions'>" + acts + "</div>" : "") +
                    "</div>";
            }).join("");
            return "<div class='pmPanel'>" + head + "<div class='rqGrid'>" + cards + "</div></div>";
        },
        // Manage Allocation from a requirement card → the milestone allocation flow.
        onManageRequirementAllocation: function () { this.onAllocateByMilestone(); },

        onAddRequirement: function () { this._openRequirementForm(null); },
        onEditRequirement: function (requirementId) {
            var existing = ((this._requirements && this._requirements.requirements) || []).filter(function (x) { return x.requirementId === requirementId; })[0];
            if (!existing) { MessageToast.show("Requirement not found."); return; }
            this._openRequirementForm(existing);
        },

        // Autocomplete over the ALREADY-LOADED company master data (getResourceHierarchy
        // skills + specializations) — same source of truth as HR, filtered client-side
        // so it's instant and needs no extra endpoint. `candidates` = array of names.
        _reqAutocomplete: function (input, drop, candidates, onPick, clearOnPick) {
            var show = function () {
                var q = (input.value || "").trim().toLowerCase();
                var list = (typeof candidates === "function" ? candidates() : candidates) || [];
                var items = (q ? list.filter(function (n) { return String(n).toLowerCase().indexOf(q) !== -1; }) : list.slice());
                items.sort(function (a, b) {
                    var as = String(a).toLowerCase().indexOf(q) === 0 ? 0 : 1, bs = String(b).toLowerCase().indexOf(q) === 0 ? 0 : 1;
                    return as - bs || String(a).localeCompare(String(b));
                });
                items = items.slice(0, 10);
                if (!items.length) { drop.style.display = "none"; return; }
                drop.innerHTML = items.map(function (n) { return "<div class='acItem' data-name='" + esc(n) + "'>" + esc(n) + "</div>"; }).join("");
                drop.style.display = "block";
                drop.querySelectorAll(".acItem").forEach(function (it) {
                    it.addEventListener("mousedown", function (e) {
                        e.preventDefault();
                        var name = it.getAttribute("data-name");
                        onPick(name); drop.style.display = "none";
                        input.value = clearOnPick ? "" : name;
                    });
                });
            };
            input.addEventListener("input", show);
            input.addEventListener("focus", show);
            input.addEventListener("blur", function () { setTimeout(function () { drop.style.display = "none"; }, 160); });
        },

        // Shared Add/Edit requirement dialog — sectioned, standardized inputs.
        _openRequirementForm: function (existing) {
            var that = this, pid = this._detail.project.projectId, isEdit = !!existing;
            var depts = (this._resHier && this._resHier.departments) || [];
            var projDepts = (this._requirements && this._requirements.projectDepartments) || [];
            var defaultDept = existing ? existing.departmentId : null;
            if (!defaultDept) projDepts.forEach(function (pd) {
                if (defaultDept) return;
                var m = depts.filter(function (d) { return String(d.name).toLowerCase() === String(pd).toLowerCase() || String(d.deptId).toLowerCase() === String(pd).toLowerCase(); })[0];
                if (m) defaultDept = m.deptId;
            });
            var EXP = [["0-2 Years", "Junior"], ["3-5 Years", "Mid Level"], ["8+ Years", "Senior"], ["12+ Years", "Expert"]];
            var curExp = existing ? existing.experienceRange : "";
            var deptOpts = "<option value=''>— Select department —</option>" + depts.map(function (d) { return "<option value='" + esc(d.deptId) + "'" + (d.deptId === defaultDept ? " selected" : "") + ">" + esc(d.name) + "</option>"; }).join("");
            var expOpts = "<option value=''>— Select experience —</option>" + EXP.map(function (e) { return "<option value='" + e[0] + "'" + (curExp === e[0] ? " selected" : "") + ">" + e[1] + " (" + e[0] + ")</option>"; }).join("");

            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog rqDialog'><div class='pmDialogHead'>" + (isEdit ? "Edit Resource Requirement" : "Add Resource Requirement") + "</div>" +
                "<div class='pmDialogBody'>" +
                "<div class='rqSection'><div class='rqSecTitle'>1 · Basic Information</div>" +
                    "<label class='pmFLbl'>Department <span class='rqReq'>*</span></label><select class='pmFInput' id='rqDept'>" + deptOpts + "</select>" +
                    "<div class='pmFRow'><div><label class='pmFLbl'>Role <span class='rqReq'>*</span></label><select class='pmFInput' id='rqRole'><option value=''>— Select role —</option></select></div>" +
                    "<div><label class='pmFLbl'>Experience <span class='rqReq'>*</span></label><select class='pmFInput' id='rqExp'>" + expOpts + "</select></div></div></div>" +
                "<div class='rqSection'><div class='rqSecTitle'>2 · Skill Category</div>" +
                    "<label class='pmFLbl'>Skills Category <span class='rqReq'>*</span></label><div class='acWrap'><input type='text' class='pmFInput' id='rqSkillCat' autocomplete='off' placeholder='Select a role first, then choose a category' value='" + esc(existing ? (existing.skillCategory || "") : "") + "'/><div class='acDrop' id='rqSkillCatDrop'></div></div>" +
                    "<div class='pmMuted' style='font-size:0.7rem;margin-top:2px'>Suggestions come from the selected role's specializations (company master).</div></div>" +
                "<div class='rqSection'><div class='rqSecTitle'>3 · Planning</div>" +
                    "<div class='pmFRow'><div><label class='pmFLbl'>Quantity <span class='rqReq'>*</span></label><input type='number' min='1' step='1' class='pmFInput' id='rqCount' value='" + (existing ? existing.requiredCount : 1) + "'/></div>" +
                    "<div><label class='pmFLbl'>Estimated Hours (Per Employee) <span class='rqReq'>*</span></label><input type='number' min='1' step='1' class='pmFInput' id='rqHours' value='" + (existing ? (existing.estimatedHours || "") : "") + "' placeholder='e.g. 40'/></div></div>" +
                    "<div class='rqTotalBox'>Total Planned Hours: <b id='rqTotal'>0 h</b> <span class='pmMuted' id='rqTotalCalc'></span></div></div>" +
                "<div class='pmErr' id='rqErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>" + (isEdit ? "Save Changes" : "Add Requirement") + "</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            var $ = function (s) { return ov.querySelector(s); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);

            // Department → Role (company master via hierarchy). No Category/Module.
            var deptSel = $("#rqDept"), roleSel = $("#rqRole");
            var populateRoles = function (preRole) {
                var dept = depts.filter(function (d) { return d.deptId === deptSel.value; })[0];
                var roles = (dept && dept.roles) || [];
                roleSel.innerHTML = "<option value=''>— Select role —</option>" + roles.map(function (r) { return "<option value='" + esc(r.roleId) + "'" + (preRole === r.roleId ? " selected" : "") + ">" + esc(r.name) + "</option>"; }).join("");
            };
            // Skill Category candidates = the SELECTED ROLE's specializations only.
            var categoryFor = function () {
                var role = null;
                (depts || []).forEach(function (d) { (d.roles || []).forEach(function (r) { if (r.roleId === roleSel.value) role = r; }); });
                return role ? (role.specializations || []).map(function (sp) { return sp.name; }) : [];
            };
            var onRoleChange = function () {
                // Clear a category that no longer belongs to the newly-selected role.
                var valid = categoryFor();
                if ($("#rqSkillCat").value && valid.indexOf($("#rqSkillCat").value) === -1) $("#rqSkillCat").value = "";
            };
            deptSel.addEventListener("change", function () { populateRoles(); onRoleChange(); recalc(); });
            roleSel.addEventListener("change", onRoleChange);
            if (defaultDept) populateRoles(existing ? existing.roleCategoryId : null);

            // Skills Category autocomplete — scoped to the selected role (dynamic list).
            this._reqAutocomplete($("#rqSkillCat"), $("#rqSkillCatDrop"), categoryFor, function (name) { $("#rqSkillCat").value = name; }, false);

            // Live total planned hours.
            var recalc = function () {
                var q = parseInt($("#rqCount").value, 10) || 0, h = parseFloat($("#rqHours").value) || 0;
                var total = Math.round(q * h * 100) / 100;
                $("#rqTotal").textContent = total + " h";
                $("#rqTotalCalc").textContent = (q && h) ? ("(" + q + " × " + h + ")") : "";
            };
            $("#rqCount").addEventListener("input", recalc); $("#rqHours").addEventListener("input", recalc); recalc();

            $("#pmSave").addEventListener("click", function () {
                var btn = this, showErr = function (m) { var e = $("#rqErr"); e.textContent = "⚠ " + m; e.style.display = "block"; };
                var deptId = deptSel.value, roleId = roleSel.value;
                var skillCat = ($("#rqSkillCat").value || "").trim(), exp = $("#rqExp").value;
                var qty = parseInt($("#rqCount").value, 10) || 0, hrs = parseFloat($("#rqHours").value) || 0;
                if (!deptId) return showErr("Department is required.");
                if (!roleId) return showErr("Role is required.");
                if (!exp) return showErr("Experience is required.");
                if (!skillCat) return showErr("Skills Category is required.");
                if (qty < 1) return showErr("Quantity must be at least 1.");
                if (hrs < 1) return showErr("Estimated Hours must be greater than 0.");
                btn.disabled = true; btn.textContent = "Saving…";
                var payload = { departmentId: deptId, roleCategoryId: roleId, requiredCount: qty, estimatedHours: hrs, skillCategory: skillCat, experienceRange: exp };
                var action = isEdit ? "updateResourceRequirement" : "createResourceRequirement";
                if (isEdit) payload.requirementId = existing.requirementId; else payload.projectId = pid;
                ppost(action, payload).then(function (res) {
                    btn.disabled = false; btn.textContent = isEdit ? "Save Changes" : "Add Requirement";
                    if (res && res.error) { showErr(res.error); return; }
                    close(); MessageToast.show(isEdit ? "Requirement updated." : "Requirement added."); that._loadRequirements();
                }).catch(function () { btn.disabled = false; btn.textContent = isEdit ? "Save Changes" : "Add Requirement"; showErr("Could not save the requirement."); });
            });
        },

        onDeleteRequirement: function (requirementId, roleName) {
            var that = this;
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Delete Requirement</div>" +
                "<div class='pmDialogBody'><p>Delete the requirement for <b>" + esc(roleName || "this role") + "</b>? This removes it from the project's staffing baseline.</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn danger' id='pmConfirm'>Delete</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmConfirm").addEventListener("click", function () {
                this.disabled = true; this.textContent = "Deleting…";
                ppost("deleteResourceRequirement", { requirementId: requirementId }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Requirement deleted."); that._loadRequirements();
                }).catch(function () { close(); MessageToast.show("Could not delete the requirement."); });
            });
        },

        _renderMeetingsTab: function () {
            var d = this._detail, mtgData = this._meetings || { meetings: [], canManage: false };
            var canManage = d.isPoc || mtgData.canManage;
            var head = "<div class='pmPanelHead'>Meetings <span class='pmCount'>" + (mtgData.meetings || []).length + "</span>" +
                (canManage ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onScheduleMeeting()\">＋ Schedule Meeting</button>" : "") + "</div>";
            var rows = (mtgData.meetings || []).map(function (m) {
                // Ongoing = a scheduled meeting whose window covers "now".
                var nowIso = new Date().toISOString();
                var ongoing = m.status === "Scheduled" && m.startISO && m.endISO && m.startISO <= nowIso && m.endISO >= nowIso;
                var dispStatus = ongoing ? "Ongoing" : m.status;
                var sc = ongoing ? "#16a34a" : (MTG_STATUS_COLOR[m.status] || "#6b7280");
                // Join only for selected participants / organizer / POC; others view only.
                var joinBtn = (m.canJoin && m.teamsJoinUrl && m.status !== "Cancelled")
                    ? "<a href='" + esc(m.teamsJoinUrl) + "' target='_blank' class='pmBtn primary sm' style='text-decoration:none;'>Join</a>"
                    : (m.status !== "Cancelled" ? "<span class='pmMuted' style='font-size:0.74rem'>View Details Only</span>" : "");
                var editBtn = canManage && m.status === "Scheduled"
                    ? "<button class='pmLink' onclick=\"window._projCtrl.onEditMeeting('" + esc(m.meetingId) + "')\">Edit</button>" : "";
                var cxlBtn = canManage && m.status === "Scheduled"
                    ? "<button class='pmLink danger' onclick=\"window._projCtrl.onCancelMeeting('" + esc(m.meetingId) + "','" + esc(m.title) + "')\">Cancel</button>" : "";
                var partNames = (m.participants || []).map(function (p) { return esc(p.employeeName); }).join(", ");
                return "<tr><td><b>" + esc(m.title) + "</b><div class='pmMuted'>" + esc(partNames || "—") + "</div></td>" +
                    "<td>" + esc(m.dateLabel) + "</td><td>" + esc(m.timeLabel) + "</td>" +
                    "<td><span style='color:" + sc + ";font-weight:600;font-size:0.8rem'>" + esc(dispStatus) + "</span></td>" +
                    "<td>" + esc(m.organizer) + "</td>" +
                    "<td style='display:flex;gap:6px;align-items:center'>" + joinBtn + editBtn + cxlBtn + "</td></tr>";
            }).join("");
            return "<div class='pmPanel'>" + head +
                (rows ? "<table class='pmTable'><thead><tr><th>Meeting</th><th>Date</th><th>Time</th><th>Status</th><th>Organizer</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>"
                    : "<div class='pmMuted'>No meetings scheduled yet.</div>") + "</div>";
        },

        _loadMeetings: function () {
            var that = this, pid = this._detail && this._detail.project && this._detail.project.projectId;
            if (!pid) return;
            pprojpost("getProjectMeetings", { projectId: pid }).then(function (res) {
                that._meetings = (res && !res.error) ? res : { meetings: [], canManage: false };
                that._render();
            }).catch(function () { that._meetings = { meetings: [], canManage: false }; that._render(); });
        },

        onOpen: function (id) { this._open(id); },
        onBack: function () { this._load(); },

        // ════════════════════════════════════════════════════════════════════════
        // SPRINT MANAGEMENT (Tasks tab) — Milestone → Sprints → Work Items → Kanban.
        // ════════════════════════════════════════════════════════════════════════
        _wiIcon: function (t) { var m = { Epic: "🟪", Story: "📗", Task: "✅", Bug: "🐞", Subtask: "🔗", Spike: "🔬" }; return m[t] || "✅"; },
        _prioDot: function (p) { var c = { Critical: "#dc2626", High: "#ea580c", Medium: "#2563eb", Low: "#64748b" }; return "<span class='spDot' style='background:" + (c[p] || "#64748b") + "'></span>"; },

        _renderSprintTab: function (d) {
            var ms = (this._milestones && this._milestones.milestones) || d.milestones || [];
            var sel = this._sprintMilestone || "";
            var opts = "<option value=''>— Select a milestone —</option>" + ms.map(function (m) {
                return "<option value='" + esc(m.milestoneId) + "'" + (m.milestoneId === sel ? " selected" : "") + ">#" + (m.sequence || 0) + " " + esc(m.name) + "</option>";
            }).join("");
            var head = "<div class='pmPanel'><div class='spHead'><div><div class='rqHeadTitle'>Sprints</div>" +
                "<div class='pmMuted'>Milestones plan the business · Sprints execute the work inside them.</div></div>" +
                "<div class='spMsPick'><label class='pmFLbl' style='margin:0'>Milestone <span class='rqReq'>*</span></label>" +
                "<select class='pmSelect wide' onchange=\"window._projCtrl.onSprintMilestone(this.value)\">" + opts + "</select></div></div>";
            if (!sel) {
                return head + "<div class='rqEmpty'><div class='rqEmptyIco'>🏃</div><div class='rqEmptyTitle'>Select a milestone to plan sprints</div>" +
                    "<div class='pmMuted'>Sprints, stories, tasks and bugs live inside a milestone. Pick one above to view its Sprint Backlog and boards.</div></div></div>";
            }
            // Board view takes over when a sprint board is open.
            if (this._sprintBoard && this._sprintBoard.milestoneId === sel) return head + this._renderSprintBoard() + "</div>";
            return head + this._renderSprintList() + "</div>";
        },
        _renderWorkflowStrip: function () {
            var w = this._workflow; if (!w || !(w.stages || []).length) return "";
            var steps = w.stages.map(function (st, i) {
                var cls = st.done ? "done" : (st.key === w.nextStage ? "next" : "todo");
                return "<div class='wfStep " + cls + "'><span class='wfDot'>" + (st.done ? "✓" : (i + 1)) + "</span>" +
                    "<span class='wfLbl'>" + esc(st.label) + (st.count ? " <b>" + st.count + "</b>" : "") + "</span></div>";
            }).join("<span class='wfSep'></span>");
            return "<div class='wfStrip'><div class='wfTitle'>Workflow <span class='pmMuted'>" + (w.completedStages || 0) + "/" + (w.totalStages || 0) +
                " · next: " + esc(w.nextLabel || "Complete") + "</span></div><div class='wfSteps'>" + steps + "</div></div>";
        },
        onSprintMilestone: function (msId) {
            this._sprintMilestone = msId; this._sprints = null; this._sprintBoard = null;
            if (msId) this._loadSprints(); else this._render();
        },
        _loadSprints: function () {
            var that = this, msId = this._sprintMilestone;
            if (!msId) return;
            Promise.all([ppost("getSprints", { projectId: this._detail.project.projectId }), ppost("getMilestoneTeam", { milestoneId: msId }), ppost("getProjectWorkflow", { projectId: this._detail.project.projectId })]).then(function (a) {
                that._sprints = (a[0] && !a[0].error) ? a[0] : { sprints: [], error: (a[0] && a[0].error) };
                that._team = (a[1] && a[1].team) || [];
                that._workflow = (a[2] && !a[2].error) ? a[2] : null;
                if ((that._detailTab || "") === "tasks") that._render();
            }).catch(function () { that._sprints = { sprints: [] }; that._render(); });
        },
        _renderSprintList: function () {
            var s = this._sprints;
            if (!s) { this._loadSprints(); return "<div class='pmLoading'>Loading sprints…</div>"; }
            if (s.error) return "<div class='pmMuted'>" + esc(s.error) + "</div>";
            var canManage = !!s.canManage, that = this;
            var wf = this._renderWorkflowStrip();
            var bar = wf + "<div class='spListBar'><div class='spMsProg'>Project execution progress: <b>" + (s.overallProgress || s.milestoneProgress || 0) + "%</b>" +
                "<div class='rqProgTrack' style='width:180px;display:inline-block;margin-left:8px;vertical-align:middle'><div class='rqProgFill' style='width:" + (s.milestoneProgress || 0) + "%;background:#16a34a'></div></div></div>" +
                (canManage ? "<button class='pmBtn primary sm' onclick=\"window._projCtrl.onCreateSprint()\">＋ Create Sprint</button>" : "") + "</div>";
            if (!(s.sprints || []).length) {
                return bar + "<div class='rqEmpty'><div class='rqEmptyIco'>🏃</div><div class='rqEmptyTitle'>No sprints in this milestone yet</div>" +
                    "<div class='pmMuted'>Create your first sprint to start planning execution." + (s.backlog && s.backlog.count ? " There are " + s.backlog.count + " backlog item(s)." : "") + "</div></div>";
            }
            var cards = s.sprints.map(function (sp) {
                var stCol = { Backlog: "#64748b", Planned: "#4338ca", Active: "#16a34a", Completed: "#0891b2", Cancelled: "#94a3b8" }[sp.status] || "#64748b";
                var m = sp.metrics || {};
                var overCap = sp.estimatedCapacityHours > 0 && sp.allocatedCapacity > sp.estimatedCapacityHours;
                var acts = "";
                if (canManage) {
                    if (sp.status === "Backlog" || sp.status === "Planned") acts += "<button class='pmLink' onclick=\"window._projCtrl.onSprintAction('" + esc(sp.sprintId) + "','start')\">▶ Start</button>";
                    if (sp.status === "Active") acts += "<button class='pmLink' onclick=\"window._projCtrl.onSprintAction('" + esc(sp.sprintId) + "','complete')\">✓ Complete</button>";
                    if (sp.status !== "Completed" && sp.status !== "Cancelled") acts += "<button class='pmLink' onclick=\"window._projCtrl.onEditSprint('" + esc(sp.sprintId) + "')\">Edit</button>";
                    if (sp.status !== "Completed" && sp.status !== "Cancelled") acts += "<button class='pmLink' onclick=\"window._projCtrl.onSprintAction('" + esc(sp.sprintId) + "','cancel')\">Cancel</button>";
                    acts += "<button class='pmLink danger' onclick=\"window._projCtrl.onDeleteSprint('" + esc(sp.sprintId) + "','" + esc(sp.name) + "')\">Delete</button>";
                }
                return "<div class='spCard'>" +
                    "<div class='spCardTop'><div><span class='spBadge' style='background:" + stCol + "'>" + esc(sp.status) + "</span> <b class='spName'>" + esc(sp.name) + "</b>" +
                        "<div class='pmMuted' style='font-size:0.74rem'>🎯 " + esc(sp.goal || "—") + "</div></div>" +
                        "<div class='spCardBtns'>" + (canManage ? "<button class='pmBtn outline sm' onclick=\"window._projCtrl.onSprintPlanning('" + esc(sp.sprintId) + "')\">🗓 Plan</button>" : "") +
                        "<button class='pmBtn outline sm' onclick=\"window._projCtrl.onOpenBoard('" + esc(sp.sprintId) + "')\">Open Board →</button></div></div>" +
                    "<div class='spMeta'>" + esc(String(sp.startDate || "—").slice(0, 10)) + " → " + esc(String(sp.endDate || "—").slice(0, 10)) +
                        (sp.ownerName ? " · 👤 " + esc(sp.ownerName) : "") + "</div>" +
                    "<div class='spStats'>" +
                        "<span>📗 " + (m.stories ? m.stories.done + "/" + m.stories.total : "0/0") + " stories</span>" +
                        "<span>✅ " + (m.tasks ? m.tasks.done + "/" + m.tasks.total : "0/0") + " tasks</span>" +
                        "<span>🐞 " + (m.bugs ? m.bugs.done + "/" + m.bugs.total : "0/0") + " bugs</span>" +
                        "<span>⭐ " + (m.storyPointsDone || 0) + "/" + (m.storyPointsTotal || 0) + " pts</span>" +
                        "<span>⏱ " + (m.loggedHours || 0) + "/" + (m.estHours || 0) + " h</span>" +
                        "<span class='" + (overCap ? "spOver" : "") + "'>📊 Cap " + sp.allocatedCapacity + "/" + sp.estimatedCapacityHours + " h</span>" +
                    "</div>" +
                    "<div class='spProgRow'><div class='rqProgTrack'><div class='rqProgFill' style='width:" + (m.progressPct || 0) + "%;background:" + (m.progressPct >= 100 ? "#16a34a" : "#2563eb") + "'></div></div><span class='spProgPct'>" + (m.progressPct || 0) + "%</span></div>" +
                    (overCap ? "<div class='spWarn'>⚠ Allocated hours exceed the sprint's estimated capacity.</div>" : "") +
                    (acts ? "<div class='spActions'>" + acts + "</div>" : "") +
                    "</div>";
            }).join("");
            return bar + "<div class='spGrid'>" + cards + "</div>";
        },
        _renderSprintBoard: function () {
            var b = this._sprintBoard, that = this;
            if (!b) return "";
            var m = b.metrics || {};
            var canManage = !!b.canManage;
            var head = "<div class='spBoardHead'><button class='pmBtn ghost sm' onclick=\"window._projCtrl.onCloseBoard()\">← Sprints</button>" +
                "<div class='spBoardTitle'><b>" + esc(b.name) + "</b> <span class='spBadge' style='background:#2563eb'>" + esc(b.status) + "</span><div class='pmMuted' style='font-size:0.74rem'>🎯 " + esc(b.goal || "") + "</div></div>" +
                "<div class='spBoardStats'>⭐ " + (m.storyPointsDone || 0) + "/" + (m.storyPointsTotal || 0) + " pts · ⏱ " + (m.loggedHours || 0) + "/" + (m.estHours || 0) + " h · " + (m.progressPct || 0) + "%</div>" +
                "<button class='pmBtn ghost sm' onclick=\"window._projCtrl.onSprintReport()\">📊 Reports</button>" +
                (canManage ? "<button class='pmBtn primary sm' onclick=\"window._projCtrl.onCreateWorkItem()\">＋ Work Item</button>" : "") + "</div>";
            var cols = (b.columns || []).map(function (col) {
                var items = (col.items || []).map(function (it) {
                    return "<div class='spCardItem' draggable='true' data-task='" + esc(it.taskId) + "' " +
                        "onclick=\"window._projCtrl.onWorkItemDetail('" + esc(it.taskId) + "')\" " +
                        "ondragstart=\"window._projCtrl.onWiDragStart(event,'" + esc(it.taskId) + "')\">" +
                        "<div class='spItemTop'>" + that._wiIcon(it.type) + " <span class='spItemType'>" + esc(it.type) + "</span> " + that._prioDot(it.priority) +
                        (it.storyPoints ? "<span class='spPts'>" + it.storyPoints + "</span>" : "") + "</div>" +
                        "<div class='spItemTitle'>" + esc(it.title) + "</div>" +
                        "<div class='spItemFoot'><span class='pmMuted'>" + esc(it.assignee || "Unassigned") + "</span>" +
                        (it.estimatedHours ? "<span class='pmMuted'>" + it.loggedHours + "/" + it.estimatedHours + "h</span>" : "") + "</div>" +
                        (it.labels ? "<div class='spLabels'>" + it.labels.split(",").map(function (l) { return l.trim() ? "<span class='spLabel'>" + esc(l.trim()) + "</span>" : ""; }).join("") + "</div>" : "") +
                        "</div>";
                }).join("");
                return "<div class='spCol' ondragover='event.preventDefault()' ondrop=\"window._projCtrl.onWiDrop(event,'" + esc(col.key) + "')\">" +
                    "<div class='spColHead'>" + esc(col.key) + " <span class='pmCount'>" + (col.items || []).length + "</span></div>" +
                    "<div class='spColBody'>" + (items || "<div class='spColEmpty'>—</div>") + "</div></div>";
            }).join("");
            return head + "<div class='spBoard'>" + cols + "</div>";
        },
        onOpenBoard: function (sprintId) {
            var that = this;
            ppost("getSprintBoard", { sprintId: sprintId }).then(function (b) {
                if (b && b.error) { MessageToast.show(b.error); return; }
                that._sprintBoard = b; that._render();
            }).catch(function () { MessageToast.show("Could not open the board."); });
        },
        onCloseBoard: function () { this._sprintBoard = null; this._loadSprints(); },

        // ── Sprint Planning: cross-project availability + drag stories into the sprint ──
        onSprintPlanning: function (sprintId) {
            var that = this; this._planSprintId = sprintId;
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog alFull'><div id='spPlanRoot'><div class='pmLoading'>Loading sprint planning…</div></div></div>";
            document.body.appendChild(ov);
            ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
            this._planOverlay = ov; this._loadSprintPlanning();
        },
        _loadSprintPlanning: function () {
            var that = this;
            ppost("getSprintPlanning", { sprintId: this._planSprintId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); if (that._planOverlay) that._planOverlay.remove(); return; }
                that._planData = d; that._renderSprintPlanning();
            }).catch(function () { MessageToast.show("Could not load sprint planning."); });
        },
        onCloseSprintPlanning: function () { if (this._planOverlay) { this._planOverlay.remove(); this._planOverlay = null; } this._loadSprints(); },
        _renderSprintPlanning: function () {
            var d = this._planData, ov = this._planOverlay; if (!ov) return;
            var sp = d.sprint || {}, sm = d.summary || {}, cm = !!d.canManage;
            var inr = function (n) { return Math.round(Number(n) || 0); };
            var stC = { Available: "#16a34a", "Partially Loaded": "#2563eb", "Fully Loaded": "#d97706", Overallocated: "#dc2626" };
            var head = "<div class='alHeader'><div class='alHTitle'>Sprint Planning <span class='alHSub'>· " + esc(sp.name || "") + "</span></div>" +
                "<button class='alClose' onclick=\"window._projCtrl.onCloseSprintPlanning()\">✕ Close</button></div>" +
                "<div class='alMsBar'><span class='alMsChip' style='--c:#2563eb'>" + esc(sp.status || "") + "</span>" +
                "<span class='alMsDates'>" + esc(String(sp.startDate || "—").slice(0, 10)) + " → " + esc(String(sp.endDate || "—").slice(0, 10)) + "</span>" +
                "<span class='alMsDays'>🎯 " + esc(sp.goal || "") + "</span></div>";

            var card = function (v, l, c) { return "<div class='alCard'><div class='alCardBody'><div class='alCardVal'" + (c ? " style='color:" + c + "'" : "") + ">" + v + "</div><div class='alCardLbl'>" + l + "</div></div></div>"; };
            var cards = "<div class='alCards' style='grid-template-columns:repeat(5,1fr)'>" +
                card(sm.teamSize || 0, "Team") +
                card((sm.teamCapacity || 0) + " h", "Team Capacity", "#2563eb") +
                card((sm.committedHours || 0) + " h", "Committed (this sprint)", "#7c3aed") +
                card((sm.availableHours || 0) + " h", "Available", "#16a34a") +
                card(sm.overallocated || 0, "Overallocated", (sm.overallocated > 0 ? "#dc2626" : "#16a34a")) +
                "</div>";

            var warn = "";
            if ((d.milestoneWarnings || []).length) {
                warn = "<div class='alWarnBanner'>⚠ <b>Milestone plan exceeded:</b> " + d.milestoneWarnings.map(function (w) {
                    return esc(w.milestoneName) + " (planned " + w.plannedHours + "h vs allocated " + w.allocatedHours + "h, +" + w.exceedBy + "h)";
                }).join("; ") + ". Increase milestone allocation or move stories to another sprint.</div>";
            }

            // Availability list
            var emps = (d.employees || []).map(function (e) {
                var p = String(e.employeeName || "").trim().split(/\s+/), ini = (((p[0] || "")[0] || "") + ((p[1] || "")[0] || "")).toUpperCase();
                var barPct = Math.min(100, e.utilizationPct || 0), col = e.overallocated ? "#ef4444" : (e.utilizationPct >= 85 ? "#d97706" : "#22c55e");
                return "<div class='spPlanEmp" + (e.overallocated ? " over" : "") + "' onclick=\"window._projCtrl.onWorkloadEmployee('" + esc(e.employeeId) + "')\" title='View cross-project workload'>" +
                    "<div class='spPlanEmpTop'><span class='alAvatar' style='background:#4338ca;width:34px;height:34px;font-size:0.75rem'>" + esc(ini) + "</span>" +
                    "<div style='min-width:0;flex:1'><b class='alEmpName'>" + esc(e.employeeName) + "</b><div class='alEmpRole'>" + esc(e.department) + (e.role ? " · " + esc(e.role) : "") + "</div></div>" +
                    "<span class='alStatus' style='--c:" + (stC[e.status] || "#64748b") + "'>" + esc(e.status) + "</span></div>" +
                    "<div class='spCapBar'><div class='spCapFill' style='width:" + barPct + "%;background:" + col + "'></div></div>" +
                    "<div class='spCapNums'><span>Cap <b>" + e.capacity + "h</b></span><span>This <b>" + e.thisSprintHours + "h</b></span>" +
                    "<span>Other <b>" + e.otherProjectHours + "h</b></span><span class='" + (e.availableHours < 0 ? "neg" : "pos") + "'>Free <b>" + e.availableHours + "h</b></span>" +
                    "<span>Util <b>" + e.utilizationPct + "%</b></span></div></div>";
            }).join("") || "<div class='pmMuted' style='padding:16px'>No employees allocated to this project yet.</div>";

            // Stories: sprint (assigned) + backlog (draggable/add)
            var storyRow = function (s, inSprint) {
                return "<div class='spStoryRow'><div style='min-width:0;flex:1'><b>" + esc(s.title) + "</b>" +
                    "<div class='pmMuted' style='font-size:0.68rem'>" + (s.milestoneName ? "📌 " + esc(s.milestoneName) + " · " : "") + (s.storyPoints || 0) + " pts · " + s.estimatedHours + "h</div></div>" +
                    (cm ? (inSprint
                        ? "<button class='pmLink danger' onclick=\"window._projCtrl.onAssignStoryToSprint('" + esc(s.taskId) + "','')\">Remove</button>"
                        : "<button class='pmBtn primary sm' onclick=\"window._projCtrl.onAssignStoryToSprint('" + esc(s.taskId) + "','" + esc(sp.sprintId) + "')\">Add →</button>") : "") + "</div>";
            };
            var sprintStories = (d.sprintStories || []).map(function (s) { return storyRow(s, true); }).join("") || "<div class='spColEmpty'>No stories in this sprint yet.</div>";
            var backlog = (d.backlogStories || []).map(function (s) { return storyRow(s, false); }).join("") || "<div class='spColEmpty'>Backlog is empty. Create stories on the board.</div>";

            var body = "<div class='spPlanGrid'>" +
                "<div class='spPlanCol'><div class='spPlanColHead'>Team Availability <span class='pmMuted'>(cross-project)</span></div><div class='spPlanScroll'>" + emps + "</div></div>" +
                "<div class='spPlanCol'><div class='spPlanColHead'>In this Sprint (" + (d.sprintStories || []).length + ")</div><div class='spPlanScroll spPlanShort'>" + sprintStories + "</div>" +
                "<div class='spPlanColHead'>Backlog Stories (" + (d.backlogStories || []).length + ")</div><div class='spPlanScroll spPlanShort'>" + backlog + "</div></div>" +
                "</div>";

            ov.querySelector("#spPlanRoot").innerHTML = head + cards + warn + body;
        },
        onAssignStoryToSprint: function (taskId, sprintId) {
            var that = this;
            ppost("moveWorkItem", { taskId: taskId, sprintId: sprintId || null }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show(sprintId ? "Story added to sprint." : "Story removed from sprint.");
                that._loadSprintPlanning();
            }).catch(function () { MessageToast.show("Could not update the story."); });
        },
        // ── Cross-project workload popup for one employee ──
        onWorkloadEmployee: function (empId) {
            var that = this;
            ppost("getEmployeeWorkload", { employeeId: empId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                that._renderWorkload(d);
            }).catch(function () { MessageToast.show("Could not load workload."); });
        },
        _renderWorkload: function (d) {
            var e = d.employee || {}, cm = d.currentMonth || {};
            var stC = { Available: "#16a34a", "Partially Loaded": "#2563eb", "Fully Loaded": "#d97706", Overallocated: "#dc2626" };
            var projs = (d.projects || []).map(function (p) {
                var sprints = (p.sprints || []).map(function (s) { return "<div class='wlSprint'><span>" + esc(s.sprintName) + "</span><span class='pmMuted'>" + esc(String(s.startDate || "").slice(0, 10)) + "→" + esc(String(s.endDate || "").slice(0, 10)) + "</span><b>" + s.remainingHours + "h</b></div>"; }).join("");
                return "<div class='wlProj'><div class='wlProjHead'><b>" + esc(p.projectName) + "</b><span class='wlProjHrs'>" + p.totalHours + "h</span></div>" + sprints + "</div>";
            }).join("") || "<div class='pmMuted'>No active sprint commitments.</div>";
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Workload · " + esc(e.employeeName) + " <span class='pmMuted' style='font-size:0.75rem;font-weight:400'>" + esc(e.department || "") + "</span></div>" +
                "<div class='pmDialogBody'>" +
                "<div class='wlSnap'><div class='wlSnapCard'><div class='wlSnapVal'>" + (cm.capacity || 0) + "h</div><div class='wlSnapLbl'>Capacity (month)</div></div>" +
                "<div class='wlSnapCard'><div class='wlSnapVal' style='color:#7c3aed'>" + (cm.committedHours || 0) + "h</div><div class='wlSnapLbl'>Committed</div></div>" +
                "<div class='wlSnapCard'><div class='wlSnapVal' style='color:" + (cm.availableHours < 0 ? "#dc2626" : "#16a34a") + "'>" + (cm.availableHours || 0) + "h</div><div class='wlSnapLbl'>Available</div></div>" +
                "<div class='wlSnapCard'><div class='wlSnapVal'>" + (cm.utilizationPct || 0) + "%</div><div class='wlSnapLbl'><span class='alStatus' style='--c:" + (stC[cm.status] || "#64748b") + "'>" + esc(cm.status || "") + "</span></div></div></div>" +
                "<div class='wlProjsTitle'>Active commitments across " + (d.projectCount || 0) + " project(s) · " + (d.totalCommittedHours || 0) + "h total</div>" +
                projs +
                "</div><div class='pmDialogFoot'><button class='pmBtn primary' id='wlClose'>Close</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (ev) { if (ev.target === ov) close(); });
            ov.querySelector("#wlClose").addEventListener("click", close);
        },
        onWiDragStart: function (ev, taskId) { ev.dataTransfer.setData("text/plain", taskId); ev.dataTransfer.effectAllowed = "move"; },
        onWiDrop: function (ev, column) {
            ev.preventDefault();
            var taskId = ev.dataTransfer.getData("text/plain"); if (!taskId) return;
            var that = this, sprintId = this._sprintBoard && this._sprintBoard.sprintId;
            ppost("moveWorkItem", { taskId: taskId, status: column }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                if (sprintId) that.onOpenBoard(sprintId);   // refresh board + metrics
            }).catch(function () { MessageToast.show("Could not move the item."); });
        },
        onSprintAction: function (sprintId, action) {
            var that = this;
            ppost("setSprintStatus", { sprintId: sprintId, action: action }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show(action === "complete" ? ("Sprint completed" + (res.movedToBacklog ? " · " + res.movedToBacklog + " unfinished → backlog" : "")) : ("Sprint " + action + "ed."));
                that._loadSprints();
            }).catch(function () { MessageToast.show("Could not update the sprint."); });
        },
        onDeleteSprint: function (sprintId, name) {
            var that = this;
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Delete Sprint</div>" +
                "<div class='pmDialogBody'><p>Delete <b>" + esc(name) + "</b>? Its work items return to the milestone backlog (nothing is lost).</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn danger' id='pmConfirm'>Delete</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmConfirm").addEventListener("click", function () {
                ppost("deleteSprint", { sprintId: sprintId }).then(function (res) { close(); if (res && res.error) { MessageToast.show(res.error); return; } MessageToast.show("Sprint deleted."); that._loadSprints(); });
            });
        },
        onCreateSprint: function () { this._openSprintForm(null); },
        onEditSprint: function (sprintId) {
            var sp = ((this._sprints && this._sprints.sprints) || []).filter(function (x) { return x.sprintId === sprintId; })[0];
            this._openSprintForm(sp || null);
        },
        _openSprintForm: function (existing) {
            var that = this, msId = this._sprintMilestone, isEdit = !!existing;
            var team = this._team || [];
            var ownerOpts = "<option value=''>— No owner —</option>" + team.map(function (t) { return "<option value='" + esc(t.employeeId) + "'" + (existing && existing.ownerId === t.employeeId ? " selected" : "") + ">" + esc(t.employeeName) + "</option>"; }).join("");
            var win = (this._sprints && this._sprints.window) || {};
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>" + (isEdit ? "Edit Sprint" : "Create Sprint") + "</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Sprint Name <span class='rqReq'>*</span></label><input class='pmFInput' id='spName' value='" + esc(existing ? existing.name : "") + "' placeholder='e.g. Sprint 1'/>" +
                "<label class='pmFLbl'>Sprint Goal <span class='rqReq'>*</span></label><input class='pmFInput' id='spGoal' value='" + esc(existing ? existing.goal : "") + "' placeholder='What will this sprint achieve?'/>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Sprint Number</label><input type='number' min='1' class='pmFInput' id='spNum' value='" + (existing ? existing.sprintNumber : "") + "'/></div>" +
                "<div><label class='pmFLbl'>Estimated Capacity (h)</label><input type='number' min='0' class='pmFInput' id='spCap' value='" + (existing ? existing.estimatedCapacityHours : "") + "'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Start Date <span class='rqReq'>*</span></label><input type='date' class='pmFInput' id='spStart' value='" + esc(existing ? String(existing.startDate || "").slice(0, 10) : String(win.start || "").slice(0, 10)) + "'/></div>" +
                "<div><label class='pmFLbl'>End Date <span class='rqReq'>*</span></label><input type='date' class='pmFInput' id='spEnd' value='" + esc(existing ? String(existing.endDate || "").slice(0, 10) : String(win.end || "").slice(0, 10)) + "'/></div></div>" +
                "<label class='pmFLbl'>Sprint Owner</label><select class='pmFInput' id='spOwner'>" + ownerOpts + "</select>" +
                "<label class='pmFLbl'>Description</label><textarea class='pmFInput' id='spDesc' rows='2'>" + esc(existing ? existing.description : "") + "</textarea>" +
                "<div class='pmErr' id='spErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>" + (isEdit ? "Save" : "Create") + "</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); }; var $ = function (s) { return ov.querySelector(s); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);
            $("#pmSave").addEventListener("click", function () {
                var btn = this, err = $("#spErr"), showErr = function (m) { err.textContent = "⚠ " + m; err.style.display = "block"; };
                var payload = { name: ($("#spName").value || "").trim(), goal: ($("#spGoal").value || "").trim(),
                    sprintNumber: parseInt($("#spNum").value, 10) || null, estimatedCapacityHours: parseFloat($("#spCap").value) || 0,
                    startDate: $("#spStart").value || null, endDate: $("#spEnd").value || null, ownerId: $("#spOwner").value || null, description: ($("#spDesc").value || "").trim() };
                if (!payload.name) return showErr("Sprint Name is required.");
                if (!payload.goal) return showErr("Sprint Goal is required.");
                if (!payload.startDate || !payload.endDate) return showErr("Start and End dates are required.");
                if (payload.endDate < payload.startDate) return showErr("End Date cannot be before Start Date.");
                btn.disabled = true; btn.textContent = "Saving…";
                if (isEdit) payload.sprintId = existing.sprintId; else payload.projectId = that._detail.project.projectId;
                ppost(isEdit ? "updateSprint" : "createSprint", payload).then(function (res) {
                    btn.disabled = false; btn.textContent = isEdit ? "Save" : "Create";
                    if (res && res.error) { showErr(res.error); return; }
                    close(); MessageToast.show(isEdit ? "Sprint updated." : "Sprint created."); that._loadSprints();
                }).catch(function () { btn.disabled = false; btn.textContent = isEdit ? "Save" : "Create"; showErr("Could not save the sprint."); });
            });
        },
        onCreateWorkItem: function () {
            var that = this, b = this._sprintBoard; if (!b) return;
            var pid = this._detail.project.projectId, team = this._team || [];
            var TYPES = ["Story", "Task", "Bug", "Subtask", "Epic", "Spike"];
            var assigneeOpts = "<option value=''>— Unassigned —</option>" + team.map(function (t) { return "<option value='" + esc(t.employeeId) + "'>" + esc(t.employeeName) + "</option>"; }).join("");
            // Milestone (business bridge) + parent Story options for the new architecture.
            var msList = this._milestones || [];
            var msOpts = "<option value=''>— Select milestone —</option>" + msList.map(function (m) { return "<option value='" + esc(m.milestoneId) + "'>#" + (m.sequence || 0) + " " + esc(m.name) + "</option>"; }).join("");
            var storyItems = []; ((b.columns) || []).forEach(function (col) { (col.items || []).forEach(function (it) { if (it.type === "Story" || it.type === "Epic") storyItems.push(it); }); });
            var storyOpts = "<option value=''>— Select parent story —</option>" + storyItems.map(function (s) { return "<option value='" + esc(s.taskId) + "'>" + esc(s.title) + "</option>"; }).join("");
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>New Work Item · " + esc(b.name) + "</div>" +
                "<div class='pmDialogBody'>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Type</label><select class='pmFInput' id='wiType'>" + TYPES.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select></div>" +
                "<div><label class='pmFLbl'>Priority</label><select class='pmFInput' id='wiPrio'><option>Medium</option><option>High</option><option>Critical</option><option>Low</option></select></div></div>" +
                "<label class='pmFLbl'>Title <span class='rqReq'>*</span></label><input class='pmFInput' id='wiTitle' placeholder='Short summary'/>" +
                "<div id='wiMsWrap'><label class='pmFLbl'>Milestone <span class='rqReq'>*</span> <span class='pmMuted'>(business deliverable a Story belongs to)</span></label><select class='pmFInput' id='wiMs'>" + msOpts + "</select></div>" +
                "<div id='wiParentWrap' style='display:none'><label class='pmFLbl'>Parent Story <span class='rqReq'>*</span> <span class='pmMuted'>(Task/Subtask inherit its milestone &amp; sprint)</span></label><select class='pmFInput' id='wiParent'>" + storyOpts + "</select></div>" +
                "<label class='pmFLbl'>Description</label><textarea class='pmFInput' id='wiDesc' rows='2'></textarea>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Assignee <span class='pmMuted'>(milestone team)</span></label><select class='pmFInput' id='wiAssignee'>" + assigneeOpts + "</select></div>" +
                "<div><label class='pmFLbl'>Story Points</label><input type='number' min='0' step='1' class='pmFInput' id='wiPts' placeholder='0'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Estimated Hours</label><input type='number' min='0' step='1' class='pmFInput' id='wiEst' placeholder='e.g. 8'/></div>" +
                "<div><label class='pmFLbl'>Due Date</label><input type='date' class='pmFInput' id='wiDue'/></div></div>" +
                "<label class='pmFLbl'>Labels <span class='pmMuted'>(comma-separated)</span></label><input class='pmFInput' id='wiLabels' placeholder='backend, api'/>" +
                "<div class='pmMuted' style='font-size:0.7rem;margin-top:4px'>Assignee, hours &amp; points are optional for Epic / Story / Spike.</div>" +
                "<div class='pmErr' id='wiErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Create</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); }; var $ = function (s) { return ov.querySelector(s); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);
            // Type drives which linkage is required: Story→milestone, Task/Subtask→parent
            // story, Bug→milestone OR parent story, Epic/Spike→neither.
            var syncType = function () {
                var t = $("#wiType").value;
                var needParent = (t === "Task" || t === "Subtask");
                var needMs = (t === "Story" || t === "Bug");
                $("#wiParentWrap").style.display = needParent ? "" : "none";
                $("#wiMsWrap").style.display = needMs ? "" : "none";
            };
            $("#wiType").addEventListener("change", syncType); syncType();
            $("#pmSave").addEventListener("click", function () {
                var btn = this, err = $("#wiErr"), showErr = function (m) { err.textContent = "⚠ " + m; err.style.display = "block"; };
                if (!($("#wiTitle").value || "").trim()) return showErr("Title is required.");
                var t = $("#wiType").value, msId = $("#wiMs").value || null, parentId = $("#wiParent").value || null;
                if (t === "Story" && !msId) return showErr("A Story must belong to a Milestone.");
                if ((t === "Task" || t === "Subtask") && !parentId) return showErr("A " + t + " must belong to a parent Story.");
                btn.disabled = true; btn.textContent = "Creating…";
                ppost("createProjectTask", {
                    projectId: pid, sprintId: b.sprintId, taskName: ($("#wiTitle").value || "").trim(),
                    description: ($("#wiDesc").value || "").trim(), workItemType: t,
                    milestoneId: msId, parentTaskId: parentId,
                    assignedToId: $("#wiAssignee").value || null, priority: $("#wiPrio").value,
                    storyPoints: parseFloat($("#wiPts").value) || 0, estimatedHours: parseFloat($("#wiEst").value) || 0,
                    dueDate: $("#wiDue").value || null, labels: ($("#wiLabels").value || "").trim()
                }).then(function (res) {
                    btn.disabled = false; btn.textContent = "Create";
                    if (res && res.error) { showErr(res.error); return; }
                    close(); MessageToast.show("Work item created."); that.onOpenBoard(b.sprintId);
                }).catch(function () { btn.disabled = false; btn.textContent = "Create"; showErr("Could not create the work item."); });
            });
        },
        // Sprint reports: burndown + velocity charts + completion breakdown.
        onSprintReport: function () {
            var that = this, b = this._sprintBoard; if (!b) return;
            ppost("getSprintReport", { sprintId: b.sprintId }).then(function (r) {
                if (r && r.error) { MessageToast.show(r.error); return; }
                var m = r.metrics || {};
                var stat = function (l, v, c) { return "<div class='rqStat'><div class='rqStatVal' style='color:" + (c || "#0f172a") + "'>" + v + "</div><div class='rqStatLbl'>" + l + "</div></div>"; };
                var dash = "<div class='rqDash' style='grid-template-columns:repeat(4,1fr)'>" +
                    stat("Progress", (m.progressPct || 0) + "%", "#16a34a") +
                    stat("Story Points", (m.storyPointsDone || 0) + "/" + (m.storyPointsTotal || 0), "#2563eb") +
                    stat("Avg Velocity", r.avgVelocity || 0) +
                    stat("Hours", (m.loggedHours || 0) + "/" + (m.estHours || 0)) +
                    stat("Stories", (m.stories ? m.stories.done + "/" + m.stories.total : "0/0")) +
                    stat("Tasks", (m.tasks ? m.tasks.done + "/" + m.tasks.total : "0/0")) +
                    stat("Bugs", (m.bugs ? m.bugs.done + "/" + m.bugs.total : "0/0"), "#dc2626") +
                    stat("Remaining", (m.storyPointsRemaining || 0) + " pts") +
                    "</div>";
                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>Sprint Report · " + esc(r.name) + "</div>" +
                    "<div class='pmDialogBody'>" + dash +
                    "<div class='spReportGrid'>" +
                    "<div class='spChartBox'><div class='spChartTitle'>Burndown (" + esc(r.unit) + ")</div><div style='position:relative;height:240px'><canvas id='spBurn'></canvas></div></div>" +
                    "<div class='spChartBox'><div class='spChartTitle'>Velocity (Story Points)</div><div style='position:relative;height:240px'><canvas id='spVel'></canvas></div></div>" +
                    "</div></div><div class='pmDialogFoot'><button class='pmBtn primary' id='pmClose'>Close</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { if (that._spCharts) { that._spCharts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); that._spCharts = null; } ov.remove(); };
                ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
                ov.querySelector("#pmClose").addEventListener("click", close);
                var draw = function () {
                    if (!window.Chart) { that._ensureChartLib(); return setTimeout(draw, 250); }
                    if (!document.getElementById("spBurn")) return setTimeout(draw, 60);
                    that._spCharts = [];
                    var bd = r.burndown || [];
                    that._spCharts.push(new window.Chart(document.getElementById("spBurn").getContext("2d"), {
                        type: "line", data: { labels: bd.map(function (p) { return String(p.date).slice(5); }), datasets: [
                            { label: "Ideal", data: bd.map(function (p) { return p.ideal; }), borderColor: "#cbd5e1", borderDash: [6, 4], pointRadius: 0, tension: 0 },
                            { label: "Remaining", data: bd.map(function (p) { return p.remaining; }), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.08)", fill: true, spanGaps: false, tension: .15, pointRadius: 2 }
                        ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { y: { beginAtZero: true } } }
                    }));
                    var vel = r.velocity || [];
                    that._spCharts.push(new window.Chart(document.getElementById("spVel").getContext("2d"), {
                        type: "bar", data: { labels: vel.map(function (v) { return v.name; }), datasets: [
                            { label: "Committed", data: vel.map(function (v) { return v.committed; }), backgroundColor: "#c7d2fe" },
                            { label: "Completed", data: vel.map(function (v) { return v.completed; }), backgroundColor: "#2563eb" }
                        ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { y: { beginAtZero: true } } }
                    }));
                };
                window.requestAnimationFrame(draw);
            }).catch(function () { MessageToast.show("Could not load the report."); });
        },

        // ── Work-item detail: view/edit/status/delete + subtasks/time/comments ──
        onWorkItemDetail: function (taskId) {
            var that = this;
            ppost("getWorkItem", { taskId: taskId }).then(function (w) {
                if (w && w.error) { MessageToast.show(w.error); return; }
                that._renderWorkItemModal(w);
            }).catch(function () { MessageToast.show("Could not load the work item."); });
        },
        _renderWorkItemModal: function (w) {
            var that = this, cm = !!w.canManage, sprintId = this._sprintBoard && this._sprintBoard.sprintId;
            var STATUSES = ["To Do", "In Progress", "In Review", "Testing", "Done", "Blocked"];
            var team = w.team || [];
            var statusOpts = STATUSES.map(function (s) { return "<option" + (this._sameStatus(w.status, s) ? " selected" : "") + ">" + s + "</option>"; }.bind(this)).join("");
            var assigneeOpts = "<option value=''>— Unassigned —</option>" + team.map(function (t) { return "<option value='" + esc(t.employeeId) + "'" + (w.assigneeId === t.employeeId ? " selected" : "") + ">" + esc(t.employeeName) + "</option>"; }).join("");
            var prioOpts = ["Low", "Medium", "High", "Critical"].map(function (p) { return "<option" + (w.priority === p ? " selected" : "") + ">" + p + "</option>"; }).join("");
            var typeOpts = ["Epic", "Story", "Task", "Bug", "Subtask", "Spike"].map(function (t) { return "<option" + (w.type === t ? " selected" : "") + ">" + t + "</option>"; }).join("");
            var parentOpts = "<option value=''>— None —</option>" + (w.parents || []).map(function (p) { return "<option value='" + esc(p.taskId) + "'" + (w.parentTaskId === p.taskId ? " selected" : "") + ">" + that._wiIcon(p.workItemType) + " " + esc(p.taskName) + "</option>"; }).join("");
            var subs = (w.subtasks || []).length ? "<div class='wiSubs'>" + w.subtasks.map(function (s) {
                return "<div class='wiSubRow' onclick=\"window._projCtrl.onWorkItemDetail('" + esc(s.taskId) + "')\">" + that._wiIcon(s.type) + " <span>" + esc(s.title) + "</span> <span class='wiSubMeta'>" + esc(s.status) + " · " + (s.assignee || "—") + "</span></div>";
            }).join("") + "</div>" : "<div class='pmMuted' style='font-size:0.76rem'>No subtasks.</div>";
            var comments = (w.comments || []).length ? w.comments.map(function (c) {
                return "<div class='wiComment'><div class='wiCAuthor'>" + esc(c.authorName || "—") + " <span class='pmMuted'>· " + esc(String(c.at || "").slice(0, 16).replace("T", " ")) + "</span></div><div class='wiCText'>" + esc(c.text) + "</div></div>";
            }).join("") : "<div class='pmMuted' style='font-size:0.76rem'>No comments yet.</div>";
            var ro = cm ? "" : " disabled";
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>" + that._wiIcon(w.type) + " " + esc(w.taskId) + " · " + esc(w.title) + "</div>" +
                "<div class='pmDialogBody wiBody'>" +
                "<div class='wiGrid'>" +
                "<div class='wiMain'>" +
                    "<label class='pmFLbl'>Title</label><input class='pmFInput' id='wiTitle'" + ro + " value='" + esc(w.title) + "'/>" +
                    "<label class='pmFLbl'>Description</label><textarea class='pmFInput' id='wiDesc' rows='3'" + ro + ">" + esc(w.description) + "</textarea>" +
                    "<div class='wiSecTitle'>Subtasks" + (cm && w.type !== "Subtask" ? " <button class='pmLink' onclick=\"window._projCtrl.onAddSubtask('" + esc(w.taskId) + "')\">＋ Add</button>" : "") + "</div>" + subs +
                    "<div class='wiSecTitle'>Comments</div><div class='wiComments'>" + comments + "</div>" +
                    "<div class='wiAddComment'><input class='pmFInput' id='wiComment' placeholder='Add a comment…'/><button class='pmBtn ghost sm' id='wiCommentBtn'>Comment</button></div>" +
                "</div>" +
                "<div class='wiSide'>" +
                    "<label class='pmFLbl'>Status</label><select class='pmFInput' id='wiStatus'>" + statusOpts + "</select>" +
                    "<label class='pmFLbl'>Assignee</label><select class='pmFInput' id='wiAssignee'" + ro + ">" + assigneeOpts + "</select>" +
                    "<div class='pmFRow'><div><label class='pmFLbl'>Type</label><select class='pmFInput' id='wiType'" + ro + ">" + typeOpts + "</select></div>" +
                    "<div><label class='pmFLbl'>Priority</label><select class='pmFInput' id='wiPrio'" + ro + ">" + prioOpts + "</select></div></div>" +
                    "<div class='pmFRow'><div><label class='pmFLbl'>Story Points</label><input type='number' min='0' class='pmFInput' id='wiPts'" + ro + " value='" + (w.storyPoints || 0) + "'/></div>" +
                    "<div><label class='pmFLbl'>Est. Hours</label><input type='number' min='0' class='pmFInput' id='wiEst'" + ro + " value='" + (w.estimatedHours || 0) + "'/></div></div>" +
                    "<div class='wiHours'>⏱ Logged <b>" + w.loggedHours + "h</b> · Remaining <b>" + w.remainingHours + "h</b></div>" +
                    "<div class='wiLog'><input type='number' min='0' step='0.5' class='pmFInput' id='wiLogH' placeholder='Hrs'/><input type='date' class='pmFInput' id='wiLogD'/><button class='pmBtn primary sm' id='wiLogBtn'>Log</button></div>" +
                    "<div class='pmMuted' style='font-size:0.66rem;margin-bottom:6px'>Logged time posts to the assignee's timesheet &amp; project actuals.</div>" +
                    "<label class='pmFLbl'>Parent</label><select class='pmFInput' id='wiParent'" + ro + ">" + parentOpts + "</select>" +
                    "<div class='pmFRow'><div><label class='pmFLbl'>Due Date</label><input type='date' class='pmFInput' id='wiDue'" + ro + " value='" + esc(String(w.dueDate || "").slice(0, 10)) + "'/></div>" +
                    "<div><label class='pmFLbl'>Labels</label><input class='pmFInput' id='wiLabels'" + ro + " value='" + esc(w.labels) + "'/></div></div>" +
                    "<div class='pmMuted' style='font-size:0.7rem;margin-top:6px'>Reporter: " + esc(w.reporterName || "—") + "</div>" +
                "</div></div>" +
                "<div class='pmErr' id='wiErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'>" +
                (cm ? "<button class='pmBtn danger' id='wiDelete' style='margin-right:auto'>Delete</button>" : "") +
                "<button class='pmBtn ghost' id='pmCancel'>Close</button>" +
                (cm ? "<button class='pmBtn primary' id='wiSave'>Save</button>" : "") + "</div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); }; var $ = function (s) { return ov.querySelector(s); };
            var refresh = function () { that.onWorkItemDetail(w.taskId); };
            var reopenBoard = function () { if (sprintId) that.onOpenBoard(sprintId); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);
            // Status change (anyone allowed on their items via moveWorkItem).
            $("#wiStatus").addEventListener("change", function () {
                ppost("moveWorkItem", { taskId: w.taskId, status: this.value }).then(function (res) { if (res && res.error) { MessageToast.show(res.error); return; } MessageToast.show("Status updated."); reopenBoard(); });
            });
            // Log time.
            $("#wiLogBtn").addEventListener("click", function () {
                var h = parseFloat($("#wiLogH").value) || 0; if (h <= 0) { MessageToast.show("Enter hours > 0."); return; }
                ppost("logWorkItemTime", { taskId: w.taskId, hours: h, comment: "", workDate: $("#wiLogD").value || null }).then(function (res) { if (res && res.error) { MessageToast.show(res.error); return; } MessageToast.show("Logged " + h + "h" + (res.timesheetLogged ? " → timesheet" : "") + "."); close(); that.onWorkItemDetail(w.taskId); });
            });
            // Add comment.
            $("#wiCommentBtn").addEventListener("click", function () {
                var txt = ($("#wiComment").value || "").trim(); if (!txt) return;
                ppost("addWorkItemComment", { taskId: w.taskId, text: txt }).then(function (res) { if (res && res.error) { MessageToast.show(res.error); return; } close(); that.onWorkItemDetail(w.taskId); });
            });
            if (cm) {
                $("#wiSave").addEventListener("click", function () {
                    var btn = this; btn.disabled = true; btn.textContent = "Saving…";
                    ppost("updateWorkItem", {
                        taskId: w.taskId, title: ($("#wiTitle").value || "").trim(), description: ($("#wiDesc").value || "").trim(),
                        priority: $("#wiPrio").value, workItemType: $("#wiType").value, storyPoints: parseFloat($("#wiPts").value) || 0,
                        estimatedHours: parseFloat($("#wiEst").value) || 0, labels: ($("#wiLabels").value || "").trim(),
                        dueDate: $("#wiDue").value || null, parentTaskId: $("#wiParent").value || null, assigneeId: $("#wiAssignee").value || null
                    }).then(function (res) {
                        btn.disabled = false; btn.textContent = "Save";
                        if (res && res.error) { var e = $("#wiErr"); e.textContent = "⚠ " + res.error; e.style.display = "block"; return; }
                        MessageToast.show("Saved."); close(); reopenBoard();
                    }).catch(function () { btn.disabled = false; btn.textContent = "Save"; });
                });
                $("#wiDelete").addEventListener("click", function () {
                    if (!window.confirm("Delete this work item? Subtasks are unlinked; comments removed.")) return;
                    ppost("deleteWorkItem", { taskId: w.taskId }).then(function (res) { if (res && res.error) { MessageToast.show(res.error); return; } MessageToast.show("Deleted."); close(); reopenBoard(); });
                });
            }
        },
        _sameStatus: function (a, b) {
            var map = { "not started": "To Do", "to do": "To Do", "in progress": "In Progress", "in review": "In Review", "review": "In Review", "testing": "Testing", "done": "Done", "completed": "Done", "blocked": "Blocked" };
            return map[String(a || "").toLowerCase()] === b;
        },
        onAddSubtask: function (parentTaskId) {
            var that = this, b = this._sprintBoard; if (!b) return;
            var pid = this._detail.project.projectId, team = this._team || [];
            var assigneeOpts = "<option value=''>— Unassigned —</option>" + team.map(function (t) { return "<option value='" + esc(t.employeeId) + "'>" + esc(t.employeeName) + "</option>"; }).join("");
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>New Subtask</div><div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Title <span class='rqReq'>*</span></label><input class='pmFInput' id='stTitle'/>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Assignee</label><select class='pmFInput' id='stAssignee'>" + assigneeOpts + "</select></div>" +
                "<div><label class='pmFLbl'>Est. Hours</label><input type='number' min='0' class='pmFInput' id='stEst'/></div></div>" +
                "<div class='pmErr' id='stErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Create</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); }; var $ = function (s) { return ov.querySelector(s); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            $("#pmCancel").addEventListener("click", close);
            $("#pmSave").addEventListener("click", function () {
                if (!($("#stTitle").value || "").trim()) { var e = $("#stErr"); e.textContent = "⚠ Title is required."; e.style.display = "block"; return; }
                ppost("createProjectTask", { projectId: pid, sprintId: b.sprintId, taskName: ($("#stTitle").value || "").trim(), workItemType: "Subtask", parentTaskId: parentTaskId, assignedToId: $("#stAssignee").value || null, estimatedHours: parseFloat($("#stEst").value) || 0 }).then(function (res) {
                    if (res && res.error) { var e = $("#stErr"); e.textContent = "⚠ " + res.error; e.style.display = "block"; return; }
                    close(); MessageToast.show("Subtask created."); that.onWorkItemDetail(parentTaskId);
                });
            });
        },

        onTaskStatus: function (taskId, status) {
            var that = this, pid = this._detail.project.projectId;
            ppost("updateProjectTaskStatus", { taskId: taskId, status: status }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Task updated."); that._open(pid);
            });
        },
        // Re-scope an existing allocation to a milestone (or back to project-level).
        // Goes through allocateResources so capacity/cost/validation stay authoritative;
        // bandwidth is unchanged and role/phase/module are preserved server-side.
        onResMilestone: function (empId, milestoneId, bandwidth) {
            var that = this, pid = this._detail.project.projectId;
            ppost("allocateResources", { projectId: pid, allocations: [{ employeeId: empId, bandwidth: bandwidth, milestoneId: milestoneId || "" }] }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); that._open(pid); return; }
                if (res && res.warning) { MessageToast.show("Capacity warning — milestone not changed."); that._open(pid); return; }
                MessageToast.show(milestoneId ? "Resource scoped to milestone." : "Resource set to project-level.");
                that._open(pid);
            }).catch(function () { MessageToast.show("Could not update milestone scope."); });
        },

        onRemoveRes: function (empId, empName) {
            var that = this, pid = this._detail.project.projectId;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Deallocate Resource</div>" +
                "<div class='pmDialogBody'><p>Remove <b>" + esc(empName || empId) + "</b> from this project?</p>" +
                "<p class='pmMuted'>Deallocation is blocked if the employee still has open tasks or pending (unapproved) project timesheet entries.</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn danger' id='pmConfirm'>Deallocate</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmConfirm").addEventListener("click", function () {
                this.disabled = true; this.textContent = "Removing…";
                ppost("removeResource", { projectId: pid, employeeId: empId }).then(function (res) {
                    close();
                    if (res && res.error) {
                        if (res.blocked && res.openTasks && res.openTasks.length) {
                            that._showBlocked(res.error, res.openTasks);
                        } else { MessageToast.show(res.error); }
                        return;
                    }
                    MessageToast.show("Resource deallocated."); that._open(pid); that._loadMilestones();
                }).catch(function () { close(); MessageToast.show("Could not deallocate."); });
            });
        },

        // ── Replace an employee on a milestone (release + re-allocate) ──────────
        onReplaceRes: function (oldEmpId, oldEmpName, milestoneId, milestoneName, bandwidth) {
            var that = this, pid = this._detail.project.projectId;
            ppost("getAllocatableEmployees", { projectId: pid }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                var emps = [];
                if (d.departments && d.departments.length) d.departments.forEach(function (g) { (g.employees || []).forEach(function (e) { emps.push(e); }); });
                else if (d.employees) emps = d.employees;
                emps = emps.filter(function (e) { return e.employeeId !== oldEmpId; });
                emps.sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
                if (!emps.length) { MessageToast.show("No alternative employees available to replace with."); return; }
                var empOpts = emps.map(function (e) { return "<option value='" + esc(e.employeeId) + "'>" + esc(e.employeeName) + " · " + esc(e.department || e.specializationName || "") + "</option>"; }).join("");
                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Replace Employee</div>" +
                    "<div class='pmDialogBody'>" +
                    "<p class='pmMuted'>Replacing <b>" + esc(oldEmpName) + "</b> on milestone <b>" + esc(milestoneName || milestoneId) + "</b>. " +
                    "Their past spend is preserved; the incoming employee inherits the same allocation % (" + (bandwidth || 0) + "%) unless overridden.</p>" +
                    "<label class='pmLbl'>Replace With</label><select id='rpEmp' class='pmSelect wide'>" + empOpts + "</select>" +
                    "<label class='pmLbl'>Allocation % <span class='pmMuted'>(blank = keep " + (bandwidth || 0) + "%)</span></label>" +
                    "<input id='rpPct' type='number' min='1' max='100' step='5' class='pmInput' placeholder='" + (bandwidth || 0) + "'/>" +
                    "<label class='pmLbl'>Allocation Type</label>" +
                    "<div class='amTypeRow'><label class='amRadio'><input type='radio' name='rpType' value='Hard' checked/> Hard</label>" +
                    "<label class='amRadio'><input type='radio' name='rpType' value='Soft'/> Soft</label></div>" +
                    "<div id='rpErr' class='pmErr' style='display:none'></div>" +
                    "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Replace</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { ov.remove(); };
                var $ = function (s) { return ov.querySelector(s); };
                ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
                $("#pmCancel").addEventListener("click", close);
                var save = function (force, reason) {
                    var err = $("#rpErr");
                    var payload = {
                        projectId: pid, milestoneId: milestoneId, oldEmployeeId: oldEmpId, newEmployeeId: $("#rpEmp").value,
                        allocationType: (ov.querySelector("input[name='rpType']:checked") || {}).value || "Hard",
                        force: !!force, overrideReason: reason || ""
                    };
                    var pctV = parseFloat($("#rpPct").value);
                    if (pctV > 0) payload.allocationPct = pctV;
                    var btn = $("#pmSave"); btn.disabled = true; btn.textContent = "Replacing…";
                    ppost("replaceResourceOnMilestone", payload).then(function (res) {
                        btn.disabled = false; btn.textContent = "Replace";
                        if (res && (res.overallocation || res.budgetOverrun)) {
                            var r = window.prompt(res.error + "\n\nEnter an override reason to proceed (or Cancel):", "");
                            if (r) save(true, r);
                            return;
                        }
                        if (res && res.error) { err.style.display = "block"; err.textContent = res.error; return; }
                        close();
                        MessageToast.show("Replaced " + (res.outgoingEmployee || oldEmpName) + (res.spentPreserved ? " · ₹" + Number(res.spentPreserved).toLocaleString("en-IN") + " spend preserved" : ""));
                        that._open(pid); that._loadMilestones();
                    }).catch(function () { btn.disabled = false; btn.textContent = "Replace"; err.style.display = "block"; err.textContent = "Could not replace — please try again."; });
                };
                $("#pmSave").addEventListener("click", function () { save(false, ""); });
            }).catch(function () { MessageToast.show("Could not load employees."); });
        },

        // Show the deallocation-blocked reason + the open tasks to reassign/close.
        _showBlocked: function (msg, openTasks) {
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            var rows = (openTasks || []).map(function (t) {
                return "<tr><td><b>" + esc(t.taskName) + "</b></td><td>" + esc(t.status) + "</td></tr>";
            }).join("");
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Cannot Deallocate</div>" +
                "<div class='pmDialogBody'><p>" + esc(msg) + "</p>" +
                (rows ? "<table class='pmTable'><thead><tr><th>Open Task</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table>" : "") +
                "</div><div class='pmDialogFoot'><button class='pmBtn primary' id='pmOk'>OK</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmOk").addEventListener("click", close);
        },

        // POC task assignment — Individual or Group (one ProjectTask per assignee),
        // assignee list is restricted to allocated resources.
        onAssignTask: function () {
            var that = this, d = this._detail, pid = d.project.projectId;
            var resources = (d.resources || []).slice().sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
            if (!resources.length) { MessageToast.show("Allocate at least one resource before assigning tasks."); return; }
            var today = new Date().toISOString().slice(0, 10);
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            // Show each assignee's current utilization so managers don't pile work
            // onto overallocated staff (capacity comes from the central engine).
            var utilTag = function (r) {
                var u = r.utilizationPct || 0;
                return u + "%" + (u > 100 ? " ⚠" : "");
            };
            var assigneeOpts = resources.map(function (r) { return "<option value='" + esc(r.employeeId) + "'>" + esc(r.employeeName) + " (" + esc(r.department) + ") · " + utilTag(r) + "</option>"; }).join("");
            var assigneeChecks = resources.map(function (r) {
                var u = r.utilizationPct || 0;
                var col = u > 100 ? "#dc2626" : u >= 90 ? "#a16207" : "#16a34a";
                return "<label class='pmCheckRow'><input type='checkbox' class='pmAsgChk' data-emp='" + esc(r.employeeId) + "'/> " + esc(r.employeeName) +
                    " <span class='pmMuted'>(" + esc(r.department) + ")</span> <b style='color:" + col + "'>" + utilTag(r) + "</b></label>";
            }).join("");
            var prioOpts = PRIORITIES.map(function (p) { return "<option" + (p === "Medium" ? " selected" : "") + ">" + p + "</option>"; }).join("");
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Assign Task</div>" +
                "<div class='pmDialogBody'>" +
                "<div class='pmTypeToggle'><label><input type='radio' name='pmTaskType' value='individual' checked/> Individual</label>" +
                "<label><input type='radio' name='pmTaskType' value='group'/> Group</label></div>" +
                "<label class='pmFLbl'>Task Name</label><input type='text' class='pmFInput' id='tkName' placeholder='e.g. Build login API'/>" +
                "<label class='pmFLbl'>Description</label><textarea class='pmFInput' id='tkDesc' rows='2'></textarea>" +
                "<div id='tkIndWrap'><label class='pmFLbl'>Assignee</label>" +
                "<select class='pmFInput' id='tkAssignee' size='1'>" + assigneeOpts + "</select></div>" +
                "<div id='tkGrpWrap' style='display:none'><label class='pmFLbl'>Assignees (Group)</label>" +
                "<div class='pmCheckList'>" + assigneeChecks + "</div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Priority</label><select class='pmFInput' id='tkPrio'>" + prioOpts + "</select></div>" +
                "<div><label class='pmFLbl'>Estimated Hours</label><input type='number' min='1' step='1' class='pmFInput' id='tkEst' value='8'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Start Date</label><input type='date' class='pmFInput' id='tkStart' value='" + today + "'/></div>" +
                "<div><label class='pmFLbl'>Due Date</label><input type='date' class='pmFInput' id='tkDue'/></div></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Assign</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            // Toggle Individual / Group sections.
            ov.querySelectorAll("input[name='pmTaskType']").forEach(function (rb) {
                rb.addEventListener("change", function () {
                    var grp = ov.querySelector("input[name='pmTaskType']:checked").value === "group";
                    ov.querySelector("#tkIndWrap").style.display = grp ? "none" : "";
                    ov.querySelector("#tkGrpWrap").style.display = grp ? "" : "none";
                });
            });
            var sel = ov.querySelector("#tkAssignee");
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                var name = (ov.querySelector("#tkName").value || "").trim();
                if (!name) { MessageToast.show("Task Name is required."); return; }
                var est = parseInt(ov.querySelector("#tkEst").value, 10) || 0;
                if (est <= 0) { MessageToast.show("Estimated Hours must be greater than 0."); return; }
                var isGroup = ov.querySelector("input[name='pmTaskType']:checked").value === "group";
                var assignees = [];
                if (isGroup) {
                    ov.querySelectorAll(".pmAsgChk").forEach(function (chk) { if (chk.checked) assignees.push(chk.getAttribute("data-emp")); });
                    if (!assignees.length) { MessageToast.show("Select at least one assignee for a group task."); return; }
                } else {
                    assignees.push(sel.value);
                }
                // Warn before assigning to an overallocated employee (>100% utilization).
                var resById = {}; resources.forEach(function (r) { resById[r.employeeId] = r; });
                var over = assignees.filter(function (id) { return resById[id] && resById[id].utilizationPct > 100; })
                    .map(function (id) { return resById[id].employeeName + " (" + resById[id].utilizationPct + "%)"; });
                if (over.length && !window.confirm("The following assignee(s) are already overallocated:\n\n" + over.join("\n") + "\n\nAssign anyway?")) { return; }
                var base = {
                    projectId: pid, taskName: name, description: (ov.querySelector("#tkDesc").value || "").trim(),
                    priority: ov.querySelector("#tkPrio").value, estimatedHours: est,
                    startDate: ov.querySelector("#tkStart").value || null, dueDate: ov.querySelector("#tkDue").value || null
                };
                btn.disabled = true; btn.textContent = "Assigning…";
                Promise.all(assignees.map(function (empId) {
                    return ppost("createProjectTask", Object.assign({}, base, { assignedToId: empId }));
                })).then(function (results) {
                    close();
                    var failed = results.filter(function (r) { return r && r.error; });
                    if (failed.length) { MessageToast.show(failed[0].error); }
                    else { MessageToast.show(assignees.length > 1 ? "Group task assigned to " + assignees.length + " members." : "Task assigned."); }
                    that._open(pid);
                }).catch(function () { close(); MessageToast.show("Could not assign the task."); });
            });
        },

        // Expand/collapse a hierarchical section in the Manage Resources grid.
        _toggleSec: function (id, hdr) {
            var el = document.getElementById(id);
            if (!el) return;
            var collapsed = el.style.display === "none";
            el.style.display = collapsed ? "" : "none";
            if (hdr) hdr.innerHTML = hdr.innerHTML.replace(collapsed ? "▸" : "▾", collapsed ? "▾" : "▸");
        },

        // POC resource allocation — light-themed DOM overlay.
        // ── Resource Planning v2 — allocate by milestone + estimated hours ───────
        onAllocateByMilestone: function () {
            var that = this, pid = this._detail.project.projectId;
            var msList = (this._milestones && this._milestones.milestones && this._milestones.milestones.length ? this._milestones.milestones : (this._detail.milestones || []));
            if (!msList.length) { MessageToast.show("Add project milestones first — resources are allocated against a milestone."); this.onTab("milestones"); return; }
            // ── Planning-first gate: Resource Requirements must exist before staffing.
            ppost("getResourceRequirements", { projectId: pid }).then(function (rq) {
                var reqs = (rq && (rq.requirements || rq.grouped || rq)) || [];
                var hasReq = Array.isArray(rq && rq.requirements) ? rq.requirements.length > 0 : (Array.isArray(reqs) ? reqs.length > 0 : false);
                if (!hasReq) {
                    MessageToast.show("Define at least one Resource Requirement before allocating employees. Planning must precede staffing.");
                    that.onTab("requirements");
                    return;
                }
                that._openAllocationScreen(pid, msList, (msList[0] && msList[0].milestoneId));
            }).catch(function () { that._openAllocationScreen(pid, msList, (msList[0] && msList[0].milestoneId)); });
        },

        // ── Integrated Milestone Allocation screen (single page — no popup) ─────────
        _allocFilters: null,
        _openAllocationScreen: function (pid, msList, milestoneId) {
            this._allocPid = pid; this._allocMsList = msList || [];
            this._allocMsId = milestoneId || (msList[0] && msList[0].milestoneId);
            this._allocFilters = { q: "", role: "", dept: "", status: "", overOnly: false, assignedOnly: false };
            this._allocPage = 1; this._allocRpp = 10;
            var ov = document.createElement("div"); ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog alFull'><div id='alRoot'><div class='pmLoading'>Loading allocation screen…</div></div></div>";
            document.body.appendChild(ov);
            ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
            this._allocOverlay = ov;
            this._loadAllocScreen();
        },
        _loadAllocScreen: function () {
            var that = this;
            ppost("getMilestoneAllocationScreen", { milestoneId: this._allocMsId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                that._allocData = d; that._renderAllocScreen();
            }).catch(function () { MessageToast.show("Could not load the allocation screen."); });
        },
        onAllocMilestone: function (msId) { this._allocMsId = msId; this._loadAllocScreen(); },
        onAllocFilter: function () {
            var ov = this._allocOverlay; if (!ov) return;
            this._allocFilters = {
                q: (ov.querySelector("#alSearch") || {}).value || "",
                role: (ov.querySelector("#alRole") || {}).value || "",
                dept: (ov.querySelector("#alDept") || {}).value || "",
                status: (ov.querySelector("#alStatus") || {}).value || "",
                overOnly: (ov.querySelector("#alOverOnly") || {}).checked || false,
                assignedOnly: (ov.querySelector("#alAssignedOnly") || {}).checked || false
            };
            this._allocPage = 1;
            this._applyAllocFilters();
        },
        onAllocPage: function (p) { this._allocPage = p; this._applyAllocFilters(); },
        onAllocRowsPerPage: function (n) { this._allocRpp = parseInt(n, 10) || 10; this._allocPage = 1; this._applyAllocFilters(); },
        _applyAllocFilters: function () {
            var ov = this._allocOverlay, f = this._allocFilters || {}; if (!ov) return;
            var q = (f.q || "").toLowerCase();
            var matched = [];
            ov.querySelectorAll(".alRow").forEach(function (tr) {
                var show = true;
                if (q && (tr.getAttribute("data-name") || "").toLowerCase().indexOf(q) === -1) show = false;
                if (f.role && tr.getAttribute("data-role") !== f.role) show = false;
                if (f.dept && tr.getAttribute("data-dept") !== f.dept) show = false;
                if (f.status && tr.getAttribute("data-status") !== f.status) show = false;
                if (f.overOnly && tr.getAttribute("data-over") !== "1") show = false;
                if (f.assignedOnly && tr.getAttribute("data-assigned") !== "1") show = false;
                if (show) matched.push(tr); else tr.style.display = "none";
            });
            // Pagination over the matched set
            var rpp = this._allocRpp || 10, total = matched.length;
            var pages = Math.max(1, Math.ceil(total / rpp));
            if (this._allocPage > pages) this._allocPage = pages;
            var pg = this._allocPage, start = (pg - 1) * rpp, end = start + rpp;
            matched.forEach(function (tr, i) { tr.style.display = (i >= start && i < end) ? "" : "none"; });
            // Footer
            var foot = ov.querySelector("#alFoot");
            if (foot) {
                var shownFrom = total ? start + 1 : 0, shownTo = Math.min(end, total);
                var btns = "";
                for (var i = 1; i <= pages; i++) btns += "<button class='alPgBtn" + (i === pg ? " on" : "") + "' onclick='window._projCtrl.onAllocPage(" + i + ")'>" + i + "</button>";
                foot.innerHTML =
                    "<div class='alFootInfo'>Showing " + shownFrom + " to " + shownTo + " of " + total + " employees</div>" +
                    "<div class='alPager'>" +
                        "<button class='alPgNav' " + (pg <= 1 ? "disabled" : "onclick='window._projCtrl.onAllocPage(" + (pg - 1) + ")'") + ">‹</button>" +
                        btns +
                        "<button class='alPgNav' " + (pg >= pages ? "disabled" : "onclick='window._projCtrl.onAllocPage(" + (pg + 1) + ")'") + ">›</button>" +
                    "</div>" +
                    "<div class='alRpp'>Rows per page <select onchange='window._projCtrl.onAllocRowsPerPage(this.value)'>" +
                        [10, 20, 50].map(function (n) { return "<option" + (n === rpp ? " selected" : "") + ">" + n + "</option>"; }).join("") +
                    "</select></div>";
            }
        },
        _renderAllocScreen: function () {
            var d = this._allocData, that = this, ov = this._allocOverlay; if (!ov) return;
            var m = d.milestone || {}, sm = d.summary || {}, rows = d.rows || [], cm = !!d.canManage;
            var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
            var msOpts = (this._allocMsList || []).map(function (x) { return "<option value='" + esc(x.milestoneId) + "'" + (x.milestoneId === m.milestoneId ? " selected" : "") + ">#" + (x.sequence || 0) + " " + esc(x.name) + "</option>"; }).join("");
            var roles = [...new Set(rows.map(function (r) { return r.role; }).filter(Boolean))].sort();
            var depts = [...new Set(rows.map(function (r) { return r.department; }).filter(Boolean))].sort();
            var statuses = ["Fully Allocated", "Partially Allocated", "Available", "Overallocated", "Assigned Elsewhere"];
            var stColor = { "Fully Allocated": "#16a34a", "Partially Allocated": "#d97706", "Available": "#64748b", "Overallocated": "#dc2626", "Assigned Elsewhere": "#7c3aed" };
            var avatar = function (name) { var p = String(name || "").trim().split(/\s+/); var ini = ((p[0] || "")[0] || "") + ((p[1] || "")[0] || ""); return "<span class='alAvatar'>" + esc(ini.toUpperCase()) + "</span>"; };

            var AVCOLORS = ["#4f46e5", "#7c3aed", "#0ea5e9", "#0891b2", "#059669", "#d97706", "#db2777", "#dc2626"];
            var avColor = function (name) { var s = String(name || ""); var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVCOLORS[h % AVCOLORS.length]; };

            var head = "<div class='alHeader'>" +
                "<div class='alHTitle'>Allocate Resources <span class='alHSub'>· project-hours based</span></div>" +
                "<button class='alClose' onclick=\"window._projCtrl.onCloseAllocScreen()\">✕ Close</button></div>" +
                "<div class='alMsBar'><label class='alMsLbl'>Milestone</label>" +
                "<select class='alMsSelect' onchange=\"window._projCtrl.onAllocMilestone(this.value)\">" + msOpts + "</select>" +
                "<span class='alMsChip' style='--c:" + (stColor[m.status] || "#16a34a") + "'>" + esc(m.status || "") + "</span>" +
                "<span class='alMsDates'><svg class='alMsIc' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/></svg> " + esc(String(m.plannedStartDate || "—").slice(0, 10)) + " → " + esc(String(m.plannedEndDate || "—").slice(0, 10)) + "</span>" +
                "<span class='alMsProg'>Progress " + (m.progressPct || 0) + "% <span class='alRing' style='--p:" + (m.progressPct || 0) + "'></span></span>" +
                "<span class='alMsDays'>" + (m.remainingDays || 0) + "d left</span></div>";

            var ICN = {
                users: "<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>",
                userCheck: "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><polyline points='17 11 19 13 23 9'/>",
                clock: "<circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/>",
                check: "<path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/><polyline points='22 4 12 14.01 9 11.01'/>",
                chart: "<polyline points='23 6 13.5 15.5 8.5 10.5 1 18'/><polyline points='17 6 23 6 23 12'/>",
                rupee: "<path d='M7 4h10M7 8h10M6 12h5a4 4 0 0 0 0-8M6 12l7 8'/>",
                alert: "<path d='M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/>",
                calendar: "<rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/>",
                search: "<circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/>"
            };
            var svg = function (name) { return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (ICN[name] || "") + "</svg>"; };
            var cardDefs = [
                { v: (sm.totalEmployees || 0), l: "Employees", ic: "users", c: "#4f46e5", bg: "#eef2ff" },
                { v: (sm.assigned || 0), l: "Assigned", ic: "userCheck", c: "#059669", bg: "#ecfdf5", id: "alcAssigned" },
                { v: (sm.allocatedHours || 0) + " h", l: "Allocated Hrs", ic: "clock", c: "#2563eb", bg: "#eff6ff", id: "alcAllocH" },
                { v: (sm.actualHours || 0) + " h", l: "Actual Hrs", ic: "check", c: "#059669", bg: "#ecfdf5", vc: "#16a34a" },
                { v: (sm.forecastHours || 0) + " h", l: "Forecast Hrs", ic: "chart", c: "#2563eb", bg: "#eff6ff", vc: "#2563eb", id: "alcForeH" },
                { v: inr(sm.actualCost), l: "Actual Cost", ic: "rupee", c: "#059669", bg: "#ecfdf5", vc: "#16a34a" },
                { v: inr(sm.forecastCost), l: "Forecast Cost", ic: "rupee", c: "#2563eb", bg: "#eff6ff", vc: "#2563eb", id: "alcForeC" },
                { v: (sm.overallocated || 0), l: "Overallocated", ic: "alert", c: "#ea580c", bg: "#fff7ed", vc: (sm.overallocated > 0 ? "#dc2626" : "#16a34a"), id: "alcOver" }
            ];
            var cards = "<div class='alCards'>" + cardDefs.map(function (c) {
                return "<div class='alCard'><span class='alCardIc' style='background:" + c.bg + ";color:" + c.c + "'>" + svg(c.ic) + "</span>" +
                    "<div class='alCardBody'><div class='alCardVal'" + (c.id ? " id='" + c.id + "'" : "") + (c.vc ? " style='color:" + c.vc + "'" : "") + ">" + c.v + "</div>" +
                    "<div class='alCardLbl'>" + c.l + "</div></div></div>";
            }).join("") + "</div>";

            var filters = "<div class='alFilters'>" +
                "<div class='alSearchWrap'><span class='alSearchIc'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg></span><input id='alSearch' class='alSearchInp' placeholder='Search employee' oninput='window._projCtrl.onAllocFilter()'/></div>" +
                "<select id='alRole' class='alFSelect' onchange='window._projCtrl.onAllocFilter()'><option value=''>All Roles</option>" + roles.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select>" +
                "<select id='alDept' class='alFSelect' onchange='window._projCtrl.onAllocFilter()'><option value=''>All Departments</option>" + depts.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select>" +
                "<select id='alStatus' class='alFSelect' onchange='window._projCtrl.onAllocFilter()'><option value=''>All Statuses</option>" + statuses.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select>" +
                "<span class='alFSpacer'></span>" +
                "<label class='alToggle'><input type='checkbox' id='alOverOnly' onchange='window._projCtrl.onAllocFilter()'/> Overallocated only</label>" +
                "<label class='alToggle'><input type='checkbox' id='alAssignedOnly' onchange='window._projCtrl.onAllocFilter()'/> Assigned only</label>" +
                "</div>";

            var colHead = "<div class='alColHead'>" +
                "<div>EMPLOYEE</div><div>PROJECT ALLOCATION <span class='alInfo'>ⓘ</span></div>" +
                "<div>MILESTONE ALLOCATION <span class='alInfo'>ⓘ</span></div><div>COST <span class='alInfo'>ⓘ</span></div>" +
                "<div>STATUS</div><div>ACTIONS</div></div>";

            // ── Each employee is a CARD row (grid: emp | project | milestone | cost | status | actions) ──
            var tri = function (label, val, cls, vcls) { return "<div class='alTri " + (cls || "") + "'><span class='alTriLbl'>" + label + "</span><span class='alTriVal " + (vcls || "") + "'>" + val + "</span></div>"; };
            var trs = rows.map(function (r) {
                var sc = stColor[r.status] || "#64748b";
                var skills = r.skills ? "<div class='alSkills'>" + r.skills.split(",").slice(0, 3).map(function (s) { return s.trim() ? "<span class='alSkill'>" + esc(s.trim()) + "</span>" : ""; }).join("") + "</div>" : "";
                var p = String(r.employeeName || "").trim().split(/\s+/); var ini = (((p[0] || "")[0] || "") + ((p[1] || "")[0] || "")).toUpperCase();
                var pct = r.milestonePercent || 0;
                var projH = r.projectHours || 0, usedH = (r.otherMilestoneHours || 0) + (r.milestoneHours || 0);
                var barPct = projH > 0 ? Math.min(100, Math.round(usedH / projH * 100)) : 0;
                var availPct = Math.max(0, 100 - barPct);
                var pctInput = cm
                    ? "<div class='alPctWrap'><input type='number' min='0' max='100' step='5' class='alPct' data-emp='" + esc(r.employeeId) + "' value='" + pct + "'/><span class='alPctSign'>%</span></div>"
                    : "<span class='alTriVal'>" + pct + "%</span>";
                var slider = cm ? "<input type='range' min='0' max='100' step='5' class='alSlider' value='" + pct + "'/>" : "";
                var kebab = cm && r.allocated
                    ? "<div class='alKebabWrap'><button class='alKebab' onclick='window._projCtrl.onAllocKebab(event,\"" + esc(r.employeeId) + "\")'>⋮</button>" +
                        "<div class='alKebabMenu'>" +
                        "<button onclick=\"window._projCtrl.onAdjustMilestoneResource('" + esc(m.milestoneId) + "','" + esc(r.employeeId) + "')\">✏️ Edit / dates</button>" +
                        "<button class='danger' onclick=\"window._projCtrl.onRemoveRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "')\">🗑️ Remove</button>" +
                        "</div></div>"
                    : "";
                var actions = cm ? "<button class='alApply' data-emp='" + esc(r.employeeId) + "'>Apply</button>" + kebab : "";
                return "<div class='alRow alCard2' data-emp='" + esc(r.employeeId) + "' data-name='" + esc(r.employeeName) + "' data-role='" + esc(r.role) + "' data-dept='" + esc(r.department) + "' data-status='" + esc(r.status) + "' data-over='" + (r.overallocated ? 1 : 0) + "' data-assigned='" + (r.allocated ? 1 : 0) + "' " +
                    "data-projh='" + projH + "' data-otherh='" + (r.otherMilestoneHours || 0) + "' data-spenth='" + r.actualSpentHours + "' data-rate='" + r.hourlyCost + "'>" +
                    // EMPLOYEE
                    "<div class='alcEmp'><span class='alAvatar' style='background:" + avColor(r.employeeName) + "'>" + esc(ini) + "</span>" +
                        "<div class='alEmpMeta'><b class='alEmpName'>" + esc(r.employeeName) + "</b>" +
                        "<div class='alEmpRole'>" + esc(r.department) + " · " + esc(r.role) + "</div>" + skills + "</div></div>" +
                    // PROJECT ALLOCATION
                    "<div class='alcGroup'><div class='alTriRow'>" +
                        tri("Project Hrs", (projH) + " h") +
                        tri("Other MS", Math.round(r.otherMilestoneHours) + " h") +
                        tri("Remaining", "<span class='alRemain'>" + Math.round(r.remainingProjectHours) + " h</span>") + "</div>" +
                        "<div class='alBar'><div class='alBarFill' style='width:" + barPct + "%'></div></div>" +
                        "<div class='alBarNote " + (availPct > 0 ? "pos" : "neg") + "'>" + availPct + "% available</div></div>" +
                    // MILESTONE ALLOCATION
                    "<div class='alcGroup'><div class='alTriRow'>" +
                        "<div class='alTri'><span class='alTriLbl'>% Allocation</span>" + pctInput + "</div>" +
                        tri("MS Hrs", "<span class='alMh'>" + Math.round(r.milestoneHours) + " h</span>") +
                        tri("Spent", Math.round(r.actualSpentHours) + " h", "", "green") +
                        tri("Forecast", "<span class='alFh'>" + Math.round(r.forecastRemainingHours) + " h</span>", "", "blue") + "</div>" +
                        slider + "</div>" +
                    // COST
                    "<div class='alcGroup'><div class='alMini'><span class='alTriLbl'>Rate</span><span class='alTriVal'>" + inr(r.hourlyCost) + " /hr</span></div>" +
                        "<div class='alTriRow'>" +
                        tri("Actual Cost", inr(r.actualCost), "", "green") +
                        tri("Forecast Cost", "<span class='alFc'>" + inr(r.forecastCost) + "</span>", "", "blue") + "</div></div>" +
                    // STATUS
                    "<div class='alcStatus'><span class='alStatus' style='--c:" + sc + "'>" + esc(r.status) + "</span></div>" +
                    // ACTIONS
                    "<div class='alcActions'>" + actions + "</div>" +
                    "</div>";
            }).join("");

            var table = "<div class='alCardList'>" + colHead + (trs || "<div class='pmMuted' style='padding:28px;text-align:center'>No employees match this project's requirements yet.</div>") + "</div>";
            var footer = "<div id='alFoot' class='alFooter'></div>";

            ov.querySelector("#alRoot").innerHTML = head + cards + "<div id='alWarn'></div>" + filters + table + footer;
            this._wireAllocScreen();
            this._applyAllocFilters();
        },
        onAllocKebab: function (ev, empId) {
            ev.stopPropagation();
            var ov = this._allocOverlay; if (!ov) return;
            var wrap = ev.target.closest(".alKebabWrap"); var open = wrap.classList.contains("open");
            ov.querySelectorAll(".alKebabWrap.open").forEach(function (w) { w.classList.remove("open"); });
            if (!open) {
                wrap.classList.add("open");
                var close = function () { wrap.classList.remove("open"); document.removeEventListener("click", close); };
                setTimeout(function () { document.addEventListener("click", close); }, 0);
            }
        },
        _wireAllocScreen: function () {
            var that = this, ov = this._allocOverlay; if (!ov) return;
            var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
            // Live recalc on % change (no save).
            var recalcRow = function (tr, pct) {
                var projH = parseFloat(tr.getAttribute("data-projh")) || 0, otherH = parseFloat(tr.getAttribute("data-otherh")) || 0;
                var spentH = parseFloat(tr.getAttribute("data-spenth")) || 0, rate = parseFloat(tr.getAttribute("data-rate")) || 0;
                pct = Math.max(0, Math.min(100, pct || 0));
                var mh = Math.round(projH * (pct / 100) * 100) / 100;
                var fh = Math.max(0, Math.round((mh - spentH) * 100) / 100);
                var rem = Math.round((projH - (otherH + mh)) * 100) / 100;
                var used = otherH + mh, barPct = projH > 0 ? Math.min(100, Math.round(used / projH * 100)) : 0, avail = Math.max(0, 100 - barPct);
                tr.querySelector(".alMh").textContent = Math.round(mh) + " h";
                tr.querySelector(".alFh").textContent = Math.round(fh) + " h";
                tr.querySelector(".alFc").textContent = inr(fh * rate);
                var remCell = tr.querySelector(".alRemain"); remCell.textContent = Math.round(rem) + " h"; remCell.style.color = rem < 0 ? "#dc2626" : "";
                var fill = tr.querySelector(".alBarFill"); if (fill) { fill.style.width = barPct + "%"; fill.classList.toggle("over", used > projH); }
                var note = tr.querySelector(".alBarNote"); if (note) { note.textContent = avail + "% available"; note.className = "alBarNote " + (avail > 0 ? "pos" : "neg"); }
                tr.setAttribute("data-over", (projH > 0 && used > projH) ? 1 : 0);
                that._recalcAllocWarn();
            };
            ov.querySelectorAll(".alPct").forEach(function (inp) {
                inp.addEventListener("input", function () {
                    var tr = inp.closest(".alRow"); var sl = tr.querySelector(".alSlider"); if (sl) sl.value = inp.value;
                    recalcRow(tr, parseFloat(inp.value) || 0);
                });
            });
            ov.querySelectorAll(".alSlider").forEach(function (sl) {
                sl.addEventListener("input", function () {
                    var tr = sl.closest(".alRow"); var inp = tr.querySelector(".alPct"); if (inp) inp.value = sl.value;
                    recalcRow(tr, parseFloat(sl.value) || 0);
                });
            });
            ov.querySelectorAll(".alApply").forEach(function (btn) {
                btn.addEventListener("click", function () { that._applyAllocRow(btn.getAttribute("data-emp")); });
            });
            this._recalcAllocWarn();
        },
        _recalcAllocWarn: function () {
            var ov = this._allocOverlay; if (!ov) return;
            var over = [];
            ov.querySelectorAll(".alRow").forEach(function (tr) {
                if (tr.getAttribute("data-over") === "1") {
                    var projH = parseFloat(tr.getAttribute("data-projh")) || 0, otherH = parseFloat(tr.getAttribute("data-otherh")) || 0;
                    var pct = parseFloat((tr.querySelector(".alPct") || {}).value) || 0;
                    var mh = projH * (pct / 100);
                    over.push({ name: tr.getAttribute("data-name"), by: Math.round((otherH + mh) - projH) });
                }
            });
            var el = ov.querySelector("#alWarn");
            if (over.length) {
                el.innerHTML = "<div class='alWarnBanner'>⚠ <b>" + over.length + " employee(s) exceed their approved project allocation.</b> " +
                    over.slice(0, 3).map(function (o) { return esc(o.name) + " (+" + o.by + "h)"; }).join(", ") +
                    ". Allocation is allowed — review resource planning (increase project allocation, add a resource, or move work to another milestone).</div>";
            } else el.innerHTML = "";
            var oc = ov.querySelector("#alcOver"); if (oc) { oc.textContent = over.length; oc.style.color = over.length ? "#dc2626" : "#16a34a"; }
        },
        _applyAllocRow: function (empId) {
            var that = this, ov = this._allocOverlay; if (!ov) return;
            var tr = ov.querySelector(".alRow[data-emp='" + empId + "']"); if (!tr) return;
            var projH = parseFloat(tr.getAttribute("data-projh")) || 0;
            var pct = Math.max(0, Math.min(100, parseFloat((tr.querySelector(".alPct") || {}).value) || 0));
            if (pct <= 0) { MessageToast.show("Enter an allocation % greater than 0."); return; }
            var hrs = Math.round(projH * (pct / 100) * 100) / 100;
            var btn = tr.querySelector(".alApply"); if (btn) { btn.disabled = true; btn.textContent = "…"; }
            ppost("allocateResourceToMilestone", {
                projectId: this._allocPid, employeeId: empId, milestoneId: this._allocMsId, allocationType: "Hard",
                estimatedHours: hrs, projectAllocationHours: projH, milestoneAllocationPercent: pct,
                force: true, overrideReason: "Integrated allocation screen"   // over-allocation warns, never blocks
            }).then(function (res) {
                if (btn) { btn.disabled = false; btn.textContent = "Apply"; }
                if (res && res.error && !res.overallocation && !res.budgetOverrun) { MessageToast.show(res.error); return; }
                MessageToast.show(pct + "% applied to " + (tr.getAttribute("data-name") || "employee") + ".");
                that._loadAllocScreen();                 // refresh grid + summary
                that._open(that._allocPid); that._loadMilestones();   // sync project/milestone/requirements
            }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = "Apply"; } MessageToast.show("Could not apply."); });
        },
        onCloseAllocScreen: function () { if (this._allocOverlay) { this._allocOverlay.remove(); this._allocOverlay = null; } },

        // preMsId (optional): when supplied the milestone is FIXED — the screen is
        // scoped to that milestone (shown as a header, no dropdown). Reuses the
        // existing allocation engine (allocateResourceToMilestone) unchanged.
        // Grouped, collapsible, multi-select milestone allocation. Reuses the existing
        // allocateResourceToMilestone engine (one call per selected employee) — no new
        // cost/availability logic. Estimated Hours from the project's requirements are
        // the planning baseline the PM distributes across selected employees.
        _openMilestoneAllocationModal: function (pid, msList, preMsId) {
            var that = this;
            Promise.all([
                ppost("getAllocatableEmployees", { projectId: pid }),
                ppost("getResourceRequirements", { projectId: pid })
            ]).then(function (arr) {
                var d = arr[0] || {}, rq = arr[1] || {};
                if (d && d.error) { MessageToast.show(d.error); return; }
                // Department groups (preserve server grouping + recommendation order).
                var groups = (d.departments && d.departments.length)
                    ? d.departments.map(function (g) { return { department: g.department, employees: (g.employees || []).slice() }; })
                    : [];
                var allEmps = [];
                groups.forEach(function (g) { g.employees.forEach(function (e) { allEmps.push(e); }); });
                if (!allEmps.length) { MessageToast.show("No allocatable employees found."); return; }
                var empById = {}; allEmps.forEach(function (e) { empById[e.employeeId] = e; });
                var projMonths = Number(d.projectMonths) || 0;
                var monthSpan = function (s, e) {
                    if (!s || !e) return projMonths || 1;
                    var a = new Date(s), b = new Date(e);
                    if (isNaN(a) || isNaN(b)) return projMonths || 1;
                    return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
                };
                var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };

                // ── Requirement-driven baseline ──────────────────────────────────────
                // Each employee's allocated hours derive from THEIR matching Resource
                // Requirement's per-employee estimated hours × allocation %. Match by role
                // category first, then department, else the average requirement hours.
                var reqs = (rq && rq.requirements) || [];
                var perEmpHoursOf = function (r) { return Number(r.estimatedHours != null ? r.estimatedHours : r.requiredHours) || 0; };
                var reqByRole = {}, reqByDept = {};
                reqs.forEach(function (r) {
                    if (r.roleCategoryId && !reqByRole[r.roleCategoryId]) reqByRole[r.roleCategoryId] = r;
                    var dk = String(r.departmentName || "").toLowerCase(); if (dk && !reqByDept[dk]) reqByDept[dk] = r;
                });
                var avgReqHours = reqs.length ? Math.round(reqs.reduce(function (s, r) { return s + perEmpHoursOf(r); }, 0) / reqs.length) : 0;
                var matchReqFor = function (e) {
                    return (e.roleCategoryId && reqByRole[e.roleCategoryId]) || reqByDept[String(e.department || "").toLowerCase()] || null;
                };
                var baselineFor = function (e) { var r = matchReqFor(e); return r ? perEmpHoursOf(r) : avgReqHours; };
                var roleLabelFor = function (e) { var r = matchReqFor(e); return (r && r.roleCategoryName) || e.roleCategoryName || e.designation || "—"; };
                // Project baseline = Σ (quantity × per-employee hours) across requirements.
                var projectBaselineHours = reqs.reduce(function (s, r) { return s + ((Number(r.requiredCount) || 0) * perEmpHoursOf(r)); }, 0);

                // Fixed milestone (from Step 1) or a dropdown fallback.
                var winOf = function (m) { return (m.plannedStartDate || m.startDate || "—") + " → " + (m.plannedEndDate || m.endDate || "—"); };
                var preMs = preMsId ? msList.filter(function (m) { return m.milestoneId === preMsId; })[0] : (msList[0] || null);
                var msStart = preMs ? (preMs.plannedStartDate || preMs.startDate || "") : "";
                var msEnd = preMs ? (preMs.plannedEndDate || preMs.endDate || "") : "";

                var matchHint = "";
                if (d.showingAll && d.requirementDefined) {
                    matchHint = "<div class='pmInfoBox' style='margin:0 0 10px'><span class='pmInfoIco'>&#9432;</span><div>No employees are tagged to the departments/roles in this project's Resource Requirements, so <b>all available employees</b> are shown.</div></div>";
                } else if (d.demandMatched > 0) {
                    matchHint = "<div class='pmMuted' style='margin:0 0 8px'>★ " + d.demandMatched + " employee(s) match this project's Resource Requirements.</div>";
                }

                // ── Department accordions with checkbox rows + per-employee inputs ────
                var groupsHtml = groups.map(function (g, gi) {
                    var rows = g.employees.map(function (e) {
                        var eid = esc(e.employeeId);
                        var star = e.recommended ? "<span class='amStar' title='Matches a Resource Requirement'>★</span> " : "";
                        var avail = (e.available != null ? e.available + "% free" : "");
                        var rate = Number(e.costRatePerHour) || 0;
                        var base = baselineFor(e);
                        return "<div class='amEmpRow' data-emp='" + eid + "'>" +
                            "<label class='amEmpHead'><input type='checkbox' class='amChk' data-emp='" + eid + "'/> " +
                            "<span class='amEmpName'>" + star + esc(e.employeeName) + "</span>" +
                            "<span class='amEmpMeta'>" + esc(roleLabelFor(e)) + " · " + avail + " · " + inr(rate) + "/hr</span></label>" +
                            "<div class='amEmpInputs' data-emp='" + eid + "' style='display:none'>" +
                            "<div class='amCalcGrid'>" +
                            "<div><label>Allocation %</label><input type='number' min='1' max='100' step='5' class='amI amPct' data-emp='" + eid + "' value='100'/></div>" +
                            "<div><label>Allocated Hours</label><div class='amRO amHrsOut' data-emp='" + eid + "'>0 h</div></div>" +
                            "<div><label>Estimated Cost</label><div class='amRO amCostOut' data-emp='" + eid + "'>₹0</div></div>" +
                            "</div>" +
                            "<div class='amBaseNote'>Baseline effort: <b>" + base + " h</b> per employee (from Resource Requirement) · Inherits milestone dates</div>" +
                            "<div class='amEmpErr' data-emp='" + eid + "'></div></div></div>";
                    }).join("");
                    return "<div class='amGroup'><div class='amGroupHead' data-gi='" + gi + "'>" +
                        "<span class='amCaret'>▾</span> <b>" + esc(g.department) + "</b> <span class='pmCount'>" + g.employees.length + "</span></div>" +
                        "<div class='amGroupBody' data-gi='" + gi + "'>" + rows + "</div></div>";
                }).join("");

                var msHeader = preMs
                    ? "<div class='pmFixedMs'><b>#" + (preMs.sequence || 0) + " " + esc(preMs.name) + "</b><div class='pmMuted' style='font-size:0.74rem'>Window: " + esc(winOf(preMs)) + "</div></div>"
                    : "";

                // Live allocation summary (Part 7) — updates on every % change.
                var baselineBar = "<div class='amSummary'>" +
                    "<div class='amSumCard'><div class='amSumLbl'>Estimated Hours Baseline</div><div class='amSumVal'>" + projectBaselineHours + " h</div></div>" +
                    "<div class='amSumCard'><div class='amSumLbl'>Allocated Hours</div><div class='amSumVal' id='amAllocTotal'>0 h</div></div>" +
                    "<div class='amSumCard'><div class='amSumLbl'>Remaining Hours</div><div class='amSumVal' id='amRemain'>" + projectBaselineHours + " h</div></div>" +
                    "<div class='amSumCard'><div class='amSumLbl'>Estimated Cost</div><div class='amSumVal' id='amEstCost'>₹0</div></div>" +
                    "<div class='amBaseTrack' style='grid-column:1/-1'><div id='amBaseFill' class='amBaseFill' style='width:0%'></div></div>" +
                    "<div id='amBaseWarn' class='pmMuted' style='font-size:0.72rem;grid-column:1/-1'></div></div>";

                // Per-role-category budget exhaustion (what each department/category has left).
                var catRows = (d.categoryConsumption || []).map(function (cc) {
                    var col = cc.overrun ? "#dc2626" : cc.pct >= 85 ? "#d97706" : "#16a34a";
                    return "<div class='amCatRow'><div class='amCatName'>" + esc(cc.category) + "</div>" +
                        "<div class='amCatBar'><div class='amCatFill' style='width:" + Math.min(100, cc.pct) + "%;background:" + col + "'></div></div>" +
                        "<div class='amCatNums'>" + that._inr2(cc.consumed) + " / " + that._inr2(cc.allocated) + " · <b style='color:" + col + "'>" + that._inr2(cc.remaining) + " left</b>" + (cc.overrun ? " ⚠" : "") + "</div></div>";
                }).join("");
                var catPanel = (d.categoryConsumption && d.categoryConsumption.length)
                    ? "<div class='amCatPanel'><div class='amCatHead'>Budget by Role Category — allocated vs consumed</div>" + catRows + "</div>" : "";

                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>Allocate Resources to Milestone</div>" +
                    "<div class='pmDialogBody'>" +
                    msHeader + matchHint + baselineBar + catPanel +
                    "<div class='amGroups'>" + groupsHtml + "</div>" +
                    "<div class='amTypeRow' style='margin-top:10px'><label class='amRadio'><input type='radio' name='amType' value='Hard' checked/> Hard <span class='pmMuted'>(confirmed)</span></label>" +
                    "<label class='amRadio'><input type='radio' name='amType' value='Soft'/> Soft <span class='pmMuted'>(tentative)</span></label>" +
                    "<label class='amRadio' style='margin-left:auto'><input type='checkbox' id='amOverride'/> Allow override <span class='pmMuted'>(over-capacity / over-baseline / over-budget)</span></label></div>" +
                    "<div id='amErr' class='pmErr' style='display:none'></div>" +
                    "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button>" +
                    "<button class='pmBtn primary' id='pmSave'>Allocate Selected</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { ov.remove(); };
                var $ = function (s) { return ov.querySelector(s); };
                ov.querySelector("#pmCancel").addEventListener("click", close);

                // Collapsible department sections.
                ov.querySelectorAll(".amGroupHead").forEach(function (h) {
                    h.addEventListener("click", function () {
                        var gi = this.getAttribute("data-gi");
                        var body = ov.querySelector(".amGroupBody[data-gi='" + gi + "']");
                        var open = body.style.display !== "none";
                        body.style.display = open ? "none" : "block";
                        this.querySelector(".amCaret").textContent = open ? "▸" : "▾";
                    });
                });

                // Allocated Hours = per-employee baseline × allocation % ÷ 100 (Part 5).
                var pctOf = function (eid) { return parseFloat(ov.querySelector(".amPct[data-emp='" + eid + "']").value); };
                var hoursFor = function (e, pct) { return Math.round(baselineFor(e) * (pct / 100) * 100) / 100; };
                var estHoursFor = function (eid) {
                    var chk = ov.querySelector(".amChk[data-emp='" + eid + "']");
                    if (!chk || !chk.checked) return 0;
                    var pct = pctOf(eid); if (!(pct > 0)) return 0;
                    return hoursFor(empById[eid], pct);
                };
                // Recompute all read-only hours/cost + the live summary (Parts 6, 7).
                var recompute = function () {
                    var type = (ov.querySelector("input[name='amType']:checked") || {}).value || "Hard";
                    var totalHrs = 0, totalCost = 0;
                    allEmps.forEach(function (e) {
                        var eid = e.employeeId;
                        var chk = ov.querySelector(".amChk[data-emp='" + eid + "']");
                        var hrsOut = ov.querySelector(".amHrsOut[data-emp='" + eid + "']");
                        var costOut = ov.querySelector(".amCostOut[data-emp='" + eid + "']");
                        var errEl = ov.querySelector(".amEmpErr[data-emp='" + eid + "']");
                        if (!chk || !chk.checked) { if (hrsOut) hrsOut.textContent = "0 h"; if (costOut) costOut.textContent = "₹0"; if (errEl) errEl.textContent = ""; return; }
                        var pct = pctOf(eid);
                        var rate = Number(empById[eid].costRatePerHour) || 0;
                        // Validation: % must be 1–100 (Part 9). Hours can never exceed the
                        // per-employee baseline because % is capped at 100.
                        if (errEl) errEl.textContent = (!(pct >= 1) || pct > 100)
                            ? "Allocation percentage cannot exceed 100% of the required effort for this resource (enter 1–100%)." : "";
                        var validPct = (pct >= 1 && pct <= 100) ? pct : 0;
                        var hrs = hoursFor(e, validPct);
                        var cost = type === "Soft" ? 0 : Math.round(hrs * rate);
                        if (hrsOut) hrsOut.textContent = Math.round(hrs) + " h";
                        if (costOut) costOut.textContent = inr(cost) + (type === "Soft" ? " (Soft)" : "");
                        totalHrs += hrs; totalCost += cost;
                    });
                    $("#amAllocTotal").textContent = Math.round(totalHrs) + " h";
                    $("#amRemain").textContent = Math.round(projectBaselineHours - totalHrs) + " h";
                    $("#amEstCost").textContent = inr(totalCost);
                    var pctFill = projectBaselineHours > 0 ? Math.min(100, Math.round(totalHrs / projectBaselineHours * 100)) : (totalHrs > 0 ? 100 : 0);
                    var fill = $("#amBaseFill"), over = projectBaselineHours > 0 && totalHrs > projectBaselineHours;
                    fill.style.width = pctFill + "%"; fill.style.background = over ? "#dc2626" : "#16a34a";
                    var warn = $("#amBaseWarn");
                    if (over) warn.innerHTML = "<span style='color:#dc2626'>Allocated hours exceed the project baseline by " + Math.round(totalHrs - projectBaselineHours) + " h. Enable <b>Allow override</b> to proceed.</span>";
                    else warn.textContent = projectBaselineHours > 0 ? ("Remaining baseline: " + Math.max(0, Math.round(projectBaselineHours - totalHrs)) + " h") : "";
                };

                // Wire checkboxes (reveal inputs) + % inputs (live recompute).
                ov.querySelectorAll(".amChk").forEach(function (chk) {
                    chk.addEventListener("change", function () {
                        var eid = this.getAttribute("data-emp");
                        ov.querySelector(".amEmpInputs[data-emp='" + eid + "']").style.display = this.checked ? "block" : "none";
                        recompute();
                    });
                });
                ov.querySelectorAll(".amPct").forEach(function (i) { i.addEventListener("input", recompute); });
                ov.querySelectorAll("input[name='amType']").forEach(function (r) { r.addEventListener("change", recompute); });
                recompute();

                // ── Allocate: one call per selected employee (reuses the engine) ─────
                ov.querySelector("#pmSave").addEventListener("click", function () {
                    var err = $("#amErr"); err.style.display = "none";
                    var milestoneId = preMs ? preMs.milestoneId : (msList[0] && msList[0].milestoneId);
                    var type = (ov.querySelector("input[name='amType']:checked") || {}).value || "Hard";
                    var override = $("#amOverride").checked;
                    var selected = [];
                    var bad = null, total = 0;
                    allEmps.forEach(function (e) {
                        var eid = e.employeeId;
                        var chk = ov.querySelector(".amChk[data-emp='" + eid + "']");
                        if (!chk || !chk.checked) return;
                        var pct = parseFloat(ov.querySelector(".amPct[data-emp='" + eid + "']").value) || 0;
                        // Only mandatory input is a valid allocation % (1–100). Hours & cost
                        // are derived automatically; dates inherit the milestone window.
                        if (!(pct >= 1 && pct <= 100)) { bad = bad || (e.employeeName + ": allocation % must be between 1 and 100."); return; }
                        var hrs = hoursFor(e, pct);
                        // estimatedHours (hours-basis) → the engine stores these exact hours.
                        // Also pass the project-hours baseline + milestone % so Manage
                        // Resources shows the % of PROJECT hours (not monthly capacity).
                        var payload = { projectId: pid, employeeId: eid, milestoneId: milestoneId, allocationType: type, estimatedHours: hrs, projectAllocationHours: baselineFor(e), milestoneAllocationPercent: pct, force: override, overrideReason: override ? "Bulk milestone allocation override" : "" };
                        total += hrs;
                        selected.push(payload);
                    });
                    if (bad) { err.style.display = "block"; err.textContent = bad; return; }
                    if (!selected.length) { err.style.display = "block"; err.textContent = "Select at least one employee and enter an allocation %."; return; }
                    if (projectBaselineHours > 0 && total > projectBaselineHours && !override) {
                        err.style.display = "block"; err.textContent = "Allocated hours (" + Math.round(total) + "h) exceed the project baseline (" + projectBaselineHours + "h). Enable “Allow override” to proceed."; return;
                    }
                    var btn = this; btn.disabled = true; btn.textContent = "Allocating…";
                    // Sequential to respect capacity/budget validation per employee.
                    var results = [];
                    var step = function (i) {
                        if (i >= selected.length) {
                            btn.disabled = false; btn.textContent = "Allocate Selected";
                            var okN = results.filter(function (r) { return r.ok; }).length;
                            var failed = results.filter(function (r) { return !r.ok; });
                            if (failed.length) {
                                err.style.display = "block";
                                err.textContent = okN + " allocated · " + failed.length + " failed: " + failed.map(function (f) { return f.name + " — " + f.error; }).join("; ");
                            }
                            if (okN) MessageToast.show(okN + " employee(s) allocated to the milestone.");
                            that._open(pid); that._loadMilestones();
                            if (!failed.length) close();
                            return;
                        }
                        var p = selected[i], nm = (empById[p.employeeId] || {}).employeeName || p.employeeId;
                        ppost("allocateResourceToMilestone", p).then(function (res) {
                            if (res && (res.overallocation || res.budgetOverrun) && !p.force) {
                                results.push({ ok: false, name: nm, error: (res.error || "over limit") + " (enable Allow override)" });
                            } else if (res && res.error) {
                                results.push({ ok: false, name: nm, error: res.error });
                            } else { results.push({ ok: true, name: nm }); }
                            step(i + 1);
                        }).catch(function () { results.push({ ok: false, name: nm, error: "request failed" }); step(i + 1); });
                    };
                    step(0);
                });
            }).catch(function () { MessageToast.show("Could not load employees."); });
        },

        // ── Resource Planning v2 — 3-month hours capacity forecast ───────────────
        onResourceForecast: function () {
            var that = this, pid = this._detail.project.projectId;
            ppost("getResourceForecast", { projectId: pid, months: 3 }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                var fc = d.forecast || [];
                var monthLabels = fc.length && fc[0].months ? fc[0].months.map(function (m) { return m.label; }) : [];
                var utilCol = function (u) { return u > 100 ? "#dc2626" : u >= 90 ? "#a16207" : u >= 70 ? "#16a34a" : "#2563eb"; };
                var head = "<tr><th>Employee</th>" + monthLabels.map(function (l) { return "<th style='text-align:center'>" + esc(l) + "</th>"; }).join("") + "</tr>";
                var rows = fc.length ? fc.map(function (e) {
                    var cells = (e.months || []).map(function (m) {
                        return "<td style='text-align:center'>" +
                            "<div class='fcAvail' style='color:" + (m.overbooked ? "#dc2626" : "#16a34a") + "'>" + m.availableHours + "h free</div>" +
                            "<div class='fcSub'>Cap " + m.effectiveCapacityHours + " · <span style='color:" + utilCol(m.utilizationPct) + "'>H " + m.hardHours + "</span>" + (m.softHours ? " · S " + m.softHours : "") + "</div></td>";
                    }).join("");
                    return "<tr><td><b>" + esc(e.employeeName) + "</b><div class='fcSub'>" + esc(e.department || "") + "</div></td>" + cells + "</tr>";
                }).join("") : "<tr><td colspan='" + (monthLabels.length + 1) + "' class='pmMuted' style='text-align:center;padding:14px'>No resources to forecast.</td></tr>";
                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog wide'><div class='pmDialogHead'>Capacity Forecast — Hours (next 3 months)</div>" +
                    "<div class='pmDialogBody'><div class='pmMuted' style='margin-bottom:8px'>Hours are the source of truth. <b>H</b> = Hard (confirmed), <b>S</b> = Soft (tentative). Free = effective capacity − hard.</div>" +
                    "<table class='pmTable fcTable'><thead>" + head + "</thead><tbody>" + rows + "</tbody></table></div>" +
                    "<div class='pmDialogFoot'><button class='pmBtn primary' id='pmCancel'>Close</button></div></div>";
                document.body.appendChild(ov);
                ov.querySelector("#pmCancel").addEventListener("click", function () { ov.remove(); });
            }).catch(function () { MessageToast.show("Could not load the forecast."); });
        },

        onAllocate: function () {
            var that = this, pid = this._detail.project.projectId;
            ppost("getAllocatableEmployees", { projectId: pid }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                // Type-driven pickers: Role (all types with categories), Phase + Module
                // (phase-based types, e.g. SAP). Empty arrays → that picker is hidden.
                var roleOpts = d.roleOptions || [], phaseOpts = d.phaseOptions || [], moduleOpts = d.moduleOptions || [];
                var optList = function (arr, sel, placeholder) {
                    return "<option value=''>" + (placeholder || "—") + "</option>" + arr.map(function (x) { return "<option" + (x === sel ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("");
                };
                // Optional milestone scope per allocation (preselect from existing).
                var msAlloc = that._detail.milestones || [];
                var msByEmp = {}; (that._detail.resources || []).forEach(function (r) { msByEmp[r.employeeId] = r.milestoneId || ""; });
                var msOptList = function (sel) {
                    return "<option value=''>— Project-level —</option>" + msAlloc.map(function (m) {
                        return "<option value='" + esc(m.milestoneId) + "'" + (m.milestoneId === sel ? " selected" : "") + ">#" + (m.sequence || 0) + " " + esc(m.name) + "</option>";
                    }).join("");
                };
                // One employee TABLE ROW. The PM only ever touches the checkbox and the
                // allocation %. No Role/Module/Phase/Milestone dropdowns — classification
                // comes entirely from employee master data. Classes/attributes (pmResRow,
                // pmChk, pmBw, pmCostCell, data-rate/cap/max) kept so validate/updateCosts/
                // submit keep working. data-rate is the salary-only Cost Per Hour.
                var rowHtml = function (e, withModule) {
                    var maxAllowed = (Number(e.available) || 0) + (Number(e.allocatedHere) || 0);
                    var bwOpts = "<option value='0'>—</option>" + BANDWIDTHS.map(function (b) { return "<option value='" + b + "'" + (e.allocatedHere === b ? " selected" : "") + ">" + b + "%</option>"; }).join("");
                    var emp = esc(e.employeeId);
                    var rate = Number(e.costPerHour) || 0;
                    var cap = Number(e.monthlyCapacityHours) || 160;
                    var rateTxt = rate > 0 ? ("₹" + rate.toLocaleString("en-IN")) : "n/a";
                    var util = e.currentAllocation || 0;
                    var utilCol = util > 100 ? "#dc2626" : util >= 85 ? "#a16207" : "#16a34a";
                    var searchKey = (String(e.employeeName || "") + " " + (e.certifications || "") + " " + (e.specializationName || "")).toLowerCase();
                    return "<tr class='pmResRow' data-name='" + esc(searchKey) + "' data-rate='" + rate + "' data-cap='" + cap + "'>" +
                        "<td><label class='pmEmpCell'><input type='checkbox' class='pmChk' data-emp='" + emp + "'" + (e.allocatedHere ? " checked" : "") + "/> " +
                            esc(e.employeeName) + " <span style='color:" + utilCol + ";font-size:0.72rem'>(" + util + "%)</span></label></td>" +
                        (withModule ? "<td>" + esc(e.specializationName || "—") + "</td>" : "") +
                        "<td>" + (Number(e.yearsOfExperience) || 0) + "y</td>" +
                        "<td>" + (e.certifications ? esc(e.certifications) : "—") + "</td>" +
                        "<td>" + e.available + "%</td>" +
                        "<td>" + rateTxt + "</td>" +
                        "<td><select class='pmBw' data-emp='" + emp + "' data-max='" + maxAllowed + "'>" + bwOpts + "</select></td>" +
                        "<td class='pmCostCell' data-emp='" + emp + "'></td>" +
                        "</tr>";
                };
                // Fully data-driven render: the backend returns d.grouped =
                // [{ department, roles:[{ roleName, showModule, employees:[] }] }],
                // built from employee master classification. The frontend hardcodes NO
                // department or role names — new master data appears automatically, and
                // roles with no employees are never sent (so never rendered).
                var sectionTable = function (role) {
                    var isMod = !!role.showModule;
                    var head = "<tr><th>Employee</th>" + (isMod ? "<th>Module</th>" : "") +
                        "<th>Exp</th><th>Certification</th><th>Avail</th><th>Cost/Hr</th><th>Alloc %</th><th>Est. Cost</th></tr>";
                    var rows = (role.employees || []).map(function (e) { return rowHtml(e, isMod); }).join("");
                    return "<div class='pmRoleSection'><div class='pmRoleSecTitle'>" + esc(String(role.roleName || "").toUpperCase()) +
                        " <span class='pmMuted'>(" + (role.employees || []).length + ")</span></div>" +
                        "<table class='pmTable pmResTable'><thead>" + head + "</thead><tbody>" + rows + "</tbody></table></div>";
                };
                var deptHtml = (d.grouped || []).map(function (dep) {
                    return "<div class='pmDeptBlock'><div class='pmDeptTitle'>" + esc(dep.department) + "</div>" +
                        (dep.roles || []).map(sectionTable).join("") + "</div>";
                }).join("");
                // Eligible departments banner — resource assignment is restricted to
                // departments funded in Budget Allocation.
                // Type-aware projects show eligible Resource Categories (SAP / dev roles);
                // legacy projects show eligible Departments.
                var elig = d.typeAware ? (d.eligibleCategories || []) : (d.eligibleDepartments || []);
                var eligLabel = d.typeAware ? "Resource Categories for this Project Type" : "Eligible Departments for Resource Assignment";
                var eligBanner = elig.length
                    ? "<div class='pmEligBox'><div class='pmEligLbl'>" + eligLabel + "</div>" +
                        "<div class='pmEligChips'>" + elig.map(function (x) { return "<span class='pmEligChip'>" + esc(x) + "</span>"; }).join("") + "</div></div>"
                    : (d.typeAware
                        ? "<div class='pmEligBox warn'>No budget has been allocated to any resource category yet. Allocate the budget first.</div>"
                        : "<div class='pmEligBox warn'>No departments have an approved budget allocation for this project yet. Allocate a department budget before assigning resources.</div>");
                var emptyMsg = "<div class='pmMuted'>No assignable employees" + (d.typeAware ? "." : " in the budget-approved departments.") + "</div>";
                // Budget consumption bar (Execution / Allocated / Remaining) — cost only.
                var projMonths = Number(d.projectMonths) || 1;
                var miscPerMonth = Number(d.monthlyOverhead) || 0;   // ₹/month overhead (already in the rate)
                var execBudget = Number(d.executionBudget) || 0;
                var baseAllocated = Number(d.allocatedResourceCost) || 0;
                var budgetBar = execBudget > 0
                    ? "<div class='pmBudgetBox'><div class='pmBudgetRow'>" +
                        "<span>Execution Budget <b>₹" + execBudget.toLocaleString("en-IN") + "</b></span>" +
                        "<span>Allocated <b id='pmAllocCost'>₹" + Math.round(baseAllocated).toLocaleString("en-IN") + "</b></span>" +
                        "<span>Remaining <b id='pmRemCost'>₹" + Math.round(execBudget - baseAllocated).toLocaleString("en-IN") + "</b></span></div>" +
                        "<div class='pmBudgetTrack'><div id='pmBudgetFill' class='pmBudgetFill'></div></div>" +
                        "<div class='pmMuted' style='font-size:0.72rem'>Estimated over the project duration (" + projMonths + " month" + (projMonths > 1 ? "s" : "") + "). Estimate = (Allocated Hours × Cost/Hr) + (" + projMonths + " × ₹" + miscPerMonth.toLocaleString("en-IN") + " misc). Cost rates only — salaries are never shown.</div></div>"
                    : "";
                var ov = document.createElement("div");
                ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog pmDialogXL'><div class='pmDialogHead'>Manage Resources</div>" +
                    "<div class='pmDialogBody'>" + eligBanner + budgetBar +
                    "<input type='text' class='pmFInput' id='pmResSearch' placeholder='Search employee…'/>" +
                    "<div class='pmResErr' id='pmResErr' style='display:none'></div>" +
                    "<div id='pmResList'>" + (deptHtml || emptyMsg) + "</div></div>" +
                    "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Save Allocation</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { ov.remove(); };

                // Live cost: per-row estimate + total allocated vs remaining budget.
                var updateCosts = function () {
                    var totalNew = 0;
                    ov.querySelectorAll(".pmResRow").forEach(function (row) {
                        var chk = row.querySelector(".pmChk"), sel = row.querySelector(".pmBw");
                        var bw = parseInt(sel ? sel.value : "0", 10) || 0;
                        var rate = parseFloat(row.getAttribute("data-rate")) || 0;
                        var cap = parseFloat(row.getAttribute("data-cap")) || 160;
                        var cell = row.querySelector(".pmCostCell");
                        if (chk && chk.checked && bw > 0) {
                            // Estimated Cost = (allocatedHours × Cost Per Hour) + (months × ₹misc).
                            var hours = bw / 100 * cap * projMonths;
                            var misc = Math.round(miscPerMonth * projMonths);   // flat misc per resource
                            var est = Math.round(rate * hours) + misc;
                            totalNew += est;
                            if (cell) cell.innerHTML = "<b>₹" + est.toLocaleString("en-IN") + "</b>" +
                                "<div class='pmMuted' style='font-size:0.66rem'>" + Math.round(hours) + "h × ₹" + rate.toLocaleString("en-IN") + " + misc ₹" + misc.toLocaleString("en-IN") + "</div>";
                        } else if (cell) { cell.innerHTML = ""; }
                    });
                    if (execBudget > 0) {
                        var rem = execBudget - totalNew;
                        var ac = ov.querySelector("#pmAllocCost"), rc = ov.querySelector("#pmRemCost"), fill = ov.querySelector("#pmBudgetFill");
                        if (ac) ac.textContent = "₹" + Math.round(totalNew).toLocaleString("en-IN");
                        if (rc) { rc.textContent = "₹" + Math.round(rem).toLocaleString("en-IN"); rc.style.color = rem < 0 ? "#dc2626" : "#16a34a"; }
                        if (fill) { var pct = Math.min(100, Math.round(totalNew / execBudget * 100)); fill.style.width = pct + "%"; fill.style.background = totalNew > execBudget ? "#dc2626" : pct >= 90 ? "#ea580c" : "#16a34a"; }
                    }
                };
                ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
                ov.querySelector("#pmCancel").addEventListener("click", close);
                var errBox = ov.querySelector("#pmResErr");
                var showErr = function (msg) { errBox.textContent = "⚠ " + msg; errBox.style.display = "block"; };
                var clearErr = function () { errBox.style.display = "none"; };

                // Validate every checked employee against their available capacity.
                // Returns true when all allocations fit; highlights offending rows.
                var validate = function () {
                    var ok = true;
                    ov.querySelectorAll(".pmResRow").forEach(function (row) {
                        var chk = row.querySelector(".pmChk"), sel = row.querySelector(".pmBw");
                        var bw = parseInt(sel ? sel.value : "0", 10) || 0;
                        var max = parseInt(sel ? sel.getAttribute("data-max") : "0", 10) || 0;
                        var over = chk && chk.checked && bw > max;
                        row.classList.toggle("over", !!over);
                        if (over) ok = false;
                    });
                    if (ok) clearErr();
                    else showErr("Allocation exceeds available capacity for the highlighted employee(s). Reduce the bandwidth to within their available %.");
                    return ok;
                };
                // Re-validate on any change; auto-check a row when a bandwidth is picked.
                ov.querySelectorAll(".pmBw").forEach(function (sel) {
                    sel.addEventListener("change", function () {
                        var chk = sel.closest(".pmResRow").querySelector(".pmChk");
                        if (chk) chk.checked = (parseInt(sel.value, 10) || 0) > 0;
                        if ((parseInt(sel.value, 10) || 0) > 0) sel.classList.remove("pmBwMissing");
                        validate(); updateCosts();
                    });
                });
                ov.querySelectorAll(".pmChk").forEach(function (chk) { chk.addEventListener("change", function () { validate(); updateCosts(); }); });
                updateCosts();   // initial

                // Search — filter table rows (name/cert/module) and hide empty role sections.
                ov.querySelector("#pmResSearch").addEventListener("input", function () {
                    var q = this.value.toLowerCase();
                    ov.querySelectorAll("#pmResList .pmResRow").forEach(function (row) {
                        row.style.display = (row.getAttribute("data-name") || "").indexOf(q) !== -1 ? "" : "none";
                    });
                    ov.querySelectorAll("#pmResList .pmRoleSection").forEach(function (sec) {
                        var any = Array.prototype.some.call(sec.querySelectorAll(".pmResRow"), function (r) { return r.style.display !== "none"; });
                        sec.style.display = any ? "" : "none";
                    });
                });
                var saveBtn = ov.querySelector("#pmSave");
                // Submit to the server (source of truth). The server returns a
                // structured `warning` when an allocation exceeds 100% capacity;
                // a Founder can then re-submit with allowOverride to proceed.
                var submit = function (allowOverride, overrideReason) {
                    var allocations = [], missing = [];
                    ov.querySelectorAll(".pmChk").forEach(function (chk) {
                        var emp = chk.getAttribute("data-emp");
                        var sel = ov.querySelector(".pmBw[data-emp='" + emp + "']");
                        if (sel) sel.classList.remove("pmBwMissing");
                        if (!chk.checked) return;
                        var bw = parseInt(sel ? sel.value : "0", 10);
                        // Employee selected but no allocation % chosen → flag the field.
                        if (!(bw > 0)) { if (sel) sel.classList.add("pmBwMissing"); missing.push(sel); return; }
                        // Classification comes from employee master data — the PM only
                        // picks who + how much. role/phase/module/milestone are left to the
                        // backend (preserved for existing rows, null for new ones).
                        allocations.push({ employeeId: emp, bandwidth: bw });
                    });
                    if (missing.length) { showErr("Please select employee allocation percentage."); return; }
                    if (!allocations.length) { showErr("Select at least one employee and a bandwidth."); return; }
                    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
                    ppost("allocateResources", { projectId: pid, allocations: allocations, allowOverride: !!allowOverride, overrideReason: overrideReason || "" }).then(function (res) {
                        saveBtn.disabled = false; saveBtn.textContent = "Save Allocation";
                        if (res && res.error) { showErr(res.error); return; }
                        // Backend asks for confirmation + a mandatory reason before overriding.
                        if (res && res.warning) { that._showOverrideDialog(res, function (reason) { submit(true, reason); }); return; }
                        close();
                        MessageToast.show(res && res.overridden ? "Resources allocated (utilization overridden)." : "Resources allocated.");
                        that._open(pid);
                    }).catch(function () { saveBtn.disabled = false; saveBtn.textContent = "Save Allocation"; showErr("Could not allocate. Please try again."); });
                };
                saveBtn.addEventListener("click", function () { validate(); submit(false); });
            });
        },

        // Override dialog — shown before creating an allocation that exceeds 100%
        // capacity. The POC/Founder must enter a mandatory reason to proceed; the
        // override is then tracked + audited (Founder-visible).
        _showOverrideDialog: function (res, onConfirm) {
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            var rows = (res.overallocations || []).map(function (o) {
                return "<tr><td><b>" + esc(o.employeeName) + "</b></td><td>" + o.usedElsewhere + "%</td>" +
                    "<td>+" + o.requested + "%</td><td style='color:#dc2626;font-weight:700'>" + o.total + "%</td></tr>";
            }).join("");
            if (!res.canOverride) {
                ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>⚠ Capacity Exceeded</div>" +
                    "<div class='pmDialogBody'><p>" + esc(res.message || "One or more allocations exceed 100% capacity.") + "</p>" +
                    "<table class='pmTable'><thead><tr><th>Employee</th><th>Already</th><th>Requested</th><th>Total</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
                    "<div class='pmDialogFoot'><button class='pmBtn primary' id='pmNo'>OK</button></div></div>";
                document.body.appendChild(ov);
                var close0 = function () { ov.remove(); };
                ov.addEventListener("click", function (e) { if (e.target === ov) close0(); });
                ov.querySelector("#pmNo").addEventListener("click", close0);
                return;
            }
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Override Resource Allocation</div>" +
                "<div class='pmDialogBody'>" +
                "<p>This assignment pushes the following employee(s) beyond 100% utilization:</p>" +
                "<table class='pmTable'><thead><tr><th>Employee</th><th>Current</th><th>Requested</th><th>After</th></tr></thead><tbody>" + rows + "</tbody></table>" +
                "<label class='pmFLbl' style='margin-top:10px'>Reason for Override <span style='color:#dc2626'>*</span></label>" +
                "<textarea class='pmFInput' id='pmOvrReason' rows='3' placeholder='e.g. Critical client delivery — temporary bandwidth needed'></textarea>" +
                "<div class='pmErr' id='pmOvrErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmNo'>Cancel</button><button class='pmBtn danger' id='pmYes'>Confirm Override</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmNo").addEventListener("click", close);
            ov.querySelector("#pmYes").addEventListener("click", function () {
                var reason = (ov.querySelector("#pmOvrReason").value || "").trim();
                if (!reason) { var e = ov.querySelector("#pmOvrErr"); e.textContent = "⚠ A reason is required to override."; e.style.display = "block"; return; }
                close(); if (onConfirm) onConfirm(reason);
            });
        },

        // ── Schedule Meeting dialog ────────────────────────────────────────────────
        onScheduleMeeting: function () {
            var that = this, d = this._detail, pid = d.project.projectId;
            var resources = (d.resources || []).slice().sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
            var today = new Date().toISOString().slice(0, 10);
            var partChecks = resources.map(function (r) {
                return "<label class='pmCheckRow'><input type='checkbox' class='pmMtgPart' data-emp='" + esc(r.employeeId) + "'/> " + esc(r.employeeName) + " <span class='pmMuted'>(" + esc(r.department) + ")</span></label>";
            }).join("");
            if (!partChecks) partChecks = "<div class='pmMuted'>No allocated resources to invite. Allocate resources first.</div>";
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Schedule Teams Meeting</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Meeting Title *</label><input type='text' class='pmFInput' id='mtgTitle' placeholder='e.g. Sprint Planning'/>" +
                "<label class='pmFLbl'>Agenda</label><textarea class='pmFInput' id='mtgAgenda' rows='2' placeholder='Meeting agenda / topics…'></textarea>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Date *</label><input type='date' class='pmFInput' id='mtgDate' min='" + today + "'/></div>" +
                "<div><label class='pmFLbl'>Start Time *</label><input type='time' class='pmFInput' id='mtgStart' value='10:00'/></div>" +
                "<div><label class='pmFLbl'>End Time *</label><input type='time' class='pmFInput' id='mtgEnd' value='11:00'/></div></div>" +
                "<label class='pmFLbl'>Participants (select from allocated resources) *</label>" +
                "<div class='pmCheckList'>" + partChecks + "</div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Schedule</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                var title = (ov.querySelector("#mtgTitle").value || "").trim();
                if (!title) { MessageToast.show("Meeting title is required."); return; }
                var date  = ov.querySelector("#mtgDate").value;
                var start = ov.querySelector("#mtgStart").value;
                var end   = ov.querySelector("#mtgEnd").value;
                if (!date)  { MessageToast.show("Date is required."); return; }
                if (!start) { MessageToast.show("Start time is required."); return; }
                if (!end)   { MessageToast.show("End time is required."); return; }
                if (end <= start) { MessageToast.show("End time must be after start time."); return; }
                var startDT = date + "T" + start + ":00";
                var endDT   = date + "T" + end + ":00";
                var partIds = [];
                ov.querySelectorAll(".pmMtgPart").forEach(function (chk) { if (chk.checked) partIds.push(chk.getAttribute("data-emp")); });
                if (!partIds.length) { MessageToast.show("Select at least one participant."); return; }
                btn.disabled = true; btn.textContent = "Scheduling…";
                pprojpost("scheduleMeeting", { projectId: pid, title: title, agenda: (ov.querySelector("#mtgAgenda").value || "").trim(), startDateTime: startDT, endDateTime: endDT, participantIds: partIds })
                    .then(function (res) {
                        close();
                        if (res && res.error) { MessageToast.show(res.error); return; }
                        if (res && res.isMock) MessageToast.show("Meeting scheduled (mock). Teams join URL generated.");
                        else MessageToast.show("Teams meeting created successfully!");
                        that._meetings = null; that._detailTab = "meetings"; that._loadMeetings();
                    }).catch(function () { close(); MessageToast.show("Could not schedule meeting."); });
            });
        },

        // ── Edit Meeting dialog ────────────────────────────────────────────────────
        onEditMeeting: function (meetingId) {
            var that = this, pid = this._detail.project.projectId;
            var mtg = ((this._meetings || {}).meetings || []).find(function (m) { return m.meetingId === meetingId; }) || {};
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            var curDate = mtg.startISO ? mtg.startISO.slice(0, 10) : "";
            var curStart = mtg.startISO ? mtg.startISO.slice(11, 16) : "10:00";
            var curEnd   = mtg.endISO   ? mtg.endISO.slice(11, 16)   : "11:00";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Edit Meeting</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Title *</label><input type='text' class='pmFInput' id='eMtgTitle' value='" + esc(mtg.title || "") + "'/>" +
                "<label class='pmFLbl'>Agenda</label><textarea class='pmFInput' id='eMtgAgenda' rows='2'>" + esc(mtg.agenda || "") + "</textarea>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Date</label><input type='date' class='pmFInput' id='eMtgDate' value='" + curDate + "'/></div>" +
                "<div><label class='pmFLbl'>Start Time</label><input type='time' class='pmFInput' id='eMtgStart' value='" + curStart + "'/></div>" +
                "<div><label class='pmFLbl'>End Time</label><input type='time' class='pmFInput' id='eMtgEnd' value='" + curEnd + "'/></div></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Save Changes</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this;
                var title = (ov.querySelector("#eMtgTitle").value || "").trim();
                if (!title) { MessageToast.show("Title is required."); return; }
                var date = ov.querySelector("#eMtgDate").value;
                var s = ov.querySelector("#eMtgStart").value;
                var e2 = ov.querySelector("#eMtgEnd").value;
                if (s && e2 && e2 <= s) { MessageToast.show("End time must be after start time."); return; }
                btn.disabled = true; btn.textContent = "Saving…";
                pprojpost("updateMeetingDetails", { meetingId: meetingId, title: title, agenda: (ov.querySelector("#eMtgAgenda").value || "").trim(),
                    startDateTime: date && s ? date + "T" + s + ":00" : mtg.startISO, endDateTime: date && e2 ? date + "T" + e2 + ":00" : mtg.endISO })
                    .then(function (res) {
                        close();
                        if (res && res.error) { MessageToast.show(res.error); return; }
                        MessageToast.show("Meeting updated."); that._meetings = null; that._loadMeetings();
                    }).catch(function () { close(); MessageToast.show("Could not update meeting."); });
            });
        },

        // ── Cancel Meeting confirmation ────────────────────────────────────────────
        onCancelMeeting: function (meetingId, title) {
            var that = this;
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog sm'><div class='pmDialogHead'>Cancel Meeting</div>" +
                "<div class='pmDialogBody'><p>Cancel <b>" + esc(title) + "</b>?</p>" +
                "<p class='pmMuted'>The Teams meeting will be cancelled and all participants will be notified.</p></div>" +
                "<div class='pmDialogFoot'><button class='pmBtn ghost' id='pmNo'>Keep</button><button class='pmBtn danger' id='pmYes'>Cancel Meeting</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmNo").addEventListener("click", close);
            ov.querySelector("#pmYes").addEventListener("click", function () {
                this.disabled = true; this.textContent = "Cancelling…";
                pprojpost("cancelProjectMeeting", { meetingId: meetingId }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Meeting cancelled."); that._meetings = null; that._loadMeetings();
                }).catch(function () { close(); MessageToast.show("Could not cancel meeting."); });
            });
        }
    });
});
