"""Lift per-package add-ons up to their therapy.

Add-ons used to be configured on each package product, in POS's built-in
Upsell & Cross-Sell field. They are now configured once on the therapy
(POS -> Product Categories -> Add-ons) and offered on every package under it.

Anything already entered on a package is copied up so nothing configured
before this upgrade disappears from the screens. The product's own field is
deliberately LEFT ALONE - `_spa_addons_for` still merges it in, so this
migration adds and never removes. A spa that wants an extra on one package
only can still do exactly that.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    from odoo import api, SUPERUSER_ID
    env = api.Environment(cr, SUPERUSER_ID, {})

    Category = env['pos.category']
    therapies = Category.search([('spa_is_therapy', '=', True)])
    lifted = 0

    for therapy in therapies:
        packages = env['product.template'].search([
            ('pos_categ_ids', 'in', therapy.ids),
            ('pos_optional_product_ids', '!=', False),
        ])
        addons = packages.mapped('pos_optional_product_ids')
        # Only what is not already on the therapy, so re-running is harmless.
        new = addons - therapy.spa_addon_ids
        if not new:
            continue
        therapy.spa_addon_ids = [(4, addon.id) for addon in new]
        lifted += len(new)
        _logger.info(
            "spa_online_booking: lifted %d add-on(s) onto therapy %r: %s",
            len(new), therapy.name, new.mapped('name'))

    if lifted:
        _logger.info("spa_online_booking: %d add-on link(s) lifted to therapies", lifted)
    else:
        _logger.info("spa_online_booking: no per-package add-ons to lift")
