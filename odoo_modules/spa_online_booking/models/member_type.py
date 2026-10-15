from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The individual tab the screens fall back to when a database has NO
# spa.member.type records at all.
#
# Nothing is seeded any more, and a spa that only ever sells to one person
# should not have to create a record to say so. This is a default in the
# RESPONSE, not a default record: nothing is written to the database, no
# product gains a price row, and there is nothing to clean up later. The
# moment real member types exist they take over completely - see
# _spa_payload() and spa.package.price._spa_member_prices().
SPA_DEFAULT_MEMBER = {
    'key': 'individual',
    'label': 'Individual',
    'headcount': 1,
    'is_individual': True,
}


class SpaMemberType(models.Model):
    """How many people one sale covers: Individual, Family 2, Couple, whatever
    the spa sells.

    These used to be a hard-coded Python list, which meant adding "Family 5"
    was a code change and an upgrade. Worse, the HEADCOUNT was duplicated in
    two JavaScript files, so the three had to be kept in step by hand.

    Everything now reads this model - the price matrix, the POS wizard, the
    booking page, the headcount constraint and the invoice - so a type added
    here works everywhere without touching code.
    """
    _name = 'spa.member.type'
    _description = 'Spa Member Type'
    _inherit = ['pos.load.mixin']
    _order = 'sequence, id'

    name = fields.Char(
        string='Member Type', required=True, translate=True,
        help="What staff and customers see, e.g. 'Family 2' or 'Couple'.")
    # A stable key, separate from the name, because the JSON API and the POS
    # index prices by it (`prices[key]`) and orders store it. Renaming the
    # label must not orphan what is already sold.
    code = fields.Char(
        string='Code', required=True, copy=False,
        help="Technical key used by the booking page and the tablet API. "
             "Set once and left alone - renaming the Member Type is safe, "
             "changing this is not.")
    people = fields.Integer(
        string='People', required=True, default=1,
        help="How many people this type covers. This is not cosmetic: it "
             "decides how many people's details are collected at booking, "
             "what the invoice prints as 'Members Included', and how many "
             "the booking is required to name.")
    # The base type: its price is the product's own Sales Price rather than a
    # row in the family price matrix. A flag rather than the magic string
    # 'individual' that used to be compared against in eight places.
    is_individual = fields.Boolean(
        string='Base (Individual) Type', default=False,
        help="The single-person type. Its price comes from the product's own "
             "Sales Price, so it is never given a row in Family Prices.")
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    # Both spellings, because Odoo 19 changed which one works partway through
    # its life: newer builds ignore `_sql_constraints` (they log "no longer
    # supported" and drop it, so the index is never created), older ones have
    # no `models.Constraint` at all and raise AttributeError on import - which
    # takes the whole module down, not just the constraint. Asking the running
    # build which it has is the only form that installs on both.
    if hasattr(models, 'Constraint'):
        _code_uniq = models.Constraint(
            'unique (code)', 'Another member type already uses that code.')
    else:
        _sql_constraints = [
            ('code_uniq', 'unique (code)',
             'Another member type already uses that code.')]

    @api.constrains('people')
    def _check_people(self):
        for record in self:
            if record.people < 1:
                raise ValidationError(
                    "%s must cover at least one person." % record.name)

    @api.constrains('is_individual')
    def _check_single_base_type(self):
        """At most one base type, or pricing becomes ambiguous - two of them
        and a package would have two claims on the product's Sales Price."""
        for record in self:
            if not record.is_individual:
                continue
            others = self.with_context(active_test=False).search([
                ('is_individual', '=', True), ('id', '!=', record.id),
            ])
            if others:
                raise ValidationError(
                    "%s is already the base (Individual) type. Only one member "
                    "type can be the base." % others[0].name)

    @api.model
    def _spa_base_type(self):
        """The individual/base type, or an empty recordset."""
        return self.search([('is_individual', '=', True)], limit=1)

    def spa_headcount(self):
        """How many people this type covers.

        Never zero, and one for a missing type - a booking always has at least
        the person who made it. That fallback is also why types are ARCHIVED
        rather than deleted: a deleted type would silently turn a Family 3
        booking into a one-person one, and its own headcount constraint would
        then reject it.
        """
        if not self:
            return 1
        self.ensure_one()
        return self.people or 1

    @api.model
    def _spa_by_code(self, code):
        """The type with this code, or an empty recordset."""
        if not code:
            return self.browse()
        return self.with_context(active_test=False).search(
            [('code', '=', code)], limit=1)

    @api.model
    def _spa_payload(self):
        """What the booking page and the POS wizard need to render the tabs.

        `headcount` is the point of this: without it both clients fell back to
        a hard-coded {family_2: 2, ...} map, which is exactly what had to be
        edited every time a type was added.

        On a database with no types at all this returns the default individual
        tab rather than an empty list. Empty was not a neutral answer: the
        clients build their price lookup from these keys, so no keys meant no
        package was sellable and the screen said "no packages" about a therapy
        that had plenty.
        """
        types = self.search([])
        if not types:
            return [dict(SPA_DEFAULT_MEMBER)]
        return [{
            'key': t.code,
            'label': t.name,
            'headcount': t.people,
            'is_individual': t.is_individual,
        } for t in types]

    # ---- POS ------------------------------------------------------------
    @api.model
    def _load_pos_data_fields(self, config):
        return ['id', 'name', 'code', 'people', 'is_individual', 'sequence']


class PosSessionMemberTypes(models.Model):
    _inherit = 'pos.session'

    @api.model
    def _load_pos_data_models(self, config):
        """Ship the member types to the POS.

        The Orders screen has to label a line's member type, and the Book
        Therapy wizard has to know how many people it covers. Both used to
        hard-code that; loading the records means neither has to.
        """
        return super()._load_pos_data_models(config) + ['spa.member.type']
