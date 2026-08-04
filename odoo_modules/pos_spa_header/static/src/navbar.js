import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { renderToElement } from "@web/core/utils/render";
import { formatDateTime } from "@web/core/l10n/dates";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

const { DateTime } = luxon;

patch(Navbar.prototype, {
    // Show the daily Sales Details report in a browser print window instead of
    // sending it to a hardware receipt printer (which this shop doesn't have).
    async showSaleDetails() {
        const saleDetails = await this.pos.data.call(
            "report.point_of_sale.report_saledetails",
            "get_sale_details",
            [false, false, false, [this.pos.session.id]]
        );
        const report = renderToElement(
            "point_of_sale.SaleDetailsReport",
            Object.assign({}, saleDetails, {
                date: formatDateTime(DateTime.now()),
                pos: this.pos,
                formatCurrency: this.pos.env.utils.formatCurrency,
            })
        );
        const win = window.open("", "_blank");
        if (!win) {
            this.notification.add(
                "Please allow pop-ups to view the sales report.",
                { type: "warning" }
            );
            return;
        }
        win.document.write(
            "<html><head><title>Sales Report</title>" +
            "<style>body{font-family:system-ui,sans-serif;padding:20px;}" +
            "table{width:100%;border-collapse:collapse;}td,th{padding:4px 8px;}</style>" +
            "</head><body></body></html>"
        );
        win.document.body.appendChild(report);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 300);
    },

    // Receptionist: create a new spa question straight from the POS header.
    onClickNewQuestion() {
        this.dialog.add(FormViewDialog, {
            resModel: "spa.question",
            resId: false,
            title: "New Question",
        });
    },

    // Receptionist: create a new service (product) from the POS header.
    onClickNewService() {
        this.pos.editProduct();
    },
});
