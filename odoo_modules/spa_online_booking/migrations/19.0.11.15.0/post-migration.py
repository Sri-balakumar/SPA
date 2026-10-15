"""Point every existing row at its spa.member.type record.

pre-migration parked the old Selection strings in `<column>_old_code`. The seed
data (data/spa_member_type.xml) has since created the four types under those
exact codes, so mapping is a straight join on `code`.

Rows whose code no longer matches any type are left NULL rather than guessed at:
`spa_headcount()` treats a missing type as one person, which is the same thing
the old `SPA_MEMBER_HEADCOUNT.get(key, 1)` did.
"""
import logging

_logger = logging.getLogger(__name__)

# table -> new Many2one column (the parked value is always <column>_old_code)
_COLUMNS = {
    'spa_package_price': 'member_type',
    'pos_order_line': 'spa_member_type',
    'spa_booking': 'spa_member_type',
}


def migrate(cr, version):
    if not version:
        return

    cr.execute("SELECT count(*) FROM spa_member_type")
    if not cr.fetchone()[0]:
        # The seed data should have loaded before this runs. Without it every
        # row would be blanked, so stop rather than destroy the mapping.
        _logger.error(
            "spa_online_booking: no spa.member.type records - member types "
            "NOT migrated. Check data/spa_member_type.xml loaded.")
        return

    for table, column in _COLUMNS.items():
        backup = '%s_old_code' % column
        cr.execute("""
            SELECT 1 FROM information_schema.columns
             WHERE table_name = %s AND column_name = %s
        """, (table, backup))
        if not cr.fetchone():
            continue

        cr.execute("""
            UPDATE "%s" AS t
               SET "%s" = mt.id
              FROM spa_member_type mt
             WHERE mt.code = t."%s"
               AND t."%s" IS NOT NULL
        """ % (table, column, backup, backup))
        mapped = cr.rowcount

        cr.execute("""
            SELECT DISTINCT t."%s" FROM "%s" AS t
             WHERE t."%s" IS NOT NULL AND t."%s" IS NULL
        """ % (backup, table, backup, column))
        orphans = [r[0] for r in cr.fetchall()]
        if orphans:
            _logger.warning(
                "spa_online_booking: %s.%s had unknown member type code(s) %s "
                "- left empty", table, column, orphans)

        _logger.info("spa_online_booking: mapped %s row(s) in %s.%s",
                     mapped, table, column)
        # Keep the parked column: it is the only record of what the row used to
        # say, and dropping it would make a bad mapping unrecoverable. Cheap to
        # leave, and a later migration can remove it once this is trusted.

    # spa_package_price.member_type_sequence is a STORED related field, and the
    # UPDATEs above are raw SQL - so the ORM never recomputed it and every row
    # would sort as NULL under _order = 'member_type_sequence, id'. Fill it from
    # the same join rather than leaving the price rows in arbitrary order.
    cr.execute("""
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'spa_package_price'
           AND column_name = 'member_type_sequence'
    """)
    if cr.fetchone():
        cr.execute("""
            UPDATE spa_package_price AS p
               SET member_type_sequence = mt.sequence
              FROM spa_member_type mt
             WHERE mt.id = p.member_type
        """)
        _logger.info(
            "spa_online_booking: filled member_type_sequence on %s price row(s)",
            cr.rowcount)
