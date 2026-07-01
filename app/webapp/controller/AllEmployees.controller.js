sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "timesheet/app/util/MessageBox",
    "sap/m/MessageToast",
    "timesheet/app/util/CustomDialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/ui/core/ResizeHandler",
    "sap/m/Select",
    "sap/m/MultiComboBox",
    "sap/ui/core/Item"
], (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast,
    CustomDialog, Button, Input, Label, VBox, ResizeHandler, Select, MultiComboBox, Item) => {
    "use strict";

    // Plain fetch caller for /hr actions (CSRF + JSON), used for the resource hierarchy.
    async function callHr(action, params) {
        let token = null;
        try { const h = await fetch("/hr/", { headers: { "X-CSRF-Token": "Fetch" }, credentials: "include" }); token = h.headers.get("x-csrf-token"); } catch (e) {}
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers["X-CSRF-Token"] = token;
        const resp = await fetch("/hr/" + action, { method: "POST", headers, body: JSON.stringify(params || {}), credentials: "include" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const j = await resp.json().catch(() => ({}));
        return (j && j.value !== undefined) ? j.value : j;
    }

    // Plain fetch caller for /hr actions (CSRF + JSON, NO $batch). A document's
    // base64 can be several MB; fetching it through an OData $batch can fail
    // ("batch failed") in deployment, so we hit the action endpoint directly.
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

    function initialsOf(sName) {
        if (!sName) return "?";
        const p = sName.trim().split(/\s+/);
        const a = p[0] && p[0][0] ? p[0][0] : "";
        const b = p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0] : "";
        return (a + b).toUpperCase() || a.toUpperCase() || "?";
    }

    function fmtDate(sIso) {
        if (!sIso) return "—";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return sIso;
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    }

    return Controller.extend("timesheet.app.controller.AllEmployees", {

        onInit() {
            this._bInitialized = false;

            this._oEmpModel    = new JSONModel({ items: [], filtered: [] });
            this._oDetailModel = new JSONModel({
                hasSelection: false, emp: {}, docs: [], managerName: "",
                initials: "", showAll: false,
                statusActionText: "Deactivate", statusActionIcon: "sap-icon://decline"
            });

            this.getView().setModel(this._oEmpModel,    "emp");
            this.getView().setModel(this._oDetailModel, "detail");

            // Cache the resource hierarchy for the edit dialog's cascading dropdowns.
            this._hier = { departments: [], skills: [], certifications: [] };
            callHr("getResourceHierarchy", {}).then(raw => {
                const h = (typeof raw === "string") ? JSON.parse(raw) : raw;
                if (h && !h.error) this._hier = h;
            }).catch(() => {});

            this.getOwnerComponent().getRouter()
                .getRoute("all-employees")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Make the table fill the available vertical space ──────────────────
        // sap.ui.table inside sap.m.Page does not reliably inherit a CSS height,
        // so we measure the real viewport space and set visibleRowCount directly.
        onAfterRendering() {
            const fn = this._sizeTable.bind(this);
            setTimeout(fn, 0);
            setTimeout(fn, 200);   // after layout/animation settles
            if (!this._resizeReg) {
                const oTable = this.byId("empTable");
                if (oTable && oTable.getDomRef && oTable.getDomRef()) {
                    this._resizeReg = ResizeHandler.register(oTable.getDomRef().parentNode || oTable, fn);
                }
                this._winResize = () => fn();
                window.addEventListener("resize", this._winResize);
            }
        },

        onExit() {
            if (this._resizeReg) { ResizeHandler.deregister(this._resizeReg); this._resizeReg = null; }
            if (this._winResize) { window.removeEventListener("resize", this._winResize); this._winResize = null; }
        },

        _sizeTable() {
            const oTable = this.byId("empTable");
            if (!oTable || !oTable.getDomRef) return;
            const oDom = oTable.getDomRef();
            if (!oDom) return;
            const oBody = oDom.closest(".tsEmpDirBody") || oDom.parentNode;
            if (!oBody) return;

            const top = oBody.getBoundingClientRect().top;
            const avail = Math.max(260, window.innerHeight - top - 16);   // fill to near the bottom
            oBody.style.height = avail + "px";

            // Measure the real row + header heights, then fit as many rows as possible.
            const rowEl = oDom.querySelector(".sapUiTableTr, .sapUiTableRow");
            const rowH = (rowEl && rowEl.getBoundingClientRect().height) || 33;
            const hdrEl = oDom.querySelector(".sapUiTableColHdrCnt");
            const hdrH = (hdrEl && hdrEl.getBoundingClientRect().height) || 48;
            const n = Math.max(5, Math.floor((avail - hdrH) / rowH));
            if (oTable.getVisibleRowCount() !== n) oTable.setVisibleRowCount(n);
        },

        _onRouteMatched() {
            this._bInitialized = true;
            this._loadEmployees();
            setTimeout(this._sizeTable.bind(this), 150);
        },

        _loadEmployees() {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) { MessageToast.show("HR service not available."); return; }
            // Explicit $select of scalar columns only — reading the full entity pulls the
            // profilePhoto LargeBinary, which breaks OData V4 list serialization (HTTP 500)
            // and left the table empty. The photo is fetched separately when needed.
            const SELECT_COLS = [
                "employeeId", "employeeName", "designation", "role", "email", "address", "mobileNumber",
                "manager_employeeId", "isActive", "dateOfBirth", "gender", "department", "joiningDate",
                "employmentType", "aadhaarNumber", "panNumber", "status", "emergencyContact", "bloodGroup",
                "workLocation", "skills", "monthlyCapacityHours", "roleCategory_roleId", "specialization_specId",
                "subSpecialization", "yearsOfExperience", "certifications", "languages", "baseAvailabilityPct",
                "maritalStatus", "fatherName", "partnerName", "marriageDate", "hasKids",
                "bankAccountNumber", "bankName", "bankIfsc", "profilePhotoMimeType"
            ].join(",");
            oModel.bindList("/Employees", null, null, null, { $select: SELECT_COLS }).requestContexts(0, 1000)
                .then(aCtx => {
                    const items = aCtx.map(c => c.getObject()).filter(Boolean);
                    items.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));
                    this._oEmpModel.setProperty("/items", items);
                    this._applyFilters();
                    setTimeout(this._sizeTable.bind(this), 60);
                })
                .catch(err => {
                    MessageToast.show("Could not load employees.");
                    console.error(err);
                });
        },

        // ── Search + status filter (combined) ─────────────────────────────────
        onSearch() { this._applyFilters(); },
        onStatusFilterChange() { this._applyFilters(); },

        _applyFilters() {
            const all = this._oEmpModel.getProperty("/items") || [];
            const sQ = (this.byId("empSearch").getValue() || "").toLowerCase().trim();
            const sStatus = this.byId("statusFilter").getSelectedKey() || "all";

            const filtered = all.filter(e => {
                if (sStatus === "Active"   && !(e.status === "Active"   || e.isActive === true))  return false;
                if (sStatus === "Inactive" && (e.status === "Active"   || e.isActive === true))   return false;
                if (sQ) {
                    const hit = ["employeeId", "employeeName", "email", "department", "designation", "mobileNumber"]
                        .some(k => String(e[k] || "").toLowerCase().includes(sQ));
                    if (!hit) return false;
                }
                return true;
            });
            this._oEmpModel.setProperty("/filtered", filtered);
        },

        // ── Row select → open drawer ──────────────────────────────────────────
        onRowSelect(oEvent) {
            const oRow = oEvent.getParameter("rowContext");
            if (!oRow) { return; }
            const emp = oRow.getObject();
            if (!emp) return;

            const bActive = emp.status === "Active" || emp.isActive === true;
            this._oDetailModel.setProperty("/emp",          emp);
            this._oDetailModel.setProperty("/hasSelection",  true);
            this._oDetailModel.setProperty("/initials",      initialsOf(emp.employeeName));
            this._oDetailModel.setProperty("/showAll",       false);
            this._oDetailModel.setProperty("/docs",          []);
            this._oDetailModel.setProperty("/managerName",   "");
            this._oDetailModel.setProperty("/statusActionText", bActive ? "Deactivate" : "Activate");
            this._oDetailModel.setProperty("/statusActionIcon", bActive ? "sap-icon://decline" : "sap-icon://accept");

            this._openDrawer();
            this._loadDocuments(emp.employeeId);
            if (emp.manager_employeeId) this._loadManagerName(emp.manager_employeeId);
        },

        _openDrawer() {
            const oDrawer = this.byId("empDrawer");
            if (oDrawer) oDrawer.addStyleClass("tsEmpDrawerOpen");
            this._wireResizer();
        },

        // Left-edge drag-to-resize for the drawer (wired once, after DOM exists).
        _wireResizer() {
            if (this._resizerWired) return;
            const oDrawer = this.byId("empDrawer");
            const oHandle = this.byId("empDrawerResizer");
            const dd = oDrawer && oDrawer.getDomRef();
            const hd = oHandle && oHandle.getDomRef();
            if (!dd || !hd) return;

            const onMove = (e) => {
                const w = Math.max(320, Math.min(this._startW + (this._startX - e.clientX),
                    window.innerWidth * 0.95));
                dd.style.width = w + "px";
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.userSelect = "";
            };
            hd.addEventListener("mousedown", (e) => {
                this._startX = e.clientX;
                this._startW = dd.offsetWidth;
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
                e.preventDefault();
            });
            this._resizerWired = true;
        },

        onCloseDrawer() {
            const oDrawer = this.byId("empDrawer");
            if (oDrawer) oDrawer.removeStyleClass("tsEmpDrawerOpen");
            this._oDetailModel.setProperty("/hasSelection", false);
            // Clear the table's row highlight without reloading.
            const oTable = this.byId("empTable");
            if (oTable && oTable.clearSelection) oTable.clearSelection();
        },

        _loadDocuments(employeeId) {
            const oModel = this.getOwnerComponent().getModel("hr");
            if (!oModel) return;
            oModel.bindList("/Documents", null, null, [
                new Filter("employee_employeeId", FilterOperator.EQ, employeeId)
            ]).requestContexts(0, 200)
                .then(aCtx => {
                    const docs = aCtx.map(c => c.getObject()).filter(Boolean)
                        // Company newsletters are stored as documents too — keep
                        // them out of an individual employee's document list.
                        .filter(d => d.documentType !== "Newsletter")
                        .map(d => Object.assign({}, d, {
                        uploadedLabel: fmtDate(d.createdAt)
                    }));
                    docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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

        // ── Download document (stream-safe; works local + deployed) ───────────
        onDownloadDoc(oEvent) {
            const oItem = oEvent.getSource();
            const aData = oItem.getCustomData();
            const docId = aData && aData.length ? aData[0].getValue() : null;
            if (!docId) return;

            callHr("getEmployeeDocument", { documentId: docId }).then((r) => {
                if (!r || !r.dataBase64) { MessageToast.show("Document is empty."); return; }
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

        // ── Activate / Deactivate ─────────────────────────────────────────────
        onToggleStatus() {
            const emp = this._oDetailModel.getProperty("/emp");
            if (!emp || !emp.employeeId) return;
            const bActive = emp.status === "Active" || emp.isActive === true;
            const bNext = !bActive;
            const sVerb = bNext ? "activate" : "deactivate";

            MessageBox.confirm(`Are you sure you want to ${sVerb} ${emp.employeeName}?`, {
                title: bNext ? "Activate Employee" : "Deactivate Employee",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: (sAction) => {
                    if (sAction !== MessageBox.Action.OK) return;
                    const oModel = this.getOwnerComponent().getModel("hr");
                    const ctx = oModel.bindContext("/setEmployeeStatus(...)");
                    ctx.setParameter("employeeId", emp.employeeId);
                    ctx.setParameter("isActive", bNext);
                    ctx.execute().then(() => {
                        const r = ctx.getBoundContext().getObject();
                        MessageToast.show(`Employee ${r.status === "Active" ? "activated" : "deactivated"}.`);
                        // Update drawer + table row without a full reload
                        const e2 = Object.assign({}, emp, { isActive: r.isActive, status: r.status });
                        this._oDetailModel.setProperty("/emp", e2);
                        this._oDetailModel.setProperty("/statusActionText", r.isActive ? "Deactivate" : "Activate");
                        this._oDetailModel.setProperty("/statusActionIcon", r.isActive ? "sap-icon://decline" : "sap-icon://accept");
                        this._patchLocalEmployee(e2);
                    }).catch(err => MessageBox.error((err && err.message) || "Could not update status."));
                }
            });
        },

        // ── Reset password ────────────────────────────────────────────────────
        onResetPassword() {
            const emp = this._oDetailModel.getProperty("/emp");
            if (!emp || !emp.employeeId) return;
            const oModel = this.getOwnerComponent().getModel("hr");
            const ctx = oModel.bindContext("/resetEmployeePassword(...)");
            ctx.setParameter("employeeId", emp.employeeId);
            ctx.execute().then(() => {
                const r = ctx.getBoundContext().getObject();
                MessageBox.information((r && r.message) || "Password reset is handled by the identity provider.");
            }).catch(err => MessageBox.error((err && err.message) || "Could not reset password."));
        },

        // ── Edit employee (inline dialog → updateEmployee) ────────────────────
        onEditEmployee() {
            const emp = this._oDetailModel.getProperty("/emp");
            if (!emp || !emp.employeeId) return;

            this._oEditModel = new JSONModel({
                employeeId:       emp.employeeId,
                employeeName:     emp.employeeName || "",
                email:            emp.email || "",
                mobileNumber:     emp.mobileNumber || "",
                department:       emp.department || "",
                designation:      emp.designation || "",
                employmentType:   emp.employmentType || "",
                address:          emp.address || "",
                emergencyContact: emp.emergencyContact || "",
                managerEmployeeId: emp.manager_employeeId || "",
                // ── Hierarchical resource profile (additive, optional) ──
                roleCategoryId:   emp.roleCategory_roleId || "",
                specializationId: emp.specialization_specId || "",
                subSpecialization: emp.subSpecialization || "",
                yearsOfExperience: (emp.yearsOfExperience != null ? emp.yearsOfExperience : ""),
                baseAvailabilityPct: (emp.baseAvailabilityPct != null ? emp.baseAvailabilityPct : 100),
                skillsArr:        (emp.skills || "").split(",").map(s => s.trim()).filter(Boolean),
                certsArr:         (emp.certifications || "").split(",").map(s => s.trim()).filter(Boolean)
            });

            const field = (sLabel, sPath) => [
                new Label({ text: sLabel }).addStyleClass("sapUiTinyMarginTop"),
                new Input({ value: "{edit>/" + sPath + "}", width: "100%" })
            ];

            // ── Cascading Department → Role Category → Specialization ──
            const hier = this._hier || { departments: [], skills: [], certifications: [] };
            const depts = hier.departments || [];
            const m = this._oEditModel;
            let currentRoles = [];
            const specSel = new Select({ selectedKey: "{edit>/specializationId}", width: "100%", forceSelection: false });
            const rebuildSpecs = (specs) => { specSel.removeAllItems(); (specs || []).forEach(s => specSel.addItem(new Item({ key: s.specId, text: s.name }))); };
            const roleSel = new Select({
                selectedKey: "{edit>/roleCategoryId}", width: "100%", forceSelection: false,
                change: (e) => { const role = currentRoles.find(r => r.roleId === e.getSource().getSelectedKey()); rebuildSpecs((role && role.specializations) || []); m.setProperty("/specializationId", ""); }
            });
            const rebuildRoles = (roles) => { currentRoles = roles || []; roleSel.removeAllItems(); currentRoles.forEach(r => roleSel.addItem(new Item({ key: r.roleId, text: r.name }))); };
            const deptSel = new Select({
                selectedKey: "{edit>/department}", width: "100%", forceSelection: false,
                items: depts.map(d => new Item({ key: d.name, text: d.name })),
                change: (e) => { const dept = depts.find(x => x.name === e.getSource().getSelectedKey()); rebuildRoles((dept && dept.roles) || []); rebuildSpecs([]); m.setProperty("/roleCategoryId", ""); m.setProperty("/specializationId", ""); }
            });
            // Seed cascading state from the employee's current values.
            const initDept = depts.find(d => d.name === (emp.department || ""));
            rebuildRoles((initDept && initDept.roles) || []);
            const initRole = currentRoles.find(r => r.roleId === (emp.roleCategory_roleId || ""));
            rebuildSpecs((initRole && initRole.specializations) || []);

            const labelled = (sLabel, ctrl) => [new Label({ text: sLabel }).addStyleClass("sapUiTinyMarginTop"), ctrl];
            const skillsMcb = new MultiComboBox({ width: "100%", selectedKeys: "{edit>/skillsArr}", items: (hier.skills || []).map(s => new Item({ key: s.name, text: s.name })) });
            const certsMcb = new MultiComboBox({ width: "100%", selectedKeys: "{edit>/certsArr}", items: (hier.certifications || []).map(c => new Item({ key: c.name, text: c.name })) });

            const oContent = new VBox({
                items: [].concat(
                    field("Full Name", "employeeName"),
                    field("Email", "email"),
                    field("Phone", "mobileNumber"),
                    labelled("Department", deptSel),
                    labelled("Role Category", roleSel),
                    labelled("Specialization", specSel),
                    field("Sub-Specialization", "subSpecialization"),
                    field("Designation", "designation"),
                    field("Years of Experience", "yearsOfExperience"),
                    field("Base Availability %", "baseAvailabilityPct"),
                    labelled("Skills", skillsMcb),
                    labelled("Certifications", certsMcb),
                    field("Employment Type", "employmentType"),
                    field("Address", "address"),
                    field("Emergency Contact", "emergencyContact"),
                    field("Reporting Manager ID", "managerEmployeeId")
                )
            });

            const oDialog = new CustomDialog({
                title: "Edit Employee · " + emp.employeeId,
                contentWidth: "460px",
                content: [oContent],
                beginButton: new Button({
                    text: "Save", type: "Emphasized", icon: "sap-icon://save",
                    press: () => {
                        const d = this._oEditModel.getData();
                        if (!d.employeeName || !d.email) {
                            MessageToast.show("Name and email are required.");
                            return;
                        }
                        // Mandatory classification (when masters exist for the department).
                        if (!d.department) { MessageToast.show("Department is required."); return; }
                        if (currentRoles.length && !d.roleCategoryId) { MessageToast.show("Role Category is required."); return; }
                        var rn = (currentRoles.find(function (r) { return r.roleId === d.roleCategoryId; }) || {}).name || "";
                        if (/functional/i.test(rn) && !d.specializationId) { MessageToast.show("Module / Specialization is required for Functional Consultants."); return; }
                        const oModel = this.getOwnerComponent().getModel("hr");
                        const ctx = oModel.bindContext("/updateEmployee(...)");
                        // Explicit whitelist — the array fields (skillsArr/certsArr) are
                        // converted to comma strings; only declared action params are sent.
                        const skillsCsv = (d.skillsArr || []).join(", ");
                        const certsCsv = (d.certsArr || []).join(", ");
                        const params = {
                            employeeId: d.employeeId, employeeName: d.employeeName, email: d.email,
                            mobileNumber: d.mobileNumber, department: d.department, designation: d.designation,
                            employmentType: d.employmentType, address: d.address, emergencyContact: d.emergencyContact,
                            managerEmployeeId: d.managerEmployeeId,
                            roleCategoryId: d.roleCategoryId || null, specializationId: d.specializationId || null,
                            subSpecialization: d.subSpecialization || null,
                            yearsOfExperience: (d.yearsOfExperience === "" || d.yearsOfExperience == null) ? null : Number(d.yearsOfExperience),
                            baseAvailabilityPct: (d.baseAvailabilityPct === "" || d.baseAvailabilityPct == null) ? null : parseInt(d.baseAvailabilityPct, 10),
                            skills: skillsCsv || null, certifications: certsCsv || null
                        };
                        Object.keys(params).forEach(k => ctx.setParameter(k, params[k]));
                        ctx.execute().then(() => {
                            MessageToast.show("Employee updated.");
                            oDialog.close();
                            // refresh drawer + table
                            const merged = Object.assign({}, emp, {
                                employeeName: d.employeeName, email: d.email, mobileNumber: d.mobileNumber,
                                department: d.department, designation: d.designation,
                                employmentType: d.employmentType, address: d.address,
                                emergencyContact: d.emergencyContact, manager_employeeId: d.managerEmployeeId,
                                roleCategory_roleId: d.roleCategoryId, specialization_specId: d.specializationId,
                                subSpecialization: d.subSpecialization, yearsOfExperience: d.yearsOfExperience,
                                baseAvailabilityPct: d.baseAvailabilityPct, skills: skillsCsv, certifications: certsCsv
                            });
                            this._oDetailModel.setProperty("/emp", merged);
                            this._oDetailModel.setProperty("/initials", initialsOf(merged.employeeName));
                            if (merged.manager_employeeId) this._loadManagerName(merged.manager_employeeId);
                            this._patchLocalEmployee(merged);
                        }).catch(err => MessageBox.error((err && err.message) || "Could not update employee."));
                    }
                }),
                endButton: new Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            oDialog.setModel(this._oEditModel, "edit");
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        // Update the in-memory lists so table + filters reflect the change
        // without a server round-trip (keeps focus on the table, no refresh).
        _patchLocalEmployee(emp) {
            ["items", "filtered"].forEach(key => {
                const arr = this._oEmpModel.getProperty("/" + key) || [];
                const idx = arr.findIndex(e => e.employeeId === emp.employeeId);
                if (idx >= 0) { arr[idx] = Object.assign({}, arr[idx], emp); }
            });
            this._oEmpModel.refresh(true);
            this._applyFilters();
        },

        onAdd() {
            this.getOwnerComponent().getRouter().navTo("add-employee");
        },

        onRefresh() {
            this._loadEmployees();
        }
    });
});
