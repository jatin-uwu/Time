/* ─────────────────────────────────────────────────────────────────────────
 * CustomDialog — a lightweight replacement for sap.m.Dialog.
 *
 * Built on sap.ui.core.Control + sap.ui.core.Popup (NOT sap.m.Dialog), so we
 * fully control the layout. The body is a plain scroll <div> (max-height +
 * overflow:auto in CSS), which scrolls reliably — no sap.m.Dialog sizing JS.
 *
 * API mirrors the bits of sap.m.Dialog the app uses, so migration is mostly a
 * rename:  new Dialog({...})  →  new CustomDialog({...})
 *   - properties:  title, contentWidth, showClose, state (for icon)
 *   - aggregations: content (0..n), beginButton, endButton, buttons (0..n)
 *   - events: afterClose
 *   - methods: open(), close()  (plus inherited setModel/addStyleClass/destroy)
 * ───────────────────────────────────────────────────────────────────────── */
sap.ui.define([
    "sap/ui/core/Control",
    "sap/ui/core/Popup"
], function (Control, Popup) {
    "use strict";

    var STATE_ICON = {
        Error:       { glyph: "✕", cls: "tsCustDlgIconError" },
        Warning:     { glyph: "⚠", cls: "tsCustDlgIconWarning" },
        Success:     { glyph: "✓", cls: "tsCustDlgIconSuccess" },
        Information: { glyph: "ℹ", cls: "tsCustDlgIconInfo" }
    };

    return Control.extend("timesheet.app.util.CustomDialog", {
        metadata: {
            properties: {
                title:        { type: "string", defaultValue: "" },
                contentWidth: { type: "sap.ui.core.CSSSize", defaultValue: "480px" },
                showClose:    { type: "boolean", defaultValue: true },
                state:        { type: "string", defaultValue: "" }
            },
            aggregations: {
                content:     { type: "sap.ui.core.Control", multiple: true, singularName: "content" },
                buttons:     { type: "sap.ui.core.Control", multiple: true, singularName: "button" },
                beginButton: { type: "sap.ui.core.Control", multiple: false },
                endButton:   { type: "sap.ui.core.Control", multiple: false }
            },
            events: {
                afterClose: {}
            }
        },

        renderer: {
            apiVersion: 2,
            render: function (rm, ctrl) {
                rm.openStart("div", ctrl);
                rm.class("tsCustDialog");
                if (ctrl.getState()) rm.class("tsCustDialogStated");
                // Emit custom style classes added via class="…" / addStyleClass
                // (e.g. tsChatDialog) so callers can theme individual dialogs.
                (ctrl.aCustomStyleClasses || []).forEach(function (c) { rm.class(c); });
                rm.style("width", ctrl.getContentWidth());
                rm.openEnd();

                // ── Header ───────────────────────────────────────────────
                rm.openStart("div").class("tsCustDialogHeader").openEnd();
                    var st = STATE_ICON[ctrl.getState()];
                    if (st) {
                        rm.openStart("span").class("tsCustDlgIcon").class(st.cls).openEnd();
                        rm.text(st.glyph);
                        rm.close("span");
                    }
                    rm.openStart("span").class("tsCustDialogTitle").openEnd();
                    rm.text(ctrl.getTitle() || "");
                    rm.close("span");
                    if (ctrl.getShowClose()) {
                        rm.openStart("button", ctrl.getId() + "-close");
                        rm.class("tsCustDialogClose");
                        rm.attr("type", "button");
                        rm.attr("aria-label", "Close");
                        rm.openEnd();
                        rm.text("✕");
                        rm.close("button");
                    }
                rm.close("div");

                // ── Body (scrollable) ────────────────────────────────────
                rm.openStart("div", ctrl.getId() + "-body").class("tsCustDialogBody").openEnd();
                    ctrl.getContent().forEach(function (c) { rm.renderControl(c); });
                rm.close("div");

                // ── Footer ───────────────────────────────────────────────
                var aFooter = ctrl.getButtons() || [];
                var bBegin = ctrl.getBeginButton();
                var bEnd = ctrl.getEndButton();
                if (aFooter.length || bBegin || bEnd) {
                    rm.openStart("div").class("tsCustDialogFooter").openEnd();
                        aFooter.forEach(function (b) { rm.renderControl(b); });
                        if (bEnd)   rm.renderControl(bEnd);    // secondary (Cancel) on left of primary? keep order
                        if (bBegin) rm.renderControl(bBegin);  // primary
                    rm.close("div");
                }

                rm.close("div");
            }
        },

        onAfterRendering: function () {
            var dom = this.getDomRef();
            if (!dom) return;
            var closeBtn = dom.querySelector(".tsCustDialogClose");
            if (closeBtn) {
                closeBtn.onclick = function () { this.close(); }.bind(this);
            }
        },

        // ── Open as a modal popup, centered ──────────────────────────────
        open: function () {
            if (!this._popup) {
                this._popup = new Popup(this, /*modal*/ true, /*shadow*/ true, /*autoclose*/ false);
                this._popup.attachClosed(function () {
                    this.fireAfterClose();
                }.bind(this));
            }
            this._popup.setModal(true, "tsCustDialogBLY");
            this._popup.open(
                160,
                Popup.Dock.CenterCenter,
                Popup.Dock.CenterCenter,
                window,
                "0 0",
                "fit"
            );

            // ESC to close
            this._escHandler = function (e) {
                if (e.key === "Escape" || e.keyCode === 27) this.close();
            }.bind(this);
            document.addEventListener("keydown", this._escHandler);
            return this;
        },

        close: function () {
            if (this._popup && this._popup.isOpen()) this._popup.close(120);
            if (this._escHandler) {
                document.removeEventListener("keydown", this._escHandler);
                this._escHandler = null;
            }
        },

        isOpen: function () {
            return !!(this._popup && this._popup.isOpen());
        },

        exit: function () {
            if (this._escHandler) {
                document.removeEventListener("keydown", this._escHandler);
                this._escHandler = null;
            }
            if (this._popup) {
                this._popup.destroy();
                this._popup = null;
            }
        }
    });
});
