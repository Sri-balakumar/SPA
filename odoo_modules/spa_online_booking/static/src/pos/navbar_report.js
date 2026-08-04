import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { SalesReportDialog } from "@spa_online_booking/pos/sales_report_dialog";

patch(Navbar.prototype, {
    // Open the Sales Report period picker from the hamburger menu item.
    onClickSalesReport() {
        this.dialog.add(SalesReportDialog, { configId: this.pos.config.id });
    },

    // Point the hamburger's "Print Report" at the same photo-format Sales
    // Report (date picker -> A4 PDF) instead of the built-in session receipt,
    // so whichever item you click gives the report in your layout.
    async showSaleDetails() {
        this.dialog.add(SalesReportDialog, { configId: this.pos.config.id });
    },
});
