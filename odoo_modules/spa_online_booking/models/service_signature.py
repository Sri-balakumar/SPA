from odoo import api, fields, models


class SpaServiceSignature(models.Model):
    """The consent signature a customer gives for ONE service they buy.

    It used to live on the contact (`res.partner.spa_signature`): one image per
    person, taken on the customer-details step and reused for ever. But a
    signature is consent to a particular service, given straight after reading
    that service's questions - so it is asked again for every service and kept
    here, beside the service it belongs to.

    Online bookings already keep theirs on `spa.booking.signature`, which is
    per booking; this covers the counter sale, which creates no booking.
    """
    _name = 'spa.service.signature'
    _description = 'Spa Service Signature'
    _order = 'id desc'

    partner_id = fields.Many2one('res.partner', string='Customer', index=True)
    product_tmpl_id = fields.Many2one(
        'product.template', string='Service', index=True)

    # The Client Information block of the waiver, copied in at the moment of
    # signing. Held HERE rather than read back off partner_id: the contact can
    # be renamed, merged or given a new number later, and a waiver has to keep
    # saying what the person actually agreed under. Filled from the details
    # already entered, so nobody retypes them and the two cannot disagree.
    client_name = fields.Char(string='Full Name')
    client_phone = fields.Char(string='Contact Number')
    client_email = fields.Char(string='Email Address')

    # The waiver wording as it stood when this was signed. Copied in for the
    # same reason as the client details above: the disclaimer lives on the
    # therapy and can be reworded at any time, so reading it live would make
    # every past signed sheet silently claim the customer agreed to today's
    # text. Blank on signatures taken before this field existed - the sheet
    # falls back to the therapy's current wording for those.
    disclaimer_title = fields.Char(string='Disclaimer Title')
    disclaimer_body = fields.Html(string='Disclaimer', sanitize=True)

    def _spa_snapshot_disclaimer(self):
        """Copy the service's current disclaimer onto these signatures."""
        for record in self:
            payload = record.product_tmpl_id._spa_disclaimer()
            if payload.get('body'):
                record.write({
                    'disclaimer_title': payload.get('title') or '',
                    'disclaimer_body': payload.get('body') or '',
                })
    pos_order_line_id = fields.Many2one(
        'pos.order.line', string='Order Line', index=True, ondelete='cascade')
    # attachment=True keeps the base64 out of the table itself.
    signature = fields.Binary(string='Signature', attachment=True)
    # Ticked on the same screen, just above the signature. Stored rather than
    # merely enforced in the browser: "did this customer accept the terms?"
    # has to be answerable months later, and create_date says when.
    terms_accepted = fields.Boolean(string='Terms Accepted')


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    # Which member type this line was sold at. Without it a Family 3 line
    # priced 216 looks identical to an individual one discounted to 216, and
    # neither the receipt nor any report could tell them apart.
    spa_member_type = fields.Many2one(
        'spa.member.type', string='Member Type',
        ondelete='restrict', index=True,
        default=lambda self: self.env['spa.member.type']._spa_base_type())

    def _spa_member_label(self):
        """The member type as it should read on paperwork, or ''.

        Blank for the base type: "Go Ease - Individual" reads like a variant
        nobody asked for.
        """
        self.ensure_one()
        member_type = self.spa_member_type
        if not member_type or member_type.is_individual:
            return ''
        return member_type.name or ''

    def _spa_apply_member_name(self):
        """Put the member type into `full_product_name`.

        That one field is the name on the printed receipt
        (`getFullProductName()`) AND the description on the invoice line
        (pos.order._get_invoice_lines_values). Writing it here means both
        documents say the same thing without each being patched separately -
        a receipt reading "Go Ease (Single Session)" beside a Family 2 price
        looks like a mistake, or worse, like the wrong amount was charged.

        REBUILT from the product name rather than stripping the old suffix off
        whatever is there. Stripping meant knowing every label that had ever
        existed, so renaming "Family 2" to "Couple" turned an old line into
        "Go Ease - Family 2 - Couple" the next time it was saved. Rebuilding is
        idempotent AND rename-safe.
        """
        for line in self:
            base = line.product_id.display_name or line.full_product_name or ''
            label = line._spa_member_label()
            new_name = '%s - %s' % (base, label) if label else base
            if new_name != line.full_product_name:
                line.full_product_name = new_name

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        # Belt and braces: the POS sets this on the client so the receipt is
        # right immediately, but an order reaching the server another way would
        # otherwise invoice without the family size.
        lines.filtered('spa_member_type')._spa_apply_member_name()
        return lines

    # The spa.service.signature taken for THIS line, held by id and not by
    # image: a base64 payload on every line would ride along in the POS session
    # and in every order sync. Same trick as pos.order.spa_booking_ref, and the
    # same reason res.partner.spa_signature is kept out of the session load.
    spa_signature_ref = fields.Integer(string='Spa Signature', index=True)

    @api.model
    def _load_pos_data_fields(self, config):
        # super() + append, NEVER a bare list: pos.order.line's own
        # implementation returns the whole set of core fields, so replacing it
        # drops them and the POS fails to load.
        return super()._load_pos_data_fields(config) + [
            'spa_signature_ref', 'spa_member_type']

    def _spa_signature(self):
        """The signature captured for this line, or an empty recordset."""
        self.ensure_one()
        if not self.spa_signature_ref:
            return self.env['spa.service.signature']
        return self.env['spa.service.signature'].sudo().browse(
            self.spa_signature_ref).exists()
