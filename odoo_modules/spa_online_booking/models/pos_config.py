from odoo import fields, models


class PosConfig(models.Model):
    _inherit = 'pos.config'

    spa_show_online = fields.Boolean(
        string='Show Online Tab', default=True,
        help="Show the Online bookings tab in the POS Orders screen.")
    spa_show_web = fields.Boolean(
        string='Show Web Tab', default=True,
        help="Show the Web bookings tab in the POS Orders screen.")
    spa_show_tab = fields.Boolean(
        string='Show Tab Tab', default=True,
        help="Show the Tab (kiosk) bookings tab in the POS Orders screen.")
