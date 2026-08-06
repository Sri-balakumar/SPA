"""Give every existing booking a person-1 row, and file its answers under them.

Personal details used to live as scalars on spa.booking - one name, one date of
birth, one signature. They now also live on spa.booking.member, one row per
person, because a family booking needs details and answers for each person.

Without this backfill, every booking made before the upgrade would show no
people at all, and the sign sheet, invoice and booking form would each need a
"no members?  fall back to the old fields" branch. One pass here means there is
exactly one code path afterwards.

The booking's own scalar fields are LEFT ALONE - they stay the mirror of person
1, which is what every existing view and report reads.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    from odoo import api, SUPERUSER_ID
    env = api.Environment(cr, SUPERUSER_ID, {})

    Member = env['spa.booking.member']
    bookings = env['spa.booking'].search([('member_ids', '=', False)])
    _logger.info("spa_online_booking: backfilling members for %d booking(s)",
                 len(bookings))

    created = 0
    answers_stamped = 0
    for booking in bookings:
        name = (booking.partner_name or '').strip()
        if not name:
            # partner_name is required on spa.booking, so this should not
            # happen - but a member with no name cannot be created, and
            # skipping one row is better than failing the whole upgrade.
            _logger.warning("spa_online_booking: booking %s has no name, skipped",
                            booking.name or booking.id)
            continue

        member = Member.create({
            'booking_id': booking.id,
            'sequence': 1,
            'name': name,
            'date_of_birth': booking.date_of_birth or False,
            'gender': booking.gender or False,
            'phone': booking.mobile or False,
            'email': booking.email or False,
            'partner_id': booking.partner_id.id or False,
            'signature': booking.signature or False,
            'terms_accepted': booking.terms_accepted,
        })
        created += 1

        # Everything answered on this booking was answered by the person who
        # made it, so it all belongs to member 1.
        orphans = booking.answer_ids.filtered(lambda a: not a.member_id)
        if orphans:
            orphans.write({'member_id': member.id})
            answers_stamped += len(orphans)

    # Any answer whose booking already had members (there should be none on a
    # first run, but a re-run or a part-migrated database could have some).
    stragglers = env['spa.booking.answer'].search([('member_id', '=', False)])
    for answer in stragglers:
        lead = answer.booking_id._spa_lead_member()
        if lead:
            answer.member_id = lead.id
            answers_stamped += 1

    _logger.info(
        "spa_online_booking: created %d member row(s), stamped %d answer(s)",
        created, answers_stamped)
