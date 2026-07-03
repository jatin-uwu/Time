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
                that._detail = d; that._planning = null; that._budgetReqs = null; that._forecast = null; that._pmDash = null; that._view = "detail"; that._render();
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
                h.setContent(this._renderDetail());
                if ((this._detailTab || "overview") === "overview" && this._pmDash && !this._pmDash.error) this._pmLoadChart();
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
            var budgetPanel = "<div class='pmPanel pmSpan2'><div class='pmPanelHead'>Budget</div>" +
                "<div class='pmMiniStats pmBudgetStats'>" +
                "<div><span>Approved</span><b>" + this._pmMoney(b.approved) + "</b></div>" +
                "<div><span>Committed</span><b style='color:" + this._pmUtilColor(b.utilizationPct) + "'>" + this._pmMoney(b.committed != null ? b.committed : b.utilized) + "</b></div>" +
                "<div><span>Remaining</span><b style='color:#16a34a'>" + this._pmMoney(b.remaining) + "</b></div>" +
                "<div><span>Utilization</span><b style='color:" + this._pmUtilColor(b.utilizationPct) + "'>" + b.utilizationPct + "%</b></div>" +
                (b.actualSpend != null ? "<div><span>Actual Spend</span><b style='color:#64748b'>" + this._pmMoney(b.actualSpend) + "</b></div>" : "") + "</div>" +
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
        _pmLoadChart: function () {
            if (window.Chart) { var t = this; setTimeout(function () { t._pmInitCharts(); }, 40); return; }
            if (this._pmChartLoading) return;
            this._pmChartLoading = true;
            var that = this, s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"; s.async = true;
            s.onload = function () { that._pmChartLoading = false; that._pmInitCharts(); };
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
                var resCount = (d.resources || []).length;
                var p2 = d.project || {};
                var canAllocate = d.isPoc && !(p2.status === "Planning" && p2.lifecycleStage !== "BudgetAllocated");
                var lcNotice = (d.isPoc && p2.status === "Planning" && p2.lifecycleStage !== "BudgetAllocated")
                    ? "<div class='pmLcNotice'>Resource allocation will be unlocked once the Founder completes the planning meeting and allocates the budget.</div>"
                    : "";
                var resHead = "<div class='pmPanelHead'>Resources <span class='pmCount'>" + resCount + "</span>" +
                    (canAllocate ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onAllocateByMilestone()\">＋ Allocate by Hours</button>" : "") +
                    (canAllocate ? " <button class='pmBtn ghost sm' onclick=\"window._projCtrl.onAllocate()\">Manage (FTE)</button>" : "") +
                    " <button class='pmBtn ghost sm' onclick=\"window._projCtrl.onResourceForecast()\">Capacity Forecast</button></div>";
                var msList = d.milestones || [];
                var resRows = (d.resources || []).map(function (r) {
                    var u = r.utilizationPct || 0;
                    var uc = u > 100 ? "#dc2626" : u >= 85 ? "#a16207" : "#16a34a";
                    var ovr = r.isOverridden ? " <span class='pmOvrTag'>Overridden</span>" : "";
                    var rpm = [r.role, r.phase, r.module].filter(Boolean).map(esc).join(" · ") || "—";
                    // Optional milestone scope — inline picker (manage) or label (read-only).
                    var msCell;
                    if (canAllocate && msList.length) {
                        var opts = "<option value=''>— Project-level —</option>" + msList.map(function (m) {
                            return "<option value='" + esc(m.milestoneId) + "'" + (r.milestoneId === m.milestoneId ? " selected" : "") + ">#" + (m.sequence || 0) + " " + esc(m.name) + "</option>";
                        }).join("");
                        msCell = "<select class='pmSelect' onchange=\"window._projCtrl.onResMilestone('" + esc(r.employeeId) + "', this.value, " + (r.bandwidth || 0) + ")\">" + opts + "</select>";
                    } else { msCell = r.milestoneName ? esc(r.milestoneName) : "<span class='pmMuted'>Project-level</span>"; }
                    return "<tr><td>" + esc(r.employeeName) + " <b style='color:" + uc + "'>(" + u + "%)</b>" + ovr + "</td>" +
                        "<td>" + esc(r.department) + "</td><td>" + rpm + "</td><td>" + msCell + "</td><td><b>" + r.bandwidth + "%</b></td>" +
                        (canAllocate ? "<td><button class='pmLink danger' onclick=\"window._projCtrl.onRemoveRes('" + esc(r.employeeId) + "','" + esc(r.employeeName) + "')\">Deallocate</button></td>" : "<td></td>") + "</tr>";
                }).join("");
                body = "<div class='pmPanel'>" + resHead + lcNotice +
                    (resRows ? "<table class='pmTable'><thead><tr><th>Employee</th><th>Dept</th><th>Role · Phase · Module</th><th>Milestone</th><th>This Project</th><th></th></tr></thead><tbody>" + resRows + "</tbody></table>"
                        : "<div class='pmMuted'>No resources allocated.</div>") + "</div>" +
                    this._capacityPanel();
            } else if (activeTab === "tasks") {
                var taskRows = (d.tasks || []).map(function (t) {
                    var statusCell = t.mine
                        ? "<select class='pmSelect' onchange=\"window._projCtrl.onTaskStatus('" + esc(t.taskId) + "', this.value)\">" +
                            TASK_STATUSES.map(function (s) { return "<option" + (s === t.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>"
                        : esc(t.status);
                    return "<tr class='" + (t.mine ? "pmMine" : "") + "'><td><b>" + esc(t.taskName) + "</b></td>" +
                        "<td>" + esc(t.assignedToName || "—") + "</td><td>" + esc(t.priority) + "</td>" +
                        "<td>" + (t.estimatedHours || 0) + "h / " + (t.actualHours || 0) + "h</td><td>" + statusCell + "</td></tr>";
                }).join("");
                var taskHead = "<div class='pmPanelHead'>Tasks <span class='pmCount'>" + ((d.tasks || []).length) + "</span>" +
                    (d.isPoc ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onAssignTask()\">＋ Assign Task</button>" : "") + "</div>";
                body = "<div class='pmPanel'>" + taskHead +
                    (taskRows ? "<table class='pmTable'><thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Est/Act</th><th>Status</th></tr></thead><tbody>" + taskRows + "</tbody></table>"
                        : "<div class='pmMuted'>No tasks yet.</div>") + "</div>";
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
            else this._render();
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

            // ── Header + actions ─────────────────────────────────────────────────
            var actions = "";
            if (canManage) {
                actions = (ms.length === 0
                        ? " <button class='pmBtn ghost sm' onclick=\"window._projCtrl.onSeedMilestones()\">↻ Seed from Project Type</button>" : "") +
                    " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onMilestoneForm()\">＋ Add Milestone</button>";
            }
            var head = "<div class='pmPanelHead'>Milestones <span class='pmCount'>" + ms.length + "</span>" + actions + "</div>";

            if (!ms.length) {
                return "<div class='pmPanel'>" + tiles + budgetBar + head +
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
                    if (!terminal && x.progressMode === "manual" && !notStarted)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onMsProgress('" + esc(x.milestoneId) + "'," + (x.progressPct || 0) + ")\">Progress</button>";
                    if (!terminal)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onCompleteMilestone('" + esc(x.milestoneId) + "',false)\">Complete</button>";
                    if (x.approvalStatus === "Pending Approval")
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onDecideApproval('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Decide</button>";
                    else if (!terminal)
                        btns += "<button class='pmLink' onclick=\"window._projCtrl.onRequestApproval('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Request Approval</button>";
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onManageDeps('" + esc(x.milestoneId) + "')\">Deps</button>";
                    btns += "<button class='pmLink' onclick=\"window._projCtrl.onMilestoneForm('" + esc(x.milestoneId) + "')\">Edit</button>";
                    btns += "<button class='pmLink danger' onclick=\"window._projCtrl.onDeleteMilestone('" + esc(x.milestoneId) + "','" + esc(x.name) + "')\">Delete</button>";
                }

                return "<tr><td><b>#" + (x.sequence || 0) + " " + esc(x.name) + "</b>" + crit + bill + deps +
                        (x.ownerName ? "<div class='pmMuted' style='font-size:0.72rem'>owner: " + esc(x.ownerName) + "</div>" : "") + "</td>" +
                    "<td>" + that._msStatusChip(x.status) +
                        (x.approvalStatus && x.approvalStatus !== "None" ? "<div style='margin-top:4px'>" + that._msApprovalChip(x.approvalStatus) + "</div>" : "") + "</td>" +
                    "<td style='min-width:120px'>" + that._bar(x.progressPct) + "<div class='pmMuted' style='font-size:0.68rem'>" + esc(x.progressMode) + "</div></td>" +
                    "<td>" + dates + "<div style='font-size:0.74rem;margin-top:2px'>" + timing + "</div></td>" +
                    "<td>" + budgetCell + "</td>" +
                    "<td>" + (x.resourceCount || 0) + "👤 · " + (x.taskCount || 0) + "✓</td>" +
                    (canManage ? "<td><div class='pmMsActions'>" + btns + "</div></td>" : "<td></td>") + "</tr>";
            }).join("");

            // ── Reports toolbar (Phase 15) — downloadable xlsx / pdf ─────────────
            var RPT = [["status", "Status"], ["budget", "Budget"], ["resource", "Resource"], ["delay", "Delay Analysis"], ["forecast", "Forecast"], ["health", "Project Health"]];
            var reportsBar = "<div class='pmReportsBar'><span class='pmMuted'>Report:</span>" +
                "<select id='pmRptType' class='pmSelect'>" + RPT.map(function (r) { return "<option value='" + r[0] + "'>" + r[1] + "</option>"; }).join("") + "</select>" +
                "<button class='pmBtn ghost sm' onclick=\"window._projCtrl.onDownloadReport('xlsx')\">⬇ Excel</button>" +
                "<button class='pmBtn ghost sm' onclick=\"window._projCtrl.onDownloadReport('pdf')\">⬇ PDF</button></div>";

            return "<div class='pmPanel'>" + tiles + budgetBar + head + reportsBar +
                "<table class='pmTable pmMsTable'><thead><tr><th>Milestone</th><th>Status</th><th>Progress</th><th>Timeline</th><th>Cost / Budget</th><th>Res/Tasks</th>" +
                (canManage ? "<th></th>" : "<th></th>") + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
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
                    sequence: seqVal === "" ? null : parseInt(seqVal, 10)
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

        _renderRequirementsTab: function () {
            var r = this._requirements;
            if (!r) return "<div class='pmPanel'><div class='pmLoading'>Loading requirements…</div></div>";
            var canManage = !!r.canManage, reqs = r.requirements || [], that = this;
            var head = "<div class='pmPanelHead'>Resource Requirements <span class='pmCount'>" + reqs.length + "</span>" +
                (canManage ? " <button class='pmBtn primary sm' onclick=\"window._projCtrl.onAddRequirement()\">＋ Add Requirement</button>" : "") + "</div>";
            if (!reqs.length) {
                return "<div class='pmPanel'>" + head + "<div class='pmMuted'>No resource requirements defined yet." +
                    (canManage ? " Declare what the project needs (Department → Role → Specialization)." : "") + "</div></div>";
            }
            var rows = reqs.map(function (x) {
                var hier = [x.departmentName, x.roleCategoryName, x.specializationName].filter(Boolean).map(esc).join(" › ");
                var window = (x.startDate || "—") + " → " + (x.endDate || "—");
                return "<tr><td><b>" + hier + "</b>" + (x.notes ? "<div class='pmMuted' style='font-size:0.72rem'>" + esc(x.notes) + "</div>" : "") + "</td>" +
                    "<td style='text-align:center'><b>" + (x.requiredCount || 0) + "</b></td>" +
                    "<td style='text-align:center'>" + (x.requiredHours || 0) + " h</td>" +
                    "<td>" + esc(window) + "</td>" +
                    "<td>" + that._statusChip(x.status || "Open") + "</td>" +
                    (canManage ? "<td><button class='pmLink danger' onclick=\"window._projCtrl.onDeleteRequirement('" + esc(x.requirementId) + "')\">Remove</button></td>" : "<td></td>") + "</tr>";
            }).join("");
            return "<div class='pmPanel'>" + head +
                "<table class='pmTable'><thead><tr><th>Department › Role › Specialization</th><th>Count</th><th>Hours</th><th>Window</th><th>Status</th><th></th></tr></thead><tbody>" +
                rows + "</tbody></table></div>";
        },

        onAddRequirement: function () {
            var that = this, pid = this._detail.project.projectId;
            var hier = this._resHier || { departments: [] };
            var depts = hier.departments || [];
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            var deptOpts = "<option value=''>— Select department —</option>" + depts.map(function (d) { return "<option value='" + esc(d.deptId) + "'>" + esc(d.name) + "</option>"; }).join("");
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Add Resource Requirement</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Department *</label><select class='pmFInput' id='rqDept'>" + deptOpts + "</select>" +
                "<label class='pmFLbl'>Role Category</label><select class='pmFInput' id='rqRole'><option value=''>— Any —</option></select>" +
                "<label class='pmFLbl'>Specialization</label><select class='pmFInput' id='rqSpec'><option value=''>— Any —</option></select>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Required Count</label><input type='number' min='1' step='1' class='pmFInput' id='rqCount' value='1'/></div>" +
                "<div><label class='pmFLbl'>Required Hours</label><input type='number' min='0' step='1' class='pmFInput' id='rqHours' value='0'/></div></div>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>Start Date</label><input type='date' class='pmFInput' id='rqStart'/></div>" +
                "<div><label class='pmFLbl'>End Date</label><input type='date' class='pmFInput' id='rqEnd'/></div></div>" +
                "<label class='pmFLbl'>Notes</label><textarea class='pmFInput' id='rqNotes' rows='2'></textarea>" +
                "<div class='pmErr' id='rqErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Add</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#pmCancel").addEventListener("click", close);
            // Cascading population.
            var roleSel = ov.querySelector("#rqRole"), specSel = ov.querySelector("#rqSpec");
            var curRoles = [];
            ov.querySelector("#rqDept").addEventListener("change", function () {
                var dept = depts.find(function (d) { return d.deptId === this.value; }.bind(this));
                curRoles = (dept && dept.roles) || [];
                roleSel.innerHTML = "<option value=''>— Any —</option>" + curRoles.map(function (r) { return "<option value='" + esc(r.roleId) + "'>" + esc(r.name) + "</option>"; }).join("");
                specSel.innerHTML = "<option value=''>— Any —</option>";
            });
            roleSel.addEventListener("change", function () {
                var role = curRoles.find(function (r) { return r.roleId === this.value; }.bind(this));
                var specs = (role && role.specializations) || [];
                specSel.innerHTML = "<option value=''>— Any —</option>" + specs.map(function (s) { return "<option value='" + esc(s.specId) + "'>" + esc(s.name) + "</option>"; }).join("");
            });
            ov.querySelector("#pmSave").addEventListener("click", function () {
                var btn = this, deptId = ov.querySelector("#rqDept").value;
                if (!deptId) { var e = ov.querySelector("#rqErr"); e.textContent = "⚠ Department is required."; e.style.display = "block"; return; }
                btn.disabled = true; btn.textContent = "Adding…";
                ppost("createResourceRequirement", {
                    projectId: pid, departmentId: deptId,
                    roleCategoryId: roleSel.value || null, specializationId: specSel.value || null,
                    requiredCount: parseInt(ov.querySelector("#rqCount").value, 10) || 1,
                    requiredHours: parseFloat(ov.querySelector("#rqHours").value) || 0,
                    startDate: ov.querySelector("#rqStart").value || null, endDate: ov.querySelector("#rqEnd").value || null,
                    notes: (ov.querySelector("#rqNotes").value || "").trim()
                }).then(function (res) {
                    btn.disabled = false; btn.textContent = "Add";
                    if (res && res.error) { var e = ov.querySelector("#rqErr"); e.textContent = "⚠ " + res.error; e.style.display = "block"; return; }
                    close(); MessageToast.show("Requirement added."); that._loadRequirements();
                }).catch(function () { btn.disabled = false; btn.textContent = "Add"; var e = ov.querySelector("#rqErr"); e.textContent = "⚠ Could not add requirement."; e.style.display = "block"; });
            });
        },

        onDeleteRequirement: function (requirementId) {
            var that = this;
            ppost("deleteResourceRequirement", { requirementId: requirementId }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Requirement removed."); that._loadRequirements();
            }).catch(function () { MessageToast.show("Could not remove the requirement."); });
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
                    MessageToast.show("Resource deallocated."); that._open(pid);
                }).catch(function () { close(); MessageToast.show("Could not deallocate."); });
            });
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
            var msList = (this._detail.milestones || []);
            if (!msList.length) { MessageToast.show("Add project milestones first — hours are allocated against a milestone."); return; }
            ppost("getAllocatableEmployees", { projectId: pid }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                // Flatten employees whether grouped by department or a flat list.
                var emps = [];
                if (d.departments && d.departments.length) d.departments.forEach(function (g) { (g.employees || []).forEach(function (e) { emps.push(e); }); });
                else if (d.employees) emps = d.employees;
                emps.sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
                if (!emps.length) { MessageToast.show("No allocatable employees found."); return; }

                var empOpts = emps.map(function (e) { return "<option value='" + esc(e.employeeId) + "'>" + esc(e.employeeName) + " · " + esc(e.department || e.specializationName || "") + "</option>"; }).join("");
                var msOpts = msList.map(function (m) {
                    var win = (m.plannedStartDate || m.startDate || "") + " → " + (m.plannedEndDate || m.endDate || "");
                    return "<option value='" + esc(m.milestoneId) + "' data-win='" + esc(win) + "'>#" + (m.sequence || 0) + " " + esc(m.name) + "</option>";
                }).join("");

                var ov = document.createElement("div"); ov.className = "pmOverlay";
                ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Allocate Resource by Hours</div>" +
                    "<div class='pmDialogBody'>" +
                    "<label class='pmLbl'>Employee</label><select id='amEmp' class='pmSelect wide'>" + empOpts + "</select>" +
                    "<label class='pmLbl'>Milestone</label><select id='amMs' class='pmSelect wide'>" + msOpts + "</select>" +
                    "<div class='pmMuted' id='amWin' style='margin:2px 0 8px'></div>" +
                    "<label class='pmLbl'>Estimated Hours</label><input id='amHrs' type='number' min='1' step='1' class='pmInput' placeholder='e.g. 60'/>" +
                    "<label class='pmLbl'>Allocation Type</label>" +
                    "<div class='amTypeRow'><label class='amRadio'><input type='radio' name='amType' value='Hard' checked/> Hard <span class='pmMuted'>(confirmed, consumes capacity)</span></label>" +
                    "<label class='amRadio'><input type='radio' name='amType' value='Soft'/> Soft <span class='pmMuted'>(tentative reservation)</span></label></div>" +
                    "<div id='amPreview' class='amPreview'></div>" +
                    "<div id='amErr' class='pmErr' style='display:none'></div>" +
                    "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='pmCancel'>Cancel</button><button class='pmBtn primary' id='pmSave'>Allocate</button></div></div>";
                document.body.appendChild(ov);
                var close = function () { ov.remove(); };
                var $ = function (s) { return ov.querySelector(s); };
                var showWin = function () { var o = $("#amMs").selectedOptions[0]; $("#amWin").textContent = o ? ("Window: " + o.getAttribute("data-win")) : ""; };
                $("#amMs").addEventListener("change", showWin); showWin();
                ov.querySelector("#pmCancel").addEventListener("click", close);
                var save = function (force, reason) {
                    var employeeId = $("#amEmp").value, milestoneId = $("#amMs").value;
                    var hrs = parseFloat($("#amHrs").value) || 0;
                    var type = (ov.querySelector("input[name='amType']:checked") || {}).value || "Hard";
                    var err = $("#amErr");
                    if (hrs <= 0) { err.style.display = "block"; err.textContent = "Enter estimated hours greater than 0."; return; }
                    var btn = ov.querySelector("#pmSave"); btn.disabled = true; btn.textContent = "Allocating…";
                    ppost("allocateResourceToMilestone", { projectId: pid, employeeId: employeeId, milestoneId: milestoneId, estimatedHours: hrs, allocationType: type, force: !!force, overrideReason: reason || "" })
                        .then(function (res) {
                            btn.disabled = false; btn.textContent = "Allocate";
                            // Capacity or budget over-allocation → confirm with an override reason.
                            if (res && (res.overallocation || res.budgetOverrun)) {
                                var r = window.prompt(res.error + "\n\nEnter an override reason to proceed (or Cancel):", "");
                                if (r) save(true, r);
                                return;
                            }
                            if (res && res.error) { err.style.display = "block"; err.textContent = res.error; return; }
                            close();
                            var costMsg = (res && res.cost) ? (" · Cost ₹" + Number(res.cost).toLocaleString("en-IN") + " · Remaining ₹" + Number(res.remainingBudget || 0).toLocaleString("en-IN")) : "";
                            MessageToast.show("Allocated " + hrs + "h. Monthly plan generated." + costMsg);
                            that._open(pid);
                        }).catch(function () { btn.disabled = false; btn.textContent = "Allocate"; err.style.display = "block"; err.textContent = "Could not allocate — please try again."; });
                };
                ov.querySelector("#pmSave").addEventListener("click", function () { save(false, ""); });
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
