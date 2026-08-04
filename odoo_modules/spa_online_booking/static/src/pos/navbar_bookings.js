import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { SendLinkDialog } from "@spa_online_booking/pos/send_link_dialog";

patch(Navbar.prototype, {
    // Generate a booking link for a WhatsApp number and send it, from the POS.
    onClickSendLink() {
        this.dialog.add(SendLinkDialog, {
            companyId: this.pos.config.company_id?.id,
            // Which of our WhatsApp numbers sends the link (preselected server
            // side: connected first, so nothing has to be configured).
            loadSessions: async (wake) =>
                await this.pos.data.call("spa.booking.session", "pos_wa_sessions", [
                    wake === true,
                ]),
            // The one shared booking link, read-only: shown as soon as the
            // dialog opens so it can be copied without sending anything.
            loadLink: async () =>
                await this.pos.data.call("spa.booking.session", "pos_booking_link", []),
            onGenerate: async (vals) => {
                return await this.pos.data.call(
                    "spa.booking.session",
                    "pos_create_link",
                    [vals]
                );
            },
        });
    },
});
