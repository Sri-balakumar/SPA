from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .member_type import SPA_DEFAULT_MEMBER

# NOTE: the hard-coded SPA_FAMILY_TYPES / SPA_MEMBER_TYPES / SPA_MEMBER_HEADCOUNT
# lists that used to live here are gone. Member types are records now
# (spa.member.type), so adding "Family 5" is configuration rather than a code
# change and an upgrade - and the headcount that drives the booking wizard, the
# member-count constraint and the invoice comes from the same record instead of
# being duplicated in Python and twice more in JavaScript.


def spa_headcount(member_type):
    """How many people a member type covers.

    Kept as a module-level helper so the readers that used to import it still
    read naturally, but it now takes a `spa.member.type` RECORD rather than a
    key string. Never zero, and one for a missing type: a booking always has at
    least the person who made it.
    """
    return member_type.spa_headcount() if member_type else 1


class SpaPackagePrice(models.Model):
    """What one package costs for one member type.

    A therapy has several packages, and each package is priced per member type
    (the matrix on the price card: plans down the side, member types across the
    top). Held as lines on the package rather than as separate products, so a
    plan's whole pricing is edited in one place instead of across four records.

    A member type with no line here is simply NOT SOLD for that package - an
    empty cell means "not offered", never "same as individual".
    """
    _name = 'spa.package.price'
    _description = 'Spa Package Family Price'
    # Ordered by the type's own sequence. It used to sort on the raw key, which
    # only looked right because 'family_2' < 'family_3' < 'family_4' - a type
    # called "Couple" would have landed in the wrong place.
    _order = 'member_type_sequence, id'

    product_tmpl_id = fields.Many2one(
        'product.template', string='Package', required=True,
        ondelete='cascade', index=True)
    # restrict, not cascade: deleting a type that packages are priced for would
    # silently wipe those prices. Types are archived instead.
    member_type = fields.Many2one(
        'spa.member.type', string='Member Type', required=True,
        ondelete='restrict', index=True,
        domain="[('is_individual', '=', False)]",
        help="Add a row for each member type this package is sold to. The "
             "base (Individual) type is priced by the product's own Sales "
             "Price and is deliberately not offered here.")
    member_type_sequence = fields.Integer(
        related='member_type.sequence', store=True, index=True)
    price = fields.Float(string='Price', required=True)

    # Both spellings, because Odoo 19 changed which one works partway through
    # its life: newer builds ignore `_sql_constraints` (they log "no longer
    # supported" and drop it, so the index is never created), older ones have
    # no `models.Constraint` at all and raise AttributeError on import - which
    # takes the whole module down, not just the constraint. Asking the running
    # build which it has is the only form that installs on both.
    # Without one of them reaching the database a package could carry two
    # Family 3 prices with no way to tell which one applied.
    if hasattr(models, 'Constraint'):
        _member_type_uniq = models.Constraint(
            'unique (product_tmpl_id, member_type)',
            'A package can only have one price per member type.')
    else:
        _sql_constraints = [
            ('member_type_uniq', 'unique (product_tmpl_id, member_type)',
             'A package can only have one price per member type.')]

    @api.constrains('price')
    def _check_price(self):
        for record in self:
            if record.price < 0:
                raise ValidationError("A package price cannot be negative.")

    @api.constrains('member_type')
    def _check_not_base_type(self):
        """The base type is priced by the product's Sales Price.

        Allowing a row for it would give a package two individual prices that
        could disagree, with no way to tell which was right.
        """
        for record in self:
            if record.member_type.is_individual:
                raise ValidationError(
                    "%s is the base type - it is priced by the product's own "
                    "Sales Price, so it cannot have a row here."
                    % record.member_type.name)


class ProductTemplateFamilyPricing(models.Model):
    _inherit = 'product.template'

    spa_family_price_ids = fields.One2many(
        'spa.package.price', 'product_tmpl_id', string='Family Prices',
        help="Price of this package for each member type. The product's own "
             "Sales Price is the base (Individual) price. Leave a member type "
             "out and this package is not offered to it.")

    def _spa_price_for(self, member_type):
        """What this package costs for `member_type`, or None if not sold.

        THE one place that answers this. Availability and price are the same
        question - a package with no price for a member type must not be
        offered to it - so both the screens and the charging read it here
        rather than each deciding for itself.

        `member_type` is a spa.member.type record; an empty one means the base
        type, which is the product's own Sales Price.
        """
        self.ensure_one()
        if not member_type or member_type.is_individual:
            return self.list_price
        line = self.spa_family_price_ids.filtered(
            lambda p: p.member_type == member_type)[:1]
        return line.price if line else None

    def _spa_member_prices(self):
        """`{member_type_code: price}` for the booking screens.

        Still keyed by CODE, not id: the booking page and the POS wizard index
        this map by the same key they use for the selected tab, and orders
        store it. Member types this package does not price are left out
        entirely, which is what tells the screens not to offer it.

        The sales price is ALWAYS in here, under the base type's code when one
        exists and under the default individual key when none does. It used to
        be omitted entirely on a database with no member types, and since the
        screens treat "not priced" as "not sold", every package under every
        therapy silently disappeared - the module stopped seeding member types
        and nobody connected the two.
        """
        self.ensure_one()
        prices = {}
        base = self.env['spa.member.type']._spa_base_type()
        prices[base.code if base else SPA_DEFAULT_MEMBER['key']] = self.list_price
        for line in self.spa_family_price_ids:
            prices[line.member_type.code] = line.price
        return prices
