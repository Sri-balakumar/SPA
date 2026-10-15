import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";

// One copy of "who may assign, is it mandatory, and who can be assigned",
// shared by the Orders screen, the Redeem dialog and the payment gate. It used
// to be fetched separately by each of them, which meant three round trips and
// three chances for them to disagree about the policy.
patch(PosStore.prototype, {
    async setup(...args) {
        await super.setup(...args);
        // null = not fetched yet. The payment gate treats that as "do not
        // block": a policy we could not confirm must never stop the till.
        this.spaAssignStaff = null;
        this.spaAssignStaffPromise = null;
        // Deliberately not awaited — the POS must open whether or not this
        // call succeeds, and every caller awaits spaLoadAssignStaff() itself.
        this.spaLoadAssignStaff();
    },

    // Cached after the first success. `force` refetches, for after somebody
    // changes the setting without reloading the register.
    async spaLoadAssignStaff(force = false) {
        if (this.spaAssignStaff && !force) {
            return this.spaAssignStaff;
        }
        if (this.spaAssignStaffPromise && !force) {
            return this.spaAssignStaffPromise;
        }
        this.spaAssignStaffPromise = (async () => {
            try {
                const info = await this.data.call("pos.order", "spa_assignable_staff", []);
                this.spaAssignStaff = {
                    can_assign: !!(info && info.can_assign),
                    required: !!(info && info.required),
                    staff: (info && info.staff) || [],
                };
            } catch (e) {
                console.warn("Spa: failed to load the assignable staff", e);
                // Left null on purpose, so the payment gate stays open.
                this.spaAssignStaff = null;
            } finally {
                this.spaAssignStaffPromise = null;
            }
            return this.spaAssignStaff;
        })();
        return this.spaAssignStaffPromise;
    },
});
