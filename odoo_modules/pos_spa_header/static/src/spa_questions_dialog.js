import { Component, markup, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class SpaQuestionsDialog extends Component {
    static template = "pos_spa_header.SpaQuestionsDialog";
    static components = { Dialog };
    static props = ["questions", "close", "getPayload?", "disclaimer?"];

    setup() {
        // Two steps in one dialog: the questions, then the therapy's
        // disclaimer. A therapy with no disclaimer text has no second step, so
        // the questions confirm outright and nothing changes for it.
        this.state = useState({ answers: {}, multi: {}, step: "questions" });
        for (const q of this.props.questions) {
            if (q.type === "multi_choice") {
                this.state.multi[q.id] = {};
            }
        }
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

    // Questions answered: move to the disclaimer, or finish when there is none.
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

    isValid() {
        return this.props.questions.every((q) => !q.required || this.getValue(q));
    }

    confirm() {
        const parts = this.props.questions.map(
            (q) => `${q.name}: ${this.getValue(q) || "-"}`
        );
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
