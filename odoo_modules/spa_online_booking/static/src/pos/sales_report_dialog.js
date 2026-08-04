import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

const { DateTime } = luxon;

// POS "Sales Report" dialog: pick a period (today / yesterday / this week /
// this month / last week / last month / custom range) and open the PDF report.
export class SalesReportDialog extends Component {
    static template = "spa_online_booking.SalesReportDialog";
    static components = { Dialog };
    static props = ["close", "configId?"];

    setup() {
        const today = DateTime.now().toFormat("yyyy-MM-dd");
        this.state = useState({ from: today, to: today });
    }

    open(from, to, title) {
        const cfg = this.props.configId ? `&config_id=${this.props.configId}` : "";
        const url =
            `/spa/sales_report?date_from=${from}&date_to=${to}` +
            `&title=${encodeURIComponent(title)}${cfg}`;
        window.open(url, "_blank");
        this.props.close();
    }

    today() {
        const d = DateTime.now().toFormat("yyyy-MM-dd");
        this.open(d, d, "DAILY SALE REPORT");
    }
    yesterday() {
        const d = DateTime.now().minus({ days: 1 }).toFormat("yyyy-MM-dd");
        this.open(d, d, "DAILY SALE REPORT");
    }
    thisWeek() {
        const n = DateTime.now();
        this.open(n.startOf("week").toFormat("yyyy-MM-dd"), n.endOf("week").toFormat("yyyy-MM-dd"), "WEEKLY SALE REPORT");
    }
    lastWeek() {
        const n = DateTime.now().minus({ weeks: 1 });
        this.open(n.startOf("week").toFormat("yyyy-MM-dd"), n.endOf("week").toFormat("yyyy-MM-dd"), "WEEKLY SALE REPORT");
    }
    thisMonth() {
        const n = DateTime.now();
        this.open(n.startOf("month").toFormat("yyyy-MM-dd"), n.endOf("month").toFormat("yyyy-MM-dd"), "MONTHLY SALE REPORT");
    }
    lastMonth() {
        const n = DateTime.now().minus({ months: 1 });
        this.open(n.startOf("month").toFormat("yyyy-MM-dd"), n.endOf("month").toFormat("yyyy-MM-dd"), "MONTHLY SALE REPORT");
    }
    custom() {
        if (!this.state.from || !this.state.to) {
            return;
        }
        this.open(this.state.from, this.state.to, "SALE REPORT");
    }
}
