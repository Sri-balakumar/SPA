import json
import logging

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)

# Order states that mean the customer has actually paid for the package.
_PAID_STATES = ('paid', 'done', 'invoiced')


class PosOrder(models.Model):
    """Tag each POS order with the channel it came from (online / web / tab)
    so orders can be shown and reported per channel in the back office.

    NOTE: no `_load_pos_data_fields` override here — pos.order loads all its
    fields by default, so this column reaches the POS automatically. Narrowing
    that list would drop core relations like `lines` and crash the POS.
    """
    _inherit = 'pos.order'

    spa_channel = fields.Selection([
        ('online', 'Online'),
        ('web', 'Web'),
        ('tab', 'Tab'),
    ], string='Spa Channel', index=True, default='web',
        help="Origin of this order: 'online' = WhatsApp link booking, "
             "'tab' = tablet kiosk, 'web' = rung in manually.")

    # The spa.booking this order was loaded from — used to de-duplicate the POS
    # channel tabs (a booking that became an order shows once, as the order).
    spa_booking_ref = fields.Integer(string='Spa Booking', index=True)

    # When the customer is actually coming, as opposed to `date_order`, which is
    # when they PAID. Kept here as its own column rather than read through
    # spa_booking_ref because that is a plain Integer, not a Many2one, so a
    # related field is not possible - and because the POS loads pos.order's
    # columns automatically, which is what puts the appointment on the order
    # card. Without it a rescheduled appointment was invisible: the order row
    # showed the payment time, and the booking itself is hidden from the POS
    # lists as soon as an order points at it.
    spa_slot_datetime = fields.Datetime(
        string='Appointment', index=True,
        help="When the customer is due in. Set when a booking is loaded into "
             "this order, or when the appointment is rescheduled.")

    # Mirrored off the booking for the same reason spa_slot_datetime is: the POS
    # card can only read order fields, and the Remove button has to know whether
    # there is a date to go back to - it offers Undo when there is and Remove
    # when there is not, and names the date in its confirmation either way.
    spa_prev_slot_datetime = fields.Datetime(
        string='Previous Appointment', copy=False, readonly=True,
        help="Where this order's appointment was before the last reschedule. "
             "Remove puts it back here while this is set.")

    # The people on a family sale, as JSON, written by the Book Therapy screen.
    # A carrier, not a store: the POS has no real order id until the order
    # syncs, so it cannot create the member rows itself. _process_order drains
    # this into proper spa.booking.member records and clears it.
    spa_members_json = fields.Text(string='Family Members (pending)', copy=False)

    # Same carrier trick for the signatures. They used to be created straight
    # from the POS with `pos_order_line_id: line.id` - but an unsynced line's id
    # is a client-side UUID, so Postgres rejected it outright
    # ("invalid input syntax for type integer"). That is why every older
    # spa.service.signature row has a null pos_order_line_id.
    spa_signatures_json = fields.Text(string='Signatures (pending)', copy=False)

    # Set whenever this order's appointment was set or moved from the
    # Reschedule button, INCLUDING giving a counter sale its first date. It used
    # to require moving off an existing date, which meant the Rescheduled tab was
    # empty for the commonest case: reception reschedules orders that have no
    # appointment yet, because the booking is created on the spot for them.
    #
    # Deliberately NOT the same question as "is a slot being freed" - see
    # pos_reschedule, which keeps that one separate.
    spa_rescheduled = fields.Boolean(
        string='Rescheduled', index=True, copy=False,
        help="This order's appointment was set or moved from the Reschedule "
             "button. Cleared when the appointment is removed.")

    # ---- signed consent sheet -------------------------------------------
    def spa_sign_sheet(self):
        """POS "Sign" button: everything needed to print ONE receipt as a
        signed sheet — the receipt and invoice number, what was sold, the
        questionnaire the customer answered, and the signature given for each
        service (spa.service.signature, or the booking's own for an order that
        came from online).

        The answers reach us two ways and BOTH are read, same as the customer
        report: written on the order line's customer note (rung up at the
        counter) and on the spa.booking (online / tablet / link flows).
        """
        self.ensure_one()
        order = self.sudo()
        partner = order.partner_id
        # _spa_parse_note / _spa_fmt_dt are plain helpers - an empty recordset
        # is enough, we only need the env.
        helper = self.env['spa.session.pass'].sudo()
        genders = dict(self.env['res.partner']._fields['gender'].selection)

        services, groups = [], []
        order_ref = order.pos_reference or order.name or ''
        invoice = order.account_move.name or ''
        when = helper._spa_fmt_dt(order.date_order)

        # The signature of the FIRST service that has one heads the sheet, so
        # the single-service sale (which is nearly every sale) prints exactly as
        # it used to. Each group also carries its own, for a receipt that mixed
        # two therapies signed separately.
        sheet_signature = ''
        unsigned_lines = []
        # The waiver(s) the customer accepted. Deduplicated by wording: two
        # packages of the same therapy share one disclaimer and it should be
        # printed once, not twice.
        disclaimers, seen_disclaimers = [], set()

        for line in order.lines:
            tmpl = line.product_id.product_tmpl_id
            # Prefer what was FROZEN at signing; fall back to the therapy's
            # current wording for signatures taken before that was stored.
            line_signature = line._spa_signature()
            payload = {}
            if line_signature and line_signature.disclaimer_body:
                payload = {
                    'title': line_signature.disclaimer_title or _('Disclaimer'),
                    'body': line_signature.disclaimer_body,
                    'as_signed': True,
                }
            else:
                live = tmpl._spa_disclaimer()
                if live.get('body'):
                    payload = dict(live, as_signed=False)
            if payload and payload['body'] not in seen_disclaimers:
                seen_disclaimers.add(payload['body'])
                disclaimers.append(dict(
                    payload, service=line.product_id.display_name or ''))
            services.append({
                'name': line.full_product_name or line.product_id.display_name or '',
                'qty': line.qty or 0.0,
                'total': line.price_subtotal_incl or 0.0,
            })
            line_sig = line._spa_signature().signature or b''
            line_sig = line_sig.decode() if line_sig else ''
            if line_sig and not sheet_signature:
                sheet_signature = line_sig
            if not line_sig and tmpl._spa_questions():
                unsigned_lines.append(line.id)
            rows = helper._spa_parse_note(line.customer_note, tmpl._spa_questions())
            if rows:
                groups.append({
                    'service': line.product_id.display_name or '',
                    'ref': order_ref,
                    'invoice': invoice,
                    'date': when,
                    'rows': rows,
                    'signature': line_sig,
                    # Counter sales are not split by person - the answers live
                    # in the line note, not on members. Present so every group
                    # has the same shape and the sheet never reads undefined.
                    'person': '',
                    'person_label': '',
                })

        # A therapy booked online answered its questions on the spa.booking, not
        # on the order line - read those too, or an online sale prints blank.
        if order.spa_booking_ref:
            booking = self.env['spa.booking'].sudo().browse(order.spa_booking_ref)
            if booking.exists():
                booked = booking.product_ids or booking.product_id
                # ONE BLOCK PER PERSON. A family booking holds a separate
                # health history and a separate signature for each person;
                # merging them would print one contradictory questionnaire and
                # attribute it to whoever paid.
                for member in booking.member_ids.sorted('sequence'):
                    rows = member._spa_answer_rows()
                    member_sig = member.signature or b''
                    member_sig = member_sig.decode() if member_sig else ''
                    if member_sig and not sheet_signature:
                        sheet_signature = member_sig
                    # The line note is a copy of the lead's answers, so the same
                    # questionnaire can arrive twice - keep the first.
                    if rows and any(g['rows'] == rows for g in groups):
                        continue
                    groups.append({
                        'service': ', '.join(booked.mapped('name')),
                        'ref': booking.name or order_ref,
                        'invoice': invoice,
                        'date': when,
                        'rows': rows,
                        'signature': member_sig,
                        # Named so the sheet can head each block with the person
                        # it belongs to. Blank for an individual booking, which
                        # is what keeps that sheet looking exactly as before.
                        'person': member.name if len(booking.member_ids) > 1 else '',
                        'person_label': (member._spa_label()
                                         if len(booking.member_ids) > 1 else ''),
                    })
                if not booking.member_ids:
                    # Pre-members booking that the backfill did not reach.
                    rows = [{
                        'question': a.question_id.name or '',
                        'answer': a.value_text or '',
                    } for a in booking.answer_ids if a.value_text]
                    booked_sig = booking.signature or b''
                    booked_sig = booked_sig.decode() if booked_sig else ''
                    if booked_sig and not sheet_signature:
                        sheet_signature = booked_sig
                    if rows and not any(g['rows'] == rows for g in groups):
                        groups.append({
                            'service': ', '.join(booked.mapped('name')),
                            'ref': booking.name or order_ref,
                            'invoice': invoice,
                            'date': when,
                            'rows': rows,
                            'signature': booked_sig,
                            'person': '',
                            'person_label': '',
                        })
        return {
            'order_id': order.id,
            'order_ref': order_ref,
            'invoice': invoice,
            'date': when,
            'title': ', '.join(s['name'] for s in services if s['name']),
            'customer': partner.name or '',
            'partner_id': partner.id or 0,
            'phone': partner.phone or '',
            'whatsapp': partner.whatsapp or '',
            'dob': fields.Date.to_string(partner.date_of_birth) or '',
            'age': partner.age or 0,
            'gender': genders.get(partner.gender, ''),
            'company': order.company_id.name or '',
            'company_id': order.company_id.id,
            'currency': order.currency_id.symbol or '',
            'amount_total': order.amount_total or 0.0,
            'services': services,
            'groups': groups,
            'disclaimers': disclaimers,
            'signature': sheet_signature,
            # Lines that still need a signature, so the Sign dialog knows what
            # to attach a freshly drawn one to.
            'unsigned_line_ids': unsigned_lines,
        }

    def spa_sign_lines(self, line_ids, signature):
        """Store a signature drawn on the Sign sheet against those order lines.

        The sheet is the fallback for a service that reached the order without
        going through the questions step; it deliberately does NOT write the
        contact any more - a signature belongs to the service that was sold.
        """
        self.ensure_one()
        order = self.sudo()
        Signature = self.env['spa.service.signature'].sudo()
        lines = order.lines.filtered(lambda l: l.id in (line_ids or []))
        for line in lines:
            record = Signature.create({
                'partner_id': order.partner_id.id or False,
                'product_tmpl_id': line.product_id.product_tmpl_id.id,
                'pos_order_line_id': line.id,
                'signature': signature,
            })
            # Freeze the waiver wording as it is right now, so this sheet always
            # shows what was actually agreed to rather than a later edit.
            record._spa_snapshot_disclaimer()
            line.spa_signature_ref = record.id
        return True

    # ---- Session passes (prepaid multi-session packages) ----------------
    def _create_session_passes(self):
        """When a paid order contains a multi-session package, create a
        Session Pass for the customer (once per order line). Today's visit is
        counted as the first session. Works for every channel."""
        Pass = self.env['spa.session.pass'].sudo()
        for order in self:
            if order.state not in _PAID_STATES or not order.partner_id:
                continue
            for line in order.lines:
                tmpl = line.product_id.product_tmpl_id
                total = tmpl.spa_session_count or 0
                # only multi-session packages need tracking
                if total <= 1:
                    continue
                # idempotent: one pass per order line
                if Pass.search_count([('source_line_id', '=', line.id)]):
                    continue
                new_pass = Pass.create({
                    'partner_id': order.partner_id.id,
                    'product_tmpl_id': tmpl.id,
                    'sessions_total': total,
                    'sessions_used': 0,
                    'channel': order.spa_channel or 'web',
                    'pos_order_id': order.id,
                    'source_line_id': line.id,
                    'company_id': order.company_id.id,
                    'purchase_date': order.date_order,
                })
                # today's visit counts as session 1
                new_pass.action_use_session(note='Session 1 (purchase)')

    def _get_invoice_lines_values(self, line_values, pos_line, move_type):
        """Carry the POS line's id onto the CUSTOMER INVOICE line it becomes.

        Core links the invoice to the ORDER but not line-to-line, so the
        invoice report had no way to tell which family size a particular line
        was sold at - matching on product breaks as soon as one order sells the
        same package twice at different family sizes.

        This must hook `_get_invoice_lines_values`, not `_prepare_product_aml_dict`
        as it used to: the latter builds the SESSION's accounting journal
        entries, so the id was landing on the wrong records and the invoice line
        kept a null `pos_order_line_id`. That is what silently hid the
        "Members Included" row - the member type was stored correctly all along,
        the report just could not reach the line carrying it.
        """
        vals = super()._get_invoice_lines_values(line_values, pos_line, move_type)
        # Product lines only: core returns a bare line_section dict for a combo,
        # and an id on that would point the report at the wrong thing.
        if pos_line and vals.get('product_id'):
            vals['pos_order_line_id'] = pos_line.id
        return vals

    # ---- reschedule -----------------------------------------------------
    def _spa_reschedule_booking(self):
        """The spa.booking holding this order's appointment, created if needed.

        An order rung up at the counter has no booking: the customer paid and
        walked out, and the only date anywhere is `date_order`, which is when
        they PAID, not when they are coming. Rescheduling one therefore has to
        create the record that holds the appointment - otherwise the new date
        has nowhere to live and vanishes the moment the dialog closes.

        The id is stored back on the order, so rescheduling a second time moves
        the same booking instead of scattering duplicates.
        """
        self.ensure_one()
        Booking = self.env['spa.booking'].sudo()
        if self.spa_booking_ref:
            booking = Booking.browse(self.spa_booking_ref).exists()
            if booking:
                return booking

        templates = self.lines.mapped('product_id.product_tmpl_id')
        if not templates:
            return Booking

        partner = self.partner_id
        booking = Booking.create({
            'partner_name': partner.name or self.pos_reference or _('Customer'),
            # spa.booking.mobile is required, and a counter sale may have no
            # number at all - a placeholder beats refusing to reschedule.
            # getattr, not partner.mobile: Odoo 19 dropped res.partner.mobile
            # (it is folded into `phone`), so reading it directly raises. Same
            # defensive lookup whatsapp_email already uses.
            'mobile': (getattr(partner, 'mobile', '') or partner.phone or '-'),
            'partner_id': partner.id or False,
            'product_ids': [(6, 0, templates.ids)],
            'product_id': templates[0].id,
            'spa_channel': self.spa_channel or 'web',
            # The order may already know when the customer is coming - carried
            # over from an online booking, or set by an earlier reschedule.
            # Without seeding it here the FIRST reschedule of this order reads
            # as a first appointment ("from no date set"), so `moved` in
            # pos_reschedule is False: the Rescheduled flag is skipped and the
            # slot being vacated is never offered to the waiting list, even
            # though the appointment demonstrably changed.
            'slot_datetime': self.spa_slot_datetime or False,
            # Already paid for and confirmed - and 'approved' is a holding
            # state, so the booking properly occupies whatever slot it is given.
            'state': 'approved',
            'source': 'walk_in',
            'company_id': self.company_id.id,
        })
        self.sudo().spa_booking_ref = booking.id
        return booking

    # ---- family members -------------------------------------------------
    @api.model
    def _process_order(self, order, existing_order):
        """Drain what the POS parked on the order: the people, and the signatures.

        This is the first moment the order and its lines have server ids, which
        is why the POS parks both rather than creating the records itself. It
        also means an order rung up offline and synced later still works.

        Never allowed to break the sync: a failure here would reject an order
        the customer has already paid for, so each drain is logged and
        swallowed, and the payload is kept so it can be retried.
        """
        order_id = super()._process_order(order, existing_order)
        record = self.browse(order_id).sudo().exists()
        if not record:
            return order_id
        record._spa_drain('spa_members_json', record._spa_store_members_payload)
        record._spa_drain('spa_signatures_json', record._spa_store_signatures_payload)
        return order_id

    def _spa_drain(self, field, handler):
        """Run `handler` on the JSON parked in `field`, then clear it.

        Cleared only on success, so a failure leaves the data in place for a
        retry rather than losing it - that is what let the family members be
        recovered without re-selling anything.
        """
        self.ensure_one()
        raw = self[field]
        if not raw:
            return
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            _logger.warning("spa_online_booking: unreadable %s on order %s",
                            field, self.id)
            self[field] = False
            return
        try:
            handler(payload)
        except Exception:            # noqa: BLE001 - see docstring
            _logger.exception("spa_online_booking: %s drain failed on order %s",
                              field, self.id)
        else:
            self[field] = False

    def _spa_store_members_payload(self, people):
        self.spa_store_members(people)

    def _spa_store_signatures_payload(self, signatures):
        """Create the waiver signatures the POS collected, linked to their line.

        The POS cannot do this itself: at signing time the line has only a
        client-side UUID, and writing that into `pos_order_line_id` (an integer
        FK) made Postgres reject the whole insert. Lines are matched here by
        their `uuid`, which DOES survive the sync.
        """
        self.ensure_one()
        Signature = self.env['spa.service.signature'].sudo()
        by_uuid = {line.uuid: line for line in self.lines}
        for entry in signatures:
            line = by_uuid.get(entry.get('line_uuid'))
            if not line:
                _logger.warning(
                    "spa_online_booking: no line %s on order %s for a signature",
                    entry.get('line_uuid'), self.id)
                continue
            vals = {
                'pos_order_line_id': line.id,
                'product_tmpl_id': line.product_id.product_tmpl_id.id,
                'partner_id': (self.partner_id.id
                               if entry.get('is_lead') else False),
                'signature': entry.get('signature') or False,
                'terms_accepted': bool(entry.get('terms_accepted')),
                'client_name': entry.get('client_name') or '',
                'client_phone': entry.get('client_phone') or '',
                'client_email': entry.get('client_email') or '',
                'disclaimer_title': entry.get('disclaimer_title') or '',
                'disclaimer_body': entry.get('disclaimer_body') or '',
            }
            record = Signature.create(vals)
            # The line holds ONE id and it is the lead's, as before - the rest
            # are reached through pos_order_line_id, which now actually works.
            if entry.get('is_lead'):
                line.spa_signature_ref = record.id

    def spa_store_members(self, people):
        """Persist the people on a family sale as booking members.

        The counter flow had nowhere to put person 2. `spa.booking.member`
        requires a booking (booking_member.py), and Book Therapy never made
        one - so everyone past the lead survived only as their name inside the
        line's free-text note, and could not appear on the invoice, on the
        order card or in Contacts.

        Nothing new is invented here. It reuses the booking the reschedule flow
        already creates for a counter sale, then the same two methods the
        public website uses, so both channels end up with identically shaped
        records:

          _spa_set_members()          - the member rows, answers included
          _spa_resolve_member_partners() - a CHILD contact per person under the
                                        payer, matched on name + date of birth
                                        so the same family returning is not
                                        duplicated

        `people` is one dict per person in order, shaped as _spa_set_members
        documents. Returns the booking id so the POS can hold on to it.
        """
        self.ensure_one()
        order = self.sudo()
        if not people:
            return False
        booking = order._spa_reschedule_booking()
        if not booking:
            # No service line to hang a booking on - nothing to record, and
            # certainly not a reason to fail the sale.
            return False

        # Tell the booking what was actually sold, BEFORE adding anyone.
        # _spa_reschedule_booking() builds the record for RESCHEDULING, where
        # the member type is irrelevant, so it leaves the base type default -
        # and then _check_member_count rejects the very people we are adding
        # ("booked for 1 person(s) but 2 have been entered"). The line is the
        # authoritative record of the package that was bought.
        sold = order.lines.filtered(
            lambda l: l.spa_member_type and not l.spa_member_type.is_individual)[:1]
        if sold and booking.spa_member_type != sold.spa_member_type:
            booking.spa_member_type = sold.spa_member_type

        # A savepoint so a rejected booking leaves NOTHING behind. The caller
        # swallows failures - a paid sale must never be undone over this - but
        # without this the member rows written before the constraint fired would
        # still commit, leaving a booking its own constraint calls invalid.
        with self.env.cr.savepoint():
            booking._spa_set_members(people)
            # Contacts only once the members exist: the resolver files each
            # person under the payer, and reads the member rows to do it.
            booking._spa_resolve_member_partners()
        return booking.id

    def pos_reschedule(self, slot_str):
        """Move this order's appointment to another date and time.

        sudo() like the other POS-called methods here: cashiers are read-only on
        spa.booking. The payment is deliberately left alone - only the
        appointment moves.
        """
        self.ensure_one()
        order = self.sudo()
        booking = order._spa_reschedule_booking()
        if not booking:
            return {'error': _("This order has no service to reschedule.")}

        # A cancelled booking being given a new appointment has to come back to
        # a holding state. 'rejected' is not in _SPA_HOLDING_STATES, so
        # _spa_slot_holder cannot see it: the order would show a time that
        # nothing reserves, and the next customer would book straight over it
        # with no warning at all. Reviving to 'approved' matches what
        # _spa_reschedule_booking creates for a paid counter sale.
        #
        # Only from 'rejected' - a completed or paid booking keeps its state.
        if booking.state == 'rejected':
            booking.sudo().state = 'approved'
            booking.message_post(body=_(
                "Booking reopened because a new appointment was set from the "
                "point of sale."))

        old_slot = booking.slot_datetime
        products = booking._spa_slot_products()

        # Does somebody else already hold the time we are moving TO? Reception
        # is allowed to double-book deliberately, but should be told.
        target_taken = False
        new_slot = booking.pos_set_slot(slot_str)
        if not new_slot:
            return {'error': _("Could not read that date and time.")}
        booking.invalidate_recordset()
        if booking.slot_datetime:
            target_taken = bool(booking._spa_slot_holder(
                booking.slot_datetime, products, exclude_ids=booking.ids))

        # Two questions that used to share one answer, which is why the tab was
        # empty for the case reception actually uses.
        #
        # freed_slot: is a time being VACATED that somebody else could take?
        # Only when there was a previous appointment and it really changed -
        # promoting on a first appointment would hand out a slot nobody left.
        freed_slot = bool(old_slot and old_slot != booking.slot_datetime)
        #
        # rescheduled: did reception set this order's appointment from the
        # Reschedule button? That is what the tab answers - "this appointment
        # was handled here" - and it includes giving a counter sale its first
        # date. Tying it to freed_slot meant an order with no appointment yet
        # could never appear, and most have none: _spa_reschedule_booking()
        # creates their booking on the spot.
        rescheduled = bool(booking.slot_datetime)

        # The time it just LEFT is now free - hand it to whoever was queuing for
        # it, exactly as a cancellation would.
        if freed_slot:
            booking._spa_promote_slot(
                old_slot, products, exclude_ids=booking.ids,
                freed_by=booking.partner_name or booking.name)
            # Remember where it came from so Remove can step it back. Under
            # freed_slot only, which is already the right test: a first
            # appointment has nowhere to return to, and re-picking the identical
            # time must not overwrite an earlier, genuinely different previous
            # slot. One step is stored, deliberately - see _spa_undo_reschedule.
            booking.sudo().spa_prev_slot_datetime = old_slot

        # Mirror it onto the order so the POS card can show WHEN the customer is
        # coming, not just when they paid - and so the Orders date filter files
        # the order under the new day.
        vals = {'spa_slot_datetime': booking.slot_datetime,
                'spa_prev_slot_datetime': booking.spa_prev_slot_datetime}
        if rescheduled:
            # Sticky: it stays true for the life of the appointment, so the
            # Rescheduled tab and the card's pill keep telling reception that
            # this appointment has been set from here. pos_remove_appointment
            # clears it again along with the date.
            vals['spa_rescheduled'] = True
        order.write(vals)

        booking.message_post(body=_(
            "Appointment rescheduled from %(old)s to %(new)s by %(user)s.") % {
                'old': (old_slot.strftime('%Y-%m-%d %H:%M') if old_slot
                        else _("no date set")),
                'new': new_slot,
                'user': self.env.user.name,
        })
        return {
            'slot': new_slot,
            'booking_id': booking.id,
            'target_taken': target_taken,
        }

    def _spa_undo_reschedule(self, booking, prev):
        """Step this order's appointment back to where it was before the move.

        Only the date moves. The booking keeps whatever holding state it is in -
        this is not a cancellation, so action_reject() is deliberately NOT called
        and the booking never has to be revived.

        One step back, because one previous date is stored. After an undo there
        is nothing left to return to, so the button becomes Remove again and the
        next press cancels.
        """
        self.ensure_one()
        order = self.sudo()
        current = booking.slot_datetime
        products = booking._spa_slot_products()

        # Is the time we are going back to already held? Rescheduling away hands
        # the vacated slot to the waiting list in the same transaction, and a
        # promoted entry lands in 'pending' - a holding state - so by now it may
        # legitimately belong to somebody else, who has already been told so in
        # their own chatter. Warn rather than refuse: the forward path
        # double-books deliberately too, and reception can see both bookings.
        taken = bool(booking._spa_slot_holder(
            prev, products, exclude_ids=booking.ids))

        booking.sudo().write({
            'slot_datetime': prev,
            'spa_prev_slot_datetime': False,
        })

        # The time it is LEAVING is now free. Undoing has to offer it on exactly
        # as rescheduling does, or the slot sits with a queue nobody reaches.
        if current and current != prev:
            booking._spa_promote_slot(
                current, products, exclude_ids=booking.ids,
                freed_by=booking.partner_name or booking.name)

        order.write({
            'spa_slot_datetime': prev,
            'spa_prev_slot_datetime': False,
        })
        # spa_rescheduled is deliberately left as it is: the appointment WAS
        # moved from here, and clearing it would drop the order out of the very
        # tab reception is working in.

        booking.message_post(body=_(
            "Appointment moved back from %(old)s to %(new)s by %(user)s.") % {
                'old': (current.strftime('%Y-%m-%d %H:%M') if current
                        else _("no date set")),
                'new': prev.strftime('%Y-%m-%d %H:%M'),
                'user': self.env.user.name,
        })
        return {
            'undone': True,
            'slot': prev.strftime('%Y-%m-%d %H:%M'),
            'was': (current.strftime('%Y-%m-%d %H:%M') if current else ''),
            'target_taken': taken,
        }

    def pos_remove_appointment(self):
        """Step the appointment back, or cancel it when there is nowhere to go.

        Two jobs behind one button, chosen by whether a previous date is stored:

        * rescheduled at least once -> put it back to the date before that move
        * never rescheduled         -> cancel the appointment outright

        The POS order and its payment are untouched either way, exactly as with
        rescheduling: moving or dropping a date is not a decision about money.
        """
        self.ensure_one()
        order = self.sudo()
        if not order.spa_booking_ref:
            return {'error': _("There is no appointment on this order.")}
        booking = self.env['spa.booking'].sudo().browse(
            order.spa_booking_ref).exists()
        if not booking:
            return {'error': _("The booking for this order no longer exists.")}

        # Somewhere to go back to: step, do not cancel. Checked before the
        # rejected guard below, because a booking that was moved is still live
        # and that guard has nothing to say about it.
        if booking.spa_prev_slot_datetime:
            return order._spa_undo_reschedule(
                booking, booking.spa_prev_slot_datetime)
        # Refuse only when there is genuinely nothing left to do. Keying on the
        # booking's state alone left an order stuck: pressing Remove cancelled
        # the booking, a later Reschedule set a new date without reviving it, and
        # from then on the card showed an appointment that Remove would not
        # touch - "This appointment has already been removed." for ever, about a
        # date sitting right there on the screen.
        if booking.state == 'rejected' and not order.spa_slot_datetime:
            return {'error': _("This appointment has already been removed.")}

        was = booking.slot_datetime

        # action_reject cancels the booking AND frees its slot, promoting
        # whoever has waited longest. Deliberately NOT followed by a
        # _spa_promote_slot call: that would run the promotion a second time and
        # hand one slot to two people.
        #
        # Skipped when it is already cancelled - rejecting twice would run that
        # promotion a second time, which is the very thing the note above is
        # about. There is still the order's own appointment to clear below.
        if booking.state != 'rejected':
            booking.action_reject()

        # Cleared, so the card stops showing an appointment and the Orders date
        # filter files the order under its payment day again. The Rescheduled
        # flag goes with it: with no appointment there is no date for the
        # Rescheduled tab to list this order under.
        order.write({'spa_slot_datetime': False, 'spa_rescheduled': False,
                     'spa_prev_slot_datetime': False})
        booking.message_post(body=_(
            "Appointment removed (was %(when)s) by %(user)s. The booking is "
            "cancelled and the slot released.") % {
                'when': (was.strftime('%Y-%m-%d %H:%M') if was
                         else _("no date set")),
                'user': self.env.user.name,
        })
        return {'removed': True, 'was': (was.strftime('%Y-%m-%d %H:%M')
                                         if was else '')}

    @api.model_create_multi
    def create(self, vals_list):
        orders = super().create(vals_list)
        orders._create_session_passes()
        return orders

    def write(self, vals):
        res = super().write(vals)
        if 'state' in vals:
            self._create_session_passes()
        return res
