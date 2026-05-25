sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
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
                userName: "",
                userInitials: "JD",
                userProfile: null,
                profilePhotoSrc: ""
            });
            this.getView().setModel(this._oAppModel, "appView");

            // Reference to the popover's Avatar control — set in _openProfilePopover,
            // cleared in afterClose. Allows _applyProfilePhoto to update it async.
            this._oCurrentPopoverAvatar = null;

            this._loadCurrentUser();

            const bExplicit = !!(sUrlRole || sSaveRole && false);
            const oComp = this.getOwnerComponent();
            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (bExplicit) return;
                    const sRole = u && (u.role || (u.value && u.value.role));
                    if (sRole) this._oAppModel.setProperty("/userRole", sRole.toLowerCase());
                });
            }

            this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);

            setTimeout(() => {
                const oPage = this.byId("navPage");
                if (!oPage || !oPage.getDomRef()) return;

                oPage.getDomRef().style.backgroundColor = "#1e293b";
                oPage.getDomRef().style.borderRadius = "0";
                oPage.getDomRef().querySelectorAll(".sapMPageBg, .sapMPage, .sapMList, .sapMListUl")
                    .forEach(el => { el.style.borderRadius = "0"; el.style.background = "transparent"; });

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

                ["mainNavList"].forEach(sId => {
                    const oList = this.byId(sId);
                    if (!oList || !oList.getDomRef()) return;
                    oList.getDomRef().style.background = "transparent";
                    const oHeader = oList.getDomRef().querySelector(".sapMListHdr, .sapMListHdrText");
                    if (oHeader) {
                        oHeader.style.color = "#ffffff";
                        oHeader.style.background = "transparent";
                        oHeader.style.fontWeight = "600";
                        oHeader.style.fontSize = "0.75rem";
                        oHeader.style.letterSpacing = "1px";
                    }
                    oList.getItems().forEach(oItem => {
                        if (!oItem.getDomRef()) return;
                        oItem.getDomRef().style.background = "transparent";
                        oItem.getDomRef().style.borderBottom = "none";
                        oItem.getDomRef().querySelectorAll("*").forEach(el => {
                            el.style.color = "#94a3b8"; el.style.background = "transparent";
                        });
                        oItem.getDomRef().addEventListener("mouseenter", () => {
                            oItem.getDomRef().style.background = "#334155";
                            oItem.getDomRef().style.borderRadius = "8px";
                        });
                        oItem.getDomRef().addEventListener("mouseleave", () => {
                            if (!oItem.hasStyleClass("tsNavItemActive")) {
                                oItem.getDomRef().style.background = "transparent";
                                oItem.getDomRef().style.borderRadius = "0";
                            }
                        });
                    });
                });

                setTimeout(() => {
                    const oManagerList = this.byId("managerNavList");
                    if (!oManagerList || !oManagerList.getDomRef()) return;
                    oManagerList.getDomRef().style.background = "transparent";
                    oManagerList.getItems().forEach(oItem => {
                        if (!oItem.getDomRef()) return;
                        oItem.getDomRef().style.background = "transparent";
                        oItem.getDomRef().style.borderBottom = "none";
                        oItem.getDomRef().querySelectorAll("*").forEach(el => {
                            el.style.color = "#94a3b8"; el.style.background = "transparent";
                        });
                        oItem.getDomRef().addEventListener("mouseenter", () => {
                            oItem.getDomRef().style.background = "#334155";
                            oItem.getDomRef().style.borderRadius = "8px";
                        });
                        oItem.getDomRef().addEventListener("mouseleave", () => {
                            if (!oItem.hasStyleClass("tsNavItemActive")) {
                                oItem.getDomRef().style.background = "transparent";
                                oItem.getDomRef().style.borderRadius = "0";
                            }
                        });
                    });
                }, 600);

                const oFooter = oPage.getDomRef().querySelector(".sapMPageFooter, .sapMTB");
                if (oFooter) {
                    oFooter.style.background = "#1e293b";
                    oFooter.style.borderTop = "1px solid #334155";
                    oFooter.querySelectorAll("*").forEach(el => {
                        el.style.background = "transparent";
                        el.style.border = "none";
                        el.style.color = "#94a3b8";
                        el.style.boxShadow = "none";
                    });
                }
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

                // Show optimistic preview immediately
                this._applyProfilePhoto(sDataUrl);

                try {
                    const oResult = await callAction("uploadProfilePhoto", { dataBase64: sDataUrl });
                    if (oResult && oResult.success) {
                        MessageToast.show("Profile picture saved!");
                        // Re-fetch from DB to confirm round-trip
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
                    // Ensure data-URL prefix exists (backend adds it, but guard anyway)
                    const sSrc = src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}`;
                    this._applyProfilePhoto(sSrc);
                }
            } catch (e) {
                // Non-fatal — avatar shows initials if no photo saved yet
                console.warn("[ProfilePhoto] Load failed:", e.message || e);
            }
        },

        // ── Convert a data-URL to a Blob URL ─────────────────────────────────
        // Blob URLs (blob:https://...) are always CSP-safe; data: URLs are
        // blocked by the AppRouter's img-src Content-Security-Policy header.
        _dataUrlToBlobUrl(sDataUrl) {
            try {
                const arr = sDataUrl.split(",");
                const mimeMatch = arr[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
                const bstr = atob(arr[1]);
                const u8 = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                const blob = new Blob([u8], { type: mime });
                return URL.createObjectURL(blob);
            } catch (e) {
                console.warn("[ProfilePhoto] Blob conversion failed:", e.message);
                return sDataUrl; // fallback to data URL
            }
        },

        // ── Write photo to every avatar surface ──────────────────────────────
        _applyProfilePhoto(sDataUrl) {
            if (!sDataUrl) return;

            // 1. Model property — stores the original data URL (used when
            //    reopening the popover to generate a fresh blob URL)
            this._oAppModel.setProperty("/profilePhotoSrc", sDataUrl);

            // 2. Convert to blob URL — CSP-safe for both toolbar Avatar and
            //    popover <img>. Revoke previous blob to avoid memory leaks.
            if (this._sPhotoBlobUrl) {
                try { URL.revokeObjectURL(this._sPhotoBlobUrl); } catch (e) { /**/ }
            }
            const sBlobUrl = sDataUrl.startsWith("blob:")
                ? sDataUrl
                : this._dataUrlToBlobUrl(sDataUrl);
            this._sPhotoBlobUrl = sBlobUrl;

            // 3. Toolbar Avatar — set blob URL directly
            const oSidebarAvatar = this.byId("userAvatar");
            if (oSidebarAvatar) {
                oSidebarAvatar.setSrc(sBlobUrl);
                oSidebarAvatar.setInitials("");
                oSidebarAvatar.setBackgroundColor("Transparent");
            }

            // 4. Popover <img> — patch via DOM id
            if (this._sPopoverAvatarDomId) {
                const el = document.getElementById(this._sPopoverAvatarDomId);
                if (el) {
                    el.style.background = "none";
                    el.style.overflow = "hidden";
                    el.innerHTML = `<img src="${sBlobUrl}" alt="Profile"
                        style="width:100%;height:100%;object-fit:cover;display:block;"/>`;
                }
            }
        },

        // ── Route matched ─────────────────────────────────────────────────────
        _onRouteMatched(oEvent) {
            const sRouteName = oEvent.getParameter("name");
            const oRouteToList = {
                dashboard: "mainNavList", timesheet: "mainNavList",
                "task-description": "mainNavList", "apply-leave": "mainNavList",
                history: "mainNavList", manager: "mainNavList",
                "task-assignment": "mainNavList", "task-status": "mainNavList",
                notifications: "mainNavList", "add-employee": "mainNavList",
                "all-employees": "mainNavList", "leave-approvals": "mainNavList"
            };
            ["mainNavList", "managerNavList", "accountNavList"].forEach(sId => {
                const oList = this.byId(sId);
                if (!oList) return;
                oList.getItems().forEach(oItem => {
                    const isActive = oItem.data("target") === sRouteName && oRouteToList[sRouteName] === sId;
                    oItem.toggleStyleClass("tsNavItemActive", isActive);
                    if (!oItem.getDomRef()) return;
                    if (isActive) {
                        oItem.getDomRef().style.background = "#3b82f6";
                        oItem.getDomRef().style.borderRadius = "8px";
                        const title = oItem.getDomRef().querySelector(".sapMSLITitle, .sapMLIBTitle");
                        if (title) title.style.color = "#ffffff";
                        const icon = oItem.getDomRef().querySelector(".sapUiIcon");
                        if (icon) icon.style.color = "#ffffff";
                    } else {
                        oItem.getDomRef().style.background = "transparent";
                        const title = oItem.getDomRef().querySelector(".sapMSLITitle, .sapMLIBTitle");
                        if (title) title.style.color = "#cbd5e1";
                        const icon = oItem.getDomRef().querySelector(".sapUiIcon");
                        if (icon) icon.style.color = "#94a3b8";
                    }
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
            const sPhoto    = this._oAppModel.getProperty("/profilePhotoSrc");

            // Unique DOM id so _applyProfilePhoto can patch the <img> if called later
            const sAvatarId = "__tsPopAvatar_" + Date.now();
            this._sPopoverAvatarDomId = sAvatarId;

            // Use existing blob URL if available (already CSP-safe), otherwise
            // convert the stored data URL → blob URL now.
            const sPhotoUrl = sPhoto
                ? (this._sPhotoBlobUrl || this._dataUrlToBlobUrl(sPhoto))
                : null;

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