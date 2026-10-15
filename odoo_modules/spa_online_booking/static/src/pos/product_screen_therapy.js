import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { TherapyScreen } from "@spa_online_booking/pos/therapy_screen";

// A reactive flag: true while the full-screen "Book Therapy" booking is open.
patch(PosStore.prototype, {
    setup() {
        super.setup(...arguments);
        this.showTherapyBooking = false;
    },

    /**
     * The brand image shown on the POS screen while the order is empty.
     *
     * The whole decision - Dynamic Invoice Template logo, else the company
     * logo, else nothing - is made on the server and arrives as one string on
     * the company record (res_company.spa_brand_logo_url). Empty means there is
     * nothing to show, and the template's t-if then renders no <img>.
     *
     * It was tried the other way round, and could not be made to work here:
     * /web/image answers an empty field with HTTP 200 and Odoo's grey camera,
     * so the browser cannot tell an empty logo from a real one - which is
     * exactly the placeholder that kept appearing on the till.
     */
    get brandLogoUrl() {
        const company = this.config?.company_id;
        if (!company?.id) {
            return "";
        }
        // A POS that loaded before this field existed keeps its old copy of the
        // company in IndexedDB, which Ctrl+F5 does not clear - so the field can
        // be missing entirely rather than empty. Missing is not the same as
        // "no logo": fall back to the company logo, which is what the navbar
        // shows from the same record. Only an explicit empty string, computed
        // on the server, means there is genuinely nothing to show.
        if (company.spa_brand_logo_url === undefined) {
            return `/web/image/res.company/${company.id}/logo`;
        }
        return company.spa_brand_logo_url || "";
    },
});

// Make TherapyScreen available inside the ProductScreen template.
ProductScreen.components = { ...ProductScreen.components, TherapyScreen };
