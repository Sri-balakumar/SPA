from odoo import _, fields, models, tools
from odoo.exceptions import UserError

# One row per SESSION GIVEN, gathered from the three places a session can live.
# Read-only: it is a SQL view, so it is always in step with the data and there
# is nothing to recompute or keep in sync.
#
# The three sources, and why each is needed:
#
#   sale     a pos.order.line for a therapy product. This is a single session
#            sold over the counter or online. PACKAGES ARE EXCLUDED here
#            (spa_session_count > 1) - buying a 9-session pack is one purchase,
#            not nine sessions given, and its sessions arrive one at a time as
#            'prepaid' rows below. Counting both would inflate every therapist's
#            numbers by the whole pack the moment it was sold.
#
#   prepaid  a spa.session.pass.use - one visit redeemed off a package. Value is
#            the package price divided by its session count, so a Commit Pack
#            8+1 contributes its real per-visit worth instead of nothing.
#
#   booking  a spa.booking that has NOT been redeemed and has NOT become an
#            order. This is work still ahead - what makes "how many finished"
#            answerable against "how many booked". Once it is billed or
#            redeemed it is excluded here and appears as one of the rows above,
#            so a session is never counted twice.
QUERY = """
    SELECT
        (line.id * 10 + 1)                          AS id,
        'sale'                                      AS source,
        pos.date_order                              AS date,
        line.spa_therapist_id                       AS assignee_id,
        pos.partner_id                              AS partner_id,
        pos.id                                      AS order_id,
        NULL::integer                               AS pass_id,
        variant.product_tmpl_id                     AS product_tmpl_id,
        therapy.pos_category_id                     AS therapy_id,
        pos.spa_channel                             AS channel,
        CASE WHEN pos.state IN ('paid', 'done', 'invoiced') THEN 'done'
             WHEN pos.state = 'cancel'                      THEN 'cancelled'
             ELSE 'open' END                        AS state,
        ROUND(GREATEST(line.qty, 0))::integer       AS session_count,
        line.price_subtotal_incl                    AS amount,
        pos.company_id                              AS company_id
    FROM pos_order_line line
    JOIN pos_order pos          ON pos.id = line.order_id
    JOIN product_product variant ON variant.id = line.product_id
    JOIN product_template tmpl   ON tmpl.id = variant.product_tmpl_id
    JOIN LATERAL (
        SELECT rel.pos_category_id
        FROM pos_category_product_template_rel rel
        JOIN pos_category cat ON cat.id = rel.pos_category_id
                             AND cat.spa_is_therapy
        WHERE rel.product_template_id = variant.product_tmpl_id
        ORDER BY rel.pos_category_id
        LIMIT 1
    ) therapy ON TRUE
    WHERE COALESCE(tmpl.spa_session_count, 1) <= 1

    UNION ALL

    SELECT
        (spa_use.id * 10 + 2),
        'prepaid',
        spa_use.date,
        spa_use.spa_therapist_id,
        spa_pack.partner_id,
        spa_pack.pos_order_id,
        spa_pack.id,
        spa_pack.product_tmpl_id,
        therapy.pos_category_id,
        spa_pack.channel,
        'done',
        1,
        CASE WHEN COALESCE(spa_pack.sessions_total, 0) > 0
             THEN COALESCE(src.amount_total, 0) / spa_pack.sessions_total
             ELSE 0 END,
        spa_pack.company_id
    FROM spa_session_pass_use spa_use
    JOIN spa_session_pass spa_pack ON spa_pack.id = spa_use.pass_id
    LEFT JOIN pos_order src    ON src.id = spa_pack.pos_order_id
    LEFT JOIN LATERAL (
        SELECT rel.pos_category_id
        FROM pos_category_product_template_rel rel
        JOIN pos_category cat ON cat.id = rel.pos_category_id
                             AND cat.spa_is_therapy
        WHERE rel.product_template_id = spa_pack.product_tmpl_id
        ORDER BY rel.pos_category_id
        LIMIT 1
    ) therapy ON TRUE

    UNION ALL

    SELECT
        (booking.id * 10 + 3),
        'booking',
        -- slot_datetime is stored as LOCAL wall clock, not UTC (spa_booking
        -- documents this), while every Datetime Odoo reads out of a view is
        -- taken to be UTC and converted to the reader's timezone. Left raw, a
        -- 2:30 PM appointment in Muscat would report at 6:30 PM and land on
        -- the wrong day either side of midnight - fatal for a day-wise count.
        -- Converted here through the COMPANY's timezone; no tz on file means
        -- 'UTC', which leaves the value exactly as it was.
        COALESCE(
            (booking.slot_datetime AT TIME ZONE COALESCE(comp_tz.tz, 'UTC'))
                AT TIME ZONE 'UTC',
            booking.create_date),
        booking.spa_therapist_id,
        booking.partner_id,
        NULL::integer,
        booking.session_pass_id,
        booking.product_id,
        therapy.pos_category_id,
        booking.spa_channel,
        CASE WHEN booking.state = 'rejected' THEN 'cancelled'
             ELSE 'scheduled' END,
        1,
        0,
        booking.company_id
    FROM spa_booking booking
    LEFT JOIN res_company comp     ON comp.id = booking.company_id
    LEFT JOIN res_partner comp_tz  ON comp_tz.id = comp.partner_id
    LEFT JOIN LATERAL (
        SELECT rel.pos_category_id
        FROM pos_category_product_template_rel rel
        JOIN pos_category cat ON cat.id = rel.pos_category_id
                             AND cat.spa_is_therapy
        WHERE rel.product_template_id = booking.product_id
        ORDER BY rel.pos_category_id
        LIMIT 1
    ) therapy ON TRUE
    WHERE booking.state IN ('pending', 'approved', 'in_service', 'rejected')
      AND NOT COALESCE(booking.session_redeemed, FALSE)
      AND NOT EXISTS (
          SELECT 1 FROM pos_order billed
          WHERE billed.spa_booking_ref = booking.id
      )
"""


class SpaServiceSession(models.Model):
    _name = 'spa.service.session'
    _description = 'Service Session by Assignee'
    _auto = False
    _order = 'date desc'
    _rec_name = 'product_tmpl_id'

    date = fields.Datetime(string='Date', readonly=True)
    assignee_id = fields.Many2one(
        'res.users', string='Assignee', readonly=True,
        help="Member of staff who gave, or is booked to give, this session. "
             "Empty means nobody has been assigned yet.")
    partner_id = fields.Many2one('res.partner', string='Customer', readonly=True)
    order_id = fields.Many2one(
        'pos.order', string='Order', readonly=True,
        help="The receipt this session was sold on. For a package session "
             "it is the order the PACKAGE was bought on, so every visit "
             "off a pack groups under the one order that paid for it.")
    pass_id = fields.Many2one(
        'spa.session.pass', string='Package', readonly=True,
        help="Set for a session that comes off a prepaid package. Its "
             "total / used / remaining counts live on the package itself.")
    product_tmpl_id = fields.Many2one(
        'product.template', string='Service', readonly=True)
    therapy_id = fields.Many2one('pos.category', string='Therapy', readonly=True)
    channel = fields.Selection(
        [('online', 'Online'), ('web', 'Web'), ('tab', 'Tab')],
        string='Channel', readonly=True)
    source = fields.Selection(
        [('sale', 'Single Session'),
         ('prepaid', 'Package Session'),
         ('booking', 'Booked')],
        string='Type', readonly=True)
    state = fields.Selection(
        [('open', 'Open'),
         ('scheduled', 'Scheduled'),
         ('done', 'Finished'),
         ('cancelled', 'Cancelled')],
        string='Status', readonly=True)
    session_count = fields.Integer(
        string='Sessions', readonly=True,
        help="Always 1 for a package or booked session; the quantity sold for "
             "a single session line.")
    amount = fields.Float(string='Value', readonly=True)
    company_id = fields.Many2one('res.company', string='Company', readonly=True)

    # ---- detail screen --------------------------------------------------
    # Everything below is RELATED, therefore computed and non-stored, which is
    # the only kind of field a `_auto = False` model may carry: the SQL view has
    # no columns for them and nothing writes them. They exist so that opening a
    # row shows the whole picture - customer, package, order, invoice - without
    # a second model or a second query the report would have to keep in step.
    partner_customer_id = fields.Char(
        related='partner_id.spa_customer_id', string='Customer ID', readonly=True)
    partner_phone = fields.Char(related='partner_id.phone', string='Phone', readonly=True)
    partner_whatsapp = fields.Char(
        related='partner_id.whatsapp', string='WhatsApp', readonly=True)
    partner_email = fields.Char(related='partner_id.email', string='Email', readonly=True)
    partner_dob = fields.Date(
        related='partner_id.date_of_birth', string='Date of Birth', readonly=True)
    partner_gender = fields.Selection(
        related='partner_id.gender', string='Gender', readonly=True)

    # Package counts. Empty for a single session, which has no pass.
    sessions_total = fields.Integer(
        related='pass_id.sessions_total', string='Package Total', readonly=True)
    sessions_used = fields.Integer(
        related='pass_id.sessions_used', string='Package Taken', readonly=True)
    sessions_left = fields.Integer(
        related='pass_id.sessions_left', string='Package Remaining', readonly=True)
    pass_assignee_names = fields.Char(
        related='pass_id.spa_assignee_names', string='Package Assignees', readonly=True)

    pos_reference = fields.Char(
        related='order_id.pos_reference', string='Receipt', readonly=True)
    invoice_id = fields.Many2one(
        related='order_id.account_move', string='Invoice', readonly=True)
    # Monetary, NOT Float: pos.order.amount_total is monetary, and a related
    # field whose type differs from its target is refused outright at registry
    # setup ("Type of related field ... is inconsistent with ..."). Monetary
    # also needs a currency on this model to render against, hence currency_id.
    currency_id = fields.Many2one(
        related='order_id.currency_id', string='Currency', readonly=True)
    order_amount_total = fields.Monetary(
        related='order_id.amount_total', string='Order Total',
        currency_field='currency_id', readonly=True)
    order_amount_paid = fields.Monetary(
        related='order_id.amount_paid', string='Order Paid',
        currency_field='currency_id', readonly=True)
    slot_datetime = fields.Datetime(
        related='order_id.spa_slot_datetime', string='Appointment', readonly=True)
    # The appointment history: whether this was moved, and where from.
    rescheduled = fields.Boolean(
        related='order_id.spa_rescheduled', string='Rescheduled', readonly=True)
    prev_slot_datetime = fields.Datetime(
        related='order_id.spa_prev_slot_datetime', string='Moved From', readonly=True)

    # History tabs. Related one2manys are read-only by nature here, which is
    # what we want - this screen reports, it does not edit.
    use_ids = fields.One2many(
        related='pass_id.use_ids', string='Sessions Taken', readonly=True)
    booking_ids = fields.One2many(
        related='pass_id.booking_ids', string='Appointments', readonly=True)
    line_ids = fields.One2many(
        related='order_id.lines', string='Order Lines', readonly=True)

    # ---- buttons --------------------------------------------------------
    def action_print_invoice(self):
        """The spa invoice PDF for this session's order.

        `account.account_invoices` renders `account.report_invoice_with_payments`,
        which spa_online_booking already extends with the Therapy / Duration /
        Package / Assignee / Members rows and the Personal Details block - so
        there is no second layout to design or keep in step with the first.
        """
        self.ensure_one()
        move = self.order_id.account_move
        if not move:
            raise UserError(_(
                "This session has no invoice. A POS sale only creates one when "
                "Invoice is ticked at payment, so there is nothing to print "
                "for it."))
        return self.env.ref('account.account_invoices').report_action(move)

    def action_open_order(self):
        self.ensure_one()
        if not self.order_id:
            raise UserError(_("This session is a booking - it has no order yet."))
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'pos.order',
            'res_id': self.order_id.id,
            'view_mode': 'form',
        }

    def action_open_package(self):
        self.ensure_one()
        if not self.pass_id:
            raise UserError(_("This session is not part of a package."))
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'spa.session.pass',
            'res_id': self.pass_id.id,
            'view_mode': 'form',
        }

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute(
            "CREATE OR REPLACE VIEW %s AS (%s)" % (self._table, QUERY))
