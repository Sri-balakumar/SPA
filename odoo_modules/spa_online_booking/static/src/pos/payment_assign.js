import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { SpaAssignDialog } from "@spa_online_booking/pos/spa_assign_dialog";

// "Assignee mandatory" (Settings -> Spa Online Booking -> Session Assignee):
// an order cannot be validated until every SESSION on it names who is giving
// it. Enforced here, at the till, and deliberately NOT on the server:
// _process_order runs after the customer has already paid, so refusing there
// would reject a paid order rather than prevent a mistake.
patch(PaymentScreen.prototype, {
    // The lines that are sessions. `pos_categ_ids` rides along with every
    // product, and pos.category now carries `spa_is_therapy` (see
    // pos_category_therapy.py), so a bottle of water never asks for a
    // therapist while a package and a single session both do.
    spaSessionLines(order) {
        return (order.lines || []).filter((line) => {
            const product = line.product_id;
            const tmpl = (product && product.product_tmpl_id) || product;
            const cats = (tmpl && tmpl.pos_categ_ids) || [];
            return cats.some((cat) => cat.spa_is_therapy);
        });
    },

    // What has been picked so far for this order, as { lineUuid: userId }.
    // Parked on the order as JSON because a POS line has no database id until
    // the order syncs — pos.order._spa_store_assignees_payload drains it.
    spaParkedAssignees(order) {
        try {
            return JSON.parse(order.spa_assignees_json || "{}") || {};
        } catch {
            return {};
        }
    },

    async validateOrder(isForceValidate = false) {
        const order = this.currentOrder;
        if (await this.spaEnsureAssignees(order)) {
            await super.validateOrder(isForceValidate);
        }
    },

    // Returns true when the order may go through. Pops the picker when
    // something is missing and the user is allowed to fill it in.
    async spaEnsureAssignees(order) {
        // Cached on the store after the first fetch (pos_store_assign.js). If
        // it never arrived — offline, or the call failed — it is null and we
        // do NOT block the till over a policy we cannot confirm.
        const staff = await this.pos.spaLoadAssignStaff();
        if (!staff || !staff.required) {
            return true;
        }
        const lines = this.spaSessionLines(order);
        if (!lines.length) {
            return true;
        }
        let picked = this.spaParkedAssignees(order);
        const missing = () => lines.filter((line) => !picked[line.uuid]);
        if (!missing().length) {
            return true;
        }
        if (!staff.can_assign) {
            this.env.services.notification.add(
                "Every session on this order needs an assignee before it can " +
                    "be paid, and only Spa Reception or an administrator can " +
                    "set one.",
                { type: "danger" }
            );
            return false;
        }
        const payload = await makeAwaitable(this.dialog, SpaAssignDialog, {
            rows: lines.map((line) => ({
                line_id: line.uuid,
                product: line.getFullProductName?.() || line.full_product_name || "",
                user_id: picked[line.uuid] || false,
            })),
            staff: staff.staff || [],
            title: "Who is giving these sessions?",
        });
        if (!payload) {
            return false; // cancelled — leave the order unpaid, nothing lost
        }
        picked = { ...picked, ...payload };
        // Keep only real picks: a false would park "unassigned" as if it were
        // an answer and the check below would still have to reject it.
        for (const key of Object.keys(picked)) {
            if (!picked[key]) {
                delete picked[key];
            }
        }
        order.spa_assignees_json = JSON.stringify(picked);
        const still = missing();
        if (still.length) {
            this.env.services.notification.add(
                `${still.length} session(s) still have no assignee.`,
                { type: "warning" }
            );
            return false;
        }
        return true;
    },
});
