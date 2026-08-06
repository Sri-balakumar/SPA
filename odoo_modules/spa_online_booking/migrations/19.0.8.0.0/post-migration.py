"""Give existing customer contacts a Customer ID.

The field is new, so every contact created before it would print a blank
"Customer ID" on the invoice until it happened to be re-saved. Numbering them
once here means the block is complete from the first print.

Companies are skipped - a supplier does not need a customer number - and so is
anyone who somehow already has one, so re-running cannot renumber a customer
whose ID has already been printed on a document.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'res_partner'
           AND column_name = 'spa_customer_id'
    """)
    if not cr.fetchone():
        return

    from odoo import api, SUPERUSER_ID
    env = api.Environment(cr, SUPERUSER_ID, {})
    Partner = env['res.partner']

    # Clear numbers off anything backing a user account. OdooBot, the admin,
    # the public and portal template users are all res.partner rows with
    # is_company False, so an earlier run of this handed them customer numbers
    # and burned the low ones on records nobody will ever invoice.
    # active_test=False throughout: OdooBot and the portal template are
    # ARCHIVED user accounts, and a plain user_ids lookup hides an archived
    # user - which is how they got numbered in the first place.
    wrongly_numbered = Partner.with_context(active_test=False).search([
        ('spa_customer_id', '!=', False),
        ('user_ids', '!=', False),
    ])
    if wrongly_numbered:
        wrongly_numbered.write({'spa_customer_id': False})
        _logger.info('spa_online_booking: cleared the customer number from %s '
                     'user account(s)', len(wrongly_numbered))

    partners = Partner.search([
        ('spa_customer_id', '=', False),
        ('active', 'in', [True, False]),
    ], order='id')._spa_needs_customer_id()
    if not partners:
        return
    partners._spa_ensure_customer_id()
    _logger.info('spa_online_booking: numbered %s customer contact(s)',
                 len(partners))
