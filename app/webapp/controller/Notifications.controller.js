sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], (Controller, JSONModel, MessageToast) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.Notifications", {

        onInit() {
            this._oNotifViewModel = new JSONModel({
                notifications:   [],
                unreadCount:     0,
                hasNotifications: false
            });
            this.getView().setModel(this._oNotifViewModel, "notifView");

            this.getOwnerComponent().getRouter()
                .getRoute("notifications")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            // Wait for the JWT-resolved user before filtering so we don't
            // briefly show the wrong person's notifications.
            const oComp = this.getOwnerComponent();
            const oReady = (oComp.getCurrentUser ? oComp.getCurrentUser() : Promise.resolve(null));
            oReady.then(() => this._loadNotifications());
        },

        _loadNotifications() {
            const oComp       = this.getOwnerComponent();
            const oNotifModel = oComp.getModel("notifications");
            const items       = oNotifModel.getProperty("/items") || [];

            const sCurrentId  = oComp.getCurrentEmployeeId();
            const sCurrentRole = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                              || (localStorage.getItem("tsRole") || "employee").toLowerCase();

            // Show only notifications addressed to the current user.
            // Untargeted legacy notifications are only visible to employees.
            const mine = items.filter(n => {
                if (n.recipientEmployeeId) return n.recipientEmployeeId === sCurrentId;
                return sCurrentRole !== "manager";
            });

            // Sort newest first
            const sorted = [...mine].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const unread  = sorted.filter(n => !n.read).length;

            this._oNotifViewModel.setProperty("/notifications",    sorted);
            this._oNotifViewModel.setProperty("/unreadCount",      unread);
            this._oNotifViewModel.setProperty("/hasNotifications", sorted.length > 0);
        },

        // ── Tap a notification → go to Dashboard for that week ───────────────
        // onNotifPress(oEvent) {
        //     const oCtx = oEvent.getParameter("listItem").getBindingContext("notifView");
        //     if (!oCtx) return;
        //     const notif = oCtx.getObject();

        //     // Mark this notification as read
        //     const oNotifModel = this.getOwnerComponent().getModel("notifications");
        //     const items = oNotifModel.getProperty("/items") || [];
        //     const idx = items.findIndex(n => n.weekStart === notif.weekStart && n.timestamp === notif.timestamp);
        //     if (idx >= 0) {
        //         items[idx].read = true;
        //         oNotifModel.setProperty("/items", items);
        //         this.getOwnerComponent().persistNotifications();
        //     }

        //     // Tell Timesheet controller which week to open
        //     this.getOwnerComponent()._pendingWeekStart = notif.weekStart;

        //     this.getOwnerComponent().getRouter().navTo("timesheet");
        // },

        // ── Mark all read ────────────────────────────────────────────────────
        onMarkAllRead() {
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            const items       = oNotifModel.getProperty("/items") || [];
            items.forEach(n => { n.read = true; });
            oNotifModel.setProperty("/items", items);
            this.getOwnerComponent().persistNotifications();
            this._loadNotifications();
            MessageToast.show("All notifications marked as read.");
        },

        // ── Formatters ────────────────────────────────────────────────────────
        formatTypeIcon(sType) {
            return sType === "approved" ? "sap-icon://accept" : "sap-icon://decline";
        },

        formatTypeColor(sType) {
            return sType === "approved" ? "#16a34a" : "#dc2626";
        },

        formatTypeLabel(sType) {
            return sType === "approved" ? "Approved" : "Rejected";
        },

        formatTypeState(sType) {
            return sType === "approved" ? "Success" : "Error";
        },

        formatTimestamp(sTimestamp) {
            if (!sTimestamp) return "";
            const d = new Date(sTimestamp);
            return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
                   "  " +
                   d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        },

        // CSS class helpers used by the new layout
        formatTypeAccentClass(sType) {
            return sType === "approved" ? "tsNotifAccentApproved" : "tsNotifAccentRejected";
        },

        formatTypeIconClass(sType) {
            return sType === "approved" ? "tsNotifIconApproved" : "tsNotifIconRejected";
        }
    });
});
