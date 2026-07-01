sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    // Unbound-action POST helper against the ProjectService (mirrors Projects.controller).
    function ppost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

    // Status badge → colour palette (matches the backend statusBadge values).
    var STATUS_STYLE = {
        "Available":     { bg: "#dcfce7", fg: "#16a34a" },
        "Busy":          { bg: "#dbeafe", fg: "#2563eb" },
        "Nearly Full":   { bg: "#fef9c3", fg: "#a16207" },
        "Overallocated": { bg: "#fee2e2", fg: "#dc2626" }
    };
    function utilColor(pct) { return pct > 100 ? "#dc2626" : pct >= 85 ? "#a16207" : pct >= 50 ? "#2563eb" : "#16a34a"; }
    function initials(name) {
        var p = String(name || "").trim().split(/\s+/);
        return ((p[0] || "")[0] || "") + ((p[1] || "")[0] || "");
    }

    return Controller.extend("timesheet.app.controller.ResourcePlanning", {
        onInit: function () {
            window._rpCtrl = this;
            this._filters = { skill: "", department: "", minUtil: "", maxUtil: "", availabilityDate: "", nameSearch: "", status: "" };
            this._mode = "pool";   // "pool" | "recommend"
            this._reco = { requiredSkills: "", neededBandwidth: 0 };
            this.getOwnerComponent().getRouter().getRoute("resource-planning").attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { if (window._rpCtrl === this) window._rpCtrl = null; },
        _host: function () { return this.byId("rpHost"); },

        _onMatched: function () {
            // Load the department list once (for the filter dropdown), then the pool.
            var that = this;
            if (!this._depts) {
                ppost("getDepartments", {}).then(function (d) { that._depts = (d && d.departments) || []; })
                    .catch(function () { that._depts = []; }).then(function () { that._load(); });
            } else { this._load(); }
        },

        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='rpWrap'><div class='rpLoading'>Loading resource pool…</div></div>");
            Promise.all([
                ppost("getResourcePool", this._filters),
                ppost("getOverUtilizedResources", {}).catch(function () { return {}; }),
                ppost("getResourceCapacityRisks", {}).catch(function () { return {}; })
            ]).then(function (rr) {
                var d = rr[0];
                if (d && d.error) { if (h) h.setContent("<div class='rpWrap'><div class='rpEmpty'>" + esc(d.error) + "</div></div>"); return; }
                that._data = d || { resources: [], kpis: {} };
                that._over = (rr[1] && !rr[1].error) ? rr[1] : { overUtilized: [], overrides: [] };
                that._risks = (rr[2] && !rr[2].error) ? rr[2] : { risks: [], shortages: [] };
                that._render();
            }).catch(function () { if (h) h.setContent("<div class='rpWrap'><div class='rpEmpty'>Could not load the resource pool.</div></div>"); });
        },

        // ── Render ────────────────────────────────────────────────────────────────
        _render: function () {
            var h = this._host(); if (!h) return;
            var d = this._data || { resources: [], kpis: {} };
            var header = "<div class='rpHeader'><div><div class='rpTitle'>Resource Planning</div>" +
                "<div class='rpSub'>Capacity, utilization & availability across the workforce</div></div>" +
                "<div class='rpModeTabs'>" +
                "<button class='rpModeTab" + (this._mode === "pool" ? " active" : "") + "' onclick=\"window._rpCtrl.onMode('pool')\">Resource Pool</button>" +
                "<button class='rpModeTab" + (this._mode === "recommend" ? " active" : "") + "' onclick=\"window._rpCtrl.onMode('recommend')\">🎯 Recommend</button>" +
                "</div></div>";
            var body = (this._mode === "recommend")
                ? this._renderRecommend()
                : (this._renderKpis(d.kpis) + this._renderUtilOverview(d.kpis) + this._renderRisks() + this._renderFilters() + this._renderGrid(d.resources, false) + this._renderOverUtilized());
            h.setContent("<div class='rpWrap'>" + header + body + "</div>");
        },

        _renderKpis: function (k) {
            k = k || {};
            var tiles = [
                { label: "Total Employees", value: k.totalEmployees || 0, cls: "" },
                { label: "Available", value: k.availableEmployees || 0, cls: "ok" },
                { label: "Busy", value: k.busyEmployees || 0, cls: "" },
                { label: "Nearly Full", value: k.nearlyFullEmployees || 0, cls: "warn" },
                { label: "Overallocated", value: k.overallocatedResources || 0, cls: "bad" },
                { label: "Avg Utilization", value: (k.averageUtilization || 0) + "%", cls: "" }
            ];
            return "<div class='rpKpis'>" + tiles.map(function (t) {
                return "<div class='rpKpi " + t.cls + "'><div class='rpKpiVal'>" + esc(t.value) + "</div><div class='rpKpiLbl'>" + esc(t.label) + "</div></div>";
            }).join("") + "</div>";
        },

        // Resource Utilization Overview — over-utilization band summary cards.
        _renderUtilOverview: function (k) {
            k = k || {};
            var tiles = [
                { label: "Available This Week", value: k.availableThisWeek || 0, cls: "ok" },
                { label: "Available Next Month", value: k.availableNextMonth || 0, cls: "ok" },
                { label: "Fully Utilized", value: k.fullyUtilized || 0, cls: "" },
                { label: "Over-Utilized", value: k.overUtilized || 0, cls: "warn" },
                { label: "Critical", value: k.criticalUtilization || 0, cls: "bad" }
            ];
            return "<div class='rpSecTitle'>Resource Utilization Overview</div><div class='rpKpis'>" + tiles.map(function (t) {
                return "<div class='rpKpi " + t.cls + "'><div class='rpKpiVal'>" + esc(t.value) + "</div><div class='rpKpiLbl'>" + esc(t.label) + "</div></div>";
            }).join("") + "</div>";
        },

        // Upcoming Capacity Risks + Projects with Resource Shortages.
        _renderRisks: function () {
            var r = this._risks || { risks: [], shortages: [] };
            var risks = r.risks || [], shortages = r.shortages || [];
            if (!risks.length && !shortages.length) return "";
            var sevCol = { high: "#dc2626", medium: "#ea580c", low: "#ca8a04" };
            var riskChips = risks.map(function (x) {
                var col = sevCol[x.severity] || "#ea580c";
                return "<div class='rpRiskChip' style='border-left-color:" + col + "'><b>" + esc(x.employeeName) + "</b> · " + esc(x.type) +
                    "<span class='rpMuted'> — " + esc(x.detail) + "</span></div>";
            }).join("") || "<div class='rpMuted'>No upcoming capacity risks.</div>";
            var shortChips = shortages.map(function (s) {
                return "<div class='rpRiskChip' style='border-left-color:#dc2626'><b>" + esc(s.projectName) + "</b><span class='rpMuted'> — " + esc(s.reason) + "</span></div>";
            }).join("") || "<div class='rpMuted'>No projects with resource shortages.</div>";
            return "<div class='rpRiskGrid'>" +
                "<div class='rpRiskCol'><div class='rpSecTitle'>⚠ Upcoming Capacity Risks</div>" + riskChips + "</div>" +
                "<div class='rpRiskCol'><div class='rpSecTitle'>🚧 Projects with Resource Shortages</div>" + shortChips + "</div>" +
                "</div>";
        },

        // Over-Utilized Employees section + override audit trail (Founder visibility).
        _renderOverUtilized: function () {
            var o = this._over || { overUtilized: [], overrides: [] };
            var list = o.overUtilized || [];
            if (!list.length && !(o.overrides || []).length) return "";
            var rows = list.map(function (r) {
                return "<tr><td><b>" + esc(r.employeeName) + "</b> <span class='rpMuted'>" + esc(r.department || "") + "</span></td>" +
                    "<td><span style='color:" + r.color + ";font-weight:800'>" + r.utilizationPct + "%</span></td>" +
                    "<td>" + (r.projects && r.projects.length ? r.projects.map(esc).join(", ") : "—") + "</td>" +
                    "<td><span class='rpBand' style='background:" + r.color + "22;color:" + r.color + "'>" + esc(r.band) + "</span>" +
                    (r.status === "Overridden" ? " <span class='rpOvr'>Overridden</span>" : "") + "</td></tr>";
            }).join("");
            var table = list.length
                ? "<table class='rpTable'><thead><tr><th>Employee</th><th>Utilization</th><th>Projects Assigned</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table>"
                : "<div class='rpMuted'>No employees are currently over-utilized.</div>";
            var aud = (o.overrides || []).slice(0, 8).map(function (x) {
                return "<tr><td>" + esc(x.employeeName) + "</td><td>" + esc(x.projectName) + "</td>" +
                    "<td>" + x.utilizationBefore + "% → <b style='color:#dc2626'>" + x.utilizationAfter + "%</b></td>" +
                    "<td>" + esc(x.reason) + "</td><td>" + esc(x.overriddenByName) + "</td><td class='rpMuted'>" + esc(x.overriddenAt) + "</td></tr>";
            }).join("");
            var auditTable = (o.overrides || []).length
                ? "<div class='rpSecTitle' style='margin-top:16px'>Override Audit Trail</div>" +
                    "<table class='rpTable'><thead><tr><th>Employee</th><th>Project</th><th>Before → After</th><th>Reason</th><th>Overridden By</th><th>When</th></tr></thead><tbody>" + aud + "</tbody></table>"
                : "";
            return "<div class='rpOverSection'><div class='rpSecTitle'>⚠ Over-Utilized Employees</div>" + table + auditTable + "</div>";
        },

        _renderFilters: function () {
            var f = this._filters;
            var deptOpts = "<option value=''>All Departments</option>" + (this._depts || []).map(function (x) {
                return "<option value='" + esc(x) + "'" + (f.department === x ? " selected" : "") + ">" + esc(x) + "</option>";
            }).join("");
            var STATUSES = ["", "Available", "Busy", "Nearly Full", "Overallocated"];
            var statusOpts = STATUSES.map(function (s) {
                return "<option value='" + esc(s) + "'" + (f.status === s ? " selected" : "") + ">" + (s || "All Statuses") + "</option>";
            }).join("");
            return "<div class='rpFilters'>" +
                "<input type='text' class='rpFInput' id='rpfName' placeholder='Search name / ID…' value='" + esc(f.nameSearch) + "'/>" +
                "<input type='text' class='rpFInput' id='rpfSkill' placeholder='Skill (e.g. node.js)…' value='" + esc(f.skill) + "'/>" +
                "<select class='rpFInput' id='rpfDept'>" + deptOpts + "</select>" +
                "<select class='rpFInput' id='rpfStatus'>" + statusOpts + "</select>" +
                "<input type='number' min='0' max='200' class='rpFInput sm' id='rpfMin' placeholder='Util ≥' value='" + esc(f.minUtil) + "'/>" +
                "<input type='number' min='0' max='200' class='rpFInput sm' id='rpfMax' placeholder='Util ≤' value='" + esc(f.maxUtil) + "'/>" +
                "<label class='rpFLbl'>Available by <input type='date' class='rpFInput' id='rpfAvail' value='" + esc(f.availabilityDate) + "'/></label>" +
                "<button class='rpBtn primary' onclick='window._rpCtrl.onApply()'>Apply</button>" +
                "<button class='rpBtn ghost' onclick='window._rpCtrl.onClear()'>Clear</button>" +
                "</div>";
        },

        _renderGrid: function (rows, isReco) {
            rows = rows || [];
            if (!rows.length) return "<div class='rpEmpty'>No employees match the current filters.</div>";
            var cards = rows.map(function (r) { return this._card(r, isReco); }, this).join("");
            return "<div class='rpGrid'>" + cards + "</div>";
        },

        _card: function (r, isReco) {
            var st = STATUS_STYLE[r.status] || STATUS_STYLE.Busy;
            var uc = utilColor(r.utilizationPct);
            var skills = (r.skills || []).length
                ? (r.skills || []).map(function (s) {
                    var hit = isReco && (r.matchedSkills || []).indexOf(s) !== -1;
                    return "<span class='rpSkill" + (hit ? " hit" : "") + "'>" + esc(s) + "</span>";
                }).join("")
                : "<span class='rpMuted'>No skills listed</span>";
            var projs = (r.currentProjects || []).length
                ? (r.currentProjects || []).map(function (p) {
                    return "<span class='rpProj'>" + esc(p.projectName) + " · " + (p.bandwidth || 0) + "%</span>";
                }).join("")
                : "<span class='rpMuted'>Unassigned</span>";
            var availLbl = r.availableToday ? "Available now"
                : (r.nextAvailableDate ? "From " + esc(r.nextAvailableDate) : "Fully booked");
            var recoBadge = isReco
                ? "<div class='rpScore" + (r.recommended ? " rec" : "") + "'>" +
                    "<span class='rpScoreNum'>" + (r.score || 0) + "</span><span class='rpScoreLbl'>match</span></div>"
                : "";
            var missing = (isReco && (r.missingSkills || []).length)
                ? "<div class='rpMissing'>Missing: " + (r.missingSkills || []).map(esc).join(", ") + "</div>" : "";
            return "<div class='rpCard" + (isReco && r.recommended ? " recommended" : "") + "'>" +
                (isReco && r.recommended ? "<div class='rpRecRibbon'>★ Recommended</div>" : "") +
                "<div class='rpCardTop'>" +
                "<div class='rpAvatar' style='background:" + uc + "22;color:" + uc + "'>" + esc(initials(r.employeeName).toUpperCase()) + "</div>" +
                "<div class='rpWho'><div class='rpName'>" + esc(r.employeeName) + "</div>" +
                "<div class='rpRole'>" + esc(r.designation || "—") + " · " + esc(r.department) + "</div></div>" +
                "<span class='rpBadge' style='background:" + st.bg + ";color:" + st.fg + "'>" + esc(r.status) + "</span>" +
                recoBadge +
                "</div>" +
                (isReco ? "<div class='rpRecMeta'>Skill match <b>" + (r.skillMatchPct || 0) + "%</b> · Capacity <b>" + (r.capacityPct || 0) + "%</b>" +
                    (r.requiredRole ? " · Role " + (r.roleMatched ? "<b style='color:#16a34a'>✓ match</b>" : "<span style='color:#dc2626'>no match</span>") : "") +
                    (r.costRatePerHour > 0 ? " · Rate <b>₹" + Number(r.costRatePerHour).toLocaleString("en-IN") + "/hr</b>" + (r.estimatedAllocationCost > 0 ? " · Est <b>₹" + Number(r.estimatedAllocationCost).toLocaleString("en-IN") + "</b>" : "") : "") +
                    (r.fitsBandwidth ? "" : " · <span style='color:#dc2626'>exceeds bandwidth</span>") + "</div>" + missing : "") +
                "<div class='rpUtilRow'><div class='rpBar'><div class='rpBarFill' style='width:" + Math.min(100, r.utilizationPct) + "%;background:" + uc + "'></div></div>" +
                "<span class='rpUtilPct' style='color:" + uc + "'>" + r.utilizationPct + "%</span></div>" +
                "<div class='rpStats'>" +
                "<div><span class='rpStatVal'>" + r.freeHours + "h</span><span class='rpStatLbl'>Free</span></div>" +
                "<div><span class='rpStatVal'>" + r.allocatedHours + "h</span><span class='rpStatLbl'>Allocated</span></div>" +
                "<div><span class='rpStatVal'>" + r.effectiveCapacityHours + "h</span><span class='rpStatLbl'>Capacity</span></div>" +
                "<div><span class='rpStatVal'>" + esc(availLbl) + "</span><span class='rpStatLbl'>Availability</span></div>" +
                "</div>" +
                "<div class='rpSection'><div class='rpSecLbl'>Skills</div><div class='rpChips'>" + skills + "</div></div>" +
                "<div class='rpSection'><div class='rpSecLbl'>Current Projects</div><div class='rpChips'>" + projs + "</div></div>" +
                "</div>";
        },

        // ── Recommendation mode ─────────────────────────────────────────────────────
        _renderRecommend: function () {
            var rc = this._reco;
            var form = "<div class='rpRecForm'>" +
                "<div class='rpRecFormHead'>Find the best-fit employees</div>" +
                "<div class='rpRecFormRow'>" +
                "<input type='text' class='rpFInput grow' id='rpRecSkills' placeholder='Required skills (e.g. Node.js, HANA, SAP UI5)' value='" + esc(rc.requiredSkills) + "'/>" +
                "<input type='text' class='rpFInput' id='rpRecRole' placeholder='Required role (e.g. SAP BTP Developer)' value='" + esc(rc.requiredRole || "") + "'/>" +
                "<input type='number' min='0' max='100' step='25' class='rpFInput sm' id='rpRecBw' placeholder='Bandwidth %' value='" + (rc.neededBandwidth || "") + "'/>" +
                "<button class='rpBtn primary' onclick='window._rpCtrl.onRank()'>Rank</button>" +
                "</div>" +
                "<div class='rpRecHint'>Ranking weights: <b>70%</b> skill match + <b>30%</b> free capacity. ★ Recommended = skill match ≥ 50%, has free hours, and fits the requested bandwidth.</div>" +
                "</div>";
            var results = this._recoResults
                ? this._renderGrid(this._recoResults.recommendations, true)
                : "<div class='rpEmpty'>Enter required skills and click Rank to see recommended employees.</div>";
            return form + results;
        },

        // ── Handlers ────────────────────────────────────────────────────────────────
        onMode: function (m) { this._mode = m; this._render(); },

        _readFilters: function () {
            var v = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
            this._filters = {
                nameSearch: (v("rpfName") || "").trim(),
                skill: (v("rpfSkill") || "").trim(),
                department: v("rpfDept") || "",
                status: v("rpfStatus") || "",
                minUtil: v("rpfMin") || "",
                maxUtil: v("rpfMax") || "",
                availabilityDate: v("rpfAvail") || ""
            };
        },
        onApply: function () { this._readFilters(); this._load(); },
        onClear: function () {
            this._filters = { skill: "", department: "", minUtil: "", maxUtil: "", availabilityDate: "", nameSearch: "", status: "" };
            this._load();
        },

        onRank: function () {
            var that = this;
            var sk = document.getElementById("rpRecSkills"); var bw = document.getElementById("rpRecBw"); var rl = document.getElementById("rpRecRole");
            this._reco = { requiredSkills: (sk ? sk.value : "").trim(), requiredRole: (rl ? rl.value : "").trim(), neededBandwidth: parseInt(bw ? bw.value : "0", 10) || 0 };
            if (!this._reco.requiredSkills && !this._reco.requiredRole) { MessageToast.show("Enter required skills or a required role."); return; }
            ppost("recommendResources", { requiredSkills: this._reco.requiredSkills, requiredRole: this._reco.requiredRole, neededBandwidth: this._reco.neededBandwidth, limit: 50 })
                .then(function (d) {
                    if (d && d.error) { MessageToast.show(d.error); return; }
                    that._recoResults = d || { recommendations: [] };
                    that._render();
                }).catch(function () { MessageToast.show("Could not rank resources."); });
        }
    });
});
