from odoo import api, fields, models

from .date_of_birth import check_date_of_birth


class ResPartner(models.Model):
    """Expose a customer's therapy session passes on their contact, so the
    front desk can look someone up and see their sessions in one place.

    The totals are computed (not stored) to avoid adding columns to the large
    res_partner table; the 'remaining' total gets a search method so it can
    still be used in the Customers filter."""
    _inherit = 'res.partner'

    # A stable customer number for the invoice. Its own field rather than the
    # standard `ref`, which is free text people already use for other things -
    # this one must never change once printed on a document.
    spa_customer_id = fields.Char(
        string='Customer ID', readonly=True, copy=False, index='btree_not_null')

    def _spa_needs_customer_id(self):
        """Contacts that should carry a customer number.

        Excludes companies (a supplier needs no customer number) AND anything
        backing a user account - OdooBot, Administrator, the public and portal
        template users are all res.partner rows with is_company False, and
        numbering them burns customer numbers on records nobody will ever
        invoice.
        """
        # active_test=False on the user check: OdooBot and the portal template
        # are ARCHIVED user accounts, and plain `p.user_ids` hides an archived
        # user - so without this they read as ordinary contacts and take the
        # first customer numbers.
        return self.filtered(
            lambda p: not p.spa_customer_id and not p.is_company
            and not p.with_context(active_test=False).user_ids)

    def _spa_ensure_customer_id(self):
        """Give these contacts a customer number if they have none.

        Called when an invoice renders as well as on create, so contacts that
        existed before this field did get a number the first time they are
        invoiced instead of printing a blank.
        """
        Sequence = self.env['ir.sequence'].sudo()
        for partner in self._spa_needs_customer_id():
            number = Sequence.next_by_code('spa.customer.id')
            if number:
                partner.sudo().spa_customer_id = number

    @api.model_create_multi
    def create(self, vals_list):
        partners = super().create(vals_list)
        partners._spa_ensure_customer_id()
        return partners

    @api.constrains('date_of_birth')
    def _check_spa_date_of_birth(self):
        # The contact is where the date of birth actually LANDS: the POS details
        # step writes res.partner straight through the ORM, so without this the
        # till can still store a birthday in 2029 no matter what the booking
        # says. Only checked when one is set - most contacts have none.
        for partner in self:
            if partner.date_of_birth:
                check_date_of_birth(partner.date_of_birth, self.env)

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
