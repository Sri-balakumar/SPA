import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

const { DateTime } = luxon;

// POS "Sales Report" dialog: pick a period (today / yesterday / this week /
// this month / last week / last month / custom range) and open the PDF report.
export class SalesReportDialog extends Component {
    static template = "spa_online_booking.SalesReportDialog";
    static components = { Dialog };
    static props = ["close", "configId?"];

    setup() {
        this.pos = usePos();
        const today = this.now().toFormat("yyyy-MM-dd");
        this.state = useState({ from: today, to: today });
    }

    // "Now" on the COMPANY's clock, from its country (res_company
    // .spa_display_tz). Without it, "Today" pressed at 11 PM in Muscat asks for
    // the next day's report, because the browser running the till is in India.
    // Falls back to the browser zone when the field is missing (a POS that
    // loaded before it existed keeps the old company copy in IndexedDB).
    now() {
        const tz = this.pos?.config?.company_id?.spa_display_tz;
        const n = DateTime.now();
        if (!tz) {
            return n;
        }
        const zoned = n.setZone(tz);
        return zoned.isValid ? zoned : n;
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
        const d = this.now().toFormat("yyyy-MM-dd");
        this.open(d, d, "DAILY SALE REPORT");
    }
    yesterday() {
        const d = this.now().minus({ days: 1 }).toFormat("yyyy-MM-dd");
        this.open(d, d, "DAILY SALE REPORT");
    }
    thisWeek() {
        const n = this.now();
        this.open(n.startOf("week").toFormat("yyyy-MM-dd"), n.endOf("week").toFormat("yyyy-MM-dd"), "WEEKLY SALE REPORT");
    }
    lastWeek() {
        const n = this.now().minus({ weeks: 1 });
        this.open(n.startOf("week").toFormat("yyyy-MM-dd"), n.endOf("week").toFormat("yyyy-MM-dd"), "WEEKLY SALE REPORT");
    }
    thisMonth() {
        const n = this.now();
        this.open(n.startOf("month").toFormat("yyyy-MM-dd"), n.endOf("month").toFormat("yyyy-MM-dd"), "MONTHLY SALE REPORT");
    }
    lastMonth() {
        const n = this.now().minus({ months: 1 });
        this.open(n.startOf("month").toFormat("yyyy-MM-dd"), n.endOf("month").toFormat("yyyy-MM-dd"), "MONTHLY SALE REPORT");
    }
    custom() {
        if (!this.state.from || !this.state.to) {
            return;
        }
        this.open(this.state.from, this.state.to, "SALE REPORT");
    }
}
