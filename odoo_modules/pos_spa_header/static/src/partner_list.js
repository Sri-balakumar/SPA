import { patch } from "@web/core/utils/patch";
import { PartnerList } from "@point_of_sale/app/screens/partner_list/partner_list";

// Show customers newest-first (by id, i.e. most recently created) instead of
// alphabetically. The currently selected customer stays pinned to the top.
patch(PartnerList.prototype, {
    getPartners(partners) {
        const result = super.getPartners(partners);
        const selectedId = this.props.partner?.id;
        return [...result].sort((a, b) => {
            if (a.id === selectedId) {
                return -1;
            }
            if (b.id === selectedId) {
                return 1;
            }
            return b.id - a.id;
        });
    },
});
