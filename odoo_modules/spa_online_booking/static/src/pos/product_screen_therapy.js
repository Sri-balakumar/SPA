import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { TherapyScreen } from "@spa_online_booking/pos/therapy_screen";

// A reactive flag: true while the full-screen "Book Therapy" booking is open.
patch(PosStore.prototype, {
    setup() {
        super.setup(...arguments);
        this.showTherapyBooking = false;
        // Brand logo shown in the POS. Pulled dynamically from the Dynamic
        // Invoice Template config ("Invoice Template Settings" -> Invoice Logo)
        // so it's configurable there, with fallbacks to the company logo, then
        // the bundled image. Starts on the bundled image; updates once fetched.
        this.brandLogoUrl = "/spa_online_booking/static/img/stretchandgo_logo.png";
        this._loadBrandLogo();
    },

    async _loadBrandLogo() {
        try {
            const companyId = this.config?.company_id?.id;
            const domain = companyId ? [["company_id", "=", companyId]] : [];
            const rows = await this.env.services.orm.searchRead(
                "invoice.template.config",
                domain,
                ["id", "company_logo"],
                { limit: 1 }
            );
            if (rows.length && rows[0].company_logo) {
                this.brandLogoUrl = `/web/image/invoice.template.config/${rows[0].id}/company_logo`;
            } else if (companyId) {
                this.brandLogoUrl = `/web/image/res.company/${companyId}/logo`;
            }
        } catch {
            // invoice.template.config missing / no access -> keep the fallback.
        }
    },
});

// Make TherapyScreen available inside the ProductScreen template.
ProductScreen.components = { ...ProductScreen.components, TherapyScreen };
