import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

// "Who performed this?" — one picker per session on the order. Returns
// { [lineId]: userId|false } via getPayload(); the caller writes it through
// pos.order.spa_set_assignees, which re-checks the group server side.
export class SpaAssignDialog extends Component {
    static template = "spa_online_booking.SpaAssignDialog";
    static components = { Dialog };
    // `rows` is what pos.order.spa_assignees() returned for this order, `staff`
    // what spa_assignable_staff() returned.
    static props = ["rows", "staff", "title?", "close", "getPayload?"];

    setup() {
        // { lineId: userId }, 0 meaning unassigned. NUMBERS, not the strings a
        // <select> hands back: the template marks the chosen option with
        // `state.chosen[...] === user.id`, and OWL has no `String` in its
        // template scope (RESERVED_WORDS in owl.js) to convert the other way.
        const chosen = {};
        for (const row of this.props.rows) {
            chosen[row.line_id] = row.user_id || 0;
        }
        this.state = useState({ chosen });
    }

    get title() {
        return this.props.title || "Assign Sessions";
    }

    onPick(lineId, ev) {
        this.state.chosen[lineId] = parseInt(ev.target.value, 10) || 0;
    }

    confirm() {
        if (this.props.getPayload) {
            const payload = {};
            for (const [lineId, userId] of Object.entries(this.state.chosen)) {
                // false, not 0: the server writes it straight onto the many2one,
                // where 0 is not a valid id and false is "clear it".
                payload[lineId] = userId || false;
            }
            this.props.getPayload(payload);
        }
        this.props.close();
    }
}
