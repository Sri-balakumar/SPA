import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

// Small dialog to set/adjust a booking's appointment date & time, e.g. from the
// customer's preferred-time note. Returns "YYYY-MM-DD HH:MM" via getPayload().
export class SetSlotDialog extends Component {
    static template = "spa_online_booking.SetSlotDialog";
    static components = { Dialog };
    static props = ["current", "note", "close", "getPayload?"];

    setup() {
        // "2026-07-24 00:00:00" -> "2026-07-24T00:00" for <input datetime-local>
        let value = "";
        if (this.props.current) {
            value = this.props.current.slice(0, 16).replace(" ", "T");
        }
        this.state = useState({ value, error: "" });
    }

    confirm() {
        if (!this.state.value) {
            this.state.error = "Please choose a date and time.";
            return;
        }
        if (this.props.getPayload) {
            this.props.getPayload(this.state.value.replace("T", " "));
        }
        this.props.close();
    }
}
