import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class SpaQuestionsDialog extends Component {
    static template = "pos_spa_header.SpaQuestionsDialog";
    static components = { Dialog };
    static props = ["questions", "close", "getPayload?"];

    setup() {
        this.state = useState({ answers: {}, multi: {} });
        for (const q of this.props.questions) {
            if (q.type === "multi_choice") {
                this.state.multi[q.id] = {};
            }
        }
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
