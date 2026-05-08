sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel"
], (UIComponent, Device, JSONModel) => {
    "use strict";

    return UIComponent.extend("timesheet.app.Component", {

        metadata: { manifest: "json" },

        init() {
            UIComponent.prototype.init.apply(this, arguments);

            // Honour ?role=employee|manager in the URL (query string OR
            // first segment of the hash) so power users can deep-link
            // into a specific role without flipping localStorage manually.
            try {
                const params = new URLSearchParams(window.location.search);
                let sRole = params.get("role");
                if (!sRole && window.location.hash) {
                    const hashQ = window.location.hash.split("?")[1];
                    if (hashQ) sRole = new URLSearchParams(hashQ).get("role");
                }
                if (sRole && (sRole === "employee" || sRole === "manager")) {
                    localStorage.setItem("tsRole", sRole);
                }
            } catch (e) { /* ignore — non-blocking */ }

            // Restore persisted data so history survives page refresh
            this.setModel(new JSONModel(this._fromStorage("tsHistory",        { submissions: [] })), "history");
            this.setModel(new JSONModel(this._fromStorage("tsLocked",         {})),                  "locked");
            this.setModel(new JSONModel(this._fromStorage("tsNotifications",  { items: [] })),        "notifications");
            this.setModel(new JSONModel(this._fromStorage("tsTasks",          { items: [] })),        "tasks");
            this.setModel(new JSONModel(this._fromStorage("tsTaskUpdates",    { byTaskId: {} })),     "taskUpdates");

            this._seedDemoData();

            this.getRouter().initialize();
        },

        // ── Demo seed (idempotent — only fires when storages are empty) ─────
        // Tip: to wipe and reseed at any time, run in DevTools console:
        //   localStorage.clear(); location.reload();
        _seedDemoData() {
            const oTasks   = this.getModel("tasks");
            const oUpdates = this.getModel("taskUpdates");

            if ((oTasks.getProperty("/items") || []).length > 0) return;

            const today = new Date();
            const iso = (d) => {
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                return `${d.getFullYear()}-${m}-${day}`;
            };
            const addDays = (n) => {
                const d = new Date(today); d.setDate(d.getDate() + n); return d;
            };

            // A tiny in-memory text file used as the manager's reference
            // attachment on TASK001, so you can exercise the download flow
            // without manually uploading a file.
            const sampleText =
                "Reference document for Dashboard Widget task\n" +
                "===========================================\n" +
                "1. Component path: app/webapp/controller/Dashboard.controller.js\n" +
                "2. Bind the widget to the OData '/MyTimesheets' entity.\n" +
                "3. Use sap.f cards with the design tokens listed in the spec.\n" +
                "4. Match the mockup attached in the project Wiki.\n";
            const sampleDataUrl = "data:text/plain;base64," +
                (typeof btoa === "function" ? btoa(sampleText) : "");

            const tasks = [
                {
                    taskId: "TASK001",
                    taskName: "Build dashboard widget",
                    taskDescription:
                        "Create a reusable widget for the manager dashboard that shows weekly hours per project.\n" +
                        "Use SAPUI5 sap.f cards and bind to the existing OData service. Make sure it works on tablet too.",
                    assignedTo_employeeId: "EMP1001",
                    priority: "High",
                    status:   "In Progress",
                    startDate: iso(addDays(-3)),
                    dueDate:   iso(addDays(4)),
                    assignedOn: addDays(-3).toISOString(),
                    createdAt:  addDays(-3).toISOString(),
                    statusUpdatedAt: addDays(-1).toISOString(),
                    attachmentName:     "dashboard-widget-spec.txt",
                    attachmentMimeType: "text/plain",
                    attachmentDataUrl:  sampleDataUrl
                },
                {
                    taskId: "TASK002",
                    taskName: "CAP backend extension",
                    taskDescription:
                        "Add a new OData entity for ProjectAllocation and expose it through the EmployeeService.\n" +
                        "Include CSV seed data and write a basic integration test.",
                    assignedTo_employeeId: "EMP1001",
                    priority: "Medium",
                    status:   "Open",
                    startDate: iso(today),
                    dueDate:   iso(addDays(10)),
                    assignedOn: addDays(-1).toISOString(),
                    createdAt:  addDays(-1).toISOString()
                },
                {
                    taskId: "TASK003",
                    taskName: "HR onboarding checklist",
                    taskDescription:
                        "Prepare an onboarding checklist for new hires covering laptop setup, ID card, account creation,\n" +
                        "and the first-week orientation. Share the draft with the team for review.",
                    assignedTo_employeeId: "EMP1002",
                    priority: "Medium",
                    status:   "In Progress",
                    startDate: iso(addDays(-2)),
                    dueDate:   iso(addDays(7)),
                    assignedOn: addDays(-2).toISOString(),
                    createdAt:  addDays(-2).toISOString()
                },
                {
                    taskId: "TASK004",
                    taskName: "Client follow-up — Q2 leads",
                    taskDescription:
                        "Reach out to the 12 Q2 leads from last quarter's campaign. Capture interest level and next-step\n" +
                        "actions in the CRM. Flag any hot leads that need a manager call.",
                    assignedTo_employeeId: "EMP1003",
                    priority: "High",
                    status:   "In Progress",
                    startDate: iso(addDays(-5)),
                    dueDate:   iso(addDays(2)),
                    assignedOn: addDays(-5).toISOString(),
                    createdAt:  addDays(-5).toISOString(),
                    statusUpdatedAt: addDays(-1).toISOString()
                },
                {
                    taskId: "TASK005",
                    taskName: "Sales deck refresh",
                    taskDescription:
                        "Refresh the Q3 sales deck — update revenue numbers, refresh customer logos, and add the new\n" +
                        "case study from Acme Corp. Final version due before the regional review.",
                    assignedTo_employeeId: "EMP1003",
                    priority: "Low",
                    status:   "Open",
                    startDate: iso(today),
                    dueDate:   iso(addDays(14)),
                    assignedOn: today.toISOString(),
                    createdAt:  today.toISOString()
                },
                {
                    taskId: "TASK006",
                    taskName: "Quarter-end reconciliation",
                    taskDescription:
                        "Reconcile vendor invoices for the quarter, post the missing journal entries, and prepare a short\n" +
                        "summary report for the finance review meeting on Friday.",
                    assignedTo_employeeId: "EMP1004",
                    priority: "High",
                    status:   "Completed",
                    startDate: iso(addDays(-10)),
                    dueDate:   iso(addDays(-1)),
                    assignedOn: addDays(-10).toISOString(),
                    createdAt:  addDays(-10).toISOString(),
                    statusUpdatedAt: addDays(-1).toISOString()
                },
                {
                    taskId: "TASK007",
                    taskName: "Expense audit",
                    taskDescription:
                        "Audit travel expenses for March and April. Flag anything above policy and prepare the variance\n" +
                        "summary to share with HR.",
                    assignedTo_employeeId: "EMP1004",
                    priority: "Medium",
                    status:   "Open",
                    startDate: iso(today),
                    dueDate:   iso(addDays(5)),
                    assignedOn: today.toISOString(),
                    createdAt:  today.toISOString()
                }
            ];

            const updates = {
                "TASK001": [
                    {
                        updateId:             "TASK001-U001",
                        task_taskId:          "TASK001",
                        updateDate:           iso(addDays(-2)),
                        notes:                "Set up the widget skeleton, wired the OData binding for weekly hours and validated the model in the dev console.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1001",
                        createdAt:            addDays(-2).toISOString()
                    },
                    {
                        updateId:             "TASK001-U002",
                        task_taskId:          "TASK001",
                        updateDate:           iso(addDays(-1)),
                        notes:                "Implemented the bar chart and applied the design tokens. Tablet layout still has a small overflow that I'll fix tomorrow.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1001",
                        createdAt:            addDays(-1).toISOString()
                    }
                ],
                "TASK003": [
                    {
                        updateId:             "TASK003-U001",
                        task_taskId:          "TASK003",
                        updateDate:           iso(addDays(-1)),
                        notes:                "Drafted the onboarding checklist covering laptop, badge, and account setup. Shared with HR for review.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1002",
                        createdAt:            addDays(-1).toISOString()
                    }
                ],
                "TASK004": [
                    {
                        updateId:             "TASK004-U001",
                        task_taskId:          "TASK004",
                        updateDate:           iso(addDays(-3)),
                        notes:                "Spoke to 5 of the 12 leads. Two are hot — booking a manager call for next week. Three asked for follow-up next month.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1003",
                        createdAt:            addDays(-3).toISOString()
                    },
                    {
                        updateId:             "TASK004-U002",
                        task_taskId:          "TASK004",
                        updateDate:           iso(today),
                        notes:                "Hot leads confirmed for the manager call. Sent the briefing pack and updated CRM with discovery notes.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1003",
                        createdAt:            today.toISOString()
                    }
                ],
                "TASK006": [
                    {
                        updateId:             "TASK006-U001",
                        task_taskId:          "TASK006",
                        updateDate:           iso(addDays(-2)),
                        notes:                "Reconciliation complete. Summary report drafted and saved to the shared drive. Ready for review.",
                        attachmentName:       "",
                        attachmentMimeType:   "",
                        attachmentDataUrl:    "",
                        updatedBy_employeeId: "EMP1004",
                        createdAt:            addDays(-2).toISOString()
                    }
                ]
            };

            oTasks.setProperty("/items", tasks);
            oUpdates.setProperty("/byTaskId", updates);
            this.persistTasks();
            this.persistTaskUpdates();
        },

        // ── Current user identity (local-dev) ─────────────────────────────
        // Maps the active role to a real employeeId from EmployeeMaster so
        // notifications can be addressed to the correct recipient.
        getCurrentEmployeeId() {
            let sRole = "employee";
            try { sRole = (localStorage.getItem("tsRole") || "employee").toLowerCase(); } catch (e) {}
            return sRole === "manager" ? "EMP1005" : "EMP1001";
        },

        // Built-in employee directory — mirrors db/data/EmployeeMaster.csv.
        // Used as a fallback when the OData /Employees call is blocked
        // (e.g. local-dev without auth, or 401/403 from xsuaa).
        _builtinEmployees: {
            "EMP1001": { employeeId: "EMP1001", employeeName: "Jatin Bajaj",    designation: "Developer",       email: "jatin.bajaj@ccentrik.com",  address: "Delhi India",   mobileNumber: "9876543210", manager_employeeId: "EMP1005", isActive: true },
            "EMP1002": { employeeId: "EMP1002", employeeName: "Rahul Sharma",   designation: "HR",              email: "rahul.sharma@ccentrik.com", address: "Mumbai India",  mobileNumber: "9876543211", manager_employeeId: "EMP1005", isActive: true },
            "EMP1003": { employeeId: "EMP1003", employeeName: "Neha Kapoor",    designation: "Sales Executive", email: "neha.kapoor@ccentrik.com",  address: "Gurgaon India", mobileNumber: "9876543212", manager_employeeId: "EMP1006", isActive: true },
            "EMP1004": { employeeId: "EMP1004", employeeName: "Ankit Verma",    designation: "Accountant",      email: "ankit.verma@ccentrik.com",  address: "Noida India",   mobileNumber: "9876543213", manager_employeeId: "EMP1005", isActive: true },
            "EMP1005": { employeeId: "EMP1005", employeeName: "Pankaj Sir",     designation: "Manager",         email: "pankaj@ccentrik.com",       address: "Delhi India",   mobileNumber: "9876543214", manager_employeeId: "EMP1006", isActive: true },
            "EMP1006": { employeeId: "EMP1006", employeeName: "Founder Member", designation: "Founder",         email: "founder@ccentrik.com",      address: "Delhi India",   mobileNumber: "9876543215", manager_employeeId: null,     isActive: true }
        },

        // Looks up an employee record by id. Tries the OData "Employees"
        // entity first (so the UI reflects live edits), falls back to the
        // built-in directory above if the call fails or returns nothing.
        getEmployeeById(sEmployeeId) {
            if (!sEmployeeId) return Promise.resolve(null);
            this._employeeCache = this._employeeCache || {};
            if (this._employeeCache[sEmployeeId]) {
                return Promise.resolve(this._employeeCache[sEmployeeId]);
            }
            const fromBuiltin = this._builtinEmployees[sEmployeeId] || null;
            const oModel = this.getModel();
            if (!oModel) return Promise.resolve(fromBuiltin);

            return oModel.bindList("/Employees").requestContexts(0, 200)
                .then(aCtx => {
                    aCtx.forEach(c => {
                        const o = c.getObject();
                        if (o && o.employeeId) this._employeeCache[o.employeeId] = o;
                    });
                    return this._employeeCache[sEmployeeId] || fromBuiltin;
                })
                .catch(() => fromBuiltin);
        },

        _fromStorage(sKey, oDefault) {
            try {
                const s = localStorage.getItem(sKey);
                return s ? JSON.parse(s) : oDefault;
            } catch (e) { return oDefault; }
        },

        persistHistory() {
            try { localStorage.setItem("tsHistory",       JSON.stringify(this.getModel("history").getData()));       } catch (e) {}
        },

        persistLocked() {
            try { localStorage.setItem("tsLocked",        JSON.stringify(this.getModel("locked").getData()));        } catch (e) {}
        },

        persistNotifications() {
            try { localStorage.setItem("tsNotifications", JSON.stringify(this.getModel("notifications").getData())); } catch (e) {}
        },

        persistTasks() {
            try { localStorage.setItem("tsTasks",         JSON.stringify(this.getModel("tasks").getData()));         } catch (e) {}
        },

        persistTaskUpdates() {
            try { localStorage.setItem("tsTaskUpdates",   JSON.stringify(this.getModel("taskUpdates").getData()));   } catch (e) {}
        },

        getContentDensityClass() {
            return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
        }
    });
});
