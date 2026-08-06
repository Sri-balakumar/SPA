from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Individual is NOT in this list on purpose: the individual price is the
# product's own `list_price`. Storing it again here would give a package two
# individual prices that could disagree, and there would be no way to tell
# which one was right.
SPA_FAMILY_TYPES = [
    ('family_2', 'Family 2'),
    ('family_3', 'Family 3'),
    ('family_4', 'Family 4'),
]
# What the booking screens offer as tabs: the individual price plus whatever
# family sizes a package actually prices.
SPA_MEMBER_TYPES = [('individual', 'Individual')] + SPA_FAMILY_TYPES

# How many people a member type covers. Lives here beside SPA_MEMBER_TYPES
# rather than in account_move.py, where it started: the booking model and the
# public controllers both need it now, and neither should have to import
# invoice code to count people.
SPA_MEMBER_HEADCOUNT = {
    'individual': 1,
    'family_2': 2,
    'family_3': 3,
    'family_4': 4,
}


def spa_headcount(member_type):
    """How many people this booking is for. Unknown types count as one, never
    zero - a booking always has at least the person who made it."""
    return SPA_MEMBER_HEADCOUNT.get(member_type or 'individual', 1)


class SpaPackagePrice(models.Model):
    """What one package costs for one family size.

    A therapy has several packages, and each package is priced per member type
    (the matrix on the price card: plans down the side, member types across the
    top). Held as lines on the package rather than as separate products, so a
    plan's whole pricing is edited in one place instead of across four records.

    A family size with no line here is simply NOT SOLD for that package - an
    empty cell means "not offered", never "same as individual".
    """
    _name = 'spa.package.price'
    _description = 'Spa Package Family Price'
    _order = 'member_type'

    product_tmpl_id = fields.Many2one(
        'product.template', string='Package', required=True,
        ondelete='cascade', index=True)
    member_type = fields.Selection(
        SPA_FAMILY_TYPES, string='Member Type', required=True)
    price = fields.Float(string='Price', required=True)

    # models.Constraint, NOT _sql_constraints: Odoo 19 ignores the old list
    # form entirely (it only logs "no longer supported"), so the constraint
    # would never reach the database and a package could carry two Family 3
    # prices with no way to tell which one applied.
    _member_type_uniq = models.Constraint(
        'unique (product_tmpl_id, member_type)',
        'A package can only have one price per member type.')

    @api.constrains('price')
    def _check_price(self):
        for record in self:
            if record.price < 0:
                raise ValidationError("A package price cannot be negative.")


class ProductTemplateFamilyPricing(models.Model):
    _inherit = 'product.template'

    spa_family_price_ids = fields.One2many(
        'spa.package.price', 'product_tmpl_id', string='Family Prices',
        help="Price of this package for each family size. The product's own "
             "Sales Price is the Individual price. Leave a family size out "
             "and this package is not offered to it.")

    def _spa_price_for(self, member_type):
        """What this package costs for `member_type`, or None if not sold.

        THE one place that answers this. Availability and price are the same
        question - a package with no price for a family size must not be
        offered to it - so both the screens and the charging read it here
        rather than each deciding for itself.
        """
        self.ensure_one()
        if not member_type or member_type == 'individual':
            return self.list_price
        line = self.spa_family_price_ids.filtered(
            lambda p: p.member_type == member_type)[:1]
        return line.price if line else None

    def _spa_member_prices(self):
        """`{member_type: price}` for the booking screens.

        Member types this package does not price are left out entirely, which
        is what tells the screens not to offer it under that tab.
        """
        self.ensure_one()
        prices = {'individual': self.list_price}
        for line in self.spa_family_price_ids:
            prices[line.member_type] = line.price
        return prices
