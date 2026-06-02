sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    const MONTHS = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const SHORT_MONTHS = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const WEEK_DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Status text shown inside each cell.  Empty string = blank cell.
    //   W = weekend, F = future date (not yet reached), both render blank.
    const STATUS_TEXT = {
        P: "P", A: "A", H: "H",
        CL: "CL", SL: "SL", PL: "PL", ML: "ML", PtL: "PtL", L: "L",
        W: "", F: ""
    };

    function loadXLSX() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
            s.onload  = () => resolve(window.XLSX);
            s.onerror = () => reject(new Error("Could not load Excel library."));
            document.head.appendChild(s);
        });
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    return Controller.extend("timesheet.app.controller.TeamAttendance", {

        onInit() {
            const now = new Date();
            this._oModel = new JSONModel({
                year:           now.getFullYear(),
                month:          now.getMonth() + 1,    // 1..12
                monthLabel:     `${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
                employees:      [],                    // raw list from backend
                holidays:       [],
                daysInMonth:    0,
                searchQuery:    "",
                pageIndex:      0,
                pageSize:       10,
                totalCount:     0,
                filteredCount:  0,
                pageInfo:       "0 of 0",
                gridHtml:       "",
                loading:        false
            });
            this.getView().setModel(this._oModel, "tav");

            this.getOwnerComponent().getRouter()
                .getRoute("team-attendance")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            const m = this._oModel;
            this._loadAttendance(m.getProperty("/year"), m.getProperty("/month"));
        },

        // ── Backend call ─────────────────────────────────────────────────────

        _loadAttendance(year, month) {
            const m = this._oModel;
            m.setProperty("/loading", true);
            m.setProperty("/gridHtml", "");

            fetch("/manager/getTeamAttendance", {
                method:      "POST",
                credentials: "include",
                headers:     { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ year, month })
            })
            .then(async (r) => {
                if (!r.ok) {
                    const txt = await r.text();
                    let msg = txt;
                    try { msg = JSON.parse(txt).error?.message || txt; } catch (e) { /**/ }
                    throw new Error("HTTP " + r.status + ": " + msg);
                }
                return r.json();
            })
            .then((data) => {
                const v = (data && (data.value || data)) || {};
                let employees = [];
                let holidays  = [];
                try { employees = JSON.parse(v.employees || "[]"); } catch (e) { employees = []; }
                try { holidays  = JSON.parse(v.holidays  || "[]"); } catch (e) { holidays = []; }

                m.setProperty("/employees",   employees);
                m.setProperty("/holidays",    holidays);
                m.setProperty("/daysInMonth", v.daysInMonth || 0);
                m.setProperty("/totalCount",  employees.length);
                m.setProperty("/pageIndex",   0);
                m.setProperty("/loading",     false);

                this._renderGrid();
            })
            .catch((err) => {
                m.setProperty("/loading", false);
                MessageBox.error("Could not load team attendance: " +
                    (err && err.message ? err.message : String(err)));
            });
        },

        // ── Filter + paginate helpers ────────────────────────────────────────

        _getFilteredEmployees() {
            const m  = this._oModel;
            const q  = (m.getProperty("/searchQuery") || "").toLowerCase().trim();
            const all = m.getProperty("/employees") || [];
            if (!q) return all;
            return all.filter(e =>
                (e.employeeName || "").toLowerCase().includes(q) ||
                (e.employeeId   || "").toLowerCase().includes(q) ||
                (e.designation  || "").toLowerCase().includes(q)
            );
        },

        _getPagedEmployees() {
            const m         = this._oModel;
            const filtered  = this._getFilteredEmployees();
            const pageSize  = parseInt(m.getProperty("/pageSize"), 10) || 10;
            const pageIndex = m.getProperty("/pageIndex") || 0;
            const start     = pageIndex * pageSize;
            const end       = start + pageSize;
            return { filtered, page: filtered.slice(start, end), start, end, pageSize, pageIndex };
        },

        // ── Build the HTML grid (single render pass) ─────────────────────────

        _renderGrid() {
            const m = this._oModel;
            const { filtered, page, start, end, pageSize, pageIndex } = this._getPagedEmployees();
            const days        = m.getProperty("/daysInMonth") || 0;
            const year        = m.getProperty("/year");
            const monthIdx    = (m.getProperty("/month") || 1) - 1;
            const holidayMap  = new Map((m.getProperty("/holidays") || []).map(h => [h.date, h.name]));

            m.setProperty("/filteredCount", filtered.length);
            const realEnd = Math.min(end, filtered.length);
            m.setProperty("/pageInfo",
                filtered.length === 0
                    ? "0 of 0"
                    : `${start + 1}-${realEnd} of ${filtered.length}`
            );

            if (!days || !page.length) {
                m.setProperty("/gridHtml", "");
                return;
            }

            // ── Header row ───────────────────────────────────────────────────
            let header = `<th class="tsAttEmpCol">Employee name</th>`;
            for (let d = 1; d <= days; d++) {
                const dt   = new Date(Date.UTC(year, monthIdx, d));
                const dow  = dt.getUTCDay();
                const isWk = (dow === 0 || dow === 6);
                const iso  = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const isHol = holidayMap.has(iso);
                const holName = isHol ? escapeHtml(holidayMap.get(iso)) : "";
                const cls  = "tsAttDayCol" + (isWk ? " tsAttWeekend" : "") + (isHol ? " tsAttHolidayCol" : "");
                const tip  = isHol ? ` title="${holName}"` : "";
                header += `<th class="${cls}"${tip}>` +
                          `<span class="tsAttDayDow">${WEEK_DAY_SHORT[dow]}</span>` +
                          `<span class="tsAttDayDate">${SHORT_MONTHS[monthIdx]} ${String(d).padStart(2, "0")}</span>` +
                          `</th>`;
            }

            // ── Body rows ────────────────────────────────────────────────────
            let body = "";
            for (const emp of page) {
                const initials = (emp.employeeName || "")
                    .split(/\s+/)
                    .filter(Boolean)
                    .map(p => p[0].toUpperCase())
                    .slice(0, 2)
                    .join("");
                body += `<tr>`;
                body += `<td class="tsAttEmpCell">` +
                            `<div class="tsAttEmpInfo">` +
                                `<div class="tsAttEmpAvatar">${escapeHtml(initials || "?")}</div>` +
                                `<div class="tsAttEmpMeta">` +
                                    `<div class="tsAttEmpName">${escapeHtml(emp.employeeName)}</div>` +
                                    `<div class="tsAttEmpRole">${escapeHtml(emp.designation || "")}</div>` +
                                `</div>` +
                            `</div>` +
                        `</td>`;
                for (const day of (emp.days || [])) {
                    const s    = day.status || "A";
                    const dt   = new Date(`${day.date}T00:00:00Z`);
                    const dow  = dt.getUTCDay();
                    const isWk = (dow === 0 || dow === 6);
                    const isFuture = (s === "F");
                    const text = STATUS_TEXT[s] != null ? STATUS_TEXT[s] : s;
                    const time = day.time ? `<span class="tsAttCellTime">${escapeHtml(String(day.time).slice(0, 5))}</span>` : "";
                    const cellCls = "tsAttCell"
                        + (isWk ? " tsAttWeekend" : "")
                        + (isFuture ? " tsAttFuture" : "");
                    const tip = (s === "H" && holidayMap.has(day.date))
                        ? ` title="${escapeHtml(holidayMap.get(day.date))}"`
                        : "";
                    body += `<td class="${cellCls}"${tip}>` +
                                `<span class="tsAttCellLg tsAtt-${s}">${escapeHtml(text)}</span>` +
                                time +
                            `</td>`;
                }
                body += `</tr>`;
            }

            const html =
                `<div class="tsAttGridScroll">` +
                    `<table class="tsAttGrid">` +
                        `<thead><tr>${header}</tr></thead>` +
                        `<tbody>${body}</tbody>` +
                    `</table>` +
                `</div>`;

            m.setProperty("/gridHtml", html);
        },

        // ── Month navigation ─────────────────────────────────────────────────

        onPrevMonth() { this._shiftMonth(-1); },
        onNextMonth() { this._shiftMonth(+1); },

        _shiftMonth(delta) {
            const m = this._oModel;
            let y = m.getProperty("/year");
            let mo = m.getProperty("/month") + delta;
            if (mo < 1)  { mo = 12; y--; }
            if (mo > 12) { mo = 1;  y++; }
            m.setProperty("/year", y);
            m.setProperty("/month", mo);
            m.setProperty("/monthLabel", `${MONTHS[mo - 1]} ${y}`);
            m.setProperty("/searchQuery", "");
            this._loadAttendance(y, mo);
        },

        // ── Search / pagination ──────────────────────────────────────────────

        onSearch(oEvent) {
            const q = oEvent.getParameter("newValue") || "";
            this._oModel.setProperty("/searchQuery", q);
            this._oModel.setProperty("/pageIndex", 0);
            this._renderGrid();
        },

        onPageSizeChange() {
            this._oModel.setProperty("/pageIndex", 0);
            this._renderGrid();
        },

        onPrevPage() {
            const m = this._oModel;
            const i = m.getProperty("/pageIndex");
            if (i > 0) {
                m.setProperty("/pageIndex", i - 1);
                this._renderGrid();
            }
        },

        onNextPage() {
            const m  = this._oModel;
            const i  = m.getProperty("/pageIndex");
            const ps = parseInt(m.getProperty("/pageSize"), 10) || 10;
            const fc = this._oModel.getProperty("/filteredCount") || 0;
            if ((i + 1) * ps < fc) {
                m.setProperty("/pageIndex", i + 1);
                this._renderGrid();
            }
        },

        // ── Excel export ─────────────────────────────────────────────────────

        onExport() {
            const m = this._oModel;
            const filtered = this._getFilteredEmployees();
            if (!filtered.length) {
                MessageToast.show("No data to export.");
                return;
            }
            const monthLabel = m.getProperty("/monthLabel") || "Team-Attendance";
            const year       = m.getProperty("/year");
            const monthIdx   = (m.getProperty("/month") || 1) - 1;
            const days       = m.getProperty("/daysInMonth") || 0;

            loadXLSX().then(XLSX => {
                // Header rows: day-of-week + date
                const dowRow  = ["", ""];
                const dateRow = ["Employee ID", "Employee name"];
                for (let d = 1; d <= days; d++) {
                    const dt = new Date(Date.UTC(year, monthIdx, d));
                    dowRow.push(WEEK_DAY_SHORT[dt.getUTCDay()]);
                    dateRow.push(`${SHORT_MONTHS[monthIdx]} ${String(d).padStart(2, "0")}`);
                }
                const rows = [dowRow, dateRow];
                for (const emp of filtered) {
                    const row = [emp.employeeId, emp.employeeName];
                    for (const day of (emp.days || [])) {
                        const text = STATUS_TEXT[day.status] != null ? STATUS_TEXT[day.status] : day.status;
                        row.push(day.time ? `${text} ${String(day.time).slice(0, 5)}`.trim() : text);
                    }
                    rows.push(row);
                }
                const ws = XLSX.utils.aoa_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Team Attendance");
                XLSX.writeFile(wb, `team-attendance-${monthLabel.replace(/\s+/g, "-")}.xlsx`);
                MessageToast.show("Export ready.");
            })
            .catch((err) => {
                MessageBox.error("Could not export: " + (err.message || String(err)));
            });
        },

        // ── Navigation ───────────────────────────────────────────────────────

        onNavBack() {
            this.getOwnerComponent().getRouter().navTo("dashboard");
        }
    });
});
