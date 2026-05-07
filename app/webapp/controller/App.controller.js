sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], (Controller, JSONModel, MessageToast) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.App", {

        onInit() {
            this._oAppModel = new JSONModel({
                unreadCount: 0,
                userRole: "employee"
            });
            this.getView().setModel(this._oAppModel, "appView");

            fetch("/employee/getUserRole", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: "{}"
            })
                .then(r => r.ok ? r.json() : Promise.reject(r.status))
                .then(data => {
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
                dashboard:     "mainNavList",
                timesheet:     "mainNavList",
                history:       "mainNavList",
                manager:       "managerNavList",
                notifications: "accountNavList"
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
            const items  = oNotifModel.getProperty("/items") || [];
            const unread = items.filter(n => !n.read).length;
            this._oAppModel.setProperty("/unreadCount", unread);
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

        onProfilePress() {
            MessageToast.show("Profile");
        }
    });
});