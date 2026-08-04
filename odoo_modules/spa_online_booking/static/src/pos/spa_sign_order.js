import { patch } from "@web/core/utils/patch";
import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { SpaSignDialog } from "@spa_online_booking/pos/spa_sign_dialog";

// "Sign" on an order card in the POS Orders list. Kept in its own patch (rather
// than in ticket_tabs.js) so the sheet is a self-contained feature: it pulls the
// receipt, its invoice number and the questionnaire the customer answered, shows
// the signature on file or takes a new one, and prints the signed sheet.
patch(TicketScreen.prototype, {
    async spaSignOrder(o) {
        const notify = this.env.services.notification;
        const id = Number(o && o.id);
        // An order that was never synced has no server id, so nothing to read.
        if (!id || id <= 0) {
            notify.add("This order hasn't been synced yet — pay or sync it first.", {
                type: "warning",
            });
            return;
        }
        try {
            const sheet = await this.env.services.orm.call("pos.order", "spa_sign_sheet", [id]);
            this.env.services.dialog.add(SpaSignDialog, {
                sheet,
                companyId: sheet.company_id || this.pos.company?.id,
            });
        } catch (e) {
            console.warn("spa_sign_sheet failed", e);
            notify.add("Could not open the signature sheet for this order.", { type: "danger" });
        }
    },
});
