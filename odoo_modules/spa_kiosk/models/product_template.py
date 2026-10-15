from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    spa_question_ids = fields.Many2many(
        'spa.question', 'product_spa_question_rel', 'product_tmpl_id',
        'question_id', string='Service Questions')
    spa_kiosk_visible = fields.Boolean(
        string='Show on Spa Kiosk', default=False)
    spa_duration = fields.Integer(
        string='Duration (minutes)', default=60)
    spa_effective_question_ids = fields.Many2many(
        'spa.question', string='Questions Asked', compute='_compute_spa_effective_question_ids',
        help="The questions a customer is actually asked for this service - "
             "resolved exactly the same way by the POS, the kiosk and the "
             "online booking page.")

    @api.model
    def _spa_bookable_domain(self):
        """Which services a customer may book - ONE rule for every surface.

        Base rule: any service product. spa_online_booking narrows it to
        services filed under a THERAPY category, so the POS category is the
        only visibility control. `spa_kiosk_visible` is deliberately NOT
        consulted any more: its checkbox was removed from the product form, so
        anything created since defaulted to False and silently vanished from
        the booking page with no way to fix it from the UI.
        """
        return [('type', '=', 'service')]

    def _spa_is_bookable(self):
        """Same rule, for one record (route guards)."""
        self.ensure_one()
        return bool(self.filtered_domain(self._spa_bookable_domain()))

    def _compute_spa_effective_question_ids(self):
        for tmpl in self:
            tmpl.spa_effective_question_ids = tmpl._spa_questions()

    def _spa_questions(self):
        """Active questions to ask for these services, ordered, de-duplicated.

        THE single entry point - every consumer (POS, kiosk, booking page)
        must go through this, otherwise they drift apart and the product form
        ends up showing a different set from what the customer is asked.

        Base implementation resolves questions linked directly to the product;
        spa_online_booking overrides it to resolve them from the THERAPY.
        """
        return self.spa_question_ids.filtered('active')._spa_dedupe()

    @api.model
    def get_pos_spa_questions(self, product_tmpl_id):
        """Return the active spa questions for a service, for the POS dialog."""
        tmpl = self.browse(product_tmpl_id).sudo()
        if not tmpl.exists():
            return []
        res = []
        for q in tmpl._spa_questions():
            res.append({
                'id': q.id,
                'name': q.name,
                'heading': q.heading_id.name or '',
                'heading_id': q.heading_id.id or 0,
                'heading_style': q.heading_id._spa_heading_style(),
                'type': q.question_type,
                'required': q.required,
                'options': q.option_ids.mapped('name'),
            })
        return res

    def _spa_disclaimer(self):
        """The disclaimer of the therapy these services are filed under.

        Same resolution as `_spa_questions()`: the THERAPY is the source of
        truth, so one edit covers every package under it. A service filed under
        no therapy simply has no disclaimer.
        """
        self.ensure_one()
        therapy = self.pos_categ_ids.filtered('spa_is_therapy')[:1]
        return therapy._spa_disclaimer_payload()

    @api.model
    def get_pos_spa_disclaimer(self, product_tmpl_id):
        """`{title, body, style}` for the POS disclaimer step, `{}` if none.

        Deliberately a sibling of `get_pos_spa_questions` rather than a new key
        inside it: that one returns a bare list and every caller indexes it as
        one, so turning it into a dict would break each of them at once.
        """
        tmpl = self.browse(product_tmpl_id).sudo()
        if not tmpl.exists():
            return {}
        return tmpl._spa_disclaimer()
