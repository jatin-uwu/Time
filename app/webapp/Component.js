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
            // NOTE: This only controls the SIDEBAR UI — the actual logged-in
            // user is always determined by getCurrentUser() from the backend.
            try {
                const params = new URLSearchParams(window.location.search);
                let sRole = params.get("role");
                if (!sRole && window.location.hash) {
                    const hashQ = window.location.hash.split("?")[1];
                    if (hashQ) sRole = new URLSearchParams(hashQ).get("role");
                }
                if (sRole && (sRole === "employee" || sRole === "manager" || sRole === "hr")) {
                    localStorage.setItem("tsRole", sRole);
                    localStorage.removeItem("tsEmployeeId");
                }
            } catch (e) { /* ignore — non-blocking */ }

            // Restore persisted data so history survives page refresh
            this.setModel(new JSONModel(this._fromStorage("tsHistory", { submissions: [] })), "history");
            this.setModel(new JSONModel(this._fromStorage("tsLocked", {})), "locked");
            this.setModel(new JSONModel(this._fromStorage("tsNotifications", { items: [] })), "notifications");
            this.setModel(new JSONModel(this._fromStorage("tsTasks", { items: [] })), "tasks");
            this.setModel(new JSONModel(this._fromStorage("tsTaskUpdates", { byTaskId: {} })), "taskUpdates");

            this._seedDemoData();

            this.getRouter().initialize();

            // Kick off the JWT → EmployeeMaster lookup as early as possible.
            // This also sets localStorage.tsRole to the REAL backend role so
            // the sidebar shows the correct items after the promise resolves.
            this.getCurrentUser().then(user => {
                if (user && user.role) {
                    try { localStorage.setItem("tsRole", user.role); } catch (e) { }
                }
            });

            // ── Real-time (WebSocket) — additive & non-blocking ────────────────
            // Opens an app-wide WS that pushes content-free refresh signals.
            // Wrapped so a load/connect failure can NEVER block app startup.
            // (The Founder dashboard keeps its own independent SSE stream.)
            try {
                sap.ui.require(["timesheet/app/util/RealtimeService"], function (RealtimeService) {
                    try { RealtimeService.init(); this._realtime = RealtimeService; }
                    catch (e) { /* real-time is best-effort; ignore */ }
                }.bind(this));
            } catch (e) { /* ignore — UI must work without real-time */ }
        },

        // Cleanly stop the WebSocket when the component is destroyed (e.g. logout).
        destroy() {
            try { if (this._realtime) this._realtime.stop(); } catch (e) { /* */ }
            UIComponent.prototype.destroy.apply(this, arguments);
        },

        // ── Demo seed (idempotent) ────────────────────────────────────────
        // ─────────────────────────────────────────────────────────────────────────────
        //  Component.js — PATCH for _seedDemoData()
        //
        //  Replace your existing _seedDemoData() method with this one.
        //  Key changes:
        //    1. Status values updated: "Open" → "Not Started", kept "In Progress", "Completed"
        //    2. reviewer_employeeId and reviewerStatus fields added (null by default)
        //    3. assignedTo_employeeId values preserved exactly as before so filtering works
        // ─────────────────────────────────────────────────────────────────────────────

        _seedDemoData() {
            const oTasks = this.getModel("tasks");
            const oUpdates = this.getModel("taskUpdates");

            // ── Task seeding moved to the DATABASE ────────────────────────
            // Originally we seeded TASK001–TASK007 into every user's
            // localStorage. That caused a hard-to-spot bug: when one user
            // assigned a reviewer to a task, the reviewer's stale local
            // copy (with no reviewer) silently overrode the fresh remote
            // row, so the task never appeared on the reviewer's list.
            //
            // The same tasks now live in the TaskMaster CSV
            // (db/data/...-TaskMaster.csv) and are loaded by `cds deploy`,
            // so every browser sees the same authoritative state from
            // /MyTasks. We keep _seedDemoData around only for the
            // taskUpdates seeds (display-only progress notes); the
            // `tasks` model starts empty and is filled from the backend.
            if ((oTasks.getProperty("/items") || []).length > 0) {
                // Clear any legacy localStorage seed from older sessions —
                // remote is now the source of truth.
                oTasks.setProperty("/items", []);
                this.persistTasks();
            }

            const today = new Date();
            const iso = (d) => {
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                return `${d.getFullYear()}-${m}-${day}`;
            };
            const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

            // ── Task updates (display-only progress notes) ──────────────────────────
            const updates = {
                "TASK001": [
                    {
                        updateId: "TASK001-U001", task_taskId: "TASK001",
                        updateDate: iso(addDays(-2)),
                        notes: "Set up the widget skeleton, wired the OData binding for weekly hours and validated the model in the dev console.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1001", createdAt: addDays(-2).toISOString()
                    },
                    {
                        updateId: "TASK001-U002", task_taskId: "TASK001",
                        updateDate: iso(addDays(-1)),
                        notes: "Implemented the bar chart and applied the design tokens. Tablet layout still has a small overflow that I'll fix tomorrow.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1001", createdAt: addDays(-1).toISOString()
                    }
                ],
                "TASK003": [
                    {
                        updateId: "TASK003-U001", task_taskId: "TASK003",
                        updateDate: iso(addDays(-1)),
                        notes: "Drafted the onboarding checklist covering laptop, badge, and account setup. Shared with HR for review.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1002", createdAt: addDays(-1).toISOString()
                    }
                ],
                "TASK004": [
                    {
                        updateId: "TASK004-U001", task_taskId: "TASK004",
                        updateDate: iso(addDays(-3)),
                        notes: "Spoke to 5 of the 12 leads. Two are hot — booking a manager call for next week. Three asked for follow-up next month.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1003", createdAt: addDays(-3).toISOString()
                    },
                    {
                        updateId: "TASK004-U002", task_taskId: "TASK004",
                        updateDate: iso(today),
                        notes: "Hot leads confirmed for the manager call. Sent the briefing pack and updated CRM with discovery notes.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1003", createdAt: today.toISOString()
                    }
                ],
                "TASK006": [
                    {
                        updateId: "TASK006-U001", task_taskId: "TASK006",
                        updateDate: iso(addDays(-2)),
                        notes: "Reconciliation complete. Summary report drafted and saved to the shared drive. Ready for review.",
                        attachmentName: "", attachmentMimeType: "", attachmentDataUrl: "",
                        updatedBy_employeeId: "EMP1004", createdAt: addDays(-2).toISOString()
                    }
                ]
            };

            // NOTE: tasks intentionally NOT written to the model — they
            // live in the database now (see TaskMaster CSV). Only
            // taskUpdates (display-only progress notes) are still seeded.
            oUpdates.setProperty("/byTaskId", updates);
            this.persistTaskUpdates();
        },

        _updateDashboardTaskSummary() {
            const sEmpId = this.getCurrentEmployeeId();
            const items = (this.getModel("tasks").getProperty("/items")) || [];

            const n = s => (s || "").toLowerCase().trim();
            const mine = items.filter(t => {
                const a = t.assignedTo_employeeId ||
                    (t.assignedTo && t.assignedTo.employeeId) || t.assignedTo;
                const r = t.reviewer_employeeId ||
                    (t.reviewer && t.reviewer.employeeId) || t.reviewer;
                return !sEmpId || a === sEmpId || r === sEmpId;
            });

            // Store summary on Component so dashboard picks it up on route match
            this._cachedTaskSummary = {
                total: mine.length,
                notStarted: mine.filter(t => n(t.status) === "not started" || n(t.status) === "open").length,
                inProgress: mine.filter(t => n(t.status) === "in progress").length,
                inReview: mine.filter(t => n(t.status) === "in review").length,
                completed: mine.filter(t => n(t.status) === "completed").length
            };

            // If dashboard view is already alive, update it immediately
            try {
                sap.ui.getCore().getStaticAreaRef(); // just a no-op to gate the try
                sap.ui.getCore().byId && Object.values(sap.ui.getCore().mObjects?.view || {})
                    .filter(v => v.getControllerName && v.getControllerName().includes("Dashboard"))
                    .forEach(v => {
                        const dash = v.getModel && v.getModel("dash");
                        if (dash) dash.setProperty("/taskSummary", this._cachedTaskSummary);
                    });
            } catch (e) { }
        },

        // ── Current user identity ─────────────────────────────────────────
        // Always prefer the backend-resolved record from getCurrentUser().
        // The localStorage fallback is only used before the first backend
        // call resolves (i.e. during the very first render tick).
        getCurrentEmployeeId() {
            // Always prefer the backend-resolved user first
            if (this._oCurrentUser && this._oCurrentUser.employeeId) {
                return this._oCurrentUser.employeeId;
            }

            // ── Fallback: read from localStorage ────────────────────────────
            // Check if a real employeeId was persisted directly (set during login)
            try {
                const sStoredEmpId = localStorage.getItem("tsEmployeeId");
                if (sStoredEmpId) return sStoredEmpId;
            } catch (e) { }

            // Last resort: derive from role
            let sRole = "employee";
            try { sRole = (localStorage.getItem("tsRole") || "employee").toLowerCase(); } catch (e) { }
            if (sRole === "manager") return "EMP1005";
            if (sRole === "hr") return "EMP1002";
            return "EMP1001";
        },

        // Returns a promise that resolves to the JWT-resolved user record.
        // Caches the promise so every controller awaits the same call.
        // On resolution it ALSO writes localStorage.tsRole so the sidebar
        // immediately reflects the real backend role without a page reload.
        getCurrentUser() {
            if (this._pCurrentUser) return this._pCurrentUser;
            const oModel = this.getModel();
            if (!oModel) {
                this._pCurrentUser = Promise.resolve(null);
                return this._pCurrentUser;
            }
            try {
                const oCtx = oModel.bindContext("/getCurrentUser(...)");
                this._pCurrentUser = oCtx.execute().then(() => {
                    const oResult = oCtx.getBoundContext().getObject();
                    if (oResult && (oResult.employeeId || oResult.email)) {
                        this._oCurrentUser = oResult;
                        try {
                            // Only set role if backend actually returns it
                            if (oResult.role) {
                                localStorage.setItem("tsRole", oResult.role.toLowerCase());
                            }
                            if (oResult.employeeId) {
                                localStorage.setItem("tsEmployeeId", oResult.employeeId);
                            }
                        } catch (e) { }
                        return oResult;
                    }
                    return null;
                }).catch(() => null);
            } catch (e) {
                this._pCurrentUser = Promise.resolve(null);
            }
            return this._pCurrentUser;
        },

        // Built-in employee directory — mirrors EmployeeMaster.csv exactly.
        // Used as fallback when the OData /Employees call fails.
        _builtinEmployees: {
            "EMP1001": { employeeId: "EMP1001", employeeName: "Jatin Bajaj", designation: "Developer", email: "jatin.bajaj@ccentrik.com", address: "Delhi India", mobileNumber: "9876543210", manager_employeeId: "EMP1005", isActive: true },
            "EMP1002": { employeeId: "EMP1002", employeeName: "Punit Sharma", designation: "HR", email: "punit.sharma@ccentrik.com", address: "Gwalior India", mobileNumber: "9876543211", manager_employeeId: "EMP1005", isActive: true },
            "EMP1003": { employeeId: "EMP1003", employeeName: "Neha Kapoor", designation: "Sales Executive", email: "neha.kapoor@ccentrik.com", address: "Gurgaon India", mobileNumber: "9876543212", manager_employeeId: "EMP1006", isActive: true },
            "EMP1004": { employeeId: "EMP1004", employeeName: "Ankit Verma", designation: "Accountant", email: "ankit.verma@ccentrik.com", address: "Noida India", mobileNumber: "9876543213", manager_employeeId: "EMP1005", isActive: true },
            "EMP1005": { employeeId: "EMP1005", employeeName: "Vineet", designation: "Manager", email: "vineet@ccentrik.com", address: "Delhi India", mobileNumber: "9876543214", manager_employeeId: "EMP1006", isActive: true },
            "EMP1006": { employeeId: "EMP1006", employeeName: "Founder Member", designation: "Founder", email: "founder@ccentrik.com", address: "Delhi India", mobileNumber: "9876543215", manager_employeeId: null, isActive: true },
            "EMP1007": { employeeId: "EMP1007", employeeName: "Punit Sharma", designation: "Developer", email: "punit.sharma@ccentrik.com", address: "Delhi India", mobileNumber: "9876543216", manager_employeeId: "EMP1005", isActive: true },
            "EMP1008": { employeeId: "EMP1008", employeeName: "Priya Singh", designation: "HR Manager", email: "priya.singh@ccentrik.com", address: "Bangalore India", mobileNumber: "9876543217", manager_employeeId: "EMP1006", isActive: true }
        },

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

        persistHistory() { try { localStorage.setItem("tsHistory", JSON.stringify(this.getModel("history").getData())); } catch (e) { } },
        persistLocked() { try { localStorage.setItem("tsLocked", JSON.stringify(this.getModel("locked").getData())); } catch (e) { } },
        persistNotifications() { try { localStorage.setItem("tsNotifications", JSON.stringify(this.getModel("notifications").getData())); } catch (e) { } },
        persistTasks() { try { localStorage.setItem("tsTasks", JSON.stringify(this.getModel("tasks").getData())); } catch (e) { } },
        persistTaskUpdates() { try { localStorage.setItem("tsTaskUpdates", JSON.stringify(this.getModel("taskUpdates").getData())); } catch (e) { } },

        getContentDensityClass() {
            return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
        }
    });
});