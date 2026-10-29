import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";

// "Invoice every order automatically" (pos.config.spa_auto_invoice).
//
// createNewOrder is the one place every new order is born, so ticking Invoice
// here covers the New Order button, Book Therapy and the order after payment
// alike. Nothing else is needed to make the customer compulsory: core refuses
// to pay a to-invoice order without one ("Please select the Customer",
// point_of_sale utils/order_payment_validation.js). The cashier can still
// untick Invoice on the payment screen for a deliberate exception.
patch(PosStore.prototype, {
    createNewOrder(data = {}) {
        const order = super.createNewOrder(...arguments);
        // A caller that decided for itself (a refund follows the original
        // order) is left alone.
        if (this.config.spa_auto_invoice && data.to_invoice === undefined && order) {
            order.to_invoice = true;
        }
        return order;
    },
});
