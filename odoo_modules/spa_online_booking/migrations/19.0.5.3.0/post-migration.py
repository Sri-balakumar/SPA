"""Backfill pos_order.spa_slot_datetime from the booking each order came from.

The column is new, so every order that already points at a booking would show a
blank Appointment on the POS card until it happened to be rescheduled. The value
is already known - it is sitting on the linked spa.booking - so copy it across
once rather than leaving a field that is only correct for orders created from
now on.

Only fills blanks, so re-running cannot overwrite a rescheduled time.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'pos_order' AND column_name = 'spa_slot_datetime'
    """)
    if not cr.fetchone():
        return

    cr.execute("""
        UPDATE pos_order o
           SET spa_slot_datetime = b.slot_datetime
          FROM spa_booking b
         WHERE o.spa_booking_ref = b.id
           AND b.slot_datetime IS NOT NULL
           AND o.spa_slot_datetime IS NULL
    """)
    _logger.info('spa_online_booking: filled the appointment on %s order(s)',
                 cr.rowcount)
