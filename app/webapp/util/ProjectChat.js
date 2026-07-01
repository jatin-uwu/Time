/* ─────────────────────────────────────────────────────────────────────────
 * ProjectChat — reusable project chat popup.
 *
 * Usage: new ProjectChat(oView, oComponent).open(projectId, projectName)
 *
 * Mirrors GroupChat.js but targets the /project/ service endpoint and the
 * ProjectMessage / ProjectAttachment entities.
 * ───────────────────────────────────────────────────────────────────────── */
sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "timesheet/app/util/MessageBox",
    "sap/ui/core/Popup",
    "sap/m/ResponsivePopover",
    "sap/m/ScrollContainer",
    "sap/m/HBox",
    "sap/m/Button"
], function (Fragment, JSONModel, MessageToast, MessageBox, Popup, ResponsivePopover, ScrollContainer, HBox, Button) {
    "use strict";

    const PAGE_SIZE = 50;
    const POLL_MS = 10000;

    const EMOJIS = (
        "😀 😁 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 " +
        "😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 " +
        "😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😬 🙄 😴 🤤 😪 😷 🤒 🤕 🤧 " +
        "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 👀 🫶 ✋ 👋 🤙 ☝️ " +
        "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 🔥 ✨ ⭐ 🎉 🎊 ✅ ❌ ⚠️ ❗ " +
        "📌 📎 📁 📅 📝 ✏️ 💡 🚀 ⏰ ☕ 🍕 🎯 🏆 👏 🤝 📞 📧 💬 👇 👉"
    ).split(/\s+/).filter(Boolean);

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

    // Fetch helper for /project/ actions.
    async function callProj(action, params) {
        let token = null;
        try {
            const h = await fetch("/project/", { headers: { "X-CSRF-Token": "Fetch" }, credentials: "include" });
            token = h.headers.get("x-csrf-token");
        } catch (e) { /* ignore */ }
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers["X-CSRF-Token"] = token;
        const resp = await fetch("/project/" + action, {
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

    const ProjectChat = function (oView, oComponent) {
        this._view = oView;
        this._comp = oComponent;
        this._attCache = {};
        this._fragId = oView.getId() + "--pchat";
        this._all = [];
        this._model = new JSONModel({
            projectId: "", projectName: "",
            messages: [], draft: "", pendingFiles: [],
            page: 1, hasMore: false, sending: false, search: "",
            pinned: null, editingId: null
        });
    };

    ProjectChat.prototype.open = function (sProjectId, sProjectName, fnOnClose, bDark) {
        this._myId = this._comp.getCurrentEmployeeId && this._comp.getCurrentEmployeeId();
        this._onClose = fnOnClose || null;
        this._dark = !!bDark;
        this._all = [];
        this._model.setData({
            projectId: sProjectId, projectName: sProjectName || "Project",
            messages: [], draft: "", pendingFiles: [],
            page: 1, hasMore: false, sending: false, search: "",
            pinned: null, editingId: null
        });

        const showIt = (oPanel) => {
            oPanel.setModel(this._model, "chat");
            // Apply or remove dark modifier class on the panel root DOM node.
            const applyTheme = () => {
                const dom = oPanel.getDomRef && oPanel.getDomRef();
                if (dom) {
                    dom.classList.toggle("tsChatPanel--dark", this._dark);
                } else {
                    setTimeout(applyTheme, 60);
                }
            };
            if (!this._popup) {
                this._popup = new Popup(oPanel, true, true, false);
                this._popup.attachClosed(() => {
                    this._open = false;
                    this._stopPolling();
                    this._detachEsc();
                    if (this._onClose) { try { this._onClose(); } catch (e) { /* */ } }
                });
            }
            this._popup.setModal(true, "tsCustDialogBLY");
            if (!this._popup.isOpen()) {
                this._popup.open(160, Popup.Dock.EndTop, Popup.Dock.EndTop, window, "0 0", "none");
            }
            this._open = true;
            applyTheme();
            this._loadChat(true);
            this._startPolling();
            this._bindEnterKey();
            this._attachEsc();
        };

        if (this._pPanel) { this._pPanel.then(showIt); return; }
        this._pPanel = Fragment.load({
            id: this._fragId,
            name: "timesheet.app.view.fragment.ProjectChatDialog",
            controller: this
        }).then((oPanel) => {
            this._view.addDependent(oPanel);
            this._panel = oPanel;
            return oPanel;
        });
        this._pPanel.then(showIt);
    };

    ProjectChat.prototype.onChatClosed = function () {
        if (this._popup && this._popup.isOpen()) this._popup.close(120);
    };

    ProjectChat.prototype._attachEsc = function () {
        if (this._escHandler) return;
        this._escHandler = (e) => { if (e.key === "Escape" || e.keyCode === 27) this.onChatClosed(); };
        document.addEventListener("keydown", this._escHandler);
    };
    ProjectChat.prototype._detachEsc = function () {
        if (this._escHandler) { document.removeEventListener("keydown", this._escHandler); this._escHandler = null; }
    };

    ProjectChat.prototype._bindEnterKey = function () {
        const oInput = Fragment.byId(this._fragId, "pchatInput");
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
    ProjectChat.prototype._fetch = function (page) {
        return callProj("getProjectMessages", {
            projectId: this._model.getProperty("/projectId"), page: page, pageSize: PAGE_SIZE
        }).then((raw) => {
            try { return JSON.parse(raw || "{}"); } catch (e) { return { messages: [], hasMore: false }; }
        });
    };

    ProjectChat.prototype._build = function (m) {
        const isMine = m.senderId === this._myId;
        const isDeleted = !!m.isDeleted;
        return {
            messageId: m.messageId, senderId: m.senderId, senderName: m.senderName,
            message: isDeleted ? "" : (m.message || ""),
            isDeleted: isDeleted,
            deletedText: "This message was deleted",
            edited: !isDeleted && !!m.editedAt,
            timeLabel: fmtDateTime(m.sentAt),
            isMine: isMine,
            canManage: isMine && !isDeleted,
            canPin: !isDeleted,
            initials: initialsOf(m.senderName),
            attachments: isDeleted ? [] : (m.attachments || []).map((a) => ({
                attachmentId: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType,
                fileSize: a.fileSize, sizeLabel: sizeLabel(a.fileSize),
                isImage: /^image\//i.test(a.mimeType || ""), thumbUrl: this._attCache[a.attachmentId] || ""
            }))
        };
    };

    ProjectChat.prototype._applyPinned = function (pinned) {
        if (!pinned || !pinned.messageId) { this._model.setProperty("/pinned", null); return; }
        const txt = String(pinned.message || "");
        const preview = txt.length > 80 ? (txt.slice(0, 80) + "…") : (txt || "(attachment)");
        this._model.setProperty("/pinned", {
            messageId: pinned.messageId,
            senderName: pinned.senderName || "",
            pinnedByName: pinned.pinnedByName || "",
            preview: preview
        });
    };

    ProjectChat.prototype._setMessages = function (arr) {
        this._all = arr || [];
        this._applySearch();
    };
    ProjectChat.prototype._applySearch = function () {
        const q = (this._model.getProperty("/search") || "").toLowerCase();
        const all = this._all || [];
        const list = q
            ? all.filter((m) => ((m.message || "") + " " + (m.senderName || "")).toLowerCase().indexOf(q) !== -1)
            : all;
        this._model.setProperty("/messages", list);
    };
    ProjectChat.prototype.onSearchMessages = function (oEvent) {
        this._model.setProperty("/search", oEvent.getParameter("newValue") || "");
        this._applySearch();
    };

    ProjectChat.prototype._loadChat = function (reset) {
        this._model.setProperty("/page", 1);
        this._fetch(1).then((res) => {
            const messages = (res.messages || []).map((m) => this._build(m));
            this._setMessages(messages);
            this._model.setProperty("/hasMore", !!res.hasMore);
            this._applyPinned(res.pinned);
            this._loadThumbs(messages);
            if (reset) { this._scrollToBottom(); }
        }).catch(() => { /* leave empty */ });
    };

    ProjectChat.prototype.onLoadEarlier = function () {
        const next = (this._model.getProperty("/page") || 1) + 1;
        this._fetch(next).then((res) => {
            const older = (res.messages || []).map((m) => this._build(m));
            const cur = this._all || [];
            const ids = new Set(cur.map((m) => m.messageId));
            this._setMessages(older.filter((m) => !ids.has(m.messageId)).concat(cur));
            this._model.setProperty("/page", next);
            this._model.setProperty("/hasMore", !!res.hasMore);
            this._loadThumbs(older);
        }).catch(() => { /* ignore */ });
    };

    ProjectChat.prototype._startPolling = function () {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            if (!this._open) { this._stopPolling(); return; }
            this._poll();
        }, POLL_MS);
    };
    ProjectChat.prototype._stopPolling = function () { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } };

    ProjectChat.prototype._poll = function () {
        this._fetch(1).then((res) => {
            this._applyPinned(res.pinned);
            const cur = this._all || [];
            const byId = {}; (res.messages || []).forEach((m) => { byId[m.messageId] = m; });
            let changed = false;
            const merged = cur.map((existing) => {
                const srv = byId[existing.messageId];
                if (srv && ((!!srv.isDeleted) !== existing.isDeleted ||
                            (srv.isDeleted ? "" : (srv.message || "")) !== existing.message ||
                            (!!srv.editedAt) !== existing.edited)) {
                    changed = true; return this._build(srv);
                }
                return existing;
            });
            const ids = new Set(cur.map((m) => m.messageId));
            const fresh = (res.messages || []).filter((m) => !ids.has(m.messageId)).map((m) => this._build(m));
            if (!fresh.length && !changed) return;
            this._setMessages(merged.concat(fresh));
            this._loadThumbs(fresh);
            if (fresh.length) this._scrollToBottom();
        }).catch(() => { /* ignore */ });
    };

    // ── Image thumbnails (lazy + cached) ──────────────────────────────────
    ProjectChat.prototype._loadThumbs = function (messages) {
        (messages || []).forEach((m) => (m.attachments || []).forEach((a) => {
            if (!a.isImage || this._attCache[a.attachmentId]) return;
            callProj("getProjectChatAttachment", { attachmentId: a.attachmentId }).then((r) => {
                if (!r || !r.dataBase64) return;
                this._attCache[a.attachmentId] = "data:" + (r.mimeType || "image/png") + ";base64," + r.dataBase64;
                this._applyThumbs();
            }).catch(() => { /* ignore */ });
        }));
    };
    ProjectChat.prototype._applyThumbs = function () {
        const messages = this._all || [];
        messages.forEach((m) => (m.attachments || []).forEach((a) => {
            if (a.isImage && !a.thumbUrl && this._attCache[a.attachmentId]) a.thumbUrl = this._attCache[a.attachmentId];
        }));
        this._setMessages(messages.slice());
    };

    ProjectChat.prototype._scrollToBottom = function () {
        setTimeout(() => {
            const oScroll = Fragment.byId(this._fragId, "pchatScroll");
            const dom = oScroll && oScroll.getDomRef();
            if (dom) dom.scrollTop = dom.scrollHeight;
        }, 80);
    };

    // ── Attachments ───────────────────────────────────────────────────────
    ProjectChat.prototype.onPickAttachment = function () {
        let input = document.getElementById("__pchatFileInput");
        if (!input) {
            input = document.createElement("input");
            input.type = "file"; input.id = "__pchatFileInput"; input.multiple = true;
            input.style.display = "none"; document.body.appendChild(input);
        }
        input.value = "";
        input.onchange = (ev) => {
            Array.from(ev.target.files || []).forEach((file) => {
                if (file.size > 10 * 1024 * 1024) { MessageToast.show('"' + file.name + '" exceeds the 10 MB limit.'); return; }
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

    ProjectChat.prototype.onRemovePending = function (oEvent) {
        const oCtx = oEvent.getSource().getBindingContext("chat");
        if (!oCtx) return;
        const idx = parseInt(oCtx.getPath().split("/").pop(), 10);
        const pending = (this._model.getProperty("/pendingFiles") || []).slice();
        if (idx >= 0) { pending.splice(idx, 1); this._model.setProperty("/pendingFiles", pending); }
    };

    // ── Emoji picker ──────────────────────────────────────────────────────
    ProjectChat.prototype.onToggleEmoji = function (oEvent) {
        const oOpener = oEvent.getSource();
        if (this._emojiPopover && this._emojiPopover.isOpen()) { this._emojiPopover.close(); return; }
        if (!this._emojiPopover) {
            const oGrid = new HBox({ wrap: "Wrap", width: "100%" }).addStyleClass("tsEmojiGrid");
            EMOJIS.forEach((e) => {
                oGrid.addItem(new Button({
                    text: e, type: "Transparent",
                    press: () => this._insertEmoji(e)
                }).addStyleClass("tsEmojiBtn"));
            });
            this._emojiPopover = new ResponsivePopover({
                showHeader: false, placement: "Top", contentWidth: "320px",
                content: [new ScrollContainer({ vertical: true, horizontal: false, height: "240px", width: "100%", content: [oGrid] })]
            }).addStyleClass("tsEmojiPopover");
            this._view.addDependent(this._emojiPopover);
        }
        this._emojiPopover.openBy(oOpener);
    };

    ProjectChat.prototype._insertEmoji = function (sEmoji) {
        const oInput = Fragment.byId(this._fragId, "pchatInput");
        const ta = oInput && oInput.getFocusDomRef();
        const cur = this._model.getProperty("/draft") || "";
        let start = cur.length, end = cur.length;
        if (ta && typeof ta.selectionStart === "number") { start = ta.selectionStart; end = ta.selectionEnd; }
        const next = cur.slice(0, start) + sEmoji + cur.slice(end);
        this._model.setProperty("/draft", next);
        setTimeout(() => {
            if (!ta) return;
            ta.focus();
            const pos = start + sEmoji.length;
            try { ta.setSelectionRange(pos, pos); } catch (e) { /* */ }
        }, 0);
    };

    function _parseResult(raw) {
        if (raw && typeof raw === "object") return raw;
        try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
    }

    // ── Send / Edit ───────────────────────────────────────────────────────
    ProjectChat.prototype.onSendMessage = function () {
        const draft = (this._model.getProperty("/draft") || "").trim();
        const editingId = this._model.getProperty("/editingId");

        if (editingId) {
            if (!draft) { MessageToast.show("Message cannot be empty."); return; }
            if (this._model.getProperty("/sending")) return;
            this._model.setProperty("/sending", true);
            callProj("editProjectMessage", { messageId: editingId, message: draft }).then((raw) => {
                const r = _parseResult(raw);
                if (r.error) throw new Error(r.error);
                this._model.setProperty("/sending", false);
                this._model.setProperty("/draft", "");
                this._model.setProperty("/editingId", null);
                this._loadChat();
            }).catch((err) => {
                this._model.setProperty("/sending", false);
                MessageBox.error((err && err.message) || "Could not edit the message.");
            });
            return;
        }

        const pending = this._model.getProperty("/pendingFiles") || [];
        if (!draft && !pending.length) return;
        if (this._model.getProperty("/sending")) return;

        this._model.setProperty("/sending", true);
        callProj("sendProjectMessage", {
            projectId: this._model.getProperty("/projectId"),
            message: draft,
            attachments: pending.map((f) => ({ fileName: f.fileName, mimeType: f.mimeType, dataBase64: f.dataBase64 }))
        }).then(() => {
            this._model.setProperty("/sending", false);
            this._model.setProperty("/draft", "");
            this._model.setProperty("/pendingFiles", []);
            this._poll();
        }).catch((err) => {
            this._model.setProperty("/sending", false);
            MessageBox.error((err && err.message) || "Could not send the message.");
        });
    };

    // ── Edit / Delete / Pin ───────────────────────────────────────────────
    ProjectChat.prototype._msgFromEvent = function (oEvent) {
        const oCtx = oEvent.getSource().getBindingContext("chat");
        return oCtx ? oCtx.getObject() : null;
    };

    ProjectChat.prototype.onEditMessage = function (oEvent) {
        const m = this._msgFromEvent(oEvent);
        if (!m || !m.messageId) return;
        this._model.setProperty("/editingId", m.messageId);
        this._model.setProperty("/draft", m.message || "");
        const ta = Fragment.byId(this._fragId, "pchatInput");
        if (ta && ta.focus) { try { ta.focus(); } catch (e) { /* */ } }
    };

    ProjectChat.prototype.onCancelEdit = function () {
        this._model.setProperty("/editingId", null);
        this._model.setProperty("/draft", "");
    };

    ProjectChat.prototype.onDeleteMessage = function (oEvent) {
        const m = this._msgFromEvent(oEvent);
        if (!m || !m.messageId) return;
        MessageBox.confirm('Delete this message? It will show as "This message was deleted".', {
            title: "Delete message",
            onClose: (sAction) => {
                if (sAction !== MessageBox.Action.OK && sAction !== "OK") return;
                callProj("deleteProjectMessage", { messageId: m.messageId }).then((raw) => {
                    const r = _parseResult(raw);
                    if (r.error) throw new Error(r.error);
                    if (this._model.getProperty("/editingId") === m.messageId) this.onCancelEdit();
                    this._loadChat();
                }).catch((err) => MessageBox.error((err && err.message) || "Could not delete the message."));
            }
        });
    };

    ProjectChat.prototype.onPinMessage = function (oEvent) {
        const m = this._msgFromEvent(oEvent);
        if (!m || !m.messageId) return;
        callProj("pinProjectMessage", { projectId: this._model.getProperty("/projectId"), messageId: m.messageId }).then((raw) => {
            const r = _parseResult(raw);
            if (r.error) throw new Error(r.error);
            MessageToast.show("Message pinned.");
            this._loadChat();
        }).catch((err) => MessageBox.error((err && err.message) || "Could not pin the message."));
    };

    ProjectChat.prototype.onUnpinMessage = function () {
        callProj("unpinProjectMessage", { projectId: this._model.getProperty("/projectId") }).then((raw) => {
            const r = _parseResult(raw);
            if (r.error) throw new Error(r.error);
            MessageToast.show("Message unpinned.");
            this._loadChat();
        }).catch((err) => MessageBox.error((err && err.message) || "Could not unpin the message."));
    };

    ProjectChat.prototype.onPinnedClick = function () {
        const pinned = this._model.getProperty("/pinned");
        if (!pinned || !pinned.messageId) return;
        this._scrollToMessage(pinned.messageId);
    };

    ProjectChat.prototype._scrollToMessage = function (sMessageId) {
        const exists = (this._all || []).some((m) => m.messageId === sMessageId);
        const doScroll = () => setTimeout(() => {
            const el = document.querySelector('[data-msgid="' + sMessageId + '"]');
            if (el && el.scrollIntoView) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("tsChatHighlight");
                setTimeout(() => { try { el.classList.remove("tsChatHighlight"); } catch (e) { /* */ } }, 1800);
            }
        }, 120);
        if (exists) { doScroll(); return; }
        let guard = 0;
        const loadMore = () => {
            if (guard++ > 10 || (this._all || []).some((m) => m.messageId === sMessageId)) { doScroll(); return; }
            if (!this._model.getProperty("/hasMore")) { doScroll(); return; }
            const next = (this._model.getProperty("/page") || 1) + 1;
            this._fetch(next).then((res) => {
                const older = (res.messages || []).map((m) => this._build(m));
                const cur = this._all || [];
                const ids = new Set(cur.map((m) => m.messageId));
                this._setMessages(older.filter((m) => !ids.has(m.messageId)).concat(cur));
                this._model.setProperty("/page", next);
                this._model.setProperty("/hasMore", !!res.hasMore);
                loadMore();
            }).catch(() => doScroll());
        };
        loadMore();
    };

    // ── Download attachment ───────────────────────────────────────────────
    ProjectChat.prototype.onDownloadAttachment = function (oEvent) {
        const oCtx = oEvent.getSource().getBindingContext("chat");
        const att = oCtx && oCtx.getObject();
        if (!att || !att.attachmentId) return;
        callProj("getProjectChatAttachment", { attachmentId: att.attachmentId }).then((r) => {
            if (!r || !r.dataBase64) { MessageToast.show("Attachment is not available."); return; }
            const a = document.createElement("a");
            a.href = "data:" + (r.mimeType || "application/octet-stream") + ";base64," + r.dataBase64;
            a.download = r.fileName || att.fileName || "attachment";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }).catch((e) => MessageToast.show("Could not download: " + ((e && e.message) || e)));
    };

    ProjectChat.prototype.destroy = function () {
        this._stopPolling();
        this._detachEsc();
        if (this._emojiPopover) { this._emojiPopover.destroy(); this._emojiPopover = null; }
        if (this._popup) { this._popup.destroy(); this._popup = null; }
        if (this._panel) { this._panel.destroy(); this._panel = null; this._pPanel = null; }
    };

    return ProjectChat;
});
