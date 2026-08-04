"""Put the numbers already stored into the one shape the rest now uses.

Before this, the public API wrote E.164 while the POS and the contact form
wrote whatever phone_validation's onchange produced - so the same customer sat
in the database as +919539784092 and as "+91 95397 84092". The number is the
WhatsApp identity and the tablet app's lookup key, so one shape it is.

Numbers that cannot be parsed are LEFT ALONE, not guessed at: with the company
on Oman, an Indian number typed without its +91 is not a valid Omani one, and
inventing a prefix would point WhatsApp at a stranger. Those are listed in the
log for someone to fix by hand.
"""
import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Partner = env['res.partner'].with_context(active_test=False)
    partners = Partner.search(['|', ('phone', '!=', False),
                               ('whatsapp', '!=', False)])

    changed = 0
    skipped = []
    for partner in partners:
        patch = {}
        for fname in ('phone', 'whatsapp'):
            current = partner[fname]
            if not current:
                continue
            e164 = partner._spa_e164(current)
            if not e164:
                skipped.append((partner.id, partner.display_name, fname, current))
            elif e164 != current:
                patch[fname] = e164
        if patch:
            # Straight SQL: this is a one-off rewrite of a value the ORM would
            # only hand back to the same formatter, and it keeps the migration
            # clear of every onchange and override in the way.
            cr.execute(
                "UPDATE res_partner SET %s WHERE id = %%s"
                % ', '.join('%s = %%s' % f for f in patch),
                list(patch.values()) + [partner.id])
            changed += 1

    _logger.info("spa: reformatted the numbers of %s contact(s)", changed)
    for pid, name, fname, value in skipped:
        _logger.warning(
            "spa: left %s of contact #%s (%s) as %r - no country code and it "
            "is not a valid number for the company's country either",
            fname, pid, name, value)

    # Normalising makes duplicates visible. Merging contacts is destructive and
    # needs someone to decide which one is the real customer, so only say so.
    cr.execute("""
        SELECT phone, array_agg(id ORDER BY id), count(*)
          FROM res_partner
         WHERE phone IS NOT NULL AND phone <> ''
         GROUP BY phone HAVING count(*) > 1
    """)
    for number, ids, count in cr.fetchall():
        _logger.warning(
            "spa: %s contacts now share the number %s (ids %s) - review and "
            "merge them by hand if they are the same person",
            count, number, list(ids))
