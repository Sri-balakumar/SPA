"""Move the old member-type CODES out of the way before the columns change type.

Member types were Selection strings ('individual', 'family_2', ...); they are
`spa.member.type` records now, so the columns become integer foreign keys.

Odoo converts a column in place with `ALTER TABLE ... USING`, which Postgres
refuses here:

    invalid input syntax for type integer: "individual"

So the old column is RENAMED rather than copied. `_auto_init` then finds no
column of that name and creates a clean integer one, and post-migration maps the
parked codes onto the new records.

Renaming, not copying: leaving the original in place is exactly what made the
first attempt fail - Odoo still found it and still tried to convert it.
"""
import logging

_logger = logging.getLogger(__name__)

# table -> column holding the old Selection value
_COLUMNS = {
    'spa_package_price': 'member_type',
    'pos_order_line': 'spa_member_type',
    'spa_booking': 'spa_member_type',
}


def _column_type(cr, table, column):
    cr.execute("""
        SELECT data_type FROM information_schema.columns
         WHERE table_name = %s AND column_name = %s
    """, (table, column))
    row = cr.fetchone()
    return row[0] if row else None


def migrate(cr, version):
    if not version:
        return

    for table, column in _COLUMNS.items():
        backup = '%s_old_code' % column
        current = _column_type(cr, table, column)

        if current is None:
            # Column already renamed by an earlier run of this script.
            continue
        if current not in ('character varying', 'text'):
            # Already an integer: converted by a previous successful upgrade.
            continue

        # A backup from a half-finished run would block the rename. The live
        # column is the authority, so the stale copy goes.
        if _column_type(cr, table, backup) is not None:
            cr.execute('ALTER TABLE "%s" DROP COLUMN "%s"' % (table, backup))
            _logger.info(
                "spa_online_booking: dropped stale %s.%s from an earlier run",
                table, backup)

        cr.execute('ALTER TABLE "%s" RENAME COLUMN "%s" TO "%s"'
                   % (table, column, backup))
        cr.execute('SELECT count(*) FROM "%s" WHERE "%s" IS NOT NULL'
                   % (table, backup))
        _logger.info(
            "spa_online_booking: parked %s member-type code(s) as %s.%s",
            cr.fetchone()[0], table, backup)
