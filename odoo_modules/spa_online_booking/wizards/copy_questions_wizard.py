from odoo import _, api, fields, models
from odoo.exceptions import UserError


class SpaQuestionCopyWizard(models.TransientModel):
    """Copy questions from one therapy into others.

    Questions belong to a therapy, so every new therapy starts empty and a
    shared questionnaire (the PAR-Q health set, say) had to be retyped question
    by question and option by option. This copies a chosen set across instead.

    It duplicates, it does not link: editing the source afterwards leaves the
    copies alone. That is the honest behaviour for "add the same questions",
    but it does mean a questionnaire that changes often is still maintained in
    each therapy.
    """
    _name = 'spa.question.copy.wizard'
    _description = 'Copy Spa Questions to Other Therapies'

    source_category_id = fields.Many2one(
        'pos.category', string='Copy From', required=True, readonly=True,
        default=lambda self: self.env.context.get('active_id'))
    # Limited to the source's own questions - the point is to copy THESE, and
    # an unfiltered picker would offer every question in the database.
    question_ids = fields.Many2many(
        'spa.question', string='Questions to Copy',
        domain="[('pos_category_id', '=', source_category_id)]")
    target_category_ids = fields.Many2many(
        'pos.category', 'spa_copy_wizard_target_rel', 'wizard_id', 'category_id',
        string='Copy To', required=True,
        domain="[('spa_is_therapy', '=', True), ('id', '!=', source_category_id)]",
        help="The therapies that will receive a copy of the questions.")

    @api.model
    def default_get(self, fields_list):
        """Start with every question of the source ticked.

        Copying the whole set is the common case, so it should be one click;
        unticking a few is easier than hunting down the ones you want.
        """
        res = super().default_get(fields_list)
        source_id = res.get('source_category_id') or self.env.context.get('active_id')
        if source_id and 'question_ids' in fields_list:
            source = self.env['pos.category'].browse(source_id).exists()
            res['question_ids'] = [(6, 0, source.spa_question_ids.ids)] if source else []
        return res

    @api.onchange('source_category_id')
    def _onchange_source_category_id(self):
        self.question_ids = self.source_category_id.spa_question_ids

    def _target_heading(self, target, heading, cache):
        """The heading in `target` that this source heading maps to.

        Reuses one of the same name rather than making a second - two identical
        section titles on the booking page help nobody. Matched case- and
        space-insensitively, because "General Health" and "general health "
        are the same section to everyone except a string comparison.
        """
        if not heading:
            return False
        key = (heading.name or '').strip().lower()
        if key in cache:
            return cache[key]
        existing = target.spa_heading_ids.filtered(
            lambda h: (h.name or '').strip().lower() == key)
        found = existing[:1] or self.env['spa.question.heading'].create({
            'name': heading.name,
            'sequence': heading.sequence,
            'pos_category_id': target.id,
        })
        cache[key] = found
        return found

    def action_copy(self):
        self.ensure_one()
        if not self.target_category_ids:
            raise UserError(_("Pick at least one therapy to copy the questions into."))
        if not self.question_ids:
            raise UserError(_("Tick at least one question to copy."))

        Question = self.env['spa.question']
        # Source order matters: the copies should read in the same order they do
        # on the therapy they came from.
        questions = self.question_ids.sorted(lambda q: (q.sequence, q.id))
        copied = 0

        for target in self.target_category_ids:
            # One cache per target - a heading resolved for therapy A says
            # nothing about therapy B.
            cache = {}
            for question in questions:
                heading = self._target_heading(target, question.heading_id, cache)
                Question.create({
                    'name': question.name,
                    'question_type': question.question_type,
                    'required': question.required,
                    'sequence': question.sequence,
                    # The TARGET's heading, never the source's: a question filed
                    # under another therapy's heading is refused by
                    # _check_spa_heading_therapy.
                    'heading_id': heading.id if heading else False,
                    # Set on create, not after: _check_spa_owner requires a
                    # question to belong to something the moment it exists.
                    'pos_category_id': target.id,
                    'option_ids': [(0, 0, {'name': o.name, 'sequence': o.sequence})
                                   for o in question.option_ids],
                })
                copied += 1

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'title': _("Questions copied"),
                'message': _("%(count)s question(s) copied into %(therapies)s.") % {
                    'count': copied,
                    'therapies': ', '.join(self.target_category_ids.mapped('name')),
                },
                'next': {'type': 'ir.actions.act_window_close'},
            },
        }
