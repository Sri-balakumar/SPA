import { Component, useState, onWillStart, onMounted } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { COUNTRIES } from "@spa_online_booking/pos/phone_country";

// Branded "Send Booking Link" dialog.
//
// There is exactly ONE booking link for the whole spa: it never changes and
// never expires, so it is fetched and displayed read-only the moment the
// dialog opens - staff can copy or read it out even when no WhatsApp session
// is connected. Staff only pick the sending number and type the customer's
// mobile; the old Contact picker and Customer Name box are gone because the
// customer fills those in on the booking page itself. Sending reports back
// inline on the same screen - there is no second "link ready" popup.
export class SendLinkDialog extends Component {
    static template = "spa_online_booking.SendLinkDialog";
    static components = { Dialog };
    static props = ["onGenerate", "close", "companyId?", "loadSessions?", "loadLink?"];

    setup() {
        this.countries = COUNTRIES;
        this.state = useState({
            dialCode: "+968",
            number: "",
            bookingUrl: "",
            sent: false,
            sentTo: "",
            sendError: "",
            busy: false,
            error: "",
            copied: false,
            ccOpen: false,
            // Which of our WhatsApp numbers sends this link. Preselected by the
            // server (connected one first), changeable when there are several.
            sessions: [],
            sessionId: false,
            // A session whose owner died - typically the first minutes after a
            // server restart - is reopened on demand; `waking` drives the
            // "Reconnecting WhatsApp..." line while that happens.
            waking: false,
            canWake: false,
            anyConnected: false,
        });
        onWillStart(async () => {
            await Promise.all([this.loadSessions(), this.loadLink()]);
        });
        // Paint first, heal after. Reopening a session takes a dozen seconds or
        // so, and onWillStart blocks rendering - waiting for it there would
        // leave staff looking at an empty dialog.
        onMounted(() => {
            if (!this.state.anyConnected && this.state.canWake) {
                this.reconnect();
            }
        });
    }

    async loadSessions(wake = false) {
        if (!this.props.loadSessions) {
            return false;
        }
        try {
            const res = await this.props.loadSessions(wake);
            this.state.sessions = (res && res.sessions) || [];
            this.state.sessionId = (res && res.default_id) || false;
            this.state.canWake = !!(res && res.can_wake);
            this.state.anyConnected = !!(res && res.any_connected);
            return this.state.anyConnected;
        } catch (e) {
            console.warn("Spa send link: could not load WhatsApp sessions", e);
            return false;
        }
    }

    // Opening the dialog is exactly when staff need a sender, so when nothing
    // is live we reopen the session (see _wake_wa_session) instead of leaving
    // them with a dead "(not connected)" label and a Send that fails.
    async reconnect() {
        if (this.state.waking) {
            return;
        }
        this.state.waking = true;
        try {
            await this.loadSessions(true);
        } finally {
            this.state.waking = false;
        }
    }

    // Read-only fetch of the shared link: nothing is sent and no new session
    // is minted, so opening the dialog is free of side effects for the customer.
    async loadLink() {
        if (!this.props.loadLink) {
            return;
        }
        try {
            const res = await this.props.loadLink();
            this.state.bookingUrl = (res && res.booking_url) || "";
        } catch (e) {
            console.warn("Spa send link: could not load the booking link", e);
        }
    }

    get selectedSession() {
        return this.state.sessions.find((s) => s.id === this.state.sessionId) || null;
    }
    sessionLabel(s) {
        return s.connected ? s.name : `${s.name} (not connected)`;
    }
    onSessionChange(ev) {
        this.state.sessionId = parseInt(ev.target.value, 10) || false;
    }

    get logoUrl() {
        return this.props.companyId ? `/web/image/res.company/${this.props.companyId}/logo` : "";
    }
    get selectedCountry() {
        return this.countries.find((c) => c.code === this.state.dialCode) || this.countries[0];
    }
    selectCountry(code) {
        this.state.dialCode = code;
        this.state.ccOpen = false;
    }

    get digits() {
        return (this.state.number || "").replace(/\D/g, "");
    }
    get fullNumber() {
        return this.state.dialCode + this.digits;
    }
    // Drives the greyed-out Send button.
    get canSend() {
        return !this.state.busy && this.digits.length > 0;
    }

    async send() {
        if (!this.canSend) {
            this.state.error = "Enter the customer's mobile number.";
            return;
        }
        this.state.busy = true;
        this.state.error = "";
        this.state.sent = false;
        this.state.sendError = "";
        try {
            const res = await this.props.onGenerate({
                whatsapp_number: this.fullNumber,
                session_id: this.state.sessionId || false,
            });
            if (res && res.booking_url) {
                // Same URL as the one already on screen; refreshed anyway so a
                // link created on the very first send still shows up.
                this.state.bookingUrl = res.booking_url;
                this.state.sent = !!res.sent;
                this.state.sentTo = this.fullNumber;
                this.state.sendError =
                    res.send_error ||
                    (res.sent ? "" : "WhatsApp did not accept the message - copy the link instead.");
            } else {
                this.state.error =
                    "Could not send the link. Check the number includes a country code.";
            }
        } catch (e) {
            console.warn("Spa send link: failed", e);
            this.state.error = "Could not send the link.";
        } finally {
            this.state.busy = false;
        }
    }

    async copyLink() {
        if (!this.state.bookingUrl) {
            return;
        }
        try {
            await navigator.clipboard.writeText(this.state.bookingUrl);
            this.state.copied = true;
        } catch {
            // Clipboard is blocked on insecure origins; fall back to selecting
            // the field so staff can copy it with the keyboard.
            const box = document.querySelector(".sl-link-box");
            if (box) {
                box.focus();
                box.select();
            }
            this.state.copied = false;
        }
    }
}
