import re
from datetime import datetime

from odoo import api, fields, models


class SpaSessionPass(models.Model):
    """A prepaid balance of sessions a customer bought as a package (e.g. a
    Commit Pack 8+1 = 9 sessions). Created automatically when the package is
    paid; each visit redeems one session until none remain. No expiry."""
    _name = 'spa.session.pass'
    _description = 'Session Pass'
    _order = 'create_date desc'

    name = fields.Char(string='Reference', default='New', copy=False, readonly=True)
    partner_id = fields.Many2one(
        'res.partner', string='Customer', required=True, index=True)
    product_tmpl_id = fields.Many2one('product.template', string='Package')
    sessions_total = fields.Integer(string='Total Sessions', required=True)
    sessions_used = fields.Integer(string='Used', default=0)
    sessions_left = fields.Integer(
        string='Remaining', compute='_compute_left', store=True)
    state = fields.Selection(
        [('active', 'Active'), ('completed', 'Completed')],
        default='active', index=True)
    purchase_date = fields.Datetime(default=lambda self: fields.Datetime.now())
    channel = fields.Selection(
        [('online', 'Online'), ('web', 'Web'), ('tab', 'Tab')],
        string='Bought via')
    pos_order_id = fields.Many2one('pos.order', string='Source Order', index=True)
    source_line_id = fields.Many2one(
        'pos.order.line', index=True, help="One pass per order line (idempotency).")
    company_id = fields.Many2one(
        'res.company', default=lambda self: self.env.company)
    use_ids = fields.One2many(
        'spa.session.pass.use', 'pass_id', string='Sessions Used')
    booking_ids = fields.One2many(
        'spa.booking', 'session_pass_id', string='Scheduled Sessions')

    @api.depends('sessions_total', 'sessions_used')
    def _compute_left(self):
        for rec in self:
            rec.sessions_left = max((rec.sessions_total or 0) - (rec.sessions_used or 0), 0)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name') or vals['name'] == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'spa.session.pass') or 'PASS'
        return super().create(vals_list)

    def action_use_session(self, note=False):
        """Redeem one session (a visit). Logs it and completes the pass when
        the balance reaches zero."""
        for rec in self:
            if rec.sessions_left <= 0:
                continue
            rec.sessions_used += 1
            self.env['spa.session.pass.use'].create({
                'pass_id': rec.id,
                'note': note or '',
            })
            if rec.sessions_left <= 0:
                rec.state = 'completed'
        return True

    def schedule_next_session(self, slot_str):
        """Book the customer's NEXT prepaid session at a chosen date/time.
        Creates an approved spa.booking on the SAME channel the package was
        bought through (web -> Web tab, online -> Online tab, tab -> Tab tab),
        so it shows under that channel's Upcoming list, linked back to this pass.
        Does NOT consume a session now — that happens when the customer arrives
        and it's redeemed. `slot_str` is local wall-clock 'YYYY-MM-DD HH:MM'.
        """
        self.ensure_one()
        if self.sessions_left <= 0:
            return {'error': 'no_sessions_left'}
        value = (slot_str or '').strip().replace('T', ' ')
        slot_dt = False
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S'):
            try:
                slot_dt = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
        if not slot_dt:
            return {'error': 'invalid_slot'}
        partner = self.partner_id
        tmpl = self.product_tmpl_id
        vals = {
            'partner_id': partner.id,
            'partner_name': partner.name,
            'mobile': partner.phone or '',
            'whatsapp_number': getattr(partner, 'whatsapp', '') or '',
            'spa_channel': self.channel or 'web',
            'state': 'approved',
            'slot_datetime': slot_dt,
            'session_pass_id': self.id,
            'company_id': self.company_id.id,
        }
        if tmpl:
            vals['product_ids'] = [(6, 0, tmpl.ids)]
            vals['product_id'] = tmpl.id
        booking = self.env['spa.booking'].sudo().create(vals)
        return {
            'booking_ref': booking.name,
            'slot': fields.Datetime.to_string(slot_dt),
        }

    def pos_redeem_session(self):
        """POS 'Redeem' — send a prepaid session to reception for approval.

        Instead of counting the session immediately, this creates a PENDING
        booking linked to this pass (and to the pass's OWN customer), so it
        shows under POS -> Orders -> Sessions -> Pending Approval. The session
        is counted against the pass only when reception marks it Done — exactly
        like the tablet redeem — so nothing is lost if it's abandoned.
        """
        pass_rec = self.sudo()
        pass_rec.ensure_one()
        if pass_rec.sessions_left <= 0:
            return {'error': 'no_sessions_left'}
        partner = pass_rec.partner_id
        tmpl = pass_rec.product_tmpl_id
        # "Now" as local wall-clock (slot_datetime is stored naive/local).
        now = fields.Datetime.context_timestamp(
            pass_rec, fields.Datetime.now()).replace(tzinfo=None)
        vals = {
            'partner_id': partner.id,
            'partner_name': partner.name,
            'mobile': partner.phone or '',
            'whatsapp_number': getattr(partner, 'whatsapp', '') or '',
            'spa_channel': pass_rec.channel or 'web',
            'state': 'pending',
            'slot_datetime': now,
            'session_pass_id': pass_rec.id,
            'company_id': pass_rec.company_id.id,
        }
        if tmpl:
            vals['product_ids'] = [(6, 0, tmpl.ids)]
            vals['product_id'] = tmpl.id
        booking = self.env['spa.booking'].sudo().create(vals)
        return {
            'booking_ref': booking.name,
            'id': booking.id,
            'sessions_left': pass_rec.sessions_left,
        }


    # ---- POS "Customer Details": per-service Q&A + full report ----------
    def _spa_fmt_dt(self, dt, from_utc=True):
        """Datetime -> '08 Mar 2026, 9:30 AM' in the user's timezone. Pass
        from_utc=False for slot_datetime, stored as local wall clock."""
        if not dt:
            return ''
        if from_utc:
            dt = fields.Datetime.context_timestamp(self, dt)
        return '%s, %s' % (dt.strftime('%d %b %Y'),
                           dt.strftime('%I:%M %p').lstrip('0'))

    @staticmethod
    def _spa_or(domains):
        """OR a list of domains together (empty ones dropped)."""
        domains = [d for d in domains if d]
        if not domains:
            return [('id', '=', False)]
        result = domains[0]
        for dom in domains[1:]:
            result = ['|'] + result + dom
        return result

    def _spa_answer_bookings(self):
        """Every booking of THIS customer for THIS service - that's where the
        questionnaire they filled in lives.

        Two things make a plain partner_id + product_tmpl_id lookup miss almost
        everything:
          * online bookings are created by the public user and often carry NO
            partner_id, only the name/number the customer typed, so we match on
            phone / WhatsApp / name too;
          * questions belong to the THERAPY (the POS category), not to one
            package, so the answers for a therapy's single session are the same
            questionnaire as for its 12+2 pack - we accept every service filed
            under the same therapy.
        """
        self.ensure_one()
        Booking = self.env['spa.booking'].sudo()
        # A one-off session reports on ITS visit only - no widening.
        if 'spa_scope_booking_ids' in self.env.context:
            return Booking.browse(
                self.env.context['spa_scope_booking_ids']).exists()
        bookings = self.booking_ids.sudo()
        order = self.pos_order_id.sudo()
        if order and order.spa_booking_ref:
            bookings |= Booking.browse(order.spa_booking_ref).exists()

        partner, tmpl = self.partner_id, self.product_tmpl_id
        if partner and tmpl:
            numbers = {(partner.phone or '').strip(),
                       (getattr(partner, 'whatsapp', '') or '').strip()} - {''}
            # Phone/name is only a fallback for bookings that were never linked
            # to a contact. Applying it to bookings that ALREADY name someone
            # else would show a second customer their neighbour's answers -
            # families share a number often enough for that to be real.
            loose = [[('mobile', '=', n)] for n in numbers]
            loose += [[('whatsapp_number', '=', n)] for n in numbers]
            if partner.name:
                loose.append([('partner_name', '=ilike', partner.name)])
            who = [[('partner_id', '=', partner.id)]]
            if loose:
                who.append([('partner_id', '=', False)] + self._spa_or(loose))

            # every service of the same therapy, so a pack shows the answers
            # given for that therapy on any of its services
            services = self._spa_service_templates()
            what = self._spa_or([[('product_ids', 'in', services.ids)],
                                 [('product_id', 'in', services.ids)]])
            bookings |= Booking.search(self._spa_or(who) + what)

        epoch = fields.Datetime.from_string('1970-01-01 00:00:00')
        return bookings.sorted(key=lambda b: (b.create_date or epoch, b.id),
                               reverse=True)

    def _spa_service_templates(self):
        """This pass' service plus every sibling service of the same therapy."""
        self.ensure_one()
        tmpl = self.product_tmpl_id
        services = tmpl
        therapies = tmpl.pos_categ_ids.filtered('spa_is_therapy')
        if therapies:
            services |= self.env['product.template'].sudo().search(
                [('pos_categ_ids', 'in', therapies.ids)])
        return services

    def _spa_related_orders(self):
        """Every POS order that billed this customer for THIS service, not just
        the package purchase: a session settled on its own, a re-print, a top-up
        - each is its own receipt with its own amount due."""
        self.ensure_one()
        Order = self.env['pos.order'].sudo()
        epoch = fields.Datetime.from_string('1970-01-01 00:00:00')
        if 'spa_scope_order_ids' in self.env.context:
            return Order.browse(
                self.env.context['spa_scope_order_ids']).exists().sorted(
                    key=lambda o: (o.date_order or epoch, o.id))
        orders = self.pos_order_id.sudo()
        if self.booking_ids:
            orders |= Order.search(
                [('spa_booking_ref', 'in', self.booking_ids.ids)])
        partner, tmpl = self.partner_id, self.product_tmpl_id
        if partner and tmpl:
            # Exact product only here (not the therapy's siblings): a receipt
            # for a different package would show up as this one's due.
            orders |= Order.search([
                ('partner_id', '=', partner.id),
                ('lines.product_id.product_tmpl_id', '=', tmpl.id),
            ])
            # ...and drop the purchase receipts that belong to the customer's
            # OTHER passes, so two packs of the same product don't each claim
            # both receipts.
            others = self.search([
                ('partner_id', '=', partner.id), ('id', '!=', self.id),
            ]).mapped('pos_order_id')
            orders -= (others - self.pos_order_id)
        return orders.sorted(key=lambda o: (o.date_order or epoch, o.id))

    def _spa_parse_note(self, note, questions):
        """Turn a POS customer note back into question/answer rows.

        A therapy rung up straight at the counter creates NO spa.booking - the
        questionnaire is written onto the order line as
        'Question: Answer | Question: Answer'. Split it on the service's REAL
        question texts, so an answer that itself contains ': ' or ' | ' doesn't
        shift everything one column across.
        """
        note = (note or '').strip()
        if not note:
            return []
        names = sorted({q.name for q in questions if q.name}, key=len, reverse=True)
        if names:
            pattern = (r'(?:^|\s*\|\s*)('
                       + '|'.join(re.escape(n) for n in names)
                       + r')\s*:\s*')
            parts = re.split(pattern, note)
            walk = iter(parts[1:])
            rows = [{'question': q, 'answer': a.strip().strip('|').strip()}
                    for q, a in zip(walk, walk) if a.strip().strip('|').strip()]
            if rows:
                return rows
        # Nothing matched a known question (renamed? deleted?) - fall back to
        # the raw shape rather than dropping the answers on the floor.
        rows = []
        for chunk in note.split('|'):
            question, sep, answer = chunk.partition(':')
            if sep and answer.strip():
                rows.append({'question': question.strip(), 'answer': answer.strip()})
        return rows

    def _spa_answer_groups(self):
        """The questionnaire answers grouped per visit, one row per question, so
        the POS can list them question-by-question instead of one long line.

        Answers reach us two ways and BOTH are read here: on a spa.booking (the
        online / tablet / link flows) and on the POS order line's customer note
        (a therapy rung up directly at the counter, which creates no booking).
        Each group carries the signature given for THAT visit, from whichever
        of the two it came from, so the report can show what the customer
        actually signed beside the answers they gave.
        """
        self.ensure_one()
        epoch = fields.Datetime.from_string('1970-01-01 00:00:00')
        dated, seen = [], set()

        def add(when, group):
            # The note on an order line is a copy of its booking's answers, so
            # the same questionnaire can arrive twice - keep the first.
            key = frozenset((r['question'], r['answer']) for r in group['rows'])
            if key in seen:
                return
            seen.add(key)
            dated.append((when or epoch, group))

        for booking in self._spa_answer_bookings():
            rows = [{
                'question': a.question_id.name or '',
                'answer': a.value_text or '',
            } for a in booking.answer_ids if a.value_text]
            if rows:
                signature = booking.signature or b''
                add(booking.create_date, {
                    'booking': booking.name or '',
                    'date': (self._spa_fmt_dt(booking.slot_datetime, from_utc=False)
                             or self._spa_fmt_dt(booking.create_date)),
                    'services': (booking.product_ids or booking.product_id).mapped('name'),
                    'from_receipt': False,
                    'rows': rows,
                    'signature': signature.decode() if signature else '',
                    'terms_accepted': bool(booking.terms_accepted),
                })

        services = self._spa_service_templates()
        questions = services._spa_questions()
        # A one-off session answers only for ITS line: a receipt that mixed a
        # single session and a package holds a separate note per line.
        only_lines = self.env.context.get('spa_scope_line_ids')
        for order in self._spa_related_orders():
            for line in order.lines:
                if only_lines and line.id not in only_lines:
                    continue
                if not only_lines and line.product_id.product_tmpl_id not in services:
                    continue
                rows = self._spa_parse_note(line.customer_note, questions)
                if rows:
                    line_sig = line._spa_signature()
                    signature = line_sig.signature or b''
                    add(order.date_order, {
                        'booking': order.pos_reference or order.name or '',
                        'date': self._spa_fmt_dt(order.date_order),
                        'services': [line.product_id.name],
                        'from_receipt': True,
                        'order_id': order.id,
                        'invoice': order.account_move.name or '',
                        'rows': rows,
                        'signature': signature.decode() if signature else '',
                        'terms_accepted': bool(line_sig.terms_accepted),
                    })

        return [g for _when, g in sorted(dated, key=lambda x: x[0], reverse=True)]

    def pos_pass_answers(self):
        """POS button: the questions this customer answered for this service."""
        self.ensure_one()
        rec = self.sudo()
        return {
            'pass_name': rec.name or '',
            'package': rec.product_tmpl_id.display_name or '',
            'customer': rec.partner_id.name or '',
            'groups': rec._spa_answer_groups(),
        }

    # ---- one-off sessions (no package pass) -----------------------------
    @api.model
    def pos_customer_singles(self, partner_id):
        """Every therapy visit of this customer that is NOT a package pass:
        one-off sessions bought at the counter or online, plus bookings that
        haven't been billed yet.

        Passes only exist for multi-session packages, so a customer who only
        ever took single sessions showed up as "No packages for this customer"
        - their visit, answers and receipt were all unreachable from here.
        """
        partner = self.env['res.partner'].sudo().browse(partner_id)
        if not partner.exists():
            return []
        epoch = fields.Datetime.from_string('1970-01-01 00:00:00')
        Order = self.env['pos.order'].sudo()
        rows = []

        lines = self.env['pos.order.line'].sudo().search([
            ('order_id.partner_id', '=', partner_id),
            ('product_id.product_tmpl_id.pos_categ_ids.spa_is_therapy', '=', True),
        ])
        for line in lines:
            tmpl = line.product_id.product_tmpl_id
            if (tmpl.spa_session_count or 0) > 1:
                continue                    # a package - listed as its pass
            order = line.order_id
            due = round((order.amount_total or 0.0) - (order.amount_paid or 0.0), 2)
            rows.append((order.date_order or epoch, {
                'key': 'line-%s' % line.id,
                'kind': 'line',
                'line_id': line.id,
                'order_id': order.id,
                'booking_id': order.spa_booking_ref or 0,
                'tmpl_id': tmpl.id,
                'name': tmpl.display_name or '',
                'ref': order.pos_reference or order.name or '',
                'date': self._spa_fmt_dt(order.date_order),
                'total': line.price_subtotal_incl or 0.0,
                'state_label': 'Paid' if due <= 0 else 'Payment due',
                'is_paid': due <= 0,
            }))

        # bookings that never became a receipt - the visit is still owed
        billed = set(Order.search([
            ('partner_id', '=', partner_id), ('spa_booking_ref', '!=', 0),
        ]).mapped('spa_booking_ref'))
        labels = dict(self.env['spa.booking']._fields['state'].selection)
        for booking in self.env['spa.booking'].sudo().search([
            ('partner_id', '=', partner_id), ('session_pass_id', '=', False),
        ]):
            if booking.id in billed:
                continue
            services = booking.product_ids or booking.product_id
            rows.append((booking.create_date or epoch, {
                'key': 'booking-%s' % booking.id,
                'kind': 'booking',
                'line_id': 0,
                'order_id': 0,
                'booking_id': booking.id,
                'tmpl_id': services[:1].id,
                'name': ', '.join(services.mapped('name')),
                'ref': booking.name or '',
                'date': (self._spa_fmt_dt(booking.slot_datetime, from_utc=False)
                         or self._spa_fmt_dt(booking.create_date)),
                'total': booking.price or 0.0,
                'state_label': labels.get(booking.state, booking.state),
                'is_paid': booking.state == 'paid',
            }))

        rows.sort(key=lambda r: r[0], reverse=True)
        return [row for _when, row in rows]

    @api.model
    def _spa_single_ghost(self, tmpl_id, partner_id, order_id=False, booking_id=False,
                          line_id=False):
        """An in-memory stand-in for a pass, so one-off sessions can reuse the
        whole pass reporting path. Never saved."""
        ghost = self.new({
            'partner_id': partner_id,
            'product_tmpl_id': tmpl_id,
            'pos_order_id': order_id or False,
            'sessions_total': 1,
            'sessions_used': 1 if order_id else 0,
        })
        bookings = []
        if booking_id:
            bookings = [booking_id]
        elif order_id:
            ref = self.env['pos.order'].sudo().browse(order_id).spa_booking_ref
            if ref:
                bookings = [ref]
        return ghost.with_context(
            spa_scope_order_ids=[order_id] if order_id else [],
            spa_scope_booking_ids=bookings,
            spa_scope_line_ids=[line_id] if line_id else [])

    @api.model
    def pos_single_answers(self, tmpl_id, partner_id, order_id=False, booking_id=False,
                           line_id=False):
        """POS button: the questions answered for ONE one-off session."""
        ghost = self._spa_single_ghost(tmpl_id, partner_id, order_id, booking_id, line_id)
        return {
            'pass_name': '',
            'package': self.env['product.template'].browse(tmpl_id).display_name or '',
            'customer': self.env['res.partner'].browse(partner_id).name or '',
            'groups': ghost._spa_answer_groups(),
        }

    @api.model
    def pos_single_report(self, tmpl_id, partner_id, order_id=False, booking_id=False,
                          line_id=False):
        """POS 'Reports' button for ONE one-off session: same report as a
        package, scoped to that single visit and its own receipt."""
        ghost = self._spa_single_ghost(tmpl_id, partner_id, order_id, booking_id, line_id)
        data = ghost.pos_pass_report()
        line = self.env['pos.order.line'].sudo().browse(line_id) if line_id else None
        order = self.env['pos.order'].sudo().browse(order_id) if order_id else None
        booking = (self.env['spa.booking'].sudo().browse(booking_id)
                   if booking_id else None)
        labels = dict(self.env['spa.booking']._fields['state'].selection)
        channels = dict(self.env['pos.order']._fields['spa_channel'].selection)

        if order:
            data.update({
                'state_label': 'Paid' if data['amount_due'] <= 0 else 'Payment due',
                'purchase_date': ghost._spa_fmt_dt(order.date_order),
                'channel_label': channels.get(order.spa_channel, ''),
                'sessions_used': 1,
                'sessions_left': 0,
                'session_price': (line.price_subtotal_incl or 0.0) if line
                                 else data['amount_total'],
                'sessions': [{
                    'no': 1,
                    'status': 'completed',
                    'status_label': 'Completed',
                    'date': ghost._spa_fmt_dt(order.date_order),
                    'note': order.pos_reference or order.name or '',
                    'by': '',
                    'value': (line.price_subtotal_incl or 0.0) if line
                             else data['amount_total'],
                }],
            })
        else:
            # Booked but never billed: the whole price is still outstanding.
            price = booking.price if booking else 0.0
            data.update({
                'state_label': labels.get(booking.state, '') if booking else '',
                'purchase_date': '',
                'channel_label': (channels.get(booking.spa_channel, '')
                                  if booking else ''),
                'amount_total': price,
                'amount_paid': 0.0,
                'amount_due': price,
                'per_session': price,
                'session_price': price,
                'sessions_used': 0,
                'sessions_left': 1,
                'sessions': [{
                    'no': 1,
                    'status': ('scheduled' if booking and booking.state in
                               ('pending', 'approved', 'in_service') else 'open'),
                    'status_label': (labels.get(booking.state, '')
                                     if booking else 'Not taken'),
                    'date': (ghost._spa_fmt_dt(booking.slot_datetime, from_utc=False)
                             if booking else ''),
                    'note': booking.name if booking else '',
                    'by': '',
                    'value': price,
                }],
            })
        data.update({
            'sessions_total': 1,
            'pass_name': booking.name if booking else '',
            'single': True,
        })
        return data

    def pos_pass_report(self):
        """POS 'Reports' button: the full picture for ONE purchased service -
        the invoice/receipt it was billed on, what was paid and what is still
        due, every session with its status, and the customer's answers."""
        self.ensure_one()
        rec = self.sudo()
        order = rec.pos_order_id
        currency = order.currency_id or rec.company_id.currency_id

        # One service can be billed on several receipts (and several invoices).
        # Add them all up, and keep each one's own due visible.
        documents, payments = [], []
        total = paid = 0.0
        for doc in rec._spa_related_orders():
            doc_total = doc.amount_total or 0.0
            doc_paid = doc.amount_paid or 0.0
            total += doc_total
            paid += doc_paid
            documents.append({
                'order_ref': doc.name or '',
                'receipt': doc.pos_reference or '',
                'invoice': doc.account_move.name or '',
                'invoice_state': doc.account_move.payment_state or '',
                'date': rec._spa_fmt_dt(doc.date_order),
                'total': doc_total,
                'paid': doc_paid,
                'due': round(doc_total - doc_paid, 2),
                'is_source': doc.id == order.id,
            })
            for p in doc.payment_ids:
                payments.append({
                    'receipt': doc.pos_reference or doc.name or '',
                    'method': p.payment_method_id.name or '',
                    'amount': p.amount,
                    'date': rec._spa_fmt_dt(p.payment_date),
                    'is_change': p.is_change,
                })
        total = round(total, 2)
        paid = round(paid, 2)
        due = round(total - paid, 2)

        # Per-session value comes from the package purchase alone - later
        # receipts are extras, not part of what one session cost.
        pkg_total = order.amount_total or 0.0
        per_session = round(pkg_total / rec.sessions_total, 2) if rec.sessions_total else 0.0

        # Sessions 1..N: the first ones are the visits actually logged, the rest
        # are still owed - showing the booked slot when one is already set.
        epoch = fields.Datetime.from_string('1970-01-01 00:00:00')
        uses = rec.use_ids.sorted(key=lambda u: (u.date or epoch, u.id))
        labels = dict(self.env['spa.booking']._fields['state'].selection)
        upcoming = [b for b in rec.booking_ids.sorted(
            key=lambda b: (b.slot_datetime or b.create_date or epoch, b.id))
            if b.state in ('pending', 'approved', 'in_service')]
        sessions = []
        for idx in range(max(rec.sessions_total, len(uses))):
            if idx < len(uses):
                use = uses[idx]
                sessions.append({
                    'no': idx + 1,
                    'status': 'completed',
                    'status_label': 'Completed',
                    'date': rec._spa_fmt_dt(use.date),
                    'note': use.note or '',
                    'by': use.user_id.name or '',
                    'value': per_session,
                })
            else:
                booking = upcoming.pop(0) if upcoming else None
                sessions.append({
                    'no': idx + 1,
                    'status': 'scheduled' if booking else 'open',
                    'status_label': (labels.get(booking.state, booking.state)
                                     if booking else 'Not taken'),
                    'date': (rec._spa_fmt_dt(booking.slot_datetime, from_utc=False)
                             if booking else ''),
                    'note': booking.name if booking else '',
                    'by': '',
                    'value': per_session,
                })

        return {
            'pass_name': rec.name or '',
            'package': rec.product_tmpl_id.display_name or '',
            'customer': rec.partner_id.name or '',
            'state_label': 'Active' if rec.state == 'active' else 'Completed',
            'channel_label': dict(rec._fields['channel'].selection).get(rec.channel, ''),
            'purchase_date': rec._spa_fmt_dt(rec.purchase_date),
            'sessions_total': rec.sessions_total,
            'sessions_used': rec.sessions_used,
            'sessions_left': rec.sessions_left,
            'order_ref': order.name or '',
            'receipt_ref': order.pos_reference or '',
            'invoice': order.account_move.name or '',
            'invoice_state': order.account_move.payment_state or '',
            'currency': currency.symbol or '',
            'amount_total': total,
            'amount_paid': paid,
            'amount_due': due,
            'per_session': per_session,
            'invoices': [d['invoice'] for d in documents if d['invoice']],
            'documents': documents,
            'payments': payments,
            'sessions': sessions,
            'answers': rec._spa_answer_groups(),
        }


class SpaSessionPassUse(models.Model):
    """One redeemed session (visit) against a pass — the usage history."""
    _name = 'spa.session.pass.use'
    _description = 'Session Pass Usage'
    _order = 'date desc, id desc'

    pass_id = fields.Many2one(
        'spa.session.pass', string='Pass', required=True, ondelete='cascade', index=True)
    date = fields.Datetime(default=lambda self: fields.Datetime.now())
    note = fields.Char()
    user_id = fields.Many2one(
        'res.users', string='By', default=lambda self: self.env.user)
