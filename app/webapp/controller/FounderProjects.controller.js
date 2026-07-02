sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage",
    "timesheet/app/util/ProjectChat"
], function (Controller, FounderSidebar, FP, ProjectChat) {
    "use strict";

    // POST to a /project action and parse the LargeString JSON result.
    function ppost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    var esc = function (s) { return FP.esc(s); };
    var STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
    var PRIORITIES = ["Low", "Medium", "High", "Critical"];
    var BANDWIDTHS = [25, 50, 75, 100];
    var TASK_STATUSES = ["Not Started", "In Progress", "In Review", "Completed"];

    // Lifecycle stage → display label + step index (0-based out of 4)
    var LIFECYCLE_STEPS = [
        { key: "Planning",         label: "Project Created",       icon: "🏗" },
        { key: "MeetingScheduled", label: "Meeting Scheduled",     icon: "📅" },
        { key: "MeetingCompleted", label: "Meeting Completed",     icon: "✅" },
        { key: "BudgetAllocated",  label: "Budget Allocated",      icon: "💰" },
        { key: "Active",           label: "Active",                icon: "🚀" }
    ];
    function lifecycleIdx(stage) {
        var s = stage || "Planning";
        if (s === "Active" || s === "On Hold" || s === "Completed" || s === "Cancelled") return 4;
        var found = LIFECYCLE_STEPS.findIndex(function (x) { return x.key === s; });
        return found === -1 ? 0 : found;
    }

    // DEPT_ROWS for budget allocation modal
    // ── Client master reference data ─────────────────────────────────────────
    var CLIENT_TYPES = ["Enterprise", "SMB", "Startup", "Individual", "Internal"];
    var CLIENT_STATUSES = ["Prospect", "Active", "Inactive", "Blacklisted"];
    var CREATE_STATUSES = ["Prospect", "Active"];
    var INDUSTRIES = ["Information Technology", "Software / SaaS", "Banking & Financial Services", "Insurance",
        "Manufacturing", "Retail & E-commerce", "Healthcare & Life Sciences", "Pharmaceuticals",
        "Telecommunications", "Media & Entertainment", "Education", "Government & Public Sector",
        "Energy & Utilities", "Oil & Gas", "Automotive", "Aerospace & Defense", "Construction & Real Estate",
        "Logistics & Supply Chain", "Travel & Hospitality", "Agriculture", "Consulting & Professional Services",
        "Non-Profit", "Legal", "Other"];
    // { n: name, d: dial code, zones: [IANA time zones] }. Multi-zone countries list
    // every zone so the timezone dropdown can offer the full set.
    var COUNTRIES = [
        { n: "India", d: "+91", zones: ["Asia/Kolkata"] },
        { n: "United States", d: "+1", zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] },
        { n: "United Kingdom", d: "+44", zones: ["Europe/London"] },
        { n: "Canada", d: "+1", zones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver", "America/Halifax", "America/St_Johns"] },
        { n: "Australia", d: "+61", zones: ["Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Australia/Darwin"] },
        { n: "Germany", d: "+49", zones: ["Europe/Berlin"] }, { n: "France", d: "+33", zones: ["Europe/Paris"] },
        { n: "Netherlands", d: "+31", zones: ["Europe/Amsterdam"] }, { n: "Ireland", d: "+353", zones: ["Europe/Dublin"] },
        { n: "Spain", d: "+34", zones: ["Europe/Madrid", "Atlantic/Canary"] }, { n: "Italy", d: "+39", zones: ["Europe/Rome"] },
        { n: "Switzerland", d: "+41", zones: ["Europe/Zurich"] }, { n: "Sweden", d: "+46", zones: ["Europe/Stockholm"] },
        { n: "Norway", d: "+47", zones: ["Europe/Oslo"] }, { n: "Denmark", d: "+45", zones: ["Europe/Copenhagen"] },
        { n: "Belgium", d: "+32", zones: ["Europe/Brussels"] }, { n: "Poland", d: "+48", zones: ["Europe/Warsaw"] },
        { n: "Portugal", d: "+351", zones: ["Europe/Lisbon", "Atlantic/Azores"] }, { n: "United Arab Emirates", d: "+971", zones: ["Asia/Dubai"] },
        { n: "Saudi Arabia", d: "+966", zones: ["Asia/Riyadh"] }, { n: "Qatar", d: "+974", zones: ["Asia/Qatar"] },
        { n: "Singapore", d: "+65", zones: ["Asia/Singapore"] }, { n: "Malaysia", d: "+60", zones: ["Asia/Kuala_Lumpur"] },
        { n: "Japan", d: "+81", zones: ["Asia/Tokyo"] }, { n: "China", d: "+86", zones: ["Asia/Shanghai"] },
        { n: "Hong Kong", d: "+852", zones: ["Asia/Hong_Kong"] }, { n: "South Korea", d: "+82", zones: ["Asia/Seoul"] },
        { n: "Indonesia", d: "+62", zones: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] }, { n: "Philippines", d: "+63", zones: ["Asia/Manila"] },
        { n: "Thailand", d: "+66", zones: ["Asia/Bangkok"] }, { n: "Vietnam", d: "+84", zones: ["Asia/Ho_Chi_Minh"] },
        { n: "New Zealand", d: "+64", zones: ["Pacific/Auckland"] }, { n: "South Africa", d: "+27", zones: ["Africa/Johannesburg"] },
        { n: "Nigeria", d: "+234", zones: ["Africa/Lagos"] }, { n: "Kenya", d: "+254", zones: ["Africa/Nairobi"] },
        { n: "Egypt", d: "+20", zones: ["Africa/Cairo"] }, { n: "Brazil", d: "+55", zones: ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza"] },
        { n: "Mexico", d: "+52", zones: ["America/Mexico_City", "America/Cancun", "America/Tijuana"] },
        { n: "Argentina", d: "+54", zones: ["America/Argentina/Buenos_Aires"] }, { n: "Chile", d: "+56", zones: ["America/Santiago"] },
        { n: "Colombia", d: "+57", zones: ["America/Bogota"] }, { n: "Israel", d: "+972", zones: ["Asia/Jerusalem"] },
        { n: "Turkey", d: "+90", zones: ["Europe/Istanbul"] }, { n: "Russia", d: "+7", zones: ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Vladivostok"] },
        { n: "Pakistan", d: "+92", zones: ["Asia/Karachi"] }, { n: "Bangladesh", d: "+880", zones: ["Asia/Dhaka"] },
        { n: "Sri Lanka", d: "+94", zones: ["Asia/Colombo"] }, { n: "Nepal", d: "+977", zones: ["Asia/Kathmandu"] },
        { n: "Austria", d: "+43", zones: ["Europe/Vienna"] }, { n: "Finland", d: "+358", zones: ["Europe/Helsinki"] }
    ];

    // Country lookup by name.
    var countryByName = function (n) { return COUNTRIES.find(function (c) { return c.n === n; }); };

    // Cache computed GMT labels so we don't recompute per render/keypress.
    var _gmtCache = {};
    // "Asia/Kolkata" → "GMT+05:30 (Asia/Kolkata)" using the browser's own tz database.
    function gmtLabel(tz) {
        if (!tz) return "";
        if (_gmtCache[tz]) return _gmtCache[tz];
        var off = "GMT";
        try {
            var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
            var raw = (parts.find(function (p) { return p.type === "timeZoneName"; }) || {}).value || "GMT";
            var m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(raw);
            off = m ? "GMT" + m[1] + ("0" + m[2]).slice(-2) + ":" + (m[3] || "00") : (raw === "GMT" ? "GMT+00:00" : raw);
        } catch (e) { off = "GMT"; }
        var label = off + " (" + tz + ")";
        _gmtCache[tz] = label;
        return label;
    }
    // Timezone combo options for a country.
    function tzOptionsFor(name) {
        var c = countryByName(name);
        return (c ? c.zones : []).map(function (tz) { return { value: tz, label: gmtLabel(tz) }; });
    }

    // ── Custom searchable dropdown (type-ahead) ──────────────────────────────
    // Upgrades a placeholder <div class="fpCombo" id="…"> inside `root` into a
    // theme-matched combobox. `options` = [{ value, label }]. Exposes the API on
    // el._combo: { value, set(v), input, focus() }. cfg: { placeholder, onChange }.
    function initCombo(root, sel, options, cfg) {
        cfg = cfg || {};
        var host = root.querySelector(sel);
        if (!host) return null;
        host.classList.add("fpCombo");
        var input = document.createElement("input");
        input.className = "fpInput fpComboInput";
        input.setAttribute("autocomplete", "off");
        input.placeholder = cfg.placeholder || "Search…";
        var caret = document.createElement("span");
        caret.className = "fpComboCaret";
        caret.textContent = "▾";
        var panel = document.createElement("div");
        panel.className = "fpComboPanel";
        panel.style.display = "none";
        host.appendChild(input);
        host.appendChild(caret);
        host.appendChild(panel);
        var value = "";
        var displayOf = function (v) { var o = options.find(function (x) { return x.value === v; }); return o ? o.label : (v || ""); };
        var render = function (filter) {
            var f = (filter || "").trim().toLowerCase();
            var items = options.filter(function (o) { return !f || o.label.toLowerCase().indexOf(f) >= 0; }).slice(0, 80);
            panel.innerHTML = items.length
                ? items.map(function (o) { return "<div class='fpComboItem" + (o.value === value ? " sel" : "") + "' data-v='" + esc(o.value) + "'>" + esc(o.label) + "</div>"; }).join("")
                : "<div class='fpComboEmpty'>No matches</div>";
        };
        var open = function (all) { render(all ? "" : input.value); panel.style.display = "block"; host.classList.add("open"); };
        var close = function () { panel.style.display = "none"; host.classList.remove("open"); };
        input.addEventListener("focus", function () { open(true); });
        caret.addEventListener("mousedown", function (e) { e.preventDefault(); if (panel.style.display === "block") { close(); } else { input.focus(); open(true); } });
        input.addEventListener("input", function () { value = ""; open(false); if (cfg.onInput) cfg.onInput(input.value); });
        input.addEventListener("blur", function () { setTimeout(close, 160); });
        panel.addEventListener("mousedown", function (e) {
            var it = e.target.closest(".fpComboItem"); if (!it) return;
            e.preventDefault();
            value = it.getAttribute("data-v");
            input.value = displayOf(value);
            close();
            if (cfg.onChange) cfg.onChange(value);
        });
        var api = {
            get value() { return value; },
            set: function (v) { value = v || ""; input.value = displayOf(value); },
            // Swap the option list (e.g. timezones after a country change). Clears the
            // current selection if it is no longer valid.
            setOptions: function (opts, keepValue) {
                options = opts || [];
                if (!keepValue || !options.some(function (o) { return o.value === value; })) { value = ""; input.value = ""; }
                else input.value = displayOf(value);
            },
            input: input,
            focus: function () { input.focus(); }
        };
        host._combo = api;
        return api;
    }

    var DEPT_ROWS = ["Engineering", "Executive", "Finance", "Human Resources", "Management", "Sales"];
    var OTHER_ROWS = ["External Services", "Licensing", "Hardware", "Travel", "Training", "Contingency Reserve", "Miscellaneous"];
    // The 7 standard cost categories — Execution Budget is allocated across these.
    var RESOURCE_CATEGORIES = ["Resource Cost", "Infrastructure Cost", "Licensing Cost", "Vendor Cost", "Travel Cost", "Training Cost", "Miscellaneous Cost"];
    var INR = function (n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); };
    // Warning colour ramp by utilization %: <80 green · 80–89 yellow · 90–99 orange · ≥100 / over red.
    function budgetWarnColor(pct, over) { if (over || pct > 100) return "#fb7185"; if (pct >= 90) return "#fb923c"; if (pct >= 80) return "#fbbf24"; return "#34d399"; }

    return Controller.extend("timesheet.app.controller.FounderProjects", {
        onInit: function () {
            window._fpProj = this;
            this._filter = "planning";   // persists across detail open/back within the session
            this.getOwnerComponent().getRouter().getRoute("founder-projects").attachPatternMatched(this._onMatched, this);
        },
        // Map a project status to one of the four filter groups (Cancelled excluded).
        _group: function (s) {
            return s === "Planning" ? "planning" : s === "On Hold" ? "onhold" : s === "Completed" ? "completed" : s === "Active" ? "ongoing" : "other";
        },
        onFilter: function (v) { this._filter = v; this._render(); },
        onExit: function () { if (window._fpProj === this) window._fpProj = null; },
        _onMatched: function () {
            FounderSidebar.attach(this); FP.shell.attach(this);
            this._view = "list"; this._detail = null;
            this._load();
        },
        _host: function () { return this.byId("founderHost"); },

        // ── Data ────────────────────────────────────────────────────────────────
        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='fdRoot'>" + FP.header("Projects", "Project command center") +
                "<div class='fdWrap'><div class='fdLoading'>Loading projects…</div></div></div>");
            Promise.all([
                ppost("getProjectDashboard", {}).catch(function () { return {}; }),
                ppost("getProjects", {}).catch(function () { return { projects: [] }; }),
                ppost("getFounderFinancials", {}).catch(function () { return {}; })
            ]).then(function (res) { that._dash = res[0] || {}; that._data = res[1] || { projects: [] }; that._fin = (res[2] && !res[2].error) ? res[2] : null; that._view = "list"; that._render(); });
        },
        _openProject: function (projectId) {
            var that = this;
            // Management data (resources/tasks/actions) + executive analytics in parallel.
            Promise.all([
                ppost("getProjectDetail", { projectId: projectId }),
                ppost("getProjectExecutive", { projectId: projectId }).catch(function () { return {}; }),
                ppost("getProjectBudgetAnalysis", { projectId: projectId }).catch(function () { return {}; }),
                ppost("getProjectHealth", { projectId: projectId }).catch(function () { return {}; })
            ]).then(function (r) {
                var d = r[0] || {}, x = r[1] || {};
                if (d && d.error) { FP.toast(d.error, false); return; }
                that._detail = d; that._exec = x; that._budget = (r[2] && !r[2].error) ? r[2] : null;
                that._health = (r[3] && !r[3].error && !r[3].planning) ? r[3] : null;
                that._deptOpen = {}; that._view = "detail"; that._meetings = null; that._projReqs = null;
                // Load meetings + requirements in parallel then re-render.
                ppost("getProjectMeetings", { projectId: projectId }).then(function (m) {
                    that._meetings = (m && !m.error) ? m : { meetings: [] };
                }).catch(function () { that._meetings = { meetings: [] }; }).finally(function () { that._render(); });
                ppost("getProjectRequirements", { projectId: projectId }).then(function (rq) {
                    that._projReqs = (rq && !rq.error) ? rq : { requirements: [] };
                }).catch(function () { that._projReqs = { requirements: [] }; }).finally(function () { that._render(); });
                that._render(); // render immediately (sections fill in as loads complete)
            }).catch(function () { FP.toast("Could not open the project.", false); });
        },

        // ── Render ──────────────────────────────────────────────────────────────
        _render: function () {
            var h = this._host(); if (!h) return;
            if (this._view === "detail" && this._detail) { h.setContent(this._renderDetail()); return; }
            var list = (this._data && this._data.projects) || [];
            var head = FP.header("Projects", "Project portfolio — view & open a project");
            var self = this;

            // Modern segmented status selector (no summary tiles). Counts per group.
            var counts = { planning: 0, ongoing: 0, onhold: 0, completed: 0 };
            list.forEach(function (p) { var g = self._group(p.status); if (counts[g] !== undefined) counts[g]++; });
            var FILTERS = [
                { key: "planning", label: "Planning" },
                { key: "ongoing", label: "Ongoing" },
                { key: "onhold", label: "On Hold" },
                { key: "completed", label: "Completed" }
            ];
            var segs = FILTERS.map(function (f) {
                return "<button class='fpSeg" + (self._filter === f.key ? " active" : "") + "' onclick=\"window._fpProj.onFilter('" + f.key + "')\">" +
                    "<span class='fpSegIco'>" + f.icon + "</span>" + f.label +
                    "<span class='fpSegCount'>" + counts[f.key] + "</span></button>";
            }).join("");
            var filterBar = "<div class='fpFilterBar'>" +
                "<div class='fpSegGroup'><span class='fpSegTitle'>📋 Project Status</span>" + segs + "</div>" +
                "<div style='display:flex;gap:8px'>" +
                "<button class='faBtn approve' onclick=\"window._fpProj.onCreateProject()\">＋ Create Project</button></div></div>";

            var filtered = list.filter(function (p) { return self._group(p.status) === self._filter; });
            var labelMap = { planning: "planning", ongoing: "ongoing", onhold: "on-hold", completed: "completed" };
            var cards = filtered.length ? filtered.map(this._projCard.bind(this)).join("")
                : "<div class='faEmpty fdGlass'>No " + (labelMap[this._filter] || "") + " projects.</div>";

            // Portfolio Financials rollup now lives on the dedicated Portfolio
            // Analysis dashboard — the Projects screen stays a clean project list.
            h.setContent(FP.wrap(head, filterBar + "<div class='fpProjGrid'>" + cards + "</div>"));
        },
        // Founder Financial Dashboard — portfolio rollup + collapsible per-project table.
        _portfolioFinancials: function () {
            var f = this._fin;
            if (!f || !f.portfolio || !(f.projects || []).length) return "";
            var p = f.portfolio, money = this._money.bind(this);
            var varCol = function (n) { return Number(n) >= 0 ? "#34d399" : "#fb7185"; };
            var card = function (lbl, val, col, sub) {
                return "<div class='fpFcCard'><div class='lbl'>" + lbl + "</div><div class='val'" + (col ? " style='color:" + col + "'" : "") + ">" + val + "</div>" + (sub ? "<div class='sub'>" + sub + "</div>" : "") + "</div>";
            };
            var cards = "<div class='fpFcGrid'>" +
                card("Contract Value", money(p.contractValue)) +
                card("Profit Reserve", money(p.profitReserve)) +
                card("Execution Budget", money(p.executionBudget)) +
                card("Current Spend", money(p.currentSpend)) +
                card("Forecasted Spend", money(p.forecastedSpend)) +
                card("Expected Profit", money(p.expectedProfit)) +
                card("Projected Profit", money(p.projectedProfit), varCol(p.projectedProfit - p.expectedProfit)) +
                card("Projected Margin", p.projectedMarginPct + "%", null, "expected " + p.expectedMarginPct + "%") +
                card("Budget Variance", money(p.budgetVariance), varCol(p.budgetVariance)) +
                card("Profit Variance", money(p.profitVariance), varCol(p.profitVariance)) +
                "</div>";
            var rows = (f.projects || []).map(function (r) {
                return "<tr style='cursor:pointer' onclick=\"window._fpProj.onOpen('" + esc(r.projectId) + "')\">" +
                    "<td><b style='color:#e6edf8'>" + esc(r.projectName) + "</b> <span class='fpTypePill'>" + esc(r.projectTypeName) + "</span></td>" +
                    "<td style='color:#9fb0d6'>" + money(r.contractValue) + "</td>" +
                    "<td style='color:#9fb0d6'>" + money(r.executionBudget) + "</td>" +
                    "<td style='color:#9fb0d6'>" + money(r.currentSpend) + "</td>" +
                    "<td style='color:#9fb0d6'>" + money(r.forecastedSpend) + "</td>" +
                    "<td style='color:" + ((r.projectedMarginPct >= r.expectedMarginPct) ? "#34d399" : "#fb7185") + ";font-weight:700'>" + r.projectedMarginPct + "%</td>" +
                    "<td style='color:" + varCol(r.budgetVariance) + ";font-weight:700'>" + money(r.budgetVariance) + "</td></tr>";
            }).join("");
            var table = "<table class='fpTable'><thead><tr><th>Project</th><th>Contract</th><th>Execution</th><th>Spend</th><th>Forecast</th><th>Margin</th><th>Budget Var.</th></tr></thead><tbody>" + rows + "</tbody></table>";
            return "<div class='fdCard fdGlass' style='display:block;margin-bottom:14px'>" +
                "<div class='fdCardTitle'>💰 Portfolio Financials <span class='fpViewOnly'>Founder</span></div>" + cards +
                "<div class='fpFcTableWrap'>" + table + "</div></div>";
        },
        _tile: function (ico, col, val, label) {
            return "<div class='faSumTile fdGlass'><div class='faSumIco' style='background:" + col + "22;color:" + col + "'>" + ico + "</div>" +
                "<div><div class='faSumVal'>" + val + "</div><div class='faSumLbl'>" + esc(label) + "</div></div></div>";
        },
        _statusPill: function (s) {
            var cls = (s === "Completed") ? "ok" : (s === "Cancelled" || s === "On Hold") ? "warn" : "info";
            return "<span class='fdPillStatus " + cls + "'>" + esc(s) + "</span>";
        },
        _bar: function (pct) {
            return "<div class='fpBar'><div class='fpBarFill' style='width:" + (pct || 0) + "%'></div></div>" +
                "<div class='fpBarLbl'>" + (pct || 0) + "% complete</div>";
        },
        _projCard: function (p) {
            var budget = (p.budgetAllocated > 0) ? (p.budgetPct + "%") : "—";
            var budgetCol = p.budgetPct > 100 ? "#fb7185" : p.budgetPct > 90 ? "#fbbf24" : "#34d399";
            // For Planning-status cards, show lifecycle stage badge instead of budget.
            var lcBadge = "";
            if (p.status === "Planning") {
                var idx = lifecycleIdx(p.lifecycleStage);
                var step = LIFECYCLE_STEPS[idx] || LIFECYCLE_STEPS[0];
                lcBadge = "<div class='fpLcBadge'>" + step.icon + " " + esc(step.label) + "</div>";
            }
            return "<div class='fpPCard' onclick=\"window._fpProj.onOpen('" + esc(p.projectId) + "')\">" +
                "<div class='fpPCardTop'><div class='fpPCardHead'><div class='fpPCardName'>" + esc(p.projectName) + "</div>" +
                "<div class='fpPCardCo'>🏢 " + esc(p.customerName || "—") + "</div></div>" + this._statusPill(p.status) + "</div>" +
                lcBadge +
                "<div class='fpPCardMgr'><span class='fpPCardAv'>" + esc(this._ini(p.pocName)) + "</span>" +
                "<span class='fpPCardMgrTxt'>" + esc(p.pocName || "Unassigned") + "<small>Project Manager</small></span></div>" +
                this._bar(p.progress) +
                "<div class='fpPCardStats'>" +
                "<div><span>Budget Used</span><b style='color:" + budgetCol + "'>" + budget + "</b></div>" +
                "<div><span>Start</span><b>" + esc(p.startDate || "—") + "</b></div>" +
                "<div><span>End</span><b>" + esc(p.endDate || "—") + "</b></div>" +
                "</div></div>";
        },
        _ini: function (name) {
            return String(name || "?").trim().split(/\s+/).map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase() || "?";
        },

        // ── Lifecycle tracker (5-step progress stepper) ──────────────────────────
        _lifecycleTracker: function (stage, status) {
            if (status !== "Planning") return ""; // only show for planning projects
            var idx = lifecycleIdx(stage);
            var steps = LIFECYCLE_STEPS.map(function (s, i) {
                var cls = i < idx ? "done" : i === idx ? "active" : "pending";
                return "<div class='fpLcStep " + cls + "'>" +
                    "<div class='fpLcDot'>" + (i < idx ? "✓" : s.icon) + "</div>" +
                    "<div class='fpLcLbl'>" + esc(s.label) + "</div>" +
                    (i < LIFECYCLE_STEPS.length - 1 ? "<div class='fpLcLine'></div>" : "") +
                    "</div>";
            }).join("");
            return "<div class='fdCard fdGlass fpLcTrack' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>Project Lifecycle Progress</div>" +
                "<div class='fpLcSteps'>" + steps + "</div></div>";
        },

        // ── Lifecycle action card (shows next required action for Founder) ────────
        _lifecycleActionCard: function (p, mtgData) {
            var stage = p.lifecycleStage || "Planning";
            var status = p.status;
            if (status !== "Planning") return ""; // active/completed projects need no governance card

            if (stage === "Planning") {
                return "<div class='fdCard fdGlass fpLcAction' style='display:block;margin-top:14px'>" +
                    "<div class='fpLcActionIcon'>📅</div>" +
                    "<div class='fpLcActionTitle'>Schedule Planning Meeting</div>" +
                    "<div class='fpLcActionDesc'>Before this project can progress, schedule a planning meeting with the POC and key managers to align on scope, timeline, and expectations.</div>" +
                    "<button class='faBtn approve' onclick=\"window._fpProj.onFpSchedulePlanningMtg()\">📅 Schedule Planning Meeting</button></div>";
            }
            if (stage === "MeetingScheduled") {
                // Find the planning meeting in loaded meetings
                var mtgs = (mtgData && mtgData.meetings) || [];
                var planMtg = mtgs.find(function (m) { return m.meetingId === p.planningMeetingId; }) || {};
                var joinBtn = planMtg.teamsJoinUrl
                    ? "<a href='" + esc(planMtg.teamsJoinUrl) + "' target='_blank' style='display:inline-block;padding:8px 18px;background:#5b5fc7;color:#fff;border-radius:8px;font-size:0.86rem;font-weight:600;text-decoration:none;margin-right:8px'>Join Meeting</a>" : "";
                return "<div class='fdCard fdGlass fpLcAction scheduled' style='display:block;margin-top:14px'>" +
                    "<div class='fpLcActionIcon'>📅</div>" +
                    "<div class='fpLcActionTitle'>Planning Meeting Scheduled</div>" +
                    "<div class='fpLcActionDesc'>The planning meeting <b>" + esc(planMtg.title || "") + "</b> is scheduled for " + esc(planMtg.dateLabel || "") + " at " + esc(planMtg.timeLabel || "") + ". Once the meeting is done, mark it as completed to proceed to budget allocation.</div>" +
                    "<div style='margin-top:12px;display:flex;gap:8px;flex-wrap:wrap'>" + joinBtn +
                    "<button class='faBtn approve' onclick=\"window._fpProj.onFpMarkMeetingCompleted('" + esc(p.planningMeetingId) + "')\">✅ Mark Meeting Completed</button></div></div>";
            }
            if (stage === "MeetingCompleted") {
                return "<div class='fdCard fdGlass fpLcAction completed' style='display:block;margin-top:14px'>" +
                    "<div class='fpLcActionIcon'>💰</div>" +
                    "<div class='fpLcActionTitle'>Allocate Project Budget</div>" +
                    "<div class='fpLcActionDesc'>The planning meeting is complete. Now allocate the total project budget with department-wise and other category breakdowns. The POC will be notified to begin resource allocation once the budget is set.</div>" +
                    "<button class='faBtn approve' onclick=\"window._fpProj.onFpAllocateBudget()\">💰 Allocate Budget</button></div>";
            }
            if (stage === "BudgetAllocated") {
                return "<div class='fdCard fdGlass fpLcAction budget' style='display:block;margin-top:14px'>" +
                    "<div class='fpLcActionIcon'>🏗</div>" +
                    "<div class='fpLcActionTitle'>Awaiting Resource Allocation</div>" +
                    "<div class='fpLcActionDesc'>Budget has been allocated and the POC has been notified. The project will automatically become <b>Active</b> once the POC allocates the first resource.</div>" +
                    "<button class='faBtn ghost' onclick=\"window._fpProj.onFpAllocateBudget()\">📊 View / Edit Budget</button></div>";
            }
            return "";
        },

        // ── Detail view ───────────────────────────────────────────────────────────
        _renderDetail: function () {
            var d = this._detail, p = d.project || {};
            var head = FP.header("Project · " + (p.projectName || ""), p.customerName || "");
            var back = "<button class='faBtn ghost' onclick=\"window._fpProj.onBack()\">← Back to projects</button>";

            var statusSel = d.canManage
                ? "<select class='fpSelect' onchange=\"window._fpProj.onSetStatus(this.value)\">" +
                    STATUSES.map(function (s) { return "<option value='" + s + "'" + (s === p.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>"
                : this._statusPill(p.status);

            var x = this._exec || {};
            // Project Dashboard (execution metrics/analytics) stays hidden until the
            // project leaves Planning and becomes Active. Backend mirrors this guard
            // (getProjectExecutive returns { planning:true } during Planning).
            var isPlanning = (p.status === "Planning") || x.planning === true;
            var badge = x.badge || p.status;
            var prog = (x.progress != null) ? x.progress : d.progress;
            var money = this._money.bind(this);
            var finStrip = (Number(p.contractValue) > 0)
                ? "<div class='fpFinStrip'>" +
                    "<div class='fpFinCard'><div class='lbl'>Contract Value</div><div class='val'>" + money(p.contractValue) + "</div></div>" +
                    "<div class='fpFinCard'><div class='lbl'>Profit Reserve (" + (Number(p.profitMarginPct) || 0) + "%)</div><div class='val'>" + money(p.profitReserveAmount) + "</div></div>" +
                    "<div class='fpFinCard exec'><div class='lbl'>Execution Budget</div><div class='val'>" + money(p.executionBudget) + "</div></div>" +
                    "</div>"
                : "";
            var execHeader = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fpExecHead'><div><div class='fpExecName'>" + esc(p.projectName) +
                (p.projectTypeName ? " <span class='fpTypePill'>" + esc(p.projectTypeName) + "</span>" : "") + "</div>" +
                "<div class='fpExecCust'>" + esc(p.customerName || "") + "</div></div>" +
                "<span class='fpBadge " + this._badgeClass(badge) + "'>" + esc(badge) + "</span></div>" +
                "<div class='fpInfoRow'><div><span>Status</span>" + statusSel + "</div>" +
                "<div><span>Priority</span><b>" + esc(p.priority) + "</b></div>" +
                "<div><span>Start</span><b>" + esc(p.startDate || "—") + "</b></div>" +
                "<div><span>Planned End</span><b>" + esc(p.endDate || "—") + "</b></div>" +
                "<div><span>Go-Live</span><b>" + esc((x.dates && x.dates.goLive) || "—") + "</b></div></div>" +
                finStrip +
                (p.description ? "<div class='fpDesc'>" + esc(p.description) + "</div>" : "") +
                (isPlanning ? "" : this._bar(prog)) + "</div>";
            // While Planning, the execution dashboard is suppressed entirely — the
            // lifecycle tracker + planning action card (below) drive this stage.
            var execBody = isPlanning ? "" : (
                this._healthCard(this._health) +
                this._aiCard(x.aiSummary, badge) +
                "<div class='fpExecGrid3'>" + this._budgetCard(x.budget) + this._managerCard(x.manager) + this._progressKpiCard(prog, x.taskStats) + "</div>" +
                "<div class='fpExecGrid2'>" + this._focusCard(x.focusAreas) + this._resourceSummaryCard(x.resourceSummary) + "</div>" +
                this._budgetAnalysisSection(this._budget) +
                this._issuesCard(x.issues, x.issueCounts, d.canManage || d.isPoc) +
                this._taskAnalyticsCard(x.taskStats) +
                this._effortCard(x.effort));

            // Resources — VIEW-ONLY for the Founder (allocation is a PM/Manager task).
            var resRows = (d.resources || []).map(function (r) {
                var u = r.utilizationPct || 0;
                var uc = u > 100 ? "#fb7185" : u >= 85 ? "#fbbf24" : "#34d399";
                var ovr = r.isOverridden ? " <span style='font-size:0.62rem;font-weight:700;color:#fb7185;background:rgba(251,113,133,0.15);padding:1px 6px;border-radius:6px'>Overridden</span>" : "";
                return "<tr><td>" + esc(r.employeeName) + " <b style='color:" + uc + "'>(" + u + "%)</b>" + ovr + "</td><td>" + esc(r.department) + "</td><td><b>" + r.bandwidth + "%</b></td></tr>";
            }).join("");
            var resBlock = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>Resources <span class='fpViewOnly'>view only</span></div>" +
                (resRows ? "<table class='fpTable'><thead><tr><th>Employee</th><th>Dept</th><th>Bandwidth</th></tr></thead><tbody>" + resRows + "</tbody></table>"
                    : "<div class='fdCardSub'>No resources allocated yet.</div>") + "</div>";

            // Tasks — VIEW-ONLY for the Founder (task assignment is a PM/Manager task).
            var taskRows = (d.tasks || []).map(function (t) {
                return "<tr><td><b>" + esc(t.taskName) + "</b><div class='fdCardSub'>" + esc(t.taskId) + "</div></td>" +
                    "<td>" + esc(t.assignedToName || "—") + "</td><td>" + esc(t.priority) + "</td>" +
                    "<td>" + (t.estimatedHours || 0) + "h / " + (t.actualHours || 0) + "h</td>" +
                    "<td>" + esc(t.status) + "</td></tr>";
            }).join("");
            var taskBlock = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>Project Tasks <span class='fpViewOnly'>view only</span></div>" +
                (taskRows ? "<table class='fpTable'><thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Est/Act</th><th>Status</th></tr></thead><tbody>" + taskRows + "</tbody></table>"
                    : "<div class='fdCardSub'>No tasks yet.</div>") + "</div>";

            var auditBtn = "<div style='margin-top:14px'><button class='faBtn ghost' onclick=\"window._fpProj.onAudit()\">🕓 View audit log</button></div>";

            // ── Meetings block ───────────────────────────────────────────────────
            var mtgData = this._meetings || { meetings: [] };
            var mtgRows = (mtgData.meetings || []).map(function (m) {
                var sc = m.status === "Cancelled" ? "#fb7185" : m.status === "Completed" ? "#34d399" : "#38bdf8";
                var joinBtn = (m.canJoin !== false && m.teamsJoinUrl && m.status === "Scheduled")
                    ? "<a href='" + esc(m.teamsJoinUrl) + "' target='_blank' style='padding:3px 10px;background:#5b5fc7;color:#fff;border-radius:6px;font-size:0.75rem;font-weight:600;text-decoration:none;'>Join</a>"
                    : (m.status === "Scheduled" ? "<span style='color:#9fb0d6;font-size:0.72rem'>View Details Only</span>" : "");
                var cxlBtn = m.status === "Scheduled"
                    ? "<button class='faBtn ghost' style='padding:3px 10px;font-size:0.75rem;' onclick=\"window._fpProj.onFpCancelMtg('" + esc(m.meetingId) + "','" + esc(m.title) + "')\">Cancel</button>" : "";
                return "<tr><td><b style='color:#e6edf8'>" + esc(m.title) + "</b></td>" +
                    "<td style='color:#9fb0d6'>" + esc(m.dateLabel) + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(m.timeLabel) + "</td>" +
                    "<td><span style='color:" + sc + ";font-weight:700;font-size:0.8rem'>" + esc(m.status) + "</span></td>" +
                    "<td>" + joinBtn + "</td><td>" + cxlBtn + "</td></tr>";
            }).join("");
            var mtgBlock = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle' style='display:flex;align-items:center;justify-content:space-between'>" +
                "<span>Meetings (" + (mtgData.meetings || []).length + ")</span>" +
                "<button onclick=\"window._fpProj.onFpScheduleMtg()\" style='padding:6px 16px;font-size:0.82rem;font-weight:600;background:#5b5fc7;color:#fff;border:none;border-radius:8px;cursor:pointer;'>＋ Schedule Meeting</button></div>" +
                (mtgRows ? "<table class='fpTable'><thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Status</th><th></th><th></th></tr></thead><tbody>" + mtgRows + "</tbody></table>"
                    : "<div class='fdCardSub'>No meetings scheduled yet. Click Schedule Meeting to create one.</div>") + "</div>";

            var chatBlock = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle' style='display:flex;align-items:center;justify-content:space-between'>" +
                "<span>Project Chat</span>" +
                "<button onclick=\"window._fpProj.onFpOpenChat()\" style='padding:6px 16px;font-size:0.82rem;font-weight:600;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;'>💬 Open Chat</button></div>" +
                "<div class='fdCardSub'>Chat with all project members — team members and allocated resources.</div></div>";

            // ── Client Requirements block (view-only here; managed in inbox) ─────────
            var rqData = this._projReqs || { requirements: [] };
            var rqColor = { "New": "#94a3b8", "Assigned": "#38bdf8", "Under Analysis": "#a78bfa", "In Development": "#22d3ee", "Under Testing": "#fbbf24", "Awaiting Client Review": "#f472b6", "Approved": "#34d399", "Rejected": "#fb7185", "Closed": "#94a3b8" };
            var rqRows = (rqData.requirements || []).map(function (r) {
                var c = rqColor[r.status] || "#9fb0d6";
                return "<tr style='cursor:pointer' onclick=\"window._fpProj.onFpOpenReq('" + esc(r.requirementId) + "')\">" +
                    "<td><b style='color:#e6edf8'>" + esc(r.title) + "</b><div class='fdCardSub'>" + esc(r.requirementId) + "</div></td>" +
                    "<td style='color:#9fb0d6'>" + esc(r.priority || "—") + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(r.assignedToName || "—") + "</td>" +
                    "<td><span style='color:" + c + ";font-weight:700;font-size:0.8rem'>" + esc(r.status) + "</span></td></tr>";
            }).join("");
            var rqBlock = "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>Client Requirements (" + (rqData.requirements || []).length + ")</div>" +
                (rqRows ? "<table class='fpTable'><thead><tr><th>Requirement</th><th>Priority</th><th>Assigned To</th><th>Status</th></tr></thead><tbody>" + rqRows + "</tbody></table>"
                    : "<div class='fdCardSub'>No client requirements raised on this project yet.</div>") + "</div>";

            var lcTracker = this._lifecycleTracker(p.lifecycleStage, p.status);
            var lcAction = this._lifecycleActionCard(p, this._meetings);
            return FP.wrap(head, "<div style='margin-top:6px'>" + back + "</div>" + lcTracker + lcAction + execHeader + execBody + resBlock + taskBlock + mtgBlock + chatBlock + rqBlock + auditBtn);
        },

        // ── Project Health + cost forecast ──────────────────────────────────────
        _healthCard: function (h) {
            if (!h) return "";
            var COL = { Green: "#34d399", Yellow: "#fbbf24", Red: "#fb7185" };
            var dot = function (label, state) {
                var c = COL[state] || "#9fb0d6";
                return "<div class='fpHealthItem'><span class='fpHealthDot' style='background:" + c + "'></span>" +
                    "<div><div class='fpHealthLbl'>" + label + "</div><div class='fpHealthState' style='color:" + c + "'>" + esc(state) + "</div></div></div>";
            };
            var hh = h.health || {};
            var money = this._money.bind(this);
            var marginCol = (h.projectedMarginPct >= h.expectedMarginPct) ? "#34d399" : (h.projectedMarginPct >= h.expectedMarginPct - 5) ? "#fbbf24" : "#fb7185";
            var varCol = function (n) { return (Number(n) >= 0) ? "#34d399" : "#fb7185"; };
            return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>Project Health</div>" +
                "<div class='fpHealthGrid'>" + dot("Budget", hh.budget) + dot("Resource", hh.resource) + dot("Schedule", hh.schedule) + dot("Profitability", hh.profitability) + "</div>" +
                "<div class='fpFcGrid'>" +
                "<div class='fpFcCard'><div class='lbl'>Forecasted Cost</div><div class='val'>" + money(h.projectedTotalCost) + "</div><div class='sub'>vs Execution " + money(h.executionBudget) + "</div></div>" +
                "<div class='fpFcCard'><div class='lbl'>Allocated Resource Cost</div><div class='val'>" + money(h.allocatedResourceCost) + "</div><div class='sub'>remaining " + money(h.remainingBudget) + "</div></div>" +
                "<div class='fpFcCard'><div class='lbl'>Current Spend</div><div class='val'>" + money(h.actualCost) + "</div><div class='sub'>" + (h.actualHours || 0) + "h logged</div></div>" +
                "<div class='fpFcCard'><div class='lbl'>Projected Margin</div><div class='val' style='color:" + marginCol + "'>" + h.projectedMarginPct + "%</div><div class='sub'>expected " + h.expectedMarginPct + "%</div></div>" +
                "<div class='fpFcCard'><div class='lbl'>Budget Variance</div><div class='val' style='color:" + varCol(h.budgetVariance) + "'>" + money(h.budgetVariance) + "</div><div class='sub'>exec − forecast</div></div>" +
                "</div>" +
                "<div class='fdCardSub'>Progress " + (h.progress || 0) + "% · Time elapsed " + (h.elapsedPct || 0) + "%" + (h.overdueTasks ? " · " + h.overdueTasks + " overdue task(s)" : "") + "</div></div>";
        },

        // ── Executive sub-renderers ─────────────────────────────────────────────
        _badgeClass: function (b) {
            return b === "Critical" ? "crit" : b === "At Risk" ? "warn" : b === "Completed" ? "done" : "ok";
        },
        _money: function (n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); },
        _aiCard: function (text, badge) {
            if (!text) return "";
            return "<div class='fdCard fdGlass fpAiCard' style='display:block;margin-top:14px'>" +
                "<div class='fpAiHead'><span class='fpAiBadge'>AI Insights</span><span class='fpBadge " + this._badgeClass(badge) + "'>" + esc(badge) + "</span></div>" +
                "<div class='fpAiText'>" + esc(text) + "</div></div>";
        },
        // SVG donut for budget consumption.
        _donut: function (consumedPct, color) {
            var pct = Math.max(0, Math.min(100, consumedPct || 0));
            var R = 52, C = 2 * Math.PI * R, off = C * (1 - pct / 100);
            return "<svg width='130' height='130' viewBox='0 0 130 130'>" +
                "<circle cx='65' cy='65' r='" + R + "' stroke='rgba(255,255,255,0.10)' stroke-width='14' fill='none'/>" +
                "<circle cx='65' cy='65' r='" + R + "' stroke='" + color + "' stroke-width='14' fill='none' stroke-linecap='round'" +
                " stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + off.toFixed(1) + "' transform='rotate(-90 65 65)'/>" +
                "<text x='65' y='62' text-anchor='middle' font-size='20' font-weight='700' fill='#fff'>" + pct + "%</text>" +
                "<text x='65' y='80' text-anchor='middle' font-size='9' fill='#9fb0d6'>utilized</text></svg>";
        },
        _budgetCard: function (b) {
            b = b || { allocated: 0, consumed: 0, remaining: 0, utilizationPct: 0 };
            var col = b.utilizationPct > 100 ? "#fb7185" : b.utilizationPct > 90 ? "#f59e0b" : "#34d399";
            return "<div class='fdCard fdGlass fpExecCard'><div class='fdCardTitle'>Project Budget</div>" +
                "<div class='fpBudgetRow'>" + this._donut(b.utilizationPct, col) +
                "<div class='fpBudgetNums'>" +
                "<div><span>Allocated</span><b>" + this._money(b.allocated) + "</b></div>" +
                "<div><span>Consumed</span><b style='color:" + col + "'>" + this._money(b.consumed) + "</b></div>" +
                "<div><span>Remaining</span><b>" + this._money(b.remaining) + "</b></div>" +
                "</div></div></div>";
        },
        _managerCard: function (m) {
            m = m || {};
            var ini = String(m.name || "?").trim().split(/\s+/).map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase();
            var avatar = m.photo
                ? "<div class='fpMgrAvatar has-photo' style='background-image:url(" + m.photo + ")'></div>"
                : "<div class='fpMgrAvatar'>" + esc(ini || "?") + "</div>";
            return "<div class='fdCard fdGlass fpExecCard'><div class='fdCardTitle'>Project Manager (POC)</div>" +
                "<div class='fpMgr'>" + avatar +
                "<div><div class='fpMgrName'>" + esc(m.name || "—") + "</div>" +
                "<div class='fpMgrDesig'>" + esc(m.designation || "—") + "</div>" +
                "<div class='fpMgrMail'>" + esc(m.email || "") + "</div></div></div></div>";
        },
        _progressKpiCard: function (prog, ts) {
            ts = ts || {};
            return "<div class='fdCard fdGlass fpExecCard'><div class='fdCardTitle'>Project Progress</div>" +
                "<div class='fpProgBig'>" + (prog || 0) + "%</div>" + this._bar(prog) +
                "<div class='fpKpiMini'>" +
                "<span>✅ " + (ts.completed || 0) + " done</span><span>🕒 " + ((ts.ongoing || 0) + (ts.inReview || 0) + (ts.pending || 0)) + " open</span><span class='neg'>⏰ " + (ts.overdue || 0) + " overdue</span>" +
                "</div></div>";
        },
        _focusCard: function (areas) {
            var chips = (areas && areas.length) ? areas.map(function (a) { return "<span class='fpChip'>" + esc(a) + "</span>"; }).join("") : "<span class='fdCardSub'>No focus areas defined.</span>";
            return "<div class='fdCard fdGlass fpExecCard' style='display:block'><div class='fdCardTitle'>Focus Areas</div><div class='fpChips'>" + chips + "</div></div>";
        },
        _resourceSummaryCard: function (r) {
            r = r || {};
            return "<div class='fdCard fdGlass fpExecCard' style='display:block'><div class='fdCardTitle'>Resource Allocation Summary</div>" +
                "<div class='fpResSum'>" +
                "<div><span>Assigned</span><b>" + (r.totalAssigned || 0) + "</b></div>" +
                "<div><span>Active</span><b>" + (r.active || 0) + "</b></div>" +
                "<div><span>Cost Consumed</span><b>" + this._money(r.costConsumed) + "</b></div>" +
                "<div><span>Cost Remaining</span><b>" + this._money(r.costRemaining) + "</b></div>" +
                "</div></div>";
        },
        // ── Budget vs Actual analysis (Founder only) ────────────────────────────
        _budgetAnalysisSection: function (b) {
            if (!b) return "";
            var self = this;
            if (!b.hasBudget) {
                return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                    "<div class='fdCardTitle'>💰 Budget vs Actual Analysis</div>" +
                    "<div class='fdCardSub'>No budget has been allocated for this project yet. Allocate a budget during the planning stage to see department-wise financial analysis.</div></div>";
            }
            var overBudget = b.totalActual > b.totalBudget;
            var remCol = b.totalRemaining < 0 ? "#fb7185" : "#34d399";
            var utilCol = b.utilizationPct > 100 ? "#fb7185" : b.utilizationPct > 90 ? "#f59e0b" : "#34d399";

            // KPI strip.
            var poolCol = (b.unallocatedBudget || 0) > 0 ? "#38bdf8" : "#64748b";
            var kpis = "<div class='fpBvaKpis'>" +
                "<div class='fpBvaKpi'><span>Total Budget</span><b>" + this._money(b.totalBudget) + "</b></div>" +
                "<div class='fpBvaKpi'><span>Allocated</span><b>" + this._money(b.allocatedBudget) + "</b></div>" +
                "<div class='fpBvaKpi'><span>Unallocated Pool</span><b style='color:" + poolCol + "'>" + this._money(b.unallocatedBudget) + "</b></div>" +
                "<div class='fpBvaKpi'><span>Actual Spend</span><b style='color:" + utilCol + "'>" + this._money(b.totalActual) + "</b></div>" +
                "<div class='fpBvaKpi'><span>Remaining</span><b style='color:" + remCol + "'>" + this._money(b.totalRemaining) + "</b></div>" +
                "<div class='fpBvaKpi'><span>Utilization</span><b style='color:" + utilCol + "'>" + b.utilizationPct + "%</b></div>" +
                "<div class='fpBvaKpi'><span>Forecast @ Completion</span><b>" + this._money(b.forecastAtCompletion) + "</b></div>" +
                "</div>";

            // Grouped horizontal bars — Allocated vs Actual per department.
            var maxVal = 1;
            (b.byDepartment || []).forEach(function (d) { maxVal = Math.max(maxVal, d.allocated, d.actual); });
            var bars = (b.byDepartment || []).map(function (d) {
                var open = !!self._deptOpen[d.department];
                var aPct = Math.round((d.allocated / maxVal) * 100);
                var cPct = Math.round((d.actual / maxVal) * 100);
                var actCol = d.actual > d.allocated ? "#fb7185" : "#34d399";
                var varTxt = (d.variance < 0 ? "▲ over " : "▼ under ") + self._money(Math.abs(d.variance));
                var varCol = d.variance < 0 ? "#fb7185" : "#34d399";
                var drill = "";
                if (open) {
                    var rrows = (d.resources || []).length
                        ? (d.resources || []).map(function (r) {
                            return "<tr><td>" + esc(r.employeeName) + "</td><td>" + r.workedHours + "h</td>" +
                                "<td>" + self._money(r.hourlyCost) + "/h</td><td><b>" + self._money(r.cost) + "</b></td></tr>";
                        }).join("")
                        : "<tr><td colspan='4' class='fdCardSub'>No logged effort for this department yet.</td></tr>";
                    drill = "<div class='fpDeptDrill'><table class='fpTable'><thead><tr><th>Employee</th><th>Hours</th><th>Rate</th><th>Cost</th></tr></thead>" +
                        "<tbody>" + rrows + "</tbody></table></div>";
                }
                return "<div class='fpBvaDept'>" +
                    "<div class='fpDeptRow' onclick=\"window._fpProj.onToggleDept('" + esc(d.department).replace(/'/g, "\\'") + "')\">" +
                    "<span class='fpDeptCaret'>" + (open ? "▾" : "▸") + "</span>" +
                    "<span class='fpDeptName'>" + esc(d.department) + "</span>" +
                    "<span class='fpDeptVar' style='color:" + varCol + "'>" + varTxt + "</span></div>" +
                    "<div class='fpBvaBars'>" +
                    "<div class='fpBvaBarRow'><span class='fpBvaTag'>Allocated</span><div class='fpBvaTrack'><div class='fpBvaFill alloc' style='width:" + aPct + "%'></div></div><span class='fpBvaVal'>" + self._money(d.allocated) + "</span></div>" +
                    "<div class='fpBvaBarRow'><span class='fpBvaTag'>Actual</span><div class='fpBvaTrack'><div class='fpBvaFill' style='width:" + cPct + "%;background:" + actCol + "'></div></div><span class='fpBvaVal'>" + self._money(d.actual) + "</span></div>" +
                    "</div>" + drill + "</div>";
            }).join("");
            if (!bars) bars = "<div class='fdCardSub'>No department allocations recorded.</div>";

            // Other (non-department) allocations.
            var other = "";
            if ((b.otherBudgets || []).length) {
                other = "<div class='fdCardTitle' style='margin-top:16px;font-size:0.9rem'>Other Allocations</div>" +
                    "<table class='fpTable'><tbody>" + b.otherBudgets.map(function (o) {
                        return "<tr><td>" + esc(o.category) + "</td><td style='text-align:right'><b>" + self._money(o.amount) + "</b></td></tr>";
                    }).join("") + "</tbody></table>";
            }

            var banner = overBudget
                ? "<div class='fpBvaWarn'>⚠ Actual spend has exceeded the allocated budget. Review department variances below.</div>"
                : "";
            return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" +
                "<div class='fdCardTitle'>💰 Budget vs Actual Analysis <span class='fpViewOnly'>founder only</span></div>" +
                banner + kpis +
                "<div class='fdCardSub' style='margin:10px 0 4px'>By Department — click a department to drill down to individual resource cost.</div>" +
                bars + other +
                this._budgetRequestsBlock(b) + "</div>";
        },
        // Pending requests (with approve/partial/reject) + decided history.
        _budgetRequestsBlock: function (b) {
            var self = this;
            var reqs = (b && b.requests) || { pending: [], approved: [], rejected: [] };
            var pool = b.unallocatedBudget || 0;
            var pend = (reqs.pending || []).map(function (r) {
                var insufficient = r.requestedAmount > pool;
                return "<div class='fpReqCard'>" +
                    "<div class='fpReqTop'><span class='fpReqDept'>" + esc(r.department) + "</span>" +
                    "<span class='fpReqAmt'>" + self._money(r.requestedAmount) + "</span></div>" +
                    "<div class='fpReqMeta'>Requested by " + esc(r.requestedByName || "POC") + " · " + esc(r.requestDate) +
                    " · Dept utilization " + (r.utilizationSnapshot || 0) + "%</div>" +
                    "<div class='fpReqField'><b>Justification:</b> " + esc(r.justification) + "</div>" +
                    "<div class='fpReqField'><b>Business Impact:</b> " + esc(r.businessImpact) + "</div>" +
                    (insufficient ? "<div class='fpReqWarn'>⚠ Requested amount exceeds the unallocated pool (" + self._money(pool) + "). You can approve a partial amount, top up the project budget, or reject.</div>" : "") +
                    "<div class='fpReqActions'>" +
                    "<button class='faBtn approve' onclick=\"window._fpProj.onReqApproveFull('" + esc(r.requestId) + "'," + r.requestedAmount + ")\">Approve Full</button>" +
                    "<button class='faBtn ghost' onclick=\"window._fpProj.onReqApprovePartial('" + esc(r.requestId) + "'," + r.requestedAmount + ")\">Approve Partial</button>" +
                    "<button class='faBtn reject' onclick=\"window._fpProj.onReqReject('" + esc(r.requestId) + "')\">Reject</button>" +
                    "</div></div>";
            }).join("");
            var pendBlock = "<div class='fdCardTitle' style='margin-top:18px;font-size:0.95rem'>Budget Requests" +
                ((reqs.pending || []).length ? " <span class='fpReqBadge'>" + reqs.pending.length + " pending</span>" : "") + "</div>" +
                ((reqs.pending || []).length ? pend : "<div class='fdCardSub'>No pending budget requests.</div>");

            // Decided history (approved + rejected/withdrawn).
            var hist = (reqs.approved || []).concat(reqs.rejected || []);
            var histBlock = "";
            if (hist.length) {
                var hrows = hist.map(function (r) {
                    var col = r.status === "Approved" ? "#34d399" : r.status === "Rejected" ? "#fb7185" : "#94a3b8";
                    var amt = r.status === "Approved" ? self._money(r.approvedAmount) + " / " + self._money(r.requestedAmount) : self._money(r.requestedAmount);
                    return "<tr><td>" + esc(r.department) + "</td><td>" + amt + "</td>" +
                        "<td><span style='color:" + col + ";font-weight:700;font-size:0.8rem'>" + esc(r.status) + "</span></td>" +
                        "<td>" + esc(r.decidedAt || r.requestDate || "") + "</td>" +
                        "<td class='fdCardSub'>" + esc(r.founderComments || "") + "</td></tr>";
                }).join("");
                histBlock = "<details class='fpReqHist'><summary>Decision history (" + hist.length + ")</summary>" +
                    "<table class='fpTable'><thead><tr><th>Dept</th><th>Approved/Requested</th><th>Status</th><th>Date</th><th>Comments</th></tr></thead><tbody>" + hrows + "</tbody></table></details>";
            }
            return pendBlock + histBlock;
        },
        onReqApproveFull: function (requestId, amount) {
            this._reqDecide(requestId, "approve", amount, "");
        },
        onReqApprovePartial: function (requestId, requested) {
            var that = this;
            var body = "<div class='fmod'>" +
                "<label>Approved Amount (₹) — requested " + this._money(requested) + "</label>" +
                "<input class='fpInput' id='paAmt' type='number' min='1' step='1' value='" + requested + "'/>" +
                "<label>Comments (optional)</label><textarea class='fmodTextarea' id='paCmt'></textarea>" +
                "<div class='fmodFoot'><button class='faBtn ghost' id='paCancel'>Cancel</button><button class='faBtn approve' id='paSave'>Approve</button></div></div>";
            var m = FP.modal({ title: "Approve Partial Amount", body: body });
            m.body.querySelector("#paCancel").addEventListener("click", m.close);
            m.body.querySelector("#paSave").addEventListener("click", function () {
                var amt = parseFloat(m.body.querySelector("#paAmt").value) || 0;
                if (amt <= 0) { FP.toast("Enter an amount greater than 0.", false); return; }
                if (amt > requested) { FP.toast("Approved amount cannot exceed the requested amount.", false); return; }
                var cmt = (m.body.querySelector("#paCmt").value || "").trim();
                m.close(); that._reqDecide(requestId, "approve", amt, cmt);
            });
        },
        onReqReject: function (requestId) {
            var that = this;
            var body = "<div class='fmod'>" +
                "<label>Rejection Comments *</label><textarea class='fmodTextarea' id='rjCmt' placeholder='Explain why this request is rejected'></textarea>" +
                "<div class='fmodFoot'><button class='faBtn ghost' id='rjCancel'>Cancel</button><button class='faBtn reject' id='rjSave'>Reject Request</button></div></div>";
            var m = FP.modal({ title: "Reject Budget Request", body: body });
            m.body.querySelector("#rjCancel").addEventListener("click", m.close);
            m.body.querySelector("#rjSave").addEventListener("click", function () {
                var cmt = (m.body.querySelector("#rjCmt").value || "").trim();
                if (!cmt) { FP.toast("Rejection comments are required.", false); return; }
                m.close(); that._reqDecide(requestId, "reject", 0, cmt);
            });
        },
        _reqDecide: function (requestId, decision, approvedAmount, comments) {
            var that = this, pid = this._detail.project.projectId;
            ppost("decideBudgetRequest", { requestId: requestId, decision: decision, approvedAmount: approvedAmount || 0, comments: comments || "" })
                .then(function (res) {
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast(decision === "reject" ? "Request rejected. POC notified." : "Request approved. Department budget updated.");
                    // Refresh budget analysis + dept bars.
                    ppost("getProjectBudgetAnalysis", { projectId: pid }).then(function (r) {
                        that._budget = (r && !r.error) ? r : that._budget; that._render();
                    });
                }).catch(function () { FP.toast("Could not process the decision.", false); });
        },
        onToggleDept: function (dept) {
            if (!this._deptOpen) this._deptOpen = {};
            this._deptOpen[dept] = !this._deptOpen[dept];
            this._render();
        },

        _issuesCard: function (issues, counts, canManage) {
            counts = counts || {};
            var pills = "<span class='fpIssPill crit'>Critical " + (counts.Critical || 0) + "</span>" +
                "<span class='fpIssPill high'>High " + (counts.High || 0) + "</span>" +
                "<span class='fpIssPill med'>Medium " + (counts.Medium || 0) + "</span>" +
                "<span class='fpIssPill low'>Low " + (counts.Low || 0) + "</span>";
            var rows = (issues || []).map(function (i) {
                var sevCls = i.severity === "Critical" ? "crit" : i.severity === "High" ? "high" : i.severity === "Medium" ? "med" : "low";
                var statSel = canManage
                    ? "<select class='fpSelect' onchange=\"window._fpProj.onIssueStatus('" + esc(i.issueId) + "', this.value)\">" +
                        ["Open", "In Progress", "Resolved", "Closed"].map(function (s) { return "<option" + (s === i.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>"
                    : esc(i.status);
                return "<tr><td>" + esc(i.issueId) + "</td><td>" + esc(i.title) + "</td>" +
                    "<td><span class='fpIssPill " + sevCls + "'>" + esc(i.severity) + "</span></td>" +
                    "<td>" + esc(i.ownerName || "—") + "</td><td>" + esc(i.createdAt || "") + "</td><td>" + statSel + "</td></tr>";
            }).join("");
            var head = "<div class='fdCardHead'><div class='fdCardTitle'>Project Risks & Issues</div>" +
                (canManage ? "<button class='faBtn reject sm' onclick=\"window._fpProj.onAddIssue()\">＋ Raise Issue</button>" : "") + "</div>";
            return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'>" + head +
                "<div class='fpIssPills'>" + pills + "</div>" +
                (rows ? "<table class='fpTable'><thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Owner</th><th>Created</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table>"
                    : "<div class='fdCardSub'>No issues raised. 🎉</div>") + "</div>";
        },
        _taskAnalyticsCard: function (ts) {
            ts = ts || {};
            var items = [
                ["Total", ts.total || 0, "#38bdf8"], ["Completed", ts.completed || 0, "#16a34a"],
                ["Ongoing", ts.ongoing || 0, "#f59e0b"], ["In Review", ts.inReview || 0, "#a78bfa"],
                ["Pending", ts.pending || 0, "#64748b"], ["Blocked", ts.blocked || 0, "#fb7185"],
                ["Overdue", ts.overdue || 0, "#dc2626"]
            ];
            var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1]));
            var bars = items.map(function (i) {
                var w = Math.max(2, Math.round((i[1] / max) * 100));
                return "<div class='fpTaRow'><span class='fpTaLbl'>" + i[0] + "</span>" +
                    "<div class='fpTaTrack'><div class='fpTaFill' style='width:" + w + "%;background:" + i[2] + "'></div></div>" +
                    "<span class='fpTaVal'>" + i[1] + "</span></div>";
            }).join("");
            return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'><div class='fdCardTitle'>Task Status Overview</div>" + bars + "</div>";
        },
        _effortCard: function (effort) {
            effort = effort || [];
            if (!effort.length) return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'><div class='fdCardTitle'>Employee Effort — Assigned vs Worked</div><div class='fdCardSub'>No effort data yet.</div></div>";
            var max = Math.max.apply(null, effort.map(function (e) { return Math.max(e.assignedHours, e.workedHours); }).concat([1]));
            var rows = effort.map(function (e) {
                var aw = Math.max(2, Math.round((e.assignedHours / max) * 100));
                var ww = Math.max(2, Math.round((e.workedHours / max) * 100));
                return "<div class='fpEffRow'><div class='fpEffName'>" + esc(e.employeeName) + "</div>" +
                    "<div class='fpEffBars'>" +
                    "<div class='fpEffBar'><span class='fpEffTag'>Assigned</span><div class='fpEffTrack'><div class='fpEffFill assigned' style='width:" + aw + "%'></div></div><span class='fpEffH'>" + e.assignedHours + "h</span></div>" +
                    "<div class='fpEffBar'><span class='fpEffTag'>Worked</span><div class='fpEffTrack'><div class='fpEffFill worked' style='width:" + ww + "%'></div></div><span class='fpEffH'>" + e.workedHours + "h</span></div>" +
                    "</div></div>";
            }).join("");
            return "<div class='fdCard fdGlass' style='display:block;margin-top:14px'><div class='fdCardTitle'>Employee Effort — Assigned vs Worked</div>" + rows + "</div>";
        },

        // ── Onclick proxies ───────────────────────────────────────────────────────
        onOpen: function (id) { this._openProject(id); },
        onBack: function () { this._load(); },

        // ── Create Project ─────────────────────────────────────────────────────────
        onCreateProject: function () {
            var that = this;
            // Load active employees (POC picker) and clients (mandatory) in parallel.
            Promise.all([
                fetch("/employee/Employees?$select=employeeId,employeeName,isActive&$top=500", { headers: { Accept: "application/json" }, credentials: "include" }).then(function (r) { return r.json(); }),
                ppost("getClientMasters", {}),
                ppost("getProjectTypes", {}).catch(function () { return { types: [] }; })
            ]).then(function (results) {
                var j = results[0], cd = results[1] || {}, td = results[2] || {};
                var emps = ((j && j.value) || []).filter(function (e) { return e.isActive !== false; })
                    .sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
                var opts = "<option value=''>— Select POC —</option>" + emps.map(function (e) { return "<option value='" + esc(e.employeeId) + "'>" + esc(e.employeeName) + " (" + esc(e.employeeId) + ")</option>"; }).join("");
                var clients = (cd.clients || []).filter(function (c) { return String(c.status || "").toLowerCase() !== "inactive"; });
                var clientOpts = "<option value=''>— Select Client —</option>" + clients.map(function (c) { return "<option value='" + esc(c.clientId) + "'>" + esc(c.clientName) + (c.companyName ? " — " + esc(c.companyName) : "") + "</option>"; }).join("");
                var types = td.types || [];
                that._createTypes = types;   // keep for hasRevenue lookup on save
                var typeOpts = "<option value=''>— Select Project Type —</option>" + types.map(function (t) { return "<option value='" + esc(t.code) + "'>" + esc(t.name) + "</option>"; }).join("");
                var body =
                    "<div class='fpForm fpCreate'>" +
                    // ── Project basics ──────────────────────────────────────────────
                    "<div class='fpGroup'>" +
                    "<div class='fpGroupTitle'>Project Details</div>" +
                    "<label>Project Name *</label><input class='fpInput' id='pName' placeholder='e.g. Acme SAP S/4HANA Migration'/>" +
                    "<div class='fpRow'><div><label>Client *</label><select class='fpInput' id='pClient'>" + clientOpts + "</select></div>" +
                    "<div><label>Project Type *</label><select class='fpInput' id='pType'>" + typeOpts + "</select></div></div>" +
                    "<label>Description</label><textarea class='fmodTextarea' id='pDesc' placeholder='Short summary of scope and objectives'></textarea>" +
                    "</div>" +
                    // ── Timeline ────────────────────────────────────────────────────
                    "<div class='fpGroup'>" +
                    "<div class='fpGroupTitle'>Timeline</div>" +
                    "<div class='fpRow'><div><label>Start Date *</label><input type='date' class='fpInput' id='pStart'/></div>" +
                    "<div><label>End Date</label><input type='date' class='fpInput' id='pEnd'/></div>" +
                    "<div><label>Go-Live Date</label><input type='date' class='fpInput' id='pGoLive'/></div></div>" +
                    "</div>" +
                    // ── Ownership ───────────────────────────────────────────────────
                    "<div class='fpGroup'>" +
                    "<div class='fpGroupTitle'>Assignment</div>" +
                    "<div class='fpRow'><div><label>Priority</label><select class='fpInput' id='pPrio'>" + PRIORITIES.map(function (x) { return "<option" + (x === "Medium" ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></div>" +
                    "<div><label>POC *</label><select class='fpInput' id='pPoc'>" + opts + "</select></div></div>" +
                    "</div>" +
                    // ── Financial model ─────────────────────────────────────────────
                    "<div class='fpGroup' id='pFinWrap'>" +
                    "<div class='fpGroupTitle'>Financials</div>" +
                    "<div class='fpRow'>" +
                    "<div><label>Total Contract Value (₹)</label><input type='number' min='0' step='10000' class='fpInput' id='pContract' placeholder='e.g. 10000000'/></div>" +
                    "<div><label id='pMarginLbl'>Expected Profit Margin %</label><input type='number' min='0' max='100' step='1' class='fpInput' id='pMargin' placeholder='e.g. 20'/></div></div>" +
                    "<div id='pFinCalc' class='fpFinCalc'></div></div>" +
                    // ── Focus areas ─────────────────────────────────────────────────
                    "<div class='fpGroup'>" +
                    "<div class='fpGroupTitle'>Focus Areas</div>" +
                    "<label>Comma-separated tags</label><input class='fpInput' id='pFocus' placeholder='SAP CAP Development, Fiori UI, Security Compliance'/>" +
                    "</div>" +
                    (clients.length ? "" : "<div style='color:#fb7185;font-size:0.8rem;margin-top:8px;'>No clients exist yet. Create a client first via \"Manage Clients\".</div>") +
                    "<div id='pErr' style='display:none;color:#fb7185;font-size:0.84rem;padding:8px 12px;background:rgba(251,113,133,0.10);border-radius:8px;margin-top:4px'></div>" +
                    "<div class='fmodFoot'><button class='faBtn ghost' id='cCancel'>Cancel</button><button class='faBtn approve' id='cSave'>Create Project</button></div></div>";
                var m = FP.modal({ title: "Create Project", body: body, wide: true, cls: "fmodCreateProject" });
                var showErr = function (msg) {
                    var el = m.body.querySelector("#pErr");
                    if (!el) return;
                    el.textContent = "⚠ " + msg;
                    el.style.display = "block";
                    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                };
                m.body.querySelector("#cCancel").addEventListener("click", m.close);

                // Live financial calc: Profit Reserve + Execution Budget. Internal /
                // cost-tracking types carry no revenue → margin hidden, reserve 0.
                var typeByCode = {}; types.forEach(function (t) { typeByCode[t.code] = t; });
                var recalcFin = function () {
                    var t = typeByCode[m.body.querySelector("#pType").value];
                    var hasRev = !t || t.hasRevenue !== false;
                    var contract = parseFloat(m.body.querySelector("#pContract").value) || 0;
                    var marginEl = m.body.querySelector("#pMargin");
                    m.body.querySelector("#pMarginLbl").parentNode.style.display = hasRev ? "" : "none";
                    var margin = hasRev ? (parseFloat(marginEl.value) || 0) : 0;
                    var reserve = Math.round(contract * margin) / 100;
                    var exec = hasRev ? (contract - reserve) : contract;
                    var fmt = function (n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); };
                    m.body.querySelector("#pFinCalc").innerHTML = contract > 0
                        ? "<div class='fpFinRow'><span>Profit Reserve" + (hasRev ? " (" + margin + "%)" : " — n/a") + "</span><b>" + fmt(reserve) + "</b></div>" +
                          "<div class='fpFinRow exec'><span>Execution Budget <small>(allocation ceiling)</small></span><b>" + fmt(exec) + "</b></div>" +
                          (hasRev ? "" : "<div class='fpFinNote'>Internal project — cost tracking only, no revenue.</div>")
                        : "";
                };
                ["#pType", "#pContract", "#pMargin"].forEach(function (id) {
                    var el = m.body.querySelector(id); if (el) el.addEventListener("input", recalcFin);
                });

                m.body.querySelector("#cSave").addEventListener("click", function () {
                    var btn = this;
                    var g = function (id) { var el = m.body.querySelector(id); return el ? el.value.trim() : ""; };
                    // ── Frontend validation with specific field messages ──────────────
                    if (!g("#pName")) { showErr("Project Name is required."); m.body.querySelector("#pName").focus(); return; }
                    if (!g("#pClient")) { showErr("Please select a Client."); m.body.querySelector("#pClient").focus(); return; }
                    if (!g("#pType")) { showErr("Please select a Project Type."); m.body.querySelector("#pType").focus(); return; }
                    if (!g("#pStart")) { showErr("Start Date is required."); m.body.querySelector("#pStart").focus(); return; }
                    if (g("#pEnd") && g("#pStart") && g("#pEnd") < g("#pStart")) { showErr("End Date cannot be before Start Date."); m.body.querySelector("#pEnd").focus(); return; }
                    if (g("#pGoLive") && g("#pEnd") && g("#pGoLive") > g("#pEnd")) { showErr("Go-Live Date must be on or before the End Date."); m.body.querySelector("#pGoLive").focus(); return; }
                    if (g("#pGoLive") && g("#pStart") && g("#pGoLive") < g("#pStart")) { showErr("Go-Live Date cannot be before the Start Date."); m.body.querySelector("#pGoLive").focus(); return; }
                    if (!g("#pPoc")) { showErr("Please select a POC (Project Manager)."); m.body.querySelector("#pPoc").focus(); return; }
                    m.body.querySelector("#pErr").style.display = "none";
                    btn.disabled = true; btn.textContent = "Creating…";
                    var payload = { projectName: g("#pName"), description: g("#pDesc"), startDate: g("#pStart"), endDate: g("#pEnd") || null, priority: g("#pPrio"), pocEmployeeId: g("#pPoc"), clientId: g("#pClient"), goLiveDate: g("#pGoLive") || null, focusAreas: g("#pFocus"), projectType: g("#pType"), contractValue: parseFloat(g("#pContract")) || 0, profitMarginPct: parseFloat(g("#pMargin")) || 0 };
                    ppost("createProject", payload).then(function (res) {
                        if (res && res.error) {
                            // Keep modal open — show exactly which field is wrong
                            btn.disabled = false; btn.textContent = "Create Project";
                            showErr(res.error);
                            return;
                        }
                        m.close();
                        FP.toast("Project created. POC notified.");
                        that._load();
                    }).catch(function (err) {
                        btn.disabled = false; btn.textContent = "Create Project";
                        showErr("Server error — please try again. (" + (err && err.message ? err.message : "network") + ")");
                    });
                });
            }).catch(function () { FP.toast("Could not load employees/clients.", false); });
        },

        // ── Schedule Planning Meeting (selects from POC + managers) ──────────────
        onFpSchedulePlanningMtg: function () {
            var that = this, pid = this._detail.project.projectId;
            var poc = { employeeId: this._detail.project.poc_employeeId, employeeName: this._detail.project.pocName };
            var today = new Date().toISOString().slice(0, 10);
            ppost("getManagersForMeeting", {}).then(function (d) {
                // POC is auto-included separately → never offer them in the manager
                // multi-select (prevents a duplicate attendee entry).
                var managers = (d.managers || []).filter(function (m) { return m.employeeId !== poc.employeeId; });
                var fldStyle = "background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 10px;color:#e6edf8;font-size:0.9rem;width:100%;box-sizing:border-box";
                var lblStyle = "display:block;color:#9fb0d6;font-size:0.78rem;margin:10px 0 4px";
                // POC is auto-included; managers are multi-select.
                var pocRow = poc.employeeId
                    ? "<label style='display:block;padding:5px 0;font-size:0.88rem;color:#34d399'><input type='checkbox' checked disabled style='margin-right:6px'/>" + esc(poc.employeeName) + " <span style='color:#9fb0d6'>(POC — auto included)</span></label>"
                    : "";
                var mgrChecks = managers.map(function (m) {
                    return "<label style='display:block;padding:5px 0;font-size:0.88rem;cursor:pointer;color:#e6edf8'>" +
                        "<input type='checkbox' class='fpMtgMgr' data-emp='" + esc(m.employeeId) + "' style='margin-right:6px;'/>" +
                        esc(m.employeeName) + " <span style='color:#9fb0d6'>(" + esc(m.department || m.designation || "") + ")</span></label>";
                }).join("") || "<div style='color:#9fb0d6;font-size:0.85rem;'>No managers found.</div>";
                var bodyHtml = "<div style='display:flex;flex-direction:column;gap:2px'>" +
                    "<label style='" + lblStyle + "'>Title *</label><input type='text' id='fMtgTitle' placeholder='Project Kick-off Planning Meeting' style='" + fldStyle + "'/>" +
                    "<label style='" + lblStyle + "'>Agenda</label><textarea id='fMtgAgenda' rows='2' style='" + fldStyle + "' placeholder='Discuss scope, timeline, roles, budget expectations…'></textarea>" +
                    "<div style='display:flex;gap:10px;margin-top:4px'>" +
                    "<div style='flex:1'><label style='" + lblStyle + "'>Date *</label><input type='date' id='fMtgDate' min='" + today + "' style='" + fldStyle + "'/></div>" +
                    "<div style='flex:1'><label style='" + lblStyle + "'>Start *</label><input type='time' id='fMtgStart' value='10:00' style='" + fldStyle + "'/></div>" +
                    "<div style='flex:1'><label style='" + lblStyle + "'>End *</label><input type='time' id='fMtgEnd' value='11:00' style='" + fldStyle + "'/></div></div>" +
                    "<label style='" + lblStyle + "'>Participants</label>" +
                    "<div style='max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px'>" + pocRow + mgrChecks + "</div>" +
                    "<div style='display:flex;justify-content:flex-end;gap:10px;margin-top:16px'>" +
                    "<button id='fMtgCancel' style='padding:8px 18px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#9fb0d6;cursor:pointer;font-size:0.88rem'>Cancel</button>" +
                    "<button id='fMtgSave' style='padding:8px 18px;background:#5b5fc7;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:600;font-size:0.88rem'>Schedule</button></div></div>";
                var m = FP.modal({ title: "Schedule Planning Meeting", body: bodyHtml });
                m.body.querySelector("#fMtgCancel").addEventListener("click", function () { m.close(); });
                m.body.querySelector("#fMtgSave").addEventListener("click", function () {
                    var g = function (id) { var el = m.body.querySelector(id); return el ? el.value.trim() : ""; };
                    var title = g("#fMtgTitle"), date = g("#fMtgDate"), start = g("#fMtgStart"), end = g("#fMtgEnd");
                    if (!title) { FP.toast("Title is required.", false); return; }
                    if (!date) { FP.toast("Date is required.", false); return; }
                    if (!start || !end || end <= start) { FP.toast("Valid start and end time are required.", false); return; }
                    var partIds = poc.employeeId ? [poc.employeeId] : [];
                    m.body.querySelectorAll(".fpMtgMgr").forEach(function (chk) { if (chk.checked) partIds.push(chk.getAttribute("data-emp")); });
                    if (!partIds.length) { FP.toast("Select at least one participant.", false); return; }
                    this.disabled = true; this.textContent = "Scheduling…";
                    ppost("scheduleMeeting", { projectId: pid, title: title, agenda: g("#fMtgAgenda"), startDateTime: date + "T" + start + ":00", endDateTime: date + "T" + end + ":00", participantIds: partIds })
                        .then(function (res) {
                            m.close();
                            if (res && res.error) { FP.toast(res.error, false); return; }
                            FP.toast("Planning meeting scheduled!");
                            that._meetings = null; that._openProject(pid);
                        }).catch(function () { m.close(); FP.toast("Could not schedule the meeting.", false); });
                });
            }).catch(function () { FP.toast("Could not load managers.", false); });
        },

        // ── Mark planning meeting as completed ───────────────────────────────────
        onFpMarkMeetingCompleted: function (meetingId) {
            var that = this, pid = this._detail.project.projectId;
            if (!confirm("Mark the planning meeting as completed? This cannot be undone — the project will advance to Budget Allocation.")) return;
            ppost("completePlanningMeeting", { projectId: pid }).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Planning meeting marked completed. Now allocate the budget.");
                that._meetings = null; that._openProject(pid);
            }).catch(function () { FP.toast("Could not complete the meeting.", false); });
        },

        // ── Allocate Budget (Founder) — revamped budget workspace ──────────────────
        // Live summary (approved/allocated/remaining/utilization) + progress bar with
        // 80/90/100% warning ramp, "Select Departments" & "Select Resource Categories"
        // checkbox pickers that dynamically generate amount fields, a live breakdown
        // table, and hard over-allocation prevention.
        onFpAllocateBudget: function () {
            var that = this, pid = this._detail.project.projectId;
            Promise.all([
                ppost("getBudgetAllocation", { projectId: pid }).catch(function () { return {}; }),
                ppost("getDepartments", {}).catch(function () { return {}; })
            ]).then(function (r) {
                var existing = r[0] || {};
                // Type-aware = the project type defines resource categories (SAP / Dev).
                // Section A then shows those role categories; otherwise org departments.
                var typeAware = !!(existing.resourceCategories && existing.resourceCategories.length);
                var allDepts = typeAware ? existing.resourceCategories.slice()
                    : ((r[1] && r[1].departments && r[1].departments.length) ? r[1].departments.slice() : DEPT_ROWS.slice());
                var allCats = typeAware ? (existing.costCategories || RESOURCE_CATEGORIES).slice() : RESOURCE_CATEGORIES.slice();
                var secALabel = typeAware ? "📦 Resource Category Allocation" : "📦 Department Allocation";
                var secABtn = typeAware ? "＋ Select Resource Categories" : "＋ Select Departments";
                var secBLabel = typeAware ? "🧰 Other Costs" : "🧰 Cost Category Allocation";
                var secBBtn = typeAware ? "＋ Select Cost Categories" : "＋ Select Resource Categories";

                // ── State (preserved across picker toggles) ───────────────────────
                var deptAmt = {}, deptNotes = {}, catAmt = {}, catNotes = {};
                var selDepts = {}, selCats = {};
                if (typeAware) {
                    // Saved allocation lives in categoryBudgets — split back into role
                    // categories (section A) vs cost categories (section B).
                    var resSet = {}; existing.resourceCategories.forEach(function (cName) { resSet[cName] = true; });
                    (existing.categoryBudgets || []).forEach(function (x) {
                        if (resSet[x.category]) { if (allDepts.indexOf(x.category) === -1) allDepts.push(x.category); deptAmt[x.category] = Number(x.amount) || 0; deptNotes[x.category] = x.notes || ""; selDepts[x.category] = true; }
                        else { if (allCats.indexOf(x.category) === -1) allCats.push(x.category); catAmt[x.category] = Number(x.amount) || 0; catNotes[x.category] = x.notes || ""; selCats[x.category] = true; }
                    });
                } else {
                    (existing.departmentBudgets || []).forEach(function (x) {
                        if (allDepts.indexOf(x.department) === -1) allDepts.push(x.department);   // keep legacy depts
                        deptAmt[x.department] = Number(x.amount) || 0; deptNotes[x.department] = x.notes || ""; selDepts[x.department] = true;
                    });
                    (existing.otherBudgets || []).forEach(function (x) {
                        if (allCats.indexOf(x.category) === -1) allCats.push(x.category);         // keep legacy categories
                        catAmt[x.category] = Number(x.amount) || 0; catNotes[x.category] = x.notes || ""; selCats[x.category] = true;
                    });
                }

                var fld = "background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:7px 10px;color:#e6edf8;font-size:0.88rem;width:100%;box-sizing:border-box";
                var pickBtn = "padding:7px 14px;background:rgba(91,95,199,0.25);border:1px solid rgba(91,95,199,0.6);border-radius:8px;color:#c7c9ff;font-size:0.82rem;font-weight:600;cursor:pointer";
                var secHead = "display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px;color:#e6edf8;font-weight:700;font-size:0.95rem";

                // Execution Budget (contract − profit reserve) is the fixed allocation
                // ceiling here — it flows from project creation and is not edited.
                var execBudget = Number(existing.executionBudget || existing.totalBudget) || 0;
                var finCtx = (Number(existing.contractValue) > 0)
                    ? "<div class='fpBdNotice' style='display:block'>Contract " + that._money(existing.contractValue) +
                        " − Profit Reserve " + that._money(existing.profitReserveAmount) + " (" + (Number(existing.profitMarginPct) || 0) + "%) = Execution Budget</div>"
                    : "";
                var body = "<div class='fpForm fpBudgetWs'>" +
                    "<label>Execution Budget (₹) — allocation ceiling</label>" +
                    "<input type='number' class='fpInput' id='fpTotalBudget' value='" + execBudget + "' readonly style='opacity:0.85;cursor:not-allowed'/>" +
                    finCtx +
                    "<div id='fpBdNotice' class='fpBdNotice' style='display:none'></div>" +
                    // Summary cards + progress bar.
                    "<div id='fpBdCards' class='fpBdCards'></div>" +
                    "<div class='fpBdProgressTrack'><div id='fpBdProgressFill' class='fpBdProgressFill'></div></div>" +
                    "<div id='fpBdProgressLbl' class='fpBdProgressLbl'></div>" +
                    // Section A — Resource Categories (type-aware) or Departments (legacy).
                    "<div style='" + secHead + "'><span>" + secALabel + "</span>" +
                    "<button type='button' id='fpSelDept' style='" + pickBtn + "'>" + secABtn + "</button></div>" +
                    "<div id='fpDeptPicker' class='fpBdPicker' style='display:none'></div>" +
                    "<div id='fpDeptFields'></div>" +
                    // Section B — Other (non-resource) cost categories.
                    "<div style='" + secHead + "'><span>" + secBLabel + "</span>" +
                    "<button type='button' id='fpSelCat' style='" + pickBtn + "'>" + secBBtn + "</button></div>" +
                    "<div id='fpCatPicker' class='fpBdPicker' style='display:none'></div>" +
                    "<div id='fpCatFields'></div>" +
                    // Breakdown table.
                    "<div id='fpBdBreakdown' style='margin-top:18px'></div>" +
                    "<div id='fpBdError' class='fpBdError' style='display:none'></div>" +
                    "<div class='fmodFoot'><button class='faBtn ghost' id='fpBdCancel'>Cancel</button><button class='faBtn approve' id='fpBdSave'>Save Budget Allocation</button></div></div>";
                var m = FP.modal({ title: "Budget Allocation", body: body, wide: true });
                var $ = function (sel) { return m.body.querySelector(sel); };

                // ── Renderers ─────────────────────────────────────────────────────
                function renderPicker(elId, all, sel, cls) {
                    $("#" + elId).innerHTML = all.map(function (name) {
                        return "<label class='fpBdPickOpt'><input type='checkbox' class='" + cls + "' data-name='" + esc(name) + "'" + (sel[name] ? " checked" : "") + "/> " + esc(name) + "</label>";
                    }).join("");
                }
                function renderFields(containerId, all, sel, amt, notes, cls) {
                    var chosen = all.filter(function (n) { return sel[n]; });
                    if (!chosen.length) { $("#" + containerId).innerHTML = "<div class='fpBdEmpty'>None selected yet.</div>"; return; }
                    $("#" + containerId).innerHTML = chosen.map(function (n) {
                        return "<div class='fpBdFieldRow'><div class='fpBdFieldName'>" + esc(n) + "</div>" +
                            "<input type='number' min='0' step='1000' class='" + cls + "Amt' data-name='" + esc(n) + "' value='" + (amt[n] || 0) + "' placeholder='Amount ₹' style='" + fld + "'/>" +
                            "<input type='text' class='" + cls + "Notes' data-name='" + esc(n) + "' value='" + esc(notes[n] || "") + "' placeholder='Notes…' style='" + fld + "'/></div>";
                    }).join("");
                }
                function sumSel(all, sel, amt) { return all.reduce(function (s, n) { return s + (sel[n] ? (Number(amt[n]) || 0) : 0); }, 0); }

                function recompute() {
                    var total = parseFloat($("#fpTotalBudget").value) || 0;
                    var deptSum = sumSel(allDepts, selDepts, deptAmt);
                    var catSum = sumSel(allCats, selCats, catAmt);
                    var allocated = deptSum + catSum;
                    var remaining = total - allocated;
                    var util = total > 0 ? Math.round(allocated / total * 100) : 0;
                    var over = allocated > total;
                    var col = budgetWarnColor(util, over);

                    // Approved budget must never silently read 0 — guide the founder
                    // to define it if it was never entered at project creation.
                    var notice = $("#fpBdNotice");
                    if (total <= 0) { notice.style.display = "block"; notice.textContent = "ℹ Project budget has not been defined yet. Enter the approved budget to begin allocating."; }
                    else { notice.style.display = "none"; }

                    // Summary cards.
                    $("#fpBdCards").innerHTML = [
                        { l: "Approved Budget", v: INR(total), c: "#e6edf8" },
                        { l: "Allocated", v: INR(allocated), c: col },
                        { l: "Remaining", v: INR(remaining), c: over ? "#fb7185" : "#34d399" },
                        { l: "Utilization", v: util + "%", c: col }
                    ].map(function (k) {
                        return "<div class='fpBdCard'><div class='fpBdCardLbl'>" + k.l + "</div><div class='fpBdCardVal' style='color:" + k.c + "'>" + k.v + "</div></div>";
                    }).join("");

                    // Progress bar (capped visual at 100; colour conveys over-budget).
                    $("#fpBdProgressFill").style.width = Math.min(100, util) + "%";
                    $("#fpBdProgressFill").style.background = col;
                    $("#fpBdProgressLbl").innerHTML = "<span style='color:" + col + ";font-weight:700'>" + util + "% Allocated</span>" +
                        " · <span style='color:#9fb0d6'>" + Math.max(0, 100 - util) + "% Remaining</span>" +
                        (over ? " · <span style='color:#fb7185;font-weight:700'>OVER BUDGET</span>"
                            : util >= 90 ? " · <span style='color:#fb923c'>⚠ Nearing limit</span>"
                            : util >= 80 ? " · <span style='color:#fbbf24'>⚠ 80%+ allocated</span>" : "");

                    // Breakdown table (only funded rows).
                    var rows = [];
                    allDepts.forEach(function (n) { if (selDepts[n] && (deptAmt[n] || 0) > 0) rows.push({ cat: n, amt: deptAmt[n], type: typeAware ? "Role" : "Dept" }); });
                    allCats.forEach(function (n) { if (selCats[n] && (catAmt[n] || 0) > 0) rows.push({ cat: n, amt: catAmt[n], type: "Cost" }); });
                    var rowsHtml = rows.map(function (x) {
                        var pct = total > 0 ? Math.round(x.amt / total * 100) : 0;
                        return "<tr><td>" + esc(x.cat) + " <span class='fpBdType'>" + x.type + "</span></td>" +
                            "<td style='text-align:right'>" + INR(x.amt) + "</td><td style='text-align:right'>" + pct + "%</td></tr>";
                    }).join("");
                    $("#fpBdBreakdown").innerHTML = rows.length
                        ? "<div class='fpBdSecLbl'>Allocation Breakdown</div><table class='fpBdTable'><thead><tr><th>Category</th><th style='text-align:right'>Allocated</th><th style='text-align:right'>%</th></tr></thead>" +
                            "<tbody>" + rowsHtml + "</tbody><tfoot><tr><td><b>Total Allocation</b></td><td style='text-align:right'><b style='color:" + col + "'>" + INR(allocated) + "</b></td><td style='text-align:right'><b>" + util + "%</b></td></tr>" +
                            "<tr><td><b>Remaining</b></td><td style='text-align:right'><b style='color:" + (over ? "#fb7185" : "#34d399") + "'>" + INR(remaining) + "</b></td><td style='text-align:right'><b>" + Math.max(0, 100 - util) + "%</b></td></tr></tfoot></table>"
                        : "<div class='fpBdEmpty'>Enter amounts to see the allocation breakdown.</div>";

                    // Over-allocation guard.
                    var err = $("#fpBdError"), save = $("#fpBdSave");
                    if (over) {
                        err.style.display = "block";
                        err.innerHTML = "⚠ Allocated budget exceeds the approved project budget by <b>" + INR(allocated - total) + "</b>. Reduce allocations to save.";
                        save.disabled = true; save.style.opacity = "0.5"; save.style.cursor = "not-allowed";
                    } else {
                        err.style.display = "none"; save.disabled = false; save.style.opacity = ""; save.style.cursor = "";
                    }
                }

                // ── Wire up ───────────────────────────────────────────────────────
                renderFields("fpDeptFields", allDepts, selDepts, deptAmt, deptNotes, "fpBdDept");
                renderFields("fpCatFields", allCats, selCats, catAmt, catNotes, "fpBdCat");
                recompute();

                $("#fpSelDept").addEventListener("click", function () {
                    var pk = $("#fpDeptPicker"); var show = pk.style.display === "none";
                    if (show) renderPicker("fpDeptPicker", allDepts, selDepts, "fpBdDeptChk");
                    pk.style.display = show ? "" : "none";
                });
                $("#fpSelCat").addEventListener("click", function () {
                    var pk = $("#fpCatPicker"); var show = pk.style.display === "none";
                    if (show) renderPicker("fpCatPicker", allCats, selCats, "fpBdCatChk");
                    pk.style.display = show ? "" : "none";
                });

                // Delegated handlers: checkbox toggles regenerate fields; amount/notes
                // inputs update state + recompute live.
                m.body.addEventListener("change", function (e) {
                    var t = e.target;
                    if (t.classList.contains("fpBdDeptChk")) { selDepts[t.getAttribute("data-name")] = t.checked; renderFields("fpDeptFields", allDepts, selDepts, deptAmt, deptNotes, "fpBdDept"); recompute(); }
                    else if (t.classList.contains("fpBdCatChk")) { selCats[t.getAttribute("data-name")] = t.checked; renderFields("fpCatFields", allCats, selCats, catAmt, catNotes, "fpBdCat"); recompute(); }
                });
                m.body.addEventListener("input", function (e) {
                    var t = e.target;
                    if (t.classList.contains("fpBdDeptAmt")) { deptAmt[t.getAttribute("data-name")] = parseFloat(t.value) || 0; recompute(); }
                    else if (t.classList.contains("fpBdDeptNotes")) { deptNotes[t.getAttribute("data-name")] = t.value; }
                    else if (t.classList.contains("fpBdCatAmt")) { catAmt[t.getAttribute("data-name")] = parseFloat(t.value) || 0; recompute(); }
                    else if (t.classList.contains("fpBdCatNotes")) { catNotes[t.getAttribute("data-name")] = t.value; }
                    else if (t.id === "fpTotalBudget") { recompute(); }
                });

                $("#fpBdCancel").addEventListener("click", m.close);
                $("#fpBdSave").addEventListener("click", function () {
                    var total = parseFloat($("#fpTotalBudget").value) || 0;
                    if (total <= 0) { FP.toast("Total budget must be greater than 0.", false); return; }
                    var sectionA = [], otherBudgets = [];
                    allDepts.forEach(function (n) { if (selDepts[n] && (deptAmt[n] || 0) > 0) sectionA.push({ name: n, amount: deptAmt[n], notes: deptNotes[n] || "" }); });
                    allCats.forEach(function (n) { if (selCats[n] && (catAmt[n] || 0) > 0) otherBudgets.push({ category: n, amount: catAmt[n], notes: catNotes[n] || "" }); });
                    var totalAllocated = sectionA.reduce(function (s, x) { return s + x.amount; }, 0) + otherBudgets.reduce(function (s, x) { return s + x.amount; }, 0);
                    if (totalAllocated > total) { FP.toast("Allocated amount (" + INR(totalAllocated) + ") exceeds Execution Budget. Please adjust.", false); return; }
                    this.disabled = true; this.textContent = "Saving…";
                    // Type-aware: role categories + costs go to categoryBudgets (the ceiling
                    // axis); no department funding. Legacy: section A = departmentBudgets.
                    var payload;
                    if (typeAware) {
                        var roleBudgets = sectionA.map(function (x) { return { category: x.name, amount: x.amount, notes: x.notes }; });
                        payload = { projectId: pid, totalBudget: total, departmentBudgets: JSON.stringify([]), otherBudgets: JSON.stringify(otherBudgets), categoryBudgets: JSON.stringify(roleBudgets.concat(otherBudgets)) };
                    } else {
                        var deptBudgets = sectionA.map(function (x) { return { department: x.name, amount: x.amount, notes: x.notes }; });
                        payload = { projectId: pid, totalBudget: total, departmentBudgets: JSON.stringify(deptBudgets), otherBudgets: JSON.stringify(otherBudgets), categoryBudgets: JSON.stringify(otherBudgets) };
                    }
                    ppost("saveBudgetAllocation", payload)
                        .then(function (res) {
                            m.close();
                            if (res && res.error) { FP.toast(res.error, false); return; }
                            FP.toast("Budget allocated! POC notified — resource allocation can begin.");
                            that._openProject(pid);
                        }).catch(function () { m.close(); FP.toast("Could not save budget.", false); });
                });
            }).catch(function () { FP.toast("Could not load budget.", false); });
        },

        onSetStatus: function (status) {
            var that = this, pid = this._detail.project.projectId;
            ppost("updateProjectStatus", { projectId: pid, status: status }).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Status updated."); that._openProject(pid);
            });
        },

        // ── Allocate Resources ──────────────────────────────────────────────────────
        onAllocate: function () {
            var that = this, pid = this._detail.project.projectId;
            ppost("getAllocatableEmployees", { projectId: pid }).then(function (d) {
                if (d && d.error) { FP.toast(d.error, false); return; }
                var deptHtml = (d.departments || []).map(function (grp) {
                    var rows = grp.employees.map(function (e) {
                        var bwOpts = "<option value='0'>—</option>" + BANDWIDTHS.map(function (b) { return "<option value='" + b + "'" + (e.allocatedHere === b ? " selected" : "") + ">" + b + "%</option>"; }).join("");
                        return "<tr><td><input type='checkbox' class='fpAlChk' data-emp='" + esc(e.employeeId) + "'" + (e.allocatedHere ? " checked" : "") + "/></td>" +
                            "<td>" + esc(e.employeeName) + "</td>" +
                            "<td><span class='fpMini'>Allocated " + e.currentAllocation + "% · Available " + e.available + "%</span></td>" +
                            "<td><select class='fpAlBw' data-emp='" + esc(e.employeeId) + "'>" + bwOpts + "</select></td></tr>";
                    }).join("");
                    return "<div class='fpDeptTitle'>" + esc(grp.department) + "</div><table class='fpTable'><tbody>" + rows + "</tbody></table>";
                }).join("");
                var body = "<div class='fpAllocWrap'>" + (deptHtml || "<div class='fdCardSub'>No active employees.</div>") + "</div>" +
                    "<div class='fmodFoot'><button class='faBtn ghost' id='aCancel'>Cancel</button><button class='faBtn approve' id='aSave'>Save Allocation</button></div>";
                var m = FP.modal({ title: "Allocate Resources", body: body, wide: true });
                m.body.querySelector("#aCancel").addEventListener("click", m.close);
                m.body.querySelector("#aSave").addEventListener("click", function () {
                    var allocations = [];
                    m.body.querySelectorAll(".fpAlChk").forEach(function (chk) {
                        if (!chk.checked) return;
                        var emp = chk.getAttribute("data-emp");
                        var sel = m.body.querySelector(".fpAlBw[data-emp='" + emp + "']");
                        var bw = parseInt(sel ? sel.value : "0", 10);
                        if (bw > 0) allocations.push({ employeeId: emp, bandwidth: bw });
                    });
                    if (!allocations.length) { FP.toast("Select at least one employee and a bandwidth.", false); return; }
                    this.disabled = true; this.textContent = "Saving…";
                    ppost("allocateResources", { projectId: pid, allocations: allocations }).then(function (res) {
                        m.close();
                        if (res && res.error) { FP.toast(res.error, false); return; }
                        FP.toast("Resources allocated. " + (res.notified || 0) + " notified.");
                        that._openProject(pid);
                    }).catch(function () { m.close(); FP.toast("Could not allocate.", false); });
                });
            });
        },
        onRemoveRes: function (empId) {
            var that = this, pid = this._detail.project.projectId;
            FP.modal && FP.toast;
            ppost("removeResource", { projectId: pid, employeeId: empId }).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Resource removed."); that._openProject(pid);
            });
        },

        // ── Create Task ───────────────────────────────────────────────────────────
        onCreateTask: function () {
            var that = this, pid = this._detail.project.projectId, resources = this._detail.resources || [];
            if (!resources.length) { FP.toast("Allocate resources before creating tasks.", false); return; }
            var opts = "<option value=''>— Assign to —</option>" + resources.map(function (r) { return "<option value='" + esc(r.employeeId) + "'>" + esc(r.employeeName) + " (" + r.bandwidth + "%)</option>"; }).join("");
            var body = "<div class='fpForm'>" +
                "<label>Task Name *</label><input class='fpInput' id='tName'/>" +
                "<label>Description</label><textarea class='fmodTextarea' id='tDesc'></textarea>" +
                "<div class='fpRow'><div><label>Assignee *</label><select class='fpInput' id='tAss'>" + opts + "</select></div>" +
                "<div><label>Priority</label><select class='fpInput' id='tPrio'>" + PRIORITIES.map(function (x) { return "<option" + (x === "Medium" ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></div></div>" +
                "<div class='fpRow'><div><label>Start Date</label><input type='date' class='fpInput' id='tStart'/></div>" +
                "<div><label>Due Date</label><input type='date' class='fpInput' id='tDue'/></div></div>" +
                "<label>Estimated Hours</label><input type='number' min='0' step='0.5' class='fpInput' id='tEst'/>" +
                "<div class='fmodFoot'><button class='faBtn ghost' id='tCancel'>Cancel</button><button class='faBtn approve' id='tSave'>Create Task</button></div></div>";
            var m = FP.modal({ title: "Create Project Task", body: body, wide: true });
            m.body.querySelector("#tCancel").addEventListener("click", m.close);
            m.body.querySelector("#tSave").addEventListener("click", function () {
                var g = function (id) { var el = m.body.querySelector(id); return el ? el.value : ""; };
                var payload = { projectId: pid, taskName: g("#tName"), description: g("#tDesc"), assignedToId: g("#tAss"), priority: g("#tPrio"), startDate: g("#tStart"), dueDate: g("#tDue"), estimatedHours: parseFloat(g("#tEst")) || 0 };
                this.disabled = true; this.textContent = "Creating…";
                ppost("createProjectTask", payload).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Task created & assignee notified.");
                    that._openProject(pid);
                }).catch(function () { m.close(); FP.toast("Could not create the task.", false); });
            });
        },

        // ── Audit log ───────────────────────────────────────────────────────────────
        onAudit: function () {
            var pid = this._detail.project.projectId;
            ppost("getProjectAuditLog", { projectId: pid }).then(function (d) {
                if (d && d.error) { FP.toast(d.error, false); return; }
                var rows = (d.entries || []).map(function (e) {
                    return "<tr><td>" + esc(e.at) + "</td><td><b>" + esc(e.action) + "</b></td><td>" + esc(e.userName) + "</td>" +
                        "<td>" + esc(e.oldValue || "—") + " → " + esc(e.newValue || "—") + "</td></tr>";
                }).join("");
                var body = rows ? "<table class='fpTable'><thead><tr><th>When</th><th>Action</th><th>By</th><th>Change</th></tr></thead><tbody>" + rows + "</tbody></table>"
                    : "<div class='fdCardSub'>No audit entries.</div>";
                FP.modal({ title: "Audit Log", body: body, wide: true });
            });
        },

        // ── Issues ────────────────────────────────────────────────────────────────
        onAddIssue: function () {
            var that = this, pid = this._detail.project.projectId, resources = this._detail.resources || [];
            var ownerOpts = "<option value=''>— Owner (optional) —</option>" + resources.map(function (r) { return "<option value='" + esc(r.employeeId) + "'>" + esc(r.employeeName) + "</option>"; }).join("");
            var sevOpts = ["Critical", "High", "Medium", "Low"].map(function (s) { return "<option" + (s === "Medium" ? " selected" : "") + ">" + s + "</option>"; }).join("");
            var body = "<div class='fpForm'>" +
                "<label>Issue Title *</label><input class='fpInput' id='iTitle'/>" +
                "<label>Description</label><textarea class='fmodTextarea' id='iDesc'></textarea>" +
                "<div class='fpRow'><div><label>Severity</label><select class='fpInput' id='iSev'>" + sevOpts + "</select></div>" +
                "<div><label>Owner</label><select class='fpInput' id='iOwner'>" + ownerOpts + "</select></div></div>" +
                "<div class='fmodFoot'><button class='faBtn ghost' id='iCancel'>Cancel</button><button class='faBtn reject' id='iSave'>Raise Issue</button></div></div>";
            var m = FP.modal({ title: "Raise Project Issue", body: body, wide: true });
            m.body.querySelector("#iCancel").addEventListener("click", m.close);
            m.body.querySelector("#iSave").addEventListener("click", function () {
                var g = function (id) { var el = m.body.querySelector(id); return el ? el.value : ""; };
                this.disabled = true; this.textContent = "Saving…";
                ppost("createProjectIssue", { projectId: pid, title: g("#iTitle"), description: g("#iDesc"), severity: g("#iSev"), ownerId: g("#iOwner") }).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Issue raised."); that._openProject(pid);
                }).catch(function () { m.close(); FP.toast("Could not raise the issue.", false); });
            });
        },
        onIssueStatus: function (issueId, status) {
            var that = this, pid = this._detail.project.projectId;
            ppost("updateProjectIssue", { issueId: issueId, status: status }).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Issue updated."); that._openProject(pid);
            });
        },

        // ── Schedule Meeting (Founder) ─────────────────────────────────────────────
        onFpScheduleMtg: function () {
            var that = this, pid = this._detail.project.projectId;
            var resources = (this._detail.resources || []).slice().sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
            var today = new Date().toISOString().slice(0, 10);
            var partChecks = resources.map(function (r) {
                return "<label style='display:block;padding:5px 0;font-size:0.88rem;cursor:pointer;color:#e6edf8'>" +
                    "<input type='checkbox' class='fpMtgPart' data-emp='" + esc(r.employeeId) + "' style='margin-right:6px;'/>" +
                    esc(r.employeeName) + " <span style='color:#9fb0d6'>(" + esc(r.department) + ")</span></label>";
            }).join("");
            if (!partChecks) partChecks = "<div style='color:#9fb0d6;font-size:0.85rem;'>No allocated resources. Allocate resources via POC first.</div>";

            var fldStyle = "background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 10px;color:#e6edf8;font-size:0.9rem;width:100%;box-sizing:border-box";
            var lblStyle = "display:block;color:#9fb0d6;font-size:0.78rem;margin:10px 0 4px";
            var bodyHtml =
                "<div style='display:flex;flex-direction:column;gap:2px'>" +
                "<label style='" + lblStyle + "'>Title *</label><input type='text' id='fMtgTitle' placeholder='e.g. Sprint Review' style='" + fldStyle + "'/>" +
                "<label style='" + lblStyle + "'>Agenda</label><textarea id='fMtgAgenda' rows='2' style='" + fldStyle + "'></textarea>" +
                "<div style='display:flex;gap:10px;margin-top:4px'>" +
                "<div style='flex:1'><label style='" + lblStyle + "'>Date *</label><input type='date' id='fMtgDate' min='" + today + "' style='" + fldStyle + "'/></div>" +
                "<div style='flex:1'><label style='" + lblStyle + "'>Start *</label><input type='time' id='fMtgStart' value='10:00' style='" + fldStyle + "'/></div>" +
                "<div style='flex:1'><label style='" + lblStyle + "'>End *</label><input type='time' id='fMtgEnd' value='11:00' style='" + fldStyle + "'/></div>" +
                "</div>" +
                "<label style='" + lblStyle + "'>Participants *</label>" +
                "<div style='max-height:160px;overflow:auto;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px'>" + partChecks + "</div>" +
                "<div style='display:flex;justify-content:flex-end;gap:10px;margin-top:16px'>" +
                "<button id='fMtgCancel' style='padding:8px 18px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#9fb0d6;cursor:pointer;font-size:0.88rem'>Cancel</button>" +
                "<button id='fMtgSave' style='padding:8px 18px;background:#5b5fc7;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:600;font-size:0.88rem'>Schedule</button>" +
                "</div></div>";
            var m = FP.modal({ title: "Schedule Teams Meeting", body: bodyHtml });
            m.body.querySelector("#fMtgCancel").addEventListener("click", function () { m.close(); });
            m.body.querySelector("#fMtgSave").addEventListener("click", function () {
                var g = function (id) { var el = m.body.querySelector(id); return el ? el.value.trim() : ""; };
                var title = g("#fMtgTitle"), date = g("#fMtgDate"), start = g("#fMtgStart"), end = g("#fMtgEnd");
                if (!title) { FP.toast("Title is required.", false); return; }
                if (!date)  { FP.toast("Date is required.", false); return; }
                if (!start || !end) { FP.toast("Start and end time are required.", false); return; }
                if (end <= start) { FP.toast("End time must be after start time.", false); return; }
                var partIds = [];
                m.body.querySelectorAll(".fpMtgPart").forEach(function (chk) { if (chk.checked) partIds.push(chk.getAttribute("data-emp")); });
                if (!partIds.length) { FP.toast("Select at least one participant.", false); return; }
                this.disabled = true; this.textContent = "Scheduling…";
                ppost("scheduleMeeting", { projectId: pid, title: title, agenda: g("#fMtgAgenda"), startDateTime: date + "T" + start + ":00", endDateTime: date + "T" + end + ":00", participantIds: partIds })
                    .then(function (res) {
                        m.close();
                        if (res && res.error) { FP.toast(res.error, false); return; }
                        FP.toast(res.isMock ? "Meeting scheduled (mock mode)." : "Teams meeting created!");
                        that._meetings = null; that._openProject(pid);
                    }).catch(function () { m.close(); FP.toast("Could not schedule the meeting.", false); });
            });
        },

        // ── Cancel Meeting (Founder) ───────────────────────────────────────────────
        onFpCancelMtg: function (meetingId, title) {
            var that = this, pid = this._detail.project.projectId;
            if (!confirm("Cancel meeting \"" + title + "\"? Participants will be notified.")) return;
            ppost("cancelProjectMeeting", { meetingId: meetingId }).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Meeting cancelled."); that._meetings = null; that._openProject(pid);
            }).catch(function () { FP.toast("Could not cancel the meeting.", false); });
        },

        // ── Project Chat (Founder) ─────────────────────────────────────────────────
        onFpOpenChat: function () {
            var d = this._detail;
            if (!d || !d.project) return;
            if (!this._projChat) {
                this._projChat = new ProjectChat(this.getView(), this.getOwnerComponent());
            }
            this._projChat.open(d.project.projectId, d.project.projectName, null, true);
        },

        // ── Requirement detail (Founder) — view + assign + status + comment ──────────
        onFpOpenReq: function (requirementId) {
            var that = this;
            ppost("getRequirementDetail", { requirementId: requirementId }).then(function (r) {
                if (r && r.error) { FP.toast(r.error, false); return; }
                that._renderFpReq(r);
            }).catch(function () { FP.toast("Could not load requirement.", false); });
        },

        _renderFpReq: function (r) {
            var that = this;
            var INTERNAL_STATUSES = ["Assigned", "Under Analysis", "In Development", "Under Testing", "Awaiting Client Review"];
            // Assignable employees = project resources + POC (from the loaded detail).
            var resources = (this._detail && this._detail.resources) || [];
            var assignables = resources.map(function (x) { return { id: x.employeeId, name: x.employeeName }; });
            if (this._detail && this._detail.project && this._detail.project.pocName && this._detail.project.poc_employeeId) {
                assignables.unshift({ id: this._detail.project.poc_employeeId, name: this._detail.project.pocName + " (POC)" });
            }
            var asgOpts = "<option value=''>— Assign to —</option>" + assignables.map(function (a) {
                return "<option value='" + esc(a.id) + "'" + (a.id === r.assignedToId ? " selected" : "") + ">" + esc(a.name) + "</option>";
            }).join("");
            var statOpts = INTERNAL_STATUSES.map(function (s) { return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>"; }).join("");

            var atts = (r.attachments || []).map(function (a) {
                return "<div style='padding:5px 0;color:#9fb0d6;font-size:0.84rem'>📎 " + esc(a.fileName) + " <span style='color:#6b7fa8'>v" + a.version + "</span></div>";
            }).join("") || "<div class='fdCardSub'>No documents.</div>";

            var cmts = (r.comments || []).map(function (c) {
                return "<div style='margin:6px 0;padding:7px 10px;background:rgba(255,255,255,0.06);border-radius:8px'>" +
                    "<div style='font-size:0.72rem;color:#6b7fa8'>" + esc(c.authorName) + " · " + esc(c.authorRole) + "</div>" +
                    "<div style='font-size:0.86rem;color:#dde4f5;white-space:pre-wrap'>" + (c.isDeleted ? "<i>deleted</i>" : esc(c.message)) + "</div></div>";
            }).join("") || "<div class='fdCardSub'>No comments yet.</div>";

            var hist = (r.history || []).map(function (h) {
                return "<div style='font-size:0.78rem;color:#9fb0d6;padding:3px 0'>" + esc(h.action) + " — " + esc(h.userName) + (h.newValue ? " (" + esc(h.oldValue || "") + "→" + esc(h.newValue) + ")" : "") + "</div>";
            }).join("");

            var fld = "background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 10px;color:#e6edf8;font-size:0.88rem;width:100%;box-sizing:border-box";
            var lbl = "display:block;color:#9fb0d6;font-size:0.76rem;margin:10px 0 4px";
            var body = "<div style='display:flex;flex-direction:column;gap:2px'>" +
                "<div style='color:#e6edf8;font-weight:700;font-size:1.05rem'>" + esc(r.title) + "</div>" +
                "<div class='fdCardSub'>" + esc(r.requirementId) + " · Priority " + esc(r.priority) + " · Status " + esc(r.status) + "</div>" +
                "<div style='color:#dde4f5;font-size:0.88rem;margin-top:8px'>" + esc(r.description || "") + "</div>" +
                (r.businessJustification ? "<div style='color:#9fb0d6;font-size:0.84rem;margin-top:6px'><b>Justification:</b> " + esc(r.businessJustification) + "</div>" : "") +
                (r.canAssign ? ("<label style='" + lbl + "'>Assign</label><select id='fqAsg' style='" + fld + "'>" + asgOpts + "</select>") : "") +
                (r.canUpdateStatus ? ("<label style='" + lbl + "'>Update Status</label><select id='fqStat' style='" + fld + "'>" + statOpts + "</select>") : "") +
                "<label style='" + lbl + "'>Documents</label>" + atts +
                "<label style='" + lbl + "'>Discussion</label><div style='max-height:180px;overflow:auto'>" + cmts + "</div>" +
                "<textarea id='fqCmt' rows='2' placeholder='Add a comment…' style='" + fld + ";margin-top:6px'></textarea>" +
                "<label style='" + lbl + "'>Audit Trail</label>" + (hist || "<div class='fdCardSub'>—</div>") +
                "<div class='fmodFoot'><button class='faBtn ghost' id='fqClose'>Close</button>" +
                (r.canAssign ? "<button class='faBtn' id='fqAssign'>Assign</button>" : "") +
                (r.canUpdateStatus ? "<button class='faBtn approve' id='fqSave'>Update Status</button>" : "") +
                "<button class='faBtn' id='fqComment'>Comment</button></div></div>";

            var m = FP.modal({ title: "Requirement", body: body, wide: true });
            var pid = this._detail.project.projectId;
            m.body.querySelector("#fqClose").addEventListener("click", m.close);
            var assignBtn = m.body.querySelector("#fqAssign");
            if (assignBtn) assignBtn.addEventListener("click", function () {
                var eid = m.body.querySelector("#fqAsg").value;
                if (!eid) { FP.toast("Select an assignee.", false); return; }
                ppost("assignRequirement", { requirementId: r.requirementId, employeeId: eid }).then(function (res) {
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Requirement assigned."); m.close(); that._openProject(pid);
                });
            });
            var saveBtn = m.body.querySelector("#fqSave");
            if (saveBtn) saveBtn.addEventListener("click", function () {
                var st = m.body.querySelector("#fqStat").value;
                ppost("updateRequirementStatus", { requirementId: r.requirementId, status: st }).then(function (res) {
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Status updated."); m.close(); that._openProject(pid);
                });
            });
            m.body.querySelector("#fqComment").addEventListener("click", function () {
                var msg = (m.body.querySelector("#fqCmt").value || "").trim();
                if (!msg) { FP.toast("Write a comment first.", false); return; }
                ppost("addRequirementComment", { requirementId: r.requirementId, message: msg }).then(function (res) {
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Comment added."); m.close(); that.onFpOpenReq(r.requirementId);
                });
            });
        }
    });
});
