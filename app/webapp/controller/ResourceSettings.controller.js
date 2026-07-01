sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
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

    // Recommendation-weight + capacity-basis fields driving the central engine.
    var WEIGHTS = [
        { id: "skillWeight", label: "Skill Match %" },
        { id: "availabilityWeight", label: "Availability %" },
        { id: "utilizationWeight", label: "Utilization %" },
        { id: "experienceWeight", label: "Experience %" }
    ];
    var BASIS = [
        { id: "maxUtilizationThreshold", label: "Max Utilization %" },
        { id: "standardDailyHours", label: "Standard Daily Hours" },
        { id: "standardWorkingDays", label: "Working Days / Month" },
        { id: "nonBillablePct", label: "Non-Billable Reserve %" },
        { id: "monthlyOverhead", label: "Monthly Overhead / Employee (₹)" }
    ];

    return Controller.extend("timesheet.app.controller.ResourceSettings", {
        onInit: function () {
            window._rpsCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("resource-settings").attachPatternMatched(this._load, this);
        },
        onExit: function () { if (window._rpsCtrl === this) window._rpsCtrl = null; },
        _host: function () { return this.byId("rpsHost"); },

        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='rpWrap'><div class='rpLoading'>Loading settings…</div></div>");
            Promise.all([
                ppost("getResourcePlanningConfig", {}),
                ppost("getCompanyEvents", {}).catch(function () { return { events: [] }; })
            ]).then(function (rr) {
                if (rr[0] && rr[0].error) { if (h) h.setContent("<div class='rpWrap'><div class='rpEmpty'>" + esc(rr[0].error) + "</div></div>"); return; }
                that._cfg = (rr[0] && rr[0].config) || {};
                that._canEdit = !!(rr[0] && rr[0].canEdit);
                that._events = (rr[1] && rr[1].events) || [];
                that._render();
            }).catch(function () { if (h) h.setContent("<div class='rpWrap'><div class='rpEmpty'>Could not load settings.</div></div>"); });
        },

        _render: function () {
            var h = this._host(); if (!h) return;
            var c = this._cfg || {}, ro = this._canEdit ? "" : " disabled";
            var fld = function (f) {
                return "<div class='rpsField'><label>" + esc(f.label) + "</label>" +
                    "<input type='number' id='rps_" + f.id + "' value='" + (c[f.id] != null ? c[f.id] : "") + "'" + ro + "/></div>";
            };
            var wSum = WEIGHTS.reduce(function (s, f) { return s + (Number(c[f.id]) || 0); }, 0);
            var header = "<div class='rpHeader'><div><div class='rpTitle'>Resource Planning Settings</div>" +
                "<div class='rpSub'>Central engine configuration — used by every utilization, forecast & recommendation calculation</div></div></div>";

            var weightsCard = "<div class='rpsCard'><div class='rpSecTitle'>Recommendation Weights</div>" +
                "<div class='rpsHint'>Weights are normalised at runtime (current total: <b id='rpsWSum'>" + wSum + "</b>). Defaults 60 / 20 / 10 / 10.</div>" +
                "<div class='rpsForm'>" + WEIGHTS.map(fld).join("") + "</div></div>";
            var basisCard = "<div class='rpsCard'><div class='rpSecTitle'>Capacity Basis</div>" +
                "<div class='rpsHint'>Effective capacity = Capacity − Holidays/Events − Leave − Training − Internal − Reserve.</div>" +
                "<div class='rpsForm'>" + BASIS.map(fld).join("") + "</div>" +
                (this._canEdit ? "<div style='margin-top:14px'><button class='rpBtn primary' onclick='window._rpsCtrl.onSave()'>Save Settings</button></div>"
                    : "<div class='rpsHint'>You have read-only access (Founder/HR can edit).</div>") + "</div>";

            var evtRows = (this._events || []).map(function (e) {
                return "<tr><td><b>" + esc(e.eventName) + "</b></td><td>" + esc(e.fromDate) + " → " + esc(e.toDate) + "</td>" +
                    "<td>" + esc(e.description || "") + "</td>" +
                    (this._canEdit ? "<td><button class='pmLink danger' onclick=\"window._rpsCtrl.onDeleteEvent('" + esc(e.eventId) + "')\">Delete</button></td>" : "<td></td>") + "</tr>";
            }, this).join("");
            var evtCard = "<div class='rpsCard'><div class='rpSecTitle'>Company Events <span class='rpsHint'>(non-working time that reduces everyone's capacity)</span>" +
                (this._canEdit ? " <button class='rpBtn primary' style='float:right' onclick='window._rpsCtrl.onAddEvent()'>＋ Add Event</button>" : "") + "</div>" +
                (evtRows ? "<table class='rpTable'><thead><tr><th>Event</th><th>Dates</th><th>Description</th><th></th></tr></thead><tbody>" + evtRows + "</tbody></table>"
                    : "<div class='rpMuted'>No company events defined.</div>") + "</div>";

            h.setContent("<div class='rpWrap'>" + header + weightsCard + basisCard + evtCard + "</div>");
            var that = this;
            WEIGHTS.forEach(function (f) {
                var el = document.getElementById("rps_" + f.id);
                if (el) el.addEventListener("input", function () {
                    var s = WEIGHTS.reduce(function (a, w) { var v = document.getElementById("rps_" + w.id); return a + (Number(v && v.value) || 0); }, 0);
                    var sum = document.getElementById("rpsWSum"); if (sum) sum.textContent = s;
                });
            });
        },

        onSave: function () {
            var that = this;
            var v = function (id) { var el = document.getElementById("rps_" + id); return el ? Number(el.value) || 0 : 0; };
            var payload = {};
            WEIGHTS.concat(BASIS).forEach(function (f) { payload[f.id] = v(f.id); });
            ppost("saveResourcePlanningConfig", payload).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Settings saved — calculations updated across the system.");
                that._load();
            }).catch(function () { MessageToast.show("Could not save settings."); });
        },

        onAddEvent: function () {
            var that = this, today = new Date().toISOString().slice(0, 10);
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Add Company Event</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Event Name *</label><input type='text' class='pmFInput' id='evName' placeholder='e.g. Annual Offsite'/>" +
                "<div class='pmFRow'><div><label class='pmFLbl'>From *</label><input type='date' class='pmFInput' id='evFrom' value='" + today + "'/></div>" +
                "<div><label class='pmFLbl'>To *</label><input type='date' class='pmFInput' id='evTo' value='" + today + "'/></div></div>" +
                "<label class='pmFLbl'>Description</label><input type='text' class='pmFInput' id='evDesc'/>" +
                "<div class='pmErr' id='evErr' style='display:none'></div>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='evCancel'>Cancel</button><button class='pmBtn primary' id='evSave'>Add</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#evCancel").addEventListener("click", close);
            ov.querySelector("#evSave").addEventListener("click", function () {
                var name = (ov.querySelector("#evName").value || "").trim();
                var from = ov.querySelector("#evFrom").value, to = ov.querySelector("#evTo").value;
                if (!name) { var e = ov.querySelector("#evErr"); e.textContent = "⚠ Event name is required."; e.style.display = "block"; return; }
                ppost("saveCompanyEvent", { eventName: name, fromDate: from, toDate: to, description: (ov.querySelector("#evDesc").value || "").trim() })
                    .then(function (res) {
                        if (res && res.error) { var er = ov.querySelector("#evErr"); er.textContent = "⚠ " + res.error; er.style.display = "block"; return; }
                        close(); MessageToast.show("Company event added — capacity recalculated."); that._load();
                    }).catch(function () { MessageToast.show("Could not add event."); });
            });
        },

        onDeleteEvent: function (eventId) {
            var that = this;
            ppost("deleteCompanyEvent", { eventId: eventId }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                MessageToast.show("Event removed."); that._load();
            }).catch(function () { MessageToast.show("Could not remove event."); });
        }
    });
});
