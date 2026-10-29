import { Component, markup, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class SpaQuestionsDialog extends Component {
    static template = "pos_spa_header.SpaQuestionsDialog";
    static components = { Dialog };
    static props = ["questions", "close", "getPayload?", "disclaimer?", "health?", "saveHealth?"];

    setup() {
        // Two steps in one dialog: the questions, then the therapy's
        // disclaimer. A therapy with no disclaimer text has no second step, so
        // the questions confirm outright and nothing changes for it.
        this.state = useState({
            answers: {},
            multi: {},
            step: "questions",
            // Returning customer with answers on file: ticked = nothing has
            // changed, confirm with the answers on file; unticked = the
            // questions open pre-filled to be edited.
            healthOk: true,
        });
        const onFile = (this.health && this.health.answers) || {};
        for (const q of this.props.questions) {
            const value = onFile[q.id];
            if (q.type === "multi_choice") {
                this.state.multi[q.id] = {};
                for (const opt of Array.isArray(value) ? value : []) {
                    this.state.multi[q.id][opt] = true;
                }
            } else if (value !== undefined && value !== null && value !== false) {
                this.state.answers[q.id] = Array.isArray(value) ? value.join(", ") : String(value);
            }
        }
    }

    get health() {
        const h = this.props.health;
        return h && h.on_file ? h : null;
    }

    // Ticked and every required question already answered on file: nothing
    // to ask. A question added since the last visit still has to be answered.
    get useOnFile() {
        return !!(
            this.health &&
            this.state.healthOk &&
            !(this.health.missing_required || []).length
        );
    }

    get disclaimer() {
        const d = this.props.disclaimer;
        return d && d.body ? d : null;
    }

    // The disclaimer is an Html field written in the Odoo editor and sanitized
    // server-side, so render it as real markup rather than letting OWL escape
    // it and show the raw <p> tags.
    html(value) {
        return value ? markup(value) : "";
    }

    get title() {
        return this.state.step === "disclaimer"
            ? this.disclaimer.title || "Disclaimer"
            : "Service Questions";
    }

    // Questions answered (or skipped as unchanged): move to the disclaimer, or
    // finish when there is none. The disclaimer is shown for every package.
    next() {
        if (this.disclaimer) {
            this.state.step = "disclaimer";
            return;
        }
        this.confirm();
    }

    back() {
        this.state.step = "questions";
    }

    getValue(q) {
        if (q.type === "multi_choice") {
            const sel = this.state.multi[q.id] || {};
            return Object.keys(sel)
                .filter((k) => sel[k])
                .join(", ");
        }
        return this.state.answers[q.id] || "";
    }

    // The same answers as a {question id: value} map, multi-choice as a list -
    // the shape the contact's health profile is stored in.
    get answerMap() {
        const out = {};
        for (const q of this.props.questions) {
            if (q.type === "multi_choice") {
                const sel = this.state.multi[q.id] || {};
                const picked = Object.keys(sel).filter((k) => sel[k]);
                if (picked.length) {
                    out[q.id] = picked;
                }
            } else if (this.state.answers[q.id]) {
                out[q.id] = this.state.answers[q.id];
            }
        }
        return out;
    }

    isValid() {
        return this.useOnFile || this.props.questions.every((q) => !q.required || this.getValue(q));
    }

    confirm() {
        const parts = this.props.questions.map(
            (q) => `${q.name}: ${this.getValue(q) || "-"}`
        );
        // New or changed answers become the customer's profile.
        if (!this.useOnFile && this.props.saveHealth) {
            this.props.saveHealth(this.answerMap);
        }
        if (this.props.getPayload) {
            this.props.getPayload(parts.join(" | "));
        }
        this.props.close();
    }

    skip() {
        if (this.props.getPayload) {
            this.props.getPayload(false);
        }
        this.props.close();
    }
}
