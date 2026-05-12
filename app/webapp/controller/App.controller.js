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
        const last  = parts.length > 1 && parts[parts.length - 1][0]
            ? parts[parts.length - 1][0].toUpperCase() : "";
        return (first + last) || (first || "JD");
    }

    return Controller.extend("timesheet.app.controller.App", {

        onInit() {
            // ── Local-dev role override ──────────────────────────────────────
            // Allow ?role=manager / ?role=employee in the URL, or a saved
            // value in localStorage (set via the avatar menu) to bypass auth
            // when running with mocked users.
            const sUrlRole  = new URLSearchParams(window.location.search).get("role");
            const sSaveRole = (() => { try { return localStorage.getItem("tsRole") || ""; } catch (e) { return ""; } })();
            const sInitRole = (sUrlRole || sSaveRole || "employee").toLowerCase();
            if (sUrlRole) { try { localStorage.setItem("tsRole", sUrlRole); } catch (e) {} }

            this._oAppModel = new JSONModel({
                unreadCount:    0,
                userRole:      ["manager", "employee", "hr"].includes(sInitRole) ? sInitRole : "employee",
                userName:       "",
                userInitials:   "JD",
                userProfile:    null
            });
            this.getView().setModel(this._oAppModel, "appView");

            // Resolve the current user once and cache name/initials/profile
            // so the avatar and profile dialog show the real person.
            this._loadCurrentUser();

            // Pull the JWT-resolved role from getCurrentUser so the sidebar
            // gates correctly for every individual user. Local-dev URL/saved
            // overrides win — useful when developing without auth.
            const bExplicit = !!(sUrlRole || sSaveRole && false); // saved-role no longer overrides
            const oComp = this.getOwnerComponent();
            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (bExplicit) return;
                     const sRole = u && (u.role || (u.value && u.value.role));
                     if (sRole) this._oAppModel.setProperty("/userRole", sRole.toLowerCase());
                })
            }

            this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);

            setTimeout(() => {
                const oPage = this.byId("navPage");
                if (!oPage || !oPage.getDomRef()) return;

                // Sidebar background
                oPage.getDomRef().style.backgroundColor = "#1e293b";
                oPage.getDomRef().style.borderRadius = "0";
                oPage.getDomRef().style.borderTopLeftRadius = "0";
                oPage.getDomRef().style.borderTopRightRadius = "0";

                oPage.getDomRef().querySelectorAll(".sapMPageBg, .sapMPage, .sapMList, .sapMListUl")
                    .forEach(el => {
                        el.style.borderRadius = "0";
                        el.style.background = "transparent";
                    });

                // Remove default SAP Navigation master button
                const oApp = this.byId("app");
                if (oApp) {
                    oApp.setMasterButtonText("");
                    oApp.setMasterButtonTooltip("");
                    const oMasterBtn = oApp.getMasterButton?.();
                    if (oMasterBtn) oMasterBtn.setVisible(false);
                }

                // Hide Navigation button via DOM
                setTimeout(() => {
                    document.querySelectorAll(
                        ".sapMSplitAppMasterBtn, .sapMSplitContainerMasterBtn, .sapMSplitAppMasterBtn button, [id*='MasterBtn']"
                    ).forEach(el => {
                        el.style.display = "none";
                        el.style.visibility = "hidden";
                        el.style.width = "0";
                        el.style.overflow = "hidden";
                    });

                    document.querySelectorAll(".sapMBarLeft .sapMBtn").forEach(el => {
                        if (el.textContent.includes("Navigation") || el.title === "Navigation") {
                            el.style.display = "none";
                        }
                    });
                }, 500);

                // Style mainNavList
                ["mainNavList"].forEach(sId => {
                    const oList = this.byId(sId);
                    if (!oList || !oList.getDomRef()) return;

                    oList.getDomRef().style.background = "transparent";
                    oList.getDomRef().style.borderRadius = "0";

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
                        oItem.getDomRef().style.borderRadius = "0";

                        oItem.getDomRef().querySelectorAll("*").forEach(el => {
                            el.style.color = "#94a3b8";
                            el.style.background = "transparent";
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

                // Style managerNavList separately with delay to allow binding to resolve
                setTimeout(() => {
                    const oManagerList = this.byId("managerNavList");
                    if (!oManagerList || !oManagerList.getDomRef()) return;

                    oManagerList.getDomRef().style.background = "transparent";
                    oManagerList.getDomRef().style.borderRadius = "0";

                    const oHeader = oManagerList.getDomRef().querySelector(".sapMListHdr, .sapMListHdrText");
                    if (oHeader) {
                        oHeader.style.color = "#ffffff";
                        oHeader.style.background = "transparent";
                        oHeader.style.fontWeight = "600";
                        oHeader.style.fontSize = "0.75rem";
                        oHeader.style.letterSpacing = "1px";
                    }

                    oManagerList.getItems().forEach(oItem => {
                        if (!oItem.getDomRef()) return;
                        oItem.getDomRef().style.background = "transparent";
                        oItem.getDomRef().style.borderBottom = "none";
                        oItem.getDomRef().style.borderRadius = "0";

                        oItem.getDomRef().querySelectorAll("*").forEach(el => {
                            el.style.color = "#94a3b8";
                            el.style.background = "transparent";
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

                // Footer background + button style
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

            // Show/hide menu button and sidebar based on screen size
            const _handleResize = () => {
                const oMenuBtn = this.byId("menuToggleBtn");
                const oApp = this.byId("app");
                const isMobile = window.innerWidth <= 550;

                if (oMenuBtn) {
                    oMenuBtn.setVisible(isMobile);
                }
                if (oApp) {
                    if (isMobile) {
                        oApp.hideMaster();
                    } else {
                        oApp.showMaster();
                    }
                }
            };

            _handleResize();
            window.addEventListener("resize", _handleResize);
        },

        _onRouteMatched(oEvent) {
            const sRouteName = oEvent.getParameter("name");

            const oRouteToList = {
                dashboard:        "mainNavList",
                timesheet:        "mainNavList",
                "task-description": "mainNavList",
                history:          "mainNavList",
                manager:          "mainNavList",
                "task-assignment": "mainNavList",
                "task-status":    "mainNavList",
                notifications:    "mainNavList",
                "add-employee":     "mainNavList",
                "all-employees":    "mainNavList" 
            };

            ["mainNavList", "managerNavList", "accountNavList"].forEach(sId => {
                const oList = this.byId(sId);
                if (!oList) return;
                oList.getItems().forEach(oItem => {
                    const isActive = oItem.data("target") === sRouteName &&
                                     oRouteToList[sRouteName] === sId;
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

            // Re-hide navigation button after every route change
            setTimeout(() => {
                document.querySelectorAll(
                    ".sapMSplitAppMasterBtn, .sapMSplitContainerMasterBtn, [id*='MasterBtn']"
                ).forEach(el => {
                    el.style.display = "none";
                    el.style.visibility = "hidden";
                });
            }, 200);

            this._refreshUnreadCount();
        },

        _refreshUnreadCount() {
            const oComp = this.getOwnerComponent();
            const oNotifModel = oComp.getModel("notifications");
            if (!oNotifModel) return;
            const items = oNotifModel.getProperty("/items") || [];
            const sCurrentId = oComp.getCurrentEmployeeId();
            const sRole      = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                            || this._oAppModel.getProperty("/userRole")
                            || "employee";
            const mine = items.filter(n => {
                if (n.recipientEmployeeId) return n.recipientEmployeeId === sCurrentId;
                return sRole !== "manager";
            });
            this._oAppModel.setProperty("/unreadCount", mine.filter(n => !n.read).length);
        },

        onMenuToggle() {
            const oApp = this.byId("app");
            if (oApp.isMasterShown()) {
                oApp.hideMaster();
            } else {
                oApp.showMaster();
            }
        },

        onNavSelect(oEvent) {
            const sTarget = oEvent.getSource().data("target");
            console.log("Navigating to :", sTarget)
            if (sTarget) {
                this.getOwnerComponent().getRouter().navTo(sTarget);
            }
            const oApp = this.byId("app");
            if (oApp && oApp.isMasterShown()) {
                oApp.hideMaster();
            }
        },

        onLogout() {
            MessageBox.confirm("Sign out of Timesheet?", {
                title:   "Logout",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: (sAction) => {
                    if (sAction !== MessageBox.Action.OK) return;
                    this._performLogout();
                }
            });
        },

        _performLogout() {
            // 1) Wipe every client-side trace of the session.
            //    UI5 in-memory models, app-scoped JSONModels, OData caches.
            try {
                const oComp = this.getOwnerComponent();
                ["history","locked","notifications","tasks","taskUpdates"].forEach(name => {
                    const m = oComp.getModel(name);
                    if (m && m.setData) m.setData({});
                });
                // Drop the cached JWT-resolved user so a re-login is mandatory.
                oComp._oCurrentUser  = null;
                oComp._pCurrentUser  = null;
                oComp._employeeCache = {};
            } catch (e) { /* non-blocking */ }

            // 2) Clear every persisted preference. We deliberately wipe
            //    sessionStorage too so cached UI5 preload chunks rebuild
            //    cleanly for the next user (otherwise a different person
            //    on a shared machine inherits the previous theme/density).
            try { localStorage.clear();   } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}

            // 3) Hand off to the approuter. /logout is what we configured
            //    in xs-app.json.logoutEndpoint — the approuter:
            //      a. invalidates its own session cookie
            //      b. calls XSUAA's /oauth/logout to revoke the refresh token
            //      c. redirects to xs-app.json.logoutPage (/index.html)
            //    Because /index.html itself is behind xsuaa auth, the
            //    browser will be bounced through IAS again on the way back,
            //    so the back-button trick can't reach protected data.
            //
            //    location.replace (not .href) wipes the current entry from
            //    browser history → back button can't return to the dashboard.
            window.location.replace("/logout");
        },

        // ── Profile (avatar press) ───────────────────────────────────────
        // Resolves the logged-in JWT user against EmployeeMaster (server-side)
        // and caches their name/initials/profile in the appView model.
        // Falls back to the role-based directory lookup if the backend
        // call fails (e.g. local-dev with no auth).
        _loadCurrentUser() {
            const oComp = this.getOwnerComponent();
            if (!oComp) return;

            const useEmp = (emp) => {
                if (!emp) return;
                this._oAppModel.setProperty("/userName",     emp.employeeName || "");
                this._oAppModel.setProperty("/userInitials", buildInitials(emp.employeeName));
                this._oAppModel.setProperty("/userProfile",  {
                    employeeId:   emp.employeeId,
                    employeeName: emp.employeeName,
                    designation:  emp.designation  || "—",
                    email:        emp.email        || "—",
                    address:      emp.address      || "—",
                    mobileNumber: emp.mobileNumber || "—",
                    isActive:     emp.isActive !== false
                });
            };

            // 1) Backend-resolved (real logged-in user).
            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (u && (u.employeeId || u.employeeName)) {
                        useEmp(u);
                        return;
                    }
                    // 2) Fallback: role-based directory lookup.
                    if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
                        oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(useEmp);
                    }
                });
                return;
            }

            // No getCurrentUser at all — pure local-dev path.
            if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
                oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(useEmp);
            }
        },

        onProfilePress(oEvent) {
            const oSource = oEvent && oEvent.getSource && oEvent.getSource();
            const oProfile = this._oAppModel.getProperty("/userProfile");

            if (oProfile) { this._openProfilePopover(oProfile, oSource); return; }

            // Profile wasn't cached yet — fetch it on demand and then open.
            const oComp = this.getOwnerComponent();
            if (!oComp || !oComp.getEmployeeById || !oComp.getCurrentEmployeeId) {
                MessageToast.show("Profile unavailable.");
                return;
            }
            const sId = oComp.getCurrentEmployeeId();
            oComp.getEmployeeById(sId).then(emp => {
                if (!emp) { MessageToast.show("Profile unavailable."); return; }
                this._oAppModel.setProperty("/userName",     emp.employeeName || "");
                this._oAppModel.setProperty("/userInitials", buildInitials(emp.employeeName));
                const oFresh = {
                    employeeId:   emp.employeeId,
                    employeeName: emp.employeeName,
                    designation:  emp.designation || "—",
                    email:        emp.email       || "—",
                    address:      emp.address     || "—",
                    mobileNumber: emp.mobileNumber|| "—",
                    isActive:     emp.isActive
                };
                this._oAppModel.setProperty("/userProfile", oFresh);
                this._openProfilePopover(oFresh, oSource);
            });
        },

        _openProfilePopover(oProfile, oSource) {
            // Always rebuild so the data is current.
            if (this._oProfilePopover) {
                this._oProfilePopover.close();
                this._oProfilePopover.destroy();
                this._oProfilePopover = null;
            }

            const sInitials = this._oAppModel.getProperty("/userInitials");

            const fieldRow = (sLabel, sValue, sIcon) => new HBox({
                alignItems: "Center",
                items: [
                    new Icon({ src: "sap-icon://" + sIcon, size: "1rem", color: "#3b82f6" })
                        .addStyleClass("sapUiTinyMarginEnd"),
                    new VBox({
                        items: [
                            new Label({ text: sLabel })
                                .addStyleClass("tsProfileFieldLabel"),
                            new Text({ text: sValue || "—" })
                                .addStyleClass("tsProfileFieldValue")
                        ]
                    })
                ]
            }).addStyleClass("tsProfileRow sapUiSmallMarginBottom");

            const oHeader = new HBox({
                alignItems: "Center",
                items: [
                    new Avatar({
                        initials:    sInitials,
                        displaySize: "L",
                        backgroundColor: "Accent6"
                    }),
                    new VBox({
                        items: [
                            new Title({ text: oProfile.employeeName, level: "H4" })
                                .addStyleClass("tsProfileName"),
                            new Text({ text: oProfile.designation })
                                .addStyleClass("tsProfileDesignation"),
                            new Text({ text: "ID: " + (oProfile.employeeId || "") })
                                .addStyleClass("tsProfileEmpId")
                        ]
                    }).addStyleClass("sapUiSmallMarginBegin")
                ]
            }).addStyleClass("tsProfileHeader");

            const oBody = new VBox({
                items: [
                    fieldRow("Email",    oProfile.email,       "email"),
                    fieldRow("Mobile",   oProfile.mobileNumber,"call"),
                    fieldRow("Address",  oProfile.address,     "addresses"),
                    fieldRow("Status",   oProfile.isActive === false ? "Inactive" : "Active", "status-positive")
                ]
            }).addStyleClass("tsProfileBody sapUiSmallMarginTop");

            const oLogoutButton = new Button({
                text: "Log Out",
                icon: "sap-icon://log",
                type: "Reject",
                press: () => {
                    this._oProfilePopover.close();
                    this.onLogout();
                }
            }).addStyleClass("tsProfileLogoutButton sapUiMediumMarginTop");

            this._oProfilePopover = new ResponsivePopover({
                title:       "My Profile",
                placement:   "Bottom",         // sits directly below the avatar
                contentWidth:  "360px",
                modal:       false,            // dashboard stays interactive behind it
                showHeader:  true,
                showCloseButton: true,
                content: [
                    new VBox({ items: [oHeader, oBody, oLogoutButton] })
                        .addStyleClass("tsProfileDialogWrap sapUiContentPadding")
                ],
                afterClose: () => {
                    if (this._oProfilePopover) {
                        this._oProfilePopover.destroy();
                        this._oProfilePopover = null;
                    }
                }
            }).addStyleClass("tsProfileDialog");

            this.getView().addDependent(this._oProfilePopover);
            // openBy anchors the popover to the avatar — UI5 paints it
            // there directly, no centre-flicker.
            this._oProfilePopover.openBy(oSource);
        }
    });
});