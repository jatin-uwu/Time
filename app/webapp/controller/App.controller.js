sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Avatar",
    "sap/ui/core/Icon"
], (Controller, JSONModel, MessageToast, Dialog, Button, VBox, HBox, Label, Text, Title, Avatar, Icon) => {
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
                userRole:       sInitRole === "manager" ? "manager" : "employee",
                userName:       "",
                userInitials:   "JD",
                userProfile:    null
            });
            this.getView().setModel(this._oAppModel, "appView");

            // Resolve the current user once and cache name/initials/profile
            // so the avatar and profile dialog show the real person.
            this._loadCurrentUser();

            // Try the backend, but don't override an explicit local-dev choice.
            const bExplicit = !!(sUrlRole || sSaveRole);
            fetch("/employee/getUserRole", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: "{}"
            })
                .then(r => r.ok ? r.json() : Promise.reject(r.status))
                .then(data => {
                    if (bExplicit) return;
                    const sRole = data && (data.role || (data.value && data.value.role));
                    if (sRole) this._oAppModel.setProperty("/userRole", sRole);
                })
                .catch(() => { });

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
                notifications:    "mainNavList"
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
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            if (!oNotifModel) return;
            const items = oNotifModel.getProperty("/items") || [];
            const sCurrentId = this.getOwnerComponent().getCurrentEmployeeId();
            const mine = items.filter(n => {
                if (n.recipientEmployeeId) return n.recipientEmployeeId === sCurrentId;
                return sCurrentId !== "EMP1005";
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
            if (sTarget) {
                this.getOwnerComponent().getRouter().navTo(sTarget);
            }
            const oApp = this.byId("app");
            if (oApp && oApp.isMasterShown()) {
                oApp.hideMaster();
            }
        },

        onLogout() {
            MessageToast.show("Logging out...");
        },

        // ── Profile (avatar press) ───────────────────────────────────────
        // Loads the logged-in user from EmployeeMaster and caches their
        // name/initials/profile in the appView model.
        _loadCurrentUser() {
            const oComp = this.getOwnerComponent();
            if (!oComp || !oComp.getEmployeeById || !oComp.getCurrentEmployeeId) return;
            const sId = oComp.getCurrentEmployeeId();
            oComp.getEmployeeById(sId).then(emp => {
                if (!emp) return;
                this._oAppModel.setProperty("/userName",     emp.employeeName || "");
                this._oAppModel.setProperty("/userInitials", buildInitials(emp.employeeName));
                this._oAppModel.setProperty("/userProfile",  {
                    employeeId:   emp.employeeId,
                    employeeName: emp.employeeName,
                    designation:  emp.designation || "—",
                    email:        emp.email       || "—",
                    address:      emp.address     || "—",
                    mobileNumber: emp.mobileNumber|| "—",
                    isActive:     emp.isActive
                });
            });
        },

        onProfilePress() {
            const oProfile = this._oAppModel.getProperty("/userProfile");
            if (oProfile) { this._openProfileDialog(oProfile); return; }

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
                this._openProfileDialog(oFresh);
            });
        },

        _openProfileDialog(oProfile) {
            if (this._oProfileDialog) {
                this._oProfileDialog.close();
                this._oProfileDialog.destroy();
                this._oProfileDialog = null;
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

            const oContent = new VBox({
                items: [
                    // Header strip
                    new HBox({
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
                    }).addStyleClass("tsProfileHeader"),

                    // Detail grid
                    new VBox({
                        items: [
                            fieldRow("Email",    oProfile.email,       "email"),
                            fieldRow("Mobile",   oProfile.mobileNumber,"call"),
                            fieldRow("Address",  oProfile.address,     "addresses"),
                            fieldRow("Status",   oProfile.isActive === false ? "Inactive" : "Active", "status-positive")
                        ]
                    }).addStyleClass("tsProfileBody sapUiSmallMarginTop")
                ]
            }).addStyleClass("tsProfileDialogWrap sapUiContentPadding");

            this._oProfileDialog = new Dialog({
                title: "My Profile",
                contentWidth: "420px",
                draggable: true,
                resizable: false,
                content: [oContent],
                endButton: new Button({
                    text: "Close",
                    type: "Emphasized",
                    press: () => this._oProfileDialog.close()
                }),
                afterClose: () => {
                    if (this._oProfileDialog) {
                        this._oProfileDialog.destroy();
                        this._oProfileDialog = null;
                    }
                }
            }).addStyleClass("tsProfileDialog");

            this.getView().addDependent(this._oProfileDialog);
            this._oProfileDialog.open();
        }
    });
});