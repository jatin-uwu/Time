sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "sap/m/ResponsivePopover",
    "sap/m/Bar",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Avatar",
    "sap/ui/core/Icon",
    "timesheet/app/util/CustomDialog",
    "sap/ui/unified/FileUploader",
    "sap/ui/core/HTML",
    "timesheet/app/util/AppSidebar"
], (Controller, JSONModel, MessageToast, MessageBox, ResponsivePopover, Bar, Button, VBox, HBox, Label, Text, Title, Avatar, Icon, CustomDialog, FileUploader, HTML, AppSidebar) => {
    "use strict";

    // Routes under the manager "Management" menu — only a logged-in manager
    // may open these. Non-managers (employee/HR) are bounced to the dashboard,
    // whether they click a (hidden) link or hit the URL/hash directly.
    const MANAGER_ROUTES = [
        "task-assignment",
        "team-task-status",
        "manager",
        "approval-history",
        "team-attendance",
        "performance-rating"
    ];

    // Standalone Founder module — its own full-screen shell + sidebar.
    const FOUNDER_ROUTES = [
        "founder-dashboard",
        "founder-approvals",
        "founder-tasks",
        "founder-ratings",
        "founder-projects",
        "founder-portfolio",
        "founder-clients"
    ];

    // Client portal is a standalone full-screen experience (like the Founder shell).
    const CLIENT_ROUTES = ["client-portal"];

    function buildInitials(sName) {
        if (!sName) return "JD";
        const parts = sName.trim().split(/\s+/);
        const first = parts[0] && parts[0][0] ? parts[0][0].toUpperCase() : "";
        const last = parts.length > 1 && parts[parts.length - 1][0]
            ? parts[parts.length - 1][0].toUpperCase() : "";
        return (first + last) || (first || "JD");
    }

    // ── CAP OData v4 unbound action caller ───────────────────────────────────
    async function callAction(sAction, oParams) {
        const sUrl = `/employee/${sAction}`;

        let sCsrfToken = null;
        try {
            const oHead = await fetch("/employee/", {
                method: "GET",
                headers: { "X-CSRF-Token": "Fetch" }
            });
            sCsrfToken = oHead.headers.get("x-csrf-token") || null;
        } catch (e) {
            console.warn("[callAction] CSRF prefetch failed:", e.message);
        }

        const oHeaders = { "Content-Type": "application/json", "Accept": "application/json" };
        if (sCsrfToken) oHeaders["X-CSRF-Token"] = sCsrfToken;

        console.log(`[callAction] POST ${sUrl}`, sCsrfToken ? "(with CSRF)" : "(no CSRF)");

        const oResp = await fetch(sUrl, {
            method: "POST",
            headers: oHeaders,
            body: JSON.stringify(oParams || {})
        });

        if (!oResp.ok) {
            let sErrDetail = oResp.statusText;
            try {
                const oErrJson = await oResp.json();
                sErrDetail = (oErrJson.error && oErrJson.error.message)
                    || JSON.stringify(oErrJson);
            } catch (e) {
                try { sErrDetail = await oResp.text(); } catch (e2) { /* ignore */ }
            }
            console.error(`[callAction] ${sAction} FAILED — HTTP ${oResp.status}:`, sErrDetail);
            throw new Error(`${sAction} failed (HTTP ${oResp.status}): ${sErrDetail}`);
        }

        const oJson = await oResp.json().catch(() => ({}));
        return oJson.value !== undefined ? oJson.value : oJson;
    }

    return Controller.extend("timesheet.app.controller.App", {

        onInit() {
            const sUrlRole = new URLSearchParams(window.location.search).get("role");
            const sSaveRole = (() => { try { return localStorage.getItem("tsRole") || ""; } catch (e) { return ""; } })();
            const sInitRole = (sUrlRole || sSaveRole || "employee").toLowerCase();
            if (sUrlRole) { try { localStorage.setItem("tsRole", sUrlRole); } catch (e) { } }

            this._oAppModel = new JSONModel({
                unreadCount: 0,
                userRole: ["manager", "employee", "hr"].includes(sInitRole) ? sInitRole : "employee",
                // roleResolved gates the visibility of all role-conditional
                // sidebar items.  Always starts as `false` and flips to `true`
                // ONLY once getCurrentUser() returns from the backend — even
                // if localStorage already has a cached role, because that
                // cached value could belong to a different user from the
                // previous session.  This guarantees zero flicker / wrong-
                // styling-then-correct transitions on first login.
                roleResolved: false,
                userName: "",
                userInitials: "JD",
                userProfile: null,
                // Newsletter button visibility — true only when a newsletter the
                // user hasn't opened yet exists (set by _refreshNewsletterBadge).
                showNewsletter: false,
                // Unread group-task notifications → badge on the Group Tasks menu.
                groupTasksUnread: 0,
                // Per-menu unread badges (route → count). Initialised to 0 so
                // every bound counter exists (0 = hidden).
                sidebarBadges: {
                    "group-tasks": 0, "task-description": 0, "manager": 0, "hr-approvals": 0,
                    "history": 0, "leave-history": 0, "rating-history": 0, "timesheet": 0
                },
                // data: URL bound to the toolbar Avatar.src and popover img
                profilePhotoSrc: "",
                profilePhotoDataUrl: ""
            });
            this.getView().setModel(this._oAppModel, "appView");

            // Sidebar collapsible-group state (drives chevron icons via binding;
            // the body max-height class is toggled imperatively in onToggleGroup).
            this._oSideModel = new JSONModel({
                timesheetOpen: false,
                leaveOpen:     false,
                taskOpen:      false,
                managerOpen:   false,
                hrOpen:        false
            });
            this.getView().setModel(this._oSideModel, "side");
            // Maps a group key → the id of the VBox body it expands/collapses.
            this._mGroupBody = {
                timesheet: "navTimesheetBody",
                leave:     "navLeaveBody",
                task:      "navTaskBody",
                manager:   "navManagerBody",
                hr:        "navHrBody"
            };

            // Reference to the popover's Avatar control — set in _openProfilePopover,
            // cleared in afterClose. Allows _applyProfilePhoto to update it async.
            this._oCurrentPopoverAvatar = null;

            // Re-inject photo overlay after every Avatar re-render.
            try {
                const oAv = this.getView().byId("userAvatar");
                if (oAv) {
                    oAv.addEventDelegate({
                        onAfterRendering: () => {
                            if (this._sPhotoBlobUrl) {
                                this._patchAvatarDOM(this._sPhotoBlobUrl);
                            }
                        }
                    }, this);
                }
            } catch (e) { /* ignore */ }

            this._loadCurrentUser();

            const bExplicit = !!(sUrlRole);
            const oComp = this.getOwnerComponent();

            // Separate concerns:
            //   markResolved – flips roleResolved to true exactly ONCE (unblocks sidebar)
            //   applyRole    – ALWAYS updates userRole when backend gives a real value,
            //                  even if markResolved already fired (fixes first-login bug
            //                  where the 3-s timeout beat the OData metadata fetch)
            const applyRole = (sRole) => {
                if (sRole && !bExplicit) {
                    this._oAppModel.setProperty("/userRole", sRole.toLowerCase());
                }
                // Bring up the collapsible rail for the resolved (non-Founder) role.
                this._ensureRail();
            };
            const markResolved = () => {
                if (this._bRoleResolved) return;
                this._bRoleResolved = true;
                this._oAppModel.setProperty("/roleResolved", true);
            };

            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    const sRole = u && (u.role || (u.value && u.value.role));
                    applyRole(sRole);
                    markResolved();
                    // Founders go straight to their dedicated executive dashboard.
                    if (String(sRole || "").toLowerCase() === "founder") {
                        this._redirectFounder();
                        return;
                    }
                    // Clients go straight to their dedicated portal (no internal nav).
                    if (String(sRole || "").toLowerCase() === "client") {
                        this._redirectClient();
                        return;
                    }
                    this._refreshNewsletterBadge();
                    this._refreshGroupTasksBadge();
                    this._refreshSidebarBadges();
                }).catch(() => markResolved());
            } else {
                markResolved();
            }
            // Safety net: unblock the sidebar after 3 s if backend is slow.
            // applyRole() from the backend response will still fire when it
            // arrives, even after this timeout, and update the sidebar items.
            setTimeout(markResolved, 3000);

            this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);

            // Group-task screens publish "groupTasks/changed" when something
            // happens that may alter the unread count (chat read, ended, sent),
            // so the menu badge updates immediately — not only on navigation.
            try {
                sap.ui.getCore().getEventBus().subscribe("groupTasks", "changed",
                    () => { this._refreshGroupTasksBadge(); this._refreshSidebarBadges(); }, this);
            } catch (e) { /* EventBus optional */ }

            // ── Real-time (WebSocket): keep the global badges live ────────────
            // Any real-time event may change the notification / sidebar counts, so
            // refresh them here regardless of which screen the user is on. Throttled
            // (250ms) so a burst of events triggers at most one badge refresh.
            this._fnRtBadges = () => {
                if (this._rtBadgeTimer) return;
                this._rtBadgeTimer = setTimeout(() => {
                    this._rtBadgeTimer = null;
                    try { this._refreshSidebarBadges(); this._refreshGroupTasksBadge(); } catch (e) { /* */ }
                }, 250);
            };
            try {
                sap.ui.getCore().getEventBus().subscribe("rt", "ANY", this._fnRtBadges, this);
            } catch (e) { /* EventBus optional */ }

            // Hide the SplitApp's built-in master toggle button — the sidebar is
            // always shown on desktop and toggled via our own header button on
            // mobile. All sidebar visuals are now handled in style.css
            // (.timesheetSidebar / .tsSideNav), not via imperative DOM styling.
            setTimeout(() => {
                const oApp = this.byId("app");
                if (oApp) {
                    oApp.setMasterButtonText("");
                    oApp.setMasterButtonTooltip("");
                    const oMasterBtn = oApp.getMasterButton?.();
                    if (oMasterBtn) oMasterBtn.setVisible(false);
                }
                setTimeout(() => {
                    document.querySelectorAll(
                        ".sapMSplitAppMasterBtn, .sapMSplitContainerMasterBtn, .sapMSplitAppMasterBtn button, [id*='MasterBtn']"
                    ).forEach(el => {
                        el.style.display = "none"; el.style.visibility = "hidden";
                        el.style.width = "0"; el.style.overflow = "hidden";
                    });
                    document.querySelectorAll(".sapMBarLeft .sapMBtn").forEach(el => {
                        if (el.textContent.includes("Navigation") || el.title === "Navigation") el.style.display = "none";
                    });
                }, 500);
            }, 300);

            // Register once: when the drawer opens/closes, flip the top-bar icon
            // between hamburger (menu2) and close (decline) so the user has a
            // consistent affordance to close the sidebar from any page.
            AppSidebar.onStateChange((bOpen) => {
                const oMenuBtn = this.byId("menuToggleBtn");
                if (oMenuBtn) oMenuBtn.setIcon(bOpen ? "sap-icon://decline" : "sap-icon://menu2");
            });
        },

        // ── Upload Profile Picture ────────────────────────────────────────────
        // ════════════════════════════════════════════════════════════════════
        //  NEWSLETTER  —  view (all roles) + publish (HR only)
        // ════════════════════════════════════════════════════════════════════

        // base64 → object URL so PDFs/images render reliably inside an <iframe>
        // (browsers block data: URLs in frames). Caller revokes the URL on close.
        _b64ToObjectUrl(sB64, sMime) {
            const sBin = atob(sB64);
            const aBytes = new Uint8Array(sBin.length);
            for (let i = 0; i < sBin.length; i++) aBytes[i] = sBin.charCodeAt(i);
            return URL.createObjectURL(new Blob([aBytes], { type: sMime || "application/octet-stream" }));
        },

        // localStorage key prefix for the last newsletter a user opened. Scoped
        // per employeeId so that, when several users share one browser (e.g. mock
        // auth in dev), one person opening it doesn't hide it for the others.
        _NEWSLETTER_SEEN_KEY: "tsNewsletterSeen",

        _newsletterSeenKey() {
            const oComp = this.getOwnerComponent();
            const sId = (oComp.getCurrentEmployeeId && oComp.getCurrentEmployeeId()) || "anon";
            return this._NEWSLETTER_SEEN_KEY + ":" + sId;
        },

        // Show the Newsletter button only when a newsletter exists whose id the
        // user hasn't opened yet. Cheap meta call (no binary transfer).
        // Uses a plain fetch (callAction) rather than an OData $batch — a $batch
        // auth challenge during early app load crashes CAP's basic-auth handler.
        _refreshNewsletterBadge() {
            callAction("getNewsletterMeta").then((r) => {
                r = r || {};
                let sSeen = "";
                try { sSeen = localStorage.getItem(this._newsletterSeenKey()) || ""; } catch (e) { /**/ }
                const bShow = !!(r.hasNewsletter && r.newsletterId && r.newsletterId !== sSeen);
                this._oAppModel.setProperty("/showNewsletter", bShow);
            }).catch(() => { /* leave hidden on failure */ });
        },

        // Refresh the unread-count badge on the Group Tasks menu item.
        // Plain fetch (callAction) to avoid the OData $batch auth path.
        _refreshGroupTasksBadge() {
            callAction("getGroupTasksUnread").then((r) => {
                const n = (r && typeof r.count === "number") ? r.count : 0;
                this._oAppModel.setProperty("/groupTasksUnread", n);
            }).catch(() => { /* leave as-is on failure */ });
        },

        // Menu items that can show an unread-notification badge.
        _BADGE_ROUTES: [
            "group-tasks", "task-description", "manager", "hr-approvals",
            "history", "leave-history", "rating-history", "timesheet"
        ],

        // Pull per-menu unread counts and update the sidebar badges. Always sets
        // every known route (defaulting to 0) so each bound counter stays defined.
        _refreshSidebarBadges() {
            callAction("getSidebarBadges").then((r) => {
                let counts = {};
                try { counts = JSON.parse(r || "{}") || {}; } catch (e) { counts = {}; }
                const full = {};
                this._BADGE_ROUTES.forEach((rt) => { full[rt] = counts[rt] || 0; });
                this._oAppModel.setProperty("/sidebarBadges", full);
                AppSidebar.setBadges();   // mirror counts onto the DOM rail
            }).catch(() => { /* leave as-is on failure */ });
        },

        // When the user opens a page, clear its badge: optimistically zero it,
        // mark the related notifications read on the backend, then re-sync all.
        _clearRouteBadge(sRoute) {
            if (this._BADGE_ROUTES.indexOf(sRoute) === -1) { this._refreshSidebarBadges(); return; }
            const current = this._oAppModel.getProperty("/sidebarBadges/" + sRoute) || 0;
            if (!current) { this._refreshSidebarBadges(); return; }
            this._oAppModel.setProperty("/sidebarBadges/" + sRoute, 0);
            AppSidebar.setBadges();
            callAction("markRouteNotificationsRead", { route: sRoute })
                .then(() => this._refreshSidebarBadges())
                .catch(() => this._refreshSidebarBadges());
        },

        // Mark the current newsletter as seen → hide the button until a new one.
        _markNewsletterSeen(sId) {
            if (!sId) return;
            try { localStorage.setItem(this._newsletterSeenKey(), sId); } catch (e) { /**/ }
            this._oAppModel.setProperty("/showNewsletter", false);
        },

        onOpenNewsletter() {
            const oBtn = this.byId("newsletterBtn");
            if (oBtn) oBtn.setBusy(true);

            callAction("getLatestNewsletter").then((r) => {
                if (oBtn) oBtn.setBusy(false);
                r = r || {};
                if (!r.hasNewsletter || !r.dataBase64) {
                    MessageToast.show("No newsletter has been published yet.");
                    this._oAppModel.setProperty("/showNewsletter", false);
                    return;
                }
                // Opening it counts as "seen" — hide the button until the next one.
                this._markNewsletterSeen(r.newsletterId);
                this._showNewsletterDialog(r);
            }).catch(() => {
                if (oBtn) oBtn.setBusy(false);
                MessageToast.show("Could not load the newsletter.");
            });
        },

        _showNewsletterDialog(r) {
            const sUrl  = this._b64ToObjectUrl(r.dataBase64, r.mimeType);
            const sName = r.fileName || "newsletter";
            const isPdf = /pdf/i.test(r.mimeType || "") || /\.pdf$/i.test(sName);
            const isImg = /^image\//i.test(r.mimeType || "");
            const isDocx = /\.docx$/i.test(sName) ||
                           /officedocument\.wordprocessingml/i.test(r.mimeType || "");

            let oContent;
            if (isPdf) {
                // #toolbar=0&navpanes=0 hides the browser PDF viewer's toolbar
                // and side panes so only the document content shows.
                oContent = new HTML({
                    content: "<iframe src='" + sUrl + "#toolbar=0&navpanes=0&scrollbar=0' style='width:100%;height:70vh;border:none;border-radius:8px;' title='Newsletter'></iframe>"
                });
            } else if (isImg) {
                oContent = new HTML({
                    content: "<div style='text-align:center;'><img src='" + sUrl + "' style='max-width:100%;border-radius:8px;' alt='Newsletter' /></div>"
                });
            } else if (isDocx) {
                // Render Word content inline (converted to HTML via mammoth.js).
                oContent = new HTML({
                    content: "<div class='tsNewsletterDoc'><div class='tsNewsletterLoading'>Loading newsletter…</div></div>"
                });
                this._renderDocxInto(oContent, r.dataBase64);
            } else {
                // Legacy .doc / unknown formats can't be previewed inline.
                oContent = new VBox({
                    alignItems: "Center",
                    items: [
                        new Icon({ src: "sap-icon://document", size: "2.5rem", color: "#2563eb" }).addStyleClass("sapUiSmallMarginBottom"),
                        new Text({ text: "“" + sName + "” can’t be previewed here. Use the download icon to open it.", textAlign: "Center" })
                    ]
                }).addStyleClass("sapUiMediumMargin");
            }

            const triggerDownload = () => {
                const a = document.createElement("a");
                a.href = sUrl; a.download = sName;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            };

            const oDialog = new CustomDialog({
                title: "Newsletter" + (r.fileName ? " · " + r.fileName : ""),
                contentWidth: (isPdf || isDocx) ? "880px" : "560px",
                content: [oContent],
                beginButton: new Button({ icon: "sap-icon://download", tooltip: "Download newsletter", type: "Transparent", press: triggerDownload }),
                afterClose: () => { try { URL.revokeObjectURL(sUrl); } catch (e) { /**/ } oDialog.destroy(); }
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        // Convert a base64 .docx to HTML in the browser and inject it into the
        // given HTML control. mammoth.js is loaded on demand; if it can't load
        // (offline / CSP), we fall back to a download-only message.
        _renderDocxInto(oHtml, sB64) {
            const fail = (sMsg) => oHtml.setContent(
                "<div class='tsNewsletterDoc'><div class='tsNewsletterFail'>" +
                (sMsg || "Couldn’t render this document — please download it to view.") +
                "</div></div>");

            this._loadMammoth().then((mammoth) => {
                if (!mammoth) { fail(); return; }
                let buffer;
                try {
                    const sBin = atob(sB64);
                    const aBytes = new Uint8Array(sBin.length);
                    for (let i = 0; i < sBin.length; i++) aBytes[i] = sBin.charCodeAt(i);
                    buffer = aBytes.buffer;
                } catch (e) { fail(); return; }

                mammoth.convertToHtml({ arrayBuffer: buffer })
                    .then((result) => {
                        const sBody = (result && result.value) || "";
                        oHtml.setContent("<div class='tsNewsletterDoc'>" +
                            (sBody || "<em>This newsletter appears to be empty.</em>") + "</div>");
                    })
                    .catch(() => fail());
            }).catch(() => fail("Couldn’t load the document viewer — please download the file to view it."));
        },

        _loadMammoth() {
            if (window.mammoth) return Promise.resolve(window.mammoth);
            if (this._pMammoth) return this._pMammoth;
            this._pMammoth = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
                s.async = true;
                s.onload = () => resolve(window.mammoth);
                s.onerror = () => { this._pMammoth = null; reject(new Error("mammoth load failed")); };
                document.head.appendChild(s);
            });
            return this._pMammoth;
        },

        onUploadNewsletter() {
            this._oNewsletterFile = null;

            const oFU = new FileUploader({
                width: "100%",
                placeholder: "Choose a PDF or Word document",
                buttonText: "Browse…",
                fileType: ["pdf", "doc", "docx"],
                maximumFileSize: 10,
                change: (oEv) => { this._oNewsletterFile = (oEv.getParameter("files") || [])[0] || null; },
                typeMissmatch: () => MessageToast.show("Only PDF or Word documents are allowed."),
                fileSizeExceed: () => MessageToast.show("File must be under 10 MB.")
            });

            const oUploadBtn = new Button({
                text: "Upload & Publish",
                type: "Emphasized",
                icon: "sap-icon://upload",
                press: () => {
                    const oFile = this._oNewsletterFile;
                    if (!oFile) { MessageToast.show("Please choose a file."); return; }
                    oDialog.setBusy(true);
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const sB64 = String(ev.target.result).replace(/^data:[^;]+;base64,/, "");
                        this._publishNewsletter(oFile.name, oFile.type || "application/octet-stream", sB64)
                            .then(() => {
                                oDialog.setBusy(false);
                                oDialog.close();
                                MessageToast.show("Newsletter published — everyone can now view it.");
                                // A new newsletter exists → the button should reappear.
                                this._refreshNewsletterBadge();
                            })
                            .catch((err) => {
                                oDialog.setBusy(false);
                                MessageBox.error("Upload failed: " + ((err && err.message) || err));
                            });
                    };
                    reader.onerror = () => { oDialog.setBusy(false); MessageToast.show("Could not read the file."); };
                    reader.readAsDataURL(oFile);
                }
            });

            const oDialog = new CustomDialog({
                title: "Publish Newsletter",
                contentWidth: "460px",
                content: [
                    new VBox({
                        items: [
                            new Text({ text: "Upload a PDF or Word document. It replaces the current newsletter and becomes visible to everyone via the Newsletter button.", wrapping: true })
                                .addStyleClass("sapUiSmallMarginBottom"),
                            oFU
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: oUploadBtn,
                endButton: new Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _publishNewsletter(sFileName, sMime, sB64) {
            const oComp = this.getOwnerComponent();
            const oHr = oComp.getModel("hr");
            if (!oHr) return Promise.reject(new Error("HR service unavailable."));
            const sEmpId = oComp.getCurrentEmployeeId && oComp.getCurrentEmployeeId();
            if (!sEmpId) return Promise.reject(new Error("Could not identify the HR user."));

            const oCtx = oHr.bindContext("/uploadEmployeeDocument(...)");
            oCtx.setParameter("employeeId",   sEmpId);
            oCtx.setParameter("documentType", "Newsletter");
            oCtx.setParameter("fileName",     sFileName);
            oCtx.setParameter("mimeType",     sMime);
            oCtx.setParameter("description",  "Company newsletter");
            oCtx.setParameter("dataBase64",   sB64);
            return oCtx.execute();
        },

        onUploadProfilePicture() {
            let oInput = document.getElementById("__tsProfilePhotoInput");
            if (!oInput) {
                oInput = document.createElement("input");
                oInput.type = "file";
                oInput.id = "__tsProfilePhotoInput";
                oInput.accept = "image/png, image/jpeg, image/jpg, image/webp";
                oInput.style.display = "none";
                document.body.appendChild(oInput);
            }
            oInput.value = "";

            oInput.onchange = async (oEvt) => {
                const oFile = oEvt.target.files && oEvt.target.files[0];
                if (!oFile) return;

                // ── Compress image: max 350px, progressive quality fallback ──
                const sDataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            const MAX = 350;
                            let w = img.width, h = img.height;
                            if (w > MAX || h > MAX) {
                                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                                else { w = Math.round(w * MAX / h); h = MAX; }
                            }
                            const canvas = document.createElement("canvas");
                            canvas.width = w; canvas.height = h;
                            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                            let out = canvas.toDataURL("image/jpeg", 0.75);
                            if (out.length > 50000) out = canvas.toDataURL("image/jpeg", 0.45);
                            if (out.length > 50000) out = canvas.toDataURL("image/jpeg", 0.25);
                            resolve(out);
                        };
                        img.src = e.target.result;
                    };
                    reader.readAsDataURL(oFile);
                });

                const approxKB = Math.round(sDataUrl.length * 0.75 / 1024);
                console.log(`[ProfilePhoto] Compressed: ~${approxKB} KB`);

                // Show optimistic blob URL preview immediately
                const sPreviewBlobUrl = await this._toBlobUrl(sDataUrl);
                this._applyProfilePhoto(sPreviewBlobUrl, sDataUrl);

                try {
                    const oResult = await callAction("uploadProfilePhoto", { dataBase64: sDataUrl });
                    if (oResult && oResult.success) {
                        MessageToast.show("Profile picture saved!");
                        // Re-fetch from DB to get the definitive blob URL
                        await this._loadProfilePhoto();
                    } else {
                        MessageToast.show("Save may have failed — check console.");
                    }
                } catch (e) {
                    MessageToast.show("Could not save photo — see F12 Console for details.");
                }
            };

            oInput.click();
        },

        // ── Load photo from DB on every login/refresh ─────────────────────────
        async _loadProfilePhoto() {
            try {
                const oResult = await callAction("getProfilePhoto", {});
                const src = oResult && oResult.dataBase64;
                console.log("[ProfilePhoto] Load result — has src:", !!src,
                    "| mime:", oResult && oResult.mimeType);

                if (src && src.length > 100) {
                    const sDataUrl = src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}`;
                    const sBlobUrl = await this._toBlobUrl(sDataUrl);
                    this._applyProfilePhoto(sBlobUrl, sDataUrl);
                }
            } catch (e) {
                console.warn("[ProfilePhoto] Load failed:", e.message || e);
            }
        },

        // ── Convert data-URL → same-origin blob URL ───────────────────────────
        // Using fetch() to let the browser parse the data URL is more reliable
        // than manual atob() — the browser handles padding, whitespace, etc.
        // blob: URLs from the same origin are never blocked by SAP UI5's URL
        // sanitizer or any Content-Security-Policy img-src restriction.
        async _toBlobUrl(sDataUrl) {
            try {
                const resp = await fetch(sDataUrl);
                const blob = await resp.blob();
                if (blob && blob.size > 0) {
                    const url = URL.createObjectURL(blob);
                    console.log("[ProfilePhoto] Blob URL ready, size:", blob.size);
                    return url;
                }
            } catch (e) {
                console.warn("[ProfilePhoto] fetch-to-blob failed:", e.message);
            }
            return sDataUrl; // fallback — data URL direct
        },

        // ── Inject an <img> overlay directly into the Avatar DOM ─────────────
        // blob: URLs bypass all SAP UI5 / browser sanitization for img-src.
        // .__tsAvatarPhoto marks the element so duplicates are removed on each
        // onAfterRendering fire without accumulating.
        _patchAvatarDOM(sBlobUrl) {
            try {
                const oAvatar = this.getView().byId("userAvatar");
                const domRef = oAvatar && oAvatar.getDomRef();
                if (!domRef) return;

                // Remove any previous overlay
                domRef.querySelectorAll(".__tsAvatarPhoto").forEach(el => el.remove());

                // Inject <img> that fills the full Avatar circle
                const img = document.createElement("img");
                img.className = "__tsAvatarPhoto";
                img.src = sBlobUrl;
                img.alt = "";
                img.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100%;" +
                    "border-radius:50%;object-fit:cover;pointer-events:none;" +
                    "z-index:10;display:block;";

                domRef.style.position = "relative";
                domRef.style.overflow = "hidden";
                domRef.appendChild(img);

                // Hide SAP Avatar's built-in initials / icon text
                domRef.querySelectorAll(
                    ".sapFAvatarInitialsHolder,.sapMAvatarInitialsHolder," +
                    ".sapFAvatarIcon,.sapFAvatarInitials"
                ).forEach(el => { el.style.visibility = "hidden"; });
            } catch (e) { /* ignore */ }
        },

        // ── Apply photo to toolbar Avatar + popover ───────────────────────────
        // sBlobUrl  : same-origin blob: URL — used for img src everywhere
        // sDataUrl  : original data: URL — kept as popover fallback only
        _applyProfilePhoto(sBlobUrl, sDataUrl) {
            if (!sBlobUrl) return;

            this._sPhotoBlobUrl = sBlobUrl;
            this._sPhotoDataUrl = sDataUrl || sBlobUrl;

            // Model drives Avatar src binding
            this._oAppModel.setProperty("/profilePhotoSrc", sBlobUrl);
            this._oAppModel.setProperty("/profilePhotoDataUrl", sDataUrl || sBlobUrl);

            // Imperative Avatar API (resets internal error state)
            try {
                const oAvatar = this.getView().byId("userAvatar");
                if (oAvatar) {
                    oAvatar.setSrc(sBlobUrl);
                    oAvatar.setInitials("");
                    oAvatar.setBackgroundColor("Transparent");
                }
            } catch (e) { /* view not yet ready */ }

            // DOM overlay — also re-applied by onAfterRendering delegate
            this._patchAvatarDOM(sBlobUrl);

            // Patch open popover avatar
            if (this._sPopoverAvatarDomId) {
                const el = document.getElementById(this._sPopoverAvatarDomId);
                if (el) {
                    el.innerHTML = `<img src="${sBlobUrl}" alt=""
                        style="width:100%;height:100%;object-fit:cover;display:block;"/>`;
                }
            }
        },

        // ── Sidebar nav lists (used for active-route highlighting) ────────────
        _aNavListIds: [
            "navOverviewList", "navTimesheetList", "navLeaveList",
            "navTaskList", "navRatingList", "navManagerList", "navHrList"
        ],

        // Maps a route name → the group it lives in, so navigating to a route
        // inside a collapsed group auto-expands that group. Standalone items
        // (Overview, Rating History) have no entry here.
        _mRouteToGroup: {
            timesheet: "timesheet", history: "timesheet",
            "apply-leave": "leave", "leave-history": "leave",
            "task-description": "task", "task-status": "task",
            "group-tasks": "task", "group-task-detail": "task",
            "task-assignment": "manager", manager: "manager",
            "approval-history": "manager", "team-attendance": "manager",
            "performance-rating": "manager",
            "add-employee": "hr", "all-employees": "hr", "hr-approvals": "hr"
        },

        // ── Group expand/collapse ─────────────────────────────────────────────
        onToggleGroup(oEvent) {
            const sGroup = oEvent.getSource().data("group");
            this._setGroupOpen(sGroup, !this._oSideModel.getProperty("/" + sGroup + "Open"));
        },

        _setGroupOpen(sGroup, bOpen) {
            if (!sGroup) return;
            this._oSideModel.setProperty("/" + sGroup + "Open", bOpen);
            const oBody = this.byId(this._mGroupBody[sGroup]);
            if (oBody) oBody.toggleStyleClass("tsNavOpen", bOpen);
        },

        // Send the Founder to their dedicated dashboard (once) and hide the shell.
        _redirectFounder() {
            try {
                this._applyFounderShell("founder-dashboard");
                if (!/founder-dashboard/.test(window.location.hash || "")) {
                    this.getOwnerComponent().getRouter().navTo("founder-dashboard", {}, true);
                }
            } catch (e) { /* ignore */ }
        },

        _redirectClient() {
            try {
                this._applyFounderShell("client-portal");
                if (!/client-portal/.test(window.location.hash || "")) {
                    this.getOwnerComponent().getRouter().navTo("client-portal", {}, true);
                }
            } catch (e) { /* ignore */ }
        },

        // The Founder & Client modules are standalone full-screen experiences —
        // hide the SplitApp master (sidebar) and let the page fill the viewport.
        _applyFounderShell(sRouteName) {
            const bFounder = FOUNDER_ROUTES.indexOf(sRouteName) !== -1;
            const bClient = CLIENT_ROUTES.indexOf(sRouteName) !== -1;
            try {
                const oApp = this.byId("app");
                if (oApp) { if (bFounder || bClient) oApp.hideMaster(); else oApp.showMaster(); }
                document.body.classList.toggle("tsFounderMode", bFounder);
                document.body.classList.toggle("tsClientMode", bClient);
                // A client must never have the employee rail attached.
                if (bClient) {
                    try { AppSidebar.detach(); } catch (e) { /* */ }
                    const oMenuBtn = this.byId("menuToggleBtn");
                    if (oMenuBtn) oMenuBtn.setVisible(false);
                }
            } catch (e) { /* ignore */ }
        },

        // ── Route matched — highlight the active item, auto-expand its group ──
        _onRouteMatched(oEvent) {
            const sRouteName = oEvent.getParameter("name");

            // Toggle the standalone full-screen shell for the Founder Dashboard.
            this._applyFounderShell(sRouteName);

            // Guard: only a Founder may open the Founder module. Others bounce
            // to their normal dashboard (the data endpoints are 403-gated anyway).
            if (FOUNDER_ROUTES.indexOf(sRouteName) !== -1) {
                const oC = this.getOwnerComponent();
                const sR = (oC._oCurrentUser && oC._oCurrentUser.role) || this._oAppModel.getProperty("/userRole") || "";
                if (oC._oCurrentUser && String(sR).toLowerCase() !== "founder") {
                    oC.getRouter().navTo("dashboard", {}, true);
                    return;
                }
            }

            // Guard: only a Client may open the Client portal. A client landing on
            // any other route is bounced into their portal (full isolation).
            const oCC = this.getOwnerComponent();
            const sCR = (oCC._oCurrentUser && oCC._oCurrentUser.role) || this._oAppModel.getProperty("/userRole") || "";
            const bIsClient = oCC._oCurrentUser && String(sCR).toLowerCase() === "client";
            if (CLIENT_ROUTES.indexOf(sRouteName) !== -1) {
                if (oCC._oCurrentUser && !bIsClient) { oCC.getRouter().navTo("dashboard", {}, true); return; }
            } else if (bIsClient) {
                // A client must never reach internal screens.
                this._redirectClient();
                return;
            }

            // Re-check for a newly published newsletter when landing on the
            // dashboard, so the button reappears mid-session after HR publishes.
            // Gate on getCurrentUser so it never fires before auth is ready.
            if (sRouteName === "dashboard") {
                const oComp = this.getOwnerComponent();
                if (oComp.getCurrentUser) {
                    oComp.getCurrentUser().then(() => this._refreshNewsletterBadge());
                }
            }

            // Keep the Group Tasks unread badge fresh as the user navigates.
            this._refreshGroupTasksBadge();

            // Clear the badge for the page just opened (mark its notifications
            // read), and re-sync the rest of the menu badges.
            this._clearRouteBadge(sRouteName);

            // ── Role guard: Management screens are manager-only ──────────────
            // Redirect any non-manager who reaches a manager route to the
            // dashboard. Uses the backend-resolved role; falls back to the
            // app model role until getCurrentUser() resolves on a cold load.
            if (MANAGER_ROUTES.indexOf(sRouteName) !== -1) {
                const oComp = this.getOwnerComponent();
                const isManager = () => {
                    const sRole = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                        || this._oAppModel.getProperty("/userRole") || "employee";
                    return String(sRole).toLowerCase() === "manager";
                };
                const bounce = () => oComp.getRouter().navTo("dashboard", {}, true);

                if (oComp._oCurrentUser) {
                    // Role already known — enforce immediately.
                    if (!isManager()) { bounce(); return; }
                } else if (oComp.getCurrentUser) {
                    // Role not resolved yet — re-check once the backend answers.
                    oComp.getCurrentUser().then(() => { if (!isManager()) bounce(); });
                    if (!isManager()) { bounce(); return; }
                }
            }

            // Make sure the group containing the active route is expanded.
            const sGroup = this._mRouteToGroup[sRouteName];
            if (sGroup) this._setGroupOpen(sGroup, true);

            // Toggle the active style class on the matching item across all lists.
            // CSS (.tsNavItem.tsNavItemActive) handles all visuals — no inline DOM.
            this._aNavListIds.forEach(sId => {
                const oList = this.byId(sId);
                if (!oList) return;
                oList.getItems().forEach(oItem => {
                    oItem.toggleStyleClass("tsNavItemActive", oItem.data("target") === sRouteName);
                });
            });

            setTimeout(() => {
                document.querySelectorAll(".sapMSplitAppMasterBtn, .sapMSplitContainerMasterBtn, [id*='MasterBtn']")
                    .forEach(el => { el.style.display = "none"; el.style.visibility = "hidden"; });
            }, 200);
            this._refreshUnreadCount();
        },

        _refreshUnreadCount() {
            const oComp = this.getOwnerComponent();
            const oNotifModel = oComp.getModel("notifications");
            if (!oNotifModel) return;
            const items = oNotifModel.getProperty("/items") || [];
            const sCurrentId = oComp.getCurrentEmployeeId();
            const sRole = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                || this._oAppModel.getProperty("/userRole") || "employee";
            const mine = items.filter(n => {
                if (n.recipientEmployeeId) return n.recipientEmployeeId === sCurrentId;
                return sRole !== "manager";
            });
            this._oAppModel.setProperty("/unreadCount", mine.filter(n => !n.read).length);
        },

        // Bring up / refresh the collapsible DOM rail for the resolved role.
        // Founders keep their dedicated FounderSidebar (the rail is detached).
        _ensureRail() {
            const sRole = this._oAppModel.getProperty("/userRole");
            const oMenuBtn = this.byId("menuToggleBtn");
            // Founder has its own shell; Client is an external user with NO access
            // to any internal navigation — both get no employee rail.
            if (!sRole || sRole === "founder" || sRole === "client") {
                AppSidebar.detach();
                if (oMenuBtn) oMenuBtn.setVisible(false);
                return;
            }
            // Non-Founder: the top-bar hamburger is always visible on every page.
            if (oMenuBtn) {
                oMenuBtn.setVisible(true);
                const bOpen = document.body.classList.contains("tsRailOpen");
                oMenuBtn.setIcon(bOpen ? "sap-icon://decline" : "sap-icon://menu2");
            }
            let sLogo = "";
            try { sLogo = sap.ui.require.toUrl("timesheet/app/images/companylogo.jpg"); } catch (e) { /* */ }
            AppSidebar.attach(this, sRole, sLogo);
        },

        // The top-bar menu button pins / unpins the rail (icon-rail ⇄ full menu).
        onMenuToggle() {
            AppSidebar.toggle();
        },

        onNavSelect(oEvent) {
            const sTarget = oEvent.getSource().data("target");
            if (sTarget) this.getOwnerComponent().getRouter().navTo(sTarget);
        },

        onLogout() {
            MessageBox.confirm("Sign out of Timesheet?", {
                title: "Logout",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: (sAction) => {
                    if (sAction !== MessageBox.Action.OK) return;
                    this._performLogout();
                }
            });
        },

        _performLogout() {
            try {
                const oComp = this.getOwnerComponent();
                ["history", "locked", "notifications", "tasks", "taskUpdates"].forEach(name => {
                    const m = oComp.getModel(name);
                    if (m && m.setData) m.setData({});
                });
                oComp._oCurrentUser = null;
                oComp._pCurrentUser = null;
                oComp._employeeCache = {};
            } catch (e) { }
            try { localStorage.clear(); } catch (e) { }
            try { sessionStorage.clear(); } catch (e) { }
            window.location.replace("/logout");
        },

        _loadCurrentUser() {
            const oComp = this.getOwnerComponent();
            if (!oComp) return;

            const useEmp = (emp) => {
                if (!emp) return;
                // Login gate (mirrors the backend getCurrentUser check): block the
                // session and show an error when the email is not registered, the
                // account is inactive, or the master role does not match the
                // XSUAA/JWT scope.
                if (emp.accessDenied) { this._blockAccess(emp.accessDenied); return; }
                // Issue 3: a deactivated account may authenticate via the IdP but
                // must not be allowed to use the app — block it and show a message.
                if (emp.isActive === false) { this._blockAccess('inactive'); return; }
                this._oAppModel.setProperty("/userName", emp.employeeName || "");
                this._oAppModel.setProperty("/userInitials", buildInitials(emp.employeeName));
                this._oAppModel.setProperty("/userProfile", {
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName,
                    designation: emp.designation || "—",
                    email: emp.email || "—",
                    address: emp.address || "—",
                    mobileNumber: emp.mobileNumber || "—",
                    isActive: emp.isActive !== false
                });
                // Fetch photo from DB once identity is confirmed
                this._loadProfilePhoto();
            };

            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (u && (u.employeeId || u.employeeName)) { useEmp(u); return; }
                    if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
                        oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(useEmp);
                    }
                });
                return;
            }
            if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
                oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(useEmp);
            }
        },

        // Login gate — show the message once and sign out so the user cannot
        // reach any screen. Backend getCurrentUser / before('*') guards enforce
        // the same rules server-side for direct API calls.
        _blockAccess(sReason) {
            if (this._bAccessBlocked) return;
            this._bAccessBlocked = true;
            const MAP = {
                "not-registered": {
                    title: "Access Denied",
                    text: "Your email is not registered in Employee Master. Please contact the administrator."
                },
                "role-mismatch": {
                    title: "Access Denied",
                    text: "Your assigned role does not match your Employee Master record. Please contact the administrator."
                },
                "inactive": {
                    title: "Account Inactive",
                    text: "Your account is inactive. Please contact the administrator."
                }
            };
            const cfg = MAP[sReason] || MAP["role-mismatch"];
            MessageBox.error(cfg.text, {
                title: cfg.title,
                actions: [MessageBox.Action.OK],
                emphasizedAction: MessageBox.Action.OK,
                onClose: () => this._performLogout()
            });
        },

        onNavPerfRating() {
            this.getOwnerComponent().getRouter().navTo("performance-rating");
        },

        onProfilePress(oEvent) {
            const oSource = oEvent && oEvent.getSource && oEvent.getSource();
            const oProfile = this._oAppModel.getProperty("/userProfile");
            if (oProfile) { this._openProfilePopover(oProfile, oSource); return; }

            const oComp = this.getOwnerComponent();
            if (!oComp || !oComp.getEmployeeById || !oComp.getCurrentEmployeeId) {
                MessageToast.show("Profile unavailable."); return;
            }
            const sId = oComp.getCurrentEmployeeId();
            oComp.getEmployeeById(sId).then(emp => {
                if (!emp) { MessageToast.show("Profile unavailable."); return; }
                this._oAppModel.setProperty("/userName", emp.employeeName || "");
                this._oAppModel.setProperty("/userInitials", buildInitials(emp.employeeName));
                const oFresh = {
                    employeeId: emp.employeeId, employeeName: emp.employeeName,
                    designation: emp.designation || "—", email: emp.email || "—",
                    address: emp.address || "—", mobileNumber: emp.mobileNumber || "—",
                    isActive: emp.isActive
                };
                this._oAppModel.setProperty("/userProfile", oFresh);
                this._openProfilePopover(oFresh, oSource);
            });
        },

        _openProfilePopover(oProfile, oSource) {
            if (this._oProfilePopover) {
                this._oProfilePopover.close();
                this._oProfilePopover.destroy();
                this._oProfilePopover = null;
            }
            this._oCurrentPopoverAvatar = null;

            const sInitials = this._oAppModel.getProperty("/userInitials");
            // Use blob URL for the popover avatar (never sanitized by browser or SAP)
            const sPhotoUrl = this._sPhotoBlobUrl
                || this._oAppModel.getProperty("/profilePhotoSrc")
                || null;

            // Unique DOM id so _applyProfilePhoto can patch the <img> if called later
            const sAvatarId = "__tsPopAvatar_" + Date.now();
            this._sPopoverAvatarDomId = sAvatarId;

            // Build the entire profile card as one HTML string.
            const sAvatarCircle = sPhotoUrl
                ? `<div id="${sAvatarId}"
                        style="width:72px;height:72px;border-radius:50%;overflow:hidden;
                               flex-shrink:0;border:3px solid #e2e8f0;background:#f1f5f9;">
                       <img src="${sPhotoUrl}" alt="Profile"
                            style="width:100%;height:100%;object-fit:cover;display:block;"/>
                   </div>`
                : `<div id="${sAvatarId}"
                        style="width:72px;height:72px;border-radius:50%;flex-shrink:0;
                               background:#6366f1;border:3px solid #e2e8f0;
                               display:flex;align-items:center;justify-content:center;
                               font-size:1.6rem;font-weight:700;color:#fff;">
                       ${sInitials}
                   </div>`;

            const sStatus = oProfile.isActive === false ? "Inactive" : "Active";
            const sStatusColor = oProfile.isActive === false ? "#dc2626" : "#16a34a";

            const sPopoverContent =
                `<div style="font-family:'Segoe UI',Arial,sans-serif;padding:4px 0 8px;">

                    <!-- Header: avatar + name/role/id -->
                    <div style="display:flex;align-items:center;gap:16px;
                                padding:12px 20px 16px;border-bottom:1px solid #f1f5f9;">
                        ${sAvatarCircle}
                        <div>
                            <div style="font-size:1.05rem;font-weight:700;color:#111827;
                                        line-height:1.2;">${oProfile.employeeName || ""}</div>
                            <div style="font-size:0.82rem;color:#6b7280;margin-top:2px;">
                                ${oProfile.designation || "—"}</div>
                            <div style="font-size:0.75rem;color:#9ca3af;margin-top:1px;">
                                ID: ${oProfile.employeeId || ""}</div>
                        </div>
                    </div>

                    <!-- Fields -->
                    <div style="padding:12px 20px;display:flex;flex-direction:column;gap:10px;">

                        <div style="display:flex;align-items:flex-start;gap:12px;">
                            <span style="color:#3b82f6;font-size:1rem;margin-top:1px;">✉</span>
                            <div>
                                <div style="font-size:0.7rem;color:#9ca3af;
                                            text-transform:uppercase;letter-spacing:.5px;">Email</div>
                                <div style="font-size:0.85rem;color:#374151;">
                                    ${oProfile.email || "—"}</div>
                            </div>
                        </div>

                        <div style="display:flex;align-items:flex-start;gap:12px;">
                            <span style="color:#3b82f6;font-size:1rem;margin-top:1px;">📞</span>
                            <div>
                                <div style="font-size:0.7rem;color:#9ca3af;
                                            text-transform:uppercase;letter-spacing:.5px;">Mobile</div>
                                <div style="font-size:0.85rem;color:#374151;">
                                    ${oProfile.mobileNumber || "—"}</div>
                            </div>
                        </div>

                        <div style="display:flex;align-items:flex-start;gap:12px;">
                            <span style="color:#3b82f6;font-size:1rem;margin-top:1px;">📍</span>
                            <div>
                                <div style="font-size:0.7rem;color:#9ca3af;
                                            text-transform:uppercase;letter-spacing:.5px;">Address</div>
                                <div style="font-size:0.85rem;color:#374151;">
                                    ${oProfile.address || "—"}</div>
                            </div>
                        </div>

                        <div style="display:flex;align-items:flex-start;gap:12px;">
                            <span style="color:${sStatusColor};font-size:1rem;margin-top:1px;">●</span>
                            <div>
                                <div style="font-size:0.7rem;color:#9ca3af;
                                            text-transform:uppercase;letter-spacing:.5px;">Status</div>
                                <div style="font-size:0.85rem;font-weight:600;
                                            color:${sStatusColor};">${sStatus}</div>
                            </div>
                        </div>

                    </div>
                </div>`;

            const oContentHTML = new sap.ui.core.HTML({
                content: sPopoverContent,
                sanitizeContent: false
            });

            // Logout button stays as a proper UI5 Button so press handler works
            const oLogoutButton = new Button({
                text: "Log Out",
                icon: "sap-icon://log",
                type: "Reject",
                width: "100%",
                press: () => { this._oProfilePopover.close(); this.onLogout(); }
            }).addStyleClass("tsProfileLogoutButton");

            const oLogoutWrap = new VBox({
                items: [oLogoutButton]
            });
            oLogoutWrap.getDomRef && null; // lazy — rendered by UI5
            // Add bottom padding via style class applied after render
            oLogoutWrap.addStyleClass("sapUiSmallMarginBeginEnd sapUiSmallMarginBottom");

            this._oProfilePopover = new ResponsivePopover({
                title: "My Profile",
                placement: "Bottom",
                contentWidth: "340px",
                modal: false,
                showHeader: true,
                showCloseButton: true,
                content: [ oContentHTML, oLogoutWrap ],
                afterClose: () => {
                    if (this._oProfilePopover) {
                        this._oProfilePopover.destroy();
                        this._oProfilePopover = null;
                    }
                    this._oCurrentPopoverAvatar = null;
                    this._sPopoverAvatarDomId   = null;
                }
            }).addStyleClass("tsProfileDialog");

            this.getView().addDependent(this._oProfilePopover);
            this._oProfilePopover.openBy(oSource);
            // Photo already in model — no _loadProfilePhoto() call needed here.
        }
    });
});