from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    # Which WhatsApp session sends booking links. There is normally more
    # than one session on the database, so don't guess.
    spa_whatsapp_session_id = fields.Many2one(
        'whatsapp.session', string='WhatsApp Session',
        domain="[('status', '=', 'connected')]",
        config_parameter='spa_online_booking.whatsapp_session_id',
        help="Booking links are sent on this WhatsApp session. If it is "
             "empty or disconnected, the first connected session is used.")

    spa_min_lead_hours = fields.Integer(
        string='Minimum booking notice (hours)',
        default=0,
        config_parameter='spa_online_booking.min_lead_hours',
        help="Customers can only book a slot at least this many hours in "
             "advance. 0 = same-day booking allowed up to the slot time.")

    spa_max_lead_hours = fields.Integer(
        string='Maximum booking notice (hours)',
        default=0,
        config_parameter='spa_online_booking.max_lead_hours',
        help="Customers cannot book a slot more than this many hours in "
             "advance (e.g. 720 = 30 days). 0 = no maximum.")

    # Per-POS toggles for which channel tabs show in the POS Orders screen.
    pos_spa_show_online = fields.Boolean(
        related='pos_config_id.spa_show_online', readonly=False)
    pos_spa_show_web = fields.Boolean(
        related='pos_config_id.spa_show_web', readonly=False)
    pos_spa_show_tab = fields.Boolean(
        related='pos_config_id.spa_show_tab', readonly=False)
