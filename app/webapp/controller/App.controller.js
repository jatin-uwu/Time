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
    "sap/ui/core/Icon"
], (Controller, JSONModel, MessageToast, MessageBox, ResponsivePopover, Bar, Button, VBox, HBox, Label, Text, Title, Avatar, Icon) => {
    "use strict";

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
                }).catch(() => markResolved());
            } else {
                markResolved();
            }
            // Safety net: unblock the sidebar after 3 s if backend is slow.
            // applyRole() from the backend response will still fire when it
            // arrives, even after this timeout, and update the sidebar items.
            setTimeout(markResolved, 3000);

            this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);

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

            const _handleResize = () => {
                const oMenuBtn = this.byId("menuToggleBtn");
                const oApp = this.byId("app");
                const isMobile = window.innerWidth <= 550;
                if (oMenuBtn) oMenuBtn.setVisible(isMobile);
                if (oApp) { if (isMobile) oApp.hideMaster(); else oApp.showMaster(); }
            };
            _handleResize();
            window.addEventListener("resize", _handleResize);
        },

        // ── Upload Profile Picture ────────────────────────────────────────────
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

        // ── Route matched — highlight the active item, auto-expand its group ──
        _onRouteMatched(oEvent) {
            const sRouteName = oEvent.getParameter("name");

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

        onMenuToggle() {
            const oApp = this.byId("app");
            if (oApp.isMasterShown()) oApp.hideMaster(); else oApp.showMaster();
        },

        onNavSelect(oEvent) {
            const sTarget = oEvent.getSource().data("target");
            console.log("Navigating to :", sTarget);
            if (sTarget) this.getOwnerComponent().getRouter().navTo(sTarget);
            const oApp = this.byId("app");
            if (oApp && oApp.isMasterShown()) oApp.hideMaster();
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