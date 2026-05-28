sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], (Controller, JSONModel, MessageToast, MessageBox, Filter, FilterOperator) => {
    "use strict";

    // Max balances per leave type
    const MAX_BALANCE = {
        Casual: 5,
        Sick: 5,
        Paid: 11,
        Maternity: 180,
        Paternity: 2
    };

    const CASCADE_ORDER = ["Sick", "Casual", "Paid"];

    const EMPTY_FORM = () => ({
        leaveType: "",
        fromDate: null,
        toDate: null,
        days: 0,
        reason: "",
        isUnpaid: false,
        cascade: null
    });

    return Controller.extend("timesheet.app.controller.ApplyLeave", {

        onInit() {
            this._bInitialized = false;

            this._oLeaveModel = new JSONModel({
                form: EMPTY_FORM(),
                history: [],
                balance: {
                    casual: 5,
                    sick: 5,
                    paid: 11,
                    maternity: 180,
                    paternity: 2
                },
                submitting: false
            });
            this.getView().setModel(this._oLeaveModel, "leave");

            this.getOwnerComponent().getRouter()
                .getRoute("apply-leave")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            if (this._bInitialized) {
                this._loadHistory();
                return;
            }
            this._bInitialized = true;

            const today = new Date();
            const oDpFrom = this.byId("dpFrom");
            const oDpTo = this.byId("dpTo");

            if (oDpFrom) {
                oDpFrom.setMinDate(today);
                // Force week numbers off on the internal calendar
                oDpFrom.attachAfterValueHelpOpen(() => {
                    const oCal = oDpFrom._getCalendar ? oDpFrom._getCalendar() : null;
                    if (oCal) oCal.setShowWeekNumbers(false);
                });
            }

            if (oDpTo) {
                oDpTo.setMinDate(today);
                oDpTo.attachAfterValueHelpOpen(() => {
                    const oCal = oDpTo._getCalendar ? oDpTo._getCalendar() : null;
                    if (oCal) oCal.setShowWeekNumbers(false);
                });
            }

            this._loadHistory();
        },

        // ── Load leave history + compute remaining balance ────────────────
        _loadHistory() {
            const oComp = this.getOwnerComponent();
            const oModel = oComp.getModel();
            if (!oModel) return;

            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId()
                : null;
            if (!sEmpId) return;

            oModel.bindList("/LeaveRequests", null, null, [
                new Filter("employee_employeeId", FilterOperator.EQ, sEmpId)
            ]).requestContexts(0, 200)
                .then(aCtx => {
                    const history = aCtx.map(c => c.getObject()).filter(Boolean);
                    this._oLeaveModel.setProperty("/history", history);
                    this._computeBalance(history);
                })
                .catch(() => {
                    this._oLeaveModel.setProperty("/history", []);
                });
        },

        // ── BUG FIX 1: Cascade balance computation ────────────────────────
        // Previously, cascade was only stored locally (optimistic record) and
        // lost after OData reload. Now we compute cascade directly from the
        // raw record fields (leaveType, days, isUnpaid) so it works even when
        // cascade is not persisted on the backend record.
        _computeBalance(history) {
            // Track total days used per type (only from non-Rejected leaves)
            const used = { Casual: 0, Sick: 0, Paid: 0, Maternity: 0, Paternity: 0 };

            history
                .filter(r => r.status !== "Rejected")
                .forEach(r => {
                    const days = r.days || 0;
                    if (!days) return;

                    if (r.cascade) {
                        // ── Local optimistic record: cascade object is present ──
                        // Deduct exactly what the cascade breakdown says.
                        ["Sick", "Casual", "Paid"].forEach(t => {
                            const key = t.toLowerCase();
                            if (r.cascade[key] && used[t] !== undefined) {
                                used[t] += r.cascade[key];
                            }
                        });

                    } else if (r.leaveType === "Sick") {
                        // ── Backend record for a Sick leave (no cascade object) ──
                        // Re-derive the cascade breakdown from current MAX_BALANCE
                        // because the backend doesn't store per-bucket splits.
                        // We simulate the same waterfall: Sick → Casual → Paid → Unpaid.
                        //
                        // IMPORTANT: We use the already-accumulated `used` values up
                        // to this point so earlier leaves are respected in order.
                        // Records are processed in chronological order (oldest first).
                        let remaining = days;

                        // Sick bucket
                        const sickAvail = Math.max(0, MAX_BALANCE.Sick - used.Sick);
                        const fromSick = Math.min(remaining, sickAvail);
                        used.Sick += fromSick;
                        remaining -= fromSick;

                        // Casual bucket (cascade)
                        if (remaining > 0) {
                            const casualAvail = Math.max(0, MAX_BALANCE.Casual - used.Casual);
                            const fromCasual = Math.min(remaining, casualAvail);
                            used.Casual += fromCasual;
                            remaining -= fromCasual;
                        }

                        // Paid bucket (cascade)
                        if (remaining > 0) {
                            const paidAvail = Math.max(0, MAX_BALANCE.Paid - used.Paid);
                            const fromPaid = Math.min(remaining, paidAvail);
                            used.Paid += fromPaid;
                            remaining -= fromPaid;
                        }
                        // remaining > 0 here means Unpaid — no bucket to deduct

                    } else {
                        // ── All other leave types ──
                        if (!r.isUnpaid && used[r.leaveType] !== undefined) {
                            used[r.leaveType] += days;
                        } else if (r.isUnpaid && used[r.leaveType] !== undefined) {
                            // Partially unpaid: only deduct the portion that fits in balance
                            const avail = Math.max(0, MAX_BALANCE[r.leaveType] - used[r.leaveType]);
                            used[r.leaveType] += Math.min(days, avail);
                        }
                    }
                });

            this._oLeaveModel.setProperty("/balance", {
                casual: Math.max(0, MAX_BALANCE.Casual - used.Casual),
                sick: Math.max(0, MAX_BALANCE.Sick - used.Sick),
                paid: Math.max(0, MAX_BALANCE.Paid - used.Paid),
                maternity: Math.max(0, MAX_BALANCE.Maternity - used.Maternity),
                paternity: Math.max(0, MAX_BALANCE.Paternity - used.Paternity)
            });
        },

        // ── Date change → recalculate working days ────────────────────────
        onDateChange() {
            const f = this._oLeaveModel.getProperty("/form");

            // Keep To date minimum in sync with From date
            const oDpTo = this.byId("dpTo");
            if (f.fromDate && oDpTo) {
                const oMinTo = new Date(f.fromDate);
                oDpTo.setMinDate(oMinTo);
            }

            if (!f.fromDate || !f.toDate) return;

            const from = new Date(f.fromDate);
            const to = new Date(f.toDate);

            if (to < from) {
                this._oLeaveModel.setProperty("/form/toDate", null);
                MessageToast.show("To Date must be after From Date.");
                return;
            }

            const days = this._countWorkingDays(from, to);
            this._oLeaveModel.setProperty("/form/days", days);
            this._recalcCascade(f.leaveType, days);
        },

        onLeaveTypeChange(oEvent) {
            const sType = oEvent.getSource().getSelectedKey();
            this._oLeaveModel.setProperty("/form/leaveType", sType);
            const days = this._oLeaveModel.getProperty("/form/days");
            if (days > 0) this._recalcCascade(sType, days);
        },

        // ── Core cascade calculation ──────────────────────────────────────
        _recalcCascade(leaveType, days) {
            if (!leaveType || !days) return;

            const bal = this._oLeaveModel.getProperty("/balance");

            if (leaveType === "Sick") {
                let remaining = days;
                const cascade = { sick: 0, casual: 0, paid: 0, unpaid: 0 };

                const fromSick = Math.min(remaining, bal.sick);
                cascade.sick = fromSick;
                remaining -= fromSick;

                if (remaining > 0) {
                    const fromCasual = Math.min(remaining, bal.casual);
                    cascade.casual = fromCasual;
                    remaining -= fromCasual;
                }

                if (remaining > 0) {
                    const fromPaid = Math.min(remaining, bal.paid);
                    cascade.paid = fromPaid;
                    remaining -= fromPaid;
                }

                cascade.unpaid = remaining;

                this._oLeaveModel.setProperty("/form/cascade", cascade);
                this._oLeaveModel.setProperty("/form/isUnpaid", cascade.unpaid > 0);

            } else {
                const balKey = leaveType.toLowerCase();
                const balAmt = bal[balKey] || 0;
                const isUnpaid = days > balAmt;

                this._oLeaveModel.setProperty("/form/cascade", null);
                this._oLeaveModel.setProperty("/form/isUnpaid", isUnpaid);
            }
        },

        _buildCascadeSummary(cascade, days) {
            const lines = [];
            if (cascade.sick > 0) lines.push(`• ${cascade.sick} day(s) from Sick Leave balance`);
            if (cascade.casual > 0) lines.push(`• ${cascade.casual} day(s) from Casual Leave balance`);
            if (cascade.paid > 0) lines.push(`• ${cascade.paid} day(s) from Paid Leave balance`);
            if (cascade.unpaid > 0) lines.push(`• ${cascade.unpaid} day(s) as Unpaid Leave (no balance remaining)`);
            return `You are applying for ${days} day(s) of Sick Leave.\nHere is how the days will be deducted:\n\n${lines.join("\n")}\n\nDo you want to proceed?`;
        },

        _countWorkingDays(from, to) {
            let count = 0;
            const cur = new Date(from);
            while (cur <= to) {
                const day = cur.getDay();
                if (day !== 0 && day !== 6) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count;
        },

        // ── BUG FIX 2: Date overlap check ────────────────────────────────
        // Checks whether the requested [fromDate, toDate] overlaps with any
        // existing non-Rejected leave in history.
        _getOverlappingLeave(fromDate, toDate) {
            const history = this._oLeaveModel.getProperty("/history") || [];
            const newFrom = new Date(fromDate).getTime();
            const newTo = new Date(toDate).getTime();

            return history.find(r => {
                if (r.status === "Rejected") return false;
                const rFrom = new Date(r.fromDate).getTime();
                const rTo = new Date(r.toDate).getTime();
                // Two ranges overlap if: start1 <= end2 AND start2 <= end1
                return newFrom <= rTo && rFrom <= newTo;
            }) || null;
        },

        // ── Validate ──────────────────────────────────────────────────────
        _validate() {
            const f = this._oLeaveModel.getProperty("/form");
            const errs = [];

            const setErr = (id, msg) => {
                const o = this.byId(id);
                if (o && o.setValueState) {
                    o.setValueState("Error");
                    o.setValueStateText(msg);
                }
                errs.push("• " + msg);
            };
            const clr = (id) => {
                const o = this.byId(id);
                if (o && o.setValueState) o.setValueState("None");
            };

            if (!f.leaveType) {
                setErr("selLeaveType", "Please select a leave type");
            } else { clr("selLeaveType"); }

            if (!f.fromDate) {
                setErr("dpFrom", "From Date is required");
            } else { clr("dpFrom"); }

            if (!f.toDate) {
                setErr("dpTo", "To Date is required");
            } else { clr("dpTo"); }

            if (f.fromDate && f.toDate && new Date(f.toDate) < new Date(f.fromDate)) {
                setErr("dpTo", "To Date must be after From Date");
            }

            // ── Overlap validation ────────────────────────────────────────
            if (f.fromDate && f.toDate && new Date(f.toDate) >= new Date(f.fromDate)) {
                const overlap = this._getOverlappingLeave(f.fromDate, f.toDate);
                if (overlap) {
                    const fromStr = overlap.fromDate
                        ? new Date(overlap.fromDate).toLocaleDateString()
                        : overlap.fromDate;
                    const toStr = overlap.toDate
                        ? new Date(overlap.toDate).toLocaleDateString()
                        : overlap.toDate;
                    setErr("dpFrom",
                        `You already have a ${overlap.leaveType} leave (${overlap.status}) ` +
                        `from ${fromStr} to ${toStr}. ` +
                        `Overlapping dates are not allowed.`
                    );
                    setErr("dpTo", "Overlapping with an existing leave request");
                }
            }

            if (!f.reason || !f.reason.trim()) {
                setErr("taReason", "Reason is required");
            } else { clr("taReason"); }

            if (f.days <= 0) {
                errs.push("• Selected dates have no working days");
            }

            return errs;
        },

        // ── Submit ────────────────────────────────────────────────────────
        onSubmit() {
            const errs = this._validate();
            if (errs.length) {
                MessageBox.error(errs.join("\n"), { title: "Please fix the errors" });
                return;
            }

            const oComp = this.getOwnerComponent();
            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;

            if (!sEmpId) {
                MessageBox.error("Could not identify current employee. Please re-login.");
                return;
            }

            oComp.getEmployeeById(sEmpId).then(emp => {
                if (emp && emp.designation && emp.designation.toLowerCase() === "founder") {
                    MessageBox.warning("Founders are not eligible to apply for leave.");
                    return;
                }
                this._confirmAndSubmit(sEmpId);
            }).catch(() => this._confirmAndSubmit(sEmpId));
        },

        // ── Show confirm dialog for cascade, then submit ──────────────────
        _confirmAndSubmit(sEmpId) {
            const f = this._oLeaveModel.getProperty("/form");

            if (f.leaveType === "Sick" && f.cascade) {
                const cascade = f.cascade;
                const needsMoreThanSick = (cascade.casual + cascade.paid + cascade.unpaid) > 0;

                if (needsMoreThanSick) {
                    const sMsg = this._buildCascadeSummary(cascade, f.days);
                    MessageBox.confirm(sMsg, {
                        title: "Confirm Leave Deduction",
                        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                        emphasizedAction: MessageBox.Action.OK,
                        onClose: (sAction) => {
                            if (sAction === MessageBox.Action.OK) {
                                this._submitLeave(sEmpId);
                            }
                        }
                    });
                    return;
                }
            }

            if (f.isUnpaid) {
                const bal = this._oLeaveModel.getProperty("/balance");
                const balKey = f.leaveType.toLowerCase();
                const balAmt = bal[balKey] || 0;
                const unpaid = f.days - balAmt;
                MessageBox.confirm(
                    `You only have ${balAmt} day(s) of ${f.leaveType} Leave remaining.\n${unpaid} day(s) will be marked as Unpaid Leave.\n\nDo you want to proceed?`,
                    {
                        title: "Insufficient Balance",
                        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                        emphasizedAction: MessageBox.Action.OK,
                        onClose: (sAction) => {
                            if (sAction === MessageBox.Action.OK) {
                                this._submitLeave(sEmpId);
                            }
                        }
                    }
                );
                return;
            }

            this._submitLeave(sEmpId);
        },

        // ── submitLeave ──────────────────────────────────────────────────
        _submitLeave(sEmpId) {
            this._oLeaveModel.setProperty("/submitting", true);

            const oModel = this.getOwnerComponent().getModel();
            if (!oModel) {
                this._oLeaveModel.setProperty("/submitting", false);
                MessageBox.error("Employee service not available.");
                return;
            }

            const f = this._oLeaveModel.getProperty("/form");
            const bal = this._oLeaveModel.getProperty("/balance");
            const balKey = f.leaveType.toLowerCase();
            const balAmt = bal[balKey] || 0;
            const isUnpaid = f.leaveType === "Sick"
                ? (f.cascade && f.cascade.unpaid > 0)
                : (f.days > balAmt);

            const oCtx = oModel.bindContext("/applyLeave(...)");
            oCtx.setParameter("employeeId", sEmpId);
            oCtx.setParameter("leaveType", f.leaveType);
            oCtx.setParameter("fromDate", f.fromDate);
            oCtx.setParameter("toDate", f.toDate);
            oCtx.setParameter("days", f.days);
            oCtx.setParameter("reason", f.reason.trim());
            oCtx.setParameter("isUnpaid", isUnpaid);

            oCtx.execute()
                .then(() => {
                    this._oLeaveModel.setProperty("/submitting", false);

                    let msg = "Leave request submitted successfully.\nYour manager will review it shortly.";

                    if (f.leaveType === "Sick" && f.cascade) {
                        const c = f.cascade;
                        const parts = [];
                        if (c.sick > 0) parts.push(`${c.sick} from Sick`);
                        if (c.casual > 0) parts.push(`${c.casual} from Casual`);
                        if (c.paid > 0) parts.push(`${c.paid} from Paid`);
                        if (c.unpaid > 0) parts.push(`${c.unpaid} Unpaid`);
                        msg = `Leave request submitted.\nDeduction breakdown: ${parts.join(", ")}.`;
                    } else if (isUnpaid) {
                        const unpaid = f.days - balAmt;
                        msg = `Leave request submitted.\nNote: ${unpaid} day(s) will be Unpaid Leave due to insufficient balance.`;
                    }

                    // Optimistic local history record WITH cascade object
                    // so _computeBalance works before the OData reload finishes.
                    const history = this._oLeaveModel.getProperty("/history") || [];
                    const localRecord = {
                        leaveType: f.leaveType,
                        fromDate: f.fromDate,
                        toDate: f.toDate,
                        days: f.days,
                        reason: f.reason.trim(),
                        status: "Pending",
                        isUnpaid: isUnpaid,
                        cascade: (f.leaveType === "Sick" && f.cascade)
                            ? {
                                sick: f.cascade.sick || 0,
                                casual: f.cascade.casual || 0,
                                paid: f.cascade.paid || 0,
                                unpaid: f.cascade.unpaid || 0
                            }
                            : null
                    };
                    history.unshift(localRecord);
                    this._oLeaveModel.setProperty("/history", history);
                    this._computeBalance(history);

                    MessageBox.success(msg, {
                        title: "Submitted",
                        onClose: () => {
                            this.onReset();
                            this._loadHistory();
                        }
                    });
                })
                .catch(err => {
                    this._oLeaveModel.setProperty("/submitting", false);
                    MessageBox.error(
                        (err && err.message) || "Failed to submit leave request.",
                        { title: "Error" }
                    );
                });
        },

        onReset() {
            this._oLeaveModel.setProperty("/form", EMPTY_FORM());
            ["selLeaveType", "dpFrom", "dpTo", "taReason"].forEach(id => {
                const o = this.byId(id);
                if (o && o.setValueState) o.setValueState("None");
            });
        }
    });
});