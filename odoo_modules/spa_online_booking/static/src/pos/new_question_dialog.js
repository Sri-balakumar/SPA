import { Component, useState, onWillStart } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

// Sentinel for the "type a brand new one" entry of the heading dropdown.
const NEW_HEADING = "new";

// Stretch & Go branded "New Question" dialog (replaces the plain form dialog).
// Creates a spa.question tied to a THERAPY (pos.category), so it applies to
// every package under that therapy.
export class NewQuestionDialog extends Component {
    static template = "spa_online_booking.NewQuestionDialog";
    static components = { Dialog };
    static props = ["close", "orm", "companyId?", "onSaved?"];

    setup() {
        this.state = useState({
            name: "",
            headingId: null,
            newHeading: "",
            headingOpen: false,
            questionType: "text",
            required: true,
            active: true,
            therapyId: null,
            options: [],
            therapies: [],
            typeOpen: false,
            therapyOpen: false,
            busy: false,
            error: "",
        });
        onWillStart(async () => {
            try {
                const res = await fetch("/api/spa/therapies").then((r) => r.json());
                this.state.therapies = (res.therapies || []).map((t) => ({
                    id: t.id,
                    name: t.duration_min ? `${t.name} (${t.duration_min} min)` : t.name,
                    // Sections already defined on this therapy, in their order.
                    headings: t.headings || [],
                }));
            } catch (e) {
                this.state.therapies = [];
            }
        });
    }

    get logoUrl() {
        return this.props.companyId ? `/web/image/res.company/${this.props.companyId}/logo` : "";
    }
    get typeOptions() {
        return [
            { value: "text", label: "Free Text" },
            { value: "yes_no", label: "Yes / No" },
            { value: "single_choice", label: "Single Choice" },
            { value: "multi_choice", label: "Multiple Choice" },
        ];
    }
    get typeLabel() {
        const o = this.typeOptions.find((x) => x.value === this.state.questionType);
        return o ? o.label : "";
    }
    get isChoice() {
        return ["single_choice", "multi_choice"].includes(this.state.questionType);
    }
    get therapyLabel() {
        const t = this.state.therapies.find((x) => x.id === this.state.therapyId);
        return t ? t.name : "";
    }
    get headingOptions() {
        const t = this.state.therapies.find((x) => x.id === this.state.therapyId);
        return t ? t.headings : [];
    }
    get headingLabel() {
        if (this.state.headingId === NEW_HEADING) {
            return "New heading…";
        }
        const h = this.headingOptions.find((x) => x.id === this.state.headingId);
        return h ? h.name : "";
    }
    get isNewHeading() {
        return this.state.headingId === NEW_HEADING;
    }

    selectType(v) {
        this.state.questionType = v;
        this.state.typeOpen = false;
    }
    selectTherapy(id) {
        this.state.therapyId = id;
        this.state.therapyOpen = false;
        // Headings belong to a therapy, so a pick made under the old one is
        // meaningless now.
        this.state.headingId = null;
        this.state.newHeading = "";
    }
    selectHeading(id) {
        this.state.headingId = id;
        this.state.headingOpen = false;
    }
    addOption() {
        this.state.options.push("");
    }
    setOption(i, v) {
        this.state.options[i] = v;
    }
    removeOption(i) {
        this.state.options.splice(i, 1);
    }

    async save() {
        this.state.error = "";
        if (!this.state.name.trim()) {
            this.state.error = "Please enter the question.";
            return;
        }
        if (!this.state.therapyId) {
            this.state.error = "Please select a therapy.";
            return;
        }
        this.state.busy = true;
        try {
            // A brand new section has to exist as a record before the question
            // can point at it - a Many2one takes an id, not a create command.
            let headingId = this.state.headingId;
            if (headingId === NEW_HEADING) {
                const name = this.state.newHeading.trim();
                if (!name) {
                    this.state.error = "Please name the new heading.";
                    this.state.busy = false;
                    return;
                }
                const created = await this.props.orm.create("spa.question.heading", [
                    { name: name, pos_category_id: this.state.therapyId },
                ]);
                headingId = created[0];
            }
            const vals = {
                name: this.state.name.trim(),
                heading_id: headingId || false,
                question_type: this.state.questionType,
                required: this.state.required,
                pos_category_id: this.state.therapyId,
                active: this.state.active,
            };
            if (this.isChoice) {
                const opts = this.state.options.map((o) => o.trim()).filter(Boolean);
                vals.option_ids = opts.map((o) => [0, 0, { name: o }]);
            }
            await this.props.orm.create("spa.question", [vals]);
            if (this.props.onSaved) {
                this.props.onSaved();
            }
            this.props.close();
        } catch (e) {
            this.state.error = "Could not save the question. Please try again.";
            this.state.busy = false;
        }
    }
}
