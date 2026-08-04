from datetime import datetime, time

import pytz

from odoo import api, fields, models


class PosSalesReportParser(models.AbstractModel):
    """Parser for the POS Sales Report PDF. The controller builds the full data
    dict and passes it in `data['r']`; this just hands it to the template."""
    _name = 'report.spa_online_booking.pos_sales_report_document'
    _description = 'POS Sales Report'

    @api.model
    def _get_report_values(self, docids, data=None):
        return {
            'doc_ids': docids,
            'doc_model': 'pos.config',
            'r': (data or {}).get('r') or {},
        }


class PosConfigSalesReport(models.Model):
    _inherit = 'pos.config'

    @api.model
    def build_spa_sales_report(self, config_id, date_from, date_to, title):
        """Aggregate paid POS orders in [date_from, date_to] (local YYYY-MM-DD)
        into the structure the Sales Report PDF renders: per-day product
        breakdown + payments + totals, plus the period grand totals.

        Grouped by the local calendar day of each order. Only real sales
        (paid / done / invoiced) are counted; negative-total orders are summed
        into the Refund figure."""
        env = self.env
        tz = pytz.timezone(env.context.get('tz') or env.user.tz or 'UTC')
        d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
        d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
        utc_start = tz.localize(datetime.combine(d_from, time.min)).astimezone(
            pytz.UTC).replace(tzinfo=None)
        utc_end = tz.localize(datetime.combine(d_to, time.max)).astimezone(
            pytz.UTC).replace(tzinfo=None)

        config = env['pos.config'].browse(config_id).exists() if config_id else None
        domain = [
            ('date_order', '>=', fields.Datetime.to_string(utc_start)),
            ('date_order', '<=', fields.Datetime.to_string(utc_end)),
            ('state', 'in', ['paid', 'done', 'invoiced']),
        ]
        if config:
            domain.append(('config_id', '=', config.id))
        orders = env['pos.order'].sudo().search(domain, order='date_order')

        days = {}
        for o in orders:
            local = fields.Datetime.context_timestamp(o, o.date_order)
            key = local.strftime('%Y-%m-%d')
            d = days.setdefault(key, {
                'orders': 0, 'products': {}, 'payments': {},
                'subtotal': 0.0, 'tax': 0.0, 'discount': 0.0, 'total': 0.0,
                'refund': 0.0,
            })
            d['orders'] += 1
            d['tax'] += o.amount_tax
            d['total'] += o.amount_total
            if o.amount_total < 0:
                d['refund'] += -o.amount_total
            for line in o.lines:
                prod = line.product_id
                p = d['products'].setdefault(prod.id, {
                    'name': line.full_product_name or prod.display_name,
                    'barcode': prod.barcode or prod.default_code or '',
                    'qty': 0.0, 'unit': line.price_unit, 'subtotal': 0.0,
                })
                p['qty'] += line.qty
                p['subtotal'] += line.price_subtotal_incl
                d['subtotal'] += line.price_subtotal
                d['discount'] += (line.price_unit * line.qty) * (line.discount or 0.0) / 100.0
            for pay in o.payment_ids:
                m = pay.payment_method_id.name
                d['payments'][m] = d['payments'].get(m, 0.0) + pay.amount

        day_list = []
        for key in sorted(days.keys()):
            d = days[key]
            day_list.append({
                'date': datetime.strptime(key, '%Y-%m-%d').strftime('%d/%m/%Y'),
                'orders': d['orders'],
                'products': [{
                    'name': p['name'], 'barcode': p['barcode'],
                    'qty': p['qty'], 'unit': p['unit'], 'subtotal': p['subtotal'],
                } for p in d['products'].values()],
                'payments': [{'method': k, 'amount': v} for k, v in d['payments'].items()],
                'subtotal': d['subtotal'], 'tax': d['tax'],
                'discount': d['discount'], 'total': d['total'],
            })

        company = (config.company_id if config else False) or env.company
        summary = {
            'orders': sum(x['orders'] for x in day_list),
            'total_sales': sum(x['total'] for x in day_list),
            'tax': sum(x['tax'] for x in day_list),
            'discount': sum(x['discount'] for x in day_list),
            'refund': sum(days[k]['refund'] for k in days),
        }
        return {
            'company_name': company.name,
            'title': title or 'SALE REPORT',
            'period_from': d_from.strftime('%d/%m/%Y'),
            'period_to': d_to.strftime('%d/%m/%Y'),
            'pos_name': config.name if config else 'All POS',
            'generated': fields.Datetime.context_timestamp(
                env.user, fields.Datetime.now()).strftime('%d/%m/%Y %H:%M:%S'),
            'currency': company.currency_id.symbol or '',
            'summary': summary,
            'days': day_list,
        }
