sap.ui.define([], function () {
    "use strict";

    // ════════════════════════════════════════════════════════════════════════
    // Shared shell + helpers for the Founder experience (Dashboard, Approvals,
    // Tasks, Ratings). Everything reuses the dark Founder theme (.fdRoot/.fdGlass)
    // and talks ONLY to the existing FounderService — same CAP services, same DB
    // tables. No new entities; Founder actions update the same records as the
    // Employee / Manager / HR flows and immediately reflect in dashboard KPIs.
    // ════════════════════════════════════════════════════════════════════════

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function logoUrl() {
        try { return sap.ui.require.toUrl("timesheet/app/images/companylogo.jpg"); }
        catch (e) { return "./images/companylogo.jpg"; }
    }

    // ── Service calls (LargeString JSON) ─────────────────────────────────────
    function _parse(t) {
        var j; try { j = JSON.parse(t); } catch (e) { j = null; }
        var v = (j && j.value !== undefined) ? j.value : j;
        return (typeof v === "string") ? JSON.parse(v) : v;
    }
    function callFounder(action) { return post(action, {}); }
    function post(action, params) {
        return fetch("/founder/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
          .then(_parse);
    }

    // ── Toast ────────────────────────────────────────────────────────────────
    function toast(msg, ok) {
        var t = document.createElement("div");
        t.className = "ftoast " + (ok === false ? "err" : "ok");
        t.innerHTML = (ok === false ? "⚠️ " : "✓ ") + esc(msg);
        document.body.appendChild(t);
        requestAnimationFrame(function () { t.classList.add("show"); });
        setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2600);
    }

    // ── Generic modal (premium glass dialog) ─────────────────────────────────
    // opts: { title, sub, body(html), wide(bool), onClose }
    function modal(opts) {
        opts = opts || {};
        var ov = document.createElement("div");
        ov.className = "fmodOverlay";
        ov.innerHTML =
            "<div class='fmod fdGlass " + (opts.wide ? "wide " : "") + (opts.cls || "") + "' role='dialog'>" +
              "<div class='fmodHead'><div><div class='fmodTitle'>" + esc(opts.title || "") + "</div>" +
              (opts.sub ? "<div class='fmodSub'>" + esc(opts.sub) + "</div>" : "") + "</div>" +
              "<div class='fmodClose' title='Close'>✕</div></div>" +
              "<div class='fmodBody'>" + (opts.body || "") + "</div>" +
            "</div>";
        function close() { ov.classList.remove("show"); setTimeout(function () { ov.remove(); }, 220); if (opts.onClose) opts.onClose(); }
        ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
        ov.querySelector(".fmodClose").addEventListener("click", close);
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add("show"); });
        return { root: ov, close: close, body: ov.querySelector(".fmodBody") };
    }

    // ── Page chrome ──────────────────────────────────────────────────────────
    function pill(label, value, color) {
        return "<div class='fdMiniStat fdGlass' style='padding:8px 16px'>" +
            "<div class='v' style='font-size:1.15rem;color:" + (color || "#fff") + "'>" + esc(value) + "</div>" +
            "<div class='l'>" + esc(label) + "</div></div>";
    }

    // Unified premium header: Ccentrik logo + title/subtitle + action icons
    // (Notification Center · Settings/Profile). Used on every founder destination.
    function header(title, sub, pills) {
        return "" +
            "<div class='fdHeader'>" +
              "<div class='fdBrand'>" +
                "<img class='fdLogoImg' src='" + logoUrl() + "' alt='Ccentrik'/>" +
                "<div><div class='fdBrandName'>" + esc(title || "Ccentrik") + "</div>" +
                "<div class='fdBrandSub'>" + esc(sub || "Executive Command Center") + "</div></div>" +
              "</div>" +
              "<div class='fdHeadActions'>" +
                (pills || "") +
                "<div class='fdIconBtn' title='Company Newsletter' onclick=\"window.FShell&&window.FShell.newsletter()\">📰</div>" +
                "<div class='fdIconBtn' title='Notifications' onclick=\"window.FShell&&window.FShell.notifications()\">🔔<span class='fdDot'></span></div>" +
                "<div class='fdIconBtn' title='Upload profile picture' onclick=\"window.FShell&&window.FShell.uploadPhoto()\">📷</div>" +
                "<div class='fdIconBtn' title='Settings' onclick=\"window.FShell&&window.FShell.settings()\">⚙️</div>" +
                FShell.avatarHtml({ onclick: "window.FShell&&window.FShell.settings()" }) +
              "</div>" +
            "</div>";
    }

    function wrap(headerHtml, bodyHtml) {
        return "<div class='fdRoot'>" + headerHtml + "<div class='fdWrap'>" + bodyHtml + "</div></div>";
    }

    function card(title, sub, inner) {
        return "<div class='fdCard fdGlass' style='display:block;margin-top:18px'>" +
            "<div class='fdCardHead'><div class='fdCardTitle'>" + esc(title) + "</div>" +
            (sub ? "<div class='fdCardSub'>" + esc(sub) + "</div>" : "") + "</div>" + inner + "</div>";
    }

    // ════════════════════════════════════════════════════════════════════════
    // FShell — global Founder shell: identity + Notification Center + Settings.
    // ════════════════════════════════════════════════════════════════════════
    var FShell = {
        _ctrl: null,
        _photoUrl: null,
        attach: function (oController) {
            this._ctrl = oController;
            if (!this._photoLoaded) { this._photoLoaded = true; this.loadPhoto(); }
        },

        // ── Company Newsletter (shares the Employee backend; founder is EMP1006) ─
        // Same source as every other employee: getLatestNewsletter. Shows the
        // document inline (PDF / image / .docx) with a download fallback.
        newsletter: function () {
            var self = this;
            fetch("/employee/getLatestNewsletter", {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: "{}"
            }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
                var v = (j && (j.value !== undefined ? j.value : j)) || {};
                if (!v.hasNewsletter || !v.dataBase64) { toast("No newsletter has been published yet.", false); return; }
                self._showNewsletter(v);
            }).catch(function () { toast("Could not load the newsletter.", false); });
        },
        _showNewsletter: function (v) {
            var name = v.fileName || "newsletter";
            var mime = v.mimeType || "";
            var dataUrl = "data:" + (mime || "application/octet-stream") + ";base64," + v.dataBase64;
            var isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(name);
            var isImg = /^image\//i.test(mime);
            var isDocx = /\.docx$/i.test(name) || /wordprocessingml/i.test(mime);
            var bodyHtml;
            if (isPdf) {
                bodyHtml = "<iframe src='" + dataUrl + "#toolbar=0&navpanes=0' style='width:100%;height:66vh;border:none;border-radius:8px;background:#fff'></iframe>";
            } else if (isImg) {
                bodyHtml = "<div style='text-align:center'><img src='" + dataUrl + "' style='max-width:100%;border-radius:8px' alt='Newsletter'/></div>";
            } else if (isDocx) {
                bodyHtml = "<div id='fdNewsDoc' class='tsNewsletterDoc'><div class='fdLoading'>Loading newsletter…</div></div>";
            } else {
                bodyHtml = "<div style='text-align:center;padding:24px;color:#cbd5e1'>“" + esc(name) + "” can’t be previewed here. Use Download below.</div>";
            }
            bodyHtml += "<div class='fmodFoot' style='margin-top:14px'>" +
                "<a class='faBtn approve' style='text-decoration:none' href='" + dataUrl + "' download='" + esc(name) + "'>⬇ Download</a></div>";
            var m = modal({ title: "Company Newsletter", sub: name, body: bodyHtml, wide: true });
            if (isDocx) { var el = m.body.querySelector("#fdNewsDoc"); FShell._renderDocx(v.dataBase64, el); }
        },
        _renderDocx: function (b64, el) {
            if (!el) return;
            FShell._loadMammoth().then(function (mammoth) {
                if (!mammoth) { el.innerHTML = "<div style='padding:16px;color:#cbd5e1'>Preview unavailable — use Download.</div>"; return; }
                try {
                    var bin = atob(String(b64).replace(/^data:[^;]+;base64,/, ""));
                    var buf = new ArrayBuffer(bin.length); var view = new Uint8Array(buf);
                    for (var i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
                    mammoth.convertToHtml({ arrayBuffer: buf }).then(function (res) {
                        el.innerHTML = res.value || "<div style='padding:16px'>Empty document.</div>";
                    }).catch(function () { el.innerHTML = "<div style='padding:16px;color:#cbd5e1'>Preview unavailable — use Download.</div>"; });
                } catch (e) { el.innerHTML = "<div style='padding:16px;color:#cbd5e1'>Preview unavailable — use Download.</div>"; }
            });
        },
        _loadMammoth: function () {
            if (window.mammoth) return Promise.resolve(window.mammoth);
            if (FShell._pMammoth) return FShell._pMammoth;
            FShell._pMammoth = new Promise(function (resolve) {
                var s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
                s.onload = function () { resolve(window.mammoth); };
                s.onerror = function () { FShell._pMammoth = null; resolve(null); };
                document.head.appendChild(s);
            });
            return FShell._pMammoth;
        },
        _user: function () {
            try {
                var u = this._ctrl && this._ctrl.getOwnerComponent && this._ctrl.getOwnerComponent()._oCurrentUser;
                return u || {};
            } catch (e) { return {}; }
        },
        name: function () { var u = this._user(); return (u && u.employeeName) ? u.employeeName : "Founder"; },
        initials: function () {
            var p = String(this.name() || "F").trim().split(/\s+/);
            return ((p[0] && p[0][0]) || "F").toUpperCase() + (p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0].toUpperCase() : "");
        },

        // ── Profile photo (shares the Employee backend: founder is EMP1006) ────
        // Renders an avatar that shows the photo when available, else initials.
        avatarHtml: function (opts) {
            opts = opts || {};
            var attrs = "class='fdAvatar" + (this._photoUrl ? " has-photo" : "") + "'" +
                " title='" + esc(opts.title || "Profile") + "'" +
                (opts.onclick ? " onclick=\"" + opts.onclick + "\"" : "");
            if (this._photoUrl) return "<div " + attrs + " style='background-image:url(" + this._photoUrl + ")'></div>";
            return "<div " + attrs + ">" + esc(this.initials()) + "</div>";
        },
        _patchAvatars: function () {
            var url = this._photoUrl;
            document.querySelectorAll(".fdAvatar, .fsetAvatar").forEach(function (el) {
                if (url) { el.classList.add("has-photo"); el.style.backgroundImage = "url(" + url + ")"; el.textContent = ""; }
            });
        },
        loadPhoto: function () {
            var that = this;
            fetch("/employee/getProfilePhoto", {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: "{}"
            }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
                var v = j && (j.value !== undefined ? j.value : j);
                var src = v && v.dataBase64;
                if (!src || src.length < 100) return;
                var dataUrl = String(src).indexOf("data:") === 0 ? src : "data:" + ((v && v.mimeType) || "image/jpeg") + ";base64," + src;
                return fetch(dataUrl).then(function (rr) { return rr.blob(); }).then(function (b) {
                    if (that._photoUrl) { try { URL.revokeObjectURL(that._photoUrl); } catch (e) { /**/ } }
                    that._photoUrl = URL.createObjectURL(b); that._patchAvatars();
                });
            }).catch(function () { /* no photo yet — initials stay */ });
        },
        _csrf: function () {
            return fetch("/employee/", { method: "GET", headers: { "X-CSRF-Token": "Fetch" } })
                .then(function (r) { return r.headers.get("x-csrf-token") || null; }).catch(function () { return null; });
        },
        uploadPhoto: function () {
            var that = this;
            var input = document.getElementById("__founderPhotoInput");
            if (!input) {
                input = document.createElement("input");
                input.type = "file"; input.id = "__founderPhotoInput";
                input.accept = "image/png, image/jpeg, image/jpg, image/webp";
                input.style.display = "none"; document.body.appendChild(input);
            }
            input.value = "";
            input.onchange = function (ev) {
                var file = ev.target.files && ev.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    var img = new Image();
                    img.onload = function () {
                        var MAX = 350, w = img.width, h = img.height;
                        if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
                        var c = document.createElement("canvas"); c.width = w; c.height = h;
                        c.getContext("2d").drawImage(img, 0, 0, w, h);
                        var out = c.toDataURL("image/jpeg", 0.75);
                        if (out.length > 50000) out = c.toDataURL("image/jpeg", 0.45);
                        if (out.length > 50000) out = c.toDataURL("image/jpeg", 0.25);
                        that._csrf().then(function (token) {
                            var headers = { "Content-Type": "application/json", "Accept": "application/json" };
                            if (token) headers["X-CSRF-Token"] = token;
                            return fetch("/employee/uploadProfilePhoto", { method: "POST", credentials: "include", headers: headers, body: JSON.stringify({ dataBase64: out }) });
                        }).then(function (r) {
                            if (!r.ok) throw new Error("HTTP " + r.status);
                            toast("Profile picture updated.");
                            that.loadPhoto();
                        }).catch(function () { toast("Could not save the photo.", false); });
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            };
            input.click();
        },

        // Navigate to a founder route and close the notification panel.
        navTo: function (route) {
            var ov = document.querySelector(".fnpOverlay"); if (ov) ov.remove();
            try {
                var router = this._ctrl && this._ctrl.getOwnerComponent && this._ctrl.getOwnerComponent().getRouter();
                if (router && route) router.navTo(route);
            } catch (e) { /* ignore */ }
        },

        // ── Notification Center (anchored dropdown — click to navigate) ───────
        notifications: function () {
            var existing = document.querySelector(".fnpOverlay");
            if (existing) { existing.remove(); return; }
            var ov = document.createElement("div");
            ov.className = "fnpOverlay";
            ov.innerHTML =
                "<div class='fnpPanel fdGlass'>" +
                  "<div class='fnpHead'><span>🔔 Notification Center</span>" +
                  "<span class='fnpClose' title='Close'>✕</span></div>" +
                  "<div class='fnpScroll'><div class='fnpLoading'>Loading notifications…</div></div>" +
                "</div>";
            ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
            ov.querySelector(".fnpClose").addEventListener("click", function () { ov.remove(); });
            document.body.appendChild(ov);
            requestAnimationFrame(function () { ov.classList.add("show"); });

            Promise.all([
                post("getFounderApprovals", {}).catch(function () { return {}; }),
                post("getFounderTasks", {}).catch(function () { return {}; }),
                post("getFounderAnalytics", {}).catch(function () { return {}; })
            ]).then(function (res) {
                var ap = res[0] || {}, tk = res[1] || {}, an = (res[2] && res[2].overall) || {};
                var scroll = ov.querySelector(".fnpScroll");
                if (!scroll) return;
                scroll.innerHTML = FShell._notifHtml(ap, tk, an);
                scroll.addEventListener("click", function (e) {
                    var item = e.target.closest && e.target.closest(".fnpItem[data-route]");
                    if (item) FShell.navTo(item.getAttribute("data-route"));
                });
            });
        },
        _item: function (ico, color, title, meta, route) {
            var rt = route ? " data-route='" + esc(route) + "'" : "";
            return "<div class='fnpItem" + (route ? " fnpClickable" : "") + "'" + rt + ">" +
                "<div class='fnpIco' style='background:" + color + "22;color:" + color + "'>" + ico + "</div>" +
                "<div class='fnpBody'><div class='fnpTitle'>" + esc(title) + "</div>" +
                "<div class='fnpMeta'>" + esc(meta) + "</div></div>" +
                (route ? "<div class='fnpGo'>›</div>" : "") + "</div>";
        },
        _section: function (label, items) {
            if (!items.length) return "";
            return "<div class='fnpSection'>" + esc(label) + "</div>" + items.join("");
        },
        _notifHtml: function (ap, tk, an) {
            var I = this._item.bind(this);
            var ac = (ap.counts || {}), tc = (tk.counts || {}), rc = (an.riskCenter || {});
            var html = "";

            // Approvals → Founder Approvals (ratings reviews → Founder Ratings)
            var approvals = [];
            if (ac.leaves) approvals.push(I("🌴", "#a78bfa", ac.leaves + " Leave Request" + (ac.leaves > 1 ? "s" : "") + " Awaiting Approval", "Review and decide in Approvals", "founder-approvals"));
            if (ac.timesheets) approvals.push(I("📋", "#38bdf8", ac.timesheets + " Timesheet" + (ac.timesheets > 1 ? "s" : "") + " Awaiting Review", "Pending your decision", "founder-approvals"));
            if (ac.fillRequests) approvals.push(I("📝", "#34d399", ac.fillRequests + " Timesheet Fill Request" + (ac.fillRequests > 1 ? "s" : ""), "Previous-week / missed-day approvals", "founder-approvals"));
            if (rc.pendingReviews) approvals.push(I("⭐", "#f59e0b", rc.pendingReviews + " Rating Review" + (rc.pendingReviews > 1 ? "s" : "") + " Pending", "Performance reviews due", "founder-ratings"));
            html += this._section("Approvals", approvals);

            // Tasks → Founder Tasks
            var tasks = [];
            if (tc.pending) tasks.push(I("📌", "#fbbf24", tc.pending + " New Task" + (tc.pending > 1 ? "s" : "") + " Not Started", "Recently assigned across the org", "founder-tasks"));
            if (tc.overdue) tasks.push(I("⏰", "#fb7185", tc.overdue + " Overdue Task" + (tc.overdue > 1 ? "s" : ""), "Require immediate attention", "founder-tasks"));
            if (tc.completed) tasks.push(I("✅", "#34d399", tc.completed + " Completed Task" + (tc.completed > 1 ? "s" : ""), "Delivered organization-wide", "founder-tasks"));
            html += this._section("Tasks", tasks);

            // Organization Alerts → Founder Dashboard (org-wide context)
            var org = [];
            if (rc.inactiveEmployees) org.push(I("🚫", "#fb7185", rc.inactiveEmployees + " Inactive Employee" + (rc.inactiveEmployees > 1 ? "s" : ""), "Deactivated accounts", "founder-dashboard"));
            (rc.lowPerformingDepartments || []).forEach(function (d) { org.push(I("📉", "#fb7185", "Low Department Performance", d, "founder-dashboard")); });
            (rc.excessiveLeave || []).forEach(function (d) { org.push(I("🌴", "#fbbf24", "Excessive Leave Utilization", d, "founder-approvals")); });
            if (rc.missingTimesheets) org.push(I("📄", "#fbbf24", rc.missingTimesheets + " Missing Timesheet" + (rc.missingTimesheets > 1 ? "s" : ""), "Not submitted this period", "founder-approvals"));
            html += this._section("Organization Alerts", org);

            // Dashboard Alerts → Founder Dashboard
            var dash = [];
            var ht = an.healthTrendPct;
            if (typeof ht === "number" && ht !== 0) {
                if (ht < 0) dash.push(I("↓", "#fb7185", "Company Health Score Decreased", Math.abs(ht) + "% lower than last month", "founder-dashboard"));
                else dash.push(I("↑", "#34d399", "Company Health Improved", "+" + ht + "% from last month", "founder-dashboard"));
            }
            if (an.productivityScore != null) dash.push(I("⚡", "#38bdf8", "Productivity Score " + an.productivityScore, "Organization-wide index", "founder-dashboard"));
            var rg = (an.rating && an.rating.growthPct);
            if (typeof rg === "number" && rg !== 0) dash.push(I("⭐", (rg >= 0 ? "#34d399" : "#fb7185"), "Performance " + (rg >= 0 ? "Improved" : "Declined"), (rg >= 0 ? "+" : "") + rg + "% rating change", "founder-dashboard"));
            html += this._section("Dashboard Alerts", dash);

            if (!html) html = "<div class='fnpEmpty'>🎉 You're all caught up — no alerts right now.</div>";
            return html;
        },

        // ── Settings & Profile popup ──────────────────────────────────────────
        settings: function () {
            var u = this._user();
            var role = "Founder";
            var dept = u.designation || u.department || "Executive";
            var avatarInner = this._photoUrl
                ? "<div class='fsetAvatar has-photo' style='background-image:url(" + this._photoUrl + ")'></div>"
                : "<div class='fsetAvatar'>" + esc(this.initials()) + "</div>";
            var body =
                "<div class='fsetProfile'>" +
                  "<div class='fsetAvatarWrap' title='Change profile picture'>" + avatarInner + "<span class='fsetCam'>📷</span></div>" +
                  "<div><div class='fsetName'>" + esc(this.name()) + "</div>" +
                  "<div class='fsetRole'>" + esc(role) + "</div></div>" +
                "</div>" +
                "<div class='fsetGrid'>" +
                  "<div class='fsetField'><span>Email</span><b>" + esc(u.email || "—") + "</b></div>" +
                  "<div class='fsetField'><span>Role</span><b>" + esc(role) + "</b></div>" +
                  "<div class='fsetField'><span>Department</span><b>" + esc(dept) + "</b></div>" +
                  "<div class='fsetField'><span>Employee ID</span><b>" + esc(u.employeeId || "—") + "</b></div>" +
                "</div>" +
                "<div class='fsetOptions'>" +
                  "<div class='fsetOpt' data-act='photo'><span>📷 Change Profile Picture</span><i>›</i></div>" +
                  "<div class='fsetOpt' data-act='profile'><span>👤 My Profile</span><i>›</i></div>" +
                  "<div class='fsetOpt' data-act='account'><span>⚙️ Account Settings</span><i>›</i></div>" +
                  "<div class='fsetOpt' data-act='password'><span>🔒 Change Password</span><i>›</i></div>" +
                "</div>" +
                "<button class='fsetSignout'>⏻ Sign Out</button>";

            var m = modal({ title: "Profile & Settings", sub: "Founder · " + (u.email || ""), body: body });
            var wrap = m.body.querySelector(".fsetAvatarWrap");
            if (wrap) wrap.addEventListener("click", function () { m.close(); FShell.uploadPhoto(); });
            m.body.querySelectorAll(".fsetOpt").forEach(function (el) {
                el.addEventListener("click", function () {
                    var act = el.getAttribute("data-act");
                    if (act === "photo") { m.close(); FShell.uploadPhoto(); }
                    else if (act === "password") toast("Change Password — manage via your HR administrator.", false);
                    else if (act === "account") toast("Account Settings — coming soon.", false);
                    else toast("Signed in as " + FShell.name());
                });
            });
            m.body.querySelector(".fsetSignout").addEventListener("click", function () {
                try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /**/ }
                window.location.replace("/logout");
            });
        }
    };
    window.FShell = FShell;

    return {
        esc: esc, logoUrl: logoUrl, callFounder: callFounder, post: post,
        toast: toast, modal: modal, header: header, pill: pill, wrap: wrap, card: card,
        shell: FShell
    };
});
