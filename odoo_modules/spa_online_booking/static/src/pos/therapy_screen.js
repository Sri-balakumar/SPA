import { Component, useState, onWillStart, markup } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";
import { debounce } from "@web/core/utils/timing";
import { SpaSignatureField, newSigState } from "@spa_online_booking/pos/spa_signature";
import {
    DEFAULT_DIAL_CODE,
    joinPhone,
    splitPhone,
    phoneError,
    emailError,
    dobError,
    todayIso,
    resolveMessage,
} from "@spa_online_booking/pos/phone_country";
import { PhoneField } from "@spa_online_booking/pos/phone_field";

// Full-screen (inline) therapy booking, shown in the ProductScreen when the
// order is empty. Same flow as the Book Therapy dialog — Select Therapy ->
// packages -> questions -> customer details -> adds the package to the order
// (after which the normal cart/Payment shows, because the order isn't empty).
export class TherapyScreen extends Component {
    static template = "spa_online_booking.TherapyScreen";
    static components = { SpaSignatureField, PhoneField };
    static props = {};

    setup() {
        this.pos = usePos();
        this.orm = this.env.services.orm;
        this.state = useState({
            screen: "select",
            pkgView: "grid",
            loading: true,
            error: "",
            therapies: [],
            currency: { symbol: "", position: "before" },
            therapyId: null,
            packageId: null,
            // Optional extras ticked on the package screen. Ids only - prices
            // are always read back off the package payload, so a stale number
            // can never reach the order.
            addonIds: [],
            // Everyone the package covers. A Family 2 books two people, each
            // with their own details, their own answers and their own
            // signature. The fields below (custName, answers, sig, custTerms)
            // are the WORKING SET for whoever is on screen; _savePerson stores
            // them here and _loadPerson brings the next person's back.
            //
            // One form, filled N times - not N forms. The details form and the
            // signature pad both reach for fixed DOM ids, so a second copy on
            // screen at once would collide with the first.
            members: [],
            memberIndex: 0,
            // Persons 2+ type a plain optional number here. Kept OFF custMobile
            // on purpose: that field, its country code and the matched partner
            // belong to the lead and must survive being on person 2's screen -
            // they are what the order is billed to.
            memberPhone: "",
            // Which Individual / Family tab is showing. Reset when a therapy is
            // opened, so a new one never inherits a family size from the last.
            // Set from the payload once it loads (see openTherapy); there
            // is no base key to read before then.
            memberType: null,
            memberTypes: [],
            packageNote: "",
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
            // One message per field, keyed by field name ("phone", "dob", ...).
            // Painted under the field it belongs to and refreshed as staff type,
            // so a wrong number is called out where it was entered rather than
            // as a single line above the buttons once Continue is pressed.
            fieldErrors: {},
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
            // Health answers already on file for the lead (res.partner
            // spa_health_status). With the "Healthy - no changes" tick on,
            // Continue skips the questions and the signature and reuses these;
            // untick it and the questions open pre-filled to be edited.
            health: null,
            healthOk: true,
            // Set when this booking reused the profile, so confirm() does not
            // write the same answers back over it as a new update.
            healthUsed: false,
            busy: false,
        });
        // Look the customer up as the number is typed, not on every keystroke.
        this.lookupCustomer = debounce(this.lookupCustomer.bind(this), 400);
        onWillStart(async () => {
            try {
                const res = await fetch("/api/spa/therapies").then((r) => r.json());
                this.state.therapies = res.therapies || [];
                // Tab labels and the small print both come from the backend, so
                // neither is hard-coded here.
                this.state.memberTypes = res.member_types || [];
                this.state.packageNote = res.package_note || "";
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

    // Only the member types this therapy actually prices. A spa selling
    // individual packages only then sees no tab bar at all, rather than three
    // tabs that are empty.
    get memberTypes() {
        const th = this.therapy;
        if (!th) {
            return [];
        }
        const priced = new Set();
        for (const p of th.packages || []) {
            // No `|| { individual: 0 }` fallback here: `{}` is truthy, so it
            // never fired, and it read as protection that was not there. The
            // server guarantees the sales price is always in `prices` - under
            // the base member type's code, or under 'individual' when the
            // database has no member types at all.
            for (const key of Object.keys(p.prices || {})) {
                priced.add(key);
            }
        }
        return (this.state.memberTypes || []).filter((m) => priced.has(m.key));
    }

    // What one package costs on the selected tab, or null when it is not sold
    // to that member type. Availability and price are the same question.
    priceFor(pkg) {
        const prices = pkg.prices || {};
        const value = prices[this.state.memberType];
        return value === undefined || value === null ? null : value;
    }

    // Packages sold to the selected member type. A package with no price for
    // this tab is left out entirely - an empty cell means "not offered", not
    // "same price as individual".
    get visiblePackages() {
        const th = this.therapy;
        if (!th) {
            return [];
        }
        return (th.packages || []).filter((p) => this.priceFor(p) !== null);
    }

    // ---- add-ons ----
    // The extras offered on the selected package. Configured on the therapy
    // (POS -> Product Categories -> Add-ons) and merged server-side with the
    // package's own Upsell & Cross-Sell field, so this just reads the payload.
    get addons() {
        return this.pkg?.addons || [];
    }
    // Only the ticked extras still offered on the CURRENT package - guards a
    // stale id surviving a package switch.
    get chosenAddons() {
        return this.addons.filter((a) => this.state.addonIds.includes(a.id));
    }
    isAddonOn(id) {
        return this.state.addonIds.includes(id);
    }
    toggleAddon(id) {
        const ids = this.state.addonIds;
        const at = ids.indexOf(id);
        if (at === -1) {
            ids.push(id);
        } else {
            ids.splice(at, 1);
        }
    }
    // Package price on the current tab plus the ticked extras. Add-ons have no
    // family pricing: a family pays for one heat pack, not one per person.
    get bookingTotal() {
        const base = this.pkg ? this.priceFor(this.pkg) : null;
        return (base ?? 0) + this.chosenAddons.reduce((sum, a) => sum + (a.price || 0), 0);
    }

    pickMemberType(key) {
        this.state.memberType = key;
        // A package chosen under the old tab is not on offer under this one,
        // so clear it rather than carrying a hidden selection into Continue.
        this.state.packageId = null;
        this.state.addonIds = [];
        // The people are NOT cleared here: the same customer is still booking,
        // and retyping person 1 because they switched from Family 2 to Family 3
        // would be needless. toDetails() resizes the list around whoever is
        // already entered.
        this.state.memberIndex = 0;
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
        this.state.addonIds = [];
        // Start on the base tab, or the first this therapy actually has -
        // defaulting blindly to the base would show an empty list for a
        // family-only therapy.
        const available = this.memberTypes;
        const base = this.baseMemberKey;
        this.state.memberType =
            available.some((m) => m.key === base) || !available.length
                ? base
                : available[0].key;
    }
    // Radio-select a package (website style); a Continue button then advances.
    pick(id) {
        if (this.state.packageId !== id) {
            // Extras belong to the package they were offered on, so switching
            // package drops them rather than carrying them to another one.
            this.state.addonIds = [];
        }
        this.state.packageId = id;
    }
    // ---- the people on this booking ----
    // The chosen type's record, as sent by /api/spa/therapies.
    // The base (single-person) type's key, from the server. Not the string
    // "individual": that is a CODE the spa can change, and hard-coding it
    // here is the same mistake the headcount map was.
    get baseMemberKey() {
        const base = (this.state.memberTypes || []).find((m) => m.is_individual);
        return base ? base.key : null;
    }
    get memberTypeInfo() {
        return (this.state.memberTypes || []).find(
            (m) => m.key === this.state.memberType
        );
    }
    // How many people the chosen package covers. Read from the server, NOT
    // a map in here: it used to be {family_2: 2, family_3: 3, family_4: 4},
    // which had to be edited - in this file AND in the booking page - every
    // time a member type was added. The server re-checks either way.
    get headcount() {
        return this.memberTypeInfo?.headcount || 1;
    }
    get isFamily() {
        return this.headcount > 1;
    }
    get isLeadPerson() {
        return this.state.memberIndex === 0;
    }
    get isLastPerson() {
        return this.state.memberIndex >= this.headcount - 1;
    }
    get personLabel() {
        return `Person ${this.state.memberIndex + 1} of ${this.headcount}`;
    }

    // A blank person. Phone and email stay optional for everyone but the lead:
    // a parent books for their children, and a child has no number.
    _blankPerson() {
        return {
            name: "", dob: "", gender: "", phone: "", email: "",
            answers: {}, terms: false, signature: "",
        };
    }

    // Store whatever is on screen against the person being filled in.
    _savePerson() {
        const i = this.state.memberIndex;
        while (this.state.members.length <= i) {
            this.state.members.push(this._blankPerson());
        }
        this.state.members[i] = {
            name: (this.state.custName || "").trim(),
            dob: this.state.custDob || "",
            gender: this.state.custGender || "",
            // The lead's number is the booking's contact number and is built
            // from the country picker; everyone else types a plain optional one.
            phone: this.isLeadPerson ? this.fullMobile : (this.state.memberPhone || "").trim(),
            email: (this.state.custEmail || "").trim(),
            answers: { ...this.state.answers },
            terms: !!this.state.custTerms,
            signature: this.state.sig.value || "",
        };
    }

    // Bring a person back onto the screen. Used both when moving to the next
    // person and when stepping Back into someone already filled in, so nothing
    // typed is ever lost.
    _loadPerson(index) {
        const person = this.state.members[index] || this._blankPerson();
        this.state.memberIndex = index;
        // Person 2 opens on a clean form - inheriting person 1's complaints
        // would mark fields they have not been given a chance to fill in.
        this._clearFieldErrors();
        this.state.custName = person.name || "";
        this.state.custDob = person.dob || "";
        this.state.custGender = person.gender || "";
        this.state.custEmail = person.email || "";
        this.state.answers = { ...(person.answers || {}) };
        this.state.custTerms = !!person.terms;
        this.state.sig = newSigState(person.signature || "");
        // Persons 2+ get the short form. custMobile / custDialCode /
        // custWhatsapp / custPartnerId are NOT touched here - they hold the
        // lead's contact details, which the order is billed to and which have
        // to still be there when we come back to place it.
        this.state.memberPhone = this.isLeadPerson ? "" : person.phone || "";
    }

    // Copy the lead's answers onto the person being filled in. Ten questions
    // times four people is forty answers at a busy counter; without this the
    // family flow is unusable. Everything stays editable afterwards.
    copyLeadAnswers() {
        const lead = this.state.members[0];
        if (!lead) {
            return;
        }
        this.state.answers = { ...(lead.answers || {}) };
        this.state.error = "";
    }

    // Straight off the package list - nothing to check yet.
    toDetails() {
        this.state.error = "";
        // Entering the details for the first time: size the list to the family
        // and start on person 1.
        // Size the list to the family, keeping anyone already entered: changing
        // Family 4 to Family 2 does not change who the first two people are.
        if (this.state.members.length !== this.headcount) {
            const kept = this.state.members.slice(0, this.headcount);
            while (kept.length < this.headcount) {
                kept.push(this._blankPerson());
            }
            this.state.members = kept;
        }
        // Always start the cycle at person 1 AND repaint from them. Without the
        // repaint the form keeps whoever was entered last: fill in person 3 of
        // a Family 4, go Back and switch to Family 2, and their name and date
        // of birth reappear labelled "Person 1 of 2" - booking one person under
        // another's details.
        this._loadPerson(0);
        this.state.screen = "details";
    }
    // Leaving the details, so the customer is checked HERE: the complaint has
    // to appear on the step that holds the fields it is about.
    async toQuestions() {
        if (!this.customerOk()) {
            return;
        }
        this.state.error = "";
        this._savePerson();
        await this._ensureQuestions();
        this.state.healthUsed = false;
        const health = this.isLeadPerson ? this.state.health : null;
        if (health && health.on_file) {
            // Start from what is on file whichever way the tick is set: ticked
            // it is used as is, unticked it is the form to edit.
            if (!Object.keys(this.state.answers || {}).length) {
                this.state.answers = { ...(health.answers || {}) };
            }
            if (this.state.healthOk && !(health.missing_required || []).length) {
                this.state.answers = { ...(health.answers || {}) };
                this.state.healthUsed = true;
                this._savePerson();
                // Only the questions are skipped. The waiver is consent to THIS
                // package, so it is read, ticked and signed fresh every time.
                if (this.disclaimer) {
                    this.state.screen = "disclaimer";
                } else {
                    this.nextPersonOrConfirm();
                }
                return;
            }
            if (this.state.healthOk) {
                this.state.error =
                    "A new question has been added since the last visit - please answer it.";
            }
        }
        this.state.screen = "questions";
    }

    async _ensureQuestions() {
        if (this.state.questionsFor === this.state.packageId) {
            return;
        }
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

    // Read the lead's answers on file as soon as we know who they are, so the
    // tick can be shown on the details step itself.
    async _loadHealth(partnerId) {
        this.state.health = null;
        this.state.healthOk = true;
        if (!partnerId) {
            return;
        }
        try {
            await this._ensureQuestions();
            const status = await this.orm.call("res.partner", "spa_health_status", [
                partnerId,
                this.state.questions.map((q) => q.id),
            ]);
            // The customer may have changed while the call was in flight.
            if (this.state.custPartnerId === partnerId && status && status.on_file) {
                this.state.health = status;
            }
        } catch (e) {
            // No profile = ask the questions, exactly as before.
            console.warn("Therapy booking: could not read the health answers", e);
        }
    }

    // New answers (a first visit, or the tick taken off) become the profile.
    async _saveHealth(partnerId) {
        const lead = this.state.members[0];
        if (!partnerId || !lead) {
            return;
        }
        if (this.state.healthUsed) {
            // No changes, but nothing signed on file yet (the answers came from
            // the pop-up or the kiosk): keep the signature just given, so the
            // next visit skips the waiver as well.
            const onFile = this.state.health && this.state.health.signature;
            if (!onFile && lead.signature) {
                try {
                    await this.orm.call("res.partner", "spa_health_keep_signature", [
                        partnerId,
                        lead.signature,
                    ]);
                } catch (e) {
                    console.warn("Therapy booking: could not keep the signature", e);
                }
            }
            return;
        }
        if (!Object.keys(lead.answers || {}).length) {
            return;
        }
        try {
            await this.orm.call("res.partner", "spa_health_save", [
                partnerId,
                lead.answers,
                lead.signature || false,
            ]);
        } catch (e) {
            console.warn("Therapy booking: could not save the health answers", e);
        }
    }
    // ---- details validation -------------------------------------------
    // The fields this person has to get right, in the order they appear on
    // screen - so "the first thing wrong" is also the topmost thing wrong.
    //
    // Only the lead is asked for numbers: they are the booking's contact and
    // the one the order is billed to. Requiring one from every person would
    // make it impossible to book for a child.
    get _detailFields() {
        if (!this.isLeadPerson) {
            // Their plain phone box stays optional, but the email they DO give
            // still has to be an address we can send anything to.
            return ["name", "dob", "gender", "email"];
        }
        return ["phone", "name", "dob", "gender", "whatsapp", "email"];
    }

    // The latest date the date-of-birth picker may offer. Bound to the input's
    // `max`, so the future is not merely rejected - it cannot be picked.
    get maxDob() {
        return todayIso();
    }

    // What is wrong with one field right now, as a sentence, or "" if nothing.
    // Pure: it reads state and returns text, so both the live handlers and
    // customerOk() can call it without side effects.
    _fieldError(field) {
        switch (field) {
            case "phone":
                return resolveMessage(
                    phoneError(this.state.custDialCode, this.state.custMobile),
                    this.state.custDialCode
                );
            case "whatsapp":
                // Nothing to check while the box is ticked: the number is the
                // phone number, and that has already been validated above.
                if (this.state.custWaSame) {
                    return "";
                }
                {
                    const code = phoneError(
                        this.state.custWaDialCode,
                        this.state.custWhatsapp
                    );
                    // An empty box here has its own wording: the fix is either
                    // to type a number or to tick the box, and "enter the
                    // customer's phone number" says neither.
                    return resolveMessage(
                        code === "err_phone_required" ? "err_alt_number_required" : code,
                        this.state.custWaDialCode
                    );
                }
            case "name":
                if ((this.state.custName || "").trim()) {
                    return "";
                }
                return this.isFamily
                    ? `Please enter the name of ${this.personLabel.toLowerCase()}.`
                    : "Please enter the customer's name.";
            case "dob":
                return resolveMessage(dobError(this.state.custDob));
            case "gender":
                return this.state.custGender ? "" : resolveMessage("err_gender_required");
            case "email":
                // Optional - blank passes. Anything typed has to be a real
                // address, or the customer silently loses their confirmation.
                return resolveMessage(emailError(this.state.custEmail));
            default:
                return "";
        }
    }

    // Re-check one field and repaint its message. Wired to the inputs so the
    // complaint appears while the number is being typed.
    checkField(field) {
        const message = this._fieldError(field);
        if (message) {
            this.state.fieldErrors[field] = message;
        } else {
            delete this.state.fieldErrors[field];
        }
        // The summary line is only ever the CURRENT first problem; leaving the
        // old one there contradicts the field that has just gone green.
        if (this.state.error) {
            const remaining = this._detailFields.find((f) => this.state.fieldErrors[f]);
            this.state.error = remaining ? this.state.fieldErrors[remaining] : "";
        }
    }

    // Ticking / unticking "same as phone number" changes which numbers exist,
    // so both messages have to be re-derived.
    onWaSameToggle() {
        this.checkField("whatsapp");
        this.checkField("phone");
    }

    _clearFieldErrors() {
        this.state.fieldErrors = {};
    }

    // True when we know who this booking is for, and every detail we hold is
    // usable. Sets the errors itself so both callers say the same thing.
    customerOk() {
        this._clearFieldErrors();
        let first = "";
        for (const field of this._detailFields) {
            const message = this._fieldError(field);
            if (message) {
                this.state.fieldErrors[field] = message;
                first = first || message;
            }
        }
        this.state.error = first;
        return !first;
    }
    // The therapy's disclaimer, or null when it has none - which is what makes
    // the step disappear rather than show an empty page. It rides along on
    // /api/spa/therapies, so it is already loaded by the time we get here.
    get disclaimer() {
        const th = this.therapy;
        const d = th && th.disclaimer;
        return d && d.body ? d : null;
    }

    // Set per therapy on its POS category, and it rides along on the same
    // disclaimer payload. Missing on a therapy last saved before the field
    // existed, hence the coercion - drawing stays the default.
    get allowSignatureUpload() {
        return !!(this.disclaimer && this.disclaimer.allow_upload);
    }

    // The hint has to be computed here: passing one at all overrides the
    // upload-aware wording SpaSignatureField would otherwise pick itself.
    get signHint() {
        return this.allowSignatureUpload
            ? "The customer signs here, or upload a picture of the signature."
            : "The customer signs here for this service.";
    }

    // Leaving the questions. The consent tick and the signature moved onto the
    // disclaimer step, so they are given on the page carrying the wording being
    // agreed to - not one page before it.
    toDisclaimer() {
        if (!this.requiredOk()) {
            this.state.error = this.isFamily
                ? `Please answer the required questions for ${this.personLabel.toLowerCase()}.`
                : "Please answer the required questions.";
            return;
        }
        this.state.error = "";
        this._savePerson();
        if (!this.disclaimer) {
            // No waiver to agree to, so this person is finished.
            this.nextPersonOrConfirm();
            return;
        }
        this.state.screen = "disclaimer";
    }

    // End of one person's turn: either start the next person, or place the
    // order. Consent sits here, right after their own answers - nobody signs
    // for a health history they did not give.
    nextPersonOrConfirm() {
        if (this.disclaimer) {
            if (!this.state.custTerms) {
                this.state.error = "Please tick that the terms are accepted.";
                return;
            }
            if (!this.signed) {
                this.state.error = "Please capture the signature.";
                return;
            }
        }
        this.state.error = "";
        this._savePerson();
        if (!this.isLastPerson) {
            this._loadPerson(this.state.memberIndex + 1);
            this.state.screen = "details";
            return;
        }
        this.confirm();
    }

    back() {
        const map = { details: "select", questions: "details", disclaimer: "questions" };
        this.state.error = "";
        if (this.state.screen === "details" && !this.isLeadPerson) {
            // Stepping back off person N's details returns to person N-1's
            // last step, with everything they entered still there.
            this._savePerson();
            this._loadPerson(this.state.memberIndex - 1);
            this.state.screen = this.disclaimer ? "disclaimer" : "questions";
            return;
        }
        // Questions were skipped ("Healthy - no changes"): there is no
        // questions page behind the disclaimer to go back to.
        if (this.state.screen === "disclaimer" && this.state.healthUsed && this.isLeadPerson) {
            this.state.screen = "details";
            return;
        }
        const prev = map[this.state.screen];
        if (prev) {
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
    selectCountry(code) {
        this.state.custDialCode = code;
        // The country is part of the number, so the lookup has to run again.
        this.onPhoneInput();
    }
    selectWaCountry(code) {
        this.state.custWaDialCode = code;
        // The country decides how many digits are expected, so switching it
        // makes a number that was fine a moment ago wrong (and vice versa).
        this.checkField("whatsapp");
    }
    // PhoneField hands the typed digits back rather than writing to state
    // itself, so the screen stays the one place that owns the number.
    setMobile(value) {
        this.state.custMobile = value;
        this.onPhoneInput();
    }
    setWhatsapp(value) {
        this.state.custWhatsapp = value;
        this.checkField("whatsapp");
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
            // Those boxes are empty again because WE emptied them, not because
            // staff left them blank - complaining about fields nobody has
            // touched yet is noise.
            for (const field of ["name", "dob", "gender", "email", "whatsapp"]) {
                delete this.state.fieldErrors[field];
            }
        }
        this.state.custPartnerId = null;
        this.state.custMatches = [];
        this.state.custLookupDone = false;
        this.state.custNewMode = false;
        this.state.health = null;
        this.state.healthOk = true;
        // Same call for a keystroke and for a country change - selectCountry()
        // routes through here - so the length message tracks both.
        this.checkField("phone");
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
        // A contact saved before these rules existed can carry a malformed
        // email or a nonsense date of birth. Flag those the moment they land on
        // screen so reception fixes them here, but stay quiet about what the
        // contact simply does not have yet - Continue will ask for that.
        this._clearFieldErrors();
        this._checkFilledOnly();
        // A different person's answers must not carry over to this one.
        this.state.answers = {};
        this._loadHealth(c.id);
        // The signature is NOT touched here: it was given for this service a
        // moment ago, on the questions step, before we knew who this was.
    }

    // Validate only the fields that actually hold something, so loading a
    // half-filled contact does not open with a wall of "required" messages.
    _checkFilledOnly() {
        const filled = {
            name: this.state.custName,
            dob: this.state.custDob,
            gender: this.state.custGender,
            email: this.state.custEmail,
            whatsapp: this.state.custWaSame ? "" : this.state.custWhatsapp,
        };
        // `phone` is absent from the map on purpose: onPhoneInput has just
        // validated it, and it is the one field we did not fill from the
        // contact.
        for (const field of this._detailFields) {
            if (String(filled[field] || "").trim()) {
                this.checkField(field);
            }
        }
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
        this.state.health = null;
        this.state.healthOk = true;
        this.state.answers = {};
        this.state.custName = "";
        this.state.custDob = "";
        this.state.custGender = "";
        this.state.custEmail = "";
        this.state.custWhatsapp = "";
        this.state.custWaSame = true;
        // A blank form for a new person: nothing has been typed yet, so there
        // is nothing to complain about. The phone error (if any) stands - that
        // number is the one thing we kept.
        for (const field of ["name", "dob", "gender", "email", "whatsapp"]) {
            delete this.state.fieldErrors[field];
        }
    }

    chooseExistingInstead() {
        this.state.custNewMode = false;
    }

    // Same "Q: A | Q: A" shape the SpaQuestionsDialog produced. It has to land
    // in customer_note because that is the ONLY field
    // pos.order.spa_service_summary reads (spa_kiosk/models/pos_order.py) for
    // the "Service / Questions & Answers" column of the contact's Spa Visits
    // tab. The modal used to fill it; now that we skip the modal, this does.
    // One person's answers as "Q: A | Q: A".
    _answerPairs(answers, keepBlank) {
        return this.state.questions
            .map((q) => {
                const a = (answers || {})[q.id];
                const val = Array.isArray(a) ? a.join(", ") : a || "";
                return keepBlank || val ? `${q.text}: ${val || "-"}` : null;
            })
            .filter(Boolean);
    }

    buildAnswerNote() {
        // A family's answers are prefixed with who gave them, or two people's
        // health histories would read as one contradictory list.
        if (this.isFamily) {
            return this.state.members
                .map((person, index) => {
                    const pairs = this._answerPairs(person.answers, true).join(" | ");
                    return `${person.name || `Person ${index + 1}`} — ${pairs}`;
                })
                .join(" || ");
        }
        return this._answerPairs(this.state.members[0]?.answers, true).join(" | ");
    }

    buildNote() {
        const th = this.therapy;
        const p = this.pkg;
        const lines = [`${this.therapyTitle(th)} — ${p.name}`];
        this.state.members.forEach((person, index) => {
            const pairs = this._answerPairs(person.answers, false);
            if (this.isFamily) {
                lines.push("");
                lines.push(`${index + 1}. ${person.name || `Person ${index + 1}`}`);
            }
            lines.push(...pairs);
        });
        return lines.join("\n");
    }

    reset() {
        Object.assign(this.state, {
            screen: "select",
            therapyId: null,
            packageId: null,
            addonIds: [],
            members: [],
            memberIndex: 0,
            memberPhone: "",
            memberType: this.baseMemberKey,
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
            fieldErrors: {},
            custPartnerId: null,
            custMatches: [],
            custLookupBusy: false,
            custLookupDone: false,
            custNewMode: false,
            custTerms: false,
            health: null,
            healthOk: true,
            healthUsed: false,
            error: "",
            busy: false,
        });
        this.resetSignature();
    }

    // Put a line on the order for each extra ticked on the package screen.
    // Called after the package line so the extras sit under it on the receipt.
    //
    // No popup: the customer already chose these alongside the package, and
    // asking again after "Add to Order" would offer the same extras twice.
    async _addChosenAddons() {
        for (const addon of this.chosenAddons) {
            try {
                // Same cache hazard as the package: the server force-loads
                // add-ons at session start, which does nothing for one created
                // since. Fetch it rather than throw on an undefined template.
                if (!(await this._ensureProductLoaded(addon.id))) {
                    console.error(
                        "Therapy booking: add-on not available in this register",
                        addon
                    );
                    continue;
                }
                // skipSpaQuestions because an add-on is an ordinary product -
                // it has no therapy, so it has no questionnaire of its own.
                await this.pos.addLineToCurrentOrder(
                    { product_tmpl_id: addon.id, qty: 1 },
                    { skipSpaQuestions: true }
                );
            } catch (e) {
                // Never let one extra cost the sale: the package is already on
                // the order by this point, so log it and keep going.
                console.error("Therapy booking: could not add add-on", addon, e);
            }
        }
    }

    // Close the booking page (back to the logo / cart).
    closeBooking() {
        this.reset();
        this.pos.showTherapyBooking = false;
    }

    // Make sure the POS actually holds this product before a line is built from it.
    //
    // This wizard's catalogue comes from /api/spa/therapies, which is always
    // current, while the POS product store is whatever it cached when the
    // session opened. A package or add-on created since then is offered here but
    // missing there, and core then dies on `productTemplate.taxes_id` because
    // models["product.template"].get(id) returned undefined - a raw TypeError
    // with nothing a cashier can act on.
    //
    // loadNewProducts() is core's own mechanism for pulling products into a
    // running session (it brings pricelists and attributes along too), so fetch
    // the missing one rather than fail on it.
    async _ensureProductLoaded(tmplId) {
        if (!tmplId) {
            return false;
        }
        if (this.pos.models["product.template"].get(tmplId)) {
            return true;
        }
        try {
            await this.pos.loadNewProducts([["id", "=", tmplId]]);
        } catch (e) {
            console.error("Therapy booking: could not load product", tmplId, e);
            return false;
        }
        return !!this.pos.models["product.template"].get(tmplId);
    }

    // Create or reuse the contact for the LEAD BOOKER and return its id, or
    // null when it could not be saved (the booking still goes through).
    //
    // Reads members[0], not the form. By the time this runs the form holds the
    // LAST person entered, so on a family booking the on-screen fields belong
    // to somebody else entirely - billing the order to them would be wrong.
    async _resolveCustomer() {
        const lead = this.state.members[0] || {};
        const name = (lead.name || "").trim();
        const mobile = this.fullMobile;
        const wa = this.state.custWaSame ? mobile : this.fullWhatsapp;
        const email = (lead.email || "").trim();
        try {
            const partnerId = this.state.custPartnerId;
            if (partnerId) {
                // Known customer: reuse the contact instead of creating a
                // duplicate, and only fill in details it is MISSING - a typo at
                // the till must never overwrite good data.
                const existing = this.selectedCustomer || {};
                const patch = {};
                if (lead.dob && !existing.date_of_birth) {
                    patch.date_of_birth = lead.dob;
                }
                if (lead.gender && !existing.gender) {
                    patch.gender = lead.gender;
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
            if (lead.dob) {
                vals.date_of_birth = lead.dob;
            }
            if (lead.gender) {
                vals.gender = lead.gender;
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
    //
    // ONE RECORD PER PERSON. A family booking collects a signature from each
    // person for their own answers, and client_name / client_phone /
    // client_email are already per-signature snapshots, so each record says who
    // signed it. They all point at the same order line through
    // pos_order_line_id; line.spa_signature_ref is a plain Integer and can only
    // hold one, so it keeps pointing at the lead's - which is what every
    // existing reader expects.
    // Everyone on a family sale, parked on the order so they travel with it to
    // the server.
    //
    // Deliberately NOT an orm.create() here. At this point the order has not
    // synced, so `order.id` is a negative placeholder and `line.id` is a client
    // id - which is exactly why every spa.service.signature row in the database
    // has a null pos_order_line_id. Writing to a field on the order instead
    // means the people ride along with the order payload and are turned into
    // booking members in _process_order, once real ids exist.
    //
    // Families only. An individual sale needs no booking, and creating one for
    // every counter sale would change what the Orders screen lists.
    _saveMembers(order) {
        if (!this.isFamily || !order || !("spa_members_json" in order)) {
            return;
        }
        const people = this.state.members
            .filter((person) => (person.name || "").trim())
            .map((person, index) => ({
                sequence: index + 1,
                name: (person.name || "").trim(),
                // dob and gender are collected in _savePerson and used to be
                // dropped for everyone but the lead - they identify the person
                // on the waiver and match them on a return visit.
                date_of_birth: person.dob || false,
                gender: person.gender || false,
                phone: person.phone || "",
                email: person.email || "",
                terms_accepted: !!person.terms,
            }));
        if (people.length < 2) {
            return;
        }
        order.spa_members_json = JSON.stringify(people);
    }

    // Park the signatures on the order; the server creates them once the line
    // has a real id (see pos_order._spa_store_signatures_payload).
    //
    // This used to call orm.create() directly with `pos_order_line_id: line.id`.
    // At this point the line is unsynced, so its `id` is a client-side UUID, and
    // Postgres rejected the whole insert - "invalid input syntax for type
    // integer". That is why every older signature row has a null line id. The
    // line's `uuid` DOES survive the sync, so that is what is sent instead.
    _saveSignature(order, line) {
        if (!order || !line || !("spa_signatures_json" in order)) {
            return;
        }
        const entries = this.state.members
            .map((person, index) => ({ person, index }))
            .filter(({ person }) => person.signature)
            .map(({ person, index }) => ({
                line_uuid: line.uuid,
                // Only the lead has a contact; the snapshot fields below are
                // what identify everyone else on the waiver.
                is_lead: index === 0,
                signature: person.signature,
                terms_accepted: !!person.terms,
                // The Client Information as it stood when it was signed - see
                // the model for why it is not read back off the contact.
                client_name: person.name || "",
                client_phone: person.phone || "",
                client_email: person.email || "",
                // The waiver wording as shown on the disclaimer step the
                // customer just read. Stored so a later edit to the therapy
                // cannot rewrite what they agreed to.
                disclaimer_title: (this.disclaimer && this.disclaimer.title) || "",
                disclaimer_body: (this.disclaimer && this.disclaimer.body) || "",
            }));
        if (!entries.length) {
            return;
        }
        order.spa_signatures_json = JSON.stringify(entries);
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
        // Everyone is validated on their own way through the wizard; this is
        // the last gate before the order, checking the COLLECTED people rather
        // than whoever happens to be on screen. A Family 3 that somehow reached
        // here with two people must not become an order.
        if (this.state.members.length !== this.headcount) {
            this.state.error =
                `This package is for ${this.headcount} people but ` +
                `${this.state.members.length} have been entered.`;
            return;
        }
        const nameless = this.state.members.findIndex((p) => !(p.name || "").trim());
        if (nameless !== -1) {
            this._loadPerson(nameless);
            this.state.screen = "details";
            this.state.error = `Please enter the name of person ${nameless + 1}.`;
            return;
        }
        // Only demanded when there IS a disclaimer step: the tick and the
        // signature live on it, so a therapy with the disclaimer switched off
        // has no screen on which they could ever have been given. Without this
        // guard, turning it off would block adding the package to the order.
        if (this.disclaimer) {
            const unsigned = this.state.members.findIndex(
                (p) => !p.terms || !(p.signature || "").trim());
            if (unsigned !== -1) {
                this._loadPerson(unsigned);
                this.state.screen = "disclaimer";
                this.state.error = this.isFamily
                    ? `${this.personLabel} still needs to accept and sign.`
                    : "Please ask the customer to accept the terms and sign.";
                return;
            }
        }
        // Checked on the way out of the details step already; if something
        // cleared them since, send them back rather than failing on save.
        if (!this.fullMobile) {
            this._loadPerson(0);
            this.state.screen = "details";
            this.state.error = "Please enter the customer's phone number.";
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
            // Charge the price of the member type the customer was shown.
            // Passing price_unit marks the line price_type "manual", which is
            // what stops a pricelist resetting it back to the individual price
            // (see point_of_sale pos_store.handlePriceUnit).
            const chosenPrice = this.pkg ? this.priceFor(this.pkg) : null;
            const lineVals = { product_tmpl_id: templateId };
            if (chosenPrice !== null && !this.memberTypeInfo?.is_individual) {
                lineVals.price_unit = chosenPrice;
            }
            if (!(await this._ensureProductLoaded(templateId))) {
                this.state.error =
                    "This package is not available in this register yet. " +
                    "Close and reopen the POS, then try again.";
                this.state.busy = false;
                return;
            }
            const line = await this.pos.addLineToCurrentOrder(
                lineVals,
                { skipSpaQuestions: true }
            );
            // Record WHICH member type was sold: a family line priced 216 is
            // otherwise indistinguishable from an individual one discounted to
            // 216, which would make the receipts and reports lie.
            if (line && this.state.memberType) {
                line.spa_member_type = this.state.memberType;
                // Name it on the line too. full_product_name is what the
                // printed receipt shows (getFullProductName) and what becomes
                // the invoice line description, so setting it here makes both
                // documents state the family size. The server re-applies this
                // on create, so the two can never disagree.
                // Strip any suffix already there before adding one: a line
                // merged into an existing one would otherwise read
                // "... - Family 2 - Family 2". Mirrors the server's
                // _spa_apply_member_name, so both arrive at the same string.
                let base =
                    line.full_product_name ||
                    (line.product_id && line.product_id.display_name) ||
                    "";
                for (const m of this.state.memberTypes || []) {
                    const suffix = ` - ${m.label}`;
                    if (base.endsWith(suffix)) {
                        base = base.slice(0, -suffix.length);
                        break;
                    }
                }
                const chosen = (this.state.memberTypes || []).find(
                    (m) => m.key === this.state.memberType
                );
                line.full_product_name =
                    chosen && !chosen.is_individual
                        ? `${base} - ${chosen.label}`
                        : base;
            }
            const order = this.pos.getOrder();

            if (partnerId) {
                await this.pos.data.searchRead("res.partner", [["id", "=", partnerId]]);
                const partner = this.pos.models["res.partner"].get(partnerId);
                if (partner && order) {
                    order.setPartner(partner);
                }
            }

            // Bookkeeping, not selling. The package is on the order by now, so
            // none of this is allowed to abort the sale - a throw here used to
            // surface as "Could not add this package to the order" AFTER the
            // customer had already been created, so every retry left another
            // duplicate contact behind.
            try {
                if (line && note) {
                    line.setNote(JSON.stringify([{ text: note, colorIndex: 0 }]));
                }
                if (line) {
                    const answers = this.buildAnswerNote();
                    if (answers) {
                        line.setCustomerNote(answers);
                    }
                    this._saveSignature(order, line);
                }
                if (order && "spa_channel" in order) {
                    order.spa_channel = "web";
                }
                this._saveMembers(order);
                await this._saveHealth(partnerId);
            } catch (e) {
                console.error("Therapy booking: could not record the details", e);
                this.state.error =
                    "The package was added, but its details could not be recorded: " +
                    (e && e.message ? e.message : e);
            }
            // The extras ticked on the package screen, added after the package
            // so they sit under it on the receipt. Awaited before reset(),
            // which clears the very list this reads from.
            await this._addChosenAddons();
            this.reset();
            this.pos.showTherapyBooking = false;
        } catch (e) {
            // Show the real error, not just a generic sentence: without it the
            // only copy of the exception was in the browser console, which is
            // no use when the person hitting it is at the till.
            console.error("Therapy booking: could not add the package", e);
            this.state.error =
                "Could not add this package to the order: " +
                (e && e.message ? e.message : e);
            this.state.busy = false;
        }
    }
}
