sap.ui.define([
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/ui/core/HTML"
], function (Dialog, Button, HTML) {
    "use strict";

    // Read-only preview of a submitted timesheet — reused by the Manager approval
    // screen ("Preview") and the Approval History screen ("View"). Renders the
    // full task-wise + daily breakdown (HH:MM), highlights custom "Others" tasks,
    // and surfaces submission/approval metadata and remarks.

    const DAYS       = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    function pad2(n) { return String(n).padStart(2, "0"); }
    function toHHMM(dec) {
        const d = parseFloat(dec) || 0;
        let h = Math.floor(d + 1e-9);
        let m = Math.round((d - h) * 60);
        if (m === 60) { h += 1; m = 0; }
        return pad2(h) + ":" + pad2(m);
    }
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    function toISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

    const STATUS_COLOR = {
        Approved: "#16a34a", Rejected: "#dc2626",
        "Partially Approved": "#d97706", Pending: "#d97706", Submitted: "#d97706"
    };

    const CUSTOM_BADGE =
        '<span style="display:inline-block;background:#ede9fe;color:#6d28d9;font-size:0.62rem;' +
        'font-weight:700;padding:1px 7px;border-radius:10px;margin-left:6px;vertical-align:middle;" ' +
        'title="This task was entered by the employee and was not assigned by a manager.">Custom Task</span>';

    function infoRow(label, value) {
        if (value == null || value === "") return "";
        return '<div style="display:flex;gap:8px;margin:2px 0;font-size:0.82rem;">' +
            '<span style="color:#6b7280;min-width:118px;">' + esc(label) + '</span>' +
            '<span style="color:#111827;font-weight:600;">' + value + '</span></div>';
    }

    function buildHTML(sub, entries) {
        const weekStart = sub.weekStart ? new Date(sub.weekStart + "T00:00:00") : null;
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const base = weekStart ? new Date(weekStart) : new Date();
            base.setDate((weekStart ? weekStart.getDate() : base.getDate()) + i);
            weekDates.push(toISO(base));
        }
        const dayHeaderDates = weekDates.map(function (s) {
            const d = new Date(s + "T00:00:00");
            return d.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
        });

        // Group entries → one row per task (custom grouped by text).
        const rowMap = new Map();
        (entries || []).forEach(function (e) {
            const isCustom = !!e.isCustomTask;
            const key = isCustom ? ("__c__" + (e.customTaskText || "")) : (e.task_taskId || "unknown");
            const name = isCustom ? (e.customTaskText || "Custom Task")
                : ((e.task && e.task.taskName) || e.task_taskId || "Unknown Task");
            if (!rowMap.has(key)) {
                rowMap.set(key, { name: name, isCustom: isCustom, days: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } });
            }
            const idx = weekDates.indexOf(e.workDate);
            if (idx >= 0) rowMap.get(key).days[DAYS[idx]] += parseFloat(e.hoursWorked) || 0;
        });
        const rows = Array.from(rowMap.values());
        // Manager-assigned tasks first, custom ("Others") tasks last.
        rows.sort(function (a, b) { return (a.isCustom ? 1 : 0) - (b.isCustom ? 1 : 0); });

        const colTotals = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
        rows.forEach(function (r) { DAYS.forEach(function (d) { colTotals[d] += r.days[d]; }); });
        const weekTotal = DAYS.reduce(function (s, d) { return s + colTotals[d]; }, 0);
        const customCount = rows.filter(function (r) { return r.isCustom; }).length;

        const sColor = STATUS_COLOR[sub.status] || "#374151";

        // ── Header / metadata ──────────────────────────────────────────────
        let html = '<div style="font-family:\'Segoe UI\',Arial,sans-serif;color:#111827;padding:2px 4px 10px;">';
        // Compact in-content title (the dialog's own header is hidden so it can't
        // grow tall and hide the first row).
        html += '<div style="text-align:center;font-size:1rem;font-weight:700;color:#111827;padding:2px 0 10px;">Submitted Timesheet</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:24px;padding:4px 0 14px;border-bottom:1px solid #eef0f2;margin-bottom:12px;">';
        html += '<div style="flex:1;min-width:220px;">';
        html += infoRow("Employee", esc(sub.employeeName || "—") + (sub.employeeId ? ' <span style="color:#9ca3af;font-weight:400;">(' + esc(sub.employeeId) + ')</span>' : ""));
        html += infoRow("Week", esc(sub.weekRange || ""));
        html += infoRow("Submitted On", esc(sub.submittedOn || "—"));
        html += '</div><div style="flex:1;min-width:220px;">';
        html += infoRow("Status", '<span style="color:' + sColor + ';">' + esc(sub.status || "—") + "</span>");
        if (sub.approvalDate) html += infoRow("Decision Date", esc(sub.approvalDate));
        if (sub.approverName) html += infoRow("Approver", esc(sub.approverName));
        html += infoRow("Total Hours", '<span style="color:#2563eb;">' + toHHMM(weekTotal) + " hrs</span>");
        html += "</div></div>";

        // ── Remarks (prominent) ────────────────────────────────────────────
        if (sub.remarks) {
            const isReject = (sub.status === "Rejected");
            html += '<div style="background:' + (isReject ? "#fef2f2" : "#f8faff") + ';border:1px solid ' +
                (isReject ? "#fecaca" : "#e5edff") + ';border-radius:8px;padding:10px 12px;margin-bottom:14px;">' +
                '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:' +
                (isReject ? "#b91c1c" : "#3b5bdb") + ';margin-bottom:2px;">' +
                (isReject ? "Rejection Reason" : "Manager Remarks") + "</div>" +
                '<div style="font-size:0.86rem;color:#374151;">' + esc(sub.remarks) + "</div></div>";
        }

        // ── Workflow status line ───────────────────────────────────────────
        const decided = (sub.status === "Approved" || sub.status === "Rejected" || sub.status === "Partially Approved");
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:0.74rem;">' +
            '<span style="background:#e0f2fe;color:#0369a1;padding:2px 9px;border-radius:10px;font-weight:600;">Submitted</span>' +
            '<span style="color:#cbd5e1;">→</span>' +
            '<span style="background:#eef2ff;color:#4338ca;padding:2px 9px;border-radius:10px;font-weight:600;">Reviewed</span>' +
            '<span style="color:#cbd5e1;">→</span>' +
            '<span style="background:' + (decided ? (sColor + "22") : "#f1f5f9") + ';color:' + (decided ? sColor : "#94a3b8") +
            ';padding:2px 9px;border-radius:10px;font-weight:600;">' + esc(decided ? sub.status : "Decision Pending") + "</span></div>";

        // ── Breakdown table ────────────────────────────────────────────────
        html += '<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
        html += '<thead><tr style="background:#f8fafc;">';
        html += '<th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;min-width:200px;">Task</th>';
        DAY_LABELS.forEach(function (d, i) {
            html += '<th style="text-align:center;padding:8px 6px;border-bottom:1px solid #e5e7eb;border-left:1px solid #f1f5f9;">' +
                d + '<div style="font-weight:400;color:#9ca3af;font-size:0.7rem;">' + dayHeaderDates[i] + "</div></th>";
        });
        html += '<th style="text-align:center;padding:8px 10px;border-bottom:1px solid #e5e7eb;border-left:1px solid #f1f5f9;">Total</th>';
        html += "</tr></thead><tbody>";

        if (!rows.length) {
            html += '<tr><td colspan="9" style="padding:20px;text-align:center;color:#9ca3af;">No entries in this submission.</td></tr>';
        } else {
            rows.forEach(function (r) {
                const rowTotal = DAYS.reduce(function (s, d) { return s + r.days[d]; }, 0);
                const nameHtml = r.isCustom
                    ? '<span style="color:#6d28d9;font-weight:600;">' + esc(r.name) + "</span>" + CUSTOM_BADGE
                    : '<span style="font-weight:500;">' + esc(r.name) + "</span>";
                html += '<tr style="border-bottom:1px solid #f1f5f9;">';
                html += '<td style="padding:8px 12px;">' + nameHtml + "</td>";
                DAYS.forEach(function (d) {
                    const v = r.days[d];
                    html += '<td style="text-align:center;padding:8px 6px;border-left:1px solid #f8fafc;color:' +
                        (v > 0 ? "#111827" : "#cbd5e1") + ';">' + (d === "sun" ? "—" : (v > 0 ? toHHMM(v) : "0:00")) + "</td>";
                });
                html += '<td style="text-align:center;padding:8px 10px;border-left:1px solid #f1f5f9;font-weight:700;">' + toHHMM(rowTotal) + "</td>";
                html += "</tr>";
            });
            // Day totals row
            html += '<tr style="background:#f8fafc;font-weight:700;">';
            html += '<td style="padding:8px 12px;">Daily Total</td>';
            DAYS.forEach(function (d) {
                html += '<td style="text-align:center;padding:8px 6px;border-left:1px solid #eef2f6;">' +
                    (d === "sun" ? "—" : toHHMM(colTotals[d])) + "</td>";
            });
            html += '<td style="text-align:center;padding:8px 10px;border-left:1px solid #eef2f6;color:#2563eb;">' + toHHMM(weekTotal) + "</td>";
            html += "</tr>";
        }
        html += "</tbody></table></div>";

        // ── Footer: weekly total + custom count ────────────────────────────
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:0.86rem;">';
        html += '<span style="color:#6b7280;">' +
            (customCount > 0 ? ('<strong style="color:#6d28d9;">' + customCount + '</strong> custom (Others) task' + (customCount > 1 ? "s" : "")) : "No custom tasks") +
            "</span>";
        html += '<span style="font-weight:700;">Weekly Total: <span style="color:#2563eb;">' + toHHMM(weekTotal) + " hrs</span></span>";
        html += "</div></div>";

        return html;
    }

    return {
        // oComponent — the owner component (for the "manager" OData model)
        // sub — { timesheetId, employeeName, employeeId, weekRange, weekStart,
        //         submittedOn, status, remarks, approvalDate?, approverName? }
        open: function (oComponent, sub) {
            sub = sub || {};
            const show = function (entries) {
                const oHtml = new HTML({ content: buildHTML(sub, entries || []), sanitizeContent: false });
                // Let the dialog size to its content (no empty space for short
                // timesheets) and use the dialog's own vertical scrolling so a tall
                // timesheet stays within the viewport instead of overflowing it.
                // NOTE: do NOT make this resizable — a resizable dialog is sized to
                // the full content height, which pushed the top/bottom off-screen.
                const oDialog = new Dialog({
                    showHeader: false,            // hide the bulky title bar
                    contentWidth: "820px",
                    verticalScrolling: true,
                    horizontalScrolling: false,
                    content: [oHtml],
                    endButton: new Button({ text: "Close", press: function () { oDialog.close(); } }),
                    afterClose: function () { oDialog.destroy(); }
                });
                oDialog.addStyleClass("sapUiContentPadding tsPreviewDialog");
                if (oComponent.getRootControl && oComponent.getRootControl()) {
                    oComponent.getRootControl().addDependent(oDialog);
                }
                oDialog.open();
            };

            const oMgr = oComponent.getModel("manager");
            if (!oMgr || !sub.timesheetId) { show([]); return; }
            oMgr.bindList("/ApprovalEntries", null, null, null, {
                $expand: "task",
                $filter: "timesheet_timesheetId eq '" + sub.timesheetId + "'"
            }).requestContexts(0, 300)
                .then(function (aCtx) { show(aCtx.map(function (c) { return c.getObject(); }).filter(Boolean)); })
                .catch(function () { show([]); });
        }
    };
});
