sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    function ppost(action, params) {
        return fetch("/employee/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

    var FILTERS = [
        { key: "upcoming",  label: "Upcoming" },
        { key: "ongoing",   label: "Ongoing" },
        { key: "completed", label: "Completed" },
        { key: "cancelled", label: "Cancelled" },
        { key: "today",     label: "Today" },
        { key: "week",      label: "This Week" },
        { key: "month",     label: "This Month" },
        { key: "all",       label: "All" }
    ];
    var STATUS_COLOR = { Scheduled: "#2563eb", Completed: "#16a34a", Cancelled: "#dc2626" };

    return Controller.extend("timesheet.app.controller.Meetings", {
        onInit: function () {
            window._mtgCtrl = this;
            this._filter = "upcoming";
            this.getOwnerComponent().getRouter().getRoute("meetings").attachPatternMatched(this._load, this);
        },
        onExit: function () { if (window._mtgCtrl === this) window._mtgCtrl = null; },
        _host: function () { return this.byId("mtgHost"); },

        _load: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='pmWrap'><div class='pmLoading'>Loading meetings…</div></div>");
            ppost("getMyMeetings", { filter: this._filter }).then(function (d) {
                that._data = d || { meetings: [] };
                that._render();
            }).catch(function () { that._data = { meetings: [] }; that._render(); });
        },

        onFilter: function (key) { this._filter = key; this._load(); },
        onSearch: function (val) {
            this._search = (val || "").toLowerCase();
            this._render();
            // Keep focus + caret in the search box after re-render.
            var el = document.getElementById("mtgSearch");
            if (el) { el.focus(); el.value = val; }
        },

        _render: function () {
            var that = this, h = this._host(); if (!h) return;
            var meetings = (this._data && this._data.meetings) || [];
            // Client-side search by meeting name / project / date.
            var q = this._search || "";
            if (q) {
                meetings = meetings.filter(function (m) {
                    return (String(m.title || "").toLowerCase().indexOf(q) !== -1) ||
                        (String(m.projectName || "").toLowerCase().indexOf(q) !== -1) ||
                        (String(m.dateLabel || "").toLowerCase().indexOf(q) !== -1);
                });
            }

            var filterHtml = "<div class='pmFilterBar'>" + FILTERS.map(function (f) {
                var active = f.key === that._filter;
                return "<button class='pmFilterBtn" + (active ? " active" : "") + "' onclick=\"window._mtgCtrl.onFilter('" + f.key + "')\">" + f.label + "</button>";
            }).join("") +
                "<input type='text' id='mtgSearch' class='pmFInput' placeholder='Search name / project / date…' value='" + esc(q) + "' oninput=\"window._mtgCtrl.onSearch(this.value)\" style='margin-left:auto;min-width:220px'/>" +
                "</div>";

            var teamsIcon = '<path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/><path d="M8 10h8M8 14h5"/>';

            var rows = meetings.map(function (m) {
                var sc = STATUS_COLOR[m.status] || "#6b7280";
                var joinBtn = m.teamsJoinUrl && m.status === "Scheduled"
                    ? "<a href='" + esc(m.teamsJoinUrl) + "' target='_blank' rel='noopener' class='pmBtn primary sm' style='text-decoration:none;background:#5b5fc7;'>Join Teams</a>" : "";
                var todayBadge = m.isToday ? "<span style='margin-left:6px;padding:1px 6px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:0.68rem;font-weight:700;'>TODAY</span>" : "";
                return "<tr>" +
                    "<td><b>" + esc(m.title) + "</b>" + todayBadge + "</td>" +
                    "<td>" + esc(m.projectName || "—") + "</td>" +
                    "<td>" + esc(m.dateLabel) + "</td>" +
                    "<td>" + esc(m.timeLabel) + "</td>" +
                    "<td><span style='color:" + sc + ";font-weight:600;font-size:0.8rem;'>" + esc(m.status) + "</span></td>" +
                    "<td>" + esc(m.organizer) + "</td>" +
                    "<td>" + joinBtn + "</td></tr>";
            }).join("");

            var header = "<div class='pmHeader'><div class='pmTitle'>" +
                "<svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#5b5fc7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='margin-right:8px;vertical-align:middle;'>" + teamsIcon + "</svg>" +
                "My Meetings</div><div class='pmSub'>Your scheduled, upcoming, and past Teams meetings</div></div>";

            var table = rows
                ? "<table class='pmTable'><thead><tr><th>Meeting</th><th>Project</th><th>Date</th><th>Time</th><th>Status</th><th>Organizer</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>"
                : "<div class='pmEmpty'>No meetings found for this filter.</div>";

            h.setContent("<div class='pmWrap'>" + header + filterHtml + "<div class='pmPanel'>" + table + "</div></div>");
        }
    });
});
