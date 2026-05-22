sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], (Controller, JSONModel, MessageToast) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.Notifications", {

        onInit() {
            this._oNotifViewModel = new JSONModel({
                notifications:    [],
                unreadCount:      0,
                hasNotifications: false,
                loading:          true
            });
            this.getView().setModel(this._oNotifViewModel, "notifView");

            this.getOwnerComponent().getRouter()
                .getRoute("notifications")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            const oComp = this.getOwnerComponent();
            const oReady = oComp.getCurrentUser
                ? oComp.getCurrentUser()
                : Promise.resolve(null);
            oReady.then(() => this._loadNotifications());
        },

        _loadNotifications() {
            this._oNotifViewModel.setProperty("/loading", true);

            const oComp      = this.getOwnerComponent();
            const sCurrentId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;
            const sRole      = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                            || (localStorage.getItem("tsRole") || "employee").toLowerCase();

            // ── Source 1: local notifications model (timesheet approve/reject) ──
            const oNotifModel = oComp.getModel("notifications");
            const localItems  = oNotifModel
                ? (oNotifModel.getProperty("/items") || []) : [];

            const localMine = localItems
                .filter(n => {
                    if (n.recipientEmployeeId) return n.recipientEmployeeId === sCurrentId;
                    return sRole !== "manager";
                })
                .map(n => ({
                    type:       n.type || "DEFAULT",
                    title:      n.title || n.weekRange || "Notification",
                    message:    n.message || "",
                    notifiedAt: n.timestamp || null,
                    isRead:     n.read || false,
                    _source:    "local"
                }));

            // ── Source 2: backend via manager OData (task/perf notifications) ──
            const oMgrModel = oComp.getModel("manager");
            const backendPromise = oMgrModel
                ? oMgrModel.getMetaModel()
                    .requestObject("/Notifications")
                    .then(() =>
                        oMgrModel.bindList("/Notifications", null, null, null, {
                            $$groupId: "$direct"
                        }).requestContexts(0, 100)
                    )
                    .then(aCtx => {
                        const all = aCtx.map(c => c.getObject()).filter(Boolean);
                        let mine  = all.filter(n =>
                            n.employee_employeeId === sCurrentId ||
                            n.employeeId          === sCurrentId ||
                            n.recipientId         === sCurrentId ||
                            n.employee_ID         === sCurrentId
                        );
                        if (mine.length === 0 && all.length > 0) mine = all;
                        return mine.map(n => ({
                            type:       n.type || "DEFAULT",
                            title:      n.title || "Notification",
                            message:    n.message || "",
                            notifiedAt: n.notifiedAt || n.createdAt || null,
                            isRead:     n.isRead || false,
                            _source:    "backend"
                        }));
                    })
                    .catch(() => [])
                : Promise.resolve([]);

            // ── Source 3: _callAction fallback (same as dashboard) ──────────────
            const actionPromise = this._callAction("getRecentNotifications", {})
                .then(oData => {
                    let items = [];
                    if (Array.isArray(oData))              items = oData;
                    else if (Array.isArray(oData?.value))  items = oData.value;
                    else if (oData?.itemsJSON) {
                        try { items = JSON.parse(oData.itemsJSON); } catch (e) { items = []; }
                    }
                    return items.map(n => ({
                        type:       n.type || "DEFAULT",
                        title:      n.title || "Notification",
                        message:    n.message || "",
                        notifiedAt: n.notifiedAt || null,
                        isRead:     n.isRead || false,
                        _source:    "action"
                    }));
                })
                .catch(() => []);

            // ── Merge all three sources ──────────────────────────────────────────
            Promise.all([backendPromise, actionPromise]).then(([backendItems, actionItems]) => {
                // Deduplicate: prefer backend > action > local, match by title+time
                const seen = new Set();
                const dedup = (arr) => arr.filter(n => {
                    const key = (n.title || "") + "|" + (n.notifiedAt || "");
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                // Priority: action items (freshest from backend action),
                // then OData backend items, then local model items
                const merged = dedup([...actionItems, ...backendItems, ...localMine]);

                // Sort newest first
                merged.sort((a, b) =>
                    new Date(b.notifiedAt || 0) - new Date(a.notifiedAt || 0)
                );

                const unread = merged.filter(n => !n.isRead).length;

                this._oNotifViewModel.setProperty("/notifications",    merged);
                this._oNotifViewModel.setProperty("/unreadCount",      unread);
                this._oNotifViewModel.setProperty("/hasNotifications", merged.length > 0);
                this._oNotifViewModel.setProperty("/loading",          false);
            });
        },

        // ── Reuse the same _callAction pattern as Dashboard ──────────────────
        _callAction(sActionName, mParams) {
            return new Promise((resolve, reject) => {
                fetch("/employee/" + sActionName, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept":       "application/json"
                    },
                    body: JSON.stringify(mParams || {}),
                    credentials: "include"
                })
                .then(async res => {
                    if (res.status === 204) { resolve({}); return; }
                    const text = await res.text();
                    if (!res.ok) { reject(new Error(text || res.statusText)); return; }
                    if (!text || text.trim() === "") { resolve({}); return; }
                    const data = JSON.parse(text);
                    const cleaned = Object.fromEntries(
                        Object.entries(data).filter(([k]) => !k.startsWith("@"))
                    );
                    resolve(cleaned.value !== undefined ? cleaned.value : cleaned);
                })
                .catch(reject);
            });
        },

        // ── Mark all read ────────────────────────────────────────────────────
        onMarkAllRead() {
            // Mark local model items
            const oNotifModel = this.getOwnerComponent().getModel("notifications");
            const items       = oNotifModel ? (oNotifModel.getProperty("/items") || []) : [];
            items.forEach(n => { n.read = true; });
            if (oNotifModel) {
                oNotifModel.setProperty("/items", items);
                this.getOwnerComponent().persistNotifications();
            }
            // Mark in view model too
            const viewItems = this._oNotifViewModel.getProperty("/notifications") || [];
            viewItems.forEach(n => { n.isRead = true; });
            this._oNotifViewModel.setProperty("/notifications", viewItems);
            this._oNotifViewModel.setProperty("/unreadCount",   0);

            MessageToast.show("All notifications marked as read.");
        },

        // ── Close → back to Dashboard ────────────────────────────────────────
        onCloseNotifications() {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        },

        // ── Formatters ────────────────────────────────────────────────────────
        formatTypeIcon(sType) {
            const map = {
                TIMESHEET_APPROVED: "sap-icon://accept",
                TIMESHEET_REJECTED: "sap-icon://decline",
                TASK_ASSIGNED:      "sap-icon://task",
                PERFORMANCE_RATED:  "sap-icon://survey",
                LEAVE_APPROVED:     "sap-icon://accept",
                LEAVE_REJECTED:     "sap-icon://decline",
                approved:           "sap-icon://accept",
                rejected:           "sap-icon://decline"
            };
            return map[sType] || "sap-icon://bell";
        },

        formatTypeColor(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED"].includes(sType)
                ? "#16a34a" : "#dc2626";
        },

        formatTypeLabel(sType) {
            const map = {
                TIMESHEET_APPROVED: "Approved",  TIMESHEET_REJECTED: "Rejected",
                TASK_ASSIGNED:      "Task",       PERFORMANCE_RATED:  "Rating",
                LEAVE_APPROVED:     "Leave OK",   LEAVE_REJECTED:     "Leave Rejected",
                approved:           "Approved",   rejected:           "Rejected"
            };
            return map[sType] || "Info";
        },

        formatTypeState(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED","TASK_ASSIGNED","PERFORMANCE_RATED"]
                .includes(sType) ? "Success" : "Error";
        },

        formatTimestamp(sTimestamp) {
            if (!sTimestamp) return "";
            const d = new Date(sTimestamp);
            return d.toLocaleDateString(undefined, {
                day: "numeric", month: "short", year: "numeric"
            }) + "  " +
            d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        },

        formatTypeAccentClass(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED"].includes(sType)
                ? "tsNotifAccentApproved" : "tsNotifAccentRejected";
        },

        formatTypeIconClass(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED"].includes(sType)
                ? "tsNotifIconApproved" : "tsNotifIconRejected";
        },

        // Time-ago formatter for the view
        formatTimeAgo(sTimestamp) {
            if (!sTimestamp) return "";
            const diff  = Date.now() - new Date(sTimestamp).getTime();
            const mins  = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days  = Math.floor(diff / 86400000);
            if (mins  < 1)  return "Just now";
            if (mins  < 60) return `${mins}m ago`;
            if (hours < 24) return `${hours}h ago`;
            return `${days}d ago`;
        }
    });
});