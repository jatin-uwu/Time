sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], (Controller, JSONModel, Filter, FilterOperator) => {
    "use strict";

    const MONTHS = ["", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const CATEGORY_STATE = {
        "Excellent":         "Success",
        "Good":              "Success",
        "Average":           "Warning",
        "Needs Improvement": "Error"
    };

    function stars(value) {
        const v = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
        return "★".repeat(v) + "☆".repeat(5 - v);
    }

    return Controller.extend("timesheet.app.controller.RatingHistory", {

        onInit() {
            this._oModel = new JSONModel({
                ratings:     [],
                hasRatings:  false,
                loading:     true,
                avgRating:   "0.0",
                latestLabel: "—",
                count:       0
            });
            this.getView().setModel(this._oModel, "rhView");

            this.getOwnerComponent().getRouter()
                .getRoute("rating-history")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched() {
            this._loadRatings();
        },

        _loadRatings() {
            this._oModel.setProperty("/loading", true);
            const oComp  = this.getOwnerComponent();
            const oModel = oComp.getModel();
            const sEmpId = oComp.getCurrentEmployeeId ? oComp.getCurrentEmployeeId() : null;

            if (!oModel || !sEmpId) {
                this._apply([]);
                return;
            }

            oModel.bindList("/PerformanceRatings", null, null, [
                new Filter("employee_employeeId", FilterOperator.EQ, sEmpId)
            ]).requestContexts(0, 500)
                .then(aCtx => {
                    const rows = aCtx.map(c => c.getObject()).filter(Boolean);
                    rows.sort((a, b) =>
                        (b.reviewYear - a.reviewYear) || (b.reviewMonth - a.reviewMonth));
                    this._apply(rows);
                })
                .catch(() => this._apply([]));
        },

        _apply(rows) {
            const view = (rows || []).map(r => ({
                period:        (MONTHS[r.reviewMonth] || "") + " " + (r.reviewYear || ""),
                ratingValue:   (Number(r.ratingValue) || 0).toFixed(1),
                stars:         stars(r.ratingValue),
                category:      r.ratingCategory || "—",
                categoryState: CATEGORY_STATE[r.ratingCategory] || "None",
                comment:       r.reviewComment || "—"
            }));

            let avg = "0.0";
            if (view.length) {
                const sum = view.reduce((acc, r) => acc + Number(r.ratingValue), 0);
                avg = (sum / view.length).toFixed(1);
            }

            this._oModel.setProperty("/ratings",     view);
            this._oModel.setProperty("/hasRatings",  view.length > 0);
            this._oModel.setProperty("/count",       view.length);
            this._oModel.setProperty("/avgRating",   avg);
            this._oModel.setProperty("/latestLabel", view.length ? view[0].period : "—");
            this._oModel.setProperty("/loading",     false);
        }
    });
});
