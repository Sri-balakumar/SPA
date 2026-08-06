from odoo import api, fields, models


class ProductTemplate(models.Model):
    """A product here is a bookable SESSION PACKAGE (e.g. 'GO Ease – Single
    Session'). It belongs to a therapy (its POS category) and carries the
    package's price, duration, number of sessions and short description.
    The rich therapy-level details/photos live in the Details blocks below."""
    _inherit = 'product.template'

    # Session-package fields
    # NOTE: there is no `spa_member_type` here. A package is not tied to one
    # member type - it is priced for several, as lines on
    # `spa_family_price_ids` (see package_price.py). One product per plan, not
    # one per plan-and-family-size.

    spa_session_count = fields.Integer(string='Number of Sessions', default=1)
    spa_session_desc = fields.Text(string='Session Description', translate=True)

    # Repeatable detail blocks (heading / subheading / description / photos)
    spa_detail_ids = fields.One2many(
        'spa.product.detail', 'product_tmpl_id', string='Details', copy=True)

    @api.model
    def _spa_addon_products(self):
        """Every product offered as an add-on, as a product.template recordset.

        The add-on list is the same for every service - a product is an add-on
        because of the CATEGORY it is filed under, not because a particular
        therapy picked it. So this is a plain search on the category flag, and
        one edit (ticking a category) covers every screen at once.

        Untick 'Point of Sale' or 'Sales' on a product and it withdraws from
        every screen at once, without editing any category.
        """
        return self.sudo().search([
            ('categ_id.spa_is_addon', '=', True),
            ('available_in_pos', '=', True),
            ('sale_ok', '=', True),
        ])

    @api.model
    def _load_pos_data_read(self, records, config):
        """Make sure the add-on products reach the POS.

        Core already force-loads a product's own `pos_optional_product_ids`
        (point_of_sale/models/product_template.py), but it knows nothing about
        the add-on CATEGORY. Without this, the Book Therapy screen would list
        extras the POS has no product record for - and adding one to the order
        would silently fail, because `_addChosenAddons` creates the line from a
        raw `product_tmpl_id`. It also breaks the moment someone ticks 'Limit
        Categories' or the catalogue grows past the loading cap.

        This is the last hook before the records are read, so adding to
        `records` here is enough; the union dedupes what core already included.
        """
        addons = self._spa_addon_products()
        if addons:
            records |= addons
        return super()._load_pos_data_read(records, config)


class ProductCategory(models.Model):
    """The product category doubles as the ADD-ON list: file a product under a
    category ticked below and it is offered as an optional extra everywhere a
    service is chosen. Deliberately a flag rather than matching the category's
    name in code - renaming 'Add ons' then cannot silently switch add-ons off,
    and another database can use whatever name it likes. Same idea as
    `spa_is_therapy` on pos.category."""
    _inherit = 'product.category'

    spa_is_addon = fields.Boolean(
        string='Offer as POS Add-on', default=False,
        help="Every product filed under this category is offered as an optional "
             "extra after a service is chosen - in the POS Book Therapy screen "
             "and on the online booking page. The product still needs 'Point of "
             "Sale' ticked and a price.")
