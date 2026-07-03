sap.ui.define(["sap/ui/core/IconPool"], function (IconPool) {
    "use strict";

    // ── App Sidebar (Employee / Manager / HR) ───────────────────────────────────
    // A dedicated, collapsible DOM navigation rail — the same modern Founder/Admin
    // pattern, but driven by a role-based menu. Rendered once into <body>, it pushes
    // the content (the SplitApp master is hidden) so the dashboard reclaims width
    // when collapsed. Reuses the existing routes + sidebar-badge model.

    var CHEVRON_SVG = '<svg class="tsapp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

    function iconChar(name) {
        try { var info = IconPool.getIconInfo(name); return info ? info.content : ""; }
        catch (e) { return ""; }
    }

    // Sections reuse the exact route names + icons of the existing menu.
    // Projects & Meetings are promoted to top-level items (like Dashboard / Rating
    // History) for all non-founder roles — fewer clicks, clearer navigation.
    var COMMON = [
        { items: [{ route: "dashboard", label: "Overview", icon: "home" }] },
        { items: [{ route: "projects", label: "Projects", icon: "tree" }] },
        { items: [{ route: "meetings", label: "Meetings", icon: "appointment-2" }] },
        { title: "Timesheet", items: [
            { route: "timesheet", label: "Fill Timesheet", icon: "add-activity" },
            { route: "history", label: "Timesheet History", icon: "history" }
        ]},
        { title: "Leave", items: [
            { route: "apply-leave", label: "Apply Leave", icon: "away" },
            { route: "leave-history", label: "Leave History", icon: "appointment-2" }
        ]},
        { title: "Task", items: [
            { route: "task-description", label: "Task Description", icon: "notes" },
            { route: "task-status", label: "Task Status", icon: "activity-items" },
            { route: "group-tasks", label: "Group Tasks", icon: "group" }
        ]},
        { items: [{ route: "rating-history", label: "Rating History", icon: "survey" }] }
    ];
    var MANAGER = [{ title: "Management", items: [
        { route: "task-assignment", label: "Assign Task", icon: "create-form" },
        { route: "team-task-status", label: "Team Task Status", icon: "group" },
        { route: "manager", label: "Approvals", icon: "approvals" },
        { route: "approval-history", label: "Approval History", icon: "history" },
        { route: "team-attendance", label: "Team Attendance", icon: "employee-pane" },
        { route: "performance-rating", label: "Performance Rating", icon: "line-chart" },
        { route: "resource-planning", label: "Resource Planning", icon: "org-chart" },
        { route: "resource-settings", label: "Planning Settings", icon: "action-settings" }
    ]}];
    var HR = [{ title: "Human Resources", items: [
        { route: "add-employee", label: "Add Employee", icon: "add-employee" },
        { route: "all-employees", label: "All Employees", icon: "employee" },
        { route: "salary-master", label: "Salary Master", icon: "money-bills" },
        { route: "hr-approvals", label: "HR Approvals", icon: "approvals" }
    ]}];

    function menuFor(role) {
        var m = COMMON.slice();
        if (role === "manager") m = m.concat(MANAGER);
        if (role === "hr") m = m.concat(HR);
        return m;
    }

    var Sidebar = {
        _el: null, _router: null, _model: null, _pinned: false, _role: null, _logo: "",
        _stateListeners: [],

        // Register a callback fired whenever the drawer opens or closes.
        // callback(bOpen: boolean)
        onStateChange: function (fn) { this._stateListeners.push(fn); },

        _fireStateChange: function () {
            var bOpen = document.body.classList.contains("tsRailOpen");
            this._stateListeners.forEach(function (fn) { try { fn(bOpen); } catch (e) { /* */ } });
        },

        attach: function (oController, role, logoUrl) {
            try { this._router = oController.getOwnerComponent().getRouter(); } catch (e) { /* */ }
            try { this._model = oController.getView().getModel("appView"); } catch (e) { /* */ }
            this._logo = logoUrl || "";
            this._ensure();
            if (this._role !== role) { this._role = role; this._rebuild(); }
            if (this._el) this._el.style.display = "flex";
            document.body.classList.add("tsHasRail");   // hide native master; drawer hidden by default
            this._position();
            this._syncActive();
            // Re-measure once the toolbar/layout has settled.
            var self = this;
            setTimeout(function () { self._position(); }, 150);
            setTimeout(function () { self._position(); }, 500);
        },

        detach: function () {
            document.body.classList.remove("tsHasRail", "tsRailOpen");
            if (this._el) { this._el.style.display = "none"; }
        },

        _ensure: function () {
            if (this._el && document.body.contains(this._el)) return;
            var self = this;
            var el = document.createElement("div");
            el.className = "tsapp-sb";
            document.body.appendChild(el);
            this._el = el;

            window.addEventListener("hashchange", function () { self._syncActive(); self._position(); });
            window.addEventListener("resize", function () { self._position(); });
        },

        _rebuild: function () {
            if (!this._el) return;
            var self = this;
            var roleLabel = this._role === "manager" ? "Manager" : this._role === "hr" ? "HR Admin" : "Employee";
            var roleIcon = this._role === "manager" ? "manager" : this._role === "hr" ? "employee" : "person-placeholder";
            var sections = menuFor(this._role);

            function itemHtml(it) {
                return '<a class="tsapp-item" data-route="' + it.route + '" title="' + it.label + '">' +
                    '<span class="tsapp-ico"><span class="tsapp-iconfont">' + iconChar(it.icon) + '</span></span>' +
                    '<span class="tsapp-label">' + it.label + '</span>' +
                    '<span class="tsapp-badge" data-badge="' + it.route + '" style="display:none"></span>' +
                    '</a>';
            }

            var nav = sections.map(function (sec, gi) {
                // Title-less sections (Overview, Rating History) render as flat items.
                if (!sec.title) { return '<div class="tsapp-flat">' + sec.items.map(itemHtml).join("") + '</div>'; }
                // Titled sections render as collapsible accordion groups (with chevron).
                return '<div class="tsapp-group" data-grp="g' + gi + '">' +
                    '<div class="tsapp-grouphd">' +
                        '<span class="tsapp-grouptitle">' + sec.title + '</span>' + CHEVRON_SVG +
                    '</div>' +
                    '<div class="tsapp-groupbody">' + sec.items.map(itemHtml).join("") + '</div>' +
                    '</div>';
            }).join("");

            this._el.innerHTML =
                '<div class="tsapp-head">' +
                    '<div class="tsapp-kicker">WORKSPACE</div>' +
                    '<div class="tsapp-role">' +
                        '<span class="tsapp-roleico"><span class="tsapp-iconfont">' + iconChar(roleIcon) + '</span></span>' +
                        '<span class="tsapp-rolename">' + roleLabel + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="tsapp-nav">' + nav + '</div>';

            Array.prototype.forEach.call(this._el.querySelectorAll(".tsapp-grouphd"), function (hd) {
                hd.addEventListener("click", function () { hd.parentNode.classList.toggle("open"); });
            });
            Array.prototype.forEach.call(this._el.querySelectorAll(".tsapp-item"), function (a) {
                a.addEventListener("click", function (e) {
                    e.preventDefault(); self._navigate(a.getAttribute("data-route"));
                });
            });
            this._renderBadges();
        },

        // Slide the drawer in / out and push the content (body.tsRailOpen).
        toggle: function () {
            document.body.classList.toggle("tsRailOpen");
            this._fireStateChange();
            this._nudgeResize();
        },
        close: function () {
            document.body.classList.remove("tsRailOpen");
            this._fireStateChange();
            this._nudgeResize();
        },
        // After the width transition, prompt charts/tables to recompute their size.
        _nudgeResize: function () {
            [0, 160, 320].forEach(function (ms) {
                setTimeout(function () { try { window.dispatchEvent(new Event("resize")); } catch (e) { /* */ } }, ms);
            });
        },

        _navigate: function (route) {
            if (this._router) { try { this._router.navTo(route); } catch (e) { /* */ } }
        },

        // Align the rail with the content area (below the top toolbar).
        _position: function () {
            if (!this._el) return;
            var sc = document.querySelector(".sapMSplitContainer");
            var top = sc ? Math.max(0, Math.round(sc.getBoundingClientRect().top)) : 0;
            this._el.style.top = top + "px";
        },

        _syncActive: function () {
            if (!this._el) return;
            var h = (window.location.hash || "").toLowerCase();
            var activeEl = null;
            Array.prototype.forEach.call(this._el.querySelectorAll(".tsapp-item"), function (a) {
                var r = a.getAttribute("data-route").toLowerCase();
                var active = new RegExp("(^|[/#])" + r.replace(/[-]/g, "\\-") + "($|[/?&])").test(h);
                a.classList.toggle("tsapp-active", active);
                if (active) activeEl = a;
            });
            // Auto-expand the group that contains the active item.
            if (activeEl && activeEl.closest) {
                var g = activeEl.closest(".tsapp-group");
                if (g) g.classList.add("open");
            }
            this._renderBadges();
        },

        // Public: called by App.controller when sidebar badge counts change.
        setBadges: function () { this._renderBadges(); },

        _renderBadges: function () {
            if (!this._el || !this._model) return;
            var b = this._model.getProperty("/sidebarBadges") || {};
            Array.prototype.forEach.call(this._el.querySelectorAll(".tsapp-badge"), function (span) {
                var v = b[span.getAttribute("data-badge")] || 0;
                if (v > 0) {
                    span.textContent = v > 99 ? "99+" : String(v);
                    span.style.display = "";
                    span.parentNode.classList.add("has-badge");
                } else {
                    span.style.display = "none";
                    span.parentNode.classList.remove("has-badge");
                }
            });
        }
    };

    return Sidebar;
});
