sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], (Controller, JSONModel, Filter, FilterOperator) => {
    "use strict";

    const STATUS_STATE = { "Pending": "Warning", "Approved": "Success", "Rejected": "Error" };

    function fmtDate(sIso) {
        if (!sIso) return "—";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    }

    return Controller.extend("timesheet.app.controller.LeaveHistory", {

        onInit() {
            this._oModel = new JSONModel({
                history:     [],
                totalCount:  0,
                approvedCount: 0,
                pendingCount:  0,
                hasHistory:  false,
                loading:     true,
                statusFilter: "all"
            });
            this.getView().setModel(this._oModel, "lhView");

            this.getOwnerComponent().getRouter()
                .getRoute("leave-history")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._oModel.setProperty("/statusFilter", "all");
            this._loadHistory();
        },

        // Mirrors ApplyLeave._loadHistory — default model, /LeaveRequests filtered to self.
        _loadHistory() {
            this._oModel.setProperty("/loading", true);
            const oComp  = this.getOwnerComponent();
            const oModel = oComp.getModel();
            const sEmpId = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : null;

            if (!oModel || !sEmpId) {
                this._apply([]);
                return;
            }

            oModel.bindList("/LeaveRequests", null, null, [
                new Filter("employee_employeeId", FilterOperator.EQ, sEmpId)
            ]).requestContexts(0, 500)
                .then(aCtx => {
                    const rows = aCtx.map(c => c.getObject()).filter(Boolean);
                    rows.sort((a, b) =>
                        new Date(b.fromDate || b.createdAt || 0) -
                        new Date(a.fromDate || a.createdAt || 0));
                    this._apply(rows);
                })
                .catch(() => this._apply([]));
        },

        _apply(rows) {
            const view = (rows || []).map(r => ({
                leaveType:   r.leaveType || "—",
                fromDate:    fmtDate(r.fromDate),
                toDate:      fmtDate(r.toDate),
                days:        r.days || 0,
                reason:      r.reason || "—",
                status:      r.status || "Pending",
                statusState: STATUS_STATE[r.status] || "None",
                isUnpaid:    !!r.isUnpaid,
                managerRemarks: r.managerRemarks || "—"
            }));

            const sFilter = this._oModel.getProperty("/statusFilter");
            const shown = sFilter === "all"
                ? view
                : view.filter(r => r.status === sFilter);

            this._oModel.setProperty("/history",       shown);
            this._oModel.setProperty("/totalCount",    view.length);
            this._oModel.setProperty("/approvedCount", view.filter(r => r.status === "Approved").length);
            this._oModel.setProperty("/pendingCount",  view.filter(r => r.status === "Pending").length);
            this._oModel.setProperty("/hasHistory",    shown.length > 0);
            this._oModel.setProperty("/loading",       false);
            this._allView = view;
        },

        onStatusFilterChange(oEvent) {
            const sKey = oEvent.getParameter("item")
                ? oEvent.getParameter("item").getKey()
                : oEvent.getSource().getSelectedKey();
            this._oModel.setProperty("/statusFilter", sKey);
            // Re-filter from the cached full list without a network round-trip
            const view = this._allView || [];
            const shown = sKey === "all" ? view : view.filter(r => r.status === sKey);
            this._oModel.setProperty("/history",    shown);
            this._oModel.setProperty("/hasHistory", shown.length > 0);
        },

        onNavToApply() {
            this.getOwnerComponent().getRouter().navTo("apply-leave");
        }
    });
});
