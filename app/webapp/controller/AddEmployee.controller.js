sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    const EMPTY_FORM = () => ({
        employeeName:      "",
        designation:       "",
        email:             "",
        address:           "",
        mobileNumber:      "",
        managerEmployeeId: "",
        dateOfBirth:       null,
        gender:            "",
        department:        "",
        joiningDate:       null,
        employmentType:    "Permanent",
        aadhaarNumber:     "",
        panNumber:         "",
        emergencyContact:  "",
        bloodGroup:        "",
        bankAccountNumber: "",
        bankName:          "",
        bankIfsc:          "",
        pendingDocs:       [],
        saving:            false
    });

    return Controller.extend("timesheet.app.controller.AddEmployee", {

        onInit() {
            this._oFormModel = new JSONModel(EMPTY_FORM());
            this.getView().setModel(this._oFormModel, "form");

            this._oManagersModel = new JSONModel({ items: [] });
            this.getView().setModel(this._oManagersModel, "managers");

            this.getOwnerComponent().getRouter()
                .getRoute("add-employee")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._loadManagers();
        },

        // Pull existing employees so HR can choose a reporting manager
        // from a dropdown instead of typing a free-text id.
        _loadManagers() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) return;
            oModel.bindList("/Employees").requestContexts(0, 500)
                .then(aCtx => {
                    const items = aCtx.map(c => c.getObject())
                        .filter(e => e && e.employeeId)
                        .map(e => ({ employeeId: e.employeeId, employeeName: e.employeeName || e.employeeId }));
                    this._oManagersModel.setProperty("/items", items);
                })
                .catch(() => { /* no auth in dev — leave empty */ });
        },

        // ── Document selection ───────────────────────────────────────────
        // Multiple files: each file is read into a base64 payload and queued
        // in form>/pendingDocs. The actual upload happens after the
        // EmployeeMaster row is created (so we have an employeeId).
        onDocsSelected(oEvent) {
            const aFiles = oEvent.getParameter("files");
            if (!aFiles || !aFiles.length) return;

            const sType = this.byId("docTypeSel").getSelectedKey();
            const pending = this._oFormModel.getProperty("/pendingDocs") || [];

            Array.from(aFiles).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const result = e.target.result || "";
                    const base64 = String(result).split(",")[1] || "";
                    pending.push({
                        documentType: sType,
                        fileName:     file.name,
                        mimeType:     file.type || "application/octet-stream",
                        size:         file.size,
                        sizeLabel:    this._fmtSize(file.size),
                        dataBase64:   base64
                    });
                    this._oFormModel.setProperty("/pendingDocs", pending.slice());
                };
                reader.readAsDataURL(file);
            });

            // Clear the picker so the same file can be re-added if needed.
            oEvent.getSource().clear();
        },

        onRemovePendingDoc(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("form");
            if (!oCtx) return;
            const sPath = oCtx.getPath();
            const idx = parseInt(sPath.split("/").pop(), 10);
            const pending = this._oFormModel.getProperty("/pendingDocs") || [];
            pending.splice(idx, 1);
            this._oFormModel.setProperty("/pendingDocs", pending.slice());
        },

        // ── Save ─────────────────────────────────────────────────────────
        onSave() {
            const f = this._oFormModel.getData();
            const errors = [];

            if (!f.employeeName || !f.employeeName.trim()) errors.push("Full Name");
            if (!f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.push("Email");
            if (!f.mobileNumber || !/^\d{10,15}$/.test(f.mobileNumber.replace(/\D/g, ""))) errors.push("Mobile");
            if (!f.designation || !f.designation.trim()) errors.push("Designation");

            if (errors.length) {
                MessageBox.error("Please correct: " + errors.join(", "), { title: "Form incomplete" });
                return;
            }

            this._oFormModel.setProperty("/saving", true);

            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) {
                this._oFormModel.setProperty("/saving", false);
                MessageBox.error("HR service is not available.");
                return;
            }

            const oCtx = oModel.bindContext("/addEmployee(...)");
            // Map UI form → action parameters.
            [
                "employeeName","designation","email","address","mobileNumber",
                "managerEmployeeId","dateOfBirth","gender","department",
                "joiningDate","employmentType","aadhaarNumber","panNumber",
                "emergencyContact","bloodGroup","bankAccountNumber","bankName","bankIfsc"
            ].forEach(k => oCtx.setParameter(k, f[k] || null));

            oCtx.execute().then(() => {
                const oResult = oCtx.getBoundContext().getObject();
                const newId = oResult && (oResult.employeeId || oResult.value);
                if (!newId) throw new Error("Server did not return an employeeId.");
                return this._uploadPendingDocs(newId).then(() => newId);
            }).then(newId => {
                this._oFormModel.setProperty("/saving", false);
                MessageBox.success(
                    `Employee ${newId} created successfully.`,
                    { title: "Saved", onClose: () => {
                        this.onReset();
                        this.getOwnerComponent().getRouter().navTo("all-employees");
                    }}
                );
            }).catch(err => {
                this._oFormModel.setProperty("/saving", false);
                const msg = (err && err.message) || "Could not save employee.";
                MessageBox.error(msg, { title: "Save failed" });
            });
        },

        _uploadPendingDocs(employeeId) {
            const docs = this._oFormModel.getProperty("/pendingDocs") || [];
            if (!docs.length) return Promise.resolve();

            const oModel = this.getOwnerComponent().getModel("hr");
            // Sequential to keep memory usage predictable on large CVs.
            return docs.reduce((p, d) => p.then(() => {
                const ctx = oModel.bindContext("/uploadEmployeeDocument(...)");
                ctx.setParameter("employeeId",   employeeId);
                ctx.setParameter("documentType", d.documentType || "Other");
                ctx.setParameter("fileName",     d.fileName);
                ctx.setParameter("mimeType",     d.mimeType);
                ctx.setParameter("description",  "");
                ctx.setParameter("dataBase64",   d.dataBase64);
                return ctx.execute();
            }), Promise.resolve());
        },

        onReset() {
            this._oFormModel.setData(EMPTY_FORM());
        },

        _fmtSize(n) {
            if (!n) return "0 B";
            const u = ["B","KB","MB","GB"];
            let i = 0; let v = n;
            while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
            return v.toFixed(1) + " " + u[i];
        }
    });
});
