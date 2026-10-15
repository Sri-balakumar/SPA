"""Turn the plain-text disclaimer into HTML, keeping how it already looked.

19.0.1.8.0 stored `pos_category.spa_disclaimer` as Text with four separate
controls beside it - colour, bold, italic, underline - that applied to the whole
block. A waiver needs more than one look at a time, so it is a rich-text field
now and those four are gone.

Left alone, the change would wreck what is already written: HTML collapses
newlines, so a waiver typed as paragraphs would arrive as one run-on block, and
the colour it was shown in would simply vanish. So the text is converted here -
escaped, split into paragraphs, and wrapped in whatever the four old columns
were set to - and only then are those columns dropped.

The column is jsonb because the field is translatable, so every language key is
converted, not just the one the migrating user happens to be in.
"""
import json
import logging
import re
from html import escape

_logger = logging.getLogger(__name__)

_OLD_COLS = ('spa_disclaimer_color', 'spa_disclaimer_bold',
             'spa_disclaimer_italic', 'spa_disclaimer_underline')
_HEX = re.compile(r'^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{6})?$|^#[0-9A-Fa-f]{6}$')


def _to_html(text, color, bold, italic, underline):
    """Plain text -> HTML that reads the same and looks the same.

    Blank lines separate paragraphs; a single newline inside one becomes <br/>,
    which is how the text was displayed before (the screens used
    `white-space: pre-wrap`).

    The old look is re-applied INSIDE each paragraph, never around them. Nesting
    a block-level <p> inside an inline <span>/<strong> is invalid HTML: the
    editor normalises it on load by hoisting the <p> out, which leaves the
    wrapper empty and throws the text away.
    """
    if not text or not text.strip():
        return ''

    # Only a plain hex colour is carried over - this ends up in a style
    # attribute, and anything else must not ride along into it.
    color = (color or '').strip()
    color = color if _HEX.match(color) else ''

    def decorate(inner):
        """Inline wrappers, applied to the contents of one paragraph."""
        if color:
            inner = '<span style="color: %s;">%s</span>' % (color, inner)
        if underline:
            inner = '<u>%s</u>' % inner
        if italic:
            inner = '<em>%s</em>' % inner
        if bold:
            inner = '<strong>%s</strong>' % inner
        return inner

    blocks = re.split(r'\n\s*\n', text.replace('\r\n', '\n').strip())
    paras = []
    for block in blocks:
        body = '<br/>'.join(escape(line) for line in block.split('\n'))
        if body.strip():
            paras.append('<p>%s</p>' % decorate(body))
    return ''.join(paras)


def migrate(cr, version):
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'pos_category' AND column_name IN %s
    """, (_OLD_COLS,))
    present = {r[0] for r in cr.fetchall()}
    if not present:
        # Already migrated - nothing to carry over and nothing to drop.
        return

    cr.execute("""
        SELECT id, spa_disclaimer, spa_disclaimer_color, spa_disclaimer_bold,
               spa_disclaimer_italic, spa_disclaimer_underline
          FROM pos_category
         WHERE spa_disclaimer IS NOT NULL
    """)
    converted = 0
    for cid, raw, color, bold, italic, underline in cr.fetchall():
        # jsonb comes back as a dict (translatable field) but tolerate a bare
        # string in case the column was never converted to jsonb.
        if isinstance(raw, str):
            try:
                value = json.loads(raw)
            except ValueError:
                value = {'en_US': raw}
        else:
            value = raw or {}
        if not isinstance(value, dict):
            value = {'en_US': str(value)}

        new = {}
        for lang, text in value.items():
            if text and '<' in text and '>' in text:
                new[lang] = text      # already HTML, leave it be
            else:
                new[lang] = _to_html(text, color, bold, italic, underline)
        if new != value:
            cr.execute(
                "UPDATE pos_category SET spa_disclaimer = %s WHERE id = %s",
                (json.dumps(new), cid))
            converted += 1

    for col in present:
        cr.execute('ALTER TABLE pos_category DROP COLUMN "%s"' % col)

    _logger.info('spa_kiosk: converted %s disclaimer(s) to HTML, dropped %s',
                 converted, ', '.join(sorted(present)))
