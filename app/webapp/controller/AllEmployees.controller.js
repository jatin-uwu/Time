sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast"
], (Controller, JSONModel, Filter, FilterOperator, MessageToast) => {
    "use strict";

    return Controller.extend("timesheet.app.controller.AllEmployees", {

        onInit() {
            this._bInitialized = false;

            this._oEmpModel    = new JSONModel({ items: [], filtered: [] });
            this._oDetailModel = new JSONModel({ hasSelection: false, emp: {}, docs: [], managerName: "" });

            this.getView().setModel(this._oEmpModel,    "emp");
            this.getView().setModel(this._oDetailModel, "detail");

            this.getOwnerComponent().getRouter()
                .getRoute("all-employees")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            if (this._bInitialized) {
                // View already exists — just refresh data, don't recreate
                this._loadEmployees();
                return;
            }
            this._bInitialized = true;
            this._loadEmployees();
        },

        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) {
                MessageToast.show("HR service not available.");
                return;
            }
            oModel.bindList("/Employees").requestContexts(0, 1000)
                .then(aCtx => {
                    const items = aCtx.map(c => c.getObject()).filter(Boolean);
                    items.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));
                    this._oEmpModel.setProperty("/items",    items);
                    this._oEmpModel.setProperty("/filtered", items);
                })
                .catch(err => {
                    MessageToast.show("Could not load employees.");
                    console.error(err);
                });
        },

        onSearch(oEvent) {
            const sQ = (oEvent.getParameter("newValue") || "").toLowerCase().trim();
            const all = this._oEmpModel.getProperty("/items") || [];
            if (!sQ) {
                this._oEmpModel.setProperty("/filtered", all);
                return;
            }
            const filtered = all.filter(e =>
                ["employeeId","employeeName","email","department","designation","mobileNumber"]
                    .some(k => String(e[k] || "").toLowerCase().includes(sQ))
            );
            this._oEmpModel.setProperty("/filtered", filtered);
        },

        onRowSelect(oEvent) {
            const oRow = oEvent.getParameter("rowContext");
            if (!oRow) return;
            const emp = oRow.getObject();
            if (!emp) return;

            this._oDetailModel.setProperty("/emp",          emp);
            this._oDetailModel.setProperty("/hasSelection", true);
            this._oDetailModel.setProperty("/docs",         []);
            this._oDetailModel.setProperty("/managerName",  "");

            this._loadDocuments(emp.employeeId);
            if (emp.manager_employeeId) this._loadManagerName(emp.manager_employeeId);
        },

        _loadDocuments(employeeId) {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) return;
            oModel.bindList("/Documents", null, null, [
                new Filter("employee_employeeId", FilterOperator.EQ, employeeId)
            ]).requestContexts(0, 200)
                .then(aCtx => {
                    const docs = aCtx.map(c => c.getObject()).filter(Boolean);
                    this._oDetailModel.setProperty("/docs", docs);
                })
                .catch(() => this._oDetailModel.setProperty("/docs", []));
        },

        _loadManagerName(managerId) {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) return;
            oModel.bindList("/Employees", null, null, [
                new Filter("employeeId", FilterOperator.EQ, managerId)
            ]).requestContexts(0, 1)
                .then(aCtx => {
                    if (aCtx.length) {
                        const m = aCtx[0].getObject();
                        this._oDetailModel.setProperty("/managerName", `${m.employeeName} (${m.employeeId})`);
                    }
                })
                .catch(() => { });
        },

        onDownloadDoc(oEvent) {
            const oItem = oEvent.getSource();
            const aData = oItem.getCustomData();
            const docId = aData && aData.length ? aData[0].getValue() : null;
            if (!docId) return;

            const oModel = this.getOwnerComponent().getModel("hr");
            const ctx = oModel.bindContext("/getEmployeeDocument(...)");
            ctx.setParameter("documentId", docId);
            ctx.execute().then(() => {
                const r = ctx.getBoundContext().getObject();
                if (!r || !r.dataBase64) {
                    MessageToast.show("Document is empty.");
                    return;
                }
                const bytes = Uint8Array.from(atob(r.dataBase64), c => c.charCodeAt(0));
                const blob  = new Blob([bytes], { type: r.mimeType || "application/octet-stream" });
                const url   = URL.createObjectURL(blob);
                const a     = document.createElement("a");
                a.href = url; a.download = r.fileName || "document";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }).catch(() => MessageToast.show("Could not download document."));
        },

        onAdd() {
            this.getOwnerComponent().getRouter().navTo("add-employee");
        },

        onRefresh() {
            this._loadEmployees();
        }
    });
});