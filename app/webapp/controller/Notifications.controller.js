// ─────────────────────────────────────────────────────────────────────────────
// FILE: webapp/controller/Notifications.controller.js
// ─────────────────────────────────────────────────────────────────────────────
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    const PAGE_SIZE = 20;

    // ── Notification type config ──────────────────────────────────────────────
    const TYPE_CONFIG = {
        TIMESHEET_APPROVED:         { color: "#16a34a", bg: "#f0fdf4", label: "Timesheet Approved",  icon: "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",          group: "TIMESHEET" },
        TIMESHEET_REJECTED:         { color: "#dc2626", bg: "#fef2f2", label: "Timesheet Rejected",  icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", group: "TIMESHEET" },
        PREVWEEK_APPROVED:          { color: "#16a34a", bg: "#f0fdf4", label: "Prev Week Approved",  icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",               group: "PREVWEEK"  },
        PREVWEEK_REJECTED:          { color: "#dc2626", bg: "#fef2f2", label: "Prev Week Rejected",  icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", group: "PREVWEEK" },
        DAY_UNLOCK_APPROVED:        { color: "#3b82f6", bg: "#eff6ff", label: "Day Unlocked",        icon: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z", group: "DAY_UNLOCK" },
        DAY_UNLOCK_REJECTED:        { color: "#dc2626", bg: "#fef2f2", label: "Unlock Rejected",     icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM10 9a2 2 0 114 0v1", group: "DAY_UNLOCK" },
        TASK_ASSIGNED:              { color: "#f59e0b", bg: "#fffbeb", label: "Task Assigned",       icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4", group: "TASK" },
        PERFORMANCE_RATED:          { color: "#8b5cf6", bg: "#f5f3ff", label: "Performance Rated",  icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z", group: "PERFORMANCE" },
        LEAVE_APPROVED:             { color: "#10b981", bg: "#ecfdf5", label: "Leave Approved",     icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", group: "LEAVE" },
        LEAVE_REJECTED:             { color: "#dc2626", bg: "#fef2f2", label: "Leave Rejected",     icon: "M6 18L18 6M6 6l12 12",                                         group: "LEAVE"     },
        TIMESHEET_CONSECUTIVE_MISS: { color: "#f97316", bg: "#fff7ed", label: "Reminder",           icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", group: "TIMESHEET" },
        approved:                   { color: "#16a34a", bg: "#f0fdf4", label: "Approved",           icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",               group: "TIMESHEET" },
        rejected:                   { color: "#dc2626", bg: "#fef2f2", label: "Rejected",           icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", group: "TIMESHEET" },
        DEFAULT:                    { color: "#6b7280", bg: "#f9fafb", label: "Info",               icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",  group: "OTHER"     }
    };

    function getTypeConfig(type) {
        return TYPE_CONFIG[type] || TYPE_CONFIG.DEFAULT;
    }

    function timeAgo(isoStr) {
        if (!isoStr) return "";
        const diff  = Date.now() - new Date(isoStr).getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins  < 1)   return "Just now";
        if (mins  < 60)  return mins  + "m ago";
        if (hours < 24)  return hours + "h ago";
        if (days  === 1) return "Yesterday";
        return days + "d ago";
    }

    function getDateGroup(isoStr) {
        if (!isoStr) return "Earlier";
        const diff = Date.now() - new Date(isoStr).getTime();
        const days = Math.floor(diff / 86400000);
        if (days === 0) return "Today";
        if (days === 1) return "Yesterday";
        if (days <= 7)  return "This Week";
        return "Earlier";
    }

    function matchesTypeFilter(n, sTypeKey) {
        if (sTypeKey === "all") return true;
        const cfg = getTypeConfig(n.type);
        return cfg.group === sTypeKey;
    }

    return Controller.extend("timesheet.app.controller.Notifications", {

        onInit: function () {
            this._oNotifViewModel = new JSONModel({
                notifications:    [],
                displayed:        [],
                unreadCount:      0,
                totalCount:       0,
                hasNotifications: false,
                hasMore:          false,
                loading:          true,
                loadingMore:      false,
                notifListHTML:    "",
                readFilter:       "all",
                typeFilter:       "all"
            });
            this.getView().setModel(this._oNotifViewModel, "notifView");

            // Expose controller globally for inline HTML onclick handlers
            window._notifController = this;

            this._currentPage = 1;

            this.getOwnerComponent().getRouter()
                .getRoute("notifications")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._currentPage = 1;
            this._oNotifViewModel.setProperty("/readFilter", "all");
            this._oNotifViewModel.setProperty("/typeFilter", "all");

            var oReadSeg = this.byId("readFilter");
            var oTypeSel = this.byId("typeFilter");
            if (oReadSeg) oReadSeg.setSelectedKey("all");
            if (oTypeSel) oTypeSel.setSelectedKey("all");

            // Reset list so stale data doesn't flash
            this._oNotifViewModel.setProperty("/notifications",    []);
            this._oNotifViewModel.setProperty("/hasNotifications", false);
            this._oNotifViewModel.setProperty("/notifListHTML",    "");

            this._loadNotifications(false);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // LOAD
        // ═══════════════════════════════════════════════════════════════════════

        _loadNotifications: function (bAppend) {
            if (!bAppend) {
                this._oNotifViewModel.setProperty("/loading", true);
            } else {
                this._oNotifViewModel.setProperty("/loadingMore", true);
            }

            this._callAction("getNotifications", {
                page:     this._currentPage,
                pageSize: PAGE_SIZE
            })
            .then(function (res) {
                var items = [];
                try { items = JSON.parse(res.itemsJSON || "[]"); } catch (e) { items = []; }

                var totalCount  = res.totalCount  || 0;
                var unreadCount = res.unreadCount  || 0;

                if (bAppend) {
                    var existing = this._oNotifViewModel.getProperty("/notifications") || [];
                    items = existing.concat(items);
                }

                var hasMore = items.length < totalCount;

                this._oNotifViewModel.setProperty("/notifications", items);
                this._oNotifViewModel.setProperty("/totalCount",    totalCount);
                this._oNotifViewModel.setProperty("/unreadCount",   unreadCount);
                this._oNotifViewModel.setProperty("/hasMore",       hasMore);

                this._applyFiltersAndRender();
            }.bind(this))
            .catch(function (err) {
                console.error("getNotifications failed, falling back to local:", err);
                this._loadFromLocal();
            }.bind(this))
            .finally(function () {
                this._oNotifViewModel.setProperty("/loading",     false);
                this._oNotifViewModel.setProperty("/loadingMore", false);
            }.bind(this));
        },

        // ── Fallback: read from localStorage-backed notifications model ────────
        // FIX: removed calls to getCurrentEmployeeId() and persistNotifications()
        // which don't exist on the component. We read currentUser from the model
        // that getCurrentUser action already populates on the component.
        _loadFromLocal: function () {
            var oComp = this.getOwnerComponent();

            // Try to get employeeId from the userInfo model the app sets on login
            var sCurrentId = null;
            var oUserModel = oComp.getModel("userInfo") || oComp.getModel("currentUser");
            if (oUserModel) {
                sCurrentId = oUserModel.getProperty("/employeeId") || null;
            }

            var oNotifModel = oComp.getModel("notifications");
            var localItems  = oNotifModel
                ? (oNotifModel.getProperty("/items") || []) : [];

            var mine = localItems
                .filter(function (n) {
                    // If we know the employee ID, filter by it
                    if (sCurrentId && n.recipientEmployeeId) {
                        return n.recipientEmployeeId === sCurrentId;
                    }
                    // Otherwise show everything in the local model
                    return true;
                })
                .map(function (n) {
                    return {
                        notificationId: n.notificationId || null,
                        type:      n.type    || "DEFAULT",
                        title:     n.title   || n.weekRange || "Notification",
                        message:   n.message || "",
                        notifiedAt: n.timestamp || null,
                        isRead:    !!(n.read || n.isRead),
                        _source:   "local"
                    };
                })
                .sort(function (a, b) {
                    return new Date(b.notifiedAt || 0) - new Date(a.notifiedAt || 0);
                });

                // Priority: action items (freshest from backend action),
                // then OData backend items, then local model items
                const merged = dedup([...actionItems, ...backendItems, ...localMine]);

                // Sort newest first
                merged.sort((a, b) =>
                    new Date(b.notifiedAt || 0) - new Date(a.notifiedAt || 0)
                );

                // Apply persisted read state — overrides backend isRead:false after mark-all-read
                const readKeys = new Set(JSON.parse(localStorage.getItem("tsNotifReadKeys") || "[]"));
                merged.forEach(n => {
                    if (readKeys.has((n.title || "") + "|" + (n.notifiedAt || ""))) {
                        n.isRead = true;
                    }
                });

                const unread = merged.filter(n => !n.isRead).length;

                this._oNotifViewModel.setProperty("/notifications",    merged);
                this._oNotifViewModel.setProperty("/unreadCount",      unread);
                this._oNotifViewModel.setProperty("/hasNotifications", merged.length > 0);
                this._oNotifViewModel.setProperty("/loading",          false);
                this._applyFiltersAndRender();
            });
        },

        // ═══════════════════════════════════════════════════════════════════════
        // FILTERS
        // ═══════════════════════════════════════════════════════════════════════

        onReadFilterChange: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this._oNotifViewModel.setProperty("/readFilter", sKey);
            this._applyFiltersAndRender();
        },

        onTypeFilterChange: function (oEvent) {
            var sKey = oEvent.getSource().getSelectedKey();
            this._oNotifViewModel.setProperty("/typeFilter", sKey);
            this._applyFiltersAndRender();
        },

        _applyFiltersAndRender: function () {
            var all     = this._oNotifViewModel.getProperty("/notifications") || [];
            var readKey = this._oNotifViewModel.getProperty("/readFilter") || "all";
            var typeKey = this._oNotifViewModel.getProperty("/typeFilter") || "all";

            var filtered = all.filter(function (n) {
                if (readKey === "unread" &&  n.isRead) return false;
                if (readKey === "read"   && !n.isRead) return false;
                if (!matchesTypeFilter(n, typeKey))    return false;
                return true;
            });

            this._oNotifViewModel.setProperty("/displayed",        filtered);
            this._oNotifViewModel.setProperty("/hasNotifications", filtered.length > 0);
            this._oNotifViewModel.setProperty("/notifListHTML",
                this._buildNotifListHTML(filtered));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // LOAD MORE (pagination)
        // ═══════════════════════════════════════════════════════════════════════

        onLoadMore: function () {
            this._currentPage++;
            this._loadNotifications(true);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // MARK READ — individual
        // ═══════════════════════════════════════════════════════════════════════

        onNotifClick: function (sNotificationId) {
            if (!sNotificationId) return;

            var items  = this._oNotifViewModel.getProperty("/notifications") || [];
            var target = items.find(function (n) { return n.notificationId === sNotificationId; });
            if (!target || target.isRead) return;

            // Optimistic update
            target.isRead = true;
            var unread = items.filter(function (n) { return !n.isRead; }).length;
            this._oNotifViewModel.setProperty("/notifications", items);
            this._oNotifViewModel.setProperty("/unreadCount",   unread);
            this._applyFiltersAndRender();

            // Backend persist
            this._callAction("markNotificationRead", { notificationId: sNotificationId })
                .catch(function () {
                    // Roll back
                    target.isRead = false;
                    var unreadRb = items.filter(function (n) { return !n.isRead; }).length;
                    this._oNotifViewModel.setProperty("/notifications", items);
                    this._oNotifViewModel.setProperty("/unreadCount",   unreadRb);
                    this._applyFiltersAndRender();
                    MessageToast.show("Could not mark notification as read.");
                }.bind(this));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // MARK ALL READ
        // FIX: removed oComp.persistNotifications() call — doesn't exist
        // ═══════════════════════════════════════════════════════════════════════

        onMarkAllRead: function () {
            var items = this._oNotifViewModel.getProperty("/notifications") || [];
            var hadUnread = items.some(function (n) { return !n.isRead; });
            if (!hadUnread) return;

            // Optimistic UI
            items.forEach(function (n) { n.isRead = true; });
            this._oNotifViewModel.setProperty("/notifications", items);
            this._oNotifViewModel.setProperty("/unreadCount",   0);
            this._applyFiltersAndRender();

            // Persist read state so it survives navigation and backend re-fetch
            const readKeys = new Set(JSON.parse(localStorage.getItem("tsNotifReadKeys") || "[]"));
            items.forEach(n => readKeys.add((n.title || "") + "|" + (n.notifiedAt || "")));
            localStorage.setItem("tsNotifReadKeys", JSON.stringify([...readKeys]));

            MessageToast.show("All notifications marked as read.");
            // Sync local notifications model if it exists (optional — no crash if missing)
            var oComp       = this.getOwnerComponent();
            var oNotifModel = oComp.getModel("notifications");
            if (oNotifModel) {
                var localItems = oNotifModel.getProperty("/items") || [];
                localItems.forEach(function (n) { n.read = true; });
                oNotifModel.setProperty("/items", localItems);
                // Only call persistNotifications if it actually exists
                if (typeof oComp.persistNotifications === "function") {
                    oComp.persistNotifications();
                }
            }

            // Backend
            this._callAction("markAllNotificationsRead", {})
                .then(function (res) {
                    var updated = (res && res.updated) || 0;
                    MessageToast.show(
                        updated > 0
                            ? updated + " notification" + (updated > 1 ? "s" : "") + " marked as read."
                            : "All notifications already read."
                    );
                })
                .catch(function () {
                    // Don't roll back — local state is correct, only backend sync failed
                    MessageToast.show("Marked as read (offline sync pending).");
                });
        },

        // ═══════════════════════════════════════════════════════════════════════
        // DELETE — individual
        // ═══════════════════════════════════════════════════════════════════════

        onNotifDelete: function (sNotificationId) {
            if (!sNotificationId) return;

            MessageBox.confirm("Remove this notification?", {
                title:   "Delete Notification",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;
                    this._doDelete(sNotificationId);
                }.bind(this)
            });
        },

        _doDelete: function (sNotificationId) {
            var items = this._oNotifViewModel.getProperty("/notifications") || [];
            var idx   = items.findIndex(function (n) { return n.notificationId === sNotificationId; });
            if (idx < 0) return;

            var removed = items.splice(idx, 1)[0];
            var unread  = items.filter(function (n) { return !n.isRead; }).length;
            this._oNotifViewModel.setProperty("/notifications", items);
            this._oNotifViewModel.setProperty("/unreadCount",   unread);
            this._oNotifViewModel.setProperty("/totalCount",
                Math.max(0, (this._oNotifViewModel.getProperty("/totalCount") || 1) - 1));
            this._applyFiltersAndRender();

            // Backend
            this._callAction("deleteNotification", { notificationId: sNotificationId })
                .then(function () {
                    MessageToast.show("Notification removed.");
                })
                .catch(function () {
                    // Roll back — re-insert at original position
                    items.splice(idx, 0, removed);
                    var unreadRb = items.filter(function (n) { return !n.isRead; }).length;
                    this._oNotifViewModel.setProperty("/notifications", items);
                    this._oNotifViewModel.setProperty("/unreadCount",   unreadRb);
                    this._oNotifViewModel.setProperty("/totalCount",
                        (this._oNotifViewModel.getProperty("/totalCount") || 0) + 1);
                    this._applyFiltersAndRender();
                    MessageToast.show("Could not delete notification.");
                }.bind(this));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // HTML RENDERER
        // ═══════════════════════════════════════════════════════════════════════

        _buildNotifListHTML: function (notifications) {
            if (!notifications || notifications.length === 0) return "";

            var groups     = {};
            var groupOrder = [];
            notifications.forEach(function (n) {
                var g = getDateGroup(n.notifiedAt);
                if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
                groups[g].push(n);
            });

            var html = '<div style="display:flex;flex-direction:column;gap:0;">';

            groupOrder.forEach(function (groupName) {
                var groupItems = groups[groupName];

                html += '<div style="padding:16px 0 8px;font-size:0.75rem;font-weight:700;'
                      + 'color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">'
                      + groupName + '</div>';

                html += '<div style="background:#fff;border-radius:12px;'
                      + 'box-shadow:0 1px 4px rgba(0,0,0,0.08);overflow:hidden;">';

                groupItems.forEach(function (n, idx) {
                    var cfg       = getTypeConfig(n.type);
                    var isLast    = idx === groupItems.length - 1;
                    var bgColor   = n.isRead ? "#fff" : "#f8faff";
                    var borderBot = isLast ? "none" : "1px solid #f3f4f6";
                    var titleFw   = n.isRead ? "500" : "700";
                    var ago       = timeAgo(n.notifiedAt);
                    var hasId     = !!n.notificationId;

                    var clickable   = !n.isRead && hasId && n._source !== "local";
                    var cursorCss   = clickable ? "cursor:pointer;" : "";
                    var onclickMark = clickable
                        ? ' onclick="window._notifController&&window._notifController.onNotifClick(\'' + n.notificationId + '\')"'
                        : '';

                    html += '<div style="display:flex;align-items:flex-start;gap:14px;'
                          + 'padding:16px 20px;background:' + bgColor + ';'
                          + 'border-bottom:' + borderBot + ';'
                          + cursorCss
                          + 'transition:background 0.15s;"'
                          + onclickMark + '>';

                    // Icon circle
                    html += '<div style="width:42px;height:42px;border-radius:50%;'
                          + 'background:' + cfg.bg + ';display:flex;align-items:center;'
                          + 'justify-content:center;flex-shrink:0;margin-top:1px;">'
                          + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"'
                          + ' stroke="' + cfg.color + '" stroke-width="2"'
                          + ' stroke-linecap="round" stroke-linejoin="round">'
                          + '<path d="' + cfg.icon + '"/></svg></div>';

                    // Content
                    html += '<div style="flex:1;min-width:0;">';
                    html += '<div style="display:flex;align-items:center;'
                          + 'justify-content:space-between;margin-bottom:4px;">';
                    html += '<span style="font-size:0.72rem;font-weight:600;'
                          + 'color:' + cfg.color + ';background:' + cfg.bg + ';'
                          + 'padding:2px 10px;border-radius:10px;">'
                          + cfg.label + '</span>';
                    html += '<span style="font-size:0.72rem;color:#9ca3af;'
                          + 'white-space:nowrap;margin-left:8px;">' + ago + '</span>';
                    html += '</div>';
                    html += '<div style="font-size:0.875rem;font-weight:' + titleFw + ';'
                          + 'color:#111827;line-height:1.4;margin-bottom:3px;">'
                          + (n.title || "") + '</div>';
                    if (n.message) {
                        html += '<div style="font-size:0.8rem;color:#6b7280;line-height:1.5;">'
                              + n.message + '</div>';
                    }
                    html += '</div>';

                    // Right side: unread dot + delete button
                    html += '<div style="display:flex;flex-direction:column;'
                          + 'align-items:center;gap:6px;flex-shrink:0;">';

                    if (!n.isRead) {
                        html += '<div style="width:9px;height:9px;border-radius:50%;'
                              + 'background:#3b82f6;margin-top:2px;"></div>';
                    }

                    if (hasId) {
                        html += '<button onclick="event.stopPropagation();'
                              + 'window._notifController&&window._notifController.onNotifDelete(\''
                              + n.notificationId + '\')"'
                              + ' title="Dismiss" style="background:none;border:none;'
                              + 'cursor:pointer;padding:2px 4px;color:#d1d5db;'
                              + 'font-size:0.9rem;line-height:1;border-radius:4px;'
                              + 'transition:color 0.15s;" '
                              + 'onmouseover="this.style.color=\'#dc2626\'" '
                              + 'onmouseout="this.style.color=\'#d1d5db\'">'
                              + '&#x2715;</button>';
                    }

                    html += '</div>'; // end right side
                    html += '</div>'; // end row
                });

                html += '</div>'; // end group card
            });

            html += '</div>';
            return html;
        },

        // ═══════════════════════════════════════════════════════════════════════
        // NAVIGATION
        // ═══════════════════════════════════════════════════════════════════════

        onCloseNotifications: function () {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        },

        // ═══════════════════════════════════════════════════════════════════════
        // HTTP HELPER
        // ═══════════════════════════════════════════════════════════════════════

        _callAction: function (sActionName, mParams) {
            return new Promise(function (resolve, reject) {
                fetch("/employee/" + sActionName, {
                    method:      "POST",
                    headers:     { "Content-Type": "application/json", "Accept": "application/json" },
                    body:        JSON.stringify(mParams || {}),
                    credentials: "include"
                })
                .then(function (res) {
                    return res.text().then(function (text) {
                        if (res.status === 204) { resolve({}); return; }
                        if (!res.ok) {
                            console.error("Action " + sActionName + " failed:", res.status, text);
                            reject(new Error(text || res.statusText));
                            return;
                        }
                        if (!text || text.trim() === "") { resolve({}); return; }
                        try {
                            var data    = JSON.parse(text);
                            var cleaned = Object.fromEntries(
                                Object.entries(data).filter(function (e) {
                                    return !e[0].startsWith("@");
                                })
                            );
                            resolve(cleaned.value !== undefined ? cleaned.value : cleaned);
                        } catch (parseErr) {
                            console.error("Failed to parse response for " + sActionName + ":", text);
                            reject(parseErr);
                        }
                    });
                })
                .catch(reject);
            });;       
         },
        // ── Formatters ────────────────────────────────────────────────────────
        formatTypeIcon(sType) {
            const map = {
                TIMESHEET_APPROVED:     "sap-icon://accept",
                TIMESHEET_REJECTED:     "sap-icon://decline",
                TASK_ASSIGNED:          "sap-icon://task",
                TASK_REVIEW_REQUESTED:  "sap-icon://approvals",
                PERFORMANCE_RATED:      "sap-icon://survey",
                LEAVE_APPROVED:         "sap-icon://accept",
                LEAVE_REJECTED:         "sap-icon://decline",
                approved:               "sap-icon://accept",
                rejected:               "sap-icon://decline"
            };
            return map[sType] || "sap-icon://bell";
        },

        formatTypeColor(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED","TASK_REVIEW_REQUESTED","TASK_ASSIGNED"].includes(sType)
                ? "#16a34a" : "#dc2626";
        },

        formatTypeLabel(sType) {
            const map = {
                TIMESHEET_APPROVED:    "Approved",     TIMESHEET_REJECTED: "Rejected",
                TASK_ASSIGNED:         "Task",         PERFORMANCE_RATED:  "Rating",
                TASK_REVIEW_REQUESTED: "Review",
                LEAVE_APPROVED:        "Leave OK",     LEAVE_REJECTED:     "Leave Rejected",
                approved:              "Approved",     rejected:           "Rejected"
            };
            return map[sType] || "Info";
        },

        formatTypeState(sType) {
            return ["approved","TIMESHEET_APPROVED","LEAVE_APPROVED","TASK_ASSIGNED","PERFORMANCE_RATED","TASK_REVIEW_REQUESTED"]
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