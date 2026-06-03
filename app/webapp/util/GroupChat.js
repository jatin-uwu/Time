/* ─────────────────────────────────────────────────────────────────────────
 * GroupChat — reusable group-task chat popup.
 *
 * Both the Group Tasks list and the Group Task detail page open the same chat
 * dialog via:  new GroupChat(oView, oComponent).open(taskId, taskName)
 *
 * All server calls go through plain fetch (NOT OData $batch) — large base64
 * attachments fail inside a $batch ("$batch failed"), and the rest of the app
 * already calls unbound actions this way.
 * ───────────────────────────────────────────────────────────────────────── */
sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox"
], function (Fragment, JSONModel, MessageToast, MessageBox) {
    "use strict";

    const PAGE_SIZE = 50;
    const POLL_MS = 10000;

    function fmtDateTime(sIso) {
        if (!sIso) return "";
        const d = new Date(sIso);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function initialsOf(sName) {
        if (!sName) return "?";
        const p = String(sName).trim().split(/\s+/);
        const a = p[0] && p[0][0] ? p[0][0] : "";
        const b = p.length > 1 && p[p.length - 1][0] ? p[p.length - 1][0] : "";
        return (a + b).toUpperCase() || a.toUpperCase() || "?";
    }
    function sizeLabel(n) {
        n = n || 0;
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
        return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    // Plain fetch caller for /employee actions (CSRF + JSON, no $batch).
    async function callEmp(action, params) {
        let token = null;
        try {
            const h = await fetch("/employee/", { headers: { "X-CSRF-Token": "Fetch" }, credentials: "include" });
            token = h.headers.get("x-csrf-token");
        } catch (e) { /* ignore */ }
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers["X-CSRF-Token"] = token;
        const resp = await fetch("/employee/" + action, {
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

    const GroupChat = function (oView, oComponent) {
        this._view = oView;
        this._comp = oComponent;
        this._attCache = {};
        this._fragId = oView.getId() + "--gchat";
        this._model = new JSONModel({
            taskId: "", taskName: "",
            messages: [], draft: "", pendingFiles: [],
            page: 1, hasMore: false, sending: false
        });
    };

    GroupChat.prototype.open = function (sTaskId, sTaskName, fnOnClose) {
        this._myId = this._comp.getCurrentEmployeeId && this._comp.getCurrentEmployeeId();
        this._onClose = fnOnClose || null;
        this._model.setData({
            taskId: sTaskId, taskName: sTaskName || "Group Task",
            messages: [], draft: "", pendingFiles: [],
            page: 1, hasMore: false, sending: false
        });

        const openIt = (oDialog) => {
            oDialog.setModel(this._model, "chat");
            oDialog.open();
            this._open = true;
            this._loadChat(true);
            this._startPolling();
            this._bindEnterKey();
        };

        if (this._pDialog) { this._pDialog.then(openIt); return; }
        this._pDialog = Fragment.load({
            id: this._fragId,
            name: "timesheet.app.view.fragment.GroupChatDialog",
            controller: this
        }).then((oDialog) => {
            this._view.addDependent(oDialog);
            this._dialog = oDialog;
            return oDialog;
        });
        this._pDialog.then(openIt);
    };

    GroupChat.prototype.onCloseChat = function () {
        this._open = false;
        this._stopPolling();
        if (this._dialog) this._dialog.close();
        if (this._onClose) { try { this._onClose(); } catch (e) { /* */ } }
    };

    GroupChat.prototype._bindEnterKey = function () {
        const oInput = Fragment.byId(this._fragId, "gchatInput");
        if (!oInput) return;
        oInput.addEventDelegate({
            onAfterRendering: () => {
                const ta = oInput.getFocusDomRef();
                if (ta && !ta._enterBound) {
                    ta._enterBound = true;
                    ta.addEventListener("keydown", (e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.onSendMessage(); }
                    });
                }
            }
        });
    };

    // ── Load / paginate / poll ────────────────────────────────────────────
    GroupChat.prototype._fetch = function (page) {
        return callEmp("getGroupTaskMessages", {
            taskId: this._model.getProperty("/taskId"), page: page, pageSize: PAGE_SIZE
        }).then((raw) => {
            try { return JSON.parse(raw || "{}"); } catch (e) { return { messages: [], hasMore: false }; }
        });
    };

    GroupChat.prototype._build = function (m) {
        return {
            messageId: m.messageId, senderId: m.senderId, senderName: m.senderName,
            message: m.message || "", timeLabel: fmtDateTime(m.sentAt),
            isMine: m.senderId === this._myId, initials: initialsOf(m.senderName),
            attachments: (m.attachments || []).map((a) => ({
                attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType,
                fileSize: a.fileSize, sizeLabel: sizeLabel(a.fileSize),
                isImage: /^image\//i.test(a.mimeType || ""), thumbUrl: this._attCache[a.attachmentId] || ""
            }))
        };
    };

    GroupChat.prototype._loadChat = function (reset) {
        this._model.setProperty("/page", 1);
        this._fetch(1).then((res) => {
            const messages = (res.messages || []).map((m) => this._build(m));
            this._model.setProperty("/messages", messages);
            this._model.setProperty("/hasMore", !!res.hasMore);
            this._loadThumbs(messages);
            if (reset) { this._scrollToBottom(); this._notifyBadge(); }
        }).catch(() => { /* leave empty */ });
    };

    GroupChat.prototype.onLoadEarlier = function () {
        const next = (this._model.getProperty("/page") || 1) + 1;
        this._fetch(next).then((res) => {
            const older = (res.messages || []).map((m) => this._build(m));
            const cur = this._model.getProperty("/messages") || [];
            const ids = new Set(cur.map((m) => m.messageId));
            this._model.setProperty("/messages", older.filter((m) => !ids.has(m.messageId)).concat(cur));
            this._model.setProperty("/page", next);
            this._model.setProperty("/hasMore", !!res.hasMore);
            this._loadThumbs(older);
        }).catch(() => { /* ignore */ });
    };

    GroupChat.prototype._startPolling = function () {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            if (!this._open) { this._stopPolling(); return; }
            this._poll();
        }, POLL_MS);
    };
    GroupChat.prototype._stopPolling = function () { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } };

    GroupChat.prototype._poll = function () {
        this._fetch(1).then((res) => {
            const cur = this._model.getProperty("/messages") || [];
            const ids = new Set(cur.map((m) => m.messageId));
            const fresh = (res.messages || []).filter((m) => !ids.has(m.messageId)).map((m) => this._build(m));
            if (!fresh.length) return;
            this._model.setProperty("/messages", cur.concat(fresh));
            this._loadThumbs(fresh);
            this._scrollToBottom();
            this._notifyBadge();
        }).catch(() => { /* ignore */ });
    };

    // ── Image thumbnails (lazy + cached) ──────────────────────────────────
    GroupChat.prototype._loadThumbs = function (messages) {
        (messages || []).forEach((m) => (m.attachments || []).forEach((a) => {
            if (!a.isImage || this._attCache[a.attachmentId]) return;
            callEmp("getTaskAttachment", { attachmentId: a.attachmentId }).then((r) => {
                if (!r || !r.dataBase64) return;
                this._attCache[a.attachmentId] = "data:" + (r.mimeType || "image/png") + ";base64," + r.dataBase64;
                this._applyThumbs();
            }).catch(() => { /* ignore */ });
        }));
    };
    GroupChat.prototype._applyThumbs = function () {
        const messages = this._model.getProperty("/messages") || [];
        messages.forEach((m) => (m.attachments || []).forEach((a) => {
            if (a.isImage && !a.thumbUrl && this._attCache[a.attachmentId]) a.thumbUrl = this._attCache[a.attachmentId];
        }));
        this._model.setProperty("/messages", messages.slice());
    };

    GroupChat.prototype._scrollToBottom = function () {
        setTimeout(() => {
            const oScroll = Fragment.byId(this._fragId, "gchatScroll");
            const dom = oScroll && oScroll.getDomRef();
            if (dom) dom.scrollTop = dom.scrollHeight;
        }, 80);
    };

    // ── Attachments (pick / remove) ───────────────────────────────────────
    GroupChat.prototype.onPickAttachment = function () {
        let input = document.getElementById("__gchatFileInput");
        if (!input) {
            input = document.createElement("input");
            input.type = "file"; input.id = "__gchatFileInput"; input.multiple = true;
            input.style.display = "none"; document.body.appendChild(input);
        }
        input.value = "";
        input.onchange = (ev) => {
            Array.from(ev.target.files || []).forEach((file) => {
                if (file.size > 10 * 1024 * 1024) { MessageToast.show("“" + file.name + "” exceeds the 10 MB limit."); return; }
                const reader = new FileReader();
                reader.onload = (e) => {
                    const pending = this._model.getProperty("/pendingFiles") || [];
                    pending.push({
                        fileName: file.name, mimeType: file.type || "application/octet-stream",
                        dataBase64: String(e.target.result).replace(/^data:[^;]+;base64,/, ""),
                        size: file.size, sizeLabel: sizeLabel(file.size)
                    });
                    this._model.setProperty("/pendingFiles", pending.slice());
                };
                reader.readAsDataURL(file);
            });
        };
        input.click();
    };

    GroupChat.prototype.onRemovePending = function (oEvent) {
        const oCtx = oEvent.getSource().getBindingContext("chat");
        if (!oCtx) return;
        const idx = parseInt(oCtx.getPath().split("/").pop(), 10);
        const pending = (this._model.getProperty("/pendingFiles") || []).slice();
        if (idx >= 0) { pending.splice(idx, 1); this._model.setProperty("/pendingFiles", pending); }
    };

    // ── Send ──────────────────────────────────────────────────────────────
    GroupChat.prototype.onSendMessage = function () {
        const draft = (this._model.getProperty("/draft") || "").trim();
        const pending = this._model.getProperty("/pendingFiles") || [];
        if (!draft && !pending.length) return;
        if (this._model.getProperty("/sending")) return;

        this._model.setProperty("/sending", true);
        callEmp("sendTaskMessage", {
            taskId: this._model.getProperty("/taskId"),
            message: draft,
            attachments: pending.map((f) => ({ fileName: f.fileName, mimeType: f.mimeType, dataBase64: f.dataBase64 }))
        }).then(() => {
            this._model.setProperty("/sending", false);
            this._model.setProperty("/draft", "");
            this._model.setProperty("/pendingFiles", []);
            this._poll();
            this._notifyBadge();
        }).catch((err) => {
            this._model.setProperty("/sending", false);
            MessageBox.error((err && err.message) || "Could not send the message.");
        });
    };

    // ── Download an attachment ────────────────────────────────────────────
    GroupChat.prototype.onDownloadAttachment = function (oEvent) {
        const oCtx = oEvent.getSource().getBindingContext("chat");
        const att = oCtx && oCtx.getObject();
        if (!att || !att.attachmentId) return;
        callEmp("getTaskAttachment", { attachmentId: att.attachmentId }).then((r) => {
            if (!r || !r.dataBase64) { MessageToast.show("Attachment is not available."); return; }
            const a = document.createElement("a");
            a.href = "data:" + (r.mimeType || "application/octet-stream") + ";base64," + r.dataBase64;
            a.download = r.fileName || att.fileName || "attachment";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }).catch((e) => MessageToast.show("Could not download: " + ((e && e.message) || e)));
    };

    GroupChat.prototype._notifyBadge = function () {
        try { sap.ui.getCore().getEventBus().publish("groupTasks", "changed"); } catch (e) { /* optional */ }
    };

    GroupChat.prototype.destroy = function () {
        this._stopPolling();
        if (this._dialog) { this._dialog.destroy(); this._dialog = null; this._pDialog = null; }
    };

    return GroupChat;
});
