from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SpaBookingOnlineFields(models.Model):
    """Adds the fields the WhatsApp-link flow needs that don't exist on the
    walk-in kiosk booking yet. Kept in this module (not in spa_kiosk) so
    there's no merge conflict with your teammate's file.
    """
    _inherit = 'spa.booking'

    whatsapp_number = fields.Char(string='WhatsApp Number')
    # Who submitted this booking. Online bookings are all created by the public
    # user, so without this there is no way to tell one abuser from a thousand
    # customers - and no way to rate-limit them.
    client_ip = fields.Char(string='Submitted From', readonly=True, index=True, copy=False)
    slot_datetime = fields.Datetime(string='Requested Slot')

    # Personal details captured on the booking form (POS / website / tablet),
    # carried onto the customer contact when the booking is loaded.
    date_of_birth = fields.Date(string='Date of Birth')
    gender = fields.Selection([
        ('male', 'Male'), ('female', 'Female'), ('other', 'Other'),
    ], string='Gender')

    # Set when this booking is a prepaid session drawn from a package pass
    # (scheduled from the Redeem dialog). Signals reception NOT to charge again.
    session_pass_id = fields.Many2one(
        'spa.session.pass', string='Session Pass', index=True, ondelete='set null')
    # True once this booking has consumed one session from its pass, so marking
    # it done twice (or completing + paying) never double-counts.
    session_redeemed = fields.Boolean(string='Session Counted', default=False, copy=False)
    # Free-text time request the customer wrote when none of the offered slots
    # suited them; the receptionist reads this and allocates a time.
    time_note = fields.Char(string='Preferred Time Note')

    # Sent by the tablet app at submit time and carried onto the customer's
    # contact when reception loads the booking (_pos_find_or_create_partner).
    email = fields.Char(string='Email')
    # The signature the customer drew on the tablet. Attachment-backed so the
    # spa_booking table does not grow a base64 column. It stays HERE, on the
    # booking it was given for: a signature is consent to the service that was
    # booked, so it is asked for again every time and never copied onto the
    # contact to be reused.
    signature = fields.Binary(
        string='Signature', attachment=True,
        help="Signature the customer gave when booking this service.")
    terms_accepted = fields.Boolean(
        string='Terms Accepted',
        help="The customer ticked that they agree to the terms and confirm "
             "their details are correct, on the same screen they signed.")
    signature_missing = fields.Boolean(
        string='Not Signed', compute='_compute_signature_missing', store=True,
        help="This booking was taken without a signature. The tablet API will "
             "start refusing those once the updated app is in place.")

    @api.depends('signature')
    def _compute_signature_missing(self):
        for booking in self:
            booking.signature_missing = not booking.signature

    # A booking can now hold one OR MORE services. This is the source of truth
    # for the services on a booking; the legacy `product_id` below is kept only
    # as the "primary" service for backward compatibility.
    product_ids = fields.Many2many(
        'product.template',
        'spa_booking_product_rel', 'booking_id', 'product_id',
        string='Services',
        domain=[('type', '=', 'service')])

    # Relax the base field: no longer required now that `product_ids` carries
    # the selection. Controllers still set it to the first selected service so
    # existing rows/views/reports and the kiosk keep working.
    product_id = fields.Many2one(required=False)

    # Total price = sum of the selected services' list prices, read-only.
    price = fields.Float(compute='_compute_price', store=True, readonly=True)

    @api.depends('product_ids', 'product_ids.list_price',
                 'product_id', 'product_id.list_price')
    def _compute_price(self):
        for rec in self:
            if rec.product_ids:
                rec.price = sum(rec.product_ids.mapped('list_price'))
            else:
                # Walk-in kiosk bookings carry only the legacy single
                # service; without this they were all priced 0.00.
                rec.price = rec.product_id.list_price or 0.0

    @api.constrains('product_ids', 'product_id')
    def _check_services(self):
        # spa_kiosk's /spa/kiosk/submit only sets `product_id`, so accept
        # either. Requiring product_ids alone made every walk-in kiosk
        # booking fail validation as soon as this module was installed.
        for rec in self:
            if not rec.product_ids and not rec.product_id:
                raise ValidationError(
                    "A booking must have at least one service.")
