from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SpaQuestion(models.Model):
    """Let a question belong to a THERAPY (its POS category) so the same set of
    questions is asked for every session package under that therapy — instead
    of repeating them on each package product."""
    _inherit = 'spa.question'

    pos_category_id = fields.Many2one(
        'pos.category', string='Therapy', ondelete='cascade', index=True)
    # Make the question text translatable so the booking page can show it in
    # the customer's language (the column becomes jsonb on upgrade).
    name = fields.Char(translate=True)
    def _spa_has_owner(self):
        self.ensure_one()
        return bool(self.pos_category_id) or super()._spa_has_owner()

    @api.model
    def _spa_owner_error(self):
        return ("A question must belong to a therapy. Choose one in the "
                "Therapy field (therapies are POS categories).")

    @api.constrains('pos_category_id')
    def _check_spa_owner_therapy(self):
        # Same rule, extra trigger: changing the therapy must re-validate.
        self._check_spa_owner()

    @api.constrains('heading_id', 'pos_category_id')
    def _check_spa_heading_therapy(self):
        """Headings belong to a therapy, so one therapy's section must not end
        up titling another's question - it would show up on a booking page the
        person who wrote it never looks at."""
        for question in self:
            heading = question.heading_id
            if not (heading.pos_category_id and question.pos_category_id):
                continue
            if heading.pos_category_id != question.pos_category_id:
                raise ValidationError(
                    'The heading "%s" belongs to %s, so it cannot be used on '
                    'a question of %s. Add the heading to this therapy instead.'
                    % (heading.name,
                       heading.pos_category_id.display_name,
                       question.pos_category_id.display_name))


class SpaQuestionHeading(models.Model):
    _inherit = 'spa.question.heading'

    # The customer reads it, so it is translatable like the question text
    # (the column becomes jsonb on upgrade).
    name = fields.Char(translate=True)


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    @api.model
    def _spa_bookable_domain(self):
        # The THERAPY category is the visibility control: file a service under
        # one and it is bookable, remove it and it is not. No extra tick box.
        return super()._spa_bookable_domain() + [
            ('pos_categ_ids.spa_is_therapy', '=', True)]

    def _spa_questions(self):
        """Therapy is the source of truth: a service is asked the questions of
        the therapy (POS category) it is filed under, so one edit covers every
        package of that therapy.

        Falls back to the service's own questions only when it has no therapy
        yet, so nothing silently stops being asked mid-migration.
        """
        questions = self.env['spa.question']
        for tmpl in self:
            therapies = tmpl.pos_categ_ids.filtered('spa_is_therapy')
            if therapies:
                questions |= therapies.spa_question_ids
            else:
                questions |= tmpl.spa_question_ids
        return questions.filtered('active')._spa_dedupe()


class SpaQuestionOption(models.Model):
    _inherit = 'spa.question.option'

    name = fields.Char(translate=True)


class PosCategory(models.Model):
    """A POS category doubles as a THERAPY on the booking page. On top of the
    category's own name + image (reused as the therapy photo) it carries the
    therapy's tagline/description and the questions shared by all its packages.
    The session packages themselves stay as product.template records filed
    under this category."""
    _inherit = 'pos.category'

    # Make the therapy (category) name translatable, so the booking page /
    # tablet can show the therapy name in Arabic too (leave the Arabic blank to
    # keep an English brand name like "GO Ease"). Column becomes jsonb on upgrade.
    name = fields.Char(translate=True)

    spa_is_therapy = fields.Boolean(
        string='Show as Therapy online', default=True,
        help="Show this category as a therapy on the online booking page.")
    spa_tagline = fields.Char(string='Tagline', translate=True)
    spa_description = fields.Html(
        string='Therapy Description', translate=True, sanitize=True)
    spa_ideal_for = fields.Char(
        string='Ideal For', translate=True,
        help="e.g. Beginners, Office Workers, Daily Tension Relief")
    spa_focus_areas = fields.Char(
        string='Focus Areas', translate=True,
        help="e.g. Neck, Shoulders, Back, Hips, Legs")
    spa_sequence = fields.Integer(string='Therapy Order', default=10)
    spa_heading_ids = fields.One2many(
        'spa.question.heading', 'pos_category_id', string='Headings')
    spa_question_ids = fields.One2many(
        'spa.question', 'pos_category_id', string='Questions')
