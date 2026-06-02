sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "timesheet/app/util/CustomDialog",
    "sap/m/TextArea",
    "sap/m/Button",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], (Controller, JSONModel, MessageToast, MessageBox, Dialog, TextArea, Button, Filter, FilterOperator) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.LeaveApprovals", {

        onInit() {
            this._bInitialized = false;
            this._sFilter = "Pending";

            this._oModel = new JSONModel({ requests: [], allRequests: [] });
            this.getView().setModel(this._oModel, "leaveMgr");

            this.getOwnerComponent().getRouter()
                .getRoute("leave-approvals")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            if (this._bInitialized) {
                this._loadRequests();
                return;
            }
            this._bInitialized = true;
            this._loadRequests();
        },

        _loadRequests() {
            const oManagerModel = this.getOwnerComponent().getModel("manager");
            if (!oManagerModel) {
                MessageToast.show("Manager service not available.");
                return;
            }

            oManagerModel.bindList("/LeaveRequests").requestContexts(0, 500)
                .then(aCtx => {
                    const all = aCtx.map(c => c.getObject()).filter(Boolean);

                    const oComp = this.getOwnerComponent();
                    const empPromises = all.map(r => {
                        if (oComp.getEmployeeById) {
                            return oComp.getEmployeeById(r.employee_employeeId)
                                .then(emp => {
                                    r.employeeName = emp ? emp.employeeName : r.employee_employeeId;
                                    return r;
                                })
                                .catch(() => {
                                    r.employeeName = r.employee_employeeId;
                                    return r;
                                });
                        }
                        r.employeeName = r.employee_employeeId;
                        return Promise.resolve(r);
                    });

                    Promise.all(empPromises).then(enriched => {
                        this._oModel.setProperty("/allRequests", enriched);
                        this._applyFilter();
                    });
                })
                .catch(err => {
                    console.error("Failed to load leave requests:", err);
                    MessageToast.show("Could not load leave requests.");
                });
        },

        _applyFilter() {
            const all = this._oModel.getProperty("/allRequests") || [];
            const filtered = this._sFilter === "All"
                ? all
                : all.filter(r => r.status === this._sFilter);
            this._oModel.setProperty("/requests", filtered);
        },

        onFilterChange(oEvent) {
            this._sFilter = oEvent.getParameter("item").getKey();
            this._applyFilter();
        },

        onRefresh() {
            this._loadRequests();
        },

        onApprove(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("leaveMgr");
            const oItem = oCtx.getObject();

            MessageBox.confirm(
                `Approve ${oItem.leaveType} leave for ${oItem.employeeName} (${oItem.days} day(s))?`,
                {
                    title:            "Confirm Approval",
                    actions:          [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) return;
                        this._submitDecision(oItem, true, "");
                    }
                }
            );
        },

        onReject(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("leaveMgr");
            const oItem = oCtx.getObject();

            const oTA = new TextArea({
                placeholder: "Reason for rejection (optional)...",
                rows:        3,
                width:       "100%"
            });

            const oDialog = new Dialog({
                title: "Reject Leave Request",
                content: [oTA],
                beginButton: new Button({
                    text:  "Reject",
                    type:  "Reject",
                    press: () => {
                        const remarks = oTA.getValue();
                        oDialog.close();
                        oDialog.destroy();
                        this._submitDecision(oItem, false, remarks);
                    }
                }),
                endButton: new Button({
                    text:  "Cancel",
                    press: () => {
                        oDialog.close();
                        oDialog.destroy();
                    }
                })
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        // ── Submit the approval/rejection to the backend ──────────────────
        // oItem is the full leave request object (has employeeName, leaveType,
        // days, employee_employeeId, etc.)
        _submitDecision(oItem, approved, remarks) {
            const oManagerModel = this.getOwnerComponent().getModel("manager");
            if (!oManagerModel) return;

            const oCtx = oManagerModel.bindContext("/approveLeave(...)");
            oCtx.setParameter("leaveId",  oItem.leaveId);
            oCtx.setParameter("approved", approved);
            oCtx.setParameter("remarks",  remarks || "");

            oCtx.execute()
                .then(() => {
                    const sVerb = approved ? "approved" : "rejected";
                    MessageToast.show(`Leave request ${sVerb} successfully.`);

                    // ── Push notification to the employee ──────────────────
                    this._pushLeaveNotification(oItem, approved, remarks);

                    this._loadRequests();
                })
                .catch(err => {
                    MessageBox.error(
                        (err && err.message) || "Could not process leave request.",
                        { title: "Error" }
                    );
                });
        },

        // ── Build and persist a notification for the requesting employee ──
        _pushLeaveNotification(oItem, approved, remarks) {
            try {
                const oComp       = this.getOwnerComponent();
                const oNotifModel = oComp.getModel("notifications");
                if (!oNotifModel) return;

                // ── Resolve the employee ID robustly ─────────────────────────
                // OData v4 may flatten "employee/employeeId" → "employee_employeeId"
                // or keep it nested. Check both.
                const recipientId = oItem.employee_employeeId
                    || (oItem.employee && oItem.employee.employeeId)
                    || oItem.employeeId
                    || "";

                if (!recipientId) {
                    console.warn("_pushLeaveNotification: could not resolve recipientEmployeeId", oItem);
                    return;
                }

                const items = oNotifModel.getProperty("/items") || [];

                // Human-readable date range, e.g. "14 May – 16 May 2026"
                const fmtDate = (s) => {
                    if (!s) return "";
                    const d = new Date(s);
                    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
                };
                const weekRange = `${fmtDate(oItem.fromDate)} - ${fmtDate(oItem.toDate)}`;

                // Manager display name
                const sManagerId   = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : "";
                const sManagerName = oComp._builtinEmployees && oComp._builtinEmployees[sManagerId]
                    ? oComp._builtinEmployees[sManagerId].employeeName
                    : "Your manager";

                let message;
                if (approved) {
                    message = `${sManagerName} approved your ${oItem.leaveType} Leave request (${oItem.days} day(s)) from ${weekRange}.`;
                } else {
                    message = `${sManagerName} rejected your ${oItem.leaveType} Leave request (${oItem.days} day(s)) from ${weekRange}.`
                            + (remarks ? ` Reason: ${remarks}` : "");
                }

                const oNotif = {
                    type:                 approved ? "approved" : "rejected",
                    message:              message,
                    weekRange:            weekRange,
                    recipientEmployeeId:  recipientId,  // ← only this employee sees it
                    read:                 false,
                    timestamp:            new Date().toISOString()
                };

                items.unshift(oNotif);   // newest first
                oNotifModel.setProperty("/items", items);
                oComp.persistNotifications();   // write to localStorage
           
                console.info("Notification pushed for", recipientId, oNotif);

            } catch (e) {
                // Non-critical — notification failure must not break the approval flow
                console.warn("Failed to push leave notification:", e);
            }
        }
    });
});