sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "timesheet/app/util/CustomDialog",
    "sap/m/TextArea",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/m/Text"
], (Controller, JSONModel, MessageToast, MessageBox, Dialog, TextArea, Button, Label, VBox, Text) => {
    "use strict";

    const STATUS_STATE = {
        "Pending":  "Warning",
        "Approved": "Success",
        "Rejected": "Error"
    };

    return Controller.extend("timesheet.app.controller.HrApproval", {

        onInit() {
            this._bInitialized = false;
            this._sFilter      = "Pending";

            this._oModel = new JSONModel({
                requests:     [],
                allRequests:  [],
                pendingCount: 0
            });
            this.getView().setModel(this._oModel, "hrView");

            this.getOwnerComponent().getRouter()
                .getRoute("hr-approvals")           // ← match your manifest route name
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._loadRequests();
        },

        // ── Load DayUnlockRequests from HRService (/hr) ───────────────────
        _loadRequests() {
            const oHRModel = this.getOwnerComponent().getModel("hr");
            if (!oHRModel) {
                MessageToast.show("HR service not available.");
                return;
            }

            oHRModel.bindList("/DayUnlockRequests").requestContexts(0, 500)
                .then(aCtx => {
                    const all = aCtx.map(c => c.getObject()).filter(Boolean);

                    // Enrich each request with the employee name
                    const oComp = this.getOwnerComponent();
                    const empPromises = all.map(r => {
                        if (oComp.getEmployeeById) {
                            return oComp.getEmployeeById(r.employee_employeeId)
                                .then(emp => {
                                    r.employeeName = emp
                                        ? emp.employeeName
                                        : r.employee_employeeId;
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
                        const pending = enriched.filter(r => r.status === "Pending").length;
                        this._oModel.setProperty("/allRequests",  enriched);
                        this._oModel.setProperty("/pendingCount", pending);
                        this._applyFilter();
                    });
                })
                .catch(err => {
                    console.error("Failed to load day-unlock requests:", err);
                    MessageToast.show("Could not load day-unlock requests.");
                });
        },

        _applyFilter() {
            const all      = this._oModel.getProperty("/allRequests") || [];
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

        // ── Approve ───────────────────────────────────────────────────────
        onApprove(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("hrView");
            const oItem = oCtx.getObject();

            MessageBox.confirm(
                `Approve day-unlock request for ${oItem.employeeName} on ${oItem.targetDate}?`,
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

        // ── Reject (with reason dialog) ───────────────────────────────────
        onReject(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("hrView");
            const oItem = oCtx.getObject();

            const oTA = new TextArea({
                placeholder: "Reason for rejection (optional)...",
                rows:        3,
                width:       "100%"
            });

            const oDialog = new Dialog({
                title: "Reject Day-Unlock Request",
                content: [
                    new VBox({
                        items: [
                            new Text({
                                text:     "Provide a reason. The employee will be notified.",
                                wrapping: true
                            }).addStyleClass("sapUiSmallMarginBottom"),
                            new Label({ text: "Reason", labelFor: oTA }),
                            oTA
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: new Button({
                    text:  "Reject",
                    type:  "Reject",
                    press: () => {
                        const remarks = oTA.getValue().trim();
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

        // ── Call HRService approveDayUnlock action ────────────────────────
        _submitDecision(oItem, bApproved, sRemarks) {
            const oHRModel = this.getOwnerComponent().getModel("hr");
            if (!oHRModel) return;

            const oCtx = oHRModel.bindContext("/approveDayUnlock(...)");
            oCtx.setParameter("requestId", oItem.requestId);
            oCtx.setParameter("approved",  bApproved);
            oCtx.setParameter("hrRemarks", sRemarks || "");

            oCtx.execute()
                .then(() => {
                    const sVerb = bApproved ? "approved" : "rejected";
                    MessageToast.show(`Day-unlock request ${sVerb} successfully.`);

                    // Push notification to the employee
                    this._pushNotification(oItem, bApproved, sRemarks);

                    this._loadRequests();
                })
                .catch(err => {
                    MessageBox.error(
                        (err && err.message) || "Could not process day-unlock request.",
                        { title: "Error" }
                    );
                });
        },

        // ── Notify the requesting employee ────────────────────────────────
        _pushNotification(oItem, bApproved, sRemarks) {
            try {
                const oComp       = this.getOwnerComponent();
                const oNotifModel = oComp.getModel("notifications");
                if (!oNotifModel) return;

                const recipientId = oItem.employee_employeeId
                    || (oItem.employee && oItem.employee.employeeId)
                    || oItem.employeeId
                    || "";
                if (!recipientId) return;

                const items   = oNotifModel.getProperty("/items") || [];
                const message = bApproved
                    ? `HR approved your day-unlock request for ${oItem.targetDate}.`
                    : `HR rejected your day-unlock request for ${oItem.targetDate}.`
                        + (sRemarks ? ` Reason: ${sRemarks}` : "");

                const oNotif = {
                    type:                bApproved ? "approved" : "rejected",
                    message,
                    weekRange:           oItem.targetDate,
                    recipientEmployeeId: recipientId,
                    read:                false,
                    timestamp:           new Date().toISOString()
                };

                items.unshift(oNotif);
                oNotifModel.setProperty("/items", items);
                oComp.persistNotifications();
            } catch (e) {
                console.warn("Failed to push HR notification:", e);
            }
        },

        // ── Formatter ─────────────────────────────────────────────────────
        formatStatusState(sStatus) {
            return STATUS_STATE[sStatus] || "None";
        }
    });
});