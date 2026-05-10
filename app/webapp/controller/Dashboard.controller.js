sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], (Controller, JSONModel) => {
    "use strict";

    const DAYS      = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

        onInit() {
            const today     = new Date();
            const weekStart = getWeekStart(today);
            const weekEnd   = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);

            this._oDashModel = new JSONModel({
                greeting:       "Hey",
                todayLabel:     today.toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric"
                }),
                weekLabel:      `${toShortLabel(weekStart)} – ${toShortLabel(weekEnd)}`,
                weekStart:      toDateString(weekStart),
                dashGridHTML:   "",
                weekTotalLabel: "0:00 hrs this week",
                completion: {
                    pct: 0, label: "0 of 5 days filled",
                    state: "None", hint: "Fill Mon–Fri to complete your timesheet"
                }
            });
            this.getView().setModel(this._oDashModel, "dash");

            // Resolve the current user from EmployeeMaster so the greeting
            // shows their actual name (e.g. "Hey, Jatin Bajaj") instead of
            // a generic placeholder.
            this._loadGreeting();

            this.getOwnerComponent().getRouter()
                .getRoute("dashboard")
                .attachPatternMatched(this._onRouteMatched, this);

            // After the page has rendered, force scroll to top so the
            // greeting row is the first thing the user sees.
            this.getView().addEventDelegate({
                onAfterRendering: () => this._scrollToTop()
            });
        },

        _loadGreeting() {
            const oComp = this.getOwnerComponent();
            if (!oComp) return;

            const setName = (name) => {
                if (name) this._oDashModel.setProperty("/greeting", "Hey, " + name);
            };

            // Prefer the backend-resolved JWT user (works in BTP).
            if (oComp.getCurrentUser) {
                oComp.getCurrentUser().then(u => {
                    if (u && u.employeeName) { setName(u.employeeName); return; }
                    // Fallback to the role-based directory lookup.
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

        _onRouteMatched() {
            const sWeekStart = this._oDashModel.getProperty("/weekStart");
            this._computeStats();
            this._computeWeekHours(sWeekStart);
            // _refreshDash + _scrollToTop are called at the end of
            // _computeWeekHours so all data is ready before painting.
        },

        // ── Week Navigation ──────────────────────────────────────────────────

        onPrevWeek() {
            const s       = this._oDashModel.getProperty("/weekStart");
            const [y,m,d] = s.split("-").map(Number);
            this._setWeek(new Date(y, m - 1, d - 7));
        },

        onNextWeek() {
            const s       = this._oDashModel.getProperty("/weekStart");
            const [y,m,d] = s.split("-").map(Number);
            this._setWeek(new Date(y, m - 1, d + 7));
        },

        onToday() { this._setWeek(new Date()); },

        //Added to stop viewing future dates added on 07-may
        isCurrentOrFutureWeek(sWeekStart) {
        const today = getWeekStart(new Date());
        const current = new Date(sWeekStart);
        return current >= today;
        },
        //end of add code

        _setWeek(date) {
            const weekStart  = getWeekStart(date);
            const weekEnd    = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const sWeekStart = toDateString(weekStart);
            this._oDashModel.setProperty("/weekStart", sWeekStart);
            this._oDashModel.setProperty("/weekLabel", `${toShortLabel(weekStart)} – ${toShortLabel(weekEnd)}`);
            this._oDashModel.setProperty("/isNextDisabled", this.isCurrentOrFutureWeek(sWeekStart)); //added 07 may
            this._computeWeekHours(sWeekStart);
        },

        // ── Stats ────────────────────────────────────────────────────────────

        _computeStats() {
            const oHistModel  = this.getOwnerComponent().getModel("history");
            const submissions = oHistModel ? (oHistModel.getProperty("/submissions") || []) : [];

            const total    = submissions.length;
            const approved = submissions.filter(s => s.status === "Approved").length;
            const pending  = submissions.filter(s => s.status === "Pending").length;
            const rejected = submissions.filter(s => s.status === "Rejected").length;

            // Store stats on model for _refreshDash to pick up
            this._oDashModel.setProperty("/approved", approved);
            this._oDashModel.setProperty("/pending",  pending);
            this._oDashModel.setProperty("/rejected", rejected);
            this._oDashModel.setProperty("/total",    total);
        },

        // ── Week Hours ───────────────────────────────────────────────────────

        _computeWeekHours(sWeekStart) {
            const oLocksModel = this.getOwnerComponent().getModel("locked");
            let rows = oLocksModel ? (oLocksModel.getProperty("/" + sWeekStart) || []) : [];

            if (rows.length === 0) {
                const subs = this.getOwnerComponent().getModel("history")
                    ?.getProperty("/submissions") || [];
                const sub  = subs.find(s => s.weekStart === sWeekStart);
                rows = sub ? (sub.rows || []) : [];
            }

            const dayTotals = {};
            DAYS.forEach(d => {
                dayTotals[d] = rows.reduce((s, r) => s + parseHHMM(r[d] || ""), 0);
            });

            const weekDays = DAYS.slice(0, 5).map((d, i) => ({
                name:       DAY_NAMES[i],
                hours:      dayTotals[d],
                hoursLabel: dayTotals[d] > 0 ? toHHMM(dayTotals[d]) + " hrs" : "–"
            }));

            const weekTotal  = DAYS.reduce((s, d) => s + dayTotals[d], 0);
            const filledDays = DAYS.slice(0, 5).filter(d => dayTotals[d] > 0).length;
            const pct        = Math.round(filledDays / 5 * 100);

            this._oDashModel.setProperty("/weekTotalLabel", `${toHHMM(weekTotal)} hrs this week`);
            this._oDashModel.setProperty("/barChartHTML",   this._buildBarChart(weekDays));
            this._oDashModel.setProperty("/completion", {
                pct,
                label: `${filledDays} of 5 days filled`,
                state: pct === 100 ? "Success" : pct >= 60 ? "Warning" : pct > 0 ? "Error" : "None",
                hint:  pct === 100
                    ? "All Mon–Fri days filled – ready to submit!"
                    : `${5 - filledDays} day${5 - filledDays !== 1 ? "s" : ""} remaining`
            });

            // All data is now ready — build the full dashboard grid
            this._refreshDash();

            // The grid replaces a large HTML node which can shift the
            // scroll position; force back to the top so the greeting
            // is the first thing visible.
            this._scrollToTop();
        },

        _scrollToTop() {
            const oPage = this.byId("dashPage");
            if (oPage && oPage.scrollTo) { oPage.scrollTo(0, 0); }
            const oView = this.getView();
            const dom = oView && oView.getDomRef && oView.getDomRef();
            if (dom) {
                dom.querySelectorAll(
                    ".sapMPageEnableScrolling, .sapMScrollCont, .sapMNavContainer"
                ).forEach(el => { el.scrollTop = 0; });
            }
            // One more pass after the next paint — the grid HTML may
            // still be settling the layout when this runs.
            setTimeout(() => {
                if (oPage && oPage.scrollTo) { oPage.scrollTo(0, 0); }
                if (dom) {
                    dom.querySelectorAll(
                        ".sapMPageEnableScrolling, .sapMScrollCont, .sapMNavContainer"
                    ).forEach(el => { el.scrollTop = 0; });
                }
            }, 50);
        },

        // ── Rebuild full dashboard HTML ──────────────────────────────────────

        _refreshDash() {
            const oModel = this._oDashModel;

            const iApproved = oModel.getProperty("/approved")        || 0;
            const iPending  = oModel.getProperty("/pending")         || 0;
            const iRejected = oModel.getProperty("/rejected")        || 0;
            const iPct      = oModel.getProperty("/completion/pct")  || 0;
            const sHint     = oModel.getProperty("/completion/hint") || "";
            const sLabel    = oModel.getProperty("/completion/label")|| "";
            const sWeek     = oModel.getProperty("/weekLabel")       || "";
            const sBarHTML  = oModel.getProperty("/barChartHTML")    || "";

            const sGrid = this._buildDashGridHTML({
                approved : iApproved,
                pending  : iPending,
                rejected : iRejected,
                pct      : iPct,
                hint     : sHint,
                label    : sLabel,
                weekLabel: sWeek,
                barHTML  : sBarHTML
            });

            oModel.setProperty("/dashGridHTML", sGrid);
        },

        // ── Full grid HTML ───────────────────────────────────────────────────

        _buildDashGridHTML(o) {
            const iTotal = o.approved + o.pending + o.rejected;
            const r = 54, cx = 70, cy = 70;
            const circ = 2 * Math.PI * r;

            // Build pie segments
            const dA = ((o.approved / (iTotal || 1)) * circ).toFixed(2);
            const dP = ((o.pending  / (iTotal || 1)) * circ).toFixed(2);
            const dR = ((o.rejected / (iTotal || 1)) * circ).toFixed(2);
            const oA = 0;
            const oP = -((o.approved / (iTotal || 1)) * circ);
            const oR = -(((o.approved + o.pending) / (iTotal || 1)) * circ);

            const segs = iTotal === 0
                ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="14"/>`
                : [
                    o.approved > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#16a34a" stroke-width="14" stroke-dasharray="${dA} ${circ}" stroke-dashoffset="${oA}" transform="rotate(-90 ${cx} ${cy})"/>` : "",
                    o.pending  > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f59e0b" stroke-width="14" stroke-dasharray="${dP} ${circ}" stroke-dashoffset="${oP}" transform="rotate(-90 ${cx} ${cy})"/>` : "",
                    o.rejected > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#dc2626" stroke-width="14" stroke-dasharray="${dR} ${circ}" stroke-dashoffset="${oR}" transform="rotate(-90 ${cx} ${cy})"/>` : ""
                  ].join("");

            const sPie = `
                <div style="display:flex;align-items:center;padding:16px 20px 24px;gap:20px;">
                    <svg width="140" height="140" viewBox="0 0 140 140">
                        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="14"/>
                        ${segs}
                        <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${iTotal}</text>
                        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#9ca3af">submitted</text>
                    </svg>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <div style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:50%;background:#16a34a;"></span><span style="font-size:13px;color:#374151;">Approved</span><b style="font-size:13px;color:#111827;margin-left:4px;">${o.approved}</b></div>
                        <div style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;"></span><span style="font-size:13px;color:#374151;">Pending</span><b style="font-size:13px;color:#111827;margin-left:4px;">${o.pending}</b></div>
                        <div style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:50%;background:#dc2626;"></span><span style="font-size:13px;color:#374151;">Rejected</span><b style="font-size:13px;color:#111827;margin-left:4px;">${o.rejected}</b></div>
                    </div>
                </div>`;

            const sComp = `
                <div style="padding:16px 20px 24px;display:flex;flex-direction:column;gap:12px;">
                    <div style="width:100%;height:16px;background:#e5e7eb;border-radius:8px;overflow:hidden;">
                        <div style="width:${o.pct}%;height:100%;background:#3b82f6;border-radius:8px;transition:width 0.4s;"></div>
                    </div>
                    <span style="font-size:0.82rem;color:#6b7280;">${o.hint}</span>
                </div>`;

            return `
                <div style="padding:1.5rem;box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:1.5rem;">
                    <div style="display:flex;flex-direction:row;gap:1.5rem;width:100%;">

                        <div style="flex:1;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;min-height:280px;">
                            <div style="padding:16px 20px 8px;border-bottom:1px solid #f3f4f6;">
                                <div style="font-size:1rem;font-weight:600;color:#111827;">Total Timesheets</div>
                                <div style="font-size:0.82rem;color:#6b7280;margin-top:2px;">All time submissions</div>
                            </div>
                            ${sPie}
                        </div>

                        <div style="flex:1;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;min-height:280px;">
                            <div style="padding:16px 20px 8px;border-bottom:1px solid #f3f4f6;">
                                <div style="font-size:1rem;font-weight:600;color:#111827;">Week Completion</div>
                                <div style="font-size:0.82rem;color:#6b7280;margin-top:2px;">${o.label}</div>
                                <div style="font-size:2.5rem;font-weight:700;color:#111827;line-height:1.2;margin-top:8px;">${o.pct} <span style="font-size:1rem;font-weight:400;color:#6b7280;">%</span></div>
                            </div>
                            ${sComp}
                        </div>

                    </div>

<div style="width:100%;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;">
    
    <div style="padding:16px 20px 8px;border-bottom:1px solid #f3f4f6;">
        <div style="font-size:1rem;font-weight:600;color:#111827;">
            Daily Hours Breakdown
        </div>
        <div style="font-size:0.82rem;color:#6b7280;margin-top:2px;">
            ${o.weekLabel}
        </div>
    </div>

    <!-- no overflow hidden -->
    <div style="padding:8px 0 0; overflow:hidden;">
        ${o.barHTML}
    </div>
                </div>`;
        },

        // ── Bar chart ────────────────────────────────────────────────────────

_buildBarChart(weekDays) {
    const MAX_H   = 12;
    const X_STEP  = 100;
    const BAR_W   = 60;
    const CHART_W = X_STEP * 5;         // 500
    const MAX_BAR = 80;                  // max bar height in SVG units
    const TOP_PAD = 30;                  // space above tallest bar for labels
    const BASE_Y  = MAX_BAR + TOP_PAD;  // 110 — bars always fit below this
    const VIEW_H  = BASE_Y + 30;        // total SVG height incl. day labels

    let bars = "";
    weekDays.slice(0, 5).forEach((day, i) => {
        const x     = i * X_STEP + (X_STEP - BAR_W) / 2;
        const barH  = day.hours > 0
            ? Math.max(6, (day.hours / MAX_H) * MAX_BAR)
            : 6;
        const y     = BASE_Y - barH;
        const color = day.hours >= MAX_H ? "#16a34a" : day.hours > 0 ? "#3b82f6" : "#e5e7eb";
        const cxBar = x + BAR_W / 2;

        bars += `<rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="6" fill="${color}"/>`;
        bars += `<text x="${cxBar}" y="${BASE_Y + 16}" text-anchor="middle" font-size="11" fill="#6b7280" font-family="sans-serif">${day.name}</text>`;

        if (day.hours > 0) {
            const label = day.hoursLabel.replace(" hrs", "h");
            // label sits inside bar if bar is tall enough, else above
            const labelY = barH > 20 ? y + 16 : y - 5;
            const labelColor = barH > 20 ? "#ffffff" : "#374151";
            bars += `<text x="${cxBar}" y="${labelY}" text-anchor="middle" font-size="10" fill="${labelColor}" font-weight="600" font-family="sans-serif">${label}</text>`;
        }
    });

    let grid = "";
    [3, 6, 9, 12].forEach(hrs => {
        const gy = BASE_Y - (hrs / MAX_H) * MAX_BAR;
        grid += `<line x1="0" y1="${gy}" x2="${CHART_W}" y2="${gy}" stroke="#f3f4f6" stroke-width="1"/>`;
        grid += `<text x="${CHART_W + 4}" y="${gy + 3}" font-size="9" fill="#d1d5db" font-family="sans-serif">${hrs}h</text>`;
    });

    return `<div style="padding:0 14px 14px; width:100%; box-sizing:border-box; margin-top:10px;">
                <svg viewBox="0 0 ${CHART_W + 30} ${VIEW_H}"
                     width="100%"
                     style="overflow:visible; display:block;">
                    ${grid}${bars}
                </svg>
            </div>`;
},

        // ── Removed: _buildPieChart (duplicate — logic moved into _buildDashGridHTML) ──
        // ── Removed: onAfterRendering / _mountCardsToGrid (conflicts with HTML binding) ──

    });
});

