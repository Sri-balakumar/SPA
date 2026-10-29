from markupsafe import Markup, escape

from odoo import api, fields, models
from odoo.exceptions import AccessError

from .date_of_birth import check_date_of_birth

# What the tablet's Edit Profile may change, and nothing else.
SPA_PROFILE_FIELDS = ('name', 'phone', 'whatsapp', 'email', 'gender', 'date_of_birth')
# The contact details a customer gives again on every booking. When they change
# is kept (spa_contact_date) so an older booking never overwrites newer ones.
SPA_CONTACT_FIELDS = ('whatsapp', 'email')


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

    # When the WhatsApp / e-mail on this contact were last set. A booking made
    # before that is older news, so loading it must not put back what the
    # customer has since changed (see spa.booking._pos_sync_partner).
    spa_contact_date = fields.Datetime(
        string='Contact Details Updated', readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        partners = super().create(vals_list)
        partners._spa_ensure_customer_id()
        return partners

    def write(self, vals):
        # Any change to them - Edit Profile, the contact form, the POS - is
        # the newest version. A booking sync passes its own date instead.
        if any(f in vals for f in SPA_CONTACT_FIELDS) and 'spa_contact_date' not in vals:
            vals = dict(vals, spa_contact_date=fields.Datetime.now())
        return super().write(vals)

    @api.constrains('date_of_birth')
    def _check_spa_date_of_birth(self):
        # The contact is where the date of birth actually LANDS: the POS details
        # step writes res.partner straight through the ORM, so without this the
        # till can still store a birthday in 2029 no matter what the booking
        # says. Only checked when one is set - most contacts have none.
        for partner in self:
            if partner.date_of_birth:
                check_date_of_birth(partner.date_of_birth, self.env)

    @api.model
    def spa_profile_save(self, partner_id, vals):
        """Edit Profile on the tablet: the customer's own details, onto their
        contact. Without it the edit lived only in the app and the next lookup
        brought the old details back.

        The tablet logs in as a POS user, who usually cannot write contacts, so
        this sudo()s - gated on the POS group like spa_health_save, and limited
        to SPA_PROFILE_FIELDS. What changed goes to the contact's chatter.
        """
        if not (self.env.su or self.env.user.has_group('point_of_sale.group_pos_user')):
            raise AccessError(self.env._("Only POS users can edit customer details."))
        partner = self.sudo().browse(int(partner_id or 0)).exists()
        if not partner:
            return False
        clean = {k: v for k, v in (vals or {}).items() if k in SPA_PROFILE_FIELDS}
        # Never blank a contact's name or e-mail from here.
        for fname in ('name', 'email'):
            if not (clean.get(fname) or '').strip():
                clean.pop(fname, None)
        if not clean:
            return False
        before = {k: partner[k] for k in clean}
        partner.write(clean)
        rows = [(partner._fields[k].string, before[k], partner[k])
                for k in clean if before[k] != partner[k]]
        if rows:
            partner.message_post(body=Markup('<p>%s</p><ul>%s</ul>') % (
                escape(self.env._("Details updated on the tablet:")),
                Markup('').join(Markup('<li>%s: %s → %s</li>') % (
                    label, old or '-', new or '-') for label, old, new in rows)))
        return True

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
