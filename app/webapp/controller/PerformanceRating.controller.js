sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], (Controller, JSONModel) => {
    "use strict";

    const MONTH_NAMES = [
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    function callAction(sAction, mParams) {
        return fetch("/employee/" + sAction, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(mParams || {}),
            credentials: "include"
        }).then(async res => {
            const text = await res.text();
            if (!res.ok) throw new Error(text || res.statusText);
            if (!text || text.trim() === "") return {};
            const data = JSON.parse(text);
            const cleaned = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("@")));
            return cleaned.value !== undefined ? cleaned.value : cleaned;
        });
    }

    function callManagerAction(sAction, mParams) {
        return fetch("/manager/" + sAction, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(mParams || {}),
            credentials: "include"
        }).then(async res => {
            const text = await res.text();
            if (!res.ok) throw new Error(text || res.statusText);
            if (!text || text.trim() === "") return {};
            const data = JSON.parse(text);
            const cleaned = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("@")));
            return cleaned.value !== undefined ? cleaned.value : cleaned;
        });
    }

    return Controller.extend("timesheet.app.controller.PerformanceRating", {

        onInit() {
            const now = new Date();
            this._oModel = new JSONModel({
                form: {
                    employeeId:   "",
                    employeeName: "",
                    month:        now.getMonth() + 1,
                    year:         now.getFullYear(),
                    ratingValue:  3.0,
                    ratingLabel:  "Average",
                    starsHTML:    this._buildStarsHTML(3.0),
                    comment:      ""
                },
                employees:        [],
                ratings:          [],
                ratingsTableHTML: this._buildEmptyTable()
            });
            this.getView().setModel(this._oModel, "perfRating");

            this.getOwnerComponent().getRouter()
                .getRoute("performance-rating")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            const now = new Date();

            this._oModel.setProperty("/form", {
                employeeId:   "",
                employeeName: "",
                month:        now.getMonth() + 1,
                year:         now.getFullYear(),
                ratingValue:  3.0,
                ratingLabel:  "Average",
                starsHTML:    this._buildStarsHTML(3.0),
                comment:      ""
            });

            const oEmpSelect = this.byId("empSelect");
            if (oEmpSelect) oEmpSelect.setSelectedKey("");

            const oComment = this.byId("commentArea");
            if (oComment) oComment.setValue("");

            this.byId("monthSelect").setSelectedKey(String(now.getMonth() + 1));
            this.byId("yearSelect").setSelectedKey(String(now.getFullYear()));

            this._loadMyTeamEmployees();
            this._loadAllRatings();   // ← fixed: removed stray backslash

            // Disable future months/years after DOM settles
            setTimeout(function () {
                this._disableFutureMonthsYears();
            }.bind(this), 0);
        },

        // ── Disable future months/years in dropdowns ──────────────────────────
        _disableFutureMonthsYears() {
            const now          = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear  = now.getFullYear();

            const oMonthSelect = this.byId("monthSelect");
            const oYearSelect  = this.byId("yearSelect");
            if (!oMonthSelect || !oYearSelect) return;

            const selectedYear = parseInt(oYearSelect.getSelectedKey(), 10);

            // Grey out future years
            oYearSelect.getItems().forEach(function (item) {
                item.setEnabled(parseInt(item.getKey(), 10) <= currentYear);
            });

            // Grey out future months for current year
            oMonthSelect.getItems().forEach(function (item) {
                const mo = parseInt(item.getKey(), 10);
                item.setEnabled(selectedYear === currentYear ? mo <= currentMonth : true);
            });
        },

        // ── Re-evaluate months whenever year changes ──────────────────────────
        onYearChange(oEvent) {
            const selectedYear = parseInt(oEvent.getSource().getSelectedKey(), 10);
            const now          = new Date();
            const currentYear  = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            const oMonthSelect = this.byId("monthSelect");

            oMonthSelect.getItems().forEach(function (item) {
                const mo = parseInt(item.getKey(), 10);
                item.setEnabled(selectedYear === currentYear ? mo <= currentMonth : true);
            });

            // If selected month is now in the future, snap back to current month
            const selectedMonth = parseInt(oMonthSelect.getSelectedKey(), 10);
            if (selectedYear === currentYear && selectedMonth > currentMonth) {
                oMonthSelect.setSelectedKey(String(currentMonth));
            }
        },

        // ── Load employees under this manager ────────────────────────────────
        _loadMyTeamEmployees() {
            fetch("/manager/Employees", {
                headers: { "Accept": "application/json" },
                credentials: "include"
            })
                .then(r => r.json())
                .then(data => {
                    const employees = data.value || [];
                    if (employees.length === 0) {
                        sap.m.MessageToast.show("No team members found.");
                        return;
                    }
                    this._oModel.setProperty("/employees", employees);

                    const oEmpSelect     = this.byId("empSelect");
                    const oHistEmpSelect = this.byId("historyEmpSelect");

                    oEmpSelect.destroyItems();
                    oHistEmpSelect.destroyItems();

                    oEmpSelect.addItem(new sap.ui.core.Item({ key: "", text: "-- Select Employee --" }));
                    oHistEmpSelect.addItem(new sap.ui.core.Item({ key: "", text: "All Employees" }));

                    employees.forEach(emp => {
                        oEmpSelect.addItem(new sap.ui.core.Item({
                            key:  emp.employeeId,
                            text: `${emp.employeeName} (${emp.employeeId})`
                        }));
                        oHistEmpSelect.addItem(new sap.ui.core.Item({
                            key:  emp.employeeId,
                            text: emp.employeeName
                        }));
                    });
                })
                .catch(e => {
                    console.error("Failed to load employees:", e);
                    sap.m.MessageToast.show("Could not load team members: " + e.message);
                });
        },

        // ── Load all ratings for manager's team ──────────────────────────────
        _loadAllRatings(sFilterEmpId) {
            let url = "/employee/PerformanceRatings?$orderby=reviewYear desc,reviewMonth desc&$top=50";
            if (sFilterEmpId) url += `&$filter=employee_employeeId eq '${sFilterEmpId}'`;

            fetch(url, { headers: { "Accept": "application/json" }, credentials: "include" })
                .then(r => r.json())
                .then(data => {
                    const ratings = data.value || [];
                    this._oModel.setProperty("/ratings",          ratings);
                    this._oModel.setProperty("/ratingsTableHTML", this._buildRatingsTable(ratings));
                })
                .catch(() => {
                    this._oModel.setProperty("/ratingsTableHTML", this._buildEmptyTable());
                });
        },

        // ── Employee selection change ─────────────────────────────────────────
        onEmployeeChange(oEvent) {
            const sKey = oEvent.getSource().getSelectedKey();
            const emp  = this._oModel.getProperty("/employees").find(e => e.employeeId === sKey);
            if (emp) {
                this._oModel.setProperty("/form/employeeId",   emp.employeeId);
                this._oModel.setProperty("/form/employeeName", emp.employeeName);
            }
        },

        // ── History filter change ─────────────────────────────────────────────
        onHistoryEmployeeChange(oEvent) {
            this._loadAllRatings(oEvent.getSource().getSelectedKey() || null);
        },

        // ── Slider change ─────────────────────────────────────────────────────
        onRatingChange(oEvent) {
            const val = parseFloat(oEvent.getParameter("value") || 3);
            this._oModel.setProperty("/form/ratingValue", val);
            this._oModel.setProperty("/form/starsHTML",   this._buildStarsHTML(val));
            this._oModel.setProperty("/form/ratingLabel", this._getRatingLabel(val));
        },

        // ── Submit rating ─────────────────────────────────────────────────────
        onSubmitRating() {
            const form  = this._oModel.getProperty("/form");

            if (!form.employeeId) {
                sap.m.MessageBox.warning("Please select an employee.");
                return;
            }

            const month = parseInt(this.byId("monthSelect").getSelectedKey(), 10);
            const year  = parseInt(this.byId("yearSelect").getSelectedKey(),  10);
            const val   = parseFloat(this._oModel.getProperty("/form/ratingValue"));

            callManagerAction("submitPerformanceRating", {
                employeeId:     form.employeeId,
                ratingValue:    val,
                reviewMonth:    month,
                reviewYear:     year,
                reviewComment:  form.comment || "",
                ratingCategory: this._getRatingLabel(val)
            })
                .then(() => {
                    sap.m.MessageToast.show(
                        `Rating ${val.toFixed(1)} submitted for ${form.employeeName} — ${MONTH_NAMES[month]} ${year}`
                    );
                    this._oModel.setProperty("/form/employeeId",   "");
                    this._oModel.setProperty("/form/employeeName", "");
                    this._oModel.setProperty("/form/comment",      "");
                    this._oModel.setProperty("/form/ratingValue",  3.0);
                    this._oModel.setProperty("/form/starsHTML",    this._buildStarsHTML(3.0));
                    this._oModel.setProperty("/form/ratingLabel",  "Average");
                    this.byId("empSelect").setSelectedKey("");
                    this._loadAllRatings();
                })
                .catch(oErr => {
                    let msg = "Failed to submit rating.";
                    try {
                        const parsed = JSON.parse(oErr.message);
                        if (parsed?.error?.message) msg = parsed.error.message;
                    } catch (e) {
                        if (oErr?.message) msg = oErr.message;
                    }
                    sap.m.MessageBox.error(msg);
                });
        },

        // ── Helpers ───────────────────────────────────────────────────────────
        _getRatingLabel(val) {
            if (val >= 4.5) return "Excellent";
            if (val >= 3.5) return "Good";
            if (val >= 2.5) return "Average";
            return "Needs Improvement";
        },

        _getRatingColor(val) {
            if (val >= 4.5) return "#16a34a";
            if (val >= 3.5) return "#3b82f6";
            if (val >= 2.5) return "#f59e0b";
            return "#dc2626";
        },

        _buildStarsHTML(val) {
            const full  = Math.floor(val);
            const half  = (val - full) >= 0.25 && (val - full) < 0.75;
            const empty = 5 - full - (half ? 1 : 0);
            let html = '<div style="display:flex;gap:4px;margin:8px 0;">';
            for (let i = 0; i < full;  i++) html += '<span style="font-size:1.8rem;color:#f59e0b;">★</span>';
            if (half)                        html += '<span style="font-size:1.8rem;color:#f59e0b;">½</span>';
            for (let i = 0; i < empty; i++) html += '<span style="font-size:1.8rem;color:#d1d5db;">★</span>';
            html += `<span style="font-size:1.2rem;font-weight:700;color:#111827;margin-left:8px;align-self:center;">${val.toFixed(1)}/5</span>`;
            html += '</div>';
            return html;
        },

        _buildEmptyTable() {
            return `<div style="text-align:center;padding:32px;color:#9ca3af;font-size:0.88rem;">No ratings found.</div>`;
        },

        _buildRatingsTable(ratings) {
            if (!ratings || ratings.length === 0) return this._buildEmptyTable();

            const rows = ratings.map(r => {
                const val      = parseFloat(r.ratingValue || 0);
                const color    = this._getRatingColor(val);
                const label    = this._getRatingLabel(val);
                const monthLbl = MONTH_NAMES[r.reviewMonth] || r.reviewMonth;
                const full     = Math.floor(val);
                const empty    = 5 - full;
                let stars = '';
                for (let i = 0; i < full;  i++) stars += '<span style="color:#f59e0b;">★</span>';
                for (let i = 0; i < empty; i++) stars += '<span style="color:#d1d5db;">★</span>';
                return `
                <tr style="border-bottom:1px solid #f3f4f6;">
                    <td style="padding:12px 16px;font-size:0.85rem;color:#111827;font-weight:500;">${r.employee_employeeId || "—"}</td>
                    <td style="padding:12px 16px;font-size:0.85rem;color:#374151;">${monthLbl} ${r.reviewYear}</td>
                    <td style="padding:12px 16px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:1rem;font-weight:700;color:${color};">${val.toFixed(1)}</span>
                            <span style="font-size:0.9rem;">${stars}</span>
                        </div>
                    </td>
                    <td style="padding:12px 16px;">
                        <span style="background:${color}18;color:${color};padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">${label}</span>
                    </td>
                    <td style="padding:12px 16px;font-size:0.82rem;color:#6b7280;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.reviewComment || "—"}</td>
                </tr>`;
            }).join("");

            return `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                            <th style="padding:12px 16px;text-align:left;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Employee</th>
                            <th style="padding:12px 16px;text-align:left;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Period</th>
                            <th style="padding:12px 16px;text-align:left;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Rating</th>
                            <th style="padding:12px 16px;text-align:left;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Category</th>
                            <th style="padding:12px 16px;text-align:left;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }
    });
});