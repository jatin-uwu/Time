/* ─────────────────────────────────────────────────────────────────────────
 * MessageBox — drop-in replacement for sap.m.MessageBox, rendered with our
 * CustomDialog so confirm/alert/error/warning/success all share the custom look
 * (and never hit sap.m.Dialog's sizing quirks).
 *
 * The public API mirrors sap.m.MessageBox exactly, so existing call sites work
 * unchanged — only the import path is swapped in each controller:
 *   MessageBox.confirm(msg, { title, actions, emphasizedAction, onClose })
 *   MessageBox.error / warning / success / information / alert / show
 *   MessageBox.Action.{OK,CANCEL,YES,NO,ABORT,RETRY,IGNORE,CLOSE,DELETE}
 *   MessageBox.Icon.{NONE,INFORMATION,WARNING,ERROR,SUCCESS,QUESTION}
 * ───────────────────────────────────────────────────────────────────────── */
sap.ui.define([
    "timesheet/app/util/CustomDialog",
    "sap/m/Button",
    "sap/m/Text",
    "sap/m/VBox"
], function (CustomDialog, Button, Text, VBox) {
    "use strict";

    var Action = {
        OK: "OK", CANCEL: "CANCEL", YES: "YES", NO: "NO",
        ABORT: "ABORT", RETRY: "RETRY", IGNORE: "IGNORE",
        CLOSE: "CLOSE", DELETE: "DELETE"
    };
    var Icon = {
        NONE: "NONE", INFORMATION: "INFORMATION", WARNING: "WARNING",
        ERROR: "ERROR", SUCCESS: "SUCCESS", QUESTION: "QUESTION"
    };

    var ACTION_TEXT = {
        OK: "OK", CANCEL: "Cancel", YES: "Yes", NO: "No",
        ABORT: "Abort", RETRY: "Retry", IGNORE: "Ignore",
        CLOSE: "Close", DELETE: "Delete"
    };
    var NEGATIVE = { CANCEL: 1, NO: 1, ABORT: 1, CLOSE: 1 };
    var DEFAULT_TITLE = {
        ERROR: "Error", WARNING: "Warning", SUCCESS: "Success",
        INFORMATION: "Information", QUESTION: "Confirm", NONE: "Message"
    };
    // sap.m.MessageBox.Icon → CustomDialog.state
    var ICON_TO_STATE = {
        ERROR: "Error", WARNING: "Warning", SUCCESS: "Success",
        INFORMATION: "Information", QUESTION: "", NONE: ""
    };

    function _open(sMessage, oOptions, sIcon, aDefaultActions) {
        oOptions = oOptions || {};
        var aActions = oOptions.actions || aDefaultActions || [Action.OK];
        if (!Array.isArray(aActions)) aActions = [aActions];

        var sState = ICON_TO_STATE[sIcon] || "";
        var sTitle = oOptions.title || DEFAULT_TITLE[sIcon] || "Message";

        var oText = new Text({ text: String(sMessage == null ? "" : sMessage) })
            .addStyleClass("tsCustMsgText");
        var oBody = new VBox({ items: [oText] }).addStyleClass("tsCustMsgBody");

        var oDialog = new CustomDialog({
            title: sTitle,
            state: sState,
            contentWidth: oOptions.contentWidth || "420px",
            showClose: true,
            content: [oBody]
        });

        var bHandled = false;
        var finish = function (sAction) {
            if (bHandled) return;
            bHandled = true;
            oDialog.close();
            // defer onClose until after the close animation/teardown
            setTimeout(function () {
                try { if (typeof oOptions.onClose === "function") oOptions.onClose(sAction); }
                finally { oDialog.destroy(); }
            }, 0);
        };

        aActions.forEach(function (sAction) {
            var sType = (sAction === oOptions.emphasizedAction) ? "Emphasized"
                : NEGATIVE[sAction] ? "Transparent" : "Default";
            oDialog.addButton(new Button({
                text: ACTION_TEXT[sAction] || sAction,
                type: sType,
                press: function () { finish(sAction); }
            }));
        });

        // X / ESC → close action (matches sap.m behaviour of resolving to CLOSE)
        oDialog.attachAfterClose(function () {
            if (!bHandled) {
                bHandled = true;
                setTimeout(function () {
                    try { if (typeof oOptions.onClose === "function") oOptions.onClose(Action.CLOSE); }
                    finally { oDialog.destroy(); }
                }, 0);
            }
        });

        oDialog.open();
        return oDialog;
    }

    return {
        Action: Action,
        Icon: Icon,

        show: function (msg, opt) {
            opt = opt || {};
            return _open(msg, opt, opt.icon || Icon.NONE, opt.actions || [Action.OK]);
        },
        alert: function (msg, opt) {
            return _open(msg, opt, Icon.NONE, [Action.OK]);
        },
        confirm: function (msg, opt) {
            return _open(msg, opt, Icon.QUESTION, [Action.OK, Action.CANCEL]);
        },
        error: function (msg, opt) {
            return _open(msg, opt, Icon.ERROR, [Action.CLOSE]);
        },
        warning: function (msg, opt) {
            return _open(msg, opt, Icon.WARNING, [Action.OK]);
        },
        success: function (msg, opt) {
            return _open(msg, opt, Icon.SUCCESS, [Action.OK]);
        },
        information: function (msg, opt) {
            return _open(msg, opt, Icon.INFORMATION, [Action.OK]);
        }
    };
});
