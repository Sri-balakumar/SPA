from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    """Backfill the new spa.booking.product_ids many2many from the legacy
    single product_id, so existing bookings keep showing their service, and
    recompute the now-stored `price` (sum of the selected services)."""
    if not version:
        return

    # 1) Populate the m2m relation from the legacy column for any booking that
    #    has a product_id but no rows yet in the relation table. The relation
    #    table exists by now (schema update runs before post-migration).
    cr.execute("""
        INSERT INTO spa_booking_product_rel (booking_id, product_id)
        SELECT id, product_id
        FROM spa_booking
        WHERE product_id IS NOT NULL
          AND id NOT IN (SELECT booking_id FROM spa_booking_product_rel)
    """)

    # 2) Recompute the stored `price` for every booking now that product_ids
    #    is populated.
    env = api.Environment(cr, SUPERUSER_ID, {})
    bookings = env['spa.booking'].search([])
    if bookings:
        bookings._compute_price()
        env.flush_all()
