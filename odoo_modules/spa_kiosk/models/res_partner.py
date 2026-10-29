import json

from markupsafe import Markup, escape

from odoo import api, fields, models
from odoo.exceptions import AccessError


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

    # ---- health profile: answered once, re-asked only when it changes ----
    # The LATEST answers this person gave, keyed by the question's normalised
    # TEXT (same rule as spa.question._spa_dedupe), not by record id: each
    # therapy carries its own copy of "Any heart condition?", and answering it
    # for one therapy has to count for the others. On a return visit the POS
    # shows a "Healthy - no changes" tick; ticked, these answers and the
    # signature below are reused and the questions are not asked again.
    spa_health_answers = fields.Text(
        string='Health Answers (data)', copy=False, groups='base.group_user')
    spa_health_date = fields.Datetime(
        string='Health Answers Updated', copy=False, readonly=True)
    spa_health_user_id = fields.Many2one(
        'res.users', string='Updated By', copy=False, readonly=True)
    spa_health_signature = fields.Binary(
        string='Signature on File', attachment=True, copy=False,
        help="The signature given with the answers on file. Reused while the "
             "customer confirms nothing has changed; replaced when they update "
             "their answers.")
    spa_health_summary = fields.Html(
        string='Health Answers', compute='_compute_spa_health_summary',
        sanitize=False)

    @staticmethod
    def _spa_health_key(text):
        return ' '.join((text or '').split()).casefold()

    @staticmethod
    def _spa_health_filled(value):
        if isinstance(value, list):
            return bool(value)
        return bool(value and str(value).strip())

    def _spa_health_load(self):
        self.ensure_one()
        try:
            data = json.loads(self.sudo().spa_health_answers or '{}')
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _spa_health_text(value):
        if isinstance(value, list):
            return ', '.join(str(v) for v in value)
        return str(value) if value not in (None, False, '') else '-'

    @api.depends('spa_health_answers')
    def _compute_spa_health_summary(self):
        for partner in self:
            rows = [Markup('<li><b>%s</b>: %s</li>') % (
                        entry.get('text') or '', self._spa_health_text(entry.get('value')))
                    for entry in partner._spa_health_load().values()]
            partner.spa_health_summary = (
                Markup('<ul class="mb-0">%s</ul>') % Markup('').join(rows)
                if rows else False)

    def _spa_health_check_access(self):
        # Called from the POS, whose cashiers usually cannot write contacts:
        # the methods below sudo(), so they are gated on the POS group here.
        if not (self.env.su
                or self.env.user.has_group('point_of_sale.group_pos_user')):
            raise AccessError(self.env._("Only POS users can read health answers."))

    @api.model
    def spa_health_status(self, partner_id, question_ids):
        """What the POS needs to decide whether to ask the questions again.

        `answers` maps the CURRENT question ids to the values on file, matched
        by text; `missing_required` lists required questions this person has
        never answered (a question added since), which must still be asked.
        """
        self._spa_health_check_access()
        partner = self.sudo().browse(int(partner_id or 0)).exists()
        result = {'on_file': False, 'date': '', 'by': '', 'answers': {},
                  'missing_required': [], 'signature': ''}
        if not partner:
            return result
        # Settings > Spa Online Booking > "Reuse answers on file". Off = the
        # questionnaire is asked every visit, exactly as before.
        if self.env['ir.config_parameter'].sudo().get_param(
                'spa_online_booking.health_reuse') not in ('True', '1'):
            return result
        stored = partner._spa_health_load()
        if not stored or not partner.spa_health_date:
            return result
        questions = self.env['spa.question'].sudo().browse(
            [int(q) for q in (question_ids or [])]).exists()
        answers = {}
        for q in questions:
            entry = stored.get(self._spa_health_key(q.name))
            if entry and self._spa_health_filled(entry.get('value')):
                answers[q.id] = entry.get('value')
        when = fields.Datetime.context_timestamp(partner, partner.spa_health_date)
        signature = partner.spa_health_signature
        result.update({
            'on_file': True,
            'date': when.strftime('%d %b %Y, %I:%M %p'),
            'by': partner.spa_health_user_id.name or '',
            'answers': answers,
            'missing_required': [q.id for q in questions
                                 if q.required and q.id not in answers],
            'signature': signature.decode() if isinstance(signature, bytes)
            else (signature or ''),
        })
        return result

    @api.model
    def spa_health_save(self, partner_id, answers, signature=None):
        """Store `answers` ({question id: value}) as this person's profile.

        Merged over what is on file, so answering one therapy's questions never
        wipes another's. The previous answers go to the contact's chatter - the
        history of what changed, when and by whom.
        """
        self._spa_health_check_access()
        partner = self.sudo().browse(int(partner_id or 0)).exists()
        if not partner or not answers:
            return False
        ids = [int(k) for k in answers if str(k).isdigit()]
        questions = self.env['spa.question'].sudo().browse(ids).exists()
        stored = partner._spa_health_load()
        before = dict(stored)
        for q in questions:
            value = answers.get(str(q.id), answers.get(q.id))
            if self._spa_health_filled(value):
                stored[self._spa_health_key(q.name)] = {'text': q.name, 'value': value}
        if not stored:
            return False
        vals = {
            'spa_health_answers': json.dumps(stored, ensure_ascii=False),
            'spa_health_date': fields.Datetime.now(),
            'spa_health_user_id': self.env.uid,
        }
        if signature:
            vals['spa_health_signature'] = signature
        partner.write(vals)
        if before and stored != before:
            rows = Markup('').join(
                Markup('<li>%s: %s</li>') % (
                    e.get('text') or '', self._spa_health_text(e.get('value')))
                for e in before.values())
            partner.message_post(body=Markup('<p>%s</p><ul>%s</ul>') % (
                escape(self.env._("Health answers updated. Previous answers:")), rows))
        return True

    def action_spa_health_clear(self):
        """'Ask again next visit': forget the answers and signature on file."""
        self.sudo().write({'spa_health_answers': False, 'spa_health_date': False,
                           'spa_health_user_id': False, 'spa_health_signature': False})
        for partner in self:
            partner.message_post(body=self.env._(
                "Health answers cleared - the questionnaire will be asked again "
                "on the next visit."))

    @api.model
    def spa_health_keep_signature(self, partner_id, signature):
        """Put a signature on file WITHOUT touching the answers or their date.

        For a visit where the customer confirmed 'no changes' but had never
        signed (their answers came from the POS pop-up or the kiosk, which take
        no signature): the signature they give now is kept, so the next visit
        skips the waiver too. Only for a contact that HAS answers on file.
        """
        self._spa_health_check_access()
        partner = self.sudo().browse(int(partner_id or 0)).exists()
        if not partner or not signature or not partner.spa_health_date:
            return False
        partner.spa_health_signature = signature
        return True

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
