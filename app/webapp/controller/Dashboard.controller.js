sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Core"
], (Controller, JSONModel, Core) => {
    "use strict";

    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }
    function toDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
    function toShortLabel(date) {
        return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    }
    function parseHHMM(s) {
        if (!s || s === "") return 0;
        if (String(s).includes(":")) {
            const [h, m] = String(s).split(":");
            return (parseInt(h) || 0) + (parseInt(m) || 0) / 60;
        }
        return parseFloat(s) || 0;
    }
    function toHHMM(decimal) {
        const h = Math.floor(decimal);
        const m = Math.round((decimal - h) * 60);
        return `${h}:${String(m).padStart(2, "0")}`;
    }

    return Controller.extend("timesheet.app.controller.Dashboard", {

        // ─────────────────────────────────────────────────────────────────────
        // onInit — initialise model with safe defaults for every card so no
        // binding ever produces "undefined Days" / "undefined Pending" etc.
        // ─────────────────────────────────────────────────────────────────────
        onInit() {
            const today = new Date();
            const weekStart = getWeekStart(today);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);

            this._oDashModel = new JSONModel({
                greeting: "Hey",
                todayLabel: today.toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric"
                }),
                weekLabel: `${toShortLabel(weekStart)} – ${toShortLabel(weekEnd)}`,
                weekStart: toDateString(weekStart),
                dashGridHTML: "",
                weekTotalLabel: "0:00 hrs this week",
                isNextDisabled: false,
                completion: {
                    pct: 0, label: "0 of 5 days filled",
                    state: "None", hint: "Fill Mon–Fri to complete your timesheet"
                },
                // existing 3 cards
                workAnniversary: { yearsCompleted: 0, joiningDate: null, message: "Welcome!", yearsLabel: "—" },
                leaveBalance: { casualLeave: 0, sickLeave: 0, annualLeave: 0, total: 0, usedPct: 0 },
                myTasks: { totalPending: 0, highPriorityCount: 0, inProgressCount: 0, notStartedCount: 0 },
                // new cards
                attendance: {
                    attendancePercentage: 0,
                    presentCount: 0,
                    absentCount: 0,
                    monthLabel: "Month"
                },
                performanceRating: {
                    ratingValue: 0,
                    ratingCategory: "N/A"
                },
                performanceTrend: {
                    selectedYear: String(today.getFullYear()),
                    months: Array(12).fill(null)
                },
                myTasks: {
                    totalPending: 0,
                    highPriorityCount: 0,
                    mediumPriorityCount: 0,
                    lowPriorityCount: 0
                },
                leaveOverview: {
                    casual: 0, sick: 0, annual: 0, unpaid: 0, totalDays: 0, takenData: []
                },
                upcomingCalendar: {
                    events: []
                },
                recentNotifications: {
                    items: []
                },
                // ADD inside the JSONModel({}) in onInit, after existing properties
                greetingEmoji: "👋",
                greetingHTML: "",
                attendanceBtnLabel: "Checking...",
                attendanceBtnEnabled: false,
                attendanceMarked: false,
            });

            this.getView().setModel(this._oDashModel, "dash");
            this._loadGreeting();

            this.getOwnerComponent().getRouter()
                .getRoute("dashboard")
                .attachPatternMatched(this._onRouteMatched, this);

            this.getView().addEventDelegate({
                onAfterRendering: () => this._scrollToTop()
            });

            // ── Live refresh on task status changes ─────────────────────────
            // TaskDescription / TaskDetail publish "tasks/statusChanged" on
            // the global EventBus whenever a status flips. We re-fetch the
            // backend-backed task summary + my-tasks cards so the donut and
            // pending-counts reflect reality instantly — no route round-trip,
            // no manual refresh. Throttled to coalesce bursts.
            this._fnOnTaskStatusChanged = () => {
                if (this._taskRefreshTimer) clearTimeout(this._taskRefreshTimer);
                this._taskRefreshTimer = setTimeout(() => {
                    this._loadTaskSummary();
                    this._loadMyTasks();
                }, 150);
            };
            try {
                const oBus = Core.getEventBus ? Core.getEventBus() : sap.ui.getCore().getEventBus();
                oBus.subscribe("tasks", "statusChanged", this._fnOnTaskStatusChanged, this);
            } catch (e) { /* ignore */ }
        },

        // Unsubscribe to avoid leaks if the view is ever destroyed.
        // Note: onExit was previously defined later — augment it carefully.
        _unsubscribeTaskBus() {
            try {
                const oBus = Core.getEventBus ? Core.getEventBus() : sap.ui.getCore().getEventBus();
                if (this._fnOnTaskStatusChanged) {
                    oBus.unsubscribe("tasks", "statusChanged", this._fnOnTaskStatusChanged, this);
                }
            } catch (e) { /* ignore */ }
        },

        // ─────────────────────────────────────────────────────────────────────
        // Greeting
        // ─────────────────────────────────────────────────────────────────────
        _loadGreeting() {
            const oComp = this.getOwnerComponent();
            if (!oComp) return;

            const hour = new Date().getHours();
            const timeGreet = hour < 12 ? "Good Morning"
                : hour < 17 ? "Good Afternoon"
                    : "Good Evening";

            const buildHTML = (name) => {
                const namePart = name
                    ? `, <span style="color:#ffffff;font-style:italic;">${name}!</span>`
                    : `!`;
                return `
        <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <span style="font-size:1.85rem;font-weight:800;color:#ffffff;
                             letter-spacing:-0.4px;font-family:'Segoe UI',Arial,sans-serif;
                             line-height:1.1;">${timeGreet}${namePart}</span>
            </div>
            <div style="font-size:1.05rem;font-weight:500;color:rgba(255,255,255,0.80);margin:0;">
                Here's what's happening with you today.
            </div>
        </div>`;
            };

            // Render immediately with no name so it's never blank
            this._oDashModel.setProperty("/greetingHTML", buildHTML(""));

            // Always wait for the real backend-resolved user — never use the
            // localStorage fallback for the greeting, as it causes wrong names.
            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (u && u.employeeName) {
                        this._oDashModel.setProperty("/greetingHTML", buildHTML(u.employeeName));
                    }
                });
            }
        },

        // ─────────────────────────────────────────────────────────────────────
        // Route match — kick off all loaders
        // ─────────────────────────────────────────────────────────────────────
        _onRouteMatched() {
            const oComp = this.getOwnerComponent();

            // Wait for backend user to resolve before loading any dashboard data
            oComp.getCurrentUser().then(() => {
                this._loadAllDashData();
            }).catch(() => {
                // Even if getCurrentUser fails, load with whatever empId we have
                this._loadAllDashData();
            });
        },

        _loadAllDashData() {
            const sWeekStart = this._oDashModel.getProperty("/weekStart");
            this._computeStats();
            this._computeWeekHours(sWeekStart);

            this._loadWorkAnniversary();
            this._loadLeaveBalance();
            this._loadMyTasks();

            this._loadAttendance();
            this._loadPerformanceRating();
            this._loadPerformanceTrend();
            this._loadTaskSummary();

            this._loadLeaveOverview();
            this._loadUpcomingCalendar();
            this._loadRecentNotifications();
            this._checkTodayAttendance();
            this._scheduleAttendanceBtnReset();
        },

        // ── Notification button handler ───────────────────────────────────────
        // ── Notification bell → open slide-in panel ───────────────────────────
        onNotificationPress() {
            this.getOwnerComponent().getRouter().navTo("notifications");
        },

        _openNotifPanel(oSource) {
            const oComp = this.getOwnerComponent();
            const oModel = oComp.getModel("notifications");
            const items = oModel ? (oModel.getProperty("/items") || []) : [];
            const sEmpId = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : null;
            const sRole = (oComp._oCurrentUser && oComp._oCurrentUser.role)
                || (localStorage.getItem("tsRole") || "employee").toLowerCase();

            // Filter to current user's notifications (same logic as Notifications controller)
            const mine = items.filter(n => {
                if (n.recipientEmployeeId) return n.recipientEmployeeId === sEmpId;
                return sRole !== "manager";
            }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Also include backend notifications from recentNotifications
            const backendItems = this._oDashModel.getProperty("/recentNotifications/items") || [];

            // Merge: backend items first, then local model items (deduplicate by title+time)
            const allItems = [...backendItems, ...mine.map(n => ({
                type: n.type || "DEFAULT",
                title: n.title || n.weekRange || "Notification",
                message: n.message || "",
                notifiedAt: n.timestamp || null,
                isRead: n.read || false
            }))];

            const _timeAgo = (isoStr) => {
                if (!isoStr) return '';
                const diff = Date.now() - new Date(isoStr).getTime();
                const mins = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                if (mins < 1) return 'Just now';
                if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
                if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
                return `${days} day${days !== 1 ? 's' : ''} ago`;
            };

            const NOTIF_META = {
                TIMESHEET_APPROVED: { color: '#16a34a', bg: '#f0fdf4', icon: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
                TIMESHEET_REJECTED: { color: '#dc2626', bg: '#fef2f2', icon: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
                TASK_ASSIGNED: { color: '#f59e0b', bg: '#fffbeb', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' },
                PERFORMANCE_RATED: { color: '#8b5cf6', bg: '#f5f3ff', icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
                LEAVE_APPROVED: { color: '#3b82f6', bg: '#eff6ff', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><path d="M9 14l2 2 4-4"/>' },
                LEAVE_REJECTED: { color: '#dc2626', bg: '#fef2f2', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="9" y1="14" x2="15" y2="14"/>' },
                approved: { color: '#16a34a', bg: '#f0fdf4', icon: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
                rejected: { color: '#dc2626', bg: '#fef2f2', icon: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
                DEFAULT: { color: '#6b7280', bg: '#f9fafb', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' }
            };

            const sViewId = this.getView().getId();

            const notifRows = allItems.length === 0
                ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                       padding:40px 20px;text-align:center;">
               <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                    stroke="#d1d5db" stroke-width="1.5" style="margin-bottom:12px;">
                   <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                   <path d="M13.73 21a2 2 0 01-3.46 0"/>
               </svg>
               <div style="font-size:0.9rem;font-weight:600;color:#374151;margin-bottom:4px;">No notifications</div>
               <div style="font-size:0.78rem;color:#9ca3af;">You're all caught up!</div>
           </div>`
                : allItems.map(n => {
                    const meta = NOTIF_META[n.type] || NOTIF_META.DEFAULT;
                    return `
            <div style="display:flex;align-items:flex-start;gap:12px;
                        padding:12px 16px;border-bottom:1px solid #f3f4f6;
                        background:${n.isRead ? '#fff' : '#f8faff'};
                        transition:background 0.2s;">
                <span style="width:36px;height:36px;border-radius:50%;
                             background:${meta.bg};display:flex;align-items:center;
                             justify-content:center;flex-shrink:0;margin-top:1px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                         stroke="${meta.color}" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        ${meta.icon}
                    </svg>
                </span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.83rem;font-weight:${n.isRead ? '400' : '600'};
                                color:#111827;line-height:1.35;margin-bottom:2px;">
                        ${n.title}
                    </div>
                    <div style="font-size:0.75rem;color:#6b7280;
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${n.message}
                    </div>
                    <div style="font-size:0.72rem;color:#9ca3af;margin-top:3px;">
                        ${_timeAgo(n.notifiedAt)}
                    </div>
                </div>
                ${!n.isRead
                            ? `<span style="width:8px;height:8px;border-radius:50%;
                                   background:#3b82f6;flex-shrink:0;margin-top:5px;"></span>`
                            : ''}
            </div>`;
                }).join("");

            const unreadCount = allItems.filter(n => !n.isRead).length;

            const panelHTML = `
        <div style="width:380px;max-height:520px;display:flex;flex-direction:column;
                    font-family:'Segoe UI',Arial,sans-serif;border-radius:12px;overflow:hidden;">

            <!-- Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:14px 16px;border-bottom:1px solid #f3f4f6;
                        background:#fff;flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 01-3.46 0"/>
                    </svg>
                    <span style="font-size:0.95rem;font-weight:700;color:#111827;">Notifications</span>
                    ${unreadCount > 0
                    ? `<span style="background:#3b82f6;color:#fff;font-size:0.7rem;font-weight:700;
                                        padding:2px 7px;border-radius:10px;">${unreadCount}</span>`
                    : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    ${allItems.length > 0
                    ? `<span onclick="sap.ui.getCore().byId('${sViewId}').getController()._viewAllNotifications()"
                                 style="font-size:0.78rem;color:#3b82f6;cursor:pointer;font-weight:500;
                                        padding:4px 8px;border-radius:6px;hover:background:#eff6ff;">
                               View All
                           </span>`
                    : ''}
                    <!-- Close / X button → navigates to dashboard -->
                    <span onclick="sap.ui.getCore().byId('${sViewId}').getController()._closeNotifPanel()"
                          style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
                                 cursor:pointer;border-radius:6px;color:#6b7280;font-size:1.1rem;
                                 background:#f3f4f6;line-height:1;"
                          title="Close">✕</span>
                </div>
            </div>

            <!-- Scrollable notification list -->
            <div style="overflow-y:auto;flex:1;">${notifRows}</div>

        </div>`;

            // Use a ResponsivePopover so it stays anchored to the bell
            this._oNotifPopover = new sap.m.Popover({
                showHeader: false,
                placement: "Bottom",
                contentWidth: "380px",
                afterClose: () => {
                    if (this._oNotifPopover) {
                        this._oNotifPopover.destroy();
                        this._oNotifPopover = null;
                    }
                }
            });

            const oHtml = new sap.ui.core.HTML({
                content: panelHTML,
                sanitizeContent: false
            });

            this._oNotifPopover.addContent(oHtml);
            this.getView().addDependent(this._oNotifPopover);
            this._oNotifPopover.openBy(oSource);
        },

        // ── Close panel + stay on dashboard ──────────────────────────────────
        _closeNotifPanel() {
            if (this._oNotifPopover) {
                this._oNotifPopover.close();
                this._oNotifPopover.destroy();
                this._oNotifPopover = null;
            }
            // Navigate to dashboard (overview)
            this.getOwnerComponent().getRouter().navTo("dashboard");
        },

        // ── "View All" inside the panel → Notifications page ─────────────────
        _viewAllNotifications() {
            this.getOwnerComponent().getRouter().navTo("notifications");
        },

        // ── Mark Active / Attendance ──────────────────────────────────────────
        onMarkAttendance() {
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            const timeStr = now.toTimeString().split(" ")[0];
            const dayStr = now.toLocaleDateString("en-GB", { weekday: "long" });

            // Disable button immediately to prevent double-click
            this._oDashModel.setProperty("/attendanceBtnEnabled", false);
            this._oDashModel.setProperty("/attendanceBtnLabel", "Marking...");

            this._callAction("markAttendance", {
                attendanceDate: dateStr,
                attendanceDay: dayStr,
                attendanceTime: timeStr
            })
                .then(() => {
                    this._oDashModel.setProperty("/attendanceBtnLabel", "✓ Active");
                    this._oDashModel.setProperty("/attendanceBtnEnabled", false);
                    this._oDashModel.setProperty("/attendanceMarked", true);

                    // Reload attendance card from backend so % and counts are fresh
                    this._loadAttendance();
                    this._refreshDash();

                    sap.m.MessageToast.show(
                        `Attendance marked for ${dayStr}, ${dateStr} at ${timeStr}`
                    );

                    // Reschedule 11 PM reset
                    this._scheduleAttendanceBtnReset();
                })
                .catch(oErr => {
                    // Re-enable so user can retry
                    this._oDashModel.setProperty("/attendanceBtnLabel", "● Mark Active");
                    this._oDashModel.setProperty("/attendanceBtnEnabled", true);

                    sap.m.MessageBox.error(oErr?.message || "Failed to mark attendance.");
                });
        },


        onExit() {
            if (this._attendanceResetTimer) {
                clearTimeout(this._attendanceResetTimer);
            }
            if (this._taskRefreshTimer) {
                clearTimeout(this._taskRefreshTimer);
            }
            this._unsubscribeTaskBus();
        },
        // ─────────────────────────────────────────────────────────────────────
        // Week navigation (unchanged)
        // ─────────────────────────────────────────────────────────────────────
        onPrevWeek() {
            const s = this._oDashModel.getProperty("/weekStart");
            const [y, m, d] = s.split("-").map(Number);
            this._setWeek(new Date(y, m - 1, d - 7));
        },
        onNextWeek() {
            const s = this._oDashModel.getProperty("/weekStart");
            const [y, m, d] = s.split("-").map(Number);
            this._setWeek(new Date(y, m - 1, d + 7));
        },
        onToday() { this._setWeek(new Date()); },

        isCurrentOrFutureWeek(sWeekStart) {
            return new Date(sWeekStart) >= getWeekStart(new Date());
        },

        _setWeek(date) {
            const weekStart = getWeekStart(date);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const sWeekStart = toDateString(weekStart);
            this._oDashModel.setProperty("/weekStart", sWeekStart);
            this._oDashModel.setProperty("/weekLabel", `${toShortLabel(weekStart)} – ${toShortLabel(weekEnd)}`);
            this._oDashModel.setProperty("/isNextDisabled", this.isCurrentOrFutureWeek(sWeekStart));
            this._computeWeekHours(sWeekStart);
        },

        // ─────────────────────────────────────────────────────────────────────
        // Stats (unchanged)
        // ─────────────────────────────────────────────────────────────────────
        _computeStats() {
            const oHistModel = this.getOwnerComponent().getModel("history");
            const submissions = oHistModel ? (oHistModel.getProperty("/submissions") || []) : [];
            this._oDashModel.setProperty("/approved", submissions.filter(s => s.status === "Approved").length);
            this._oDashModel.setProperty("/pending", submissions.filter(s => s.status === "Pending").length);
            this._oDashModel.setProperty("/rejected", submissions.filter(s => s.status === "Rejected").length);
            this._oDashModel.setProperty("/total", submissions.length);
        },

        // ─────────────────────────────────────────────────────────────────────
        // Week hours (unchanged)
        // ─────────────────────────────────────────────────────────────────────
        _computeWeekHours(sWeekStart) {
            const oLocksModel = this.getOwnerComponent().getModel("locked");
            let rows = oLocksModel ? (oLocksModel.getProperty("/" + sWeekStart) || []) : [];
            if (rows.length === 0) {
                const subs = this.getOwnerComponent().getModel("history")?.getProperty("/submissions") || [];
                const sub = subs.find(s => s.weekStart === sWeekStart);
                rows = sub ? (sub.rows || []) : [];
            }
            const dayTotals = {};
            DAYS.forEach(d => { dayTotals[d] = rows.reduce((s, r) => s + parseHHMM(r[d] || ""), 0); });

            const weekDays = DAYS.slice(0, 5).map((d, i) => ({
                name: DAY_NAMES[i], hours: dayTotals[d],
                hoursLabel: dayTotals[d] > 0 ? toHHMM(dayTotals[d]) + " hrs" : "–"
            }));
            const weekTotal = DAYS.reduce((s, d) => s + dayTotals[d], 0);
            const filledDays = DAYS.slice(0, 5).filter(d => dayTotals[d] > 0).length;
            const pct = Math.round(filledDays / 5 * 100);

            this._oDashModel.setProperty("/weekTotalLabel", `${toHHMM(weekTotal)} hrs this week`);
            this._oDashModel.setProperty("/barChartHTML", this._buildBarChart(weekDays));
            this._oDashModel.setProperty("/completion", {
                pct,
                label: `${filledDays} of 5 days filled`,
                state: pct === 100 ? "Success" : pct >= 60 ? "Warning" : pct > 0 ? "Error" : "None",
                hint: pct === 100
                    ? "All Mon–Fri days filled – ready to submit!"
                    : `${5 - filledDays} day${5 - filledDays !== 1 ? "s" : ""} remaining`
            });
            this._refreshDash();
            this._scrollToTop();
        },

        _scrollToTop() {
            const oPage = this.byId("dashPage");
            if (oPage && oPage.scrollTo) oPage.scrollTo(0, 0);
            const dom = this.getView()?.getDomRef?.();
            if (dom) dom.querySelectorAll(".sapMPageEnableScrolling,.sapMScrollCont,.sapMNavContainer")
                .forEach(el => { el.scrollTop = 0; });
            setTimeout(() => {
                if (oPage && oPage.scrollTo) oPage.scrollTo(0, 0);
                if (dom) dom.querySelectorAll(".sapMPageEnableScrolling,.sapMScrollCont,.sapMNavContainer")
                    .forEach(el => { el.scrollTop = 0; });
            }, 50);
        },

        // ─────────────────────────────────────────────────────────────────────
        // _callAction — OData V4 wrapper replacing callFunction (which is V2 only)
        // Usage: this._callAction("actionName", { param1: val1 })
        //          .then(result => { ... })
        //          .catch(() => { ... });
        // ─────────────────────────────────────────────────────────────────────
        _callAction(sActionName, mParams) {
            if (!this.getOwnerComponent()) {
                return Promise.reject(new Error("No component"));
            }

            return new Promise((resolve, reject) => {
                fetch("/employee/" + sActionName, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify(mParams || {}),
                    credentials: "include"
                })
                    .then(async (res) => {
                        try {
                            if (res.status === 204) {
                                resolve({});
                                return;
                            }

                            const text = await res.text();

                            if (!res.ok) {
                                reject(new Error(text || res.statusText));
                                return;
                            }

                            if (!text || text.trim() === "") {
                                resolve({});
                                return;
                            }

                            const data = JSON.parse(text);
                            const cleaned = Object.fromEntries(
                                Object.entries(data).filter(([k]) => !k.startsWith("@"))
                            );
                            resolve(cleaned.value !== undefined ? cleaned.value : cleaned);

                        } catch (e) {
                            reject(e);
                        }
                    })
                    .catch(reject);
            });
        },

        // ─────────────────────────────────────────────────────────────────────
        // Loaders — existing 3 (unchanged logic, now call _refreshDash)
        // ─────────────────────────────────────────────────────────────────────
        _loadWorkAnniversary() {  //completed
            this._callAction("getWorkAnniversary")
                .then(result => {
                    const years = result.yearsCompleted || 0;
                    const yearsLabel = years >= 1
                        ? parseFloat(years.toFixed(1)) + " Years"
                        : (Math.floor(years * 12) > 0
                            ? Math.floor(years * 12) + " Months"
                            : "< 1 Month");

                    this._oDashModel.setProperty("/workAnniversary", {
                        yearsCompleted: years,
                        joiningDate: result.joiningDate || null,
                        message: result.message || "Welcome!",
                        yearsLabel: yearsLabel
                    });
                })
                .catch((e) => {
                    console.error("getWorkAnniversary failed:", e);
                    this._oDashModel.setProperty("/workAnniversary", {
                        yearsCompleted: 0,
                        joiningDate: null,
                        message: "Welcome!",
                        yearsLabel: "—"
                    });
                })
                .finally(() => this._refreshDash());
        },

        _loadLeaveBalance() {
            const MAX_BALANCE = {
                Casual: 5, Sick: 5, Paid: 11, Maternity: 180, Paternity: 2
            };

            const oComp = this.getOwnerComponent();
            const oModel = oComp.getModel();
            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;

            if (!oModel || !sEmpId) {
                this._loadLeaveBalanceFallback();
                return;
            }

            // Wait for metadata to be loaded before querying
            oModel.getMetaModel().requestObject("/LeaveRequests").then(() => {

                oModel.bindList("/LeaveRequests", null, null, [
                    new sap.ui.model.Filter(
                        "employee_employeeId",
                        sap.ui.model.FilterOperator.EQ,
                        sEmpId
                    )
                ], { $$groupId: "$direct" })
                    .requestContexts(0, 200)
                    .then(aCtx => {
                        const history = aCtx.map(c => c.getObject()).filter(Boolean);
                        console.log("LeaveRequests:", history);

                        const used = {
                            Casual: 0, Sick: 0, Paid: 0, Maternity: 0, Paternity: 0
                        };

                        history
                            .filter(r => r.status !== "Rejected")
                            .forEach(r => {
                                const days = r.days || 0;
                                if (!days) return;

                                if (r.leaveType === "Sick") {
                                    let remaining = days;
                                    const sickAvail = Math.max(0, MAX_BALANCE.Sick - used.Sick);
                                    const fromSick = Math.min(remaining, sickAvail);
                                    used.Sick += fromSick;
                                    remaining -= fromSick;

                                    if (remaining > 0) {
                                        const casualAvail = Math.max(0, MAX_BALANCE.Casual - used.Casual);
                                        const fromCasual = Math.min(remaining, casualAvail);
                                        used.Casual += fromCasual;
                                        remaining -= fromCasual;
                                    }
                                    if (remaining > 0) {
                                        const paidAvail = Math.max(0, MAX_BALANCE.Paid - used.Paid);
                                        const fromPaid = Math.min(remaining, paidAvail);
                                        used.Paid += fromPaid;
                                    }
                                } else if (used[r.leaveType] !== undefined) {
                                    const avail = Math.max(0,
                                        MAX_BALANCE[r.leaveType] - used[r.leaveType]);
                                    used[r.leaveType] += Math.min(days, avail);
                                }
                            });

                        const casual = Math.max(0, MAX_BALANCE.Casual - used.Casual);
                        const sick = Math.max(0, MAX_BALANCE.Sick - used.Sick);
                        const annual = Math.max(0, MAX_BALANCE.Paid - used.Paid);
                        const total = casual + sick + annual;
                        const usedPct = Math.min(100, Math.round(
                            ((MAX_BALANCE.Casual + MAX_BALANCE.Sick + MAX_BALANCE.Paid - total) /
                                (MAX_BALANCE.Casual + MAX_BALANCE.Sick + MAX_BALANCE.Paid)) * 100
                        ));

                        this._oDashModel.setProperty("/leaveBalance", {
                            casualLeave: casual,
                            sickLeave: sick,
                            annualLeave: annual,
                            total,
                            usedPct
                        });
                    })
                    .catch(() => this._loadLeaveBalanceFallback())
                    .finally(() => this._refreshDash());

            }).catch(() => this._loadLeaveBalanceFallback());
        },

        // Fallback if OData not available
        _loadLeaveBalanceFallback() {
            this._callAction("getLeaveBalance").then(oData => {
                const casual = oData.casualLeave || 0;
                const sick = oData.sickLeave || 0;
                const annual = oData.annualLeave || 0;
                const total = casual + sick + annual;
                this._oDashModel.setProperty("/leaveBalance", {
                    casualLeave: casual, sickLeave: sick, annualLeave: annual,
                    total,
                    usedPct: Math.min(100, Math.round((total / 21) * 100))
                });
            }).catch(() => {
                this._oDashModel.setProperty("/leaveBalance",
                    { casualLeave: 0, sickLeave: 0, annualLeave: 0, total: 0, usedPct: 0 });
            }).finally(() => this._refreshDash());
        },

        // ─────────────────────────────────────────────────────────────────────
        // Loaders — new 4
        // ─────────────────────────────────────────────────────────────────────

        // Attendance: frontend-only mock (backend hook ready when needed)
        _loadAttendance() {
            const oComp = this.getOwnerComponent();
            const oEmpModel = oComp.getModel();
            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;

            if (!oEmpModel || !sEmpId) {
                this._loadAttendanceFallback();
                return;
            }

            // Get current month boundaries
            const now = new Date();
            const monthLabel = now.toLocaleString("en-GB", { month: "long" });
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
                .toISOString().split("T")[0];
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
                .toISOString().split("T")[0];

            oEmpModel.bindList("/Attendance", null, null, [
                new sap.ui.model.Filter(
                    "employee_employeeId",
                    sap.ui.model.FilterOperator.EQ,
                    sEmpId
                )
            ], { $$groupId: "$direct" })
                .requestContexts(0, 200)
                .then(aCtx => {
                    const all = aCtx.map(c => c.getObject()).filter(Boolean);
                    console.log("Attendance raw:", all);

                    // Filter to current month
                    const thisMonth = all.filter(a => {
                        const d = a.attendanceDate || a.date || "";
                        return d >= monthStart && d <= monthEnd;
                    });

                    const presentCount = thisMonth.filter(a =>
                        (a.status || "").toLowerCase() === "present" ||
                        a.attendanceTime  // if it has a time it was marked present
                    ).length;

                    // Count working days elapsed this month so far
                    let workingDays = 0;
                    const cur = new Date(monthStart);
                    const today = new Date();
                    today.setHours(23, 59, 59, 0);
                    while (cur <= today) {
                        const day = cur.getDay();
                        if (day !== 0 && day !== 6) workingDays++;
                        cur.setDate(cur.getDate() + 1);
                    }

                    const absentCount = Math.max(0, workingDays - presentCount);
                    const pct = workingDays > 0
                        ? Math.round((presentCount / workingDays) * 100) : 0;

                    this._oDashModel.setProperty("/attendance", {
                        attendancePercentage: pct,
                        presentCount,
                        absentCount,
                        monthLabel
                    });
                })
                .catch(() => this._loadAttendanceFallback())
                .finally(() => this._refreshDash());
        },

        _loadAttendanceFallback() {
            this._callAction("getAttendance")
                .then(oData => {
                    this._oDashModel.setProperty("/attendance", {
                        attendancePercentage: oData.attendancePercentage || 0,
                        presentCount: oData.presentCount || 0,
                        absentCount: oData.absentCount || 0,
                        monthLabel: oData.monthLabel || "Month"
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/attendance", {
                        attendancePercentage: 0,
                        presentCount: 0,
                        absentCount: 0,
                        monthLabel: "Month"
                    });
                })
                .finally(() => this._refreshDash());
        },
        //performance trend 

        _loadPerformanceTrend(iYear) {
            const year = iYear || parseInt(
                this._oDashModel.getProperty("/performanceTrend/selectedYear")
                || new Date().getFullYear(), 10);

            this._callAction("getPerformanceTrend", { year: year })
                .then(oData => {
                    console.log("Performance trend raw:", JSON.stringify(oData));  // ← ADD THIS
                    let months = Array(12).fill(null);
                    try {
                        let raw = [];
                        if (Array.isArray(oData)) {
                            raw = oData;
                        } else if (oData.trendJSON) {
                            raw = JSON.parse(oData.trendJSON);
                        } else if (Array.isArray(oData.months)) {
                            raw = oData.months;
                        }
                        months = raw.map(slot => {
                            if (slot === null || slot === undefined) return null;
                            if (typeof slot === "number") return slot;
                            if (typeof slot === "object" && slot.rating !== undefined) {
                                return parseFloat(slot.rating);
                            }
                            return null;
                        });
                    } catch (e) {
                        months = Array(12).fill(null);
                    }
                    this._oDashModel.setProperty("/performanceTrend/months", months);
                })
                .catch(() => {
                    this._oDashModel.setProperty("/performanceTrend/months",
                        Array(12).fill(null));
                })
                .finally(() => this._refreshDash());
        },
        // Performance Rating

        _loadPerformanceRating() {
            this._callAction("getPerformanceRating")
                .then(oData => {
                    const val = parseFloat(oData.ratingValue || 0);
                    this._oDashModel.setProperty("/performanceRating", {
                        ratingValue: val,
                        ratingCategory: oData.ratingCategory || "N/A",
                        reviewMonth: oData.reviewMonth || 0,
                        reviewYear: oData.reviewYear || 0,
                        reviewComment: oData.reviewComment || ""
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/performanceRating",
                        { ratingValue: 0, ratingCategory: "N/A" });
                })
                .finally(() => this._refreshDash());
        },

        _checkTodayAttendance() {
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

            this._callAction("getTodayAttendance", { attendanceDate: today })
                .then(oData => {
                    if (oData && oData.alreadyMarked) {
                        this._oDashModel.setProperty("/attendanceBtnLabel", "✓ Active");
                        this._oDashModel.setProperty("/attendanceBtnEnabled", false);
                        this._oDashModel.setProperty("/attendanceMarked", true);
                    } else {
                        this._oDashModel.setProperty("/attendanceBtnLabel", "● Mark Active");
                        this._oDashModel.setProperty("/attendanceBtnEnabled", true);
                        this._oDashModel.setProperty("/attendanceMarked", false);
                    }
                })
                .catch(() => {
                    this._oDashModel.setProperty("/attendanceBtnLabel", "● Mark Active");
                    this._oDashModel.setProperty("/attendanceBtnEnabled", true);
                });


        },

        _scheduleAttendanceBtnReset() {
            const now = new Date();
            const resetHour = 23;  // 11 PM
            const resetMinute = 0;

            // Calculate ms until next 11 PM
            let resetTime = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
                resetHour,
                resetMinute,
                0
            );

            // If already past 11 PM today, schedule for tomorrow 11 PM
            if (now >= resetTime) {
                resetTime.setDate(resetTime.getDate() + 1);
            }

            const msUntilReset = resetTime.getTime() - now.getTime();

            // Clear any existing timer
            if (this._attendanceResetTimer) {
                clearTimeout(this._attendanceResetTimer);
            }

            this._attendanceResetTimer = setTimeout(() => {
                // Reset button to "Mark Active"
                this._oDashModel.setProperty("/attendanceBtnLabel", "● Mark Active");
                this._oDashModel.setProperty("/attendanceBtnEnabled", true);
                this._oDashModel.setProperty("/attendanceMarked", false);

                // Schedule again for next day
                this._scheduleAttendanceBtnReset();

            }, msUntilReset);
        },


        // Year selector change
        onTrendYearChange(oEvent) {
            const sYear = oEvent.getSource().getSelectedKey();
            this._oDashModel.setProperty("/performanceTrend/selectedYear", sYear);
            this._loadPerformanceTrend(parseInt(sYear, 10));
        },

        _resyncTasksModel() {
            try {
                const raw = localStorage.getItem("tsTasks");
                if (!raw) return;
                const data = JSON.parse(raw);
                const oModel = this.getOwnerComponent().getModel("tasks");
                if (oModel) oModel.setData(data);
            } catch (e) { /* silent */ }
        },

        // Task Summary (reuses existing TaskMaster backend)
        _loadTaskSummary() {
            // Call the CAP action — reads directly from DB, always fresh
            this._callAction("getTaskSummary")
                .then(oData => {
                    this._oDashModel.setProperty("/taskSummary", {
                        total: oData.total || 0,
                        notStarted: oData.notStarted || 0,
                        inProgress: oData.inProgress || 0,
                        inReview: oData.inReview || 0,
                        completed: oData.completed || 0
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/taskSummary",
                        { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 });
                })
                .finally(() => this._refreshDash());
        },

        // Helper: count statuses and write to model
        _applyTaskSummary(tasks) {
            const n = (s) => (s || "").toLowerCase().trim();

            const notStarted = tasks.filter(t =>
                n(t.status) === "not started" ||
                n(t.status) === "open" ||        // legacy value
                n(t.status) === "pending"        // legacy value
            ).length;
            const inProgress = tasks.filter(t => n(t.status) === "in progress").length;
            const inReview = tasks.filter(t => n(t.status) === "in review").length;
            const completed = tasks.filter(t => n(t.status) === "completed").length;

            this._oDashModel.setProperty("/taskSummary", {
                total: tasks.length,
                notStarted,
                inProgress,
                inReview,
                completed
            });
            this._refreshDash();
        },

        _loadTaskSummaryFallback() {
            this._callAction("getTaskSummary")
                .then(oData => {
                    this._oDashModel.setProperty("/taskSummary", {
                        total: oData.total || 0,
                        notStarted: oData.notStarted || 0,
                        inProgress: oData.inProgress || 0,
                        inReview: oData.inReview || 0,
                        completed: oData.completed || 0
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/taskSummary",
                        { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 });
                })
                .finally(() => this._refreshDash());
        },


        // ── REPLACE _loadMyTasks() ────────────────────────────────────────────────────
        _loadMyTasks() {
            // Call the CAP action — reads directly from DB
            this._callAction("getMyTasks")
                .then(oData => {
                    this._oDashModel.setProperty("/myTasks", {
                        totalPending: oData.totalPending || 0,
                        highPriorityCount: oData.highPriorityCount || 0,
                        mediumPriorityCount: oData.mediumPriorityCount || 0,
                        lowPriorityCount: oData.lowPriorityCount || 0
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/myTasks",
                        { totalPending: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0 });
                })
                .finally(() => this._refreshDash());
        },

        // Helper: pending counts by priority
        _applyMyTasks(tasks) {
            const n = (s) => (s || "").toLowerCase().trim();
            const pending = tasks.filter(t => n(t.status) !== "completed");

            this._oDashModel.setProperty("/myTasks", {
                totalPending: pending.length,
                highPriorityCount: pending.filter(t => n(t.priority) === "high").length,
                mediumPriorityCount: pending.filter(t => n(t.priority) === "medium").length,
                lowPriorityCount: pending.filter(t => n(t.priority) === "low").length
            });
            this._refreshDash();
        },

        _loadMyTasksFallback() {
            this._callAction("getMyTasks")
                .then(oData => {
                    this._oDashModel.setProperty("/myTasks", {
                        totalPending: oData.totalPending || 0,
                        highPriorityCount: oData.highPriorityCount || 0,
                        mediumPriorityCount: oData.mediumPriorityCount || 0,
                        lowPriorityCount: oData.lowPriorityCount || 0
                    });
                })
                .catch(() => {
                    this._oDashModel.setProperty("/myTasks",
                        { totalPending: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0 });
                })
                .finally(() => this._refreshDash());
        },

        // ── Leave Overview ────────────────────────────────────────────────────────
        _loadLeaveOverview(iYear) {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            const year = iYear || new Date().getFullYear();
            oModel.callFunction("/getLeaveOverview", {
                method: "POST",
                urlParameters: { year },
                success: (oData) => {
                    let takenData = [];
                    try { takenData = JSON.parse(oData.takenJSON || "[]"); } catch (e) { /**/ }
                    this._oDashModel.setProperty("/leaveOverview", {
                        casual: oData.casual || 0,
                        sick: oData.sick || 0,
                        annual: oData.annual || 0,
                        unpaid: oData.unpaid || 0,
                        totalDays: oData.totalDays || 0,
                        takenData
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/leaveOverview",
                        { casual: 0, sick: 0, annual: 0, unpaid: 0, totalDays: 0, takenData: [] });
                    this._refreshDash();
                }
            });
        },

        // ── Upcoming Calendar ─────────────────────────────────────────────────────
        _loadUpcomingCalendar() {
            this._callAction("getUpcomingCalendar", {})
                .then(oData => {
                    let events = [];
                    try {
                        if (Array.isArray(oData)) {
                            events = oData;
                        } else if (oData.eventsJSON) {
                            events = JSON.parse(oData.eventsJSON);
                        } else if (Array.isArray(oData.value)) {
                            events = oData.value;
                        }
                    } catch (e) {
                        events = [];
                    }
                    this._oDashModel.setProperty("/upcomingCalendar/events", events);
                })
                .catch(() => {
                    this._oDashModel.setProperty("/upcomingCalendar/events", []);
                })
                .finally(() => this._refreshDash());
        },

        // ── Recent Notifications ──────────────────────────────────────────────────
        _loadRecentNotifications() {
            const oComp = this.getOwnerComponent();
            const oMgrModel = oComp.getModel("manager");
            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;

            if (!oMgrModel || !sEmpId) {
                this._loadNotificationsFallback();
                return;
            }

            oMgrModel.getMetaModel().requestObject("/Notifications").then(() => {

                oMgrModel.bindList("/Notifications", null, null, null, {
                    $$groupId: "$direct"
                })
                    .requestContexts(0, 50)
                    .then(aCtx => {
                        let all = aCtx.map(c => c.getObject()).filter(Boolean);
                        console.log("Notifications all:", all);

                        let mine = all.filter(n =>
                            n.employee_employeeId === sEmpId ||
                            n.employeeId === sEmpId ||
                            n.recipientId === sEmpId ||
                            n.employee_ID === sEmpId
                        );

                        if (mine.length === 0 && all.length > 0) mine = all;

                        mine.sort((a, b) =>
                            new Date(b.notifiedAt || b.createdAt || 0) -
                            new Date(a.notifiedAt || a.createdAt || 0)
                        );

                        const items = mine.slice(0, 5).map(n => ({
                            type: n.type || "DEFAULT",
                            title: n.title || "Notification",
                            message: n.message || "",
                            notifiedAt: n.notifiedAt || n.createdAt || null,
                            isRead: n.isRead || false
                        }));

                        this._oDashModel.setProperty("/recentNotifications/items", items);
                    })
                    .catch(() => this._loadNotificationsFallback())
                    .finally(() => this._refreshDash());

            }).catch(() => this._loadNotificationsFallback());
        },

        _loadNotificationsFallback() {
            this._callAction("getRecentNotifications", {})
                .then(oData => {
                    let items = [];
                    if (Array.isArray(oData)) {
                        items = oData;
                    } else if (Array.isArray(oData?.value)) {
                        items = oData.value;
                    } else if (oData.itemsJSON) {
                        try { items = JSON.parse(oData.itemsJSON); } catch (e) { items = []; }
                    }
                    this._oDashModel.setProperty("/recentNotifications/items", items);
                })
                .catch(() => {
                    this._oDashModel.setProperty("/recentNotifications/items", []);
                })
                .finally(() => this._refreshDash());
        },

        // ─────────────────────────────────────────────────────────────────────
        // _refreshDash — reads ALL model data, rebuilds the full HTML grid
        // This is the ONLY place dashGridHTML is written to.
        // ─────────────────────────────────────────────────────────────────────
        _refreshDash() {
            const m = this._oDashModel;
            this._oDashModel.setProperty("/dashGridHTML", this._buildDashGridHTML({
                // timesheet stats
                approved: m.getProperty("/approved") || 0,
                pending: m.getProperty("/pending") || 0,
                rejected: m.getProperty("/rejected") || 0,
                pct: m.getProperty("/completion/pct") || 0,
                hint: m.getProperty("/completion/hint") || "",
                label: m.getProperty("/completion/label") || "",
                weekLabel: m.getProperty("/weekLabel") || "",
                barHTML: m.getProperty("/barChartHTML") || "",
                // card data
                anniv: m.getProperty("/workAnniversary") || {},
                leave: m.getProperty("/leaveBalance") || {},
                tasks: m.getProperty("/myTasks") || {},
                attend: m.getProperty("/attendance") || {},
                perf: m.getProperty("/performanceRating") || {},
                trend: m.getProperty("/performanceTrend") || {},
                summary: m.getProperty("/taskSummary") || {},
                leaveOv: m.getProperty("/leaveOverview") || {},
                calendar: m.getProperty("/upcomingCalendar/events") || [],
                notifs: m.getProperty("/recentNotifications/items") || [],
            }));
        },

        // ─────────────────────────────────────────────────────────────────────
        // _buildDashGridHTML — produces the complete dashboard HTML string
        // Layout:
        //   Row 1 : 5 info cards (Anniversary, Leave, Tasks, Attendance, Rating)
        //   Row 2 : Timesheet pie  +  Week completion
        //   Row 3 : Daily hours bar chart
        //   Row 4 : Performance trend line  +  Task summary donut
        // ─────────────────────────────────────────────────────────────────────
        _buildDashGridHTML(o) {

            // ── card helpers ─────────────────────────────────────────────────
            // Each KPI tile gets a category class (tsDashTile-anniv, -leave, etc.)
            // so style.css can apply a soft category-coloured gradient background.
            const card = (body, klass) =>
                `<div class="tsDashTile ${klass || ''}" style="flex:1;min-width:0;border-radius:12px;
                             box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;
                             box-sizing:border-box;">${body}</div>`;

            const cardHeader = (title, iconSvg) =>
                `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-size:0.95rem;font-weight:600;color:#111827;">${title}</span>
                    ${iconSvg}
                 </div>`;

            const bigNum = (val, color) =>
                `<div style="font-size:2.1rem;font-weight:700;color:${color};line-height:1.1;margin-bottom:2px;">${val}</div>`;

            const subLabel = (txt) =>
                `<div style="font-size:0.8rem;color:#6b7280;margin-bottom:10px;">${txt}</div>`;

            // ── SVG icon snippets ────────────────────────────────────────────
            const iconCircle = (bg, stroke, path) =>
                `<span style="width:34px;height:34px;border-radius:50%;background:${bg};
                              display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${path}
                    </svg>
                 </span>`;






            // ── 1. Work Anniversary ──────────────────────────────────────────
            const anniv = o.anniv || {};
            const yearsLabel = anniv.yearsLabel || "—";
            const annexMsg = anniv.message || "Welcome!";
            const joinedTxt = anniv.joiningDate ? "Joined: " + anniv.joiningDate : "";

            const sAnnivCard = card(`
                ${cardHeader("Work Anniversary",
                iconCircle("#eff6ff", "#3b82f6",
                    '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>'))}
                ${bigNum(yearsLabel, "#111827")}
                <div style="font-size:0.8rem;color:#6b7280;margin-bottom:6px;">with the organization</div>
                <div style="font-size:0.75rem;color:#9ca3af;">${joinedTxt}</div>
                <div style="font-size:0.75rem;color:#6b7280;margin-top:8px;font-style:italic;">${annexMsg}</div>
            `, "tsDashTile-anniv");

            // ── 2. Leave Balance ─────────────────────────────────────────────
            const leave = o.leave || {};
            const casual = leave.casualLeave !== undefined ? leave.casualLeave : 0;
            const sick = leave.sickLeave !== undefined ? leave.sickLeave : 0;
            const annual = leave.annualLeave !== undefined ? leave.annualLeave : 0;
            const lTotal = leave.total !== undefined ? leave.total : 0;
            const lPct = leave.usedPct !== undefined ? leave.usedPct : 0;

            const sLeaveCard = card(`
                ${cardHeader("Leave Balance",
                iconCircle("#ecfdf5", "#10b981",
                    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'))}
                ${bigNum(lTotal, "#10b981")}
                ${subLabel("Days Available")}
                <div style="width:100%;height:7px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:10px;">
                    <div style="width:${lPct}%;height:100%;background:#10b981;border-radius:4px;"></div>
                </div>
                <div style="font-size:0.78rem;color:#6b7280;display:flex;gap:8px;">
                    <span>Casual: <b style="color:#374151;">${casual}</b></span>
                    <span style="color:#d1d5db;">|</span>
                    <span>Sick: <b style="color:#374151;">${sick}</b></span>
                    <span style="color:#d1d5db;">|</span>
                    <span> Paid: <b style="color:#374151;">${annual}</b></span>
                </div>
            `, "tsDashTile-leave");

            // ── 3. My Tasks ──────────────────────────────────────────────────
            const tasks = o.tasks || {};
            const tPending = tasks.totalPending !== undefined ? tasks.totalPending : 0;
            const tHigh = tasks.highPriorityCount !== undefined ? tasks.highPriorityCount : 0;
            const tMedium = tasks.mediumPriorityCount !== undefined ? tasks.mediumPriorityCount : 0;
            const tLow = tasks.lowPriorityCount !== undefined ? tasks.lowPriorityCount : 0;

            const sTasksCard = card(`
    ${cardHeader("My Tasks",
                iconCircle("#fffbeb", "#f59e0b",
                    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'))}
    ${bigNum(tPending, "#111827")}
    ${subLabel("Tasks Pending")}
    <div style="font-size:0.78rem;display:flex;flex-direction:column;gap:6px;margin-top:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0;"></span>
                <span style="color:#6b7280;">High Priority</span>
            </div>
            <b style="color:#dc2626;">${tHigh}</b>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span>
                <span style="color:#6b7280;">Medium Priority</span>
            </div>
            <b style="color:#f59e0b;">${tMedium}</b>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:#16a34a;flex-shrink:0;"></span>
                <span style="color:#6b7280;">Low Priority</span>
            </div>
            <b style="color:#16a34a;">${tLow}</b>
        </div>
    </div>
`, "tsDashTile-tasks");

            // ── 4. Attendance ────────────────────────────────────────────────
            const attend = o.attend || {};
            const attPct = attend.attendancePercentage !== undefined ? attend.attendancePercentage : 0;
            const present = attend.presentCount !== undefined ? attend.presentCount : 0;
            const absent = attend.absentCount !== undefined ? attend.absentCount : 0;
            const attMon = attend.monthLabel || "Month";

            const sAttendCard = card(`
                ${cardHeader("Attendance",
                iconCircle("#eff6ff", "#3b82f6",
                    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><path d="M9 14l2 2 4-4"/>'))}
                ${bigNum(attPct + "%", "#16a34a")}
                ${subLabel("This " + attMon)}
                <div style="border-top:1px solid #f3f4f6;padding-top:10px;
                            font-size:0.78rem;color:#6b7280;display:flex;gap:16px;align-items:center;">
                    <span>
                        <span style="color:#16a34a;font-weight:700;margin-right:2px;">✓</span>
                        Present : <b style="color:#111827;">${present}</b>
                    </span>
                    <span style="color:#e5e7eb;">|</span>
                    <span>
                        <span style="color:#dc2626;font-weight:700;margin-right:2px;">✕</span>
                        Absent : <b style="color:#111827;">${absent}</b>
                    </span>
                </div>
            `, "tsDashTile-attendance");

            // ── 5. Performance Rating ────────────────────────────────────────
            const perf = o.perf || {};
            const rVal = parseFloat(perf.ratingValue || 0);
            const rCat = perf.ratingCategory || "N/A";
            const rColor = rVal >= 4.5 ? "#16a34a" : rVal >= 3.5 ? "#3b82f6" : rVal >= 2.5 ? "#f59e0b" : "#dc2626";

            // Build star HTML inline (no separate helper needed)
            const fullStars = Math.floor(rVal);
            const hasHalf = (rVal - fullStars) >= 0.25 && (rVal - fullStars) < 0.75;
            const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
            let starsHTML = '<div style="display:flex;gap:3px;margin:6px 0;">';
            for (let i = 0; i < fullStars; i++) starsHTML += '<span style="font-size:1.2rem;color:#f59e0b;">★</span>';
            if (hasHalf) starsHTML += '<span style="font-size:1.2rem;color:#f59e0b;">½</span>';
            for (let i = 0; i < emptyStars; i++) starsHTML += '<span style="font-size:1.2rem;color:#d1d5db;">★</span>';
            starsHTML += '</div>';

            const sPerfCard = card(`
                ${cardHeader("Performance Rating",
                iconCircle("#fffbeb", "#f59e0b",
                    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'))}
                <div style="display:flex;align-items:baseline;gap:4px;margin:4px 0 2px;">
                    <span style="font-size:2.1rem;font-weight:700;color:#111827;line-height:1;">${rVal.toFixed(1)}</span>
                    <span style="font-size:1rem;color:#9ca3af;">/5</span>
                </div>
                ${starsHTML}
                <div style="font-size:0.88rem;font-weight:600;color:${rColor};margin-top:4px;">${rCat}</div>
            `, "tsDashTile-perf");

            // ── Row 1: 5 cards ───────────────────────────────────────────────
            const sRow1 = `
                <div style="display:flex;flex-direction:row;gap:1rem;width:100%;box-sizing:border-box;">
                    ${sAnnivCard}
                    ${sLeaveCard}
                    ${sTasksCard}
                    ${sAttendCard}
                    ${sPerfCard}
                </div>`;

            // ── Row 2: Pie + Week Completion ─────────────────────────────────
            const iTotal = o.approved + o.pending + o.rejected;
            const r = 54, cx = 70, cy = 70;
            const circ = 2 * Math.PI * r;
            const dA = ((o.approved / (iTotal || 1)) * circ).toFixed(2);
            const dP = ((o.pending / (iTotal || 1)) * circ).toFixed(2);
            const dR = ((o.rejected / (iTotal || 1)) * circ).toFixed(2);
            const oA = 0;
            const oP = -((o.approved / (iTotal || 1)) * circ);
            const oR = -(((o.approved + o.pending) / (iTotal || 1)) * circ);

            const segs = iTotal === 0
                ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="14"/>`
                : [
                    o.approved > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#16a34a" stroke-width="14" stroke-dasharray="${dA} ${circ}" stroke-dashoffset="${oA}" transform="rotate(-90 ${cx} ${cy})"/>` : "",
                    o.pending > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f59e0b" stroke-width="14" stroke-dasharray="${dP} ${circ}" stroke-dashoffset="${oP}" transform="rotate(-90 ${cx} ${cy})"/>` : "",
                    o.rejected > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#dc2626" stroke-width="14" stroke-dasharray="${dR} ${circ}" stroke-dashoffset="${oR}" transform="rotate(-90 ${cx} ${cy})"/>` : ""
                ].join("");


            // ── Row 3: Bar chart ─────────────────────────────────────────────
            const sRow3 = `
    <div style="width:100%;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;">
        <div style="padding:12px 18px 8px;border-bottom:1px solid #f3f4f6;
                    display:flex;align-items:center;justify-content:space-between;">
            <div>
                <div style="font-size:0.95rem;font-weight:600;color:#111827;">Daily Hours Breakdown</div>
                <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">${o.weekLabel}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <button onclick="sap.ui.getCore().byId('${this.getView().getId()}').getController().onPrevWeek()"
                        style="border:1px solid #e5e7eb;background:#fff;border-radius:8px;
                               padding:5px 10px;cursor:pointer;font-size:0.8rem;color:#374151;
                               display:flex;align-items:center;gap:4px;">&#8249;</button>
                <button onclick="sap.ui.getCore().byId('${this.getView().getId()}').getController().onToday()"
                        style="border:1px solid #e5e7eb;background:#fff;border-radius:8px;
                               padding:5px 12px;cursor:pointer;font-size:0.78rem;color:#374151;">
                    Today
                </button>
                <button onclick="sap.ui.getCore().byId('${this.getView().getId()}').getController().onNextWeek()"
                        style="border:1px solid #e5e7eb;background:#fff;border-radius:8px;
                               padding:5px 10px;cursor:pointer;font-size:0.8rem;color:#374151;
                               display:flex;align-items:center;gap:4px;">&#8250;</button>
            </div>
        </div>
        <div style="padding:4px 0 0;overflow:hidden;">${o.barHTML}</div>
    </div>`;

            // ── Row 4: Trend + Donut ─────────────────────────────────────────

            // Performance Trend line chart
            const trend = o.trend || {};
            const trendMonths = Array.isArray(trend.months) ? trend.months : Array(12).fill(null);
            const trendYear = trend.selectedYear || String(new Date().getFullYear());

            const W = 440, H = 155, PL = 32, PR = 10, PT = 14, PB = 20;
            const CW = W - PL - PR, CH = H - PT - PB;
            const xOf = (i) => PL + (i / 11) * CW;
            const yOf = (v) => PT + CH - ((v - 1) / 4) * CH;   // scale 1-5

            let tGrid = "";
            [1, 2, 3, 4, 5].forEach(v => {
                const gy = yOf(v);
                tGrid += `<line x1="${PL}" y1="${gy}" x2="${W - PR}" y2="${gy}" stroke="#f3f4f6" stroke-width="1"/>`;
                tGrid += `<text x="${PL - 4}" y="${gy + 4}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="sans-serif">${v}.0</text>`;
            });

            let tXLabels = "";
            MONTHS.forEach((mn, i) => {
                tXLabels += `<text x="${xOf(i)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="sans-serif">${mn}</text>`;
            });

            const tPoints = trendMonths
                .map((v, i) => {
                    const num = parseFloat(v);
                    return (!isNaN(num) && num > 0) ? { x: xOf(i), y: yOf(num) } : null;
                })
                .filter(Boolean);

            let tPath = "", tArea = "", tDots = "";
            if (tPoints.length > 1) {
                const ptStr = tPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                tPath = `<polyline points="${ptStr}" fill="none" stroke="#3b82f6" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
                const base = PT + CH;
                const areaPts = [`${tPoints[0].x.toFixed(1)},${base}`,
                ...tPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
                `${tPoints[tPoints.length - 1].x.toFixed(1)},${base}`].join(" ");
                tArea = `<polygon points="${areaPts}" fill="rgba(59,130,246,0.08)" stroke="none"/>`;
                tDots = tPoints.map(p =>
                    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#fff" stroke="#3b82f6" stroke-width="2"/>`
                ).join("");
            } else {
                tPath = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#d1d5db" font-family="sans-serif">No data for ${trendYear}</text>`;
            }

            // Year pill options
            const curYear = new Date().getFullYear();
            const yearPills = [curYear - 2, curYear - 1, curYear].map(y =>
                `<span onclick="sap.ui.getCore().byId('${this.getView().getId()}').getController().onTrendYearChange({getSource:()=>({getSelectedKey:()=>'${y}'})})"
                      style="padding:3px 10px;border-radius:12px;font-size:0.75rem;cursor:pointer;
                             background:${String(y) === trendYear ? '#3b82f6' : '#f3f4f6'};
                             color:${String(y) === trendYear ? '#fff' : '#6b7280'};">
                    ${y === curYear ? 'This Year' : y}
                 </span>`
            ).join("");

            const sTrend = `
                <div class="tsDashTile" style="flex:1.4;min-width:0;background:#fff;border-radius:12px;
                            box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                        <span style="font-size:0.95rem;font-weight:600;color:#111827;">My Performance Trend</span>
                        <div style="display:flex;gap:6px;">${yearPills}</div>
                    </div>
                    <div style="width:100%;overflow-x:auto;">
                        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible;">
                            ${tGrid}${tArea}${tPath}${tDots}${tXLabels}
                        </svg>
                    </div>
                </div>`;

            // Task Summary donut
            const sum = o.summary || {};
            const sTotal = sum.total || 0;
            const sNS = sum.notStarted || 0;
            const sIP = sum.inProgress || 0;
            const sIR = sum.inReview || 0;
            const sCom = sum.completed || 0;
            const safe = sTotal || 1;
            const sPct = (n) => sTotal ? Math.round((n / sTotal) * 100) + "%" : "0%";

            const dCirc = 2 * Math.PI * 54;
            const segs2 = [
                { val: sNS, color: "#9ca3af" },
                { val: sIP, color: "#f59e0b" },
                { val: sIR, color: "#3b82f6" },
                { val: sCom, color: "#16a34a" }
            ];
            let arcHTML = "", dOffset = 0;
            if (sTotal === 0) {
                arcHTML = `<circle cx="70" cy="70" r="54" fill="none" stroke="#e5e7eb" stroke-width="14"/>`;
            } else {
                segs2.forEach(seg => {
                    if (seg.val <= 0) return;
                    const dash = ((seg.val / safe) * dCirc).toFixed(2);
                    arcHTML += `<circle cx="70" cy="70" r="54" fill="none" stroke="${seg.color}"
                                        stroke-width="14"
                                        stroke-dasharray="${dash} ${dCirc}"
                                        stroke-dashoffset="${-dOffset}"
                                        transform="rotate(-90 70 70)"/>`;
                    dOffset += parseFloat(dash);
                });
            }

            const legendRow = (color, label, val) =>
                `<div style="display:flex;align-items:center;justify-content:space-between;
                             padding:5px 0;border-bottom:1px solid #f9fafb;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                        <span style="font-size:0.8rem;color:#374151;">${label}</span>
                    </div>
                    <span style="font-size:0.8rem;font-weight:600;color:#111827;white-space:nowrap;margin-left:8px;">
                        ${val} (${sPct(val)})
                    </span>
                 </div>`;

            const sDonut = `
                <div style="flex:1;min-width:0;background:#fff;border-radius:12px;
                            box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
                    <div style="font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:14px;">Task Summary</div>
                    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                        <svg width="140" height="140" viewBox="0 0 140 140" style="flex-shrink:0;">
                            <circle cx="70" cy="70" r="54" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                            ${arcHTML}
                            <text x="70" y="65" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${sTotal}</text>
                            <text x="70" y="83" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="sans-serif">Total Tasks</text>
                        </svg>
                        <div style="flex:1;min-width:150px;">
                            ${legendRow("#9ca3af", "Not Started", sNS)}
                            ${legendRow("#f59e0b", "In Progress", sIP)}
                            ${legendRow("#3b82f6", "In Review", sIR)}
                            ${legendRow("#16a34a", "Completed", sCom)}
                        </div>
                    </div>
                </div>`;

            // Combined right column: Task Summary on top + Total Timesheets below
            const sRightCol = `
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1rem;">

        <!-- Task Summary donut -->
        <div class="tsDashTile" style="background:#fff;border-radius:12px;
                    box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
            <div style="font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:14px;">Task Summary</div>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                <svg width="120" height="120" viewBox="0 0 140 140" style="flex-shrink:0;">
                    <circle cx="70" cy="70" r="54" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                    ${arcHTML}
                    <text x="70" y="65" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${sTotal}</text>
                    <text x="70" y="83" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="sans-serif">Total Tasks</text>
                </svg>
                <div style="flex:1;min-width:120px;">
                    ${legendRow("#9ca3af", "Not Started", sNS)}
                    ${legendRow("#f59e0b", "In Progress", sIP)}
                    ${legendRow("#3b82f6", "In Review", sIR)}
                    ${legendRow("#16a34a", "Completed", sCom)}
                </div>
            </div>
        </div>

        <!-- Total Timesheets pie -->
<div class="tsDashTile" style="background:#fff;border-radius:12px;flex:1;
            box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;
            box-sizing:border-box;display:flex;flex-direction:column;">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
            <div style="font-size:0.95rem;font-weight:600;color:#111827;">Total Timesheets</div>
            <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">All time submissions</div>
        </div>
    </div>

    <!-- Donut + Legend -->
    <div style="display:flex;align-items:center;gap:24px;flex:1;">

        <!-- Donut -->
        <div style="display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="160" height="160" viewBox="0 0 140 140" style="display:block;">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                ${segs}
                <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="22"
                      font-weight="700" fill="#111827">${iTotal}</text>
                <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9"
                      fill="#9ca3af" font-family="sans-serif">submitted</text>
            </svg>
        </div>

        <!-- Legend -->
        <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;height:140px;">
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:8px 0;border-bottom:1px solid #f3f4f6;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="width:11px;height:11px;border-radius:50%;
                                 background:#16a34a;flex-shrink:0;"></span>
                    <span style="font-size:0.85rem;color:#374151;">Approved</span>
                </div>
                <b style="font-size:0.85rem;color:#111827;">${o.approved}</b>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:8px 0;border-bottom:1px solid #f3f4f6;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="width:11px;height:11px;border-radius:50%;
                                 background:#f59e0b;flex-shrink:0;"></span>
                    <span style="font-size:0.85rem;color:#374151;">Pending</span>
                </div>
                <b style="font-size:0.85rem;color:#111827;">${o.pending}</b>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:8px 0;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="width:11px;height:11px;border-radius:50%;
                                 background:#dc2626;flex-shrink:0;"></span>
                    <span style="font-size:0.85rem;color:#374151;">Rejected</span>
                </div>
                <b style="font-size:0.85rem;color:#111827;">${o.rejected}</b>
            </div>
        </div>

    </div>
</div>

    </div>`;

            const sRow4 = `
    <div style="display:flex;flex-direction:row;gap:1rem;width:100%;box-sizing:border-box;">
        ${sTrend}
        ${sRightCol}
    </div>`;

            // ── Row 5: Leave Overview | Upcoming Calendar | Recent Notifications ──────

            // ── Leave Overview donut ─────────────────────────────────────────────────
            const lov = o.leaveOv || {};
            const lovTotal = (lov.casual || 0) + (lov.sick || 0) + (lov.annual || 0) + (lov.unpaid || 0);
            const lovSafe = lovTotal || 1;
            const lovData = Array.isArray(lov.takenData) ? lov.takenData : [
                { type: 'casual', label: 'Casual Leave', balance: lov.casual || 0, color: '#16a34a' },
                { type: 'sick', label: 'Sick Leave', balance: lov.sick || 0, color: '#3b82f6' },
                { type: 'annual', label: 'Annual Leave', balance: lov.annual || 0, color: '#f59e0b' },
                { type: 'unpaid', label: 'Unpaid Leave', balance: lov.unpaid || 0, color: '#9ca3af' }
            ];

            // Build donut arcs from balance values
            const lovCirc = 2 * Math.PI * 46;
            let lovArcs = "", lovOffset = 0;
            if (lovTotal === 0) {
                lovArcs = `<circle cx="60" cy="60" r="46" fill="none" stroke="#e5e7eb" stroke-width="12"/>`;
            } else {
                lovData.forEach(seg => {
                    const val = seg.balance || 0;
                    if (val <= 0) return;
                    const dash = ((val / lovSafe) * lovCirc).toFixed(2);
                    lovArcs += `<circle cx="60" cy="60" r="46" fill="none"
                            stroke="${seg.color}" stroke-width="12"
                            stroke-dasharray="${dash} ${lovCirc}"
                            stroke-dashoffset="${-lovOffset}"
                            transform="rotate(-90 60 60)"/>`;
                    lovOffset += parseFloat(dash);
                });
            }

            const lovLegend = lovData.map(seg => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:5px 0;border-bottom:1px solid #f9fafb;">
        <div style="display:flex;align-items:center;gap:7px;">
            <span style="width:9px;height:9px;border-radius:50%;
                         background:${seg.color};flex-shrink:0;"></span>
            <span style="font-size:0.78rem;color:#374151;">${seg.label}</span>
        </div>
        <span style="font-size:0.78rem;font-weight:600;color:#111827;
                     white-space:nowrap;margin-left:8px;">${seg.balance} Days</span>
    </div>`).join("");

            const sLeaveOverview = `
    <div style="flex:1;min-width:0;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <span style="font-size:0.95rem;font-weight:600;color:#111827;">My Leave Overview</span>
            <span style="font-size:0.75rem;color:#9ca3af;">This Year</span>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <svg width="120" height="120" viewBox="0 0 120 120" style="flex-shrink:0;">
                <circle cx="60" cy="60" r="46" fill="none" stroke="#f3f4f6" stroke-width="12"/>
                ${lovArcs}
                <text x="60" y="55" text-anchor="middle" font-size="18"
                      font-weight="700" fill="#111827">${lovTotal}</text>
                <text x="60" y="72" text-anchor="middle" font-size="9"
                      fill="#9ca3af" font-family="sans-serif">Total Days</text>
            </svg>
            <div style="flex:1;min-width:120px;">${lovLegend}</div>
        </div>
    </div>`;

            // ── Upcoming Calendar ─────────────────────────────────────────────────────
            const calEvents = Array.isArray(o.calendar) ? o.calendar : [];

            // Icon per event — rotate through 4 colours matching reference image
            const CAL_COLORS = ["#3b82f6", "#f59e0b", "#16a34a", "#8b5cf6"];
            const calRows = calEvents.length === 0
                ? `<div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:0.82rem;">
           No upcoming events in the next 7 days
       </div>`
                : calEvents.map((ev, i) => {
                    const col = CAL_COLORS[i % CAL_COLORS.length];
                    const iconPaths = [
                        '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',  // team
                        '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',  // screen
                        '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>',  // person
                        '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'  // calendar
                    ];
                    return `
        <div style="display:flex;align-items:flex-start;gap:12px;
                    padding:10px 0;border-bottom:1px solid #f9fafb;">
            <span style="width:34px;height:34px;border-radius:50%;
                         background:${col}18;display:flex;align-items:center;
                         justify-content:center;flex-shrink:0;margin-top:1px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${iconPaths[i % iconPaths.length]}
                </svg>
            </span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.82rem;font-weight:600;color:#111827;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${ev.title}
                </div>
                <div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">
                    ${ev.dateLabel}, ${ev.timeLabel}
                </div>
            </div>
        </div>`;
                }).join("");

            const sCalendar = `
    <div class="tsDashTile" style="flex:1;min-width:0;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:0.95rem;font-weight:600;color:#111827;">Upcoming Calendar</span>
            <span style="font-size:0.75rem;color:#3b82f6;cursor:pointer;">View Calendar</span>
        </div>
        ${calRows}
    </div>`;

            // ── Recent Notifications ──────────────────────────────────────────────────
            const notifItems = Array.isArray(o.notifs) ? o.notifs : [];

            // Icon + colour map per notification type
            const NOTIF_META = {
                TIMESHEET_APPROVED: {
                    color: '#16a34a', bg: '#f0fdf4',
                    icon: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                },
                TIMESHEET_REJECTED: {
                    color: '#dc2626', bg: '#fef2f2',
                    icon: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
                },
                TASK_ASSIGNED: {
                    color: '#f59e0b', bg: '#fffbeb',
                    icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'
                },
                PERFORMANCE_RATED: {
                    color: '#8b5cf6', bg: '#f5f3ff',
                    icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
                },
                LEAVE_APPROVED: {
                    color: '#3b82f6', bg: '#eff6ff',
                    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><path d="M9 14l2 2 4-4"/>'
                },
                LEAVE_REJECTED: {
                    color: '#dc2626', bg: '#fef2f2',
                    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="9" y1="14" x2="15" y2="14"/>'
                },
                DEFAULT: {
                    color: '#6b7280', bg: '#f9fafb',
                    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
                }
            };

            const _timeAgo = (isoStr) => {
                if (!isoStr) return '';
                const diff = Date.now() - new Date(isoStr).getTime();
                const mins = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                if (mins < 1) return 'Just now';
                if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
                if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
                return `${days} day${days !== 1 ? 's' : ''} ago`;
            };

            const notifRows = notifItems.length === 0
                ? `<div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:0.82rem;">
           No notifications yet
       </div>`
                : notifItems.map(n => {
                    const meta = NOTIF_META[n.type] || NOTIF_META.DEFAULT;
                    return `
        <div style="display:flex;align-items:flex-start;gap:12px;
                    padding:10px 0;border-bottom:1px solid #f9fafb;
                    opacity:${n.isRead ? '0.65' : '1'};">
            <span style="width:34px;height:34px;border-radius:50%;
                         background:${meta.bg};display:flex;align-items:center;
                         justify-content:center;flex-shrink:0;margin-top:1px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="${meta.color}" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                    ${meta.icon}
                </svg>
            </span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.82rem;font-weight:${n.isRead ? '400' : '600'};
                            color:#111827;line-height:1.35;">
                    ${n.title}
                </div>
                <div style="font-size:0.75rem;color:#6b7280;margin-top:2px;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${n.message}
                </div>
                <div style="font-size:0.72rem;color:#9ca3af;margin-top:3px;">
                    ${_timeAgo(n.notifiedAt)}
                </div>
            </div>
            ${!n.isRead
                            ? `<span style="width:7px;height:7px;border-radius:50%;
                               background:#3b82f6;flex-shrink:0;margin-top:6px;"></span>`
                            : ''}
        </div>`;
                }).join("");

            const sNotifications = `
    <div class="tsDashTile" style="flex:1;min-width:0;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:0.95rem;font-weight:600;color:#111827;">Recent Notifications</span>
            <span onclick="sap.ui.getCore().byId('${this.getView().getId()}').getController()._viewAllNotifications()"
      style="font-size:0.75rem;color:#3b82f6;cursor:pointer;">View All</span>
        </div>
        ${notifRows}
    </div>`;

            const sRow5 = `
<div style="display:flex;flex-direction:row;gap:1rem;
            width:100%;box-sizing:border-box;">
    ${sCalendar}
    ${sNotifications}
</div>`;

            // ── Row 2: Bar Chart (left) | Week Completion + Leave Overview (right) ──
            // Auto-compute current week Mon–Fri label
            const now = new Date();
            const dow = now.getDay();                     // 0=Sun,1=Mon,...6=Sat
            const diff = dow === 0 ? -6 : 1 - dow;        // shift back to Monday
            const mon = new Date(now); mon.setDate(now.getDate() + diff);
            const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
            const _fmt = (d) => d.getDate() + " " +
                ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
            const autoWeekLabel = `${_fmt(mon)} – ${_fmt(fri)}`;
            const sRow2 = `
<div style="display:flex;flex-direction:row;gap:1rem;width:100%;box-sizing:border-box;">

    <!-- Left: Daily Hours Bar Chart -->
    <div class="tsDashTile" style="flex:1.4;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;">
        <div style="padding:14px 18px 10px;border-bottom:1px solid #f3f4f6;">
            <div style="font-size:0.95rem;font-weight:600;color:#111827;">Daily Hours Breakdown</div>
            <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">${autoWeekLabel}</div>
        </div>
        <div style="padding:4px 0 0;overflow:hidden;">${o.barHTML}</div>
    </div>

    <!-- Right: Week Completion on top + My Leave Overview below -->
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1rem;">

        <!-- Week Completion -->
        <div class="tsDashTile" style="background:#fff;border-radius:12px;
                    box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;">
            <div style="padding:14px 18px 6px;border-bottom:1px solid #f3f4f6;">
                <div style="font-size:0.95rem;font-weight:600;color:#111827;">Week Completion</div>
                <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">${o.label}</div>
                <div style="font-size:2.2rem;font-weight:700;color:#111827;line-height:1.2;margin-top:6px;">
                    ${o.pct} <span style="font-size:0.9rem;font-weight:400;color:#6b7280;">%</span>
                </div>
            </div>
            <div style="padding:12px 18px 16px;display:flex;flex-direction:column;gap:8px;">
                <div style="width:100%;height:12px;background:#e5e7eb;border-radius:6px;overflow:hidden;">
                    <div style="width:${o.pct}%;height:100%;background:#3b82f6;border-radius:6px;transition:width 0.4s;"></div>
                </div>
                <span style="font-size:0.78rem;color:#6b7280;">${o.hint}</span>
            </div>
        </div>

        <!-- My Leave Overview -->
<div class="tsDashTile" style="background:#fff;border-radius:12px;flex:1;
            box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;
            box-sizing:border-box;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:0.95rem;font-weight:600;color:#111827;">My Leave Overview</span>
        <span style="font-size:0.75rem;color:#9ca3af;background:#f3f4f6;
                     padding:3px 10px;border-radius:12px;">This Year</span>
    </div>

    <div style="display:flex;align-items:center;justify-content:center;flex-shrink:0;">
    <svg width="160" height="160" viewBox="0 0 140 140" style="display:block;">
        <circle cx="70" cy="70" r="54" fill="none" stroke="#f3f4f6" stroke-width="14"/>

        <!-- Casual Leave 5/23 -->
        <circle cx="70" cy="70" r="54" fill="none" stroke="#16a34a" stroke-width="14"
            stroke-dasharray="${((5 / 23) * 2 * Math.PI * 54).toFixed(2)} ${(2 * Math.PI * 54).toFixed(2)}"
            stroke-dashoffset="0"
            transform="rotate(-90 70 70)"/>

        <!-- Sick Leave 5/23 -->
        <circle cx="70" cy="70" r="54" fill="none" stroke="#3b82f6" stroke-width="14"
            stroke-dasharray="${((5 / 23) * 2 * Math.PI * 54).toFixed(2)} ${(2 * Math.PI * 54).toFixed(2)}"
            stroke-dashoffset="${(-(5 / 23) * 2 * Math.PI * 54).toFixed(2)}"
            transform="rotate(-90 70 70)"/>

        <!-- Paid Leave 11/23 -->
        <circle cx="70" cy="70" r="54" fill="none" stroke="#f59e0b" stroke-width="14"
            stroke-dasharray="${((11 / 23) * 2 * Math.PI * 54).toFixed(2)} ${(2 * Math.PI * 54).toFixed(2)}"
            stroke-dashoffset="${(-((5 + 5) / 23) * 2 * Math.PI * 54).toFixed(2)}"
            transform="rotate(-90 70 70)"/>

        <!-- Paternity Leave 2/23 -->
        <circle cx="70" cy="70" r="54" fill="none" stroke="#8b5cf6" stroke-width="14"
            stroke-dasharray="${((2 / 23) * 2 * Math.PI * 54).toFixed(2)} ${(2 * Math.PI * 54).toFixed(2)}"
            stroke-dashoffset="${(-((5 + 5 + 11) / 23) * 2 * Math.PI * 54).toFixed(2)}"
            transform="rotate(-90 70 70)"/>

        <text x="70" y="64" text-anchor="middle" font-size="20"
              font-weight="700" fill="#111827">21</text>
        <text x="70" y="80" text-anchor="middle" font-size="9"
              fill="#9ca3af" font-family="sans-serif">Total Days</text>
    </svg>

        <!-- Legend -->
<!-- Legend -->
<div style="flex:1;min-width:120px;display:flex;flex-direction:column;justify-content:space-between;gap:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;
                         background:#16a34a;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;color:#374151;">Casual Leave</span>
        </div>
        <span style="font-size:0.82rem;font-weight:700;color:#111827;">5 Days</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;
                         background:#3b82f6;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;color:#374151;">Sick Leave</span>
        </div>
        <span style="font-size:0.82rem;font-weight:700;color:#111827;">5 Days</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;
                         background:#f59e0b;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;color:#374151;">Paid Leave</span>
        </div>
        <span style="font-size:0.82rem;font-weight:700;color:#111827;">11 Days</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;">
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;
                         background:#8b5cf6;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;color:#374151;">Paternity Leave</span>
        </div>
        <span style="font-size:0.82rem;font-weight:700;color:#111827;">2 Days</span>
    </div>
</div>

    </div>

    <!-- Maternity info line -->
    <div style="margin-top:14px;padding:10px 14px;background:#eff6ff;
                border-radius:8px;border-left:3px solid #4281e7;
                display:flex;align-items:center;gap:10px;">
        <svg width="50" height="50" viewBox="0 0 24 24" fill="none"
             stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style="font-size:0.95rem;color:#1d4ed8;line-height:1.4;">
            <b>Maternity Leave:</b> 180 days 
        </span>
    </div>

</div>

    </div>

</div>`;


            // ── Final: wrap all rows in outer column ─────────────────────────
            return `
    <div style="padding:1.5rem;box-sizing:border-box;width:100%;
                display:flex;flex-direction:column;gap:1.5rem;">
        ${sRow1}
        ${sRow4}
        ${sRow2}
        ${sRow5}
    </div>`;
        },

        // ─────────────────────────────────────────────────────────────────────
        // Bar chart for timesheet hours in the current week 
        // ─────────────────────────────────────────────────────────────────────
        _buildBarChart(weekDays) {
            const X_STEP = 100, BAR_W = 60;
            const CHART_W = X_STEP * 5;
            const MAX_BAR = 180;
            const TOP_PAD = 20;
            const BASE_Y = MAX_BAR + TOP_PAD;
            const VIEW_H = BASE_Y + 24;  // ← reduced bottom padding

            const weekMax = Math.max(...weekDays.slice(0, 5).map(d => d.hours || 0), 1);

            let bars = "";
            weekDays.slice(0, 5).forEach((day, i) => {
                const x = i * X_STEP + (X_STEP - BAR_W) / 2;
                const barH = day.hours > 0
                    ? Math.max(12, (day.hours / weekMax) * MAX_BAR)
                    : 6;  // ← tiny stub for empty days
                const y = BASE_Y - barH;
                const col = day.hours > 0 ? "#3b82f6" : "#e5e7eb";
                const cxB = x + BAR_W / 2;

                bars += `<rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}"
                       rx="8" fill="${col}"/>`;

                bars += `<text x="${cxB}" y="${BASE_Y + 16}" text-anchor="middle"
                       font-size="11" fill="#6b7280"
                       font-family="sans-serif">${day.name}</text>`;

                if (day.hours > 0) {
                    const lbl = (day.hoursLabel || "").replace(" hrs", "h");
                    const inside = barH >= 28;
                    const lblY = inside ? y + barH / 2 + 5 : y - 6;
                    const lblCol = inside ? "#fff" : "#374151";
                    bars += `<text x="${cxB}" y="${lblY}" text-anchor="middle"
                           font-size="11" fill="${lblCol}" font-weight="700"
                           font-family="sans-serif">${lbl}</text>`;
                }
            });

            return `
        <div style="padding:0 18px 8px;width:100%;box-sizing:border-box;margin-top:4px;">
            <svg viewBox="0 0 ${CHART_W} ${VIEW_H}" width="100%"
                 style="overflow:visible;display:block;">
                ${bars}
            </svg>
        </div>`;
        },

    });
});