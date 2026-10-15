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

    # Off by default. It used to be on, which meant every POS category ever
    # created - stock, retail, anything - turned up as a bookable therapy on
    # the public booking page, and nobody knew why. Being bookable is a
    # deliberate act now.
    @api.model
    def _load_pos_data_fields(self, config):
        """Let the register tell a therapy line from a bottle of water.

        The payment screen refuses to validate an order whose SESSIONS have no
        assignee, and `pos_categ_ids` is already loaded on product.template -
        so this one flag is all the client needs to classify a line, with no
        round trip and no guessing from the product name.

        super() + append: pos.category's own implementation returns a plain
        list of core fields, and replacing it would drop them.
        """
        return super()._load_pos_data_fields(config) + ['spa_is_therapy']

    spa_is_therapy = fields.Boolean(
        string='Show as Therapy online', default=False,
        help="Tick to offer this category as a therapy on the online booking "
             "page. Off by default - a category is only bookable once somebody "
             "says so.")
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

    # RETIRED. Extras used to be picked per therapy here. They are now decided
    # by the product's CATEGORY - tick 'Offer as POS Add-on' on a product
    # category and everything filed under it is offered on every service (see
    # product_template.ProductCategory). Nothing reads this field and it is on
    # no view; kept only so the empty spa_category_addon_rel table can be
    # dropped in its own migration rather than as a side effect of this change.
    spa_addon_ids = fields.Many2many(
        'product.template', 'spa_category_addon_rel', 'category_id', 'product_id',
        string='Add-ons (retired)',
        domain=[('available_in_pos', '=', True), ('sale_ok', '=', True)])

    # The customer signs the waiver on the disclaimer page. Drawing it there and
    # then is the right default for consent, so this stays off unless a therapy
    # deliberately turns it on - see the comment in spa_signature.js.
    spa_signature_upload = fields.Boolean(
        string='Allow Signature Upload', default=False,
        help="Let staff attach a picture of the signature on the disclaimer "
             "page instead of the customer drawing it. Off by default: consent "
             "is normally signed on the spot.")

    def _spa_disclaimer_payload(self):
        """Carry the upload switch on the payload the disclaimer page already
        gets, so the signature box is configured by the same record that
        supplies the wording it sits under - no second trip to the server.

        Only when there IS a payload: `{}` is the documented "no disclaimer
        page" signal and every consumer tests it for truthiness, so putting a
        key in it would switch the page back on everywhere.
        """
        payload = super()._spa_disclaimer_payload()
        if payload:
            payload['allow_upload'] = self.spa_signature_upload
        return payload

    # NOTE: deliberately NOT added to pos.category's _load_pos_data_fields. The
    # Book Therapy wizard reads its whole catalogue from /api/spa/therapies -
    # the same payload the website uses - so the add-ons arrive with the
    # packages. What the POS *does* need is the add-on product records
    # themselves, so a line can be created; that is force-loaded in
    # product_template.py.

    def _spa_addons_for(self, product):
        """Every extra offered on `product`, as a product.template recordset.

        The single answer to "what add-ons does this package have?" - used by
        the POS wizard, the website payload AND the submit-time security check.
        They must agree: if the check consulted a different source, a perfectly
        legitimate add-on would be silently dropped when the customer booked it.

        Two sources, merged. The add-on CATEGORY list is the same for every
        service, so it does not depend on `self` at all - a therapy no longer
        picks its own extras. Layered on top is whatever the package itself
        carries in POS's built-in Upsell & Cross-Sell field, which keeps working
        exactly as before. Recordset union dedupes, so a product in both appears
        once.
        """
        addons = (self.env['product.template']._spa_addon_products()
                  | product.mapped('pos_optional_product_ids'))
        # Untick 'Available in POS' or 'Sales' on a product and it withdraws
        # from every screen at once, without editing any category.
        return addons.filtered(lambda a: a.available_in_pos and a.sale_ok)
