import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SpaService(models.Model):
    _name = 'spa.service'
    _description = 'Spa Service'
    _order = 'sequence, name'

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    description = fields.Text()
    image = fields.Image(max_width=512, max_height=512)
    price = fields.Float(required=True)
    duration = fields.Integer(string='Duration (minutes)', default=60)
    kiosk_visible = fields.Boolean(string='Show on Kiosk', default=True)
    active = fields.Boolean(default=True)
    question_ids = fields.One2many('spa.question', 'service_id', string='Questions')
    company_id = fields.Many2one(
        'res.company', default=lambda self: self.env.company, required=True)


class SpaQuestionHeading(models.Model):
    """A section title that questions are grouped under.

    A record rather than a word typed on each question: the wording is written
    once, a rename reaches every question at once, and `sequence` orders the
    sections independently of the questions inside them.
    """
    _name = 'spa.question.heading'
    _description = 'Spa Question Heading'
    _order = 'sequence, id'

    name = fields.Char(string='Heading', required=True)
    sequence = fields.Integer(default=10)
    pos_category_id = fields.Many2one(
        'pos.category', string='Therapy', ondelete='cascade', index=True,
        help="The therapy this heading belongs to. A question can only be "
             "filed under a heading of its own therapy.")
    question_ids = fields.One2many(
        'spa.question', 'heading_id', string='Questions')

    def _spa_heading_style(self):
        """Inline CSS for this section title.

        The look is one choice for the whole therapy (see `pos.category`), not
        something set again on every heading - so this only reads it. An empty
        recordset returns no style, which is what a question with no section
        needs.
        """
        if not self:
            return ''
        self.ensure_one()
        return self.pos_category_id._spa_heading_style()


class PosCategoryHeadingStyle(models.Model):
    """How the section titles of this therapy are drawn.

    One choice covering every heading under it: repeating a colour and three
    tick boxes on each heading row was only ever going to drift out of step.
    """
    _inherit = 'pos.category'

    spa_heading_color = fields.Char(
        string='Heading Colour',
        help="Colour of every section title of this therapy. Leave it empty "
             "to keep the colour each screen uses by default.")
    spa_heading_bold = fields.Boolean(string='Bold Headings', default=True)
    spa_heading_italic = fields.Boolean(string='Italic Headings')
    spa_heading_underline = fields.Boolean(string='Underlined Headings')

    # Anything that is not a plain hex colour is refused: this value ends up
    # inside a style attribute, so a string arriving by import or RPC must not
    # be able to smuggle extra CSS in behind it.
    _SPA_HEX = re.compile(r'^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$')

    def _spa_heading_style(self):
        """The inline CSS every section title of this therapy is drawn with."""
        if not self:
            return ''
        self.ensure_one()
        bits = []
        color = (self.spa_heading_color or '').strip()
        if color and self._SPA_HEX.match(color):
            bits.append('color: %s' % color)
        # Always stated, so unticking Bold really does un-bold titles that the
        # screens style strongly by default.
        bits.append('font-weight: %s' % (800 if self.spa_heading_bold else 400))
        if self.spa_heading_italic:
            bits.append('font-style: italic')
        if self.spa_heading_underline:
            bits.append('text-decoration: underline')
        return '; '.join(bits)

    @api.constrains('spa_heading_color')
    def _check_spa_heading_color(self):
        for category in self:
            color = (category.spa_heading_color or '').strip()
            if color and not self._SPA_HEX.match(color):
                raise ValidationError(
                    'Pick the heading colour with the colour picker - "%s" is '
                    'not a colour like #16A34A.' % category.spa_heading_color)


class SpaQuestion(models.Model):
    _name = 'spa.question'
    _description = 'Spa Service Question'
    _order = 'sequence, id'

    service_id = fields.Many2one(
        'spa.service', ondelete='cascade')
    product_tmpl_id = fields.Many2one(
        'product.template', string='Product', ondelete='cascade')
    name = fields.Char(string='Question', required=True)
    heading_id = fields.Many2one(
        'spa.question.heading', string='Heading', ondelete='set null',
        index=True,
        help="Optional section this question is asked under. Questions sharing "
             "a heading are shown as one block - on the booking page, the "
             "kiosk and the POS. Leave it empty to keep a question outside any "
             "section.")
    question_type = fields.Selection([
        ('text', 'Free Text'),
        ('yes_no', 'Yes / No'),
        ('single_choice', 'Single Choice'),
        ('multi_choice', 'Multiple Choice'),
    ], default='text', required=True)
    option_ids = fields.One2many('spa.question.option', 'question_id',
                                 string='Options')
    product_ids = fields.Many2many(
        'product.template', 'product_spa_question_rel', 'question_id',
        'product_tmpl_id', string='Services',
        domain=[('type', '=', 'service')])
    required = fields.Boolean(string='Mandatory', default=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    def _spa_heading_key(self):
        """The section this question sits in, as a plain compare value.
        0 means it belongs to no section."""
        self.ensure_one()
        return self.heading_id.id or 0

    def _spa_dedupe(self):
        """Drop repeated question TEXT, then order the survivors by SECTION.

        A recordset union only collapses identical *records*, so two different
        records carrying the same wording (one on the therapy, one on the
        product) would both be asked. A customer should never see the same
        question twice, whatever level it came from.

        The section grouping happens HERE and not in each screen, because every
        surface (POS, kiosk, booking page) resolves its questions through this
        method - so a section stays in one piece however the drag handles left
        the questions, and no screen can drift from another. Questions in no
        section come first, then each heading in its own `sequence` order, with
        the questions inside a heading keeping theirs.
        """
        seen = set()
        keep = []
        for q in self.sorted(lambda r: (r.sequence, r.id)):
            key = ' '.join((q.name or '').split()).casefold()
            if key in seen:
                continue
            seen.add(key)
            keep.append(q)

        def section(question):
            heading = question.heading_id
            return (1, heading.sequence, heading.id) if heading else (0, 0, 0)

        keep.sort(key=lambda q: section(q) + (q.sequence, q.id))
        return self.browse([q.id for q in keep])

    def unlink(self):
        """Removing a question must not destroy what customers already answered.

        `spa.booking.answer.question_id` is required, which makes its foreign
        key ONDELETE RESTRICT - so the trash icon on the therapy form failed
        with a raw database error on any question that had ever been answered.
        Archive those instead: `_spa_questions()` filters on `active`, so an
        archived question stops being asked and drops out of the therapy's
        Questions list (it reads as a delete from the form) while its answers
        stay readable in the customer's Spa Visits tab.
        """
        answers = self.env['spa.booking.answer'].sudo().search(
            [('question_id', 'in', self.ids)])
        answered = answers.question_id & self
        if answered:
            answered.write({'active': False})
        return super(SpaQuestion, self - answered).unlink()

    def _spa_has_owner(self):
        """A question must belong to something or nobody will ever be asked it.

        Base install: it belongs to one or more services. spa_online_booking
        overrides this to accept a therapy instead.
        """
        self.ensure_one()
        return bool(self.product_ids)

    @api.model
    def _spa_owner_error(self):
        return "A question must belong to a service."

    @api.constrains('product_ids')
    def _check_spa_owner(self):
        for question in self:
            if not question._spa_has_owner():
                raise ValidationError(question._spa_owner_error())

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        # @api.constrains only runs for fields present in vals, so saving a
        # blank form with no link at all slips straight past it - which is
        # exactly how the invisible orphan questions got created. Re-check
        # explicitly on every create.
        records._check_spa_owner()
        return records


class SpaQuestionOption(models.Model):
    _name = 'spa.question.option'
    _description = 'Spa Question Option'
    _order = 'sequence, id'

    question_id = fields.Many2one(
        'spa.question', required=True, ondelete='cascade')
    name = fields.Char(string='Option', required=True)
    sequence = fields.Integer(default=10)
