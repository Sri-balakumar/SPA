"""Lift the heading look from each heading up to its therapy.

19.0.1.4.0 put colour / bold / italic / underline on every spa.question.heading,
which meant setting the same four things again on each row. It is one choice per
therapy now. Carry over what a therapy's headings were already using - the first
heading that had a colour wins, otherwise simply the first - and drop the old
columns, which Odoo would leave behind.
"""
from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'spa_question_heading'
           AND column_name IN ('color', 'bold', 'italic', 'underline')
    """)
    if len(cr.fetchall()) < 4:
        return

    cr.execute("""
        SELECT pos_category_id, color, bold, italic, underline
          FROM spa_question_heading
         WHERE pos_category_id IS NOT NULL
         ORDER BY pos_category_id,
                  (color IS NULL OR color = '') ASC,   -- a set colour first
                  sequence, id
    """)
    env = api.Environment(cr, SUPERUSER_ID, {})
    seen = set()
    for category_id, color, bold, italic, underline in cr.fetchall():
        if category_id in seen:
            continue
        seen.add(category_id)
        env['pos.category'].browse(category_id).write({
            'spa_heading_color': color or False,
            'spa_heading_bold': bool(bold),
            'spa_heading_italic': bool(italic),
            'spa_heading_underline': bool(underline),
        })

    for column in ('color', 'bold', 'italic', 'underline'):
        cr.execute("ALTER TABLE spa_question_heading DROP COLUMN %s" % column)
