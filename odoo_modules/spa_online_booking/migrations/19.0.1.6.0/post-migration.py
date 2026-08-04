def migrate(cr, version):
    """Backfill the new spa.booking.spa_channel from the existing `source` so
    bookings created before this upgrade still land in the right POS tab:
      online_link -> online, walk_in -> tab, anything else -> web."""
    if not version:
        return
    cr.execute("""
        UPDATE spa_booking SET spa_channel = 'online'
        WHERE spa_channel IS NULL AND source = 'online_link'
    """)
    cr.execute("""
        UPDATE spa_booking SET spa_channel = 'tab'
        WHERE spa_channel IS NULL AND source = 'walk_in'
    """)
    cr.execute("""
        UPDATE spa_booking SET spa_channel = 'web'
        WHERE spa_channel IS NULL
    """)
