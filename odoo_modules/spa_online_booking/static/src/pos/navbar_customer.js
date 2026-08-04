import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { CustomerInfoDialog } from "@spa_online_booking/pos/customer_info_dialog";

// "Customer" button in the POS top bar: look up a customer's full details and
// therapy sessions from the register.
patch(Navbar.prototype, {
    onClickCustomer() {
        this.dialog.add(CustomerInfoDialog, {
            companyId: this.pos.config.company_id?.id,
        });
    },
});
