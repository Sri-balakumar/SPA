from odoo import fields, models


class ProductTemplate(models.Model):
    """A product here is a bookable SESSION PACKAGE (e.g. 'GO Ease – Single
    Session'). It belongs to a therapy (its POS category) and carries the
    package's price, duration, number of sessions and short description.
    The rich therapy-level details/photos live in the Details blocks below."""
    _inherit = 'product.template'

    # Session-package fields
    spa_session_count = fields.Integer(string='Number of Sessions', default=1)
    spa_session_desc = fields.Text(string='Session Description', translate=True)

    # Repeatable detail blocks (heading / subheading / description / photos)
    spa_detail_ids = fields.One2many(
        'spa.product.detail', 'product_tmpl_id', string='Details', copy=True)
