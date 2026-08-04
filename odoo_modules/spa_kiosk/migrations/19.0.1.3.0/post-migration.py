"""Turn the free-text question heading into spa.question.heading records.

19.0.1.2.0 shipped the heading as a Char typed on every question, so one
section meant retyping the same words on each question under it. It is a record
now - written once, renamed once, and ordered by its own `sequence`. Move
across whatever was already typed (one record per therapy per distinct
wording), then drop the old column, which Odoo would otherwise leave behind.
"""
from odoo import api, SUPERUSER_ID


def _text(value):
    # The column is jsonb where spa_online_booking made it translatable and
    # plain varchar otherwise; psycopg2 hands the first back as a dict.
    if isinstance(value, dict):
        value = value.get('en_US') or next(iter(value.values()), '')
    return ' '.join((value or '').split())


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'spa_question'
           AND column_name IN ('heading', 'pos_category_id')
    """)
    columns = {row[0] for row in cr.fetchall()}
    if 'heading' not in columns:
        return

    # pos_category_id belongs to spa_online_booking; headings are per therapy
    # where it is installed and global where it is not.
    owner = 'pos_category_id' if 'pos_category_id' in columns else 'NULL::integer'
    cr.execute("""
        SELECT id, heading, %s AS owner
          FROM spa_question
         WHERE heading IS NOT NULL
         ORDER BY sequence, id
    """ % owner)
    rows = cr.fetchall()

    env = api.Environment(cr, SUPERUSER_ID, {})
    Heading = env['spa.question.heading']
    Question = env['spa.question'].with_context(active_test=False)
    headings = {}
    for question_id, raw, category_id in rows:
        name = _text(raw)
        if not name:
            continue
        # Two spellings of one section ("Health" / " health ") were a real
        # possibility under free text; they collapse into one record here.
        key = (category_id, name.casefold())
        heading = headings.get(key)
        if heading is None:
            heading = Heading.create({
                'name': name,
                'sequence': (len(headings) + 1) * 10,
                'pos_category_id': category_id,
            })
            headings[key] = heading
        Question.browse(question_id).heading_id = heading

    cr.execute("ALTER TABLE spa_question DROP COLUMN heading")
