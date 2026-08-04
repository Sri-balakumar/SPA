from odoo import api, fields, models


class ResPartner(models.Model):
    _inherit = 'res.partner'

    date_of_birth = fields.Date(string='Date of Birth')
    age = fields.Integer(string='Age', compute='_compute_age')
    gender = fields.Selection([
        ('male', 'Male'),
        ('female', 'Female'),
        ('other', 'Other'),
    ], string='Gender')
    whatsapp = fields.Char(string='WhatsApp Number')
    # RETIRED. A signature is consent to one service, so it is captured per
    # service now (spa.service.signature / spa.booking.signature) and asked for
    # again every time - nothing reads or writes this any more, and it is off
    # the contact form. The field stays only so the signatures customers gave
    # under the old scheme are not destroyed; drop it once they are no longer
    # wanted.
    spa_signature = fields.Binary(
        string='Signature (retired)', attachment=True,
        help="Signatures captured before they moved onto the service itself. "
             "Kept for reference only - nothing writes this field.")
    spa_booking_ids = fields.One2many(
        'spa.booking', 'partner_id', string='Spa Visits')
    spa_booking_count = fields.Integer(
        string='Spa Visits', compute='_compute_spa_booking_count')

    @api.depends('date_of_birth')
    def _compute_age(self):
        today = fields.Date.context_today(self)
        for partner in self:
            dob = partner.date_of_birth
            if dob:
                partner.age = today.year - dob.year - (
                    (today.month, today.day) < (dob.month, dob.day))
            else:
                partner.age = 0

    @api.depends('spa_booking_ids')
    def _compute_spa_booking_count(self):
        for partner in self:
            partner.spa_booking_count = len(partner.spa_booking_ids)

    @api.model
    def _load_pos_data_fields(self, config):
        fields_list = super()._load_pos_data_fields(config)
        return fields_list + ['date_of_birth', 'age', 'gender', 'whatsapp']

    # ---- one phone shape, everywhere ------------------------------------
    # The number IS the WhatsApp identity and the key the tablet app looks a
    # customer up by, so it has to be stored one way. It was not: the public
    # API wrote E.164 (+96890000000) while anything typed in the POS or on the
    # contact form went through phone_validation's onchange and came out
    # spaced (+968 9000 0000). An exact-match lookup then missed the spaced
    # ones and created a second contact for the same person.
    _SPA_PHONE_FIELDS = ('phone', 'whatsapp')

    def _phone_get_number_fields(self):
        # Teach Odoo's own phone machinery that `whatsapp` is a number field
        # too, so it is formatted and blacklisted like `phone` is.
        fields_list = super()._phone_get_number_fields()
        return fields_list + ['whatsapp'] if 'whatsapp' in self else fields_list

    def _spa_e164(self, number):
        """`number` in E.164, or None when it cannot be made sense of.

        `_phone_format` (phone_validation) already reads the country off the
        record and falls back to the COMPANY's country, so this follows the
        company setting instead of a hard-coded prefix. It returns False for
        anything it cannot parse - and then the number is left exactly as it
        was typed rather than guessed at, because turning a foreign number
        into a local one would send the WhatsApp message to a stranger.
        """
        number = (number or '').strip()
        if not number:
            return None
        formatted = self._phone_format(number=number, force_format='E164')
        return formatted or None

    def _spa_normalise_phones(self, vals):
        """Rewrite the phone fields of a vals dict in place. Returns it."""
        for fname in self._SPA_PHONE_FIELDS:
            if fname not in vals:
                continue
            e164 = self._spa_e164(vals[fname])
            if e164:
                vals[fname] = e164
        return vals

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        # After create, not before: a brand-new contact has no country yet at
        # the time vals are built, and _phone_format wants the record to read
        # it from. Re-formatting here also catches whatever the onchange left.
        for record in records:
            record._spa_apply_phone_format()
        return records

    def write(self, vals):
        result = super().write(vals)
        if any(fname in vals for fname in self._SPA_PHONE_FIELDS):
            for record in self:
                record._spa_apply_phone_format()
        return result

    def _spa_apply_phone_format(self):
        """Re-save this contact's numbers in E.164, if they differ."""
        self.ensure_one()
        patch = {}
        for fname in self._SPA_PHONE_FIELDS:
            current = self[fname]
            e164 = self._spa_e164(current)
            if e164 and e164 != current:
                patch[fname] = e164
        if patch:
            # super().write, or we recurse straight back into this.
            super().write(patch)
