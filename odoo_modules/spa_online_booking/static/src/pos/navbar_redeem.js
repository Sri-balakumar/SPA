import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { SessionPassDialog } from "@spa_online_booking/pos/session_pass_dialog";

// "Redeem" button in the POS top bar: open the Redeem Session dialog to use a
// customer's prepaid package session, right from the cashier screen.
patch(Navbar.prototype, {
    onClickRedeem() {
        this.dialog.add(SessionPassDialog, {
            companyId: this.pos.config.company_id?.id,
        });
    },
});
