sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    // POST to a /client action; parse LargeString JSON result.
    function cpost(action, params) {
        return fetch("/client/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function fmtDate(s) { if (!s) return "—"; var d = new Date(s); return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
    function fmtDateTime(s) { if (!s) return ""; var d = new Date(s); return isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

    var PRIORITIES = ["Critical", "High", "Medium", "Low"];
    var REQ_STATUS_COLOR = {
        "New": "#6b7280", "Assigned": "#2563eb", "Under Analysis": "#7c3aed",
        "In Development": "#0891b2", "Under Testing": "#d97706",
        "Awaiting Client Review": "#db2777", "Approved": "#16a34a",
        "Rejected": "#dc2626", "Closed": "#475569"
    };
    function statusChip(s) {
        var c = REQ_STATUS_COLOR[s] || "#6b7280";
        return "<span class='cpStatus' style='background:" + c + "22;color:" + c + ";border:1px solid " + c + "44'>" + esc(s) + "</span>";
    }
    function prioChip(p) {
        var c = p === "Critical" ? "#dc2626" : p === "High" ? "#ea580c" : p === "Medium" ? "#2563eb" : "#64748b";
        return "<span class='cpPrio' style='color:" + c + "'>" + esc(p) + "</span>";
    }

    return Controller.extend("timesheet.app.controller.ClientPortal", {
        onInit: function () {
            window._clientCtrl = this;
            this.getOwnerComponent().getRouter().getRoute("client-portal").attachPatternMatched(this._onMatched, this);
        },
        onExit: function () { if (window._clientCtrl === this) window._clientCtrl = null; },
        _host: function () { return this.byId("clientHost"); },
        _onMatched: function () { this._view = "dashboard"; this._loadDashboard(); },

        // ── Dashboard ───────────────────────────────────────────────────────────
        _loadDashboard: function () {
            var that = this, h = this._host();
            if (h) h.setContent("<div class='cpWrap'><div class='cpLoading'>Loading your portal…</div></div>");
            cpost("getClientDashboard", {}).then(function (d) {
                if (d && d.error) { if (h) h.setContent("<div class='cpWrap'><div class='cpEmpty'>" + esc(d.error) + "</div></div>"); return; }
                that._dash = d; that._view = "dashboard"; that._renderDashboard();
            }).catch(function () { if (h) h.setContent("<div class='cpWrap'><div class='cpEmpty'>Could not load your portal.</div></div>"); });
        },

        _topbar: function (sub) {
            var d = this._dash || {};
            return "<div class='cpTop'><div class='cpBrand'><div class='cpLogo'>" + esc((d.clientName || "C").slice(0, 1).toUpperCase()) + "</div>" +
                "<div><div class='cpBrandName'>" + esc(d.clientName || "Client Portal") + "</div>" +
                "<div class='cpBrandSub'>" + esc(sub || ("Welcome, " + (d.contactPerson || "")) ) + "</div></div></div>" +
                "<button class='cpHomeBtn' onclick=\"window._clientCtrl.onHome()\">⌂ Dashboard</button></div>";
        },

        _renderDashboard: function () {
            var h = this._host(); if (!h) return;
            var d = this._dash || {}, t = d.tiles || {};
            var tiles = [
                { label: "Total Projects", val: t.totalProjects || 0, c: "#2563eb" },
                { label: "Active", val: t.activeProjects || 0, c: "#16a34a" },
                { label: "Completed", val: t.completedProjects || 0, c: "#475569" },
                { label: "Pending Requirements", val: t.pendingRequirements || 0, c: "#d97706" },
                { label: "Awaiting Your Review", val: t.awaitingReview || 0, c: "#db2777" }
            ].map(function (x) {
                return "<div class='cpTile'><div class='cpTileVal' style='color:" + x.c + "'>" + x.val + "</div><div class='cpTileLbl'>" + x.label + "</div></div>";
            }).join("");

            var projects = d.projects || [];
            var cards = projects.length ? projects.map(function (p) {
                return "<div class='cpCard' onclick=\"window._clientCtrl.onProject('" + esc(p.projectId) + "')\">" +
                    "<div class='cpCardTop'><div class='cpCardName'>" + esc(p.projectName) + "</div>" + statusChip(p.status) + "</div>" +
                    "<div class='cpCardMeta'>Phase: <b>" + esc(p.currentPhase || "—") + "</b> · POC: <b>" + esc(p.pocName || "—") + "</b></div>" +
                    "<div class='cpBar'><div class='cpBarFill' style='width:" + (p.progress || 0) + "%'></div></div>" +
                    "<div class='cpCardFoot'><span>" + (p.progress || 0) + "% complete</span><span>Updated " + fmtDate(p.updatedAt) + "</span></div></div>";
            }).join("") : "<div class='cpEmpty'>No projects assigned to your account yet.</div>";

            h.setContent("<div class='cpWrap'>" + this._topbar() +
                "<div class='cpSection'><div class='cpH1'>Dashboard</div>" +
                "<div class='cpTiles'>" + tiles + "</div>" +
                "<div class='cpH2'>Your Projects</div><div class='cpCards'>" + cards + "</div></div></div>");
        },

        onHome: function () { this._loadDashboard(); },

        // ── Project detail ────────────────────────────────────────────────────────
        onProject: function (projectId) {
            var that = this, h = this._host();
            this._projectId = projectId;
            if (h) h.setContent("<div class='cpWrap'><div class='cpLoading'>Loading project…</div></div>");
            cpost("getClientProjectDetail", { projectId: projectId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); that._loadDashboard(); return; }
                that._proj = d;
                // load requirements in parallel
                cpost("getClientRequirements", { projectId: projectId, filter: "all" }).then(function (rd) {
                    that._reqs = (rd && !rd.error) ? rd : { requirements: [] };
                    that._view = "project"; that._renderProject();
                });
            }).catch(function () { MessageToast.show("Could not load project."); that._loadDashboard(); });
        },

        _renderProject: function () {
            var h = this._host(); if (!h) return;
            var d = this._proj || {}, p = d.project || {}, reqs = (this._reqs && this._reqs.requirements) || [];
            var back = "<button class='cpBtn ghost' onclick=\"window._clientCtrl.onHome()\">← Dashboard</button>";

            var overview = "<div class='cpPanel'><div class='cpPanelHead'>" + esc(p.projectName) + " " + statusChip(p.status) + "</div>" +
                "<div class='cpInfo'><span>Phase: <b>" + esc(p.currentPhase || "—") + "</b></span>" +
                "<span>POC: <b>" + esc(p.pocName || "—") + "</b></span>" +
                "<span>Timeline: <b>" + fmtDate(p.startDate) + " → " + fmtDate(p.endDate) + "</b></span></div>" +
                (p.description ? "<div class='cpDesc'>" + esc(p.description) + "</div>" : "") +
                "<div class='cpBar'><div class='cpBarFill' style='width:" + (p.progress || 0) + "%'></div></div><div class='cpBarLbl'>" + (p.progress || 0) + "% complete</div></div>";

            var teamRows = (d.team || []).map(function (m) {
                return "<tr><td>" + esc(m.employeeName) + "</td><td>" + esc(m.designation || "—") + "</td><td>" + esc(m.roleInProject) + "</td></tr>";
            }).join("");
            var team = "<div class='cpPanel'><div class='cpPanelHead'>Assigned Team</div>" +
                (teamRows ? "<table class='cpTable'><thead><tr><th>Name</th><th>Designation</th><th>Role</th></tr></thead><tbody>" + teamRows + "</tbody></table>" : "<div class='cpMuted'>No team members assigned yet.</div>") + "</div>";

            var reqRows = reqs.map(function (r) {
                return "<tr onclick=\"window._clientCtrl.onRequirement('" + esc(r.requirementId) + "')\" class='cpRow'>" +
                    "<td><b>" + esc(r.title) + "</b><div class='cpMuted'>" + esc(r.requirementId) + "</div></td>" +
                    "<td>" + prioChip(r.priority) + "</td><td>" + esc(r.assignedToName || "—") + "</td>" +
                    "<td>" + fmtDate(r.expectedDeliveryDate) + "</td><td>" + statusChip(r.status) + "</td></tr>";
            }).join("");
            var reqPanel = "<div class='cpPanel'><div class='cpPanelHead'>Requirements <span class='cpCount'>" + reqs.length + "</span>" +
                "<button class='cpBtn primary sm' onclick=\"window._clientCtrl.onNewRequirement()\">＋ New Requirement</button></div>" +
                (reqRows ? "<table class='cpTable cpClickable'><thead><tr><th>Title</th><th>Priority</th><th>Assigned To</th><th>Expected</th><th>Status</th></tr></thead><tbody>" + reqRows + "</tbody></table>" : "<div class='cpMuted'>No requirements yet. Click “New Requirement” to raise one.</div>") + "</div>";

            h.setContent("<div class='cpWrap'>" + this._topbar(esc(p.projectName)) +
                "<div class='cpSection'>" + back + overview + team + reqPanel + "</div></div>");
        },

        // ── New requirement dialog ──────────────────────────────────────────────────
        onNewRequirement: function () {
            var that = this, d = this._proj || {}, pid = this._projectId;
            var today = new Date().toISOString().slice(0, 10);
            var prioOpts = PRIORITIES.map(function (p) { return "<option" + (p === "Medium" ? " selected" : "") + ">" + p + "</option>"; }).join("");
            var asgOpts = "<option value=''>— Unassigned —</option>" + (d.assignables || []).map(function (a) {
                return "<option value='" + esc(a.employeeId) + "'>" + esc(a.employeeName) + "</option>";
            }).join("");
            var ov = document.createElement("div");
            ov.className = "cpOverlay";
            ov.innerHTML = "<div class='cpDialog'><div class='cpDialogHead'>New Requirement</div>" +
                "<div class='cpDialogBody'>" +
                "<label class='cpFLbl'>Requirement Title *</label><input type='text' class='cpFInput' id='rqTitle' placeholder='e.g. Add bulk export to reports'/>" +
                "<label class='cpFLbl'>Description *</label><textarea class='cpFInput' id='rqDesc' rows='3'></textarea>" +
                "<label class='cpFLbl'>Business Justification</label><textarea class='cpFInput' id='rqJust' rows='2'></textarea>" +
                "<div class='cpFRow'><div><label class='cpFLbl'>Priority</label><select class='cpFInput' id='rqPrio'>" + prioOpts + "</select></div>" +
                "<div><label class='cpFLbl'>Expected Delivery</label><input type='date' class='cpFInput' id='rqDate' min='" + today + "'/></div></div>" +
                "<div class='cpFRow'><div><label class='cpFLbl'>Category</label><input type='text' class='cpFInput' id='rqCat' placeholder='e.g. Enhancement'/></div>" +
                "<div><label class='cpFLbl'>Module</label><input type='text' class='cpFInput' id='rqMod' placeholder='e.g. Reporting'/></div></div>" +
                "<label class='cpFLbl'>Assign To (POC or project employee)</label><select class='cpFInput' id='rqAsg'>" + asgOpts + "</select>" +
                "<label class='cpFLbl'>Remarks</label><textarea class='cpFInput' id='rqRemarks' rows='2'></textarea>" +
                "</div><div class='cpDialogFoot'><button class='cpBtn ghost' id='cpCancel'>Cancel</button><button class='cpBtn primary' id='cpSave'>Create Requirement</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#cpCancel").addEventListener("click", close);
            ov.querySelector("#cpSave").addEventListener("click", function () {
                var btn = this;
                var title = (ov.querySelector("#rqTitle").value || "").trim();
                var desc = (ov.querySelector("#rqDesc").value || "").trim();
                if (!title) { MessageToast.show("Requirement Title is required."); return; }
                if (!desc) { MessageToast.show("Description is required."); return; }
                btn.disabled = true; btn.textContent = "Creating…";
                cpost("createRequirement", {
                    projectId: pid, title: title, description: desc,
                    businessJustification: (ov.querySelector("#rqJust").value || "").trim(),
                    priority: ov.querySelector("#rqPrio").value,
                    expectedDeliveryDate: ov.querySelector("#rqDate").value || null,
                    category: (ov.querySelector("#rqCat").value || "").trim(),
                    module: (ov.querySelector("#rqMod").value || "").trim(),
                    remarks: (ov.querySelector("#rqRemarks").value || "").trim(),
                    assignedToId: ov.querySelector("#rqAsg").value || null
                }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Requirement created."); that.onProject(pid);
                }).catch(function () { close(); MessageToast.show("Could not create requirement."); });
            });
        },

        // ── Requirement detail ──────────────────────────────────────────────────────
        onRequirement: function (requirementId) {
            var that = this, h = this._host();
            this._requirementId = requirementId;
            if (h) h.setContent("<div class='cpWrap'><div class='cpLoading'>Loading requirement…</div></div>");
            cpost("getClientRequirementDetail", { requirementId: requirementId }).then(function (d) {
                if (d && d.error) { MessageToast.show(d.error); return; }
                that._req = d; that._view = "requirement"; that._renderRequirement();
            }).catch(function () { MessageToast.show("Could not load requirement."); });
        },

        _renderRequirement: function () {
            var h = this._host(); if (!h) return;
            var r = this._req || {};
            var back = "<button class='cpBtn ghost' onclick=\"window._clientCtrl.onProject('" + esc(r.projectId) + "')\">← " + esc(r.projectName || "Project") + "</button>";

            var meta = "<div class='cpPanel'><div class='cpPanelHead'>" + esc(r.title) + " " + statusChip(r.status) + "</div>" +
                "<div class='cpInfo'><span>Priority: <b>" + esc(r.priority) + "</b></span>" +
                "<span>Category: <b>" + esc(r.category || "—") + "</b></span>" +
                "<span>Module: <b>" + esc(r.module || "—") + "</b></span>" +
                "<span>Expected: <b>" + fmtDate(r.expectedDeliveryDate) + "</b></span>" +
                "<span>Assigned To: <b>" + esc(r.assignedToName || "—") + "</b></span></div>" +
                "<div class='cpDesc'><b>Description</b><br>" + esc(r.description || "—") + "</div>" +
                (r.businessJustification ? "<div class='cpDesc'><b>Business Justification</b><br>" + esc(r.businessJustification) + "</div>" : "") +
                (r.remarks ? "<div class='cpDesc'><b>Remarks</b><br>" + esc(r.remarks) + "</div>" : "") +
                (r.approvalComments ? "<div class='cpDesc'><b>Review Comments</b><br>" + esc(r.approvalComments) + "</div>" : "") + "</div>";

            // Review actions
            var review = "";
            if (r.canReview) {
                review = "<div class='cpPanel cpReview'><div class='cpPanelHead'>This requirement awaits your review</div>" +
                    "<div class='cpReviewBtns'>" +
                    "<button class='cpBtn primary' onclick=\"window._clientCtrl.onReview('approve')\">✓ Approve</button>" +
                    "<button class='cpBtn warn' onclick=\"window._clientCtrl.onReview('changes')\">↻ Request Changes</button>" +
                    "<button class='cpBtn danger' onclick=\"window._clientCtrl.onReview('reject')\">✕ Reject</button></div></div>";
            }

            // Attachments
            var attRows = (r.attachments || []).map(function (a) {
                return "<div class='cpAttRow'><span>📎 " + esc(a.fileName) + " <span class='cpMuted'>v" + a.version + " · " + esc(a.uploadedByName || "") + "</span></span>" +
                    "<button class='cpLink' onclick=\"window._clientCtrl.onDownloadAtt('" + esc(a.attachmentId) + "')\">Download</button></div>";
            }).join("");
            var attPanel = "<div class='cpPanel'><div class='cpPanelHead'>Documents <span class='cpCount'>" + (r.attachments || []).length + "</span>" +
                "<button class='cpBtn primary sm' onclick=\"window._clientCtrl.onUploadAtt()\">⬆ Upload</button></div>" +
                (attRows || "<div class='cpMuted'>No documents attached.</div>") + "</div>";

            // Discussion
            var cmts = (r.comments || []).map(function (c) {
                var mine = c.authorRole === "client";
                var att = c.hasAttachment ? "<div class='cpCmtAtt'><button class='cpLink' onclick=\"window._clientCtrl.onDownloadCmtAtt('" + esc(c.commentId) + "')\">📎 " + esc(c.attachmentName) + "</button></div>" : "";
                return "<div class='cpCmt " + (mine ? "mine" : "") + "'><div class='cpCmtHead'>" + esc(c.authorName) + " <span class='cpCmtRole'>" + esc(c.authorRole) + "</span> <span class='cpMuted'>" + fmtDateTime(c.at) + "</span></div>" +
                    "<div class='cpCmtBody'>" + (c.isDeleted ? "<i class='cpMuted'>deleted</i>" : esc(c.message)) + att + "</div></div>";
            }).join("");
            var disc = "<div class='cpPanel'><div class='cpPanelHead'>Discussion <span class='cpCount'>" + (r.comments || []).length + "</span></div>" +
                "<div class='cpCmts'>" + (cmts || "<div class='cpMuted'>No comments yet.</div>") + "</div>" +
                "<div class='cpCmtBox'><textarea class='cpFInput' id='cpCmtInput' rows='2' placeholder='Write a comment…'></textarea>" +
                "<button class='cpBtn primary sm' onclick=\"window._clientCtrl.onAddComment()\">Send</button></div></div>";

            // History
            var histRows = (r.history || []).map(function (x) {
                return "<tr><td>" + fmtDateTime(x.at) + "</td><td>" + esc(x.action) + "</td><td>" + esc(x.userName) + "</td>" +
                    "<td>" + esc(x.oldValue || "") + (x.newValue ? " → " + esc(x.newValue) : "") + "</td></tr>";
            }).join("");
            var hist = "<div class='cpPanel'><div class='cpPanelHead'>Audit Trail</div>" +
                (histRows ? "<table class='cpTable'><thead><tr><th>When</th><th>Action</th><th>By</th><th>Detail</th></tr></thead><tbody>" + histRows + "</tbody></table>" : "<div class='cpMuted'>No history.</div>") + "</div>";

            h.setContent("<div class='cpWrap'>" + this._topbar(esc(r.title)) +
                "<div class='cpSection'>" + back + review + meta + attPanel + disc + hist + "</div></div>");
        },

        onReview: function (decision) {
            var that = this, rid = this._requirementId;
            var labels = { approve: "Approve", changes: "Request Changes", reject: "Reject" };
            var ov = document.createElement("div");
            ov.className = "cpOverlay";
            ov.innerHTML = "<div class='cpDialog sm'><div class='cpDialogHead'>" + labels[decision] + " Requirement</div>" +
                "<div class='cpDialogBody'><label class='cpFLbl'>Comments (mandatory) *</label><textarea class='cpFInput' id='rvCmt' rows='3'></textarea></div>" +
                "<div class='cpDialogFoot'><button class='cpBtn ghost' id='cpCancel'>Cancel</button><button class='cpBtn primary' id='cpSave'>" + labels[decision] + "</button></div></div>";
            document.body.appendChild(ov);
            var close = function () { ov.remove(); };
            ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
            ov.querySelector("#cpCancel").addEventListener("click", close);
            ov.querySelector("#cpSave").addEventListener("click", function () {
                var cmt = (ov.querySelector("#rvCmt").value || "").trim();
                if (!cmt) { MessageToast.show("Comments are mandatory."); return; }
                this.disabled = true; this.textContent = "Submitting…";
                cpost("reviewRequirement", { requirementId: rid, decision: decision, comments: cmt }).then(function (res) {
                    close();
                    if (res && res.error) { MessageToast.show(res.error); return; }
                    MessageToast.show("Decision submitted."); that.onRequirement(rid);
                }).catch(function () { close(); MessageToast.show("Could not submit decision."); });
            });
        },

        onAddComment: function () {
            var that = this, rid = this._requirementId;
            var ta = document.getElementById("cpCmtInput");
            var msg = (ta && ta.value || "").trim();
            if (!msg) { MessageToast.show("Write a comment first."); return; }
            cpost("addRequirementComment", { requirementId: rid, message: msg }).then(function (res) {
                if (res && res.error) { MessageToast.show(res.error); return; }
                that.onRequirement(rid);
            }).catch(function () { MessageToast.show("Could not add comment."); });
        },

        onUploadAtt: function () {
            var that = this, rid = this._requirementId;
            var input = document.createElement("input");
            input.type = "file"; input.style.display = "none"; document.body.appendChild(input);
            input.onchange = function (ev) {
                var file = ev.target.files && ev.target.files[0];
                if (!file) { input.remove(); return; }
                if (file.size > 10 * 1024 * 1024) { MessageToast.show("File exceeds 10 MB."); input.remove(); return; }
                var reader = new FileReader();
                reader.onload = function (e) {
                    cpost("uploadRequirementAttachment", {
                        requirementId: rid, fileName: file.name, mimeType: file.type || "application/octet-stream",
                        dataBase64: String(e.target.result).replace(/^data:[^;]+;base64,/, "")
                    }).then(function (res) {
                        input.remove();
                        if (res && res.error) { MessageToast.show(res.error); return; }
                        MessageToast.show("Document uploaded."); that.onRequirement(rid);
                    }).catch(function () { input.remove(); MessageToast.show("Upload failed."); });
                };
                reader.readAsDataURL(file);
            };
            input.click();
        },

        onDownloadAtt: function (attachmentId) {
            cpost("getRequirementAttachment", { attachmentId: attachmentId }).then(function (r) {
                if (!r || !r.dataBase64) { MessageToast.show("Not available."); return; }
                var a = document.createElement("a");
                a.href = "data:" + (r.mimeType || "application/octet-stream") + ";base64," + r.dataBase64;
                a.download = r.fileName || "attachment"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }).catch(function () { MessageToast.show("Download failed."); });
        },
        onDownloadCmtAtt: function (commentId) {
            cpost("getRequirementCommentAttachment", { commentId: commentId }).then(function (r) {
                if (!r || !r.dataBase64) { MessageToast.show("Not available."); return; }
                var a = document.createElement("a");
                a.href = "data:" + (r.mimeType || "application/octet-stream") + ";base64," + r.dataBase64;
                a.download = r.fileName || "attachment"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }).catch(function () { MessageToast.show("Download failed."); });
        }
    });
});
