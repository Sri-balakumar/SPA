from odoo import _, fields, models

# SPA_MEMBER_HEADCOUNT now lives beside SPA_MEMBER_TYPES in package_price.py -
# the booking model and the public controllers need it too. Re-exported here so
# anything already importing it from this module keeps working.
from .package_price import SPA_MEMBER_HEADCOUNT, SPA_MEMBER_TYPES  # noqa: F401


class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    # The POS line this was invoiced from. Core only links move -> order, so
    # without this the report would have to match on product, which breaks the
    # moment one order sells the same package twice at different family sizes -
    # exactly the case the family pricing exists for.
    pos_order_line_id = fields.Many2one(
        'pos.order.line', string='POS Order Line',
        ondelete='set null', index='btree_not_null', copy=False)

    def _spa_therapy(self):
        """The therapy this line's product belongs to, or an empty recordset."""
        self.ensure_one()
        tmpl = self.product_id.product_tmpl_id
        if not tmpl:
            return self.env['pos.category']
        return tmpl.pos_categ_ids.filtered('spa_is_therapy')[:1]

    def _spa_package_name(self):
        """The plan on its own - "Single Session" out of "Go Ease (Single Session)".

        The therapy name is already printed on its own row, so repeating it
        here would just be noise. Falls back to the full product name whenever
        the therapy name cannot be stripped cleanly, because a wrong guess is
        worse than a slightly redundant one.
        """
        self.ensure_one()
        tmpl = self.product_id.product_tmpl_id
        name = (tmpl.name or '').strip()
        therapy = self._spa_therapy()
        label = (therapy.name or '').strip() if therapy else ''
        if not label or not name.lower().startswith(label.lower()):
            return name
        rest = name[len(label):].strip()
        # "(Single Session)" -> "Single Session"; "- Single Session" -> same.
        rest = rest.lstrip('-–—').strip()
        if rest.startswith('(') and rest.endswith(')'):
            rest = rest[1:-1].strip()
        return rest or name

    def _spa_detail_rows(self):
        """`[(label, value), ...]` printed under this line on the invoice.

        Empty for anything that is not a spa service, so an ordinary invoice
        line grows no rows at all. Built here rather than in the report so the
        template stays presentation-only and this can be tested.
        """
        self.ensure_one()
        tmpl = self.product_id.product_tmpl_id
        if not tmpl:
            return []
        therapy = self._spa_therapy()
        # The therapy is the ONLY reliable marker of a spa line. Do not also
        # accept spa_duration: it is declared with default=60, so every product
        # in the database has one - a bottle of water would print
        # "Duration: 60 Minutes" and a "Package" row on the invoice.
        if not therapy:
            return []

        rows = []
        if therapy:
            rows.append((_("Therapy"), therapy.name))
        if tmpl.spa_duration:
            rows.append((_("Duration"), _("%s Minutes") % tmpl.spa_duration))
        package = self._spa_package_name()
        if package:
            rows.append((_("Package"), package))

        # Only from the linked POS line: the member type is a property of the
        # SALE, not of the product, so an invoice line with no link cannot know
        # it and says nothing rather than guessing "Individual".
        pos_line = self.pos_order_line_id
        if pos_line and pos_line.spa_member_type:
            people = SPA_MEMBER_HEADCOUNT.get(pos_line.spa_member_type)
            if people:
                rows.append((
                    _("Members Included"),
                    _("%s Person") % people if people == 1
                    else _("%s Persons") % people,
                ))
                # Who they actually were, when the sale came from a booking
                # that recorded them. A bare count tells the customer nothing
                # about who the invoice covers.
                names = self._spa_member_names()
                if names:
                    rows.append((_("Members"), ', '.join(names)))
        return rows

    def _spa_member_names(self):
        """The people on the booking behind this line, in order.

        Empty for a counter sale: those record no booking, so there are no
        member rows to read and the invoice keeps the plain headcount.
        """
        self.ensure_one()
        order = self.pos_order_line_id.order_id
        booking_ref = order.spa_booking_ref if order else 0
        if not booking_ref:
            return []
        booking = self.env['spa.booking'].sudo().browse(booking_ref).exists()
        if not booking or len(booking.member_ids) < 2:
            # One person adds nothing the Customer Name row does not say.
            return []
        return [m.name for m in booking.member_ids.sorted('sequence') if m.name]


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _spa_is_spa_invoice(self):
        """True when this invoice came from a spa sale.

        Gates the whole Personal Details block: a supplier bill should keep
        Odoo's standard layout rather than growing a half-empty panel.
        """
        self.ensure_one()
        if self.move_type not in ('out_invoice', 'out_refund'):
            return False
        return any(line._spa_detail_rows() for line in self.invoice_line_ids)

    def _spa_personal_rows(self):
        """The Personal Details block, as `[(label, value), ...]` pairs.

        Rows with nothing to show are dropped individually, so a customer with
        no email does not print a dangling "Email :".
        """
        self.ensure_one()
        partner = self.partner_id
        if not partner:
            return [], []
        partner._spa_ensure_customer_id()

        genders = dict(partner._fields['gender'].selection or []) \
            if 'gender' in partner._fields else {}
        address = ', '.join(part for part in [
            partner.street, partner.street2, partner.city,
            partner.state_id.name, partner.country_id.name,
        ] if part)

        left = [
            (_("Customer Name"), partner.name),
            (_("Phone"), partner.phone),
            (_("Email"), partner.email),
            (_("Address"), address),
        ]
        right = [
            (_("Customer ID"), getattr(partner, 'spa_customer_id', '')),
            (_("Gender"), genders.get(partner.gender, '')
             if 'gender' in partner._fields else ''),
            (_("Date of Birth"),
             fields.Date.to_string(partner.date_of_birth)
             if 'date_of_birth' in partner._fields and partner.date_of_birth
             else ''),
        ]
        return ([r for r in left if r[1]], [r for r in right if r[1]])

    def _spa_other_people(self):
        """Everyone on this invoice's booking except the payer.

        The block above describes `partner_id`, and an invoice has exactly one
        - so on a family sale it could only ever name the person who paid. The
        others are booking members, and each gets its own pair of columns here.

        Returns `[(name, left_rows, right_rows), ...]`, empty for an ordinary
        individual sale so nothing extra prints.
        """
        self.ensure_one()
        booking_ids = {
            line.pos_order_line_id.order_id.spa_booking_ref
            for line in self.invoice_line_ids
            if line.pos_order_line_id and line.pos_order_line_id.order_id.spa_booking_ref
        }
        if not booking_ids:
            return []
        bookings = self.env['spa.booking'].sudo().browse(list(booking_ids)).exists()
        members = bookings.mapped('member_ids').sorted(
            lambda m: (m.booking_id.id, m.sequence, m.id))
        if len(members) < 2:
            # One person says nothing the Customer Name row does not already.
            return []

        genders = dict(
            self.env['spa.booking.member']._fields['gender'].selection or [])
        people = []
        for member in members:
            if member.is_lead:
                continue        # that is the payer, printed in the block above
            left = [
                (_("Name"), member.name),
                (_("Phone"), member.phone),
                (_("Email"), member.email),
            ]
            right = [
                (_("Gender"), genders.get(member.gender, '')),
                (_("Date of Birth"),
                 fields.Date.to_string(member.date_of_birth)
                 if member.date_of_birth else ''),
                (_("Age"), str(member.age) if member.age else ''),
            ]
            people.append((
                member.name or '',
                [r for r in left if r[1]],
                [r for r in right if r[1]],
            ))
        return people
