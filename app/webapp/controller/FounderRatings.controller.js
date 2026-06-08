sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage"
], function (Controller, FounderSidebar, FP) {
    "use strict";

    function ratingCls(v) { return v >= 4.5 ? "ok" : v >= 3.5 ? "info" : v >= 2.5 ? "warn" : "crit"; }
    function stars(v) {
        var n = Math.round(v);
        return "<span class='ftStars'>" + "★★★★★".slice(0, n) + "<span class='ftStarsOff'>" + "★★★★★".slice(0, 5 - n) + "</span></span>";
    }
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    return Controller.extend("timesheet.app.controller.FounderRatings", {
        onInit: function () {
            window._frCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("founder-ratings")
                .attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { if (window._frCtrl === this) window._frCtrl = null; },
        _onMatched: function () {
            FounderSidebar.attach(this);
            FP.shell.attach(this);
            this._load();
        },
        _host: function () { return this.byId("founderHost"); },

        _load: function () {
            var that = this;
            var h = this._host();
            if (h) h.setContent("<div class='fdRoot'>" + FP.header("Ratings", "Executive performance center") +
                "<div class='fdWrap'><div class='fdLoading'>Loading ratings…</div></div></div>");
            FP.post("getFounderRatings", {}).then(function (d) { that._data = d || {}; that._render(); })
                .catch(function () { that._data = { ratings: [], count: 0, average: 0, departmentOverview: [] }; that._render(); });
        },

        _render: function () {
            var d = this._data || {};
            var head = FP.header("Ratings", "Performance ratings across the organization",
                FP.pill("Reviews", d.count || 0, "#fff") + FP.pill("Avg Rating", (d.average || 0).toFixed(2), "#f59e0b"));

            var toolbar = "<div class='ftToolbar'>" +
                "<div class='frHero'>⭐ Organization average <b>" + (d.average || 0).toFixed(2) + "</b> / 5 · " + (d.count || 0) + " reviews</div>" +
                "<button class='faBtn approve' onclick=\"window._frCtrl.openSubmit()\">＋ Submit Rating</button>" +
                "</div>";

            var dov = (d.departmentOverview || []).map(function (o) {
                return "<div class='frDeptCard fdGlass'>" +
                    "<div class='frDeptName'>" + FP.esc(o.department) + "</div>" +
                    "<div class='frDeptAvg " + ratingCls(o.average) + "-txt'>" + o.average.toFixed(2) + "</div>" +
                    stars(o.average) +
                    "<div class='frDeptCnt'>" + o.count + " review" + (o.count > 1 ? "s" : "") + "</div>" +
                    "</div>";
            }).join("");
            var overview = dov ? "<div class='frSecTitle'>Department Rating Overview</div><div class='frDeptGrid'>" + dov + "</div>" : "";

            var reviews = (d.ratings || []).map(function (r) {
                return "<div class='frCard fdGlass'>" +
                    "<div class='frCardTop'><div><div class='frEmp'>" + FP.esc(r.employee) + "</div>" +
                      "<div class='frDept'>" + FP.esc(r.department) + " · " + FP.esc(r.period) + "</div></div>" +
                      "<span class='fdPillStatus " + ratingCls(r.rating) + "'>" + r.rating.toFixed(1) + "</span></div>" +
                    "<div class='frCardStars'>" + stars(r.rating) + " <span class='frCat'>" + FP.esc(r.category) + "</span></div>" +
                    (r.comment ? "<div class='frComment'>" + FP.esc(r.comment) + "</div>" : "") +
                    "</div>";
            }).join("") || "<div class='faEmpty fdGlass'>No ratings yet — submit the first review.</div>";
            var reviewSec = "<div class='frSecTitle'>Recent Reviews</div><div class='frGrid'>" + reviews + "</div>";

            var h = this._host(); if (h) h.setContent(FP.wrap(head, toolbar + overview + reviewSec));
        },

        openSubmit: function () {
            var that = this;
            FP.post("getFounderEmployees", {}).then(function (d) { that._showSubmit(d || {}); })
                .catch(function () { FP.toast("Could not load employees.", false); });
        },
        _showSubmit: function (d) {
            var now = new Date();
            var emps = d.employees || [];
            var empOpts = "<option value=''>— Select employee —</option>" + emps.map(function (e) {
                return "<option value='" + FP.esc(e.employeeId) + "'>" + FP.esc(e.employeeName) + " · " + FP.esc(e.department) + "</option>";
            }).join("");
            var monthOpts = MONTHS.map(function (m, i) { return "<option value='" + (i + 1) + "'" + (i === now.getMonth() ? " selected" : "") + ">" + m + "</option>"; }).join("");
            var yr = now.getFullYear();
            var yearOpts = [yr, yr - 1, yr - 2].map(function (y) { return "<option value='" + y + "'>" + y + "</option>"; }).join("");
            var cats = ["Overall", "Quality", "Productivity", "Teamwork", "Initiative", "Communication"];
            var catOpts = cats.map(function (c) { return "<option value='" + c + "'>" + c + "</option>"; }).join("");
            var ratingBtns = [1, 2, 3, 4, 5].map(function (n) {
                return "<button type='button' class='frStarBtn' data-v='" + n + "'>★</button>";
            }).join("");
            var body =
                "<div class='ffForm'>" +
                  "<label>Employee *<select id='frEmp' class='ffInput'>" + empOpts + "</select></label>" +
                  "<label>Rating *<div class='frStarPick' id='frStars'>" + ratingBtns + "<span class='frStarVal' id='frVal'>0 / 5</span></div></label>" +
                  "<div class='ffRow'>" +
                    "<label>Month *<select id='frMonth' class='ffInput'>" + monthOpts + "</select></label>" +
                    "<label>Year *<select id='frYear' class='ffInput'>" + yearOpts + "</select></label>" +
                    "<label>Category<select id='frCat' class='ffInput'>" + catOpts + "</select></label>" +
                  "</div>" +
                  "<label>Comment<textarea id='frComment' class='ffInput' maxlength='255' placeholder='Feedback for the employee…'></textarea></label>" +
                "</div>" +
                "<div class='fmodFoot'>" +
                  "<button class='faBtn ghost' id='frCancel'>Cancel</button>" +
                  "<button class='faBtn approve' id='frSubmit'>Submit Rating</button>" +
                "</div>";
            var that = this;
            var m = FP.modal({ title: "Submit Performance Rating", sub: "Writes to the shared PerformanceRating table", body: body, wide: true });
            var rating = 0;
            var starBtns = m.body.querySelectorAll(".frStarBtn");
            var valEl = m.body.querySelector("#frVal");
            starBtns.forEach(function (b) {
                b.addEventListener("click", function () {
                    rating = parseInt(b.getAttribute("data-v"), 10);
                    starBtns.forEach(function (x) { x.classList.toggle("on", parseInt(x.getAttribute("data-v"), 10) <= rating); });
                    valEl.textContent = rating + " / 5";
                });
            });
            m.body.querySelector("#frCancel").addEventListener("click", m.close);
            m.body.querySelector("#frSubmit").addEventListener("click", function () {
                var g = function (id) { var el = m.body.querySelector(id); return el ? el.value : ""; };
                var emp = g("#frEmp");
                if (!emp) { FP.toast("Please choose an employee.", false); return; }
                if (!rating) { FP.toast("Please select a star rating.", false); return; }
                this.disabled = true; this.textContent = "Submitting…";
                FP.post("founderSubmitRating", {
                    employeeId: emp, ratingValue: rating,
                    reviewMonth: parseInt(g("#frMonth"), 10), reviewYear: parseInt(g("#frYear"), 10),
                    ratingCategory: g("#frCat"), reviewComment: g("#frComment")
                }).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast(res && res.updated ? "Rating updated." : "Rating submitted.");
                    that._load();
                }).catch(function () { m.close(); FP.toast("Could not submit the rating.", false); });
            });
        }
    });
});
