from datetime import datetime, time

import pytz
from markupsafe import Markup

from odoo import _, api, fields, models
from odoo.exceptions import UserError


class SpaBookingPos(models.Model):
    """POS-side integration: expose bookings to the Point of Sale, split by the
    channel they came from (Online / Web / Tab), so a cashier can review them
    with their status and load one into an order when the customer arrives.
    """
    _inherit = 'spa.booking'

    spa_channel = fields.Selection([
        ('online', 'Online'),
        ('web', 'Web'),
        ('tab', 'Tab'),
    ], default='web', index=True, string='Booking Channel',
        help="Where the booking came from — drives the Online / Web / Tab "
             "tabs in the POS Orders screen. 'online' = WhatsApp link, "
             "'tab' = tablet kiosk, 'web' = entered manually.")

    # Insert an "Approved" stage between Pending and In Service. Approving only
    # CONFIRMS the booking (the customer comes on their booked day); it becomes
    # "In Service" only when they actually arrive and it's started/loaded.
    #
    # 'waiting' sits before everything: the customer asked for a time somebody
    # else already holds. It is a real state rather than a flag so it flows
    # through the POS sub-filters, the back-office list and every existing
    # `state != 'rejected'` check without those having to learn a new concept.
    state = fields.Selection(selection=[
        ('waiting', 'Waiting List'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('in_service', 'In Service'),
        ('completed', 'Completed'),
        ('paid', 'Paid'),
        ('rejected', 'Rejected'),
    ])

    # ---- waiting list ---------------------------------------------------
    # States that actually occupy a slot. 'waiting' does not (that is the whole
    # point) and 'rejected' released it.
    _SPA_HOLDING_STATES = ('pending', 'approved', 'in_service', 'completed', 'paid')

    def _spa_slot_products(self):
        """The services this booking is for, new field or legacy one."""
        self.ensure_one()
        return self.product_ids.ids or ([self.product_id.id] if self.product_id else [])

    @api.model
    def _spa_slot_holder(self, slot_dt, product_ids, exclude_ids=None):
        """The booking that OWNS this slot, or an empty recordset.

        The single answer to "is this time taken?" - availability, submit and
        promotion all ask here, so they cannot drift apart the way three copies
        of the domain would. Matches the legacy single-service field too,
        exactly as the old inline checks did.
        """
        if not slot_dt or not product_ids:
            return self.browse()
        domain = [
            ('state', 'in', self._SPA_HOLDING_STATES),
            ('slot_datetime', '=', slot_dt),
            '|',
            ('product_ids', 'in', list(product_ids)),
            ('product_id', 'in', list(product_ids)),
        ]
        if exclude_ids:
            domain.append(('id', 'not in', list(exclude_ids)))
        return self.sudo().search(domain, order='create_date, id', limit=1)

    @api.model
    def _spa_promote_slot(self, slot, products, exclude_ids=None, freed_by=None):
        """Give a freed slot to whoever has waited longest for it.

        Takes the slot explicitly rather than reading it off a record, because a
        RESCHEDULE frees the slot the booking has just left - by then the record
        holds the new time, and promoting against that would leave the old slot
        stuck with a queue nobody ever reaches.
        """
        if not slot or not products:
            return self.browse()
        if self._spa_slot_holder(slot, products, exclude_ids=exclude_ids):
            return self.browse()  # somebody still holds it
        domain = [
            ('state', '=', 'waiting'),
            ('slot_datetime', '=', slot),
            '|',
            ('product_ids', 'in', list(products)),
            ('product_id', 'in', list(products)),
        ]
        if exclude_ids:
            domain.append(('id', 'not in', list(exclude_ids)))
        nxt = self.sudo().search(domain, order='create_date, id', limit=1)
        if nxt:
            # Straight to 'pending', not 'approved': reception still decides,
            # exactly as they would for any newly arrived online booking.
            nxt.write({'state': 'pending'})
            nxt.message_post(
                body=_("Promoted from the waiting list: the %s slot was "
                       "released by %s.")
                % (slot.strftime('%Y-%m-%d %H:%M'), freed_by or _("another booking")))
        return nxt

    def _spa_promote_next(self):
        """Hand each of these bookings' CURRENT slots on, if now free.

        Used when a booking is cancelled - the slot it is sitting on is the one
        being released.
        """
        for booking in self:
            self._spa_promote_slot(
                booking.slot_datetime,
                booking._spa_slot_products(),
                exclude_ids=booking.ids,
                freed_by=booking.partner_name or booking.name,
            )

    def action_reject(self):
        """Cancel, then hand the slot to whoever is next in the queue."""
        was_holding = self.filtered(lambda b: b.state in self._SPA_HOLDING_STATES)
        res = super().action_reject()
        # Only a booking that actually held the slot frees one; cancelling a
        # waiting entry must not promote anybody.
        was_holding._spa_promote_next()
        return res

    def action_approve(self):
        # Override the base kiosk behaviour: approving CONFIRMS the booking
        # rather than jumping straight to "In Service".
        #
        # Online bookings arrive with only a name + number and no linked
        # contact, so reception approving one is the right moment to put the
        # customer in Contacts - previously that only happened later, if and
        # when someone pressed Load. Guarded on partner_id so a booking that is
        # already linked (a prepaid session pass sets it) is never re-pointed at
        # somebody else. Other channels keep resolving their contact on Load.
        for booking in self:
            if booking.spa_channel == 'online' and not booking.partner_id:
                booking.partner_id = booking.sudo()._pos_find_or_create_partner().id
        self.write({'state': 'approved'})

    def action_start_service(self):
        # The customer has arrived on their booked day — start serving them.
        self.write({'state': 'in_service'})

    # ---- prepaid pass redemption -------------------------------------
    def _redeem_pass_if_prepaid(self, assignee_id=False):
        """If this booking is a prepaid session (drawn from a package pass),
        count one session against the pass — once. Called when the booking is
        marked completed/paid, so reception just finishes the appointment and
        the pass decrements automatically.

        `assignee_id` records who gave the session on the usage row. It is only
        ever passed from the POS Sessions tab, which is the one place the
        person is known at redemption time."""
        for booking in self:
            pass_rec = booking.session_pass_id
            if not pass_rec or booking.session_redeemed:
                continue
            if pass_rec.sessions_left > 0:
                # Fall back to whoever the booking was given to at Approve.
                # Without this a session finished through the back-office
                # buttons (action_complete / action_mark_paid), which pass no
                # assignee, would lose the person reception already chose.
                who = assignee_id or booking.spa_therapist_id.id or False
                pass_rec.sudo().action_use_session(
                    note=_('%s (prepaid session)') % (booking.name or ''),
                    assignee_id=who)
            booking.session_redeemed = True

    def action_complete(self):
        res = super().action_complete()
        self.sudo()._redeem_pass_if_prepaid()
        return res

    def action_mark_paid(self):
        res = super().action_mark_paid()
        self.sudo()._redeem_pass_if_prepaid()
        return res

    def action_session_done(self, assignee_id=False):
        """A prepaid session is finished: mark it completed (which counts the
        session against its pass) without a charge/Load step.

        Refuses an unassigned session when Settings -> Spa Online Booking ->
        Session Assignee -> "Assignee mandatory" is on. The check matters most
        here: this button is a point of no return, counting a session off the
        pass and leaving a spa.session.pass.use row that is the ONLY record of
        who gave it. Elsewhere the person can still be filled in afterwards.
        """
        from .spa_assignee import spa_assign_required
        if spa_assign_required(self.env):
            for booking in self:
                if not (assignee_id or booking.spa_therapist_id):
                    raise UserError(_(
                        "Choose who is taking this session before marking it "
                        "done. The session is counted off the customer's "
                        "package now, and this is the only place the member of "
                        "staff is recorded."))
        for booking in self:
            if booking.state not in ('completed', 'paid'):
                booking.write({'state': 'completed'})
        self.sudo()._redeem_pass_if_prepaid(assignee_id=assignee_id)

    @api.model
    def get_pos_sessions(self, date_str=None):
        """Data for the POS 'Sessions' tab: prepaid session requests still
        awaiting service (pending), and sessions redeemed on the selected day
        (taken) — that day is the date picked in the POS filter, or today when
        none is picked."""
        pending = self.sudo().search([
            ('session_pass_id', '!=', False),
            ('session_redeemed', '=', False),
            ('state', 'in', ('pending', 'approved', 'in_service')),
        ], order='create_date desc', limit=200)
        pending_data = []
        for booking in pending:
            data = booking._pos_booking_data()
            data['sessions_left'] = booking.session_pass_id.sessions_left
            data['sessions_total'] = booking.session_pass_id.sessions_total
            pending_data.append(data)

        # Sessions redeemed on the target local day (the picked date, else
        # today): use.date is stored in UTC, so convert that day to UTC bounds.
        company = self.env.company
        today = company._spa_today()
        if date_str:
            try:
                today = fields.Date.to_date(date_str)
            except (ValueError, TypeError):
                today = company._spa_today()
        # The company's zone, not the reader's - res_company._spa_display_tz.
        tz = company._spa_display_tz()
        utc_start = fields.Datetime.to_string(
            tz.localize(datetime.combine(today, time.min))
            .astimezone(pytz.UTC).replace(tzinfo=None))
        utc_end = fields.Datetime.to_string(
            tz.localize(datetime.combine(today, time.max))
            .astimezone(pytz.UTC).replace(tzinfo=None))
        uses = self.env['spa.session.pass.use'].sudo().search([
            ('date', '>=', utc_start), ('date', '<=', utc_end),
        ], order='date desc')
        taken_data = []
        for use in uses:
            pass_rec = use.pass_id
            local_dt = company._spa_localize(use.date) if use.date else None
            taken_data.append({
                'id': use.id,
                'customer': pass_rec.partner_id.name or '',
                'package': pass_rec.product_tmpl_id.name if pass_rec.product_tmpl_id else '',
                'time': local_dt.strftime('%I:%M %p').lstrip('0') if local_dt else '',
                'sessions_left': pass_rec.sessions_left,
                'sessions_total': pass_rec.sessions_total,
                # Who gave it. A counted session leaves no order line behind,
                # so this row is the only record of the assignee.
                'assignee': use.spa_therapist_id.name or '',
            })
        return {'pending': pending_data, 'taken': taken_data}

    def _pos_answers_summary(self):
        self.ensure_one()
        return ' | '.join(
            '%s: %s' % (a.question_id.name, a.value_text)
            for a in self.answer_ids if a.value_text
        )

    def _pos_answers_rows(self):
        """One dict per answered question, so the POS card can show them
        row by row instead of one long ' | ' separated line."""
        self.ensure_one()
        return [
            {'question': a.question_id.name or '', 'answer': a.value_text}
            for a in self.answer_ids if a.value_text
        ]

    def _pos_services(self):
        """The service templates booked: the multi-service field if it holds
        anything, else the legacy single service."""
        self.ensure_one()
        if self.product_ids:
            return self.product_ids
        return self.product_id

    def _pos_booking_data(self):
        self.ensure_one()
        # Date used by the POS date filter/display:
        #  - if there's an appointment slot, that's the local time the customer
        #    picked (stored naive), so use it directly;
        #  - otherwise use the CREATION day converted to the local timezone
        #    (create_date is stored in UTC — using it raw put evening bookings
        #    on the wrong calendar day).
        if self.slot_datetime:
            slot = fields.Datetime.to_string(self.slot_datetime)
            date_str = slot[:10]
        else:
            slot = ''
            if self.create_date:
                local = (self.company_id or self.env.company)._spa_localize(
                    self.create_date)
                date_str = local.strftime('%Y-%m-%d')
            else:
                date_str = ''
        state_labels = dict(self._fields['state'].selection)
        channel_labels = dict(self._fields['spa_channel'].selection)
        return {
            'id': self.id,
            'name': self.name,
            'partner_name': self.partner_name or '',
            'mobile': self.mobile or '',
            'slot_datetime': slot,
            'date': date_str,
            # Needed by the POS waiting list: the queue is first-come-first-
            # served, so it is ordered by when the booking arrived, not by the
            # appointment time (every entry shares that).
            'create_date': (fields.Datetime.to_string(self.create_date)
                            if self.create_date else ''),
            'time_note': self.time_note or '',
            'state': self.state,
            'state_label': state_labels.get(self.state, self.state),
            'channel': self.spa_channel,
            'channel_label': channel_labels.get(self.spa_channel, ''),
            'price': self.price,
            'service_names': self._pos_services().mapped('name'),
            # Extras the customer chose online, shown on the card so reception
            # knows what to prepare before the booking is even loaded.
            'addon_names': self.spa_addon_ids.mapped('name'),
            # Everyone the package covers. Empty for a single person: the card
            # already shows their name, and repeating it would be noise.
            'member_names': (
                [m.name for m in self.member_ids.sorted('sequence')]
                if len(self.member_ids) > 1 else []),
            'answers': self._pos_answers_summary(),
            'answer_rows': self._pos_answers_rows(),
            # prepaid = a next session drawn from a package pass: don't charge.
            'prepaid': bool(self.session_pass_id),
            # Who this appointment is given to. The id preselects the card's
            # picker, the name is what the card prints once it is set.
            'assignee_id': self.spa_therapist_id.id or 0,
            'assignee': self.spa_therapist_id.name or '',
        }

    @api.model
    def get_pos_bookings(self, channel):
        """Bookings for one POS tab (channel = 'online' / 'web' / 'tab').
        Read as sudo so a plain POS user (read-only on spa.booking) sees them."""
        if channel not in ('online', 'web', 'tab'):
            return []
        bookings = self.sudo().search(
            [('spa_channel', '=', channel)],
            order='create_date desc', limit=200)
        return [b._pos_booking_data() for b in bookings]

    @api.model
    def get_pos_all_bookings(self):
        """All recent bookings across every channel — used by the POS "All"
        tab to also list the day's paid bookings next to the paid orders."""
        bookings = self.sudo().search([], order='create_date desc', limit=300)
        return [b._pos_booking_data() for b in bookings]

    @api.model
    def get_pos_today_bookings(self):
        """All bookings whose appointment is today, across every channel, for
        the POS "Today" tab: scheduled slots falling today, plus same-day
        walk-ins / manual bookings that have no slot. Ordered by time."""
        company = self.env.company
        today = company._spa_today()
        # Naive local-clock bounds for slot_datetime (stored as local wall clock).
        local_start = fields.Datetime.to_string(datetime.combine(today, time.min))
        local_end = fields.Datetime.to_string(datetime.combine(today, time.max))
        # UTC bounds of the local day for create_date (stored in real UTC).
        # Company zone, so "today" is the salon's day and not the reader's.
        tz = company._spa_display_tz()
        utc_start = fields.Datetime.to_string(
            tz.localize(datetime.combine(today, time.min))
            .astimezone(pytz.UTC).replace(tzinfo=None))
        utc_end = fields.Datetime.to_string(
            tz.localize(datetime.combine(today, time.max))
            .astimezone(pytz.UTC).replace(tzinfo=None))
        bookings = self.sudo().search([
            '|',
            '&', ('slot_datetime', '>=', local_start), ('slot_datetime', '<=', local_end),
            '&', '&', ('slot_datetime', '=', False),
            ('create_date', '>=', utc_start), ('create_date', '<=', utc_end),
        ], order='slot_datetime, create_date')
        return [b._pos_booking_data() for b in bookings]

    def pos_booking_action(self, action, assignee_id=False):
        """Run a booking status transition from the POS. sudo() because POS
        users only have read access to spa.booking. Reuses the same methods as
        the back-office form buttons.

        `assignee_id` is the member of staff the appointment is given to. It is
        recorded on the booking for EVERY transition that carries one - the
        commonest being Approve, where reception decides who is taking the
        customer - and 'session_done' additionally stamps it on the usage row,
        which is a prepaid session's only record of the person."""
        self.ensure_one()
        methods = {
            'approve': 'action_approve',         # pending    -> approved
            'reject': 'action_reject',           # pending    -> rejected
            'start': 'action_start_service',     # approved   -> in_service
            'complete': 'action_complete',       # in_service -> completed
            'paid': 'action_mark_paid',          # completed  -> paid
            'session_done': 'action_session_done',  # prepaid: done + count session
        }
        method = methods.get(action)
        if not method:
            return False
        booking = self.sudo()
        # Only reception and the administrator name the person who gave a
        # session; a cashier pressing Approve still approves it, just without
        # an assignee. Same rule the order lines are held to.
        #
        # Imported here, not at the top: this file is imported before
        # spa_assignee in models/__init__.py, and a module-level import would
        # pull that in ahead of session_pass, whose model it extends.
        from .spa_assignee import spa_can_assign
        assignee_id = assignee_id if spa_can_assign(self.env) else False
        # Recorded BEFORE the transition runs, so a redemption triggered by it
        # (session_done, complete, paid) already sees the person on the
        # booking and can copy them onto the usage row.
        if assignee_id and booking.spa_therapist_id.id != assignee_id:
            booking.spa_therapist_id = assignee_id
        if action == 'session_done':
            booking.action_session_done(assignee_id=assignee_id)
        else:
            getattr(booking, method)()
        return booking.state

    def pos_set_slot(self, slot_str):
        """Set/adjust a booking's appointment time from the POS (e.g. based on
        the customer's preferred-time note). sudo() since POS users are
        read-only on spa.booking."""
        self.ensure_one()
        value = (slot_str or '').strip().replace('T', ' ')
        if not value:
            return False
        dt = False
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S'):
            try:
                dt = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
        if not dt:
            return False
        self.sudo().slot_datetime = dt
        return fields.Datetime.to_string(dt)

    def _pos_find_or_create_partner(self):
        """Resolve the res.partner for this booking, or create one.

        Online / tablet bookings only store a NAME + PHONE (no linked contact),
        so we resolve it here when it's loaded. A phone number can be SHARED by
        several contacts (family members on one number), so a phone match alone
        is not enough — it would attach whoever happens to be first. We also
        check the NAME: among the contacts on that number, pick the one whose
        name matches the booking. If the number is on file but only under a
        DIFFERENT name, that's a different person sharing it, so we create this
        booking's own contact instead of stealing someone else's.
        """
        self.ensure_one()
        Partner = self.env['res.partner'].sudo()
        name = (self.partner_name or '').strip()
        numbers = [n for n in (self.mobile, self.whatsapp_number) if n]

        phone_matches = Partner.browse()
        for number in numbers:
            phone_matches |= Partner.search(
                ['|', ('phone', '=', number), ('whatsapp', '=', number)])

        if not phone_matches:
            # Same number, different formatting: online bookings store E.164
            # (+96891400038) while the walk-in kiosk and hand-typed contacts
            # store whatever was entered (91400038). Exact equality misses those
            # and would create a duplicate contact, so fall back to the last 8
            # digits - the same rule _find_partners_by_phone uses for the tablet
            # API. (That helper is not reusable here: it lives in a controller
            # and touches request.env, which does not exist when this runs from
            # the back-office button or a cron.)
            for number in numbers:
                digits = ''.join(c for c in number if c.isdigit())
                tail = digits[-8:] if len(digits) >= 8 else digits
                if tail:
                    phone_matches |= Partner.search(
                        ['|', ('phone', 'like', tail), ('whatsapp', 'like', tail)],
                        limit=20)

        if phone_matches:
            if name:
                # Same number, several people: keep the one whose name matches
                # this booking; if none match, it's a different person.
                named = phone_matches.filtered(
                    lambda p: (p.name or '').strip().lower() == name.lower())
                if named:
                    return self._pos_sync_partner(named[0])
            else:
                # No name to disambiguate — fall back to the first on the number.
                return self._pos_sync_partner(phone_matches[0])

        # Number not on file, or on file only under another name -> new contact.
        return Partner.create({
            'name': name or (numbers[0] if numbers else False) or _('Guest'),
            'phone': self.mobile,
            'whatsapp': self.whatsapp_number,
            'email': self.email or False,
            'date_of_birth': self.date_of_birth or False,
            'gender': self.gender or False,
        })

    def _pos_sync_partner(self, partner):
        """Carry what the booking captured onto an EXISTING contact.

        Date of birth and gender only fill in what the contact is MISSING - a
        typo on the tablet must never overwrite good data. WhatsApp and e-mail
        are different: the customer types them again on every booking, so a
        different value means it changed and the contact takes it - but only
        from a booking made after the contact's details were last set
        (spa_contact_date). Otherwise loading an old booking would put back a
        number or address the customer has since changed. Every change is
        noted on the contact; a booking too old to apply says so on itself.
        The phone is never replaced - it is the number customers are looked up
        by. The signature is deliberately NOT among these: it stays on the
        booking it was given for, because it is consent to that service and
        not a detail of the person.
        """
        self.ensure_one()
        patch = {}
        if self.date_of_birth and not partner.date_of_birth:
            patch['date_of_birth'] = self.date_of_birth
        if self.gender and not partner.gender:
            patch['gender'] = self.gender

        # Compared as digits / lower-cased, so a spacing or capital letter is
        # the same value and not a change.
        digits = lambda n: ''.join(c for c in (n or '') if c.isdigit())
        mail = lambda e: (e or '').strip().lower()
        changes = {}
        if self.whatsapp_number and digits(self.whatsapp_number) != digits(partner.whatsapp):
            changes['whatsapp'] = self.whatsapp_number
        if self.email and mail(self.email) != mail(partner.email):
            changes['email'] = self.email.strip()
        newer = not partner.spa_contact_date or (
            self.create_date and self.create_date >= partner.spa_contact_date)
        if changes and not newer:
            # Nothing to lose by filling an empty e-mail, however old.
            if 'email' in changes and not partner.email:
                patch['email'] = changes['email']
            self.message_post(body=_(
                "WhatsApp / e-mail not copied to the contact: it already has "
                "details newer than this booking."))
            changes = {}
        if changes:
            patch.update(changes, spa_contact_date=self.create_date)

        before = {f: partner[f] for f in ('whatsapp', 'email') if f in patch}
        if patch:
            partner.sudo().write(patch)
        if before:
            labels = {'whatsapp': _("WhatsApp"), 'email': _("E-mail")}
            partner.sudo().message_post(body=Markup('%s<ul>%s</ul>') % (
                _("Updated from booking %s:", self.name),
                Markup('').join(Markup('<li>%s: %s → %s</li>') % (
                    labels[f], old or '-', partner[f] or '-')
                    for f, old in before.items())))
        return partner


    def action_pos_load(self):
        """Load this booking into a POS order: ensure a customer exists, move it
        to 'In Service', and return what the POS needs to build the order.
        sudo() because a POS user only has read access to spa.booking."""
        self.ensure_one()
        booking = self.sudo()
        partner = booking.partner_id
        # (Re)resolve the customer when there is none, OR when the linked
        # contact's name doesn't match the booking's name — that means the old
        # phone-only match attached the wrong person (a family member sharing
        # the number). Bookings created from a package pass keep their
        # deliberately-set customer, because there the names agree.
        name = (booking.partner_name or '').strip().lower()
        mismatched = partner and name and (partner.name or '').strip().lower() != name
        if not partner or mismatched:
            partner = booking._pos_find_or_create_partner()
            booking.partner_id = partner.id
        # Now that the lead has a contact, give the rest of the family theirs -
        # filed underneath it. Deliberately NOT done at submit time: an online
        # booking has no lead contact yet, so the members would be created
        # parentless and the family match could never find them again, adding a
        # duplicate on every visit.
        booking._spa_resolve_member_partners()
        # Loading = the customer is here now, so start service.
        if booking.state in ('pending', 'approved'):
            booking.state = 'in_service'
        return {
            'booking_id': booking.id,
            'partner_id': partner.id,
            'service_tmpl_ids': booking._pos_services().ids,
            # Kept apart from the services so the POS adds a plain line for each
            # extra. Without this an add-on booked online is invisible at the
            # counter and never charged.
            'addon_tmpl_ids': booking.spa_addon_ids.ids,
            'answers': booking._pos_answers_summary(),
            'channel': booking.spa_channel,
            # ticket_tabs.js already does
            #   if (info.slot_datetime) { order.spa_slot_datetime = ... }
            # but this never sent it, so an appointment booked online vanished
            # from the order the moment it was loaded at the counter - and left
            # the order with no previous date for a later reschedule to move
            # away from.
            #
            # Sent as the naive "%Y-%m-%d %H:%M:%S" wall clock the POS expects:
            # spaOrderDay() slices the first 10 characters of this string and
            # compares them with the date picker, so a luxon-converted value
            # would shift an evening appointment by a day.
            'slot_datetime': (
                booking.slot_datetime.strftime('%Y-%m-%d %H:%M:%S')
                if booking.slot_datetime else False),
        }
