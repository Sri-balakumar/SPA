from odoo import api, fields, models


class PosOrder(models.Model):
    _inherit = 'pos.order'

    spa_service_summary = fields.Char(
        string='Services / Answers', compute='_compute_spa_service_summary')

    @api.depends('lines.full_product_name', 'lines.customer_note',
                 'lines.product_id')
    def _compute_spa_service_summary(self):
        for order in self:
            parts = []
            for line in order.lines:
                name = line.full_product_name or line.product_id.display_name
                note = (line.customer_note or '').strip()
                parts.append('%s%s' % (name, ' — %s' % note if note else ''))
            order.spa_service_summary = ' ; '.join(parts)
