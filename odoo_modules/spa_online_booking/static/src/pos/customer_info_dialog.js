import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { SpaSignDialog } from "@spa_online_booking/pos/spa_sign_dialog";
import { sigDataUrl } from "@spa_online_booking/pos/spa_signature";

// In-POS "Customer" lookup: search a customer by name / phone / WhatsApp and
// view their full profile (age, gender, DOB, phone, WhatsApp) plus every
// therapy package they hold and the sessions taken/remaining. Read-only.
//
// Each package row drills down two ways:
//   Q&A      -> the questionnaire the customer answered for THAT service
//   Reports  -> the full picture for THAT service: invoice/receipt number,
//               amount paid, amount still due, and every session with its
//               status (completed / scheduled / not taken).
export class CustomerInfoDialog extends Component {
    static template = "spa_online_booking.CustomerInfoDialog";
    static components = { Dialog };
    static props = ["close", "companyId?"];

    setup() {
        this.orm = this.env.services.orm;
        this.state = useState({
            // 'search' -> 'profile' -> 'qa' | 'report'
            view: "search",
            term: "",
            customers: [],
            searched: false,
            partner: null,
            passes: [],
            singles: [],
            focus: null,
            qa: null,
            report: null,
            loading: false,
            error: "",
        });
    }

    get logoUrl() {
        return this.props.companyId ? `/web/image/res.company/${this.props.companyId}/logo` : "";
    }

    async search() {
        const term = (this.state.term || "").trim();
        if (!term) {
            this.state.error = "Type a customer name or number.";
            return;
        }
        this.state.error = "";
        this.state.loading = true;
        try {
            this.state.customers = await this.orm.searchRead(
                "res.partner",
                ["|", "|", ["name", "ilike", term], ["phone", "ilike", term], ["whatsapp", "ilike", term]],
                ["id", "name", "phone", "whatsapp", "date_of_birth", "gender"],
                { limit: 30 }
            );
            this.state.searched = true;
        } catch (e) {
            console.warn("Customer lookup failed", e);
            this.state.error = "Could not search customers.";
        } finally {
            this.state.loading = false;
        }
    }

    onKey(ev) {
        if (ev.key === "Enter") {
            this.search();
        }
    }

    async select(c) {
        this.state.partner = {
            id: c.id,
            name: c.name,
            phone: c.phone || "",
            whatsapp: c.whatsapp || "",
            dob: c.date_of_birth || "",
            gender: c.gender || "",
        };
        this.state.view = "profile";
        await this.loadPasses();
    }

    async loadPasses() {
        this.state.loading = true;
        const partnerId = this.state.partner.id;
        try {
            // Packages (a pass each) and one-off sessions (no pass exists for a
            // single session, so they come from their receipt / booking).
            const [passes, singles] = await Promise.all([
                this.orm.searchRead(
                    "spa.session.pass",
                    [["partner_id", "=", partnerId]],
                    ["id", "name", "product_tmpl_id", "sessions_total", "sessions_used", "sessions_left", "state"],
                    { order: "create_date desc" }
                ),
                this.orm.call("spa.session.pass", "pos_customer_singles", [partnerId]),
            ]);
            this.state.passes = passes;
            this.state.singles = singles;
        } catch (e) {
            console.warn("Customer history load failed", e);
            this.state.passes = [];
            this.state.singles = [];
        } finally {
            this.state.loading = false;
        }
    }

    // ---- per-service drill-downs ---------------------------------------
    openAnswers(p) {
        return this._drill("pos_pass_answers", [[p.id]], "qa");
    }

    openReport(p) {
        return this._drill("pos_pass_report", [[p.id]], "report");
    }

    // Same two views for a one-off session, keyed on its receipt / booking
    // instead of a pass id.
    _singleArgs(s) {
        return [
            s.tmpl_id,
            this.state.partner.id,
            s.order_id || false,
            s.booking_id || false,
            s.line_id || false,
        ];
    }

    openSingleAnswers(s) {
        return this._drill("pos_single_answers", this._singleArgs(s), "qa");
    }

    openSingleReport(s) {
        return this._drill("pos_single_report", this._singleArgs(s), "report");
    }

    async _drill(method, args, view) {
        this.state.error = "";
        this.state.loading = true;
        try {
            this.state[view] = await this.orm.call("spa.session.pass", method, args);
            this.state.view = view;
        } catch (e) {
            console.warn(`${method} failed`, e);
            this.state.error = "Could not load this service's details.";
        } finally {
            this.state.loading = false;
        }
    }

    // "Sign" on the Questions & Answers view: the same questionnaire, plus the
    // receipt and invoice number it belongs to, signed by the customer and
    // printed.
    //
    // The signature comes off the VISITS, not off the contact: a signature is
    // consent to one service, and res.partner.spa_signature is retired - it
    // was still being read here, which is why the sheet printed a blank box.
    // The most recent visit that was signed heads the sheet.
    openSign() {
        const p = this.state.partner;
        const groups = (this.state.qa && this.state.qa.groups) || [];
        this.state.error = "";
        const signature = (groups.find((g) => g.signature) || {}).signature || "";
        const refs = [...new Set(groups.map((g) => g.booking).filter(Boolean))];
        const invoices = [...new Set(groups.map((g) => g.invoice).filter(Boolean))];
        this.env.services.dialog.add(SpaSignDialog, {
            companyId: this.props.companyId,
            sheet: {
                title: (this.state.qa && this.state.qa.package) || "",
                customer: p.name || "",
                partner_id: p.id,
                phone: p.phone || "",
                dob: p.dob || "",
                gender: this.capGender(p.gender),
                order_ref: refs.join(", "),
                invoice: invoices.join(", "),
                date: groups.length ? groups[0].date || "" : "",
                currency: "",
                amount_total: 0,
                services: [],
                groups: groups.map((g) => ({
                    service: (g.services || []).join(", "),
                    ref: g.booking || "",
                    invoice: g.invoice || "",
                    date: g.date || "",
                    rows: g.rows || [],
                    signature: g.signature || "",
                })),
                signature,
            },
        });
    }

    // The ORM hands back a bare base64 payload with no MIME type; sigDataUrl
    // sniffs it, because an <img> with the wrong data: type is refused.
    sigSrc(b64) {
        return sigDataUrl(b64);
    }

    get hasHistory() {
        return this.state.passes.length > 0 || this.state.singles.length > 0;
    }

    backToProfile() {
        this.state.view = "profile";
        this.state.qa = null;
        this.state.report = null;
        this.state.focus = null;
        this.state.error = "";
    }

    back() {
        this.state.view = "search";
        this.state.partner = null;
        this.state.passes = [];
        this.state.singles = [];
        this.state.qa = null;
        this.state.report = null;
        this.state.focus = null;
    }

    get rep() {
        return this.state.report || {};
    }

    money(v) {
        const cur = this.rep.currency || "";
        const n = (v || 0).toFixed(2);
        return cur ? `${cur} ${n}` : n;
    }

    esc(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // Print the report on its own, without the POS chrome: render it into a
    // hidden iframe and print that (window.print() would print the whole POS,
    // and window.open is blocked in kiosk mode).
    printReport() {
        const r = this.rep;
        const e = (v) => this.esc(v);
        const m = (v) => this.esc(this.money(v));
        const rows = (list, cells) => (list || []).map((x) => `<tr>${cells(x)}</tr>`).join("");
        const html = `<html><head><meta charset="utf-8"/>
<title>${e(r.package)} - ${e(r.customer)}</title>
<style>
 body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 18px; }
 h1 { font-size: 16px; margin: 0 0 2px; }
 h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
 .muted { color: #666; }
 table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
 th, td { border-bottom: 1px solid #e2e2e2; padding: 5px 6px; text-align: left; }
 th { background: #f4f4f4; }
 .r { text-align: right; }
 .tot td { font-weight: bold; border-top: 1px solid #999; }
 .meta td { border: 0; padding: 2px 6px; }
 .sig { margin: 6px 0 18px; page-break-inside: avoid; }
 .sig-l { font-size: 10px; color: #666; margin-bottom: 4px; }
 .sig-i { max-width: 260px; max-height: 90px; border: 1px solid #ddd; padding: 4px; }
 .sig-n { font-size: 11px; color: #999; font-style: italic; }
</style></head><body>
<h1>${e(r.package)}</h1>
<div class="muted">${e(r.customer)} &middot; ${e(r.pass_name)} &middot; ${e(r.state_label)}</div>
<table class="meta">
 <tr><td class="muted">Purchased</td><td>${e(r.purchase_date || "-")}</td>
     <td class="muted">Bought via</td><td>${e(r.channel_label || "-")}</td></tr>
 <tr><td class="muted">Invoice No</td><td>${e((r.invoices || []).join(", ") || "-")}</td>
     <td class="muted">Sessions</td><td>${e(r.sessions_used)} of ${e(r.sessions_total)} taken, ${e(r.sessions_left)} remaining</td></tr>
 <tr><td class="muted">${r.single ? "Receipt total" : "Billed"}</td><td>${m(r.amount_total)}</td>
     <td class="muted">Paid / Due</td><td>${m(r.amount_paid)} / <b>${m(r.amount_due)}</b></td></tr>
</table>
<h2>Invoices &amp; Receipts</h2>
<table>
 <thead><tr><th>Receipt</th><th>Invoice</th><th>Date</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Due</th></tr></thead>
 <tbody>
  ${rows(r.documents, (d) => `<td>${e(d.receipt || d.order_ref)}</td><td>${e(d.invoice || "-")}</td><td>${e(d.date)}</td><td class="r">${m(d.total)}</td><td class="r">${m(d.paid)}</td><td class="r">${m(d.due)}</td>`)}
  <tr class="tot"><td colspan="3">Total</td><td class="r">${m(r.amount_total)}</td><td class="r">${m(r.amount_paid)}</td><td class="r">${m(r.amount_due)}</td></tr>
 </tbody>
</table>
<h2>Sessions &mdash; ${e(r.sessions_used)} of ${e(r.sessions_total)} taken</h2>
<table>
 <thead><tr><th>#</th><th>Date</th><th>Status</th><th>Note</th><th class="r">Value</th></tr></thead>
 <tbody>${rows(r.sessions, (s) => `<td>${e(s.no)}</td><td>${e(s.date || "-")}</td><td>${e(s.status_label)}</td><td>${e(s.note)}</td><td class="r">${m(s.value)}</td>`)}</tbody>
</table>
${(r.payments || []).length ? `<h2>Payments</h2><table>
 <thead><tr><th>Receipt</th><th>Method</th><th>Date</th><th class="r">Amount</th></tr></thead>
 <tbody>${rows(r.payments, (p) => `<td>${e(p.receipt)}</td><td>${e(p.method)}${p.is_change ? " (change)" : ""}</td><td>${e(p.date)}</td><td class="r">${m(p.amount)}</td>`)}</tbody>
</table>` : ""}
${(r.answers || []).length ? `<h2>Questions &amp; Answers</h2>${r.answers.map((g) => `<div class="muted">${e(g.booking)} &middot; ${e(g.date)} &middot; ${g.from_receipt ? "receipt" : "booking"}${g.terms_accepted ? " &middot; terms accepted" : ""}</div><table><tbody>${rows(g.rows, (q) => `<td>${e(q.question)}</td><td><b>${e(q.answer)}</b></td>`)}</tbody></table><div class="sig"><div class="sig-l">Customer signature</div>${g.signature ? `<img class="sig-i" src="${sigDataUrl(g.signature)}"/>` : `<div class="sig-n">Not signed for this visit.</div>`}</div>`).join("")}` : ""}
</body></html>`;

        const frame = document.createElement("iframe");
        frame.setAttribute("style", "position:fixed;right:0;bottom:0;width:0;height:0;border:0");
        document.body.appendChild(frame);
        const win = frame.contentWindow;
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
        setTimeout(() => frame.remove(), 2000);
    }

    fmtAge(dob) {
        if (!dob) {
            return "";
        }
        const d = new Date(dob);
        if (isNaN(d.getTime())) {
            return "";
        }
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
            age--;
        }
        return age >= 0 && age < 130 ? String(age) : "";
    }
    capGender(g) {
        return g ? g.charAt(0).toUpperCase() + g.slice(1) : "";
    }
    pkgName(p) {
        return Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[1] : "Package";
    }
    get totalLeft() {
        return this.state.passes.reduce((s, p) => s + (p.sessions_left || 0), 0);
    }
    get totalUsed() {
        return this.state.passes.reduce((s, p) => s + (p.sessions_used || 0), 0);
    }
}
