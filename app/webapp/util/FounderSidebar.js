sap.ui.define([], function () {
    "use strict";

    // ── Founder Sidebar ─────────────────────────────────────────────────────────
    // A single collapsible navigation rail shared by every Founder screen
    // (Dashboard, Approvals, Tasks, Ratings). Rendered once into <body> (so it
    // survives the dashboard's frequent content re-renders), self-syncs to the
    // route hash, and auto-collapses after navigation / on outside click.

    var ICONS = {
        menu:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>',
        dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
        approvals:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 13l2 2 4-4"/></svg>',
        tasks:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6l1 1 2-2"/><path d="M4 12l1 1 2-2"/><path d="M4 18l1 1 2-2"/></svg>',
        ratings:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.5 17 14 18.5 21 12 17.2 5.5 21 7 14 2 9.5 9 9 12 2"/></svg>',
        projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
    };

    var ITEMS = [
        { key: "dashboard", route: "founder-dashboard", label: "Dashboard", icon: ICONS.dashboard },
        { key: "projects",  route: "founder-projects",  label: "Projects",  icon: ICONS.projects },
        { key: "approvals", route: "founder-approvals", label: "Approvals", icon: ICONS.approvals },
        { key: "tasks",     route: "founder-tasks",     label: "Tasks",     icon: ICONS.tasks },
        { key: "ratings",   route: "founder-ratings",   label: "Ratings",   icon: ICONS.ratings }
    ];
    var ROUTE_KEYS = ITEMS.map(function (i) { return i.route; });

    var Sidebar = {
        _el: null,
        _router: null,
        _expanded: false,

        // Called by every Founder controller's route handler.
        attach: function (oController) {
            try { this._router = oController.getOwnerComponent().getRouter(); } catch (e) { /* */ }
            this._ensure();
            this._syncToHash();
        },

        _ensure: function () {
            if (this._el && document.body.contains(this._el)) return;
            var self = this;
            var el = document.createElement("div");
            el.className = "fsb fsb-collapsed";
            el.innerHTML =
                '<div class="fsb-top">' +
                    '<div class="fsb-toggle" title="Menu">' + ICONS.menu + '</div>' +
                    '<div class="fsb-brand">Founder Menu<small>Executive Console</small></div>' +
                '</div>' +
                '<div class="fsb-nav">' +
                    ITEMS.map(function (it) {
                        return '<a class="fsb-item" data-key="' + it.key + '" data-route="' + it.route + '" title="' + it.label + '">' +
                            '<span class="fsb-ico">' + it.icon + '</span><span class="fsb-label">' + it.label + '</span></a>';
                    }).join("") +
                '</div><div class="fsb-spacer"></div>';
            document.body.appendChild(el);
            this._el = el;

            // Toggle
            el.querySelector(".fsb-toggle").addEventListener("click", function (e) {
                e.stopPropagation(); self._toggle();
            });
            // Nav items
            Array.prototype.forEach.call(el.querySelectorAll(".fsb-item"), function (a) {
                a.addEventListener("click", function (e) {
                    e.preventDefault(); e.stopPropagation();
                    self._navigate(a.getAttribute("data-route"));
                });
            });
            // Hover expands (desktop affordance), leave collapses if not pinned.
            el.addEventListener("mouseenter", function () { if (!self._pinned) self._expand(); });
            el.addEventListener("mouseleave", function () { if (!self._pinned) self._collapse(); });

            // Outside click → collapse
            this._onDocClick = function (ev) {
                if (self._el && !self._el.contains(ev.target)) self._collapse();
            };
            document.addEventListener("click", this._onDocClick, true);

            // Keep active state + visibility in sync with the route.
            this._onHash = function () { self._syncToHash(); };
            window.addEventListener("hashchange", this._onHash);
        },

        _toggle: function () { this._pinned = !this._expanded; if (this._expanded) this._collapse(); else this._expand(); },
        _expand: function () { if (!this._el) return; this._expanded = true; this._el.classList.add("fsb-expanded"); this._el.classList.remove("fsb-collapsed"); },
        _collapse: function () { if (!this._el) return; this._expanded = false; this._pinned = false; this._el.classList.remove("fsb-expanded"); this._el.classList.add("fsb-collapsed"); },

        _navigate: function (route) {
            if (this._router) { try { this._router.navTo(route); } catch (e) { /* */ } }
            // Auto-collapse after acting on a menu item.
            this._collapse();
        },

        _activeFromHash: function () {
            var h = (window.location.hash || "").toLowerCase();
            for (var i = 0; i < ITEMS.length; i++) { if (h.indexOf(ITEMS[i].route) !== -1) return ITEMS[i].key; }
            return null;
        },
        _isFounderRoute: function () {
            var h = (window.location.hash || "").toLowerCase();
            return ROUTE_KEYS.some(function (r) { return h.indexOf(r) !== -1; });
        },

        _syncToHash: function () {
            if (!this._el) return;
            if (!this._isFounderRoute()) { this.hide(); return; }
            this.show();
            var active = this._activeFromHash();
            Array.prototype.forEach.call(this._el.querySelectorAll(".fsb-item"), function (a) {
                a.classList.toggle("fsb-active", a.getAttribute("data-key") === active);
            });
            this._collapse();
        },

        show: function () { if (this._el) this._el.style.display = "flex"; },
        hide: function () { if (this._el) { this._el.style.display = "none"; this._collapse(); } }
    };

    return Sidebar;
});
