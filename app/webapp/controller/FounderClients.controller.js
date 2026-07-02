sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "timesheet/app/util/FounderSidebar",
    "timesheet/app/util/FounderPage",
    "timesheet/app/util/ClientForm"
], function (Controller, FounderSidebar, FP, ClientForm) {
    "use strict";

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    function inrCompact(n) {
        n = Number(n) || 0; var a = Math.abs(n), sign = n < 0 ? "-" : "";
        if (a >= 1e7) return sign + "₹" + (a / 1e7).toFixed(2) + " Cr";
        if (a >= 1e5) return sign + "₹" + (a / 1e5).toFixed(2) + " L";
        if (a >= 1e3) return sign + "₹" + (a / 1e3).toFixed(1) + " K";
        return sign + "₹" + a.toFixed(0);
    }
    function statusColor(s) {
        var k = String(s || "").toLowerCase();
        return k === "active" ? "#34d399" : k === "prospect" ? "#fbbf24" : k === "inactive" ? "#9fb0d6" : k === "blacklisted" ? "#fb7185" : "#9fb0d6";
    }
    var PAGE_SIZE = 10;

    return Controller.extend("timesheet.app.controller.FounderClients", {

        onInit: function () {
            this._all = [];
            this._summary = null;
            this._f = { search: "", status: "", sort: "name" };
            this._page = 1;
            window._fcCtrl = this;
            this.getOwnerComponent().getRouter()
                .getRoute("founder-clients").attachPatternMatched(this._onRouteMatched, this);
        },
        _onRouteMatched: function () {
            FounderSidebar.attach(this);
            if (FP.shell && FP.shell.attach) { try { FP.shell.attach(this); } catch (e) { /* */ } }
            this._refresh();
        },
        onExit: function () { if (window._fcCtrl === this) window._fcCtrl = null; },

        _host: function () { return this.byId("clientsHost"); },

        _refresh: function () {
            var that = this;
            ClientForm.ppost("getClientMasters", {}).then(function (d) {
                if (!d || d.error) { var h = that._host(); if (h) h.setContent("<div class='fpaRoot'><div class='fdLoading'>" + esc((d && d.error) || "Could not load clients.") + "</div></div>"); return; }
                that._all = d.clients || [];
                that._summary = d.summary || null;
                that._render();
            }).catch(function () {
                var h = that._host(); if (h) h.setContent("<div class='fpaRoot'><div class='fdLoading'>Could not load clients.</div></div>");
            });
        },

        // ── Filtering / sorting / pagination ────────────────────────────────────
        _filtered: function () {
            var f = this._f, q = f.search.trim().toLowerCase();
            var list = this._all.filter(function (c) {
                if (f.status && String(c.status || "") !== f.status) return false;
                if (q) {
                    var hay = [c.companyName, c.clientName, c.contactPerson, c.email, c.industry, c.country, c.clientType].join(" ").toLowerCase();
                    if (hay.indexOf(q) === -1) return false;
                }
                return true;
            });
            list.sort(function (a, b) {
                switch (f.sort) {
                    case "value": return (b.contractValue || 0) - (a.contractValue || 0);
                    case "projects": return (b.projectCount || 0) - (a.projectCount || 0);
                    case "created": return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
                    case "status": return String(a.status || "").localeCompare(String(b.status || ""));
                    default: return String(a.companyName || a.clientName || "").localeCompare(String(b.companyName || b.clientName || ""));
                }
            });
            return list;
        },

        _render: function () {
            var html = "<div class='fpaRoot'>" +
                this._buildHeader() +
                "<div class='fpaWrap'>" +
                this._buildSummary() +
                this._buildToolbar() +
                this._buildTable() +
                "</div></div>";
            var h = this._host();
            if (!h) return;
            h.setContent(html);
            var that = this;
            setTimeout(function () { that._wire(); }, 40);
        },

        _buildHeader: function () {
            return "<div class='fpaHeader'>" +
                "<div class='fpaTitle'>" +
                "<div class='fcCrumb'>Home <span>›</span> <b>Clients</b></div>" +
                "<div class='fpaH1'>Clients</div>" +
                "<div class='fpaH2'>Client management — the single entry point for all client operations</div></div>" +
                "<div class='fpaFilters'><button class='fpaExpBtn' id='fcNew'>＋ New Client</button></div>" +
                "</div>";
        },

        _card: function (label, value, color) {
            return "<div class='fpaKpi'><div class='fpaKpiL'>" + esc(label) + "</div>" +
                "<div class='fpaKpiV'" + (color ? " style='color:" + color + "'" : "") + ">" + esc(value) + "</div></div>";
        },
        // Derive the overview counts directly from the loaded client list so the
        // cards always reflect the current data (no dependency on a backend field).
        _buildSummary: function () {
            var s = { total: this._all.length, active: 0, prospect: 0, inactive: 0, blacklisted: 0 };
            this._all.forEach(function (c) {
                var k = String(c.status || "").toLowerCase();
                if (k === "active") s.active++;
                else if (k === "prospect") s.prospect++;
                else if (k === "inactive") s.inactive++;
                else if (k === "blacklisted") s.blacklisted++;
            });
            return "<div class='fpaKpiSection'><div class='fpaSecHead'>Overview</div>" +
                "<div class='fcCardRow'>" +
                this._card("Total Clients", s.total) +
                this._card("Active", s.active, "#34d399") +
                this._card("Prospects", s.prospect, "#fbbf24") +
                this._card("Inactive", s.inactive, "#9fb0d6") +
                this._card("Blacklisted", s.blacklisted, "#fb7185") +
                "</div></div>";
        },

        _buildToolbar: function () {
            var f = this._f;
            var statusOpt = ["", "Prospect", "Active", "Inactive", "Blacklisted"].map(function (s) {
                return "<option value='" + s + "'" + (s === f.status ? " selected" : "") + ">" + (s || "All Statuses") + "</option>";
            }).join("");
            var sortOpt = [["name", "Company Name"], ["value", "Contract Value"], ["projects", "Projects"], ["created", "Recently Added"], ["status", "Status"]].map(function (o) {
                return "<option value='" + o[0] + "'" + (o[0] === f.sort ? " selected" : "") + ">Sort: " + o[1] + "</option>";
            }).join("");
            return "<div class='fcToolbar'>" +
                "<input class='fcSearch' id='fcSearch' placeholder='Search company, contact, email, industry, country…' value='" + esc(f.search) + "'/>" +
                "<select class='fpaSel' id='fcStatus'>" + statusOpt + "</select>" +
                "<select class='fpaSel' id='fcSort'>" + sortOpt + "</select>" +
                "</div>";
        },

        _buildTable: function () {
            var rows = this._filtered();
            var total = rows.length;
            var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            if (this._page > pages) this._page = pages;
            var start = (this._page - 1) * PAGE_SIZE;
            var pageRows = rows.slice(start, start + PAGE_SIZE);

            var body = pageRows.length ? pageRows.map(function (c, idx) {
                var st = c.status || "Prospect";
                var lc = st.toLowerCase();
                // Bottom rows open their menu upward so it isn't clipped by the scroll box.
                var upCls = (idx >= pageRows.length - 3 && pageRows.length > 4) ? " up" : "";
                var menu =
                    "<a data-act='view'>View Details</a>" +
                    "<a data-act='edit'>Edit</a>" +
                    (lc !== "inactive" && lc !== "blacklisted" ? "<a data-act='deactivate'>Deactivate</a>" : "") +
                    (lc !== "blacklisted" ? "<a data-act='blacklist' class='danger'>Blacklist</a>" : "") +
                    (lc === "inactive" || lc === "blacklisted" ? "<a data-act='reactivate'>Reactivate</a>" : "") +
                    "<a data-act='delete' class='danger'>Delete</a>";
                return "<tr data-id='" + esc(c.clientId) + "'>" +
                    "<td><b style='color:#e6edf8'>" + esc(c.companyName || c.clientName) + "</b><div class='fdCardSub'>" + esc(c.clientType || "") + "</div></td>" +
                    "<td style='color:#9fb0d6'>" + esc(c.contactPerson || "—") + "<div class='fdCardSub'>" + esc(c.email || "") + "</div></td>" +
                    "<td><span style='color:" + statusColor(st) + ";font-weight:700;font-size:0.8rem'>" + esc(st) + "</span></td>" +
                    "<td style='color:#c7d2e8'>" + esc(c.industry || "—") + "</td>" +
                    "<td style='color:#c7d2e8'>" + esc(c.country || "—") + "</td>" +
                    "<td style='color:#c7d2e8'>" + (c.projectCount || 0) + "</td>" +
                    "<td style='color:#e6edf8'>" + inrCompact(c.contractValue) + "</td>" +
                    "<td style='color:#9fb0d6'>" + esc(String(c.createdAt || "").slice(0, 10) || "—") + "</td>" +
                    "<td class='fcActionsCell'><div class='fcMenu" + upCls + "'><button class='fcMenuBtn' data-act='menu'>⋯</button>" +
                    "<div class='fcMenuPop'>" + menu + "</div></div></td>" +
                    "</tr>";
            }).join("") : "<tr><td colspan='9' style='text-align:center;color:#9fb0d6;padding:20px'>No clients match your search.</td></tr>";

            var pager = "<div class='fcPager'><span>" + total + " client" + (total === 1 ? "" : "s") + "</span>" +
                "<div class='fcPageBtns'>" +
                "<button class='fcPg' id='fcPrev'" + (this._page <= 1 ? " disabled" : "") + ">‹ Prev</button>" +
                "<span class='fcPageNum'>Page " + this._page + " / " + pages + "</span>" +
                "<button class='fcPg' id='fcNext'" + (this._page >= pages ? " disabled" : "") + ">Next ›</button>" +
                "</div></div>";

            return "<div class='fpaTableSection'><div class='fpaSecHead'>Client List</div>" +
                "<div class='fpaTableWrap'><table class='fpaTable fcTable'><thead><tr>" +
                "<th>Company</th><th>Primary Contact</th><th>Status</th><th>Industry</th><th>Country</th><th>Projects</th><th>Contract Value</th><th>Created</th><th>Actions</th>" +
                "</tr></thead><tbody>" + body + "</tbody></table></div>" + pager + "</div>";
        },

        // ── Wiring ──────────────────────────────────────────────────────────────
        _wire: function () {
            var that = this;
            var nb = document.getElementById("fcNew");
            if (nb) nb.onclick = function () { ClientForm.openForm(null, function () { that._refresh(); }); };

            var se = document.getElementById("fcSearch");
            if (se) {
                se.oninput = function () { that._f.search = this.value; that._page = 1; that._rerenderTable(); };
                // Keep focus after re-render.
                se.onkeyup = null;
            }
            var st = document.getElementById("fcStatus");
            if (st) st.onchange = function () { that._f.status = this.value; that._page = 1; that._rerenderTable(); };
            var so = document.getElementById("fcSort");
            if (so) so.onchange = function () { that._f.sort = this.value; that._page = 1; that._rerenderTable(); };

            this._wireTable();
        },
        _wireTable: function () {
            var that = this;
            var prev = document.getElementById("fcPrev"), next = document.getElementById("fcNext");
            if (prev) prev.onclick = function () { if (that._page > 1) { that._page--; that._rerenderTable(); } };
            if (next) next.onclick = function () { that._page++; that._rerenderTable(); };

            Array.prototype.forEach.call(document.querySelectorAll(".fcTable tbody tr"), function (tr) {
                var id = tr.getAttribute("data-id");
                if (!id) return;
                Array.prototype.forEach.call(tr.querySelectorAll("[data-act]"), function (el) {
                    el.onclick = function (e) {
                        e.stopPropagation();
                        that._onAction(el.getAttribute("data-act"), id, tr);
                    };
                });
            });
            // Close any open menu when clicking elsewhere.
            document.addEventListener("click", function () {
                Array.prototype.forEach.call(document.querySelectorAll(".fcMenu.open"), function (m) { m.classList.remove("open"); });
            }, { once: true });
        },
        _rerenderTable: function () {
            var host = document.querySelector(".fpaTableSection");
            if (!host) { this._render(); return; }
            var tmp = document.createElement("div"); tmp.innerHTML = this._buildTable();
            host.replaceWith(tmp.firstChild);
            this._wireTable();
        },

        _client: function (id) { return this._all.find(function (c) { return c.clientId === id; }); },

        _onAction: function (act, id, tr) {
            var that = this, c = this._client(id);
            if (!c) return;
            if (act === "menu") {
                var menu = tr.querySelector(".fcMenu");
                var isOpen = menu.classList.contains("open");
                Array.prototype.forEach.call(document.querySelectorAll(".fcMenu.open"), function (m) { m.classList.remove("open"); });
                if (!isOpen) { menu.classList.add("open"); setTimeout(function () { that._closeMenusOnce(); }, 0); }
                return;
            }
            // Any concrete action closes the menu.
            Array.prototype.forEach.call(document.querySelectorAll(".fcMenu.open"), function (m) { m.classList.remove("open"); });
            if (act === "view") { this._viewDetails(c); return; }
            if (act === "edit") { ClientForm.openForm(c, function () { that._refresh(); }); return; }
            if (act === "deactivate") { ClientForm.quickStatus(c, "Inactive", function () { that._refresh(); }); return; }
            if (act === "blacklist") { ClientForm.quickStatus(c, "Blacklisted", function () { that._refresh(); }); return; }
            if (act === "reactivate") { ClientForm.quickStatus(c, "Active", function () { that._refresh(); }); return; }
            if (act === "delete") { this._confirmDelete(c); return; }
        },
        _closeMenusOnce: function () {
            document.addEventListener("click", function handler() {
                Array.prototype.forEach.call(document.querySelectorAll(".fcMenu.open"), function (m) { m.classList.remove("open"); });
                document.removeEventListener("click", handler);
            });
        },

        _confirmDelete: function (c) {
            var that = this;
            var warn = (c.projectCount || 0) > 0
                ? "<p class='fmodP' style='color:#fb7185'>This client has " + (c.projectCount) + " project(s) and cannot be deleted. Mark it Inactive or Blacklisted instead.</p>"
                : "<p class='fmodP'>Permanently delete <b>" + esc(c.companyName || c.clientName) + "</b>? This cannot be undone.</p>";
            var canDelete = (c.projectCount || 0) === 0;
            var body = "<div class='fmod'>" + warn +
                "<div class='fmodFoot'><button class='faBtn ghost' id='dCancel'>Cancel</button>" +
                (canDelete ? "<button class='faBtn reject' id='dGo'>Delete Client</button>" : "") + "</div></div>";
            var m = FP.modal({ title: "Delete Client", body: body });
            m.body.querySelector("#dCancel").addEventListener("click", m.close);
            var go = m.body.querySelector("#dGo");
            if (go) go.addEventListener("click", function () {
                go.disabled = true; go.textContent = "Deleting…";
                ClientForm.ppost("deleteClientMaster", { clientId: c.clientId }).then(function (res) {
                    m.close();
                    if (res && res.error) { FP.toast(res.error, false); return; }
                    FP.toast("Client deleted."); that._refresh();
                }).catch(function () { m.close(); FP.toast("Could not delete client.", false); });
            });
        },

        _viewDetails: function (c) {
            var row = function (l, v) { return "<div class='fpaStat'><div class='fpaStatL'>" + esc(l) + "</div><div class='fpaStatV'>" + esc(v || "—") + "</div></div>"; };
            var web = c.website ? "<a href='" + esc(c.website) + "' target='_blank' style='color:#38bdf8'>" + esc(c.website) + "</a>" : "—";
            var body = "<div class='fpaDrawer'>" +
                "<div class='fcCrumb' style='margin-bottom:10px'>Home <span>›</span> Clients <span>›</span> <b>" + esc(c.companyName || c.clientName) + "</b></div>" +
                "<div class='fpaDrawHead'><div><div class='fpaDrawName'>" + esc(c.companyName || c.clientName) + "</div>" +
                "<div class='fpaDrawMeta'>" + esc(c.clientType || "") + (c.industry ? " · " + esc(c.industry) : "") + "</div></div>" +
                "<div class='fpaDrawBadges'><span class='fpaBadge' style='color:" + statusColor(c.status) + "'>" + esc(c.status || "") + "</span></div></div>" +
                "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Company</div><div class='fpaStatGrid'>" +
                row("Company Name", c.companyName || c.clientName) + row("Client Type", c.clientType) +
                row("Industry", c.industry) + row("Country", c.country) +
                row("Time Zone", c.timeZone) + "<div class='fpaStat'><div class='fpaStatL'>Website</div><div class='fpaStatV'>" + web + "</div></div>" +
                "</div></div>" +
                "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Primary Contact</div><div class='fpaStatGrid'>" +
                row("Contact", c.contactPerson) + row("Designation", c.designation) +
                row("Email", c.email) + row("Phone", c.phoneNumber) +
                "</div></div>" +
                "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Business</div><div class='fpaStatGrid'>" +
                row("Projects", c.projectCount || 0) + row("Contract Value", inrCompact(c.contractValue)) +
                row("Created", String(c.createdAt || "").slice(0, 10)) + row("Created By", c.createdBy) +
                "</div></div>" +
                (c.notes ? "<div class='fpaDrawSec'><div class='fpaDrawTitle'>Notes</div><div style='color:#c7d2e8;font-size:0.86rem;line-height:1.6'>" + esc(c.notes) + "</div></div>" : "") +
                "<div class='fmodFoot'><button class='faBtn ghost' id='vClose'>Close</button><button class='faBtn approve' id='vEdit'>Edit Client</button></div></div>";
            var that = this;
            var m = FP.modal({ title: "Client Details", body: body, wide: true, cls: "fmodCreateProject" });
            m.body.querySelector("#vClose").addEventListener("click", m.close);
            m.body.querySelector("#vEdit").addEventListener("click", function () { m.close(); ClientForm.openForm(c, function () { that._refresh(); }); });
        }
    });
});
