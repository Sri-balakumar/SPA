import { Component, useState } from "@odoo/owl";
import { COUNTRIES, phoneExample } from "@spa_online_booking/pos/phone_country";

// The country picker + number box, as ONE component.
//
// The same markup had been copied into three screens (Send Booking Link, the
// Book Therapy details step twice over, and the Book Therapy dialog), which is
// three places to fix when the picker changes and three chances for the till to
// disagree with itself. The RULES were already shared - spa_validation.js by way
// of phone_country.js - this puts the widget on the same footing.
//
// Deliberately dumb: it owns nothing but whether its own dropdown is open. The
// dial code and the digits live in the parent's state, because the parent is
// what joins them into E.164 and what decides when to re-check them. `error` is
// an already-resolved sentence, not a code - the caller knows whether the box is
// required and which message table it reads.
export class PhoneField extends Component {
    static template = "spa_online_booking.PhoneField";
    static props = {
        dialCode: String,
        value: String,
        // "" when the box is fine. Painted by the parent under the field.
        error: { type: String, optional: true },
        onDialCode: Function,
        onInput: Function,
        // Send Booking Link submits on Enter; the other screens have no single
        // obvious action to fire, so they leave this out.
        onEnter: { type: Function, optional: true },
    };

    setup() {
        this.countries = COUNTRIES;
        // Per instance, which is the point: the phone and WhatsApp pickers on
        // the Book Therapy screen used to share the parent's state and both
        // menus opened together.
        this.state = useState({ ccOpen: false });
    }

    get selectedCountry() {
        return this.countries.find((c) => c.code === this.props.dialCode) || this.countries[0];
    }

    // A real number from the chosen country, so the shape being asked for is
    // visible before anything is typed.
    get placeholder() {
        return phoneExample(this.props.dialCode);
    }

    get inputClass() {
        return this.props.error ? "sl-number tp-bad" : "sl-number";
    }

    pick(code) {
        this.state.ccOpen = false;
        // The country decides how many digits are expected and what the number
        // may open with, so the parent re-judges what is already typed.
        this.props.onDialCode(code);
    }

    onInput(ev) {
        this.props.onInput(ev.target.value);
    }

    onKeyup(ev) {
        if (ev.key === "Enter" && this.props.onEnter) {
            this.props.onEnter();
        }
    }
}
