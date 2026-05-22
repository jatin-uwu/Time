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
    // Handles CSRF token fetch (required by SAP BTP AppRouter) then POSTs
    // the action. Logs full server response to console on failure so you
    // can see exactly what CAP is returning.
    async function callAction(sAction, oParams) {
        const sUrl = `/employee/${sAction}`;

        // 1. Fetch CSRF token — SAP BTP AppRouter blocks POST without it
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

        // 2. POST the action with params as JSON body
        const oHeaders = { "Content-Type": "application/json", "Accept": "application/json" };
        if (sCsrfToken) oHeaders["X-CSRF-Token"] = sCsrfToken;

        console.log(`[callAction] POST ${sUrl}`, sCsrfToken ? "(with CSRF)" : "(no CSRF)");

        const oResp = await fetch(sUrl, {
            method: "POST",
            headers: oHeaders,
            body: JSON.stringify(oParams || {})
        });

        // 3. On failure — extract and log the full CAP error message
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
        // CAP wraps action return values in { value: <result> }
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
                    if (oHeader) { oHeader.style.color = "#ffffff"; oHeader.style.background = "transparent"; oHeader.style.fontWeight = "600"; oHeader.style.fontSize = "0.75rem"; oHeader.style.letterSpacing = "1px"; }
                    oList.getItems().forEach(oItem => {
                        if (!oItem.getDomRef()) return;
                        oItem.getDomRef().style.background = "transparent";
                        oItem.getDomRef().style.borderBottom = "none";
                        oItem.getDomRef().querySelectorAll("*").forEach(el => { el.style.color = "#94a3b8"; el.style.background = "transparent"; });
                        oItem.getDomRef().addEventListener("mouseenter", () => { oItem.getDomRef().style.background = "#334155"; oItem.getDomRef().style.borderRadius = "8px"; });
                        oItem.getDomRef().addEventListener("mouseleave", () => { if (!oItem.hasStyleClass("tsNavItemActive")) { oItem.getDomRef().style.background = "transparent"; oItem.getDomRef().style.borderRadius = "0"; } });
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
                        oItem.getDomRef().querySelectorAll("*").forEach(el => { el.style.color = "#94a3b8"; el.style.background = "transparent"; });
                        oItem.getDomRef().addEventListener("mouseenter", () => { oItem.getDomRef().style.background = "#334155"; oItem.getDomRef().style.borderRadius = "8px"; });
                        oItem.getDomRef().addEventListener("mouseleave", () => { if (!oItem.hasStyleClass("tsNavItemActive")) { oItem.getDomRef().style.background = "transparent"; oItem.getDomRef().style.borderRadius = "0"; } });
                    });
                }, 600);

                const oFooter = oPage.getDomRef().querySelector(".sapMPageFooter, .sapMTB");
                if (oFooter) {
                    oFooter.style.background = "#1e293b";
                    oFooter.style.borderTop = "1px solid #334155";
                    oFooter.querySelectorAll("*").forEach(el => { el.style.background = "transparent"; el.style.border = "none"; el.style.color = "#94a3b8"; el.style.boxShadow = "none"; });
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

            oInput.onchange = (oEvt) => {
                const oFile = oEvt.target.files && oEvt.target.files[0];
                if (!oFile) return;

                if (oFile.size > 2 * 1024 * 1024) {
                    MessageToast.show("Image too large. Please choose a file under 2 MB.");
                    return;
                }

                const oReader = new FileReader();
                oReader.onload = async (eRead) => {
                    const sDataUrl = eRead.target.result;

                    // Optimistically update UI before server responds
                    this._applyProfilePhoto(sDataUrl);

                    try {
                        const oResult = await callAction("uploadProfilePhoto", { dataBase64: sDataUrl });
                        console.log("[ProfilePhoto] Save result:", oResult);
                        MessageToast.show("Profile picture saved!");
                    } catch (e) {
                        // Error details already logged by callAction
                        MessageToast.show("Could not save photo — see F12 Console for details.");
                    }
                };
                oReader.readAsDataURL(oFile);
            };

            oInput.click();
        },

        // ── Load photo from DB on every login/refresh ─────────────────────────
        async _loadProfilePhoto() {
            try {
                const oResult = await callAction("getProfilePhoto", {});
                console.log("[ProfilePhoto] Loaded from DB:", oResult ? "yes, " + (oResult.mimeType || "") : "none");
                if (oResult && oResult.dataBase64) {
                    this._applyProfilePhoto(oResult.dataBase64);
                }
            } catch (e) {
                // Non-fatal — avatar shows initials if no photo saved yet
                console.warn("[ProfilePhoto] Load failed:", e.message || e);
            }
        },

        // ── Write photo to model + refresh open popover ───────────────────────
        _applyProfilePhoto(sDataUrl) {
            if (!sDataUrl) return;
            this._oAppModel.setProperty("/profilePhotoSrc", sDataUrl);

            if (this._oProfilePopover) {
                try {
                    const oPopoverAvatar = this._oProfilePopover
                        .getContent()[0].getItems()[0].getItems()[0];
                    if (oPopoverAvatar && oPopoverAvatar.setSrc) {
                        oPopoverAvatar.setSrc(sDataUrl);
                        oPopoverAvatar.setInitials("");
                    }
                } catch (e) { /* popover structure changed — ignore */ }
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
                onClose: (sAction) => { if (sAction !== MessageBox.Action.OK) return; this._performLogout(); }
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

            const sInitials = this._oAppModel.getProperty("/userInitials");
            const sPhoto    = this._oAppModel.getProperty("/profilePhotoSrc");

            const fieldRow = (sLabel, sValue, sIcon) => new HBox({
                alignItems: "Center",
                items: [
                    new Icon({ src: "sap-icon://" + sIcon, size: "1rem", color: "#3b82f6" }).addStyleClass("sapUiTinyMarginEnd"),
                    new VBox({ items: [new Label({ text: sLabel }).addStyleClass("tsProfileFieldLabel"), new Text({ text: sValue || "—" }).addStyleClass("tsProfileFieldValue")] })
                ]
            }).addStyleClass("tsProfileRow sapUiSmallMarginBottom");

            const oPopoverAvatar = new Avatar({
                src: sPhoto || "",
                initials: sPhoto ? "" : sInitials,
                displaySize: "L",
                backgroundColor: sPhoto ? "Transparent" : "Accent6"
            });

            const oHeader = new HBox({
                alignItems: "Center",
                items: [
                    oPopoverAvatar,
                    new VBox({
                        items: [
                            new Title({ text: oProfile.employeeName, level: "H4" }).addStyleClass("tsProfileName"),
                            new Text({ text: oProfile.designation }).addStyleClass("tsProfileDesignation"),
                            new Text({ text: "ID: " + (oProfile.employeeId || "") }).addStyleClass("tsProfileEmpId")
                        ]
                    }).addStyleClass("sapUiSmallMarginBegin")
                ]
            }).addStyleClass("tsProfileHeader");

            const oBody = new VBox({
                items: [
                    fieldRow("Email",   oProfile.email,        "email"),
                    fieldRow("Mobile",  oProfile.mobileNumber, "call"),
                    fieldRow("Address", oProfile.address,      "addresses"),
                    fieldRow("Status",  oProfile.isActive === false ? "Inactive" : "Active", "status-positive")
                ]
            }).addStyleClass("tsProfileBody sapUiSmallMarginTop");

            const oLogoutButton = new Button({
                text: "Log Out", icon: "sap-icon://log", type: "Reject",
                press: () => { this._oProfilePopover.close(); this.onLogout(); }
            }).addStyleClass("tsProfileLogoutButton sapUiMediumMarginTop");

            this._oProfilePopover = new ResponsivePopover({
                title: "My Profile", placement: "Bottom", contentWidth: "360px",
                modal: false, showHeader: true, showCloseButton: true,
                content: [new VBox({ items: [oHeader, oBody, oLogoutButton] }).addStyleClass("tsProfileDialogWrap sapUiContentPadding")],
                afterClose: () => { if (this._oProfilePopover) { this._oProfilePopover.destroy(); this._oProfilePopover = null; } }
            }).addStyleClass("tsProfileDialog");

            this.getView().addDependent(this._oProfilePopover);
            this._oProfilePopover.openBy(oSource);
        }
    });
});