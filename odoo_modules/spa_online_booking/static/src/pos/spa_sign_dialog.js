import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { SpaSignatureField, newSigState, sigDataUrl } from "@spa_online_booking/pos/spa_signature";

// The signed consent sheet. Opened from an order card in the Orders list and
// from the Questions & Answers view of the Customer dialog. It shows the
// receipt + invoice number and the questionnaire the customer answered, takes
// (or reuses) their signature, saves it on the contact and prints the lot.
//
// `sheet` is what pos.order.spa_sign_sheet() returns, or the same shape built
// from an already-loaded questionnaire:
//   { title, customer, partner_id, phone, dob, age, gender, order_ref,
//     invoice, date, currency, amount_total, services[], groups[], signature }
export class SpaSignDialog extends Component {
    static template = "spa_online_booking.SpaSignDialog";
    static components = { Dialog, SpaSignatureField };
    static props = ["close", "sheet", "companyId?"];

    setup() {
        this.orm = this.env.services.orm;
        this.state = useState({
            sig: newSigState(this.props.sheet.signature || ""),
            busy: false,
            error: "",
        });
    }

    get sheet() {
        return this.props.sheet;
    }
    get logoUrl() {
        return this.props.companyId
            ? `/web/image/res.company/${this.props.companyId}/logo`
            : "";
    }
    money(v) {
        const cur = this.sheet.currency || "";
        const n = (v || 0).toFixed(2);
        return cur ? `${cur} ${n}` : n;
    }
    groupHead(g) {
        return [g.ref, g.invoice ? `Invoice ${g.invoice}` : "", g.date]
            .filter(Boolean)
            .join(" · ");
    }

    // Store the signature against the SERVICES on this order that still have
    // none - a signature is consent to what was sold, not a detail of the
    // person, so the contact is never written. A failure to save must NOT
    // swallow the print: the customer is standing there waiting for the sheet.
    async saveAndPrint() {
        const sig = this.state.sig;
        if (!sig.value) {
            this.state.error = "Please take the customer's signature first.";
            return;
        }
        this.state.error = "";
        const lines = this.sheet.unsigned_line_ids || [];
        if (lines.length && sig.value !== sig.original) {
            this.state.busy = true;
            try {
                await this.orm.call("pos.order", "spa_sign_lines", [
                    [this.sheet.order_id],
                    lines,
                    sig.value,
                ]);
                sig.original = sig.value;
                sig.mode = "view";
                this.sheet.unsigned_line_ids = [];
            } catch (e) {
                console.warn("Sign sheet: could not save the signature", e);
                this.state.error =
                    "The signature could not be saved on the service — printing anyway.";
            } finally {
                this.state.busy = false;
            }
        }
        this.print();
    }

    esc(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // Print on its own, without the POS chrome: render into a hidden iframe and
    // print that (window.print() would print the whole POS, and window.open is
    // blocked in kiosk mode). Same approach as the Reports print.
    print() {
        const s = this.sheet;
        const e = (v) => this.esc(v);
        const sig = this.state.sig.value;
        const meta = [
            ["Customer", s.customer],
            ["Phone", s.phone],
            ["Receipt No", s.order_ref],
            ["Invoice No", s.invoice],
            ["Date", s.date],
        ].filter(([, v]) => v);
        if (s.age) {
            meta.push(["Age / Gender", [s.age, s.gender].filter(Boolean).join(" · ")]);
        }
        if (s.amount_total) {
            meta.push(["Total", this.money(s.amount_total)]);
        }

        const qa = (s.groups || [])
            .map(
                (g) => `<div class="grp">${e(g.service || "")}<span class="muted"> ${e(this.groupHead(g))}</span></div>
<table><tbody>${(g.rows || [])
                    .map(
                        (r) =>
                            `<tr><td class="q">${e(r.question)}</td><td class="a">${e(r.answer)}</td></tr>`
                    )
                    .join("")}</tbody></table>`
            )
            .join("");

        const html = `<html><head><meta charset="utf-8"/>
<title>${e(s.order_ref || s.title)} - ${e(s.customer)}</title>
<style>
 body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 20px; }
 h1 { font-size: 16px; margin: 0 0 2px; }
 h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
 .muted { color: #666; font-weight: normal; }
 .logo { max-height: 54px; margin-bottom: 8px; }
 table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
 td { border-bottom: 1px solid #e2e2e2; padding: 5px 6px; text-align: left; vertical-align: top; }
 .meta td { border: 0; padding: 2px 6px; }
 .meta td.k { color: #666; width: 110px; }
 .grp { font-weight: bold; margin-top: 10px; }
 .q { width: 62%; }
 .a { font-weight: bold; }
 .sign { margin-top: 26px; page-break-inside: avoid; }
 .sign img { max-height: 110px; max-width: 320px; display: block; }
 .sign .line { border-top: 1px solid #333; width: 320px; margin-top: 4px; padding-top: 4px; color: #666; }
 .note { margin-top: 18px; font-size: 11px; color: #444; }
</style></head><body>
${this.logoUrl ? `<img class="logo" src="${this.logoUrl}"/>` : ""}
<h1>${e(s.title || s.order_ref)}</h1>
<div class="muted">${e(s.company || "")}</div>
<table class="meta"><tbody>
${meta.map(([k, v]) => `<tr><td class="k">${e(k)}</td><td>${e(v)}</td></tr>`).join("")}
</tbody></table>
${qa ? `<h2>Questions &amp; Answers</h2>${qa}` : ""}
<div class="note">I confirm the information above is correct and I consent to the treatment described.</div>
<div class="sign">
${sig ? `<img src="${sigDataUrl(sig)}"/>` : '<div style="height:70px"></div>'}
 <div class="line">Customer signature — ${e(s.customer)}${s.date ? ` · ${e(s.date)}` : ""}</div>
</div>
</body></html>`;

        const frame = document.createElement("iframe");
        frame.setAttribute("style", "position:fixed;right:0;bottom:0;width:0;height:0;border:0");
        document.body.appendChild(frame);
        const win = frame.contentWindow;
        win.document.open();
        win.document.write(html);
        win.document.close();

        // The logo is fetched over HTTP; printing before it decodes gives a
        // sheet with a blank hole where it should be.
        let printed = false;
        const doPrint = () => {
            if (printed) {
                return;
            }
            printed = true;
            win.focus();
            win.print();
            setTimeout(() => frame.remove(), 2000);
        };
        const imgs = Array.from(win.document.images || []);
        let pending = imgs.length;
        if (!pending) {
            doPrint();
            return;
        }
        const one = () => {
            if (--pending <= 0) {
                doPrint();
            }
        };
        imgs.forEach((img) => {
            if (img.complete) {
                one();
            } else {
                img.addEventListener("load", one);
                img.addEventListener("error", one);
            }
        });
        setTimeout(doPrint, 3000);   // never hang on a slow/broken image
    }
}
