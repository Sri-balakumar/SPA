from odoo import api, fields, models

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

        for line in order.lines:
            tmpl = line.product_id.product_tmpl_id
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
                })

        # A therapy booked online answered its questions on the spa.booking, not
        # on the order line - read those too, or an online sale prints blank.
        if order.spa_booking_ref:
            booking = self.env['spa.booking'].sudo().browse(order.spa_booking_ref)
            if booking.exists():
                rows = [{
                    'question': a.question_id.name or '',
                    'answer': a.value_text or '',
                } for a in booking.answer_ids if a.value_text]
                # The line note is a copy of the booking's answers, so the same
                # questionnaire can arrive twice - keep the first.
                booked_sig = booking.signature or b''
                booked_sig = booked_sig.decode() if booked_sig else ''
                if booked_sig and not sheet_signature:
                    sheet_signature = booked_sig
                if rows and not any(g['rows'] == rows for g in groups):
                    booked = booking.product_ids or booking.product_id
                    groups.append({
                        'service': ', '.join(booked.mapped('name')),
                        'ref': booking.name or order_ref,
                        'invoice': invoice,
                        'date': when,
                        'rows': rows,
                        'signature': booked_sig,
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
