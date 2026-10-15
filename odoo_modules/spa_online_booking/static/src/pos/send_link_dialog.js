import { Component, useState, onWillStart, onMounted } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { phoneError, emailError, resolveMessage } from "@spa_online_booking/pos/phone_country";
import { PhoneField } from "@spa_online_booking/pos/phone_field";

// Branded "Send Booking Link" dialog.
//
// There is exactly ONE booking link for the whole spa: it never changes and
// never expires, so it is fetched and displayed read-only the moment the
// dialog opens - staff can copy or read it out even when no WhatsApp session
// is connected. Staff only pick the sending number and type the customer's
// mobile; the old Contact picker and Customer Name box are gone because the
// customer fills those in on the booking page itself. Sending reports back
// inline on the same screen - there is no second "link ready" popup.
//
// The link can go by WhatsApp, by email, or by both. NEITHER box is required on
// its own - what is required is at least one of them, which is why the number
// no longer carries a red asterisk and the send button renames itself after
// whatever is actually filled in.
export class SendLinkDialog extends Component {
    static template = "spa_online_booking.SendLinkDialog";
    static components = { Dialog, PhoneField };
    static props = ["onGenerate", "close", "companyId?", "loadSessions?", "loadLink?"];

    setup() {
        this.state = useState({
            dialCode: "+968",
            number: "",
            email: "",
            bookingUrl: "",
            // One message per box, painted under the box it belongs to and
            // refreshed as staff type - same idiom as the Book Therapy details
            // step (therapy_screen.js checkField).
            fieldErrors: {},
            // Per channel, so a send that goes out on one and fails on the
            // other can say exactly that rather than one blurred verdict.
            waSent: false,
            waSentTo: "",
            waError: "",
            mailSent: false,
            mailSentTo: "",
            mailError: "",
            busy: false,
            error: "",
            copied: false,
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
    // The country decides how many digits are expected and what the number may
    // open with, so switching it re-judges what is already typed.
    selectCountry(code) {
        this.state.dialCode = code;
        this.checkField("phone");
    }
    onNumberInput(value) {
        this.state.number = value;
        this.checkField("phone");
    }
    sendOnEnter() {
        if (this.canSend) {
            this.send();
        }
    }

    get digits() {
        return (this.state.number || "").replace(/\D/g, "");
    }
    get fullNumber() {
        return this.state.dialCode + this.digits;
    }
    // ---- what has been filled in, and whether it is usable ----------------
    get hasPhone() {
        return this.digits.length > 0;
    }
    get hasEmail() {
        return (this.state.email || "").trim().length > 0;
    }
    // Empty boxes say nothing: neither is required on its own, so an untouched
    // one is not a mistake. Only what has been typed gets judged.
    get phoneMessage() {
        if (!this.hasPhone) {
            return "";
        }
        return resolveMessage(
            phoneError(this.state.dialCode, this.state.number),
            this.state.dialCode
        );
    }
    get emailMessage() {
        return this.hasEmail ? resolveMessage(emailError(this.state.email)) : "";
    }
    get phoneOk() {
        return this.hasPhone && !this.phoneMessage;
    }
    get emailOk() {
        return this.hasEmail && !this.emailMessage;
    }

    // Drives the greyed-out Send button: one usable recipient is enough, but a
    // box that has been filled in WRONGLY blocks the send even when the other
    // one is fine - staff meant to reach both, and half a send looks identical
    // to a whole one once the dialog is closed.
    get canSend() {
        if (this.state.busy) {
            return false;
        }
        if (this.phoneMessage || this.emailMessage) {
            return false;
        }
        return this.phoneOk || this.emailOk;
    }

    // The button says what pressing it will actually do.
    get sendLabel() {
        if (this.state.busy) {
            return "Sending…";
        }
        if (this.phoneOk && this.emailOk) {
            return "Send Both";
        }
        if (this.emailOk && !this.hasPhone) {
            return "Send Email";
        }
        if (this.phoneOk && !this.hasEmail) {
            return "Send WhatsApp";
        }
        // Nothing usable yet, or one box is mid-correction: keep the neutral
        // label rather than flickering between channels on every keystroke.
        return "Send Message";
    }
    get sendIcon() {
        if (this.phoneOk && this.emailOk) {
            return "fa-paper-plane";
        }
        if (this.emailOk && !this.hasPhone) {
            return "fa-envelope";
        }
        return "fa-whatsapp";
    }

    // Re-check one box and repaint its message, on every keystroke.
    checkField(field) {
        const message = field === "email" ? this.emailMessage : this.phoneMessage;
        if (message) {
            this.state.fieldErrors[field] = message;
        } else {
            delete this.state.fieldErrors[field];
        }
    }

    async send() {
        if (!this.canSend) {
            // Say which of the two is at fault. "Enter the mobile number" was
            // the only complaint before, and it is now wrong twice over: the
            // number is optional, and the problem may be the email.
            this.checkField("phone");
            this.checkField("email");
            this.state.error =
                this.phoneMessage ||
                this.emailMessage ||
                "Enter a mobile number, an email address, or both.";
            return;
        }
        const number = this.phoneOk ? this.fullNumber : false;
        const email = this.emailOk ? this.state.email.trim() : false;
        this.state.busy = true;
        this.state.error = "";
        this.state.waSent = false;
        this.state.waError = "";
        this.state.mailSent = false;
        this.state.mailError = "";
        try {
            const res = await this.props.onGenerate({
                whatsapp_number: number,
                email: email,
                session_id: this.state.sessionId || false,
            });
            if (res && res.booking_url) {
                // Same URL as the one already on screen; refreshed anyway so a
                // link created on the very first send still shows up.
                this.state.bookingUrl = res.booking_url;
                if (number) {
                    // `sent` / `send_error` are the older keys, still returned
                    // as aliases - read them so a server that has not been
                    // restarted yet still reports its result properly.
                    const ok = res.whatsapp_sent !== undefined ? res.whatsapp_sent : res.sent;
                    this.state.waSent = !!ok;
                    this.state.waSentTo = number;
                    this.state.waError =
                        res.whatsapp_error ||
                        res.send_error ||
                        (ok ? "" : "WhatsApp did not accept the message - copy the link instead.");
                }
                if (email) {
                    this.state.mailSent = !!res.email_sent;
                    this.state.mailSentTo = email;
                    this.state.mailError =
                        res.email_error ||
                        (res.email_sent
                            ? ""
                            : "The email could not be sent - copy the link instead.");
                }
            } else {
                this.state.error = "Could not send the link. Please try again.";
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
