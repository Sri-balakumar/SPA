from odoo import api, fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    # Which WhatsApp session sends booking links. There is normally more
    # than one session on the database, so don't guess.
    #
    # A Selection rather than the Many2one this used to be. Not a style choice:
    # a Many2one needs its comodel to exist when the registry is built, so
    # pointing one at whatsapp.session made this module refuse to load on any
    # database without a WhatsApp module - the exact coupling the manifest now
    # avoids. A Selection binds to nothing and simply offers no choices there.
    #
    # The stored value is unchanged either way: config_parameter keeps the id
    # as a string in ir.config_parameter, which is what
    # spa.booking.session._get_wa_session() reads back. Existing settings
    # survive the change untouched.
    spa_whatsapp_session_id = fields.Selection(
        selection='_spa_whatsapp_session_options', string='WhatsApp Session',
        config_parameter='spa_online_booking.whatsapp_session_id',
        help="Booking links are sent on this WhatsApp session. If it is "
             "empty or disconnected, the first connected session is used.")

    @api.model
    def _spa_whatsapp_session_options(self):
        """Connected WhatsApp sessions, or nothing when there is no WhatsApp
        module on this database. Replaces the old domain=[('status','=',
        'connected')], which only a Many2one could carry."""
        if 'whatsapp.session' not in self.env:
            return []
        sessions = self.env['whatsapp.session'].sudo().search(
            [('active', '=', True), ('status', '=', 'connected')])
        return [(str(session.id), session.name or 'WhatsApp')
                for session in sessions]

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

    # The small print under the package list, on both the POS Book Therapy
    # screen and the booking page. Editable rather than hard-coded because it
    # states commercial terms ("Valid 3 months") that change without a
    # developer being involved.
    spa_package_note = fields.Char(
        string='Package footer note',
        config_parameter='spa_online_booking.package_note',
        help="Shown under the package list, e.g. "
             "\"Prices in OMR • Valid 3 months\". Leave empty to show nothing.")

    # Whether a session may be finished without naming who gave it. Off by
    # default so switching this module on never stops a till that was working
    # a minute earlier; turn it on once every therapist has a user account.
    #
    # A database-wide ir.config_parameter rather than a per-register field:
    # "must every session name a therapist?" is a policy of the business, and
    # the back-office paths that enforce it (spa.booking.action_session_done)
    # have no pos.config to read.
    spa_assign_required = fields.Boolean(
        string='Assignee mandatory',
        config_parameter='spa_online_booking.assign_required',
        help="Require a member of staff on every session. When on, an order "
             "cannot be paid and a prepaid session cannot be marked done "
             "until each session names who is giving it. When off, the "
             "assignee is recorded wherever it is set but nothing is blocked.")

    spa_hide_savings = fields.Boolean(
        string='Hide "Save" amount',
        config_parameter='spa_online_booking.hide_savings',
        help="Hide the green 'Save X' line under each package, on the POS "
             "and on the online booking page.")

    # Read by res.partner.spa_health_status (spa_kiosk) by key, which is why
    # the setting can live here while the profile lives on the contact.
    spa_health_reuse = fields.Boolean(
        string='Reuse answers on file',
        config_parameter='spa_online_booking.health_reuse',
        help="Returning customers get a 'Healthy - no changes' tick: ticked, "
             "the questions and signature on file are reused; unticked, the "
             "questions open pre-filled to update. Off = ask every visit.")

    # Per-POS toggles for which channel tabs show in the POS Orders screen.
    pos_spa_show_online = fields.Boolean(
        related='pos_config_id.spa_show_online', readonly=False)
    pos_spa_show_web = fields.Boolean(
        related='pos_config_id.spa_show_web', readonly=False)
    pos_spa_show_tab = fields.Boolean(
        related='pos_config_id.spa_show_tab', readonly=False)
    pos_spa_auto_invoice = fields.Boolean(
        related='pos_config_id.spa_auto_invoice', readonly=False)
