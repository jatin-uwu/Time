sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    // POST to a /project action (salary master lives in ProjectService) and parse.
    function ppost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function money(n) { return n ? "₹" + Number(n).toLocaleString("en-IN") : "—"; }

    return Controller.extend("timesheet.app.controller.SalaryMaster", {
        onInit: function () {
            window._salCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("salary-master").attachPatternMatched(this._load, this);
        },
        onExit: function () { if (window._salCtrl === this) window._salCtrl = null; },
        _host: function () { return this.byId("salHost"); },

        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='pmWrap'><div class='pmLoading'>Loading salary master…</div></div>");
            Promise.all([
                fetch("/employee/Employees?$select=employeeId,employeeName,department,isActive&$top=500", { headers: { Accept: "application/json" }, credentials: "include" })
                    .then(function (r) { return r.json(); }).then(function (j) { return (j && j.value) || []; }).catch(function () { return []; }),
                ppost("getEmployeeSalaries", {}).catch(function () { return { salaries: [] }; })
            ]).then(function (res) {
                var emps = res[0].filter(function (e) { return e.isActive !== false; });
                var salResp = res[1] || {};
                if (salResp.error) { if (h) h.setContent("<div class='pmWrap'><div class='pmEmpty'>" + esc(salResp.error) + "</div></div>"); return; }
                var salById = {}; (salResp.salaries || []).forEach(function (s) { salById[s.employeeId] = s; });
                that._rows = emps.map(function (e) {
                    var s = salById[e.employeeId] || {};
                    return { employeeId: e.employeeId, employeeName: e.employeeName, department: e.department || "—",
                        annualSalary: s.annualSalary || 0, hourlyCost: s.hourlyCost || 0, effectiveFrom: s.effectiveFrom || "" };
                }).sort(function (a, b) { return (a.employeeName || "").localeCompare(b.employeeName || ""); });
                that._render();
            });
        },

        _render: function () {
            var h = this._host(); if (!h) return;
            var rows = (this._rows || []).map(function (r) {
                var has = r.hourlyCost > 0;
                return "<tr><td><b>" + esc(r.employeeName) + "</b><div class='pmMuted'>" + esc(r.employeeId) + "</div></td>" +
                    "<td>" + esc(r.department) + "</td>" +
                    "<td>" + money(r.annualSalary) + "</td>" +
                    "<td>" + (has ? "₹" + Number(r.hourlyCost).toLocaleString("en-IN") + "/hr" : "<span class='pmMuted'>not set</span>") + "</td>" +
                    "<td>" + esc(r.effectiveFrom || "—") + "</td>" +
                    "<td><button class='pmLink' onclick=\"window._salCtrl.onEdit('" + esc(r.employeeId) + "')\">" + (has ? "Edit" : "Set") + "</button></td></tr>";
            }).join("");
            var body = "<div class='pmWrap'>" +
                "<div class='pmHeader'><div class='pmTitle'>Employee Salary Master</div>" +
                "<div class='pmSub'>Hourly cost drives project budget consumption (cost = hourly × hours logged)</div></div>" +
                "<div class='pmPanel'>" +
                (rows ? "<table class='pmTable'><thead><tr><th>Employee</th><th>Dept</th><th>Annual Salary</th><th>Hourly Cost</th><th>Effective From</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>"
                    : "<div class='pmMuted'>No employees found.</div>") + "</div></div>";
            h.setContent(body);
        },

        onEdit: function (empId) {
            var that = this;
            var row = (this._rows || []).find(function (r) { return r.employeeId === empId; }) || {};
            var today = new Date().toISOString().slice(0, 10);
            var ov = document.createElement("div");
            ov.className = "pmOverlay";
            ov.innerHTML = "<div class='pmDialog'><div class='pmDialogHead'>Salary — " + esc(row.employeeName || empId) + "</div>" +
                "<div class='pmDialogBody'>" +
                "<label class='pmFLbl'>Annual Salary (₹)</label><input type='number' min='0' step='10000' class='pmFInput' id='salAnnual' value='" + (row.annualSalary || "") + "'/>" +
                "<label class='pmFLbl'>Hourly Cost (₹) <span class='pmMuted'>(auto from annual if blank)</span></label><input type='number' min='0' step='1' class='pmFInput' id='salHourly' value='" + (row.hourlyCost || "") + "'/>" +
                "<label class='pmFLbl'>Effective From</label><input type='date' class='pmFInput' id='salEff' value='" + (row.effectiveFrom || today) + "'/>" +
                "</div><div class='pmDialogFoot'><button class='pmBtn ghost' id='salCancel'>Cancel</button><button class='pmBtn primary' id='salSave'>Save</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#salCancel").addEventListener("click", close);
            ov.querySelector("#salSave").addEventListener("click", function () {
                var g = function (id) { var el = ov.querySelector(id); return el ? el.value : ""; };
                var annual = parseFloat(g("#salAnnual")) || 0;
                if (annual <= 0 && parseFloat(g("#salHourly")) <= 0) { MessageToast.show("Enter an annual salary or hourly cost."); return; }
                this.disabled = true; this.textContent = "Saving…";
                ppost("upsertEmployeeSalary", { employeeId: empId, annualSalary: annual, hourlyCost: parseFloat(g("#salHourly")) || 0, effectiveFrom: g("#salEff") }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Salary saved (hourly ₹" + (res.hourlyCost || 0) + ")."); that._load();
                }).catch(function () { close(); MessageToast.show("Could not save the salary."); });
            });
        }
    });
});
