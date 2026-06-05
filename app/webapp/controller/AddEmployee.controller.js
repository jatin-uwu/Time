sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox"
], (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) => {
    "use strict";

    // Plain fetch caller for /hr actions (CSRF + JSON, NO $batch). Large base64
    // document uploads fail inside an OData $batch ("batch failed"), which is why
    // uploading more than one document broke — this bypasses $batch entirely.
    async function callHr(action, params) {
        let token = null;
        try {
            const h = await fetch("/hr/", { headers: { "X-CSRF-Token": "Fetch" }, credentials: "include" });
            token = h.headers.get("x-csrf-token");
        } catch (e) { /* ignore */ }
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers["X-CSRF-Token"] = token;
        const resp = await fetch("/hr/" + action, {
            method: "POST", headers, body: JSON.stringify(params || {}), credentials: "include"
        });
        if (!resp.ok) {
            let detail = resp.statusText;
            try { const j = await resp.json(); detail = (j.error && j.error.message) || detail; }
            catch (e) { try { detail = await resp.text(); } catch (e2) { /* */ } }
            throw new Error(detail);
        }
        const j = await resp.json().catch(() => ({}));
        return (j && j.value !== undefined) ? j.value : j;
    }

    // Combined cap across all queued documents (each file is also capped at 5 MB
    // individually). Keeps one Add-Employee submission from piling on too much.
    const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
    const MAX_TOTAL_LABEL = "25 MB";

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
        employmentType:    "",
        workLocation:      "",
        aadhaarNumber:     "",
        panNumber:         "",
        emergencyContact:  "",
        bloodGroup:        "",
        bankAccountNumber: "",
        bankName:          "",
        bankIfsc:          "",
        maritalStatus:     "",
        fatherName:        "",
        partnerName:       "",
        marriageDate:      null,
        hasKids:           "",
        pendingDocs:       [],
        saving:            false
    });

    // field id map for setting ValueState on controls
    const FIELD_ID_MAP = {
        employeeName:      "inpName",
        email:             "inpEmail",
        mobileNumber:      "inpMobile",
        dateOfBirth:       "inpDOB",
        gender:            "selGender",
        bloodGroup:        "selBlood",
        address:           "inpAddress",
        maritalStatus:     "selMarital",
        fatherName:        "inpFatherName",
        partnerName:       "inpPartnerName",
        marriageDate:      "inpMarriageDate",
        hasKids:           "selKids",
        designation:       "inpDesig",
        department:        "inpDept",
        workLocation:      "selLocation",
        joiningDate:       "inpJoining",
        employmentType:    "selEmpType",
        managerEmployeeId: "cmbManager",
        aadhaarNumber:     "inpAadhaar",
        panNumber:         "inpPan",
        bankAccountNumber: "inpBankAcc",
        bankName:          "inpBankName",
        bankIfsc:          "inpIfsc",
        emergencyContact:  "inpEmergency"
    };

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
            this.onReset();
            this._loadManagers();
        },

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
                .catch(() => {});
        },

        onMaritalChange(oEvent) {
            const sKey = oEvent.getSource().getSelectedKey();
            this._oFormModel.setProperty("/maritalStatus", sKey);
            // Clear conditional fields when status changes
            this._oFormModel.setProperty("/fatherName",   "");
            this._oFormModel.setProperty("/partnerName",  "");
            this._oFormModel.setProperty("/marriageDate", null);
            this._oFormModel.setProperty("/hasKids",      "");
        },

        // ── Validation ───────────────────────────────────────────────────
        _validate() {
            const f    = this._oFormModel.getData();
            const errs = [];

            const check = (field, label, condition, msg) => {
                if (condition) {
                    errs.push(`• ${label}: ${msg}`);
                    this._setFieldState(field, "Error", msg);
                } else {
                    this._setFieldState(field, "None", "");
                }
            };

            // ── Personal ──
            check("employeeName", "Full Name",
                !f.employeeName || !f.employeeName.trim() || !/^[a-zA-Z\s]{2,100}$/.test(f.employeeName.trim()),
                "Required · letters only · min 2 characters");

            check("email", "Email",
                !f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email),
                "Required · invalid email format");

            check("mobileNumber", "Mobile",
                !f.mobileNumber || !/^\d{10,15}$/.test(f.mobileNumber.replace(/\D/g, "")),
                "Required · must be 10–15 digits");

            // Precise calendar age (avoids the 365.25 float drift around birthdays).
            const dobAge = (() => {
                if (!f.dateOfBirth) return null;
                const dob = new Date(f.dateOfBirth), now = new Date();
                let a = now.getFullYear() - dob.getFullYear();
                const mDiff = now.getMonth() - dob.getMonth();
                if (mDiff < 0 || (mDiff === 0 && now.getDate() < dob.getDate())) a--;
                return a;
            })();
            check("dateOfBirth", "Date of Birth",
                dobAge === null || dobAge < 18 || dobAge > 70,
                dobAge === null ? "Required"
                    : dobAge < 18 ? "Employee must be at least 18 years old"
                        : "Age cannot exceed 70");

            check("gender",       "Gender",       !f.gender,       "Required · please select a gender");
            check("bloodGroup",   "Blood Group",  !f.bloodGroup,   "Required · please select blood group");
            check("address",      "Address",      !f.address || !f.address.trim(), "Required");
            check("maritalStatus","Marital Status",!f.maritalStatus,"Required · please select marital status");

            // ── Marital conditional ──
            if (f.maritalStatus === "Single") {
                check("fatherName", "Father Name",
                    !f.fatherName || !f.fatherName.trim() || !/^[a-zA-Z\s]{2,100}$/.test(f.fatherName.trim()),
                    "Required · letters only · min 2 characters");
            }

            if (f.maritalStatus === "Married") {
                check("partnerName", "Partner Name",
                    !f.partnerName || !f.partnerName.trim() || !/^[a-zA-Z\s]{2,100}$/.test(f.partnerName.trim()),
                    "Required · letters only · min 2 characters");

                check("marriageDate", "Marriage Date", (() => {
                    if (!f.marriageDate) return true;
                    if (f.dateOfBirth && new Date(f.marriageDate) <= new Date(f.dateOfBirth)) return true;
                    return false;
                })(), !f.marriageDate ? "Required" : "Must be after date of birth");

                check("hasKids", "Children", !f.hasKids, "Required · please select Yes or No");
            }

            // ── Employment ──
            check("designation",   "Designation",       !f.designation || !f.designation.trim(), "Required");
            check("department",    "Department",         !f.department  || !f.department.trim(),  "Required");
            check("workLocation",  "Work Location",      !f.workLocation,  "Required · please select a location");
            check("joiningDate",   "Joining Date",       !f.joiningDate,   "Required");
            check("employmentType","Employment Type",    !f.employmentType,"Required · please select employment type");
            check("managerEmployeeId", "Reporting Manager", !f.managerEmployeeId, "Required · please select a manager");

            // ── Identity ──
            check("aadhaarNumber", "Aadhaar Number",
                !f.aadhaarNumber || !/^\d{12}$/.test(f.aadhaarNumber.replace(/\D/g, "")),
                "Required · must be 12 digits");

            check("panNumber", "PAN Number",
                !f.panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.panNumber.toUpperCase()),
                "Required · format: ABCDE1234F");

            // ── Bank ──
            check("bankAccountNumber", "Account Number",
                !f.bankAccountNumber || !/^\d{9,18}$/.test(f.bankAccountNumber.replace(/\D/g, "")),
                "Required · must be 9–18 digits");

            check("bankName", "Bank Name", !f.bankName || !f.bankName.trim(), "Required");

            //only SBI bank allowed
            check("bankIfsc", "IFSC Code", (() => {
                    if (!f.bankIfsc) return true;
                    const ifsc = f.bankIfsc.toUpperCase().trim();
                    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return true; // invalid format
                    if (!ifsc.startsWith("SBIN")) return true;              // not SBI
                    return false;
                })(), !f.bankIfsc ? "Required" : 
                    !f.bankIfsc.toUpperCase().startsWith("SBIN") ? 
                    "Only SBI bank accounts are accepted (IFSC must start with SBIN)" : 
                    "Invalid IFSC format · e.g. SBIN0001234");

            // Also validate bank name must be SBI
            check("bankName", "Bank Name", (() => {
                if (!f.bankName || !f.bankName.trim()) return true;
                const name = f.bankName.trim().toLowerCase();
                return !["sbi", "state bank of india", "state bank"].some(v => name.includes(v));
            })(), !f.bankName ? "Required" : "Only SBI bank accounts are accepted");

            // ── Emergency Contact (optional but validate format if provided) ──
            if (f.emergencyContact && !/^\d{10,15}$/.test(f.emergencyContact.replace(/\D/g, ""))) {
                errs.push("• Emergency Contact: must be 10–15 digits if provided");
                this._setFieldState("emergencyContact", "Error", "Must be 10–15 digits");
            } else {
                this._setFieldState("emergencyContact", "None", "");
            }
            // ── Duplicate Aadhaar/PAN check against loaded employees ──
            const aManagers = this._oManagersModel.getProperty("/items") || [];
            // We'll do the real duplicate check via backend — flag for async validation
            this._bNeedsUniqueCheck = true;
            return errs;
        },

        _setFieldState(field, state, msg) {
            const sId = FIELD_ID_MAP[field];
            if (!sId) return;
            const oCtrl = this.byId(sId);
            if (!oCtrl) return;
            if (oCtrl.setValueState)     oCtrl.setValueState(state);
            if (oCtrl.setValueStateText) oCtrl.setValueStateText(msg);
        },

        _resetAllFieldStates() {
            Object.keys(FIELD_ID_MAP).forEach(f => this._setFieldState(f, "None", ""));
        },

        // ── Save ─────────────────────────────────────────────────────────
        onSave() {
            const errs = this._validate();
            if (errs.length) {
                MessageBox.error(errs.join("\n"), {
                    title:        "Please fix the following errors",
                    contentWidth: "500px"
                });
                return;
            }

            this._oFormModel.setProperty("/saving", true);

            // ── Check Aadhaar/PAN uniqueness before saving ──
            this._checkUniqueness()
                .then(uniqueErrors => {
                    if (uniqueErrors.length) {
                        this._oFormModel.setProperty("/saving", false);
                        MessageBox.error(uniqueErrors.join("\n"), {
                            title:        "Duplicate Data Found",
                            contentWidth: "500px"
                        });
                        return;
                    }
                    this._doSave();
                })
                .catch(() => this._doSave()); // if check fails, proceed anyway
        },

        _checkUniqueness() {
            const f      = this._oFormModel.getData();
            const oModel = this.getOwnerComponent().getModel("hr");
            const errors = [];
            if (!oModel) return Promise.resolve(errors);

            const checks = [];

            if (f.aadhaarNumber) {
                checks.push(
                    oModel.bindList("/Employees", null, null, [
                        new Filter("aadhaarNumber", FilterOperator.EQ, f.aadhaarNumber.replace(/\D/g, ""))
                    ]).requestContexts(0, 1)
                    .then(aCtx => {
                        if (aCtx.length > 0) {
                            errors.push("• Aadhaar Number already registered with another employee");
                            this._setFieldState("aadhaarNumber", "Error", "Already registered");
                        }
                    }).catch(() => {})
                );
            }

            if (f.panNumber) {
                checks.push(
                    oModel.bindList("/Employees", null, null, [
                        new Filter("panNumber", FilterOperator.EQ, f.panNumber.toUpperCase().trim())
                    ]).requestContexts(0, 1)
                    .then(aCtx => {
                        if (aCtx.length > 0) {
                            errors.push("• PAN Number already registered with another employee");
                            this._setFieldState("panNumber", "Error", "Already registered");
                        }
                    }).catch(() => {})
                );
            }

            return Promise.all(checks).then(() => errors);
        },

        _doSave() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) {
                this._oFormModel.setProperty("/saving", false);
                MessageBox.error("HR service is not available.");
                return;
            }

            const f    = this._oFormModel.getData();
            const oCtx = oModel.bindContext("/addEmployee(...)");

            [
                "employeeName","designation","email","address","mobileNumber",
                "managerEmployeeId","dateOfBirth","gender","department",
                "joiningDate","employmentType","workLocation",
                "aadhaarNumber","panNumber","emergencyContact","bloodGroup",
                "bankAccountNumber","bankName","bankIfsc",
                "maritalStatus","fatherName","partnerName","marriageDate","hasKids"
            ].forEach(k => {
                const v = f[k];
                oCtx.setParameter(k, (v === "" || v === undefined) ? null : v);
            });

            oCtx.execute()
                .then(() => {
                    const oResult = oCtx.getBoundContext().getObject();
                    const newId   = oResult && (oResult.employeeId || oResult.value);
                    if (!newId) throw new Error("Server did not return an employeeId.");
                    return this._uploadPendingDocs(newId).then(() => newId);
                })
                .then(newId => {
                    this._oFormModel.setProperty("/saving", false);
                    const docCount = (this._oFormModel.getProperty("/pendingDocs") || []).length;
                    MessageBox.success(
                        `Employee ${newId} created successfully.\n${docCount} document(s) uploaded.`,
                        { title: "Saved", onClose: () => {
                            this.onReset();
                            this.getOwnerComponent().getRouter().navTo("all-employees");
                        }}
                    );
                })
                .catch(err => {
                    this._oFormModel.setProperty("/saving", false);
                    MessageBox.error((err && err.message) || "Could not save employee.", { title: "Save failed" });
                });
        },

        _uploadPendingDocs(employeeId) {
            const docs = this._oFormModel.getProperty("/pendingDocs") || [];
            if (!docs.length) return Promise.resolve();
            // Upload sequentially via plain fetch (not $batch) so multiple large
            // documents all persist. A failed doc rejects so the user is told.
            return docs.reduce((p, d) => p.then(() => callHr("uploadEmployeeDocument", {
                employeeId:   employeeId,
                documentType: d.documentType || "Other",
                fileName:     d.fileName,
                mimeType:     d.mimeType,
                description:  "",
                dataBase64:   d.dataBase64
            })), Promise.resolve());
        },

        onDocsSelected(oEvent) {
            const aFiles = oEvent.getParameter("files");
            if (!aFiles || !aFiles.length) return;

            const sType   = this.byId("docTypeSel").getSelectedKey();
            const pending = this._oFormModel.getProperty("/pendingDocs") || [];
            const allowed = ["application/pdf","image/jpeg","image/png","image/jpg",
                            "text/plain","application/msword",
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

            let skipped = 0;

            const processNext = (index) => {
                if (index >= aFiles.length) {
                    this._oFormModel.setProperty("/pendingDocs", pending.slice());
                    if (skipped > 0) {
                        MessageToast.show(`${skipped} file(s) skipped — size > 5MB or unsupported type.`);
                    }
                    return;
                }

                const file = aFiles[index];

                // Size check
                if (file.size > 5 * 1024 * 1024) {
                    MessageToast.show(`${file.name} exceeds 5MB — skipped.`);
                    skipped++;
                    processNext(index + 1);
                    return;
                }

                // Combined-size check across everything already queued.
                const queuedBytes = pending.reduce((s, p) => s + (p.size || 0), 0);
                if (queuedBytes + file.size > MAX_TOTAL_BYTES) {
                    MessageToast.show(`${file.name} skipped — total documents would exceed ${MAX_TOTAL_LABEL}.`);
                    skipped++;
                    processNext(index + 1);
                    return;
                }

                // Duplicate check
                const isDuplicate = pending.some(p => p.fileName === file.name && p.documentType === sType);
                if (isDuplicate) {
                    MessageToast.show(`${file.name} already queued as ${sType} — skipped.`);
                    skipped++;
                    processNext(index + 1);
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64 = String(e.target.result || "").split(",")[1] || "";
                    pending.push({
                        documentType: sType,
                        fileName:     file.name,
                        mimeType:     file.type || "application/octet-stream",
                        size:         file.size,
                        sizeLabel:    this._fmtSize(file.size),
                        dataBase64:   base64
                    });
                    processNext(index + 1);
                };
                reader.onerror = () => {
                    skipped++;
                    processNext(index + 1);
                };
                reader.readAsDataURL(file);
            };

            processNext(0);
            oEvent.getSource().clear();
        },

        // Allow changing doc type of already queued file
        onPendingDocTypeChange(oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("form");
            if (!oCtx) return;
            const sPath = oCtx.getPath();
            const sKey  = oEvent.getSource().getSelectedKey();
            this._oFormModel.setProperty(sPath + "/documentType", sKey);
        },

        onRemovePendingDoc(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("form");
            if (!oCtx) return;
            const idx     = parseInt(oCtx.getPath().split("/").pop(), 10);
            const pending = this._oFormModel.getProperty("/pendingDocs") || [];
            pending.splice(idx, 1);
            this._oFormModel.setProperty("/pendingDocs", pending.slice());
            MessageToast.show("Document removed.");
        },

        onReset() {
            this._oFormModel.setData(EMPTY_FORM());
            this._resetAllFieldStates();
        },

        _fmtSize(n) {
            if (!n) return "0 B";
            const u = ["B","KB","MB","GB"];
            let i = 0, v = n;
            while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
            return v.toFixed(1) + " " + u[i];
        }
    });
});