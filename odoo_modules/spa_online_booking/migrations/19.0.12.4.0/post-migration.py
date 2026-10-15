"""Flag orders whose appointment was set from the Reschedule button.

`spa_rescheduled` used to require MOVING off a date the order already had.
Giving a counter sale its first appointment went through the same button and was
deliberately not flagged - which left the Rescheduled tab empty for the case
reception actually uses, since orders rung up at the counter have no appointment
until somebody sets one.

The flag now means "this appointment was set or moved from Reschedule". Orders
already in that state on this database were flagged under the old rule, so they
need catching up. The evidence is the chatter pos_reschedule posts on the
booking, exactly as the 19.0.11.8.0 backfill used - but WITHOUT that script's two
exclusions ("from no date set" and "from D to D"), because those are precisely
the cases that now count.

Only a display flag is written. No appointment, booking or payment is touched.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'pos_order' AND column_name = 'spa_rescheduled'
    """)
    if not cr.fetchone():
        return

    cr.execute("""
        UPDATE pos_order o
           SET spa_rescheduled = TRUE
         WHERE o.spa_slot_datetime IS NOT NULL
           AND COALESCE(o.spa_rescheduled, FALSE) = FALSE
           AND o.spa_booking_ref IS NOT NULL
           AND EXISTS (
                SELECT 1 FROM mail_message m
                 WHERE m.model = 'spa.booking'
                   AND m.res_id = o.spa_booking_ref
                   AND m.body LIKE %s)
    """, ('%Appointment rescheduled from%',))
    if cr.rowcount:
        _logger.info(
            "spa_online_booking: flagged %s order(s) as rescheduled under the "
            "widened rule (appointment set from the Reschedule button).",
            cr.rowcount)
