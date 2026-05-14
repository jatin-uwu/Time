sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], (Controller, JSONModel) => {
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
                taskSummary: {
                    total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0
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
                attendanceBtnLabel: "● Mark Active",
                attendanceBtnType: "Accept",
                attendanceBtnEnabled: true,
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
        },

        // ─────────────────────────────────────────────────────────────────────
        // Greeting
        // ─────────────────────────────────────────────────────────────────────
_loadGreeting() {
    const oComp = this.getOwnerComponent();
    if (!oComp) return;

    const hour      = new Date().getHours();
    const timeGreet = hour < 12 ? "Good Morning"
                    : hour < 17 ? "Good Afternoon"
                    :             "Good Evening";
    const emoji     = hour < 12 ? "☀️" : hour < 17 ? "👋" : "🌙";

    const buildHTML = (name) => {
        const namePart = name
            ? `, <span style="color:black;font-style:italic;">${name}!</span>`
            : `!`;
        return `
            <div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                    <span style="
                        font-size: 1.85rem;
                        font-weight: 800;
                        color: #232823;
                        letter-spacing: -0.4px;
                        font-family: 'Segoe UI', Arial, sans-serif;
                        line-height: 1.1;
                    ">${timeGreet}${namePart}</span>
                    <span style="font-size:1.6rem;line-height:1;">${emoji}</span>
                </div>
                <div style="
                    font-size: 1.05rem;
                    font-weight: 500;
                    color: #151719;
                    margin: 0;
                ">Here's what's happening with you today.</div>
            </div>`;
    };

    // Set immediately — never blank
    this._oDashModel.setProperty("/greetingHTML", buildHTML(""));

    const setName = (name) => {
        if (name) this._oDashModel.setProperty("/greetingHTML", buildHTML(name));
    };

    if (oComp.getCurrentUser) {
        oComp.getCurrentUser().then(u => {
            if (u && u.employeeName) { setName(u.employeeName); return; }
            if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
                oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(emp => {
                    if (emp && emp.employeeName) setName(emp.employeeName);
                });
            }
        });
        return;
    }
    if (oComp.getCurrentEmployeeId && oComp.getEmployeeById) {
        oComp.getEmployeeById(oComp.getCurrentEmployeeId()).then(emp => {
            if (emp && emp.employeeName) setName(emp.employeeName);
        });
    }
},

        // ─────────────────────────────────────────────────────────────────────
        // Route match — kick off all loaders
        // ─────────────────────────────────────────────────────────────────────
        _onRouteMatched() {
            const sWeekStart = this._oDashModel.getProperty("/weekStart");
            this._computeStats();
            this._computeWeekHours(sWeekStart);   // calls _refreshDash internally

            // existing loaders
            this._loadWorkAnniversary();
            this._loadLeaveBalance();
            this._loadMyTasks();

            // new loaders
            this._loadAttendance();
            this._loadPerformanceRating();
            this._loadPerformanceTrend();
            this._loadTaskSummary();

            //new 
            this._loadLeaveOverview();
            this._loadUpcomingCalendar();
            this._loadRecentNotifications();
            this._checkTodayAttendance();
        },

        // ── Notification button handler ───────────────────────────────────────
        onNotificationPress() {
            const oRouter = this.getOwnerComponent().getRouter();
            // Navigate to notifications route if it exists, else show message
            try {
                oRouter.navTo("notifications");
            } catch (e) {
                sap.m.MessageToast.show("No new notifications.");
            }
        },

        // ── Mark Active / Attendance ──────────────────────────────────────────
        onMarkAttendance() {
            const oModel = this.getOwnerComponent().getModel("");
            const now = new Date();

            // Format values to send to backend
            const dateStr = now.toISOString().split("T")[0];           // "2026-05-13"
            const timeStr = now.toTimeString().split(" ")[0];          // "14:32:00"
            const dayStr = now.toLocaleDateString("en-GB", { weekday: "long" }); // "Wednesday"

            if (!oModel) {
                sap.m.MessageToast.show("Service not available.");
                return;
            }

            // Disable button immediately to prevent double-click
            this._oDashModel.setProperty("/attendanceBtnEnabled", false);
            this._oDashModel.setProperty("/attendanceBtnLabel", "Marking...");

            oModel.callFunction("/markAttendance", {
                method: "POST",
                urlParameters: {
                    attendanceDate: dateStr,
                    attendanceDay: dayStr,
                    attendanceTime: timeStr
                },
                success: (oData) => {
                    this._oDashModel.setProperty("/attendanceBtnLabel", "✓ Active");
                    this._oDashModel.setProperty("/attendanceBtnType", "Success");
                    this._oDashModel.setProperty("/attendanceBtnEnabled", false);
                    this._oDashModel.setProperty("/attendanceMarked", true);

                    // Also update the attendance mock so the card reflects today
                    this._oDashModel.setProperty("/attendance/presentCount",
                        (this._oDashModel.getProperty("/attendance/presentCount") || 0) + 1);
                    this._refreshDash();

                    sap.m.MessageToast.show(
                        `Attendance marked for ${dayStr}, ${dateStr} at ${timeStr}`
                    );
                },
                error: (oErr) => {
                    // Re-enable so user can retry
                    this._oDashModel.setProperty("/attendanceBtnLabel", "● Mark Active");
                    this._oDashModel.setProperty("/attendanceBtnType", "Accept");
                    this._oDashModel.setProperty("/attendanceBtnEnabled", true);

                    const sMsg = (oErr.responseJSON && oErr.responseJSON.error &&
                        oErr.responseJSON.error.message) || "Failed to mark attendance.";
                    sap.m.MessageBox.error(sMsg);
                }
            });
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
        // Loaders — existing 3 (unchanged logic, now call _refreshDash)
        // ─────────────────────────────────────────────────────────────────────
        _loadWorkAnniversary() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getWorkAnniversary", {
                method: "POST",
                success: (oData) => {
                    const years = oData.yearsCompleted || 0;
                    let yearsLabel;
                    if (years >= 1) {
                        yearsLabel = parseFloat(years.toFixed(1)) + " Years";
                    } else {
                        const months = Math.floor(years * 12);
                        yearsLabel = months > 0 ? months + " Months" : "< 1 Month";
                    }
                    this._oDashModel.setProperty("/workAnniversary", {
                        yearsCompleted: years,
                        joiningDate: oData.joiningDate || null,
                        message: oData.message || "Welcome!",
                        yearsLabel: yearsLabel
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/workAnniversary",
                        { yearsCompleted: 0, joiningDate: null, message: "Welcome!", yearsLabel: "—" });
                    this._refreshDash();
                }
            });
        },

        _loadLeaveBalance() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getLeaveBalance", {
                method: "POST",
                success: (oData) => {
                    const casual = oData.casualLeave || 0;
                    const sick = oData.sickLeave || 0;
                    const annual = oData.annualLeave || 0;
                    const total = casual + sick + annual;
                    this._oDashModel.setProperty("/leaveBalance", {
                        casualLeave: casual, sickLeave: sick, annualLeave: annual,
                        total: total,
                        usedPct: Math.min(100, Math.round((total / 30) * 100))
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/leaveBalance",
                        { casualLeave: 0, sickLeave: 0, annualLeave: 0, total: 0, usedPct: 0 });
                    this._refreshDash();
                }
            });
        },

        _loadMyTasks() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getMyTasks", {
                method: "POST",
                success: (oData) => {
                    this._oDashModel.setProperty("/myTasks", {
                        totalPending: oData.totalPending || 0,
                        highPriorityCount: oData.highPriorityCount || 0,
                        inProgressCount: oData.inProgressCount || 0,
                        notStartedCount: oData.notStartedCount || 0
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/myTasks",
                        { totalPending: 0, highPriorityCount: 0, inProgressCount: 0, notStartedCount: 0 });
                    this._refreshDash();
                }
            });
        },

        // ─────────────────────────────────────────────────────────────────────
        // Loaders — new 4
        // ─────────────────────────────────────────────────────────────────────

        // Attendance: frontend-only mock (backend hook ready when needed)
        _loadAttendance() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) { this._setAttendanceMock(); return; }
            oModel.callFunction("/getAttendance", {
                method: "POST",
                success: (oData) => {
                    this._oDashModel.setProperty("/attendance", {
                        attendancePercentage: oData.attendancePercentage || 0,
                        presentCount: oData.presentCount || 0,
                        absentCount: oData.absentCount || 0,
                        monthLabel: oData.monthLabel || "Month"
                    });
                    this._refreshDash();
                },
                error: () => { this._setAttendanceMock(); }
            });
        },
        _setAttendanceMock() {
            const MNAMES = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
            this._oDashModel.setProperty("/attendance", {
                attendancePercentage: 100,
                presentCount: 22,
                absentCount: 0,
                monthLabel: MNAMES[new Date().getMonth()]
            });
            this._refreshDash();
        },

        // Performance Rating
        _loadPerformanceRating() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getPerformanceRating", {
                method: "POST",
                success: (oData) => {
                    this._oDashModel.setProperty("/performanceRating", {
                        ratingValue: parseFloat(oData.ratingValue || 0),
                        ratingCategory: oData.ratingCategory || "N/A"
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/performanceRating",
                        { ratingValue: 0, ratingCategory: "N/A" });
                    this._refreshDash();
                }
            });
        },

        _checkTodayAttendance() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;

            const today = new Date().toISOString().split("T")[0];

            oModel.callFunction("/getTodayAttendance", {
                method: "POST",
                urlParameters: { attendanceDate: today },
                success: (oData) => {
                    if (oData && oData.alreadyMarked) {
                        this._oDashModel.setProperty("/attendanceBtnLabel", "✓ Active");
                        this._oDashModel.setProperty("/attendanceBtnType", "Success");
                        this._oDashModel.setProperty("/attendanceBtnEnabled", false);
                        this._oDashModel.setProperty("/attendanceMarked", true);
                    }
                },
                error: () => { /* silently ignore — button stays enabled */ }
            });
        },

        // Performance Trend
        _loadPerformanceTrend(iYear) {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            const year = iYear || parseInt(
                this._oDashModel.getProperty("/performanceTrend/selectedYear") || new Date().getFullYear(), 10);
            oModel.callFunction("/getPerformanceTrend", {
                method: "POST",
                urlParameters: { year: year },
                success: (oData) => {
                    let months = [];
                    try { months = JSON.parse(oData.trendJSON || "[]"); } catch (e) { months = []; }
                    this._oDashModel.setProperty("/performanceTrend/months", months);
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/performanceTrend/months", Array(12).fill(null));
                    this._refreshDash();
                }
            });
        },

        // Year selector change
        onTrendYearChange(oEvent) {
            const sYear = oEvent.getSource().getSelectedKey();
            this._oDashModel.setProperty("/performanceTrend/selectedYear", sYear);
            this._loadPerformanceTrend(parseInt(sYear, 10));
        },

        // Task Summary (reuses existing TaskMaster backend)
        _loadTaskSummary() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getTaskSummary", {
                method: "POST",
                success: (oData) => {
                    this._oDashModel.setProperty("/taskSummary", {
                        total: oData.total || 0,
                        notStarted: oData.notStarted || 0,
                        inProgress: oData.inProgress || 0,
                        inReview: oData.inReview || 0,
                        completed: oData.completed || 0
                    });
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/taskSummary",
                        { total: 0, notStarted: 0, inProgress: 0, inReview: 0, completed: 0 });
                    this._refreshDash();
                }
            });
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
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getUpcomingCalendar", {
                method: "POST",
                success: (oData) => {
                    let events = [];
                    try { events = JSON.parse(oData.eventsJSON || "[]"); } catch (e) { /**/ }
                    this._oDashModel.setProperty("/upcomingCalendar/events", events);
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/upcomingCalendar/events", []);
                    this._refreshDash();
                }
            });
        },

        // ── Recent Notifications ──────────────────────────────────────────────────
        _loadRecentNotifications() {
            const oModel = this.getOwnerComponent().getModel("");
            if (!oModel) return;
            oModel.callFunction("/getRecentNotifications", {
                method: "POST",
                success: (oData) => {
                    // CAP returns array directly for "returns array of"
                    const items = Array.isArray(oData) ? oData
                        : Array.isArray(oData?.value) ? oData.value : [];
                    this._oDashModel.setProperty("/recentNotifications/items", items);
                    this._refreshDash();
                },
                error: () => {
                    this._oDashModel.setProperty("/recentNotifications/items", []);
                    this._refreshDash();
                }
            });
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
            const card = (body) =>
                `<div style="flex:1;min-width:0;background:#fff;border-radius:12px;
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
            `);

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
                    <span>Annual: <b style="color:#374151;">${annual}</b></span>
                </div>
            `);

            // ── 3. My Tasks ──────────────────────────────────────────────────
            const tasks = o.tasks || {};
            const tPending = tasks.totalPending !== undefined ? tasks.totalPending : 0;
            const tHigh = tasks.highPriorityCount !== undefined ? tasks.highPriorityCount : 0;
            const tInProg = tasks.inProgressCount !== undefined ? tasks.inProgressCount : 0;
            const tNotSt = tasks.notStartedCount !== undefined ? tasks.notStartedCount : 0;

            const sTasksCard = card(`
                ${cardHeader("My Tasks",
                iconCircle("#fffbeb", "#f59e0b",
                    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'))}
                ${bigNum(tPending, "#111827")}
                ${subLabel("Tasks Pending")}
                ${tHigh > 0
                    ? `<div style="font-size:0.82rem;font-weight:600;color:#dc2626;margin-bottom:8px;">${tHigh} High Priority</div>`
                    : `<div style="font-size:0.82rem;color:#9ca3af;margin-bottom:8px;">No high priority tasks</div>`}
                <div style="font-size:0.78rem;color:#6b7280;display:flex;flex-direction:column;gap:4px;">
                    <div style="display:flex;justify-content:space-between;">
                        <span>In Progress</span><b style="color:#3b82f6;">${tInProg}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span>Not Started</span><b style="color:#6b7280;">${tNotSt}</b>
                    </div>
                </div>
            `);

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
            `);

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
            `);

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

            const sRow2 = `
                <div style="display:flex;flex-direction:row;gap:1rem;width:100%;box-sizing:border-box;">

                    <div style="flex:1;background:#fff;border-radius:12px;
                                box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;min-height:260px;">
                        <div style="padding:14px 18px 6px;border-bottom:1px solid #f3f4f6;">
                            <div style="font-size:0.95rem;font-weight:600;color:#111827;">Total Timesheets</div>
                            <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">All time submissions</div>
                        </div>
                        <div style="display:flex;align-items:center;padding:14px 18px 20px;gap:18px;">
                            <svg width="130" height="130" viewBox="0 0 140 140">
                                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                                ${segs}
                                <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${iTotal}</text>
                                <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#9ca3af">submitted</text>
                            </svg>
                            <div style="display:flex;flex-direction:column;gap:10px;">
                                <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#16a34a;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Approved</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.approved}</b></div>
                                <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Pending</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.pending}</b></div>
                                <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#dc2626;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Rejected</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.rejected}</b></div>
                            </div>
                        </div>
                    </div>

                    <div style="flex:1;background:#fff;border-radius:12px;
                                box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;min-height:260px;">
                        <div style="padding:14px 18px 6px;border-bottom:1px solid #f3f4f6;">
                            <div style="font-size:0.95rem;font-weight:600;color:#111827;">Week Completion</div>
                            <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">${o.label}</div>
                            <div style="font-size:2.4rem;font-weight:700;color:#111827;line-height:1.2;margin-top:6px;">
                                ${o.pct} <span style="font-size:0.95rem;font-weight:400;color:#6b7280;">%</span>
                            </div>
                        </div>
                        <div style="padding:14px 18px 20px;display:flex;flex-direction:column;gap:10px;">
                            <div style="width:100%;height:14px;background:#e5e7eb;border-radius:7px;overflow:hidden;">
                                <div style="width:${o.pct}%;height:100%;background:#3b82f6;border-radius:7px;transition:width 0.4s;"></div>
                            </div>
                            <span style="font-size:0.78rem;color:#6b7280;">${o.hint}</span>
                        </div>
                    </div>

                </div>`;

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

            const W = 440, H = 170, PL = 32, PR = 10, PT = 18, PB = 26;
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
                .map((v, i) => v !== null ? { x: xOf(i), y: yOf(v) } : null)
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
                <div style="flex:1.4;min-width:0;background:#fff;border-radius:12px;
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
        <div style="background:#fff;border-radius:12px;
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
        <div style="background:#fff;border-radius:12px;flex:1;
                    box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;">
            <div style="padding:12px 16px 6px;border-bottom:1px solid #f3f4f6;">
                <div style="font-size:0.95rem;font-weight:600;color:#111827;">Total Timesheets</div>
                <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">All time submissions</div>
            </div>
            <div style="display:flex;align-items:center;padding:12px 16px 16px;gap:16px;">
                <svg width="110" height="110" viewBox="0 0 140 140">
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                    ${segs}
                    <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${iTotal}</text>
                    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#9ca3af">submitted</text>
                </svg>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#16a34a;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Approved</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.approved}</b></div>
                    <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Pending</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.pending}</b></div>
                    <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:#dc2626;flex-shrink:0;"></span><span style="font-size:12px;color:#374151;">Rejected</span><b style="font-size:12px;color:#111827;margin-left:4px;">${o.rejected}</b></div>
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
    <div style="flex:1;min-width:0;background:#fff;border-radius:12px;
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
    <div style="flex:1;min-width:0;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:18px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:0.95rem;font-weight:600;color:#111827;">Recent Notifications</span>
            <span style="font-size:0.75rem;color:#3b82f6;cursor:pointer;">View All</span>
        </div>
        ${notifRows}
    </div>`;

            const sRow5 = `
    <div style="display:flex;flex-direction:row;gap:1rem;
                width:100%;box-sizing:border-box;">
        ${sLeaveOverview}
        ${sCalendar}
        ${sNotifications}
    </div>`;

            // ── Final: wrap all rows in outer column ─────────────────────────
            return `
                <div style="padding:1.5rem;box-sizing:border-box;width:100%;
                            display:flex;flex-direction:column;gap:1.5rem;">
                    ${sRow1}
                    ${sRow4}
                    ${sRow2}
                    ${sRow3}
                    ${sRow5}
                    
                </div>`;
        },

        // ─────────────────────────────────────────────────────────────────────
        // Bar chart (unchanged)
        // ─────────────────────────────────────────────────────────────────────
        _buildBarChart(weekDays) {
            const MAX_H = 12, X_STEP = 100, BAR_W = 56;
            const CHART_W = X_STEP * 5, MAX_BAR = 60, TOP_PAD = 20;
            const BASE_Y = MAX_BAR + TOP_PAD, VIEW_H = BASE_Y + 24;

            let bars = "";
            weekDays.slice(0, 5).forEach((day, i) => {
                const x = i * X_STEP + (X_STEP - BAR_W) / 2;
                const barH = day.hours > 0 ? Math.max(6, (day.hours / MAX_H) * MAX_BAR) : 6;
                const y = BASE_Y - barH;
                const col = day.hours >= MAX_H ? "#16a34a" : day.hours > 0 ? "#3b82f6" : "#e5e7eb";
                const cxB = x + BAR_W / 2;
                bars += `<rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="6" fill="${col}"/>`;
                bars += `<text x="${cxB}" y="${BASE_Y + 16}" text-anchor="middle" font-size="11" fill="#6b7280" font-family="sans-serif">${day.name}</text>`;
                if (day.hours > 0) {
                    const lbl = day.hoursLabel.replace(" hrs", "h");
                    const lblY = barH > 20 ? y + 16 : y - 5;
                    const lblC = barH > 20 ? "#fff" : "#374151";
                    bars += `<text x="${cxB}" y="${lblY}" text-anchor="middle" font-size="10" fill="${lblC}" font-weight="600" font-family="sans-serif">${lbl}</text>`;
                }
            });

            let grid = "";
            [3, 6, 9, 12].forEach(hrs => {
                const gy = BASE_Y - (hrs / MAX_H) * MAX_BAR;
                grid += `<line x1="0" y1="${gy}" x2="${CHART_W}" y2="${gy}" stroke="#f3f4f6" stroke-width="1"/>`;
                grid += `<text x="${CHART_W + 4}" y="${gy + 3}" font-size="9" fill="#d1d5db" font-family="sans-serif">${hrs}h</text>`;
            });

            return `<div style="padding:0 14px 14px;width:100%;box-sizing:border-box;margin-top:10px;">
                        <svg viewBox="0 0 ${CHART_W + 30} ${VIEW_H}" width="100%"
                             style="overflow:visible;display:block;">${grid}${bars}</svg>
                    </div>`;
        }

    });
});