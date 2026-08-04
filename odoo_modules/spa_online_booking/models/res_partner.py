from odoo import api, fields, models


class ResPartner(models.Model):
    """Expose a customer's therapy session passes on their contact, so the
    front desk can look someone up and see their sessions in one place.

    The totals are computed (not stored) to avoid adding columns to the large
    res_partner table; the 'remaining' total gets a search method so it can
    still be used in the Customers filter."""
    _inherit = 'res.partner'

    spa_session_pass_ids = fields.One2many(
        'spa.session.pass', 'partner_id', string='Session Passes')
    spa_sessions_left = fields.Integer(
        string='Sessions Remaining', compute='_compute_spa_sessions',
        search='_search_spa_sessions_left')
    spa_sessions_used = fields.Integer(
        string='Sessions Taken', compute='_compute_spa_sessions')
    spa_pass_count = fields.Integer(
        string='Packages', compute='_compute_spa_sessions')

    @api.depends('spa_session_pass_ids.sessions_left', 'spa_session_pass_ids.sessions_used')
    def _compute_spa_sessions(self):
        for partner in self:
            passes = partner.spa_session_pass_ids
            partner.spa_sessions_left = sum(passes.mapped('sessions_left'))
            partner.spa_sessions_used = sum(passes.mapped('sessions_used'))
            partner.spa_pass_count = len(passes)

    def _search_spa_sessions_left(self, operator, value):
        """Search partners by remaining sessions via their passes (covers the
        'Has Sessions Left' filter, i.e. > 0)."""
        passes = self.env['spa.session.pass'].sudo().search(
            [('sessions_left', operator, value)])
        return [('id', 'in', passes.partner_id.ids)]
