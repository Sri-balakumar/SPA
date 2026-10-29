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
    # Read in the register by auto_invoice.js. Off by default so installing
    # this never changes how an existing till behaves.
    spa_auto_invoice = fields.Boolean(
        string='Invoice every order automatically', default=False,
        help="Every new order starts with Invoice ticked on the payment screen, "
             "so each sale gets an invoice. A customer has to be selected "
             "before such an order can be paid.")
