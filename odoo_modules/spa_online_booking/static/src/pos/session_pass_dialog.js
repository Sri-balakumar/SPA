import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

// In-POS "Redeem Session" dialog: search a customer -> show their active
// session passes (prepaid packages) -> tap "Use a Session" to redeem one.
// No payment: the package was already paid when it was bought.
export class SessionPassDialog extends Component {
    static template = "spa_online_booking.SessionPassDialog";
    static components = { Dialog };
    static props = ["close", "companyId?"];

    setup() {
        this.orm = this.env.services.orm;
        this.state = useState({
            term: "",
            customers: [],
            searched: false,
            partner: null, // {id, name}
            passes: [],
            loading: false,
            busy: 0, // id of the pass currently being redeemed
            error: "",
            flash: "",
        });
    }

    get logoUrl() {
        return this.props.companyId ? `/web/image/res.company/${this.props.companyId}/logo` : "";
    }

    async searchCustomers() {
        const term = (this.state.term || "").trim();
        if (!term) {
            this.state.error = "Type a customer name or phone number.";
            return;
        }
        this.state.error = "";
        this.state.loading = true;
        try {
            this.state.customers = await this.orm.searchRead(
                "res.partner",
                ["|", "|", ["name", "ilike", term], ["phone", "ilike", term], ["whatsapp", "ilike", term]],
                ["id", "name", "phone", "whatsapp", "date_of_birth", "gender"],
                { limit: 30 }
            );
            this.state.searched = true;
        } catch (e) {
            console.warn("Redeem: customer search failed", e);
            this.state.error = "Could not search customers.";
        } finally {
            this.state.loading = false;
        }
    }

    onSearchKey(ev) {
        if (ev.key === "Enter") {
            this.searchCustomers();
        }
    }

    async selectCustomer(partner) {
        this.state.partner = {
            id: partner.id,
            name: partner.name,
            phone: partner.phone || "",
            whatsapp: partner.whatsapp || "",
            dob: partner.date_of_birth || "",
            gender: partner.gender || "",
        };
        this.state.flash = "";
        await this.loadPasses();
    }

    // Age in whole years from a "YYYY-MM-DD" date string.
    fmtAge(dob) {
        if (!dob) {
            return "";
        }
        const d = new Date(dob);
        if (isNaN(d.getTime())) {
            return "";
        }
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
            age--;
        }
        return age >= 0 && age < 130 ? String(age) : "";
    }
    capGender(g) {
        return g ? g.charAt(0).toUpperCase() + g.slice(1) : "";
    }

    async loadPasses() {
        if (!this.state.partner) {
            return;
        }
        this.state.loading = true;
        try {
            this.state.passes = await this.orm.searchRead(
                "spa.session.pass",
                [["partner_id", "=", this.state.partner.id], ["state", "=", "active"]],
                ["id", "name", "product_tmpl_id", "sessions_total", "sessions_used", "sessions_left"]
            );
        } catch (e) {
            console.warn("Redeem: load passes failed", e);
            this.state.error = "Could not load this customer's passes.";
        } finally {
            this.state.loading = false;
        }
    }

    pkgName(pass) {
        return Array.isArray(pass.product_tmpl_id) ? pass.product_tmpl_id[1] : "Package";
    }

    async useSession(pass) {
        if (this.state.busy) {
            return;
        }
        this.state.busy = pass.id;
        this.state.error = "";
        this.state.flash = "";
        try {
            // Send the session to reception for approval (Orders -> Sessions ->
            // Pending). It's counted only when marked Done, like the tablet.
            const res = await this.orm.call("spa.session.pass", "pos_redeem_session", [[pass.id]]);
            if (res && res.error === "no_sessions_left") {
                this.state.error = "No sessions left on this package.";
            } else if (res && res.error) {
                this.state.error = "Could not redeem the session.";
            } else {
                this.state.flash =
                    `Session sent to Orders → Sessions for approval (${this.pkgName(pass)}).`;
                await this.loadPasses();
            }
        } catch (e) {
            console.warn("Redeem: use session failed", e);
            this.state.error = "Could not redeem the session.";
        } finally {
            this.state.busy = 0;
        }
    }

    changeCustomer() {
        this.state.partner = null;
        this.state.passes = [];
        this.state.flash = "";
        this.state.error = "";
    }
}
