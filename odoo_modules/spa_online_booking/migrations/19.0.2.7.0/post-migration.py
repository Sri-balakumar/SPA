import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Move spa questions off individual products and onto their THERAPY.

    Questions used to be attachable at two levels - directly to a product
    (``product_ids``) and to a therapy (``pos_category_id``) - and the different
    consumers disagreed about which to read. The product form showed only the
    product-level ones while the booking page asked both, so a service could
    show 1 question in the back office and ask 2 online.

    Therapy is now the single source of truth. This moves the legacy links over.
    Product links are deliberately NOT deleted: they are simply no longer read
    once the service has a therapy, and they remain as the fallback for services
    that have not been filed under one yet.
    """
    if not version:
        return

    env = api.Environment(cr, SUPERUSER_ID, {})
    Question = env['spa.question'].with_context(active_test=False)

    migrated = copied = skipped = 0
    homeless_products = set()

    for question in Question.search([('product_ids', '!=', False)]):
        therapies = question.product_ids.pos_categ_ids.filtered('spa_is_therapy')

        for product in question.product_ids:
            if not product.pos_categ_ids.filtered('spa_is_therapy'):
                homeless_products.add(product.display_name)

        if not therapies:
            skipped += 1
            continue

        if not question.pos_category_id:
            question.pos_category_id = therapies[0]
            migrated += 1

        # pos_category_id is a Many2one, so a question shared by products from
        # several therapies needs one copy per therapy to keep being asked.
        for therapy in therapies:
            if therapy == question.pos_category_id:
                continue
            already = Question.search_count([
                ('pos_category_id', '=', therapy.id),
                ('name', '=', question.name),
            ])
            if already:
                continue
            question.copy({'pos_category_id': therapy.id, 'product_ids': [(5, 0, 0)]})
            copied += 1
            _logger.info(
                "spa questions: copied %r onto therapy %r (it was shared across "
                "several therapies)", question.name, therapy.display_name)

    # Questions attached to nothing at all are invisible to every consumer -
    # dead rows that only show up as confusing duplicates in pickers.
    orphans = Question.search([
        ('pos_category_id', '=', False),
        ('product_ids', '=', False),
    ])
    n_orphans = len(orphans)
    if orphans:
        _logger.warning(
            "spa questions: deleting %d question(s) attached to no therapy and "
            "no service: %s", n_orphans, orphans.mapped('name'))
        orphans.unlink()

    if homeless_products:
        _logger.warning(
            "spa questions: %d service(s) carry questions but are not filed "
            "under any therapy, so nothing was migrated for them - they keep "
            "using their own questions. File them under a therapy (POS "
            "category with 'Show as Therapy online') to consolidate: %s",
            len(homeless_products), sorted(homeless_products))

    _logger.info(
        "spa questions migration: %d moved to a therapy, %d copied for extra "
        "therapies, %d skipped (no therapy), %d orphans deleted",
        migrated, copied, skipped, n_orphans)
