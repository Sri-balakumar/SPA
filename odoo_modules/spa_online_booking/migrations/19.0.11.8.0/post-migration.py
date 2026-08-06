"""Flag orders whose appointment was moved, from the booking chatter.

`spa_rescheduled` is new, so every order that was rescheduled before this
upgrade would look untouched - the Rescheduled tab would open empty on a
database where real moves have happened.

There is no old column to copy from: the field that used to imply this
(`spa_prev_slot_datetime`) was dropped with the Undo Reschedule feature. What
survives is the chatter `pos_reschedule` posts on the booking:

    "Appointment rescheduled from 2026-08-06 11:13 to 2026-08-08 11:13 by X."

Two of those are NOT reschedules and must be skipped:

  * "from no date set to ..." - a counter sale being given its first
    appointment. The same method handles both cases, so it writes the same
    message either way.
  * "from D to D" - the date was re-picked unchanged. No move happened, and
    the live database has one of these.
"""
import logging
import re

_logger = logging.getLogger(__name__)

# "...rescheduled from <old> to <new> by ..." - both groups are non-greedy up to
# the next keyword, so a trailing " by <user>." cannot be swallowed into `new`.
_MOVE_RE = re.compile(
    r'rescheduled from (.+?) to (.+?) by ', re.IGNORECASE | re.DOTALL)
_TAGS_RE = re.compile(r'<[^>]*>')


def _plain(html):
    return _TAGS_RE.sub('', html or '').replace('&nbsp;', ' ').strip()


def migrate(cr, version):
    # Fresh install: no history to read, and no orders to flag.
    if not version:
        return

    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'pos_order' AND column_name = 'spa_rescheduled'
    """)
    if not cr.fetchone():
        return

    cr.execute("""
        SELECT res_id, body FROM mail_message
         WHERE model = 'spa.booking'
           AND body LIKE %s
    """, ('%Appointment rescheduled from%',))

    moved_bookings = set()
    for booking_id, body in cr.fetchall():
        match = _MOVE_RE.search(_plain(body))
        if not match:
            continue
        old, new = match.group(1).strip(), match.group(2).strip()
        if not old or old.lower().startswith('no date'):
            continue        # first appointment, not a move
        # Stored to the second on one side and the minute on the other, so
        # compare on the common prefix rather than the raw strings.
        if old[:16] == new[:16]:
            continue        # re-picked the same time
        moved_bookings.add(booking_id)

    if not moved_bookings:
        _logger.info("spa_online_booking: no rescheduled bookings to backfill")
        return

    cr.execute("""
        UPDATE pos_order
           SET spa_rescheduled = TRUE
         WHERE spa_booking_ref IN %s
           AND spa_slot_datetime IS NOT NULL
    """, (tuple(moved_bookings),))
    _logger.info(
        "spa_online_booking: marked %s order(s) as rescheduled, from %s "
        "booking(s) with a move in their chatter",
        cr.rowcount, len(moved_bookings))
