sap.ui.define([
    "timesheet/app/util/FounderPage"
], function (FP) {
    "use strict";

    // ════════════════════════════════════════════════════════════════════════
    // ClientForm — the shared Create / Edit client dialog + reference data +
    // searchable combobox. Extracted so the standalone Clients module (and any
    // other screen) can reuse client administration without duplicating logic.
    // ════════════════════════════════════════════════════════════════════════

    function esc(s) { return FP.esc(s); }
    function ppost(action, params) {
        return fetch("/project/" + action, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(params || {})
        }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
            .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } var v = (j && j.value !== undefined) ? j.value : j; return (typeof v === "string") ? JSON.parse(v) : v; });
    }

    // ── Reference data ──────────────────────────────────────────────────────
    var CLIENT_TYPES = ["Enterprise", "SMB", "Startup", "Individual", "Internal"];
    var CLIENT_STATUSES = ["Prospect", "Active", "Inactive", "Blacklisted"];
    var CREATE_STATUSES = ["Prospect", "Active"];
    var INDUSTRIES = ["Information Technology", "Software / SaaS", "Banking & Financial Services", "Insurance",
        "Manufacturing", "Retail & E-commerce", "Healthcare & Life Sciences", "Pharmaceuticals",
        "Telecommunications", "Media & Entertainment", "Education", "Government & Public Sector",
        "Energy & Utilities", "Oil & Gas", "Automotive", "Aerospace & Defense", "Construction & Real Estate",
        "Logistics & Supply Chain", "Travel & Hospitality", "Agriculture", "Consulting & Professional Services",
        "Non-Profit", "Legal", "Other"];
    var COUNTRIES = [
        { n: "India", d: "+91", zones: ["Asia/Kolkata"] },
        { n: "United States", d: "+1", zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] },
        { n: "United Kingdom", d: "+44", zones: ["Europe/London"] },
        { n: "Canada", d: "+1", zones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver", "America/Halifax", "America/St_Johns"] },
        { n: "Australia", d: "+61", zones: ["Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Australia/Darwin"] },
        { n: "Germany", d: "+49", zones: ["Europe/Berlin"] }, { n: "France", d: "+33", zones: ["Europe/Paris"] },
        { n: "Netherlands", d: "+31", zones: ["Europe/Amsterdam"] }, { n: "Ireland", d: "+353", zones: ["Europe/Dublin"] },
        { n: "Spain", d: "+34", zones: ["Europe/Madrid", "Atlantic/Canary"] }, { n: "Italy", d: "+39", zones: ["Europe/Rome"] },
        { n: "Switzerland", d: "+41", zones: ["Europe/Zurich"] }, { n: "Sweden", d: "+46", zones: ["Europe/Stockholm"] },
        { n: "Norway", d: "+47", zones: ["Europe/Oslo"] }, { n: "Denmark", d: "+45", zones: ["Europe/Copenhagen"] },
        { n: "Belgium", d: "+32", zones: ["Europe/Brussels"] }, { n: "Poland", d: "+48", zones: ["Europe/Warsaw"] },
        { n: "Portugal", d: "+351", zones: ["Europe/Lisbon", "Atlantic/Azores"] }, { n: "United Arab Emirates", d: "+971", zones: ["Asia/Dubai"] },
        { n: "Saudi Arabia", d: "+966", zones: ["Asia/Riyadh"] }, { n: "Qatar", d: "+974", zones: ["Asia/Qatar"] },
        { n: "Singapore", d: "+65", zones: ["Asia/Singapore"] }, { n: "Malaysia", d: "+60", zones: ["Asia/Kuala_Lumpur"] },
        { n: "Japan", d: "+81", zones: ["Asia/Tokyo"] }, { n: "China", d: "+86", zones: ["Asia/Shanghai"] },
        { n: "Hong Kong", d: "+852", zones: ["Asia/Hong_Kong"] }, { n: "South Korea", d: "+82", zones: ["Asia/Seoul"] },
        { n: "Indonesia", d: "+62", zones: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] }, { n: "Philippines", d: "+63", zones: ["Asia/Manila"] },
        { n: "Thailand", d: "+66", zones: ["Asia/Bangkok"] }, { n: "Vietnam", d: "+84", zones: ["Asia/Ho_Chi_Minh"] },
        { n: "New Zealand", d: "+64", zones: ["Pacific/Auckland"] }, { n: "South Africa", d: "+27", zones: ["Africa/Johannesburg"] },
        { n: "Nigeria", d: "+234", zones: ["Africa/Lagos"] }, { n: "Kenya", d: "+254", zones: ["Africa/Nairobi"] },
        { n: "Egypt", d: "+20", zones: ["Africa/Cairo"] }, { n: "Brazil", d: "+55", zones: ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza"] },
        { n: "Mexico", d: "+52", zones: ["America/Mexico_City", "America/Cancun", "America/Tijuana"] },
        { n: "Argentina", d: "+54", zones: ["America/Argentina/Buenos_Aires"] }, { n: "Chile", d: "+56", zones: ["America/Santiago"] },
        { n: "Colombia", d: "+57", zones: ["America/Bogota"] }, { n: "Israel", d: "+972", zones: ["Asia/Jerusalem"] },
        { n: "Turkey", d: "+90", zones: ["Europe/Istanbul"] }, { n: "Russia", d: "+7", zones: ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Vladivostok"] },
        { n: "Pakistan", d: "+92", zones: ["Asia/Karachi"] }, { n: "Bangladesh", d: "+880", zones: ["Asia/Dhaka"] },
        { n: "Sri Lanka", d: "+94", zones: ["Asia/Colombo"] }, { n: "Nepal", d: "+977", zones: ["Asia/Kathmandu"] },
        { n: "Austria", d: "+43", zones: ["Europe/Vienna"] }, { n: "Finland", d: "+358", zones: ["Europe/Helsinki"] }
    ];
    var countryByName = function (n) { return COUNTRIES.find(function (c) { return c.n === n; }); };
    var _gmtCache = {};
    function gmtLabel(tz) {
        if (!tz) return "";
        if (_gmtCache[tz]) return _gmtCache[tz];
        var off = "GMT";
        try {
            var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
            var raw = (parts.find(function (p) { return p.type === "timeZoneName"; }) || {}).value || "GMT";
            var m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(raw);
            off = m ? "GMT" + m[1] + ("0" + m[2]).slice(-2) + ":" + (m[3] || "00") : (raw === "GMT" ? "GMT+00:00" : raw);
        } catch (e) { off = "GMT"; }
        var label = off + " (" + tz + ")";
        _gmtCache[tz] = label;
        return label;
    }
    function tzOptionsFor(name) {
        var c = countryByName(name);
        return (c ? c.zones : []).map(function (tz) { return { value: tz, label: gmtLabel(tz) }; });
    }

    // ── Custom searchable dropdown (type-ahead) ──────────────────────────────
    function initCombo(root, sel, options, cfg) {
        cfg = cfg || {};
        var host = root.querySelector(sel);
        if (!host) return null;
        host.classList.add("fpCombo");
        var input = document.createElement("input");
        input.className = "fpInput fpComboInput";
        input.setAttribute("autocomplete", "off");
        input.placeholder = cfg.placeholder || "Search…";
        var caret = document.createElement("span");
        caret.className = "fpComboCaret";
        caret.textContent = "▾";
        var panel = document.createElement("div");
        panel.className = "fpComboPanel";
        panel.style.display = "none";
        host.appendChild(input);
        host.appendChild(caret);
        host.appendChild(panel);
        var value = "";
        var displayOf = function (v) { var o = options.find(function (x) { return x.value === v; }); return o ? o.label : (v || ""); };
        var render = function (filter) {
            var f = (filter || "").trim().toLowerCase();
            var items = options.filter(function (o) { return !f || o.label.toLowerCase().indexOf(f) >= 0; }).slice(0, 80);
            panel.innerHTML = items.length
                ? items.map(function (o) { return "<div class='fpComboItem" + (o.value === value ? " sel" : "") + "' data-v='" + esc(o.value) + "'>" + esc(o.label) + "</div>"; }).join("")
                : "<div class='fpComboEmpty'>No matches</div>";
        };
        var open = function (all) { render(all ? "" : input.value); panel.style.display = "block"; host.classList.add("open"); };
        var close = function () { panel.style.display = "none"; host.classList.remove("open"); };
        input.addEventListener("focus", function () { open(true); });
        caret.addEventListener("mousedown", function (e) { e.preventDefault(); if (panel.style.display === "block") { close(); } else { input.focus(); open(true); } });
        input.addEventListener("input", function () { value = ""; open(false); if (cfg.onInput) cfg.onInput(input.value); });
        input.addEventListener("blur", function () { setTimeout(close, 160); });
        panel.addEventListener("mousedown", function (e) {
            var it = e.target.closest(".fpComboItem"); if (!it) return;
            e.preventDefault();
            value = it.getAttribute("data-v");
            input.value = displayOf(value);
            close();
            if (cfg.onChange) cfg.onChange(value);
        });
        var api = {
            get value() { return value; },
            set: function (v) { value = v || ""; input.value = displayOf(value); },
            setOptions: function (opts, keepValue) {
                options = opts || [];
                if (!keepValue || !options.some(function (o) { return o.value === value; })) { value = ""; input.value = ""; }
                else input.value = displayOf(value);
            },
            input: input,
            focus: function () { input.focus(); }
        };
        host._combo = api;
        return api;
    }

    // Duplicate-client warning → let the founder proceed or cancel.
    function confirmDuplicate(dups, onContinue) {
        var list = (dups || []).map(function (d) {
            return "<li><b style='color:#e6edf8'>" + esc(d.companyName || d.clientId) + "</b>" +
                (d.email ? " · " + esc(d.email) : "") +
                " <span style='color:#9fb0d6'>(matches " + esc((d.reasons || []).join(", ")) + ")</span></li>";
        }).join("");
        var body = "<div class='fmod'>" +
            "<p class='fmodP'>This client may already exist. Do you want to continue?</p>" +
            "<ul style='margin:0 0 12px;padding-left:18px;color:#c8d3ef;font-size:0.86rem;line-height:1.7'>" + list + "</ul>" +
            "<div class='fmodFoot'><button class='faBtn ghost' id='dupCancel'>Cancel</button><button class='faBtn approve' id='dupGo'>Continue Anyway</button></div></div>";
        var m2 = FP.modal({ title: "Possible Duplicate", body: body });
        m2.body.querySelector("#dupCancel").addEventListener("click", m2.close);
        m2.body.querySelector("#dupGo").addEventListener("click", function () { m2.close(); onContinue(); });
    }

    // Status-transition guard. Prompts (with optional reason) for sensitive
    // transitions, else proceeds. Calls onOk(reason).
    function confirmStatusChange(oldS, newS, onOk) {
        if (oldS === newS) { onOk(""); return; }
        var msg = null;
        if (oldS === "Active" && newS === "Inactive") msg = "Are you sure you want to mark this client as Inactive? New projects and resource allocations will be disabled.";
        else if (newS === "Blacklisted") msg = "Are you sure you want to blacklist this client? All business operations with this client will be restricted.";
        else if (oldS === "Blacklisted" && newS === "Active") msg = "Are you sure you want to reactivate this blacklisted client? This action will be logged in the audit history.";
        if (!msg) { onOk(""); return; }
        var body = "<div class='fmod'>" +
            "<p class='fmodP'>" + esc(msg) + "</p>" +
            "<label style='display:block;color:#9fb0d6;font-size:0.78rem;margin-bottom:4px'>Reason <span class='fpOpt'>(recorded in audit trail)</span></label>" +
            "<textarea class='fmodTextarea' id='scReason' placeholder='Optional reason for this status change'></textarea>" +
            "<div class='fmodFoot'><button class='faBtn ghost' id='scCancel'>Cancel</button><button class='faBtn approve' id='scGo'>Confirm</button></div></div>";
        var m2 = FP.modal({ title: "Confirm Status Change", body: body });
        m2.body.querySelector("#scCancel").addEventListener("click", m2.close);
        m2.body.querySelector("#scGo").addEventListener("click", function () {
            var reason = (m2.body.querySelector("#scReason").value || "").trim();
            m2.close(); onOk(reason);
        });
    }

    // ── Create / Edit client dialog ─────────────────────────────────────────
    // openForm(existing|null, onSaved) — onSaved() is called after a successful
    // create/update so the caller can refresh its list.
    function openForm(existing, onSaved) {
        var isEdit = !!existing;
        var req = "<span class='fpReq'>*</span>";
        var statusList = isEdit ? CLIENT_STATUSES : CREATE_STATUSES;
        var curStatus = isEdit ? (existing.status || "Prospect") : "Prospect";
        var statusOpts = statusList.map(function (s) { return "<option" + (s === curStatus ? " selected" : "") + ">" + s + "</option>"; }).join("");
        var dialOpts = COUNTRIES.map(function (c) { return { value: c.d + "|" + c.n, label: c.d + "  " + c.n }; })
            .filter(function (o, i, a) { return a.findIndex(function (x) { return x.value === o.value; }) === i; });

        var auditHtml = "";
        if (isEdit) {
            var fmt = function (v) { return v ? new Date(v).toLocaleString() : "—"; };
            auditHtml = "<div class='fpGroup'><div class='fpGroupTitle'>Record</div>" +
                "<div class='fpRow'><div><label>Client ID</label><input class='fpInput' value='" + esc(existing.clientId) + "' disabled/></div>" +
                "<div><label>Projects</label><input class='fpInput' value='" + (existing.projectCount || 0) + "' disabled/></div></div>" +
                "<div class='fpAudit'>Created by " + esc(existing.createdBy || "—") + " on " + esc(fmt(existing.createdAt)) +
                " · Last updated by " + esc(existing.modifiedBy || "—") + " on " + esc(fmt(existing.modifiedAt)) + "</div></div>";
        }

        var body = "<div class='fpForm fpCreate fpClientForm'>" +
            auditHtml +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Company Information</div>" +
            "<label>Company Name " + req + "</label><input class='fpInput' id='clCo' maxlength='100' placeholder='e.g. Acme Corporation'/>" +
            "<div class='fpFieldErr' id='e_clCo'></div>" +
            "<div class='fpRow'>" +
            "<div><label>Client Type " + req + "</label><div class='fpCombo' id='clType'></div></div>" +
            "<div><label>Industry</label><div class='fpCombo' id='clInd'></div></div></div>" +
            "<div class='fpRow'>" +
            "<div><label>Website</label><input class='fpInput' id='clWeb' placeholder='https://company.com'/><div class='fpFieldErr' id='e_clWeb'></div></div>" +
            "<div><label>Country " + req + "</label><div class='fpCombo' id='clCountry'></div></div></div>" +
            "<label>Time Zone <span class='fpHint'>— auto-filled from country</span></label><div class='fpCombo' id='clTz'></div>" +
            "</div>" +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Primary Contact</div>" +
            "<div class='fpRow'>" +
            "<div><label>Contact Person " + req + "</label><input class='fpInput' id='clContact'/><div class='fpFieldErr' id='e_clContact'></div></div>" +
            "<div><label>Designation</label><input class='fpInput' id='clDesig' placeholder='e.g. Procurement Head'/></div></div>" +
            "<label>Email " + req + " <span class='fpHint'>— used as the client login identity</span></label>" +
            "<input class='fpInput' id='clEmail' placeholder='contact@company.com'" + (isEdit ? " disabled" : "") + "/><div class='fpFieldErr' id='e_clEmail'></div>" +
            "<label>Phone Number " + req + "</label>" +
            "<div class='fpPhoneRow'><div class='fpCombo fpDial' id='clDial'></div><input class='fpInput' id='clPhone' placeholder='98765 43210'/></div>" +
            "<div class='fpFieldErr' id='e_clPhone'></div>" +
            "</div>" +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Secondary Contact <span class='fpOpt'>(Optional)</span></div>" +
            "<label>Contact Person</label><input class='fpInput' id='clSecName'/>" +
            "<div class='fpRow'>" +
            "<div><label>Email</label><input class='fpInput' id='clSecEmail'/><div class='fpFieldErr' id='e_clSecEmail'></div></div>" +
            "<div><label>Phone</label><input class='fpInput' id='clSecPhone'/></div></div>" +
            "</div>" +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Billing Information <span class='fpOpt'>(Optional)</span></div>" +
            "<div class='fpRow'>" +
            "<div><label>Billing Email</label><input class='fpInput' id='clBillEmail'/><div class='fpFieldErr' id='e_clBillEmail'></div></div>" +
            "<div><label>GST / VAT Number</label><input class='fpInput' id='clGst'/></div></div>" +
            "<label>Billing Address</label><textarea class='fmodTextarea' id='clBillAddr' style='min-height:60px'></textarea>" +
            "</div>" +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Client Status</div>" +
            "<label>Status " + req + "</label><select class='fpInput' id='clStatus'>" + statusOpts + "</select>" +
            (isEdit ? "<div class='fpHint' style='margin-top:6px'>Inactive disables new projects &amp; allocations. Blacklisted restricts all business operations.</div>" : "") +
            "</div>" +
            "<div class='fpGroup'>" +
            "<div class='fpGroupTitle'>Additional Information</div>" +
            "<label>Notes</label><textarea class='fmodTextarea' id='clNotes' placeholder='Add project requirements, special instructions, billing notes, communication preferences, or any other relevant information.'></textarea>" +
            "</div>" +
            "<div id='pErr' style='display:none;color:#fb7185;font-size:0.84rem;padding:8px 12px;background:rgba(251,113,133,0.10);border-radius:8px;margin-top:4px'></div>" +
            "<div class='fmodFoot'><button class='faBtn ghost' id='cCancel'>Cancel</button><button class='faBtn approve' id='cSave'" + (isEdit ? "" : " disabled") + ">" + (isEdit ? "Save Changes" : "Create Client") + "</button></div></div>";

        var saveLabel = isEdit ? "Save Changes" : "Create Client";
        var m = FP.modal({ title: isEdit ? "Edit Client — " + esc(existing.companyName || existing.clientName) : "Create New Client", body: body, wide: true, cls: "fmodCreateProject fmodClient" });
        var $ = function (id) { return m.body.querySelector(id); };
        var g = function (id) { var el = $(id); return el ? el.value.trim() : ""; };
        var saveBtn = $("#cSave");
        var showErr = function (msg) { var el = $("#pErr"); el.textContent = "⚠ " + msg; el.style.display = "block"; el.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
        var clearErr = function () { $("#pErr").style.display = "none"; };
        var fieldErr = function (id, msg) { var el = $(id); if (el) { el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; } };

        var typeCombo = initCombo(m.body, "#clType", CLIENT_TYPES.map(function (t) { return { value: t, label: t }; }), { placeholder: "Select client type…", onChange: validate });
        var indCombo = initCombo(m.body, "#clInd", INDUSTRIES.map(function (i) { return { value: i, label: i }; }), { placeholder: "Search industry…" });
        var dialCombo = initCombo(m.body, "#clDial", dialOpts, { placeholder: "Code", onChange: validate });
        var tzCombo = initCombo(m.body, "#clTz", [], { placeholder: "Select country first…" });
        var countryCombo = initCombo(m.body, "#clCountry", COUNTRIES.map(function (c) { return { value: c.n, label: c.n }; }), {
            placeholder: "Search country…",
            onChange: function (name) {
                var c = countryByName(name);
                var zones = tzOptionsFor(name);
                tzCombo.setOptions(zones);
                if (zones.length === 1) tzCombo.set(zones[0].value);
                if (c && dialCombo && !dialCombo.value) dialCombo.set(c.d + "|" + c.n);
                validate();
            }
        });

        if (isEdit) {
            $("#clCo").value = existing.companyName || existing.clientName || "";
            typeCombo.set(existing.clientType || "");
            indCombo.set(existing.industry || "");
            $("#clWeb").value = existing.website || "";
            if (existing.country) { countryCombo.set(existing.country); tzCombo.setOptions(tzOptionsFor(existing.country)); }
            if (existing.timeZone) tzCombo.set(existing.timeZone);
            $("#clContact").value = existing.contactPerson || "";
            $("#clDesig").value = existing.designation || "";
            $("#clEmail").value = existing.email || "";
            var pm = /^(\+\d+)\s*(.*)$/.exec(existing.phoneNumber || "");
            if (pm) { var dc = countryByName(existing.country); dialCombo.set(pm[1] + "|" + ((dc && dc.d === pm[1]) ? dc.n : (COUNTRIES.find(function (x) { return x.d === pm[1]; }) || {}).n || "")); $("#clPhone").value = pm[2]; }
            else $("#clPhone").value = existing.phoneNumber || "";
            $("#clSecName").value = existing.secondaryContactName || "";
            $("#clSecEmail").value = existing.secondaryEmail || "";
            $("#clSecPhone").value = existing.secondaryPhone || "";
            $("#clBillEmail").value = existing.billingEmail || "";
            $("#clGst").value = existing.gstNumber || "";
            $("#clBillAddr").value = existing.billingAddress || "";
            $("#clNotes").value = existing.notes || "";
        }

        var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        var URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
        function validate() {
            var ok = true;
            var co = g("#clCo");
            if (co.length < 2) { ok = false; fieldErr("#e_clCo", co ? "Minimum 2 characters." : ""); } else if (co.length > 100) { ok = false; fieldErr("#e_clCo", "Maximum 100 characters."); } else fieldErr("#e_clCo", "");
            if (!typeCombo.value) ok = false;
            if (!countryCombo.value) ok = false;
            if (!g("#clContact")) ok = false;
            var em = g("#clEmail").toLowerCase();
            if (!em || !EMAIL_RE.test(em)) { ok = false; fieldErr("#e_clEmail", em && !EMAIL_RE.test(em) ? "Enter a valid email address." : ""); } else fieldErr("#e_clEmail", "");
            var ph = g("#clPhone").replace(/[^\d]/g, "");
            if (ph.length < 7 || ph.length > 15) { ok = false; fieldErr("#e_clPhone", ph ? "Enter a valid phone number." : ""); } else fieldErr("#e_clPhone", "");
            var web = g("#clWeb"); if (web && !URL_RE.test(web)) { ok = false; fieldErr("#e_clWeb", "Enter a valid URL."); } else fieldErr("#e_clWeb", "");
            var se = g("#clSecEmail").toLowerCase(); if (se && !EMAIL_RE.test(se)) { ok = false; fieldErr("#e_clSecEmail", "Enter a valid email."); } else fieldErr("#e_clSecEmail", "");
            var be = g("#clBillEmail").toLowerCase(); if (be && !EMAIL_RE.test(be)) { ok = false; fieldErr("#e_clBillEmail", "Enter a valid email."); } else fieldErr("#e_clBillEmail", "");
            saveBtn.disabled = !ok;
            return ok;
        }
        ["#clCo", "#clWeb", "#clContact", "#clDesig", "#clEmail", "#clPhone", "#clSecEmail", "#clBillEmail"].forEach(function (id) {
            var el = $(id); if (el) el.addEventListener("input", validate);
        });

        function basePayload() {
            var dial = (dialCombo.value || "").split("|")[0] || "";
            var phone = g("#clPhone");
            return {
                companyName: g("#clCo"), clientName: g("#clCo"),
                clientType: typeCombo.value, industry: indCombo.value || "",
                website: g("#clWeb"), country: countryCombo.value, timeZone: tzCombo.value,
                contactPerson: g("#clContact"), designation: g("#clDesig"),
                phoneNumber: (dial ? dial + " " : "") + phone,
                secondaryContactName: g("#clSecName"), secondaryEmail: g("#clSecEmail").toLowerCase(), secondaryPhone: g("#clSecPhone"),
                billingEmail: g("#clBillEmail").toLowerCase(), gstNumber: g("#clGst"), billingAddress: g("#clBillAddr"),
                status: g("#clStatus"), notes: g("#clNotes")
            };
        }
        function busy(on) { saveBtn.disabled = on; saveBtn.innerHTML = on ? "<span class='fpSpin'></span>Saving…" : saveLabel; }

        function doCreate(force) {
            clearErr(); busy(true);
            var p = basePayload(); p.email = g("#clEmail").toLowerCase(); p.force = !!force;
            ppost("createClientMaster", p).then(function (res) {
                if (res && res.duplicate) { busy(false); confirmDuplicate(res.duplicates, function () { doCreate(true); }); return; }
                if (res && res.error) { busy(false); showErr(res.error); return; }
                m.close(); FP.toast("Client created successfully."); if (onSaved) onSaved();
            }).catch(function () { busy(false); FP.toast("Unable to create client. Please try again.", false); });
        }
        function doUpdate(reason) {
            clearErr(); busy(true);
            var p = basePayload(); p.clientId = existing.clientId; if (reason) p.reason = reason;
            ppost("updateClientMaster", p).then(function (res) {
                if (res && res.error) { busy(false); showErr(res.error); return; }
                m.close(); FP.toast("Client updated successfully."); if (onSaved) onSaved();
            }).catch(function () { busy(false); FP.toast("Unable to update client. Please try again.", false); });
        }

        $("#cCancel").addEventListener("click", m.close);
        saveBtn.addEventListener("click", function () {
            if (!validate()) return;
            if (!isEdit) { doCreate(false); return; }
            var oldS = existing.status || "Prospect", newS = g("#clStatus");
            confirmStatusChange(oldS, newS, function (reason) { doUpdate(reason); });
        });
        validate();
    }

    // Quick status change (Deactivate/Blacklist/Reactivate) without opening the
    // full form — used by row actions. Calls onSaved() on success.
    function quickStatus(client, newStatus, onSaved) {
        confirmStatusChange(client.status || "Prospect", newStatus, function (reason) {
            var p = { clientId: client.clientId, status: newStatus };
            if (reason) p.reason = reason;
            ppost("updateClientMaster", p).then(function (res) {
                if (res && res.error) { FP.toast(res.error, false); return; }
                FP.toast("Client marked " + newStatus + "."); if (onSaved) onSaved();
            }).catch(function () { FP.toast("Could not update client status.", false); });
        });
    }

    return {
        CLIENT_TYPES: CLIENT_TYPES, CLIENT_STATUSES: CLIENT_STATUSES, CREATE_STATUSES: CREATE_STATUSES,
        INDUSTRIES: INDUSTRIES, COUNTRIES: COUNTRIES,
        openForm: openForm, quickStatus: quickStatus, ppost: ppost
    };
});
