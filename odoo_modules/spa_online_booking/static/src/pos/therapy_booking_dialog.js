import { Component, useState, onWillStart, markup } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

// The in-POS version of the website booking flow: therapy grid -> therapy
// detail + packages (radio) -> package details -> questions. On confirm it
// hands the chosen package + a Q&A note back to the caller (the Navbar patch),
// which adds it to the current order. Data comes from the same public
// /api/spa/therapies endpoint the website uses, so both stay in sync.
export class TherapyBookingDialog extends Component {
    static template = "spa_online_booking.TherapyBookingDialog";
    static components = { Dialog };
    static props = ["addPackage", "close"];

    setup() {
        this.state = useState({
            screen: "select",          // select | questions | details
            pkgView: "grid",           // grid | list
            loading: true,
            error: "",
            therapies: [],
            currency: { symbol: "", position: "before" },
            therapyId: null,
            packageId: null,
            questions: [],
            questionsFor: null,
            answers: {},               // qid -> string | string[]
            custName: "",
            custWhatsapp: "",
            custMobile: "",
            busy: false,
        });

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

    // ---- lookups ----
    get therapy() {
        return this.state.therapies.find((t) => t.id === this.state.therapyId) || null;
    }
    get pkg() {
        const th = this.therapy;
        return th ? th.packages.find((p) => p.id === this.state.packageId) || null : null;
    }
    get dialogTitle() {
        if (this.state.screen === "select") {
            return "Book Therapy";
        }
        const th = this.therapy;
        let title = th ? this.therapyTitle(th) : "Book a Therapy";
        if (this.pkg && ["questions", "disclaimer", "details"].includes(this.state.screen)) {
            title += ` • ${this.pkg.name}`;
        }
        return title;
    }

    therapyTitle(th) {
        return th.duration_min ? `${th.name} (${th.duration_min} min)` : th.name;
    }

    // Per-therapy accent colour + icon for the selection cards.
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

    // Render an Html field's value as real HTML (it's sanitized server-side),
    // instead of OWL escaping it and showing the raw <div> tags.
    html(value) {
        return value ? markup(value) : "";
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
    // Selecting a therapy just reveals its packages on the same screen.
    openTherapy(id) {
        this.state.therapyId = id;
        this.state.packageId = null;
    }
    // Picking a package advances to the questions.
    selectPackage(id) {
        this.state.packageId = id;
        this.toQuestions();
    }
    async toQuestions() {
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
    // The therapy's disclaimer, or null when it has none - which is what makes
    // the step disappear rather than show an empty page. It rides along on
    // /api/spa/therapies, so it is already loaded by the time we get here.
    get disclaimer() {
        const th = this.therapy;
        const d = th && th.disclaimer;
        return d && d.body ? d : null;
    }
    toDetails() {
        if (!this.requiredOk()) {
            this.state.error = "Please answer the required questions.";
            return;
        }
        this.state.error = "";
        this.state.screen = "details";
    }
    // The disclaimer comes AFTER the details in this dialog, unlike the Book
    // Therapy screen where the details are collected first. The waiver's Client
    // Information block is filled from the name / number / email, so it has to
    // run once they exist - on the questions step they are still blank.
    toDisclaimer() {
        this.state.error = "";
        this.state.screen = "disclaimer";
    }
    back() {
        const map = {
            questions: "select",
            details: "questions",
            disclaimer: "details",
        };
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

    async confirm() {
        if (!(this.state.custName || "").trim()) {
            this.state.error = "Please enter the customer's name.";
            return;
        }
        this.state.busy = true;
        this.state.error = "";
        try {
            await this.props.addPackage(this.state.packageId, this.buildNote(), {
                name: this.state.custName.trim(),
                whatsapp: (this.state.custWhatsapp || "").trim(),
                mobile: (this.state.custMobile || "").trim(),
            });
            this.props.close();
        } catch (e) {
            // See therapy_screen.js: keep the plain message for staff, but do
            // not throw away what actually failed.
            console.error("Therapy booking: could not add the package", e);
            this.state.error = "Could not add this package to the order.";
            this.state.busy = false;
        }
    }
}
