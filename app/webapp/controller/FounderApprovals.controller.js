sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage"
], function (Controller, FounderSidebar, FP) {
    "use strict";

    return Controller.extend("timesheet.app.controller.FounderApprovals", {
        onInit: function () {
            window._faCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("founder-approvals")
                .attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { if (window._faCtrl === this) window._faCtrl = null; },
        _onMatched: function () {
            FounderSidebar.attach(this);
            FP.shell.attach(this);
            this._tab = this._tab || "timesheets";
            this._load();
        },
        _host: function () { return this.byId("founderHost"); },

        _load: function () {
            var that = this;
            var h = this._host();
            if (h) h.setContent("<div class='fdRoot'>" + FP.header("Approvals", "Executive approval center") +
                "<div class='fdWrap'><div class='fdLoading'>Loading pending approvals…</div></div></div>");
            FP.post("getFounderApprovals", {}).then(function (d) { that._data = d || {}; that._render(); })
                .catch(function () { that._data = { timesheets: [], leaves: [], counts: {} }; that._render(); });
        },

        _render: function () {
            var d = this._data || {}, c = d.counts || {};
            var ts = d.timesheets || [], lv = d.leaves || [], fr = d.fillRequests || [];
            var head = FP.header("Approvals", "Pending decisions across the organization",
                FP.pill("Timesheets", c.timesheets || 0, "#38bdf8") + FP.pill("Leaves", c.leaves || 0, "#a78bfa") +
                FP.pill("Fill Requests", c.fillRequests || 0, "#34d399"));

            var summary = "<div class='faSummary'>" +
                this._sumTile("📋", "#38bdf8", c.timesheets || 0, "Timesheets Awaiting Review") +
                this._sumTile("🌴", "#a78bfa", c.leaves || 0, "Leave Requests Awaiting Approval") +
                this._sumTile("📝", "#34d399", c.fillRequests || 0, "Timesheet Fill Requests") +
                "</div>";

            var tabs = "<div class='faTabs'>" +
                "<button class='" + (this._tab === "timesheets" ? "active" : "") + "' onclick=\"window._faCtrl.onTab('timesheets')\">📋 Timesheets (" + (c.timesheets || 0) + ")</button>" +
                "<button class='" + (this._tab === "leaves" ? "active" : "") + "' onclick=\"window._faCtrl.onTab('leaves')\">🌴 Leaves (" + (c.leaves || 0) + ")</button>" +
                "<button class='" + (this._tab === "fill" ? "active" : "") + "' onclick=\"window._faCtrl.onTab('fill')\">📝 Fill Requests (" + (c.fillRequests || 0) + ")</button>" +
                "</div>";

            var cards;
            if (this._tab === "timesheets") {
                cards = ts.length ? ts.map(this._tsCard.bind(this)).join("") : this._empty("No timesheets awaiting your review.");
            } else if (this._tab === "fill") {
                cards = fr.length ? fr.map(this._frCard.bind(this)).join("") : this._empty("No timesheet fill requests pending.");
            } else {
                cards = lv.length ? lv.map(this._lvCard.bind(this)).join("") : this._empty("No leave requests awaiting your approval.");
            }

            var body = summary + tabs + "<div class='faCards'>" + cards + "</div>";
            var h = this._host(); if (h) h.setContent(FP.wrap(head, body));
        },

        _sumTile: function (ico, col, val, label) {
            return "<div class='faSumTile fdGlass'><div class='faSumIco' style='background:" + col + "22;color:" + col + "'>" + ico + "</div>" +
                "<div><div class='faSumVal'>" + val + "</div><div class='faSumLbl'>" + FP.esc(label) + "</div></div></div>";
        },
        _empty: function (msg) { return "<div class='faEmpty fdGlass'>🎉 " + FP.esc(msg) + "</div>"; },
        _avatar: function (name) {
            var p = String(name || "?").trim().split(/\s+/);
            var ini = ((p[0] && p[0][0]) || "?").toUpperCase() + (p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0].toUpperCase() : "");
            return "<div class='faAvatar'>" + FP.esc(ini) + "</div>";
        },

        _tsCard: function (r) {
            return "<div class='faCard fdGlass'>" +
                "<div class='faCardTop'>" + this._avatar(r.employee) +
                  "<div class='faWho'><div class='faName'>" + FP.esc(r.employee) + "</div>" +
                  "<div class='faDept'>" + FP.esc(r.department) + "</div></div>" +
                  "<span class='fdPillStatus warn'>" + FP.esc(r.status) + "</span></div>" +
                "<div class='faMeta'>" +
                  "<div><span>Week</span><b>" + FP.esc(r.week) + "</b></div>" +
                  "<div><span>Submitted</span><b>" + FP.esc(r.submittedOn || "—") + "</b></div>" +
                "</div>" +
                "<div class='faActions'>" +
                  "<button class='faBtn approve' onclick=\"window._faCtrl.decideTs('" + FP.esc(r.timesheetId) + "',true)\">✓ Approve</button>" +
                  "<button class='faBtn reject' onclick=\"window._faCtrl.decideTs('" + FP.esc(r.timesheetId) + "',false)\">✕ Reject</button>" +
                "</div></div>";
        },
        _lvCard: function (r) {
            return "<div class='faCard fdGlass'>" +
                "<div class='faCardTop'>" + this._avatar(r.employee) +
                  "<div class='faWho'><div class='faName'>" + FP.esc(r.employee) + "</div>" +
                  "<div class='faDept'>" + FP.esc(r.department) + "</div></div>" +
                  "<span class='fdPillStatus info'>" + FP.esc(r.leaveType) + "</span></div>" +
                "<div class='faMeta'>" +
                  "<div><span>Dates</span><b>" + FP.esc(r.from) + " → " + FP.esc(r.to) + "</b></div>" +
                  "<div><span>Days</span><b>" + FP.esc(r.days) + "</b></div>" +
                  (r.reason ? "<div class='faReason'><span>Reason</span><b>" + FP.esc(r.reason) + "</b></div>" : "") +
                "</div>" +
                "<div class='faActions'>" +
                  "<button class='faBtn approve' onclick=\"window._faCtrl.decideLv('" + FP.esc(r.leaveId) + "',true)\">✓ Approve</button>" +
                  "<button class='faBtn reject' onclick=\"window._faCtrl.decideLv('" + FP.esc(r.leaveId) + "',false)\">✕ Reject</button>" +
                "</div></div>";
        },

        _frCard: function (r) {
            var ico = r.kind === "prevweek" ? "📅" : "🔓";
            return "<div class='faCard fdGlass'>" +
                "<div class='faCardTop'>" + this._avatar(r.employee) +
                  "<div class='faWho'><div class='faName'>" + FP.esc(r.employee) + "</div>" +
                  "<div class='faDept'>" + FP.esc(r.department) + "</div></div>" +
                  "<span class='fdPillStatus ok'>" + ico + " " + FP.esc(r.title) + "</span></div>" +
                "<div class='faMeta'>" +
                  "<div><span>" + (r.kind === "prevweek" ? "Week" : "Date") + "</span><b>" + FP.esc(r.detail) + "</b></div>" +
                  "<div><span>Requested</span><b>" + FP.esc(r.requestedOn || "—") + "</b></div>" +
                  (r.reason ? "<div class='faReason'><span>Reason</span><b>" + FP.esc(r.reason) + "</b></div>" : "") +
                "</div>" +
                "<div class='faActions'>" +
                  "<button class='faBtn approve' onclick=\"window._faCtrl.decideFr('" + FP.esc(r.kind) + "','" + FP.esc(r.requestId) + "',true)\">✓ Approve</button>" +
                  "<button class='faBtn reject' onclick=\"window._faCtrl.decideFr('" + FP.esc(r.kind) + "','" + FP.esc(r.requestId) + "',false)\">✕ Reject</button>" +
                "</div></div>";
        },

        onTab: function (t) { this._tab = t; this._render(); },

        decideTs: function (id, approve) { this._decide("timesheet", id, approve); },
        decideLv: function (id, approve) { this._decide("leave", id, approve); },
        decideFr: function (kind, id, approve) {
            var that = this;
            var verb = approve ? "Approve" : "Reject";
            var body =
                "<p class='fmodP'>" + verb + " this timesheet fill request? An optional note will be sent to the employee.</p>" +
                "<textarea class='fmodTextarea' id='faRemarks' placeholder='Remarks (optional)'></textarea>" +
                "<div class='fmodFoot'>" +
                  "<button class='faBtn ghost' id='faCancel'>Cancel</button>" +
                  "<button class='faBtn " + (approve ? "approve" : "reject") + "' id='faConfirm'>" + verb + "</button>" +
                "</div>";
            var m = FP.modal({ title: verb + " Fill Request", body: body });
            m.body.querySelector("#faCancel").addEventListener("click", m.close);
            m.body.querySelector("#faConfirm").addEventListener("click", function () {
                var remarks = (m.body.querySelector("#faRemarks") || {}).value || "";
                this.disabled = true; this.textContent = "Working…";
                FP.post("founderDecideFillRequest", { kind: kind, requestId: id, approve: approve, remarks: remarks }).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Fill request " + (approve ? "approved" : "rejected") + ".");
                    that._load();
                }).catch(function () { m.close(); FP.toast("Could not complete the action.", false); });
            });
        },
        _decide: function (kind, id, approve) {
            var that = this;
            var verb = approve ? "Approve" : "Reject";
            var body =
                "<p class='fmodP'>" + verb + " this " + kind + "? An optional note will be sent to the employee.</p>" +
                "<textarea class='fmodTextarea' id='faRemarks' placeholder='Remarks (optional)'></textarea>" +
                "<div class='fmodFoot'>" +
                  "<button class='faBtn ghost' id='faCancel'>Cancel</button>" +
                  "<button class='faBtn " + (approve ? "approve" : "reject") + "' id='faConfirm'>" + verb + "</button>" +
                "</div>";
            var m = FP.modal({ title: verb + " " + kind.charAt(0).toUpperCase() + kind.slice(1), body: body });
            m.body.querySelector("#faCancel").addEventListener("click", m.close);
            m.body.querySelector("#faConfirm").addEventListener("click", function () {
                var remarks = (m.body.querySelector("#faRemarks") || {}).value || "";
                this.disabled = true; this.textContent = "Working…";
                var action = kind === "timesheet" ? "founderDecideTimesheet" : "founderDecideLeave";
                var params = kind === "timesheet"
                    ? { timesheetId: id, approve: approve, remarks: remarks }
                    : { leaveId: id, approve: approve, remarks: remarks };
                FP.post(action, params).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast(kind.charAt(0).toUpperCase() + kind.slice(1) + " " + (approve ? "approved" : "rejected") + ".");
                    that._load();
                }).catch(function () { m.close(); FP.toast("Could not complete the action.", false); });
            });
        }
    });
});
