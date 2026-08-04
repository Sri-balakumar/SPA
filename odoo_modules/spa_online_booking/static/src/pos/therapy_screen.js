import { Component, useState, onWillStart, markup } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";
import { debounce } from "@web/core/utils/timing";
import { SpaSignatureField, newSigState } from "@spa_online_booking/pos/spa_signature";
import {
    COUNTRIES,
    DEFAULT_DIAL_CODE,
    joinPhone,
    splitPhone,
} from "@spa_online_booking/pos/phone_country";

// Full-screen (inline) therapy booking, shown in the ProductScreen when the
// order is empty. Same flow as the Book Therapy dialog — Select Therapy ->
// packages -> questions -> customer details -> adds the package to the order
// (after which the normal cart/Payment shows, because the order isn't empty).
export class TherapyScreen extends Component {
    static template = "spa_online_booking.TherapyScreen";
    static components = { SpaSignatureField };
    static props = {};

    setup() {
        this.pos = usePos();
        this.orm = this.env.services.orm;
        this.countries = COUNTRIES;
        this.state = useState({
            screen: "select",
            pkgView: "grid",
            loading: true,
            error: "",
            therapies: [],
            currency: { symbol: "", position: "before" },
            therapyId: null,
            packageId: null,
            questions: [],
            questionsFor: null,
            answers: {},
            custName: "",
            custDob: "",
            custGender: "",
            // The phone fields hold the LOCAL part only; the country comes
            // from its own picker and the two are joined into E.164 by
            // fullMobile / fullWhatsapp. Typing a number with no country code
            // is what makes a customer unreachable on WhatsApp.
            custDialCode: DEFAULT_DIAL_CODE,
            custMobile: "",
            custWaDialCode: DEFAULT_DIAL_CODE,
            custWhatsapp: "",
            custWaSame: true,
            custEmail: "",
            ccOpen: false,
            waCcOpen: false,
            // Customer lookup by phone number. custPartnerId null = we will
            // create a new contact; custNewMode = staff explicitly chose to add
            // ANOTHER person on a number that already belongs to someone.
            custPartnerId: null,
            custMatches: [],
            custLookupBusy: false,
            custLookupDone: false,
            custNewMode: false,
            // Signature state shared with <SpaSignatureField/> - see
            // spa_signature.js. Taken on the questions step and kept for THIS
            // service only; it is never read back off the contact.
            sig: newSigState(),
            // Ticked just above the signature, on the same screen.
            custTerms: false,
            busy: false,
        });
        // Look the customer up as the number is typed, not on every keystroke.
        this.lookupCustomer = debounce(this.lookupCustomer.bind(this), 400);
        onWillStart(async () => {
            try {
                const res = await fetch("/api/spa/therapies").then((r) => r.json());
                this.state.therapies = res.therapies || [];
                if (res.currency) {
                    this.state.currency = res.currency;
                }
            } catch (e) {
                this.state.error = "Could not load therapies.";
            } finally {
                this.state.loading = false;
            }
        });
    }

    get therapy() {
        return this.state.therapies.find((t) => t.id === this.state.therapyId) || null;
    }
    get pkg() {
        const th = this.therapy;
        return th ? th.packages.find((p) => p.id === this.state.packageId) || null : null;
    }
    therapyTitle(th) {
        return th.duration_min ? `${th.name} (${th.duration_min} min)` : th.name;
    }
    // The therapy description is rich HTML from the back office — render it.
    richDesc(html) {
        return markup(html || "");
    }
    // Age in whole years, computed from the entered date of birth.
    get custAge() {
        if (!this.state.custDob) {
            return "";
        }
        const d = new Date(this.state.custDob);
        if (isNaN(d.getTime())) {
            return "";
        }
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
            age--;
        }
        return age >= 0 && age < 130 ? age : "";
    }
    therapyStyle(th) {
        const n = (th.name || "").toLowerCase();
        if (n.includes("ease")) {
            return { color: "#7c3aed", icon: "fa-leaf" };
        }
        if (n.includes("flex")) {
            return { color: "#16a34a", icon: "fa-child" };
        }
        if (n.includes("relief")) {
            return { color: "#f59e0b", icon: "fa-street-view" };
        }
        if (n.includes("release")) {
            return { color: "#ec4899", icon: "fa-bed" };
        }
        return { color: "#16a34a", icon: "fa-leaf" };
    }
    fmt(v) {
        if (v == null || v === "") {
            return "";
        }
        const n = Number(v);
        if (Number.isNaN(n)) {
            return String(v);
        }
        const num = Number.isInteger(n) ? String(n) : n.toFixed(2);
        const c = this.state.currency || {};
        if (!c.symbol) {
            return num;
        }
        return c.position === "after" ? `${num} ${c.symbol}` : `${c.symbol}${num}`;
    }

    // ---- navigation ----
    openTherapy(id) {
        this.state.therapyId = id;
        this.state.packageId = null;
    }
    // Radio-select a package (website style); a Continue button then advances.
    pick(id) {
        this.state.packageId = id;
    }
    // Straight off the package list - nothing to check yet.
    toDetails() {
        this.state.error = "";
        this.state.screen = "details";
    }
    // Leaving the details, so the customer is checked HERE: the complaint has
    // to appear on the step that holds the fields it is about.
    async toQuestions() {
        if (!this.customerOk()) {
            return;
        }
        this.state.error = "";
        if (this.state.questionsFor !== this.state.packageId) {
            try {
                const r = await fetch(
                    `/api/spa/questions?service_ids=${encodeURIComponent(this.state.packageId)}`
                ).then((res) => res.json());
                this.state.questions = r.questions || [];
                this.state.questionsFor = this.state.packageId;
            } catch (e) {
                this.state.questions = [];
            }
        }
        this.state.screen = "questions";
    }
    // True when we know who this booking is for. Sets the error itself so both
    // callers say the same thing.
    customerOk() {
        if (!this.fullMobile) {
            this.state.error = "Please enter the customer's phone number.";
            return false;
        }
        if (!(this.state.custName || "").trim()) {
            this.state.error = "Please enter the customer's name.";
            return false;
        }
        return true;
    }
    back() {
        const map = { details: "select", questions: "details" };
        const prev = map[this.state.screen];
        if (prev) {
            this.state.error = "";
            this.state.screen = prev;
        }
    }

    // ---- answers ----
    setAnswer(q, value) {
        this.state.answers[q.id] = value;
    }
    toggleMulti(q, opt, checked) {
        const cur = Array.isArray(this.state.answers[q.id]) ? this.state.answers[q.id].slice() : [];
        const i = cur.indexOf(opt);
        if (checked && i < 0) {
            cur.push(opt);
        } else if (!checked && i >= 0) {
            cur.splice(i, 1);
        }
        this.state.answers[q.id] = cur;
    }
    isChecked(q, opt) {
        const a = this.state.answers[q.id];
        return Array.isArray(a) && a.includes(opt);
    }
    answerVal(q) {
        const a = this.state.answers[q.id];
        return Array.isArray(a) ? "" : a || "";
    }
    // The questions arrive already grouped into sections, so a heading only has
    // to be printed where it changes - and the numbering starts again under it.
    get questionRows() {
        let section = null;
        let num = 0;
        return this.state.questions.map((q) => {
            const id = q.heading_id || 0;
            const opened = id !== section;
            if (opened) {
                section = id;
                num = 0;
            }
            num += 1;
            return {
                q,
                num,
                heading: opened ? q.heading || "" : "",
                style: opened ? q.heading_style || "" : "",
            };
        });
    }
    requiredOk() {
        return this.state.questions.every((q) => {
            if (!q.required) {
                return true;
            }
            const a = this.state.answers[q.id];
            return Array.isArray(a) ? a.length > 0 : !!(a && String(a).trim());
        });
    }

    // ---- signature -----------------------------------------------------
    // Signing is per SERVICE, so the pad starts blank for every booking and is
    // never pre-filled from the contact: consent given for one therapy is not
    // consent for the next one.
    resetSignature() {
        this.state.sig = newSigState();
    }

    get signed() {
        return !!(this.state.sig.value || "").trim();
    }

    // ---- phone country code -------------------------------------------
    get fullMobile() {
        return joinPhone(this.state.custDialCode, this.state.custMobile);
    }
    get fullWhatsapp() {
        return joinPhone(this.state.custWaDialCode, this.state.custWhatsapp);
    }
    get selectedCountry() {
        return (
            this.countries.find((c) => c.code === this.state.custDialCode) ||
            this.countries[0]
        );
    }
    get selectedWaCountry() {
        return (
            this.countries.find((c) => c.code === this.state.custWaDialCode) ||
            this.countries[0]
        );
    }
    selectCountry(code) {
        this.state.custDialCode = code;
        this.state.ccOpen = false;
        // The country is part of the number, so the lookup has to run again.
        this.onPhoneInput();
    }
    selectWaCountry(code) {
        this.state.custWaDialCode = code;
        this.state.waCcOpen = false;
    }

    // ---- customer lookup by phone -------------------------------------
    // Same normalisation core POS uses (res_partner.js / partner_list.js).
    phoneDigits(value) {
        return (value || "").replace(/[+\s()-]/g, "");
    }

    // Numbers are stored in different shapes ("+968 9140 0038" vs "91400038"),
    // so compare on the last 8 digits - same rule as the server-side
    // _find_partners_by_phone helper in controllers/main.py.
    phoneTail(value) {
        const d = this.phoneDigits(value);
        return d.length >= 8 ? d.slice(-8) : d;
    }

    // `<input type="date">` only accepts a "YYYY-MM-DD" string - anything else
    // is silently rejected and the field renders empty. Contacts read through
    // the POS models come back with `date_of_birth` already deserialised into a
    // luxon DateTime (related_models/utils.js convertRawToDate), which is why
    // the date of birth used to stay blank while the computed age filled in.
    toDateStr(value) {
        if (!value) {
            return "";
        }
        if (typeof value === "string") {
            // ORM values may carry a time part ("1996-05-12 00:00:00").
            return value.slice(0, 10);
        }
        if (typeof value.toISODate === "function") {
            return value.toISODate() || "";   // luxon DateTime
        }
        if (value instanceof Date && !isNaN(value.getTime())) {
            const p = (n) => String(n).padStart(2, "0");
            return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
        }
        return "";
    }

    onPhoneInput() {
        // Details that were auto-filled from a contact belong to the PREVIOUS
        // number - drop them, otherwise typing a new number leaves the old
        // customer's name in the form and the booking is saved under the wrong
        // person. Anything staff typed by hand is left alone.
        if (this.state.custPartnerId) {
            this.state.custName = "";
            this.state.custDob = "";
            this.state.custGender = "";
            this.state.custEmail = "";
            this.state.custWhatsapp = "";
            this.state.custWaSame = true;
        }
        this.state.custPartnerId = null;
        this.state.custMatches = [];
        this.state.custLookupDone = false;
        this.state.custNewMode = false;
        this.lookupCustomer();
    }

    async lookupCustomer() {
        const raw = this.fullMobile;
        const tail = this.phoneTail(raw);
        // phone_mobile_search raises below 3 characters (mail_thread_phone.py).
        if (tail.length < 3) {
            this.state.custMatches = [];
            this.state.custLookupDone = false;
            this.state.custLookupBusy = false;
            return;
        }
        this.state.custLookupBusy = true;
        try {
            // 1) Contacts already loaded in this POS session - instant, no RPC.
            //    `phone` is NOT an indexed field for res.partner, so filter()
            //    rather than getBy() (which throws on an undeclared index).
            let found = this.pos.models["res.partner"].filter(
                (p) => p.phone && this.phoneTail(p.phone) === tail
            );
            // 2) Fall back to the server for contacts this session never loaded.
            if (!found.length) {
                found = await this.pos.data.searchRead(
                    "res.partner",
                    [["phone_mobile_search", "ilike", raw]],
                    [],   // MUST stay empty: a custom field list can return raw dicts
                    { limit: 10 }
                );
                found = (found || []).filter(
                    (p) => p && p.phone && this.phoneTail(p.phone) === tail
                );
            }
            // The number may have changed while the RPC was in flight.
            if (this.phoneTail(this.fullMobile) !== tail) {
                return;
            }
            this.state.custMatches = found.map((p) => ({
                id: p.id,
                name: p.name || "",
                phone: p.phone || "",
                whatsapp: p.whatsapp || "",
                email: p.email || "",
                date_of_birth: this.toDateStr(p.date_of_birth),
                gender: p.gender || "",
            }));
            this.state.custLookupDone = true;
            // Exactly one match: fill it in. Several: let staff choose, because
            // a number is often shared by a whole family.
            if (this.state.custMatches.length === 1) {
                this.pickCustomer(this.state.custMatches[0]);
            }
        } catch (e) {
            console.warn("Therapy booking: customer lookup failed", e);
            this.state.custMatches = [];
            this.state.custLookupDone = true;
        } finally {
            this.state.custLookupBusy = false;
        }
    }

    pickCustomer(c) {
        this.state.custPartnerId = c.id;
        this.state.custNewMode = false;
        this.state.custName = c.name || "";
        this.state.custDob = this.toDateStr(c.date_of_birth);
        this.state.custGender = c.gender || "";
        this.state.custEmail = c.email || "";
        const wa = splitPhone(c.whatsapp || "");
        this.state.custWaDialCode = wa.dialCode;
        this.state.custWhatsapp = wa.local;
        this.state.custWaSame =
            !c.whatsapp || this.phoneTail(c.whatsapp) === this.phoneTail(c.phone);
        // The signature is NOT touched here: it was given for this service a
        // moment ago, on the questions step, before we knew who this was.
    }

    get selectedCustomer() {
        const id = this.state.custPartnerId;
        return id ? this.state.custMatches.find((c) => c.id === id) || null : null;
    }

    // One number can belong to several people. Staff must ALWAYS be able to add
    // another person on a number that already exists (e.g. the wife booking on
    // her husband's number) - keep the number, clear the identity, and let
    // confirm() take the create branch.
    newCustomerOnThisNumber() {
        this.state.custPartnerId = null;
        this.state.custNewMode = true;
        this.state.custName = "";
        this.state.custDob = "";
        this.state.custGender = "";
        this.state.custEmail = "";
        this.state.custWhatsapp = "";
        this.state.custWaSame = true;
    }

    chooseExistingInstead() {
        this.state.custNewMode = false;
    }

    // Same "Q: A | Q: A" shape the SpaQuestionsDialog produced. It has to land
    // in customer_note because that is the ONLY field
    // pos.order.spa_service_summary reads (spa_kiosk/models/pos_order.py) for
    // the "Service / Questions & Answers" column of the contact's Spa Visits
    // tab. The modal used to fill it; now that we skip the modal, this does.
    buildAnswerNote() {
        return this.state.questions
            .map((q) => {
                const a = this.state.answers[q.id];
                const val = Array.isArray(a) ? a.join(", ") : a || "";
                return `${q.text}: ${val || "-"}`;
            })
            .join(" | ");
    }

    buildNote() {
        const th = this.therapy;
        const p = this.pkg;
        const lines = [`${this.therapyTitle(th)} — ${p.name}`];
        this.state.questions.forEach((q) => {
            const a = this.state.answers[q.id];
            const val = Array.isArray(a) ? a.join(", ") : a || "";
            if (val) {
                lines.push(`${q.text}: ${val}`);
            }
        });
        return lines.join("\n");
    }

    reset() {
        Object.assign(this.state, {
            screen: "select",
            therapyId: null,
            packageId: null,
            questions: [],
            questionsFor: null,
            answers: {},
            custName: "",
            custDob: "",
            custGender: "",
            custDialCode: DEFAULT_DIAL_CODE,
            custMobile: "",
            custWaDialCode: DEFAULT_DIAL_CODE,
            custWhatsapp: "",
            custWaSame: true,
            custEmail: "",
            ccOpen: false,
            waCcOpen: false,
            custPartnerId: null,
            custMatches: [],
            custLookupBusy: false,
            custLookupDone: false,
            custNewMode: false,
            custTerms: false,
            error: "",
            busy: false,
        });
        this.resetSignature();
    }

    // Close the booking page (back to the logo / cart).
    closeBooking() {
        this.reset();
        this.pos.showTherapyBooking = false;
    }

    // Create or reuse the contact for whatever is on the form and return its
    // id, or null when it could not be saved (the booking still goes through).
    async _resolveCustomer() {
        const name = (this.state.custName || "").trim();
        const mobile = this.fullMobile;
        const wa = this.state.custWaSame ? mobile : this.fullWhatsapp;
        const email = (this.state.custEmail || "").trim();
        try {
            const partnerId = this.state.custPartnerId;
            if (partnerId) {
                // Known customer: reuse the contact instead of creating a
                // duplicate, and only fill in details it is MISSING - a typo at
                // the till must never overwrite good data.
                const existing = this.selectedCustomer || {};
                const patch = {};
                if (this.state.custDob && !existing.date_of_birth) {
                    patch.date_of_birth = this.state.custDob;
                }
                if (this.state.custGender && !existing.gender) {
                    patch.gender = this.state.custGender;
                }
                if (wa && !existing.whatsapp) {
                    patch.whatsapp = wa;
                }
                if (email && !existing.email) {
                    patch.email = email;
                }
                if (Object.keys(patch).length) {
                    await this.orm.write("res.partner", [partnerId], patch);
                }
                return partnerId;
            }
            // New customer - including a NEW person on a number that already
            // belongs to someone else (families share numbers).
            const vals = { name, phone: mobile };
            if (wa) {
                vals.whatsapp = wa;
            }
            if (this.state.custDob) {
                vals.date_of_birth = this.state.custDob;
            }
            if (this.state.custGender) {
                vals.gender = this.state.custGender;
            }
            if (email) {
                vals.email = email;
            }
            const ids = await this.orm.create("res.partner", [vals]);
            return Array.isArray(ids) ? ids[0] : ids;
        } catch (e) {
            // Don't swallow this: the booking goes on the order but the
            // customer does not, and staff need to know.
            console.warn("Therapy booking: could not save the customer", e);
            this.state.error =
                "The package was added, but the customer could not be saved.";
            return null;
        }
    }

    // The signature belongs to the SERVICE, so it is stored as its own record
    // and the line only carries its id - a base64 payload on the line would
    // ride along in the POS session and in every order sync from then on.
    async _saveSignature(line, templateId, partnerId) {
        const signature = this.state.sig.value || "";
        if (!signature) {
            return;
        }
        try {
            const ids = await this.orm.create("spa.service.signature", [
                {
                    partner_id: partnerId || false,
                    product_tmpl_id: templateId,
                    signature: signature,
                    terms_accepted: !!this.state.custTerms,
                },
            ]);
            line.spa_signature_ref = Array.isArray(ids) ? ids[0] : ids;
        } catch (e) {
            // Same rule as the customer: don't swallow it. The package is on
            // the order but nothing was signed for it, and staff must know.
            console.warn("Therapy booking: could not save the signature", e);
            this.state.error =
                "The package was added, but the signature could not be saved.";
        }
    }

    // A POS order has ONE customer. Reuse the open order only when it is empty
    // or already belongs to this person; otherwise start a fresh one. Without
    // this, booking a second, different customer appended their package to the
    // first customer's order AND setPartner() overwrote the first customer -
    // two people's sessions ended up on one bill.
    _ensureOrderFor(partnerId) {
        const order = this.pos.getOrder();
        if (!order) {
            return; // addLineToCurrentOrder will create one
        }
        if (!order.getOrderlines().length) {
            return; // empty - reuse it rather than leaving a blank order behind
        }
        const samePerson =
            partnerId && order.partner_id && order.partner_id.id === partnerId;
        if (!samePerson) {
            // Unknown customer (a brand-new contact) counts as different on
            // purpose: an extra order is far cheaper than merging two people.
            this.pos.addNewOrder();
        }
    }

    async confirm() {
        if (!this.requiredOk()) {
            this.state.error = "Please answer the required questions.";
            return;
        }
        if (!this.state.custTerms) {
            this.state.error =
                "Please ask the customer to accept the terms first.";
            return;
        }
        if (!this.signed) {
            this.state.error =
                "Please ask the customer to sign for this service.";
            return;
        }
        // Checked on the way out of the details step already; if something
        // cleared them since, send them back rather than failing on save.
        if (!this.customerOk()) {
            this.state.screen = "details";
            return;
        }
        this.state.busy = true;
        this.state.error = "";
        try {
            const note = this.buildNote();
            const templateId = this.state.packageId;

            // Resolve the customer BEFORE touching an order. A POS order holds
            // exactly ONE partner, so we have to know who this booking is for
            // in order to decide whether it may share the order that is open.
            const partnerId = await this._resolveCustomer();
            this._ensureOrderFor(partnerId);

            // The questions were already answered in the "A few questions" step
            // of this wizard, so suppress the "Service Questions" modal that
            // pos_spa_header pops for every line added. Same escape hatch
            // ticket_tabs.js uses when loading an already-answered booking.
            const line = await this.pos.addLineToCurrentOrder(
                { product_tmpl_id: templateId },
                { skipSpaQuestions: true }
            );
            const order = this.pos.getOrder();

            if (partnerId) {
                await this.pos.data.searchRead("res.partner", [["id", "=", partnerId]]);
                const partner = this.pos.models["res.partner"].get(partnerId);
                if (partner && order) {
                    order.setPartner(partner);
                }
            }

            if (line && note) {
                line.setNote(JSON.stringify([{ text: note, colorIndex: 0 }]));
            }
            if (line) {
                const answers = this.buildAnswerNote();
                if (answers) {
                    line.setCustomerNote(answers);
                }
                await this._saveSignature(line, templateId, partnerId);
            }
            if (order && "spa_channel" in order) {
                order.spa_channel = "web";
            }
            this.reset();
            this.pos.showTherapyBooking = false;
        } catch (e) {
            this.state.error = "Could not add this package to the order.";
            this.state.busy = false;
        }
    }
}
