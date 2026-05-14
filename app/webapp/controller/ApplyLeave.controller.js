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
        Casual:    5,
        Sick:      5,
        Paid:      11,
        Maternity: 180,
        Paternity: 2
    };

    // Cascade order for Sick leave: Sick → Casual → Paid → Unpaid
    // For other types there is no cascade — they just go unpaid when exhausted.
    const CASCADE_ORDER = ["Sick", "Casual", "Paid"];

    const EMPTY_FORM = () => ({
        leaveType: "",
        fromDate:  null,
        toDate:    null,
        days:      0,
        reason:    "",
        isUnpaid:  false,
        cascade:   null   // will hold { sick:n, casual:n, paid:n, unpaid:n } when relevant
    });

    return Controller.extend("timesheet.app.controller.ApplyLeave", {

        onInit() {
            this._bInitialized = false;

            this._oLeaveModel = new JSONModel({
                form:       EMPTY_FORM(),
                history:    [],
                balance:    {
                    casual:    5,
                    sick:      5,
                    paid:      11,
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
            const oDpFrom = this.byId("dpFrom");
            if (oDpFrom) {
                oDpFrom.setMinDate(new Date());
            }
            this._loadHistory();
        },

        // ── Load leave history + compute remaining balance ────────────────
        _loadHistory() {
            const oComp  = this.getOwnerComponent();
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

        _computeBalance(history) {
            const used = { Casual: 0, Sick: 0, Paid: 0, Maternity: 0, Paternity: 0 };

            history
                .filter(r => r.status !== "Rejected")
                .forEach(r => {
                    // For cascade leaves the individual type buckets are stored
                    // on the record so we can deduct exactly the right amounts.
                    if (r.cascade) {
                        ["Sick","Casual","Paid"].forEach(t => {
                            if (r.cascade[t.toLowerCase()] && used[t] !== undefined) {
                                used[t] += r.cascade[t.toLowerCase()];
                            }
                        });
                    } else if (!r.isUnpaid && used[r.leaveType] !== undefined) {
                        used[r.leaveType] += (r.days || 0);
                    }
                });

            this._oLeaveModel.setProperty("/balance", {
                casual:    Math.max(0, MAX_BALANCE.Casual    - used.Casual),
                sick:      Math.max(0, MAX_BALANCE.Sick      - used.Sick),
                paid:      Math.max(0, MAX_BALANCE.Paid      - used.Paid),
                maternity: Math.max(0, MAX_BALANCE.Maternity - used.Maternity),
                paternity: Math.max(0, MAX_BALANCE.Paternity - used.Paternity)
            });
        },

        // ── Date change → recalculate working days ────────────────────────
        onDateChange() {
            const f = this._oLeaveModel.getProperty("/form");
            if (!f.fromDate || !f.toDate) return;

            const from = new Date(f.fromDate);
            const to   = new Date(f.toDate);

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
        // For Sick leave: deduct from Sick first, then Casual, then Paid,
        // then mark remainder as Unpaid.
        // For all other leave types: deduct from that type only; excess → Unpaid.
        _recalcCascade(leaveType, days) {
            if (!leaveType || !days) return;

            const bal = this._oLeaveModel.getProperty("/balance");

            if (leaveType === "Sick") {
                let remaining = days;
                const cascade = { sick: 0, casual: 0, paid: 0, unpaid: 0 };

                // 1. Deduct from Sick
                const fromSick = Math.min(remaining, bal.sick);
                cascade.sick    = fromSick;
                remaining      -= fromSick;

                // 2. Deduct from Casual
                if (remaining > 0) {
                    const fromCasual = Math.min(remaining, bal.casual);
                    cascade.casual   = fromCasual;
                    remaining       -= fromCasual;
                }

                // 3. Deduct from Paid
                if (remaining > 0) {
                    const fromPaid = Math.min(remaining, bal.paid);
                    cascade.paid   = fromPaid;
                    remaining     -= fromPaid;
                }

                // 4. Anything left → Unpaid
                cascade.unpaid = remaining;

                this._oLeaveModel.setProperty("/form/cascade",  cascade);
                this._oLeaveModel.setProperty("/form/isUnpaid", cascade.unpaid > 0);

            } else {
                // Non-sick types: simple deduction
                const balKey   = leaveType.toLowerCase();
                const balAmt   = bal[balKey] || 0;
                const isUnpaid = days > balAmt;

                this._oLeaveModel.setProperty("/form/cascade",  null);
                this._oLeaveModel.setProperty("/form/isUnpaid", isUnpaid);
            }
        },

        // Build a human-readable summary of the cascade for the confirm dialog
        _buildCascadeSummary(cascade, days) {
            const lines = [];
            if (cascade.sick   > 0) lines.push(`• ${cascade.sick} day(s) from Sick Leave balance`);
            if (cascade.casual > 0) lines.push(`• ${cascade.casual} day(s) from Casual Leave balance`);
            if (cascade.paid   > 0) lines.push(`• ${cascade.paid} day(s) from Paid Leave balance`);
            if (cascade.unpaid > 0) lines.push(`• ${cascade.unpaid} day(s) as Unpaid Leave (no balance remaining)`);
            return `You are applying for ${days} day(s) of Sick Leave.\nHere is how the days will be deducted:\n\n${lines.join("\n")}\n\nDo you want to proceed?`;
        },

        // Count Mon–Fri working days between two dates inclusive
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

        // ── Validate ──────────────────────────────────────────────────────
        _validate() {
            const f    = this._oLeaveModel.getProperty("/form");
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

            const oComp  = this.getOwnerComponent();
            const sEmpId = oComp.getCurrentEmployeeId
                ? oComp.getCurrentEmployeeId() : null;

            if (!sEmpId) {
                MessageBox.error("Could not identify current employee. Please re-login.");
                return;
            }

            // Block Founders from applying leave
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

            // If Sick leave with cascade across multiple buckets → confirm first
            if (f.leaveType === "Sick" && f.cascade) {
                const cascade = f.cascade;
                const needsMoreThanSick = (cascade.casual + cascade.paid + cascade.unpaid) > 0;

                if (needsMoreThanSick) {
                    const sMsg = this._buildCascadeSummary(cascade, f.days);
                    MessageBox.confirm(sMsg, {
                        title:            "Confirm Leave Deduction",
                        actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
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

            // For all other cases (non-sick, or sick with sufficient sick balance)
            // just warn if going unpaid and proceed
            if (f.isUnpaid) {
                const bal     = this._oLeaveModel.getProperty("/balance");
                const balKey  = f.leaveType.toLowerCase();
                const balAmt  = bal[balKey] || 0;
                const unpaid  = f.days - balAmt;
                MessageBox.confirm(
                    `You only have ${balAmt} day(s) of ${f.leaveType} Leave remaining.\n${unpaid} day(s) will be marked as Unpaid Leave.\n\nDo you want to proceed?`,
                    {
                        title:            "Insufficient Balance",
                        actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
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

            const f       = this._oLeaveModel.getProperty("/form");
            const bal     = this._oLeaveModel.getProperty("/balance");
            const balKey  = f.leaveType.toLowerCase();
            const balAmt  = bal[balKey] || 0;
            const isUnpaid = f.leaveType === "Sick"
                ? (f.cascade && f.cascade.unpaid > 0)
                : (f.days > balAmt);

            const oCtx = oModel.bindContext("/applyLeave(...)");
            oCtx.setParameter("employeeId", sEmpId);
            oCtx.setParameter("leaveType",  f.leaveType);
            oCtx.setParameter("fromDate",   f.fromDate);
            oCtx.setParameter("toDate",     f.toDate);
            oCtx.setParameter("days",       f.days);
            oCtx.setParameter("reason",     f.reason.trim());
            oCtx.setParameter("isUnpaid",   isUnpaid);

            oCtx.execute()
                .then(() => {
                    this._oLeaveModel.setProperty("/submitting", false);

                    let msg = "Leave request submitted successfully.\nYour manager will review it shortly.";

                    if (f.leaveType === "Sick" && f.cascade) {
                        const c = f.cascade;
                        const parts = [];
                        if (c.sick   > 0) parts.push(`${c.sick} from Sick`);
                        if (c.casual > 0) parts.push(`${c.casual} from Casual`);
                        if (c.paid   > 0) parts.push(`${c.paid} from Paid`);
                        if (c.unpaid > 0) parts.push(`${c.unpaid} Unpaid`);
                        msg = `Leave request submitted.\nDeduction breakdown: ${parts.join(", ")}.`;
                    } else if (isUnpaid) {
                        const unpaid = f.days - balAmt;
                        msg = `Leave request submitted.\nNote: ${unpaid} day(s) will be Unpaid Leave due to insufficient balance.`;
                    }

                    // ── Persist cascade onto the history record so balance
                    //    recalculation deducts Casual/Paid correctly ──────────────
                    // We optimistically push a local history entry with the cascade
                    // so _computeBalance works even before the OData reload finishes.
                    const history = this._oLeaveModel.getProperty("/history") || [];
                    const localRecord = {
                        leaveType: f.leaveType,
                        fromDate:  f.fromDate,
                        toDate:    f.toDate,
                        days:      f.days,
                        reason:    f.reason.trim(),
                        status:    "Pending",
                        isUnpaid:  isUnpaid,
                        // Store the full cascade so _computeBalance can split the buckets
                        cascade: (f.leaveType === "Sick" && f.cascade)
                            ? {
                                sick:   f.cascade.sick   || 0,
                                casual: f.cascade.casual || 0,
                                paid:   f.cascade.paid   || 0,
                                unpaid: f.cascade.unpaid || 0
                            }
                            : null
                    };
                    history.unshift(localRecord);
                    this._oLeaveModel.setProperty("/history", history);
                    this._computeBalance(history);   // recompute immediately

                    MessageBox.success(msg, {
                        title:   "Submitted",
                        onClose: () => {
                            this.onReset();
                            this._loadHistory();     // then sync with backend
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
            ["selLeaveType","dpFrom","dpTo","taReason"].forEach(id => {
                const o = this.byId(id);
                if (o && o.setValueState) o.setValueState("None");
            });
        }
    });
});