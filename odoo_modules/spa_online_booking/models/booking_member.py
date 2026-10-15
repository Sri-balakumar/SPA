from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .date_of_birth import check_date_of_birth
from .package_price import spa_headcount


class SpaBookingMember(models.Model):
    """One person on a booking.

    A Family 2 package books two people, but every personal field on
    spa.booking is a scalar - one name, one date of birth, one signature. That
    is fine for the person who paid and useless for the second person, who has
    their own health history to declare and their own consent to give.

    EVERY person gets a row here, including person 1. Individual bookings
    simply have one. That uniformity is deliberate: the sign sheet, the invoice
    and the booking form all read members, and none of them needs a special
    case for "the booking with no members".

    Person 1 is the lead booker - they pay, they are the order's contact, and
    the booking's own partner_name / mobile / date_of_birth keep mirroring
    them. So everything written before this model existed still reads correctly.
    """
    _name = 'spa.booking.member'
    _description = 'Person on a Booking'
    _order = 'booking_id, sequence, id'

    booking_id = fields.Many2one(
        'spa.booking', string='Booking', required=True,
        ondelete='cascade', index=True)
    # 1 = the lead booker. Drives the "Person 2 of 3" heading and the order
    # people are printed in, so it is set explicitly rather than left to id.
    sequence = fields.Integer(string='Person', default=1, required=True)

    name = fields.Char(string='Full Name', required=True)
    date_of_birth = fields.Date(string='Date of Birth')
    gender = fields.Selection([
        ('male', 'Male'), ('female', 'Female'), ('other', 'Other'),
    ], string='Gender')
    # Optional on purpose: a parent books for their children, and a child has
    # no phone of their own. The lead booker is the contact for the whole
    # booking, so nothing here is needed to reach the family.
    phone = fields.Char(string='Phone')
    email = fields.Char(string='Email')

    partner_id = fields.Many2one(
        'res.partner', string='Contact', index=True, ondelete='set null',
        help="The contact record for this person. Members other than the lead "
             "booker are filed as child contacts of the lead, so the family "
             "stays together and a second visit reuses the same people.")

    # Consent is personal: each person answers their own questions and signs
    # for those answers. One signature covering four people would be one
    # person consenting on behalf of three who never saw the questions.
    signature = fields.Binary(string='Signature', attachment=True)
    terms_accepted = fields.Boolean(string='Terms Accepted')

    answer_ids = fields.One2many(
        'spa.booking.answer', 'member_id', string='Answers')

    is_lead = fields.Boolean(
        string='Lead Booker', compute='_compute_is_lead', store=True)
    age = fields.Integer(string='Age', compute='_compute_age')

    @api.depends('sequence')
    def _compute_is_lead(self):
        for member in self:
            member.is_lead = member.sequence <= 1

    @api.depends('date_of_birth')
    def _compute_age(self):
        # The salon's day, not the reader's - res_company._spa_today.
        today = self.env.company._spa_today()
        for member in self:
            if member.date_of_birth and member.date_of_birth <= today:
                member.age = relativedelta(today, member.date_of_birth).years
            else:
                member.age = 0

    @api.constrains('date_of_birth')
    def _check_date_of_birth(self):
        # Person 2 of a family booking gets the same check as person 1 - the
        # per-person form is exactly where a stray year goes unnoticed.
        for member in self:
            if member.date_of_birth:
                check_date_of_birth(member.date_of_birth, self.env)

    @api.constrains('booking_id', 'sequence')
    def _check_booking_headcount(self):
        """Re-check the booking's headcount whenever its people change.

        The matching constraint on spa.booking alone is not enough: @api.constrains
        on a One2many only fires when that field is written on the booking
        itself, so creating spa.booking.member rows directly - which is exactly
        what the booking API and the POS do - slipped straight past it. Checked
        from this side, every route that adds a person is covered.
        """
        for booking in self.mapped('booking_id'):
            booking._check_member_count()

    def _spa_label(self):
        """"Person 2 of 3" - the same wording the booking screens use."""
        self.ensure_one()
        total = spa_headcount(self.booking_id.spa_member_type)
        return 'Person %s of %s' % (self.sequence, total)

    def _spa_answer_rows(self):
        """This person's answers as [{'question', 'answer'}], question order."""
        self.ensure_one()
        rows = []
        for answer in self.answer_ids.sorted(
                lambda a: (a.question_id.sequence, a.question_id.id)):
            rows.append({
                'question': answer.question_id.name or '',
                'answer': answer.value_text or '',
            })
        return rows

    def _spa_resolve_partner(self, lead_partner=None):
        """Find or create this person's contact.

        Members carry no phone, so the phone-based lookup that finds returning
        customers cannot find them - matching on name alone would collide with
        every other Sara in the database. So members are filed as CHILD
        contacts of the lead booker and matched within that family only, on
        name + date of birth. Book the same family twice and the same two
        contacts come back instead of a fresh pair every visit.
        """
        Partner = self.env['res.partner'].sudo()
        for member in self:
            if member.partner_id:
                continue
            name = (member.name or '').strip()
            if not name:
                continue
            parent = lead_partner or member.booking_id.partner_id
            if member.is_lead:
                # The lead is resolved by the booking's own phone-matching
                # path; never invent a second contact for them here.
                member.partner_id = parent.id if parent else False
                continue
            if not parent:
                # No lead contact yet - an online booking has none until the
                # customer checks in. Creating the member now would make a
                # PARENTLESS contact that the family match can never find
                # again, so every visit would add another "Sara". Leave it;
                # action_pos_load resolves the whole family once the lead
                # exists, which is also when they become a real customer.
                continue
            domain = [('parent_id', '=', parent.id), ('name', '=ilike', name)]
            if member.date_of_birth:
                # Two children of the same family can share a name only if
                # they were born on different days; without a birth date,
                # the name within one family is enough.
                domain.append(('date_of_birth', '=', member.date_of_birth))
            existing = Partner.search(domain, limit=1)
            if existing:
                member.partner_id = existing.id
                continue
            member.partner_id = Partner.create({
                'name': name,
                'parent_id': parent.id,
                'type': 'contact',
                'date_of_birth': member.date_of_birth or False,
                'gender': member.gender or False,
                'phone': member.phone or False,
                'email': member.email or False,
            }).id
        return self.mapped('partner_id')


class SpaBookingAnswerMember(models.Model):
    """Which person on the booking gave this answer.

    Nullable on purpose. Every answer written before this upgrade has no
    member, and a null here reads as "the booking's own answer" - so nothing
    that already stored answers breaks. The migration backfills them onto
    member 1.
    """
    _inherit = 'spa.booking.answer'

    member_id = fields.Many2one(
        'spa.booking.member', string='Person',
        ondelete='cascade', index=True)


class SpaBookingMembers(models.Model):
    _inherit = 'spa.booking'

    member_ids = fields.One2many(
        'spa.booking.member', 'booking_id', string='People')
    member_count = fields.Integer(
        string='People', compute='_compute_member_count', store=True)

    @api.depends('member_ids')
    def _compute_member_count(self):
        for booking in self:
            booking.member_count = len(booking.member_ids)

    def _spa_expected_members(self):
        """How many people this booking's member type covers."""
        self.ensure_one()
        return spa_headcount(self.spa_member_type)

    @api.constrains('member_ids', 'spa_member_type')
    def _check_member_count(self):
        """A Family 3 booking must name three people.

        Only enforced once members exist at all: bookings created before this
        model, and the tablet route which does not collect members, have none
        and must stay saveable. What this catches is the real error - a Family
        3 booking that names two people, where the third would silently receive
        a service they never declared a health history for.
        """
        for booking in self:
            if not booking.member_ids:
                continue
            expected = booking._spa_expected_members()
            if len(booking.member_ids) != expected:
                raise ValidationError(
                    "%s is booked for %s person(s) but %s have been entered. "
                    "Enter the details of every person the package covers."
                    % (booking.name or 'This booking', expected,
                       len(booking.member_ids)))

    def _spa_lead_member(self):
        """The person who booked, or an empty recordset."""
        self.ensure_one()
        return self.member_ids.sorted('sequence')[:1]

    def _spa_sync_lead_member(self):
        """Copy the lead member's details onto the booking's own fields.

        The booking's scalar fields are what the POS card, the reports and
        every existing view read. Keeping them as a mirror of member 1 means
        none of that had to change when members arrived.
        """
        for booking in self:
            lead = booking._spa_lead_member()
            if not lead:
                continue
            vals = {'partner_name': lead.name}
            # Never blank a value the booking already holds: the lead's phone
            # and email are collected on the booking itself, and the member
            # form leaves them optional.
            if lead.date_of_birth:
                vals['date_of_birth'] = lead.date_of_birth
            if lead.gender:
                vals['gender'] = lead.gender
            if lead.email:
                vals['email'] = lead.email
            booking.write(vals)

    def _spa_resolve_member_partners(self):
        """Give every person on the booking a contact."""
        for booking in self:
            lead_partner = booking.partner_id
            booking.member_ids._spa_resolve_partner(lead_partner=lead_partner)

    def _spa_set_members(self, people):
        """Replace this booking's people.

        `people` is one dict per person, in order, each holding
        name / date_of_birth / gender / phone / email / signature /
        terms_accepted and an `answers` map of {question_id: text}.

        Rows are created in ONE call on purpose. The headcount constraint runs
        on every write to member_ids, so adding a Family 2's people one at a
        time would trip it halfway through with a single member present.
        """
        self.ensure_one()
        if not people:
            return self.env['spa.booking.member']

        Member = self.env['spa.booking.member'].sudo()
        self.member_ids.unlink()
        members = Member.create([{
            'booking_id': self.id,
            'sequence': person.get('sequence') or (index + 1),
            'name': person.get('name') or '',
            'date_of_birth': person.get('date_of_birth') or False,
            'gender': person.get('gender') or False,
            'phone': person.get('phone') or False,
            'email': person.get('email') or False,
            'signature': person.get('signature') or False,
            'terms_accepted': bool(person.get('terms_accepted')),
        } for index, person in enumerate(people)])

        # Answers second, and in one call too: booking_id is required on
        # spa.booking.answer, so they cannot be nested under the member above.
        answer_vals = []
        for member, person in zip(members, people):
            for question_id, value in (person.get('answers') or {}).items():
                answer_vals.append({
                    'booking_id': self.id,
                    'member_id': member.id,
                    'question_id': question_id,
                    'value_text': value,
                })
        if answer_vals:
            self.env['spa.booking.answer'].sudo().create(answer_vals)

        self._spa_resolve_member_partners()
        self._spa_sync_lead_member()
        return members
