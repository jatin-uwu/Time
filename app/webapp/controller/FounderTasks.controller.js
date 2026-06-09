sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage"
], function (Controller, FounderSidebar, FP) {
    "use strict";

    function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
    function prioCls(p) { var n = norm(p); return n === "high" ? "crit" : n === "low" ? "info" : "warn"; }

    return Controller.extend("timesheet.app.controller.FounderTasks", {
        onInit: function () {
            window._ftCtrl = this;
            this._dept = "All";
            this.getOwnerComponent().getRouter().getRoute("founder-tasks")
                .attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { if (window._ftCtrl === this) window._ftCtrl = null; },
        _onMatched: function () {
            FounderSidebar.attach(this);
            FP.shell.attach(this);
            this._load();
        },
        _host: function () { return this.byId("founderHost"); },

        _load: function () {
            var that = this;
            var h = this._host();
            if (h) h.setContent("<div class='fdRoot'>" + FP.header("Tasks", "Executive task command") +
                "<div class='fdWrap'><div class='fdLoading'>Loading tasks…</div></div></div>");
            FP.post("getFounderTasks", {}).then(function (d) { that._data = d || {}; that._render(); })
                .catch(function () { that._data = { tasks: [], counts: {}, departments: [] }; that._render(); });
        },

        _bucket: function (t) {
            if (t.overdue) return "overdue";
            var s = norm(t.status);
            if (s === "completed" || s === "ended") return "completed";
            if (s === "inprogress" || s === "inreview") return "inprogress";
            return "notstarted";
        },

        _render: function () {
            var d = this._data || {}, c = d.counts || {};
            var head = FP.header("Tasks", "Organization-wide task overview",
                FP.pill("Total", c.total || 0, "#fff") + FP.pill("Completed", c.completed || 0, "#34d399") +
                FP.pill("Overdue", c.overdue || 0, "#fb7185"));

            // Department filter + assign button
            var depts = ["All"].concat(d.departments || []);
            var opts = depts.map(function (x) {
                return "<option value='" + FP.esc(x) + "'" + (x === this._dept ? " selected" : "") + ">" + FP.esc(x === "All" ? "All Departments" : x) + "</option>";
            }.bind(this)).join("");
            var toolbar = "<div class='ftToolbar'>" +
                "<div class='ftFilters'><select id='ftDeptSel' class='fdSelect'>" + opts + "</select></div>" +
                "<button class='faBtn approve' onclick=\"window._ftCtrl.openAssign()\">＋ Assign Task</button>" +
                "</div>";

            // Filter tasks by department
            var tasks = (d.tasks || []).filter(function (t) { return this._dept === "All" || t.department === this._dept; }.bind(this));

            var cols = [
                { key: "notstarted", title: "Not Started", col: "#fbbf24" },
                { key: "inprogress", title: "In Progress", col: "#38bdf8" },
                { key: "completed", title: "Completed", col: "#34d399" },
                { key: "overdue", title: "Overdue", col: "#fb7185" }
            ];
            var that = this;
            var board = "<div class='ftBoard'>" + cols.map(function (col) {
                var items = tasks.filter(function (t) { return that._bucket(t) === col.key; });
                var cards = items.map(that._taskCard.bind(that)).join("") || "<div class='ftColEmpty'>No tasks</div>";
                return "<div class='ftCol'>" +
                    "<div class='ftColHead' style='border-color:" + col.col + "'>" +
                      "<span class='ftColDot' style='background:" + col.col + "'></span>" + col.title +
                      "<span class='ftColCount'>" + items.length + "</span></div>" +
                    "<div class='ftColBody'>" + cards + "</div></div>";
            }).join("") + "</div>";

            var h = this._host(); if (h) { h.setContent(FP.wrap(head, toolbar + board)); }
            setTimeout(function () {
                var sel = document.getElementById("ftDeptSel");
                if (sel) sel.onchange = function () { that._dept = this.value; that._render(); };
            }, 40);
        },

        _taskCard: function (t) {
            var due = t.dueDate ? ("Due " + String(t.dueDate).slice(0, 10)) : "No due date";
            return "<div class='ftCard fdGlass'>" +
                "<div class='ftCardTitle'>" + FP.esc(t.taskName) +
                  (t.type === "group" ? " <span class='ftBadge'>Group</span>" : "") + "</div>" +
                (t.description ? "<div class='ftCardDesc'>" + FP.esc(t.description) + "</div>" : "") +
                "<div class='ftCardFoot'>" +
                  "<span class='fdPillStatus " + prioCls(t.priority) + "'>" + FP.esc(t.priority) + "</span>" +
                  "<span class='ftAssignee'>👤 " + FP.esc(t.assignee) + "</span>" +
                "</div>" +
                "<div class='ftCardMeta'><span>" + FP.esc(t.department) + "</span><span class='" + (t.overdue ? "ftDueCrit" : "") + "'>" + FP.esc(due) + "</span></div>" +
                "</div>";
        },

        // ── Assign Task ───────────────────────────────────────────────────────
        openAssign: function () {
            var that = this;
            FP.post("getFounderEmployees", {}).then(function (d) {
                d = d || {};
                if (!(d.employees || []).length) { FP.toast("No employees assigned to you.", false); return; }
                that._showAssign(d);
            }).catch(function () { FP.toast("Could not load employees.", false); });
        },
        _showAssign: function (d) {
            var emps = d.employees || [];
            var empOpts = "<option value=''>— Select employee —</option>" + emps.map(function (e) {
                return "<option value='" + FP.esc(e.employeeId) + "'>" + FP.esc(e.employeeName) + " · " + FP.esc(e.department) + "</option>";
            }).join("");
            var revOpts = "<option value=''>— No reviewer —</option>" + emps.map(function (e) {
                return "<option value='" + FP.esc(e.employeeId) + "'>" + FP.esc(e.employeeName) + "</option>";
            }).join("");
            var prio = ["High", "Medium", "Low"].map(function (p) { return "<option value='" + p + "'" + (p === "Medium" ? " selected" : "") + ">" + p + "</option>"; }).join("");
            var body =
                "<div class='ffForm'>" +
                  "<label>Task Name *<input id='ffName' class='ffInput' maxlength='100' placeholder='e.g. Q3 Budget Review'/></label>" +
                  "<label>Description<textarea id='ffDesc' class='ffInput' maxlength='255' placeholder='Brief description…'></textarea></label>" +
                  "<div class='ffRow'>" +
                    "<label>Assignee *<select id='ffAssignee' class='ffInput'>" + empOpts + "</select></label>" +
                    "<label>Priority<select id='ffPrio' class='ffInput'>" + prio + "</select></label>" +
                  "</div>" +
                  "<div class='ffRow'>" +
                    "<label>Start Date<input id='ffStart' type='date' class='ffInput'/></label>" +
                    "<label>Due Date<input id='ffDue' type='date' class='ffInput'/></label>" +
                  "</div>" +
                  "<label>Reviewer<select id='ffRev' class='ffInput'>" + revOpts + "</select></label>" +
                "</div>" +
                "<div class='fmodFoot'>" +
                  "<button class='faBtn ghost' id='ffCancel'>Cancel</button>" +
                  "<button class='faBtn approve' id='ffSubmit'>Assign Task</button>" +
                "</div>";
            var that = this;
            var m = FP.modal({ title: "Assign New Task", sub: "Creates a task in the shared TaskMaster", body: body, wide: true });
            m.body.querySelector("#ffCancel").addEventListener("click", m.close);
            m.body.querySelector("#ffSubmit").addEventListener("click", function () {
                var g = function (id) { var el = m.body.querySelector(id); return el ? el.value : ""; };
                var name = (g("#ffName") || "").trim();
                var assignee = g("#ffAssignee");
                if (!name) { FP.toast("Task name is required.", false); return; }
                if (!assignee) { FP.toast("Please choose an assignee.", false); return; }
                this.disabled = true; this.textContent = "Assigning…";
                FP.post("founderAssignTask", {
                    taskName: name, taskDescription: g("#ffDesc"), priority: g("#ffPrio"),
                    startDate: g("#ffStart"), dueDate: g("#ffDue"), assigneeId: assignee, reviewerId: g("#ffRev")
                }).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Task assigned (" + (res && res.taskId) + ").");
                    that._load();
                }).catch(function () { m.close(); FP.toast("Could not assign the task.", false); });
            });
        }
    });
});
