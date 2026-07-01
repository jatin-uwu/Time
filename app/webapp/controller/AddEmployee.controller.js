sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "sap/m/Token",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/DatePicker",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/ui/core/Item",
    "sap/ui/unified/FileUploader"
], (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, Token,
    Dialog, Input, Label, DatePicker, Button, VBox, Item, FileUploader) => {
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
        role:              "",
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
        // ── Hierarchical resource profile (additive, optional) ──
        roleCategoryId:    "",
        roleCategoryName:  "",
        specializationId:  "",
        specializationName: "",
        subSpecialization: "",
        yearsOfExperience: null,
        ctc:               null,
        baseAvailabilityPct: 100,
        skillsArr:         [],
        certsArr:          [],
        certs:             [],        // rich certifications (name + details + file)
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
        role:              "selRole",
        department:        "selResDept",
        roleCategoryId:    "selRoleCat",
        specializationId:  "selSpec",
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

            // Hierarchical resource masters (Department → Role → Specialization).
            this._oHierModel = new JSONModel({ departments: [], skills: [], certifications: [] });
            this.getView().setModel(this._oHierModel, "hier");
            this._loadHierarchy();

            // Talent-taxonomy suggestion models (dynamic typeahead).
            ["taxRole", "taxModule", "taxSkill", "taxCert", "taxLang"].forEach(function (m) {
                this.getView().setModel(new JSONModel({ items: [] }), m);
            }.bind(this));

            this.getOwnerComponent().getRouter()
                .getRoute("add-employee")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this.onReset();
            this._loadManagers();
        },

        _loadHierarchy() {
            callHr("getResourceHierarchy", {})
                .then(raw => {
                    const h = (typeof raw === "string") ? JSON.parse(raw) : raw;
                    if (h && !h.error) this._oHierModel.setData(h);
                })
                .catch(() => {});
        },

        // Department change → reset role + module (typeahead is scoped to the dept).
        onResDeptChange() {
            ["roleCategoryId", "roleCategoryName", "specializationId", "specializationName"].forEach(function (p) { this._oFormModel.setProperty("/" + p, ""); }.bind(this));
        },

        // ── Talent taxonomy: typeahead search + create-if-not-exists ───────────────
        _taxCall(action, params) {
            return callHr(action, params).then(function (raw) { try { return (typeof raw === "string") ? JSON.parse(raw) : raw; } catch (e) { return {}; } });
        },
        _taxSuggest(type, model, q, scope) {
            this._taxCall("searchTaxonomy", Object.assign({ type: type, q: q }, scope)).then(function (v) {
                var items = (v.suggestions || []).map(function (s) { return { key: s.id, text: s.name }; });
                // Single-select fields show an explicit "Create" row; chips create on Enter.
                if (v.normalized && !v.exactMatch && (type === "role" || type === "module")) {
                    items.unshift({ key: "__create__:" + v.normalized, text: '➕ Create "' + v.normalized + '"' });
                }
                model.setData({ items: items });
            }).catch(function () { model.setData({ items: [] }); });
        },
        _taxResolve(type, name, scope) { return this._taxCall("upsertTaxonomy", Object.assign({ type: type, name: name }, scope)); },
        _roleScope() { return { departmentId: this._oFormModel.getProperty("/department") || null }; },
        _moduleScope() { return { roleId: this._oFormModel.getProperty("/roleCategoryId") || null }; },

        onTaxSuggestRole(e) { this._taxSuggest("role", this.getView().getModel("taxRole"), e.getParameter("suggestValue"), this._roleScope()); },
        onTaxRoleSelected(e) {
            var item = e.getParameter("selectedItem"); if (!item) return;
            var key = item.getKey(), name = key.indexOf("__create__:") === 0 ? key.slice(11) : item.getText();
            var f = this._oFormModel;
            this._taxResolve("role", name, this._roleScope()).then(function (r) {
                if (r.error) { MessageToast.show(r.error); return; }
                f.setProperty("/roleCategoryId", r.id); f.setProperty("/roleCategoryName", r.name);
                f.setProperty("/specializationId", ""); f.setProperty("/specializationName", "");
            });
        },
        onTaxRoleChange(e) {
            var v = (e.getParameter("value") || "").trim(), f = this._oFormModel;
            // Any change to the role clears the dependent module (cascading rule).
            f.setProperty("/specializationId", ""); f.setProperty("/specializationName", "");
            if (!v) { f.setProperty("/roleCategoryId", ""); f.setProperty("/roleCategoryName", ""); }
            else if (v.toUpperCase() !== String(f.getProperty("/roleCategoryName") || "").toUpperCase()) { f.setProperty("/roleCategoryId", ""); }
        },
        onTaxSuggestModule(e) { this._taxSuggest("module", this.getView().getModel("taxModule"), e.getParameter("suggestValue"), this._moduleScope()); },
        onTaxModuleSelected(e) {
            var item = e.getParameter("selectedItem"); if (!item) return;
            var key = item.getKey(), name = key.indexOf("__create__:") === 0 ? key.slice(11) : item.getText();
            var f = this._oFormModel;
            this._taxResolve("module", name, this._moduleScope()).then(function (r) {
                if (r.error) { MessageToast.show(r.error); return; }
                f.setProperty("/specializationId", r.id); f.setProperty("/specializationName", r.name);
            });
        },
        onTaxModuleChange(e) {
            var v = (e.getParameter("value") || "").trim(), f = this._oFormModel;
            if (!v) { f.setProperty("/specializationId", ""); f.setProperty("/specializationName", ""); }
            else if (v.toUpperCase() !== String(f.getProperty("/specializationName") || "").toUpperCase()) { f.setProperty("/specializationId", ""); }
        },

        // Skills / Certifications — chips with suggestions + create-on-Enter.
        onTaxSuggestSkill(e) { this._taxSuggest("skill", this.getView().getModel("taxSkill"), e.getParameter("suggestValue"), {}); },
        onTaxSuggestCert(e) { this._taxSuggest("certification", this.getView().getModel("taxCert"), e.getParameter("suggestValue"), {}); },
        onTaxSkillSelected(e) { this._taxChip("skill", this.byId("mcbSkills"), e.getParameter("selectedItem") && e.getParameter("selectedItem").getText()); },
        onTaxCertSelected(e) { this._taxChip("certification", this.byId("mcbCerts"), e.getParameter("selectedItem") && e.getParameter("selectedItem").getText()); },
        onTaxSkillSubmit(e) { this._taxChip("skill", this.byId("mcbSkills"), e.getParameter("value")); },
        onTaxCertSubmit(e) { this._taxChip("certification", this.byId("mcbCerts"), e.getParameter("value")); },
        _hasToken(mi, name) { return mi.getTokens().some(function (t) { return t.getText().toUpperCase() === String(name).toUpperCase(); }); },
        _taxChip(type, mi, value) {
            var v = (value || "").trim(); if (!v) return;
            var that = this;
            this._taxResolve(type, v, {}).then(function (r) {
                if (r.error) { MessageToast.show(r.error); return; }
                if (!that._hasToken(mi, r.name)) mi.addToken(new Token({ key: r.name, text: r.name }));
                mi.setValue("");
            });
        },
        // Comma also commits a skill chip (LinkedIn-style): split on commas, chip each
        // completed value, keep the trailing fragment in the field for the next search.
        onTaxSkillLive(e) {
            var v = e.getParameter("value") || "";
            if (v.indexOf(",") === -1) return;
            var mi = this.byId("mcbSkills"), parts = v.split(","), last = parts.pop(), that = this;
            parts.forEach(function (p) { if (p.trim()) that._taxChip("skill", mi, p.trim()); });
            mi.setValue(last);
        },
        // Languages — typeahead suggestions from existing data (backend), free-create on Enter.
        onTaxSuggestLang(e) {
            var model = this.getView().getModel("taxLang");
            callHr("searchLanguages", { q: e.getParameter("suggestValue") || "" })
                .then(function (raw) { var v = (typeof raw === "string") ? JSON.parse(raw) : raw; model.setData({ items: (v.suggestions || []).map(function (s) { return { key: s, text: s }; }) }); })
                .catch(function () { model.setData({ items: [] }); });
        },
        onLangSelected(e) { var it = e.getParameter("selectedItem"); if (it) this._addLang(it.getText()); },
        onLangSubmit(e) { this._addLang(e.getParameter("value")); },
        _addLang(value) {
            var mi = this.byId("miLanguages"), v = (value || "").trim().toUpperCase(); if (!v) return;
            if (!mi.getTokens().some(function (t) { return t.getText().toUpperCase() === v; })) mi.addToken(new Token({ key: v, text: v }));
            mi.setValue("");
        },

        // ── Rich certifications (per-cert document) ────────────────────────────────
        onAddCertification() { this._openCertDialog(-1); },
        onEditCertification(e) { this._openCertDialog(parseInt(e.getSource().getBindingContext("form").getPath().split("/").pop(), 10)); },
        onRemoveCertification(e) {
            var i = parseInt(e.getSource().getBindingContext("form").getPath().split("/").pop(), 10);
            var arr = this._oFormModel.getProperty("/certs") || []; arr.splice(i, 1);
            this._oFormModel.setProperty("/certs", arr.slice());
        },
        onPreviewCert(e) {
            var c = e.getSource().getBindingContext("form").getObject();
            if (!c.dataBase64) { MessageToast.show("No file to preview."); return; }
            var bin = atob(c.dataBase64), arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            var url = URL.createObjectURL(new Blob([arr], { type: c.mimeType || "application/octet-stream" }));
            window.open(url, "_blank"); setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
        },
        _openCertDialog(index) {
            var that = this, editing = index >= 0;
            var ex = editing ? (this._oFormModel.getProperty("/certs")[index] || {}) : {};
            var fileObj = { fileName: ex.fileName || "", mimeType: ex.mimeType || "", dataBase64: ex.dataBase64 || "" };
            var nameInput = new Input({
                value: ex.certName || "", showSuggestion: true, startSuggestion: 0, placeholder: "Type to search or create…",
                suggestionItems: { path: "taxCert>/items", template: new Item({ key: "{taxCert>key}", text: "{taxCert>text}" }) },
                suggest: function (evt) { that._taxSuggest("certification", that.getView().getModel("taxCert"), evt.getParameter("suggestValue"), {}); }
            });
            nameInput.setModel(this.getView().getModel("taxCert"), "taxCert");
            var numInput = new Input({ value: ex.certificateNumber || "", placeholder: "Certificate number (optional)" });
            var issuerInput = new Input({ value: ex.issuedBy || "", placeholder: "Issued by (optional)" });
            var issueDate = new DatePicker({ value: ex.issueDate || "", valueFormat: "yyyy-MM-dd", displayFormat: "MMM d, yyyy", width: "100%" });
            var expiryDate = new DatePicker({ value: ex.expiryDate || "", valueFormat: "yyyy-MM-dd", displayFormat: "MMM d, yyyy", width: "100%" });
            var fileText = new sap.m.Text({ text: fileObj.fileName || "No file selected" });
            var uploader = new FileUploader({
                buttonOnly: true, buttonText: "Choose File (PDF/JPG/PNG)", icon: "sap-icon://attachment",
                change: function (evt) {
                    var file = evt.getParameter("files") && evt.getParameter("files")[0]; if (!file) return;
                    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.name)) { MessageToast.show("Only PDF, JPG or PNG allowed."); return; }
                    if (file.size > 5 * 1024 * 1024) { MessageToast.show("File exceeds 5MB."); return; }
                    var rdr = new FileReader();
                    rdr.onload = function (x) { fileObj.dataBase64 = String(x.target.result || "").split(",")[1] || ""; fileObj.fileName = file.name; fileObj.mimeType = file.type || "application/octet-stream"; fileText.setText(file.name); };
                    rdr.readAsDataURL(file);
                }
            });
            var dlg = new Dialog({
                title: editing ? "Edit Certification" : "Add Certification", contentWidth: "440px",
                content: [new VBox({ items: [
                    new Label({ text: "Certification *" }), nameInput,
                    new Label({ text: "Certificate Number" }), numInput,
                    new Label({ text: "Issued By" }), issuerInput,
                    new Label({ text: "Issue Date" }), issueDate,
                    new Label({ text: "Expiry Date" }), expiryDate,
                    new Label({ text: "Certificate File" }), uploader, fileText
                ] }).addStyleClass("sapUiSmallMargin")],
                beginButton: new Button({
                    text: editing ? "Save" : "Add", type: "Emphasized", press: function () {
                        var name = (nameInput.getValue() || "").trim(); if (!name) { MessageToast.show("Certification name is required."); return; }
                        var entry = {
                            certName: name, certificateNumber: (numInput.getValue() || "").trim(), issuedBy: (issuerInput.getValue() || "").trim(),
                            issueDate: issueDate.getValue() || null, expiryDate: expiryDate.getValue() || null,
                            fileName: fileObj.fileName, mimeType: fileObj.mimeType, dataBase64: fileObj.dataBase64
                        };
                        var arr = that._oFormModel.getProperty("/certs") || [];
                        if (editing) arr[index] = entry; else arr.push(entry);
                        that._oFormModel.setProperty("/certs", arr.slice());
                        dlg.close();
                    }
                }),
                endButton: new Button({ text: "Cancel", press: function () { dlg.close(); } }),
                afterClose: function () { dlg.destroy(); }
            });
            this.getView().addDependent(dlg); dlg.open();
        },

        _loadManagers() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) return;
            // $select only the light columns — reading the full entity (incl. the
            // profilePhoto LargeBinary) can fail/stall and leave the dropdown empty.
            oModel.bindList("/Employees", null, null, null, { $select: "employeeId,employeeName,isActive,status" })
                .requestContexts(0, 1000)
                .then(aCtx => {
                    const items = aCtx.map(c => c.getObject())
                        .filter(e => e && e.employeeId && e.isActive !== false &&
                            !["inactive", "resigned"].includes(String(e.status || "").toLowerCase()))
                        .map(e => ({ employeeId: e.employeeId, employeeName: e.employeeName || e.employeeId }))
                        .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
                    this._oManagersModel.setProperty("/items", items);
                })
                .catch(() => {
                    // Fallback: the lightweight resource-hierarchy already proves /hr works;
                    // try a plain fetch so the dropdown still fills if bindList misbehaves.
                    callHr("nextEmployeeId", {}).catch(() => {});
                });
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

            // Format check applied ONLY when the (optional) field has a value.
            const checkIf = (field, label, hasValue, badFormat, msg) => {
                if (hasValue && badFormat) { errs.push(`• ${label}: ${msg}`); this._setFieldState(field, "Error", msg); }
                else this._setFieldState(field, "None", "");
            };

            // ── Mandatory (HR-genuine) ──────────────────────────────────────────────
            check("employeeName", "Full Name",
                !f.employeeName || !f.employeeName.trim() || !/^[a-zA-Z\s.]{2,100}$/.test(f.employeeName.trim()),
                "Required · letters only · min 2 characters");
            check("email", "Email",
                !f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email),
                "Required · invalid email format");
            check("department",    "Department",      !f.department || !f.department.trim(), "Required");
            check("employmentType","Employment Type", !f.employmentType, "Required · please select employment type");
            check("joiningDate",   "Joining Date",    !f.joiningDate, "Required");

            // ── Optional — validated only when provided ─────────────────────────────
            checkIf("mobileNumber", "Mobile", !!f.mobileNumber, !/^\d{10,15}$/.test(String(f.mobileNumber).replace(/\D/g, "")), "must be 10–15 digits");
            checkIf("emergencyContact", "Emergency Contact", !!f.emergencyContact, !/^\d{10,15}$/.test(String(f.emergencyContact).replace(/\D/g, "")), "must be 10–15 digits");
            const dobAge = (() => {
                if (!f.dateOfBirth) return null;
                const dob = new Date(f.dateOfBirth), now = new Date();
                let a = now.getFullYear() - dob.getFullYear();
                const mDiff = now.getMonth() - dob.getMonth();
                if (mDiff < 0 || (mDiff === 0 && now.getDate() < dob.getDate())) a--;
                return a;
            })();
            checkIf("dateOfBirth", "Date of Birth", f.dateOfBirth != null, (dobAge !== null && (dobAge < 18 || dobAge > 70)), "age must be between 18 and 70");
            checkIf("aadhaarNumber", "Aadhaar Number", !!f.aadhaarNumber, !/^\d{12}$/.test(String(f.aadhaarNumber).replace(/\D/g, "")), "must be 12 digits");
            checkIf("panNumber", "PAN Number", !!f.panNumber, !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(f.panNumber).toUpperCase()), "format: ABCDE1234F");
            checkIf("bankAccountNumber", "Account Number", !!f.bankAccountNumber, !/^\d{9,18}$/.test(String(f.bankAccountNumber).replace(/\D/g, "")), "must be 9–18 digits");
            checkIf("bankIfsc", "IFSC Code", !!f.bankIfsc, !/^SBIN0[A-Z0-9]{6}$/.test(String(f.bankIfsc).toUpperCase().trim()), "invalid IFSC · only SBI (SBIN…) accepted");

            // Everything else (gender, blood, address, marital + conditionals, designation,
            // app role, work location, role category, module, manager, bank name) is optional
            // and carries no mandatory check — clear any stale error states.
            ["gender", "bloodGroup", "address", "maritalStatus", "fatherName", "partnerName",
                "marriageDate", "hasKids", "designation", "role", "workLocation",
                "managerEmployeeId", "bankName", "roleCategoryId", "specializationId"]
                .forEach(fld => this._setFieldState(fld, "None", ""));

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

        // Resolve any typed-but-unselected role/module into master ids, and pull the
        // skill/certification chips out of the MultiInputs — all before saving.
        _finalizeTaxonomy() {
            const f = this._oFormModel, that = this;
            const sk = this.byId("mcbSkills"), lg = this.byId("miLanguages");
            f.setProperty("/skillsArr", sk ? sk.getTokens().map(t => t.getText()) : []);
            f.setProperty("/languagesArr", lg ? lg.getTokens().map(t => t.getText()) : []);
            // Rich certifications now carry their own names → keep the comma cache in sync.
            f.setProperty("/certsArr", (f.getProperty("/certs") || []).map(c => c.certName));
            let p = Promise.resolve();
            const roleName = String(f.getProperty("/roleCategoryName") || "").trim();
            if (roleName && !f.getProperty("/roleCategoryId")) {
                p = p.then(() => that._taxResolve("role", roleName, that._roleScope()).then(r => { if (r && r.id) { f.setProperty("/roleCategoryId", r.id); f.setProperty("/roleCategoryName", r.name); } }));
            }
            const modName = String(f.getProperty("/specializationName") || "").trim();
            if (modName) {
                p = p.then(() => { if (!f.getProperty("/specializationId")) return that._taxResolve("module", modName, that._moduleScope()).then(r => { if (r && r.id) { f.setProperty("/specializationId", r.id); f.setProperty("/specializationName", r.name); } }); });
            }
            return p;
        },

        _doSave() {
            this._finalizeTaxonomy().then(() => this._doSaveInner());
        },
        _doSaveInner() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) {
                this._oFormModel.setProperty("/saving", false);
                MessageBox.error("HR service is not available.");
                return;
            }

            const f    = this._oFormModel.getData();
            const oCtx = oModel.bindContext("/addEmployee(...)");

            [
                "employeeName","designation","role","email","address","mobileNumber",
                "managerEmployeeId","dateOfBirth","gender","department",
                "joiningDate","employmentType","workLocation",
                "aadhaarNumber","panNumber","emergencyContact","bloodGroup",
                "bankAccountNumber","bankName","bankIfsc",
                "maritalStatus","fatherName","partnerName","marriageDate","hasKids"
            ].forEach(k => {
                const v = f[k];
                oCtx.setParameter(k, (v === "" || v === undefined) ? null : v);
            });

            // ── Hierarchical resource profile (additive, optional) ──
            oCtx.setParameter("roleCategoryId",   f.roleCategoryId || null);
            oCtx.setParameter("specializationId", f.specializationId || null);
            oCtx.setParameter("subSpecialization", f.subSpecialization || null);
            oCtx.setParameter("yearsOfExperience", (f.yearsOfExperience === "" || f.yearsOfExperience == null) ? null : Number(f.yearsOfExperience));
            oCtx.setParameter("skills",         (f.skillsArr || []).join(", ") || null);
            oCtx.setParameter("certifications", (f.certsArr || []).join(", ") || null);
            oCtx.setParameter("languages",      (f.languagesArr || []).join(", ") || null);
            oCtx.setParameter("ctc",            (f.ctc === "" || f.ctc == null) ? null : Number(f.ctc));

            oCtx.execute()
                .then(() => {
                    const oResult = oCtx.getBoundContext().getObject();
                    const newId   = oResult && (oResult.employeeId || oResult.value);
                    if (!newId) throw new Error("Server did not return an employeeId.");
                    return this._uploadPendingDocs(newId).then(() => this._uploadCertifications(newId)).then(() => newId);
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

        // Save each rich certification (with its optional document) sequentially.
        _uploadCertifications(employeeId) {
            const certs = this._oFormModel.getProperty("/certs") || [];
            if (!certs.length) return Promise.resolve();
            return certs.reduce((p, c) => p.then(() => callHr("saveEmployeeCertification", {
                employeeId: employeeId, certName: c.certName, certificateNumber: c.certificateNumber || "",
                issuedBy: c.issuedBy || "", issueDate: c.issueDate || null, expiryDate: c.expiryDate || null,
                fileName: c.fileName || "", mimeType: c.mimeType || "", dataBase64: c.dataBase64 || ""
            })), Promise.resolve());
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
            // Chips live on the MultiInputs (not model-bound) → clear them too.
            ["mcbSkills", "miLanguages"].forEach(function (id) { var mi = this.byId(id); if (mi) { mi.removeAllTokens(); mi.setValue(""); } }.bind(this));
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