import { patch } from "@web/core/utils/patch";
import { OrderSummary } from "@point_of_sale/app/screens/product_screen/order_summary/order_summary";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

// Add a per-line "− qty +" stepper to the cashier order panel so staff can
// nudge a service's quantity up/down by one, instead of retyping the number on
// the numpad (where backspace removes the whole line / empties the order).
patch(OrderSummary.prototype, {
    _stepperTarget(line) {
        // Combo children are driven by their parent line.
        return line.combo_parent_id || line;
    },

    incrementLine(line) {
        const target = this._stepperTarget(line);
        this.pos.selectOrderLine(this.currentOrder, target);
        this.pos.numpadMode = "quantity";
        const result = target.setQuantity(
            target.getQuantity() + 1,
            Boolean(target.combo_line_ids?.length)
        );
        if (result !== true) {
            this.dialog.add(AlertDialog, result);
        }
        this.numberBuffer.reset();
    },

    async decrementLine(line) {
        const target = this._stepperTarget(line);
        this.pos.selectOrderLine(this.currentOrder, target);
        this.pos.numpadMode = "quantity";
        const newQty = target.getQuantity() - 1;
        if (newQty <= 0) {
            // Reaching zero removes the line — same result as backspacing it out.
            this.currentOrder.removeOrderline(target);
        } else {
            // Routes through Odoo's decrease handling (saved quantities, refunds).
            await this.updateQuantityNumber(newQty);
        }
        this.numberBuffer.reset();
    },
});
