sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], (Controller, JSONModel, MessageToast) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.App", {

        onInit() {
            // App-level model for the sidebar (unread badge etc.)
            this._oAppModel = new JSONModel({ unreadCount: 0 });
            this.getView().setModel(this._oAppModel, "appView");

            this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);
        },

        _onRouteMatched(oEvent) {
            const sRouteName = oEvent.getParameter("name");

            // Active highlight on sidebar items
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
                });
            });

            // Refresh unread notification count on every navigation
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
            this.byId("app").toggleStyleClass("tsMasterHidden");
        },

        onNavSelect(oEvent) {
            const sTarget = oEvent.getSource().data("target");
            if (sTarget) {
                this.getOwnerComponent().getRouter().navTo(sTarget);
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
