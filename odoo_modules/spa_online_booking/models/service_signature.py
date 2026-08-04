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
        return super()._load_pos_data_fields(config) + ['spa_signature_ref']

    def _spa_signature(self):
        """The signature captured for this line, or an empty recordset."""
        self.ensure_one()
        if not self.spa_signature_ref:
            return self.env['spa.service.signature']
        return self.env['spa.service.signature'].sudo().browse(
            self.spa_signature_ref).exists()
