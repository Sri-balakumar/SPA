"""Drop product_template.spa_member_type.

19.0.6.0.0 briefly modelled family pricing as a Member Type on the product, so
a plan sold to four family sizes meant four products. It is a matrix now - one
product per plan, with the family prices as lines on spa.package.price - and
the old column is dead weight that Odoo leaves behind when a field is removed.

Nothing is carried over: the field only ever held its default ('individual')
on this database, and a product per member type does not translate into the
new shape anyway. Guarded on the column existing, so re-running is safe.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'product_template'
           AND column_name = 'spa_member_type'
    """)
    if not cr.fetchone():
        return

    # Warn rather than silently discard, in case a family product was created
    # in the short window the field existed.
    cr.execute("""
        SELECT count(*) FROM product_template
         WHERE spa_member_type IS NOT NULL
           AND spa_member_type != 'individual'
    """)
    stray = cr.fetchone()[0]
    if stray:
        _logger.warning(
            'spa_online_booking: %s product(s) had a non-individual Member '
            'Type. That field is gone - re-enter those prices as Family '
            'Prices on the matching package.', stray)

    cr.execute('ALTER TABLE product_template DROP COLUMN spa_member_type')
    _logger.info('spa_online_booking: dropped product_template.spa_member_type')
