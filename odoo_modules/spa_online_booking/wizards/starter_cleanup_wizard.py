import logging

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)

MODULE = 'spa_online_booking'
CATALOGUE_PREFIX = 'demo_'
MEMBER_TYPE_PREFIX = 'spa_member_type_'


class SpaStarterCleanup(models.TransientModel):
    """Remove the catalogue this module used to create on install.

    Older versions shipped `data/spa_starter_catalogue.xml` - four therapies,
    sixteen packages and their questions - as ordinary module data, so every
    database got them whether anyone wanted them or not. That file is gone now,
    but dropping it from the manifest does NOT remove what it already created:
    the records were loaded with noupdate="1", and `ir.model.data._process_end`
    deliberately skips those. They sit there until something deletes them on
    purpose. This is that something.

    Nothing in use is removed. A package that has been sold, a category that
    still holds products, a member type a price is keyed on - each is reported
    and left alone. Every unlink is attempted on its own so one blocked record
    cannot abort the rest, and running it twice is harmless.
    """
    _name = 'spa.starter.cleanup'
    _description = 'Remove Seeded Spa Starter Data'

    remove_catalogue = fields.Boolean(
        string='Remove starter therapies and packages',
        help="The four GO therapies, their sixteen packages and the questions "
             "that came with them. Anything sold or still holding products is "
             "kept.")
    untick_categories = fields.Boolean(
        string='Untick "Show as Therapy online" where it was never set up',
        help="Older versions ticked this by default, so ordinary retail "
             "categories appear on the booking page. Only categories with no "
             "tagline, no description and no questions are unticked - one that "
             "somebody configured is left alone.")
    remove_member_types = fields.Boolean(
        string='Remove seeded member types',
        help="Individual and Family 2/3/4. Any type a package price, booking "
             "or order line refers to is kept.")

    preview = fields.Text(readonly=True)
    report = fields.Text(readonly=True)

    # ------------------------------------------------------------------
    # Finding what was seeded
    # ------------------------------------------------------------------
    def _seeded(self, model, prefix):
        """Records this module created under `prefix`, still present.

        Read from ir.model.data rather than by name or by matching the XML: the
        rows survive the file being removed from the manifest, which is exactly
        the situation this wizard exists for. Filtering in Python rather than
        with '=like' keeps SQL wildcards out of it - an underscore is one.
        """
        rows = self.env['ir.model.data'].sudo().search([
            ('module', '=', MODULE), ('model', '=', model),
        ])
        ids = [r.res_id for r in rows if (r.name or '').startswith(prefix)]
        return self.env[model].sudo().browse(ids).exists()

    def _product_blockers(self, tmpl):
        """Why this package cannot be removed, or ''."""
        variants = tmpl.product_variant_ids
        if not variants:
            return ''
        sold = self.env['pos.order.line'].sudo().search_count(
            [('product_id', 'in', variants.ids)])
        if sold:
            return _("on %s POS order line(s)") % sold
        if 'sale.order.line' in self.env:
            quoted = self.env['sale.order.line'].sudo().search_count(
                [('product_id', 'in', variants.ids)])
            if quoted:
                return _("on %s sales order line(s)") % quoted
        booked = self.env['spa.booking'].sudo().search_count(
            ['|', ('product_ids', 'in', variants.ids),
                  ('product_id', 'in', variants.ids)])
        if booked:
            return _("on %s booking(s)") % booked
        passes = self.env['spa.session.pass'].sudo().search_count(
            [('product_tmpl_id', '=', tmpl.id)])
        if passes:
            return _("on %s session pass(es)") % passes
        return ''

    def _member_type_blockers(self, mtype):
        """Why this member type cannot be removed, or ''."""
        priced = self.env['spa.package.price'].sudo().search_count(
            [('member_type', '=', mtype.id)])
        if priced:
            # spa.package.price.member_type is ondelete='restrict', so an
            # unguarded unlink would raise rather than report.
            return _("used by %s package price(s)") % priced
        booked = self.env['spa.booking'].sudo().search_count(
            [('spa_member_type', '=', mtype.id)])
        if booked:
            return _("used by %s booking(s)") % booked
        return ''

    def _unconfigured_therapies(self):
        """Categories flagged as a therapy that nobody actually set up."""
        return self.env['pos.category'].sudo().search([
            ('spa_is_therapy', '=', True),
            ('spa_tagline', 'in', (False, '')),
            ('spa_description', 'in', (False, '')),
            ('spa_question_ids', '=', False),
        ])

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------
    @api.model
    def default_get(self, fields_list):
        vals = super().default_get(fields_list)
        if 'preview' in fields_list:
            vals['preview'] = self._build_preview()
        return vals

    def _build_preview(self):
        cats = self._seeded('pos.category', CATALOGUE_PREFIX)
        prods = self._seeded('product.template', CATALOGUE_PREFIX)
        types = self._seeded('spa.member.type', MEMBER_TYPE_PREFIX)
        loose = self._unconfigured_therapies()
        blocked = [p for p in prods if self._product_blockers(p)]
        lines = [
            _("Seeded therapies still present: %s") % len(cats),
            _("Seeded packages still present:  %s  (%s in use, will be kept)")
            % (len(prods), len(blocked)),
            _("Seeded member types present:    %s") % len(types),
            _("Categories shown as a therapy but never configured: %s")
            % len(loose),
        ]
        if not (cats or prods or types or loose):
            lines = [_("Nothing to clean up - this database has no seeded "
                       "starter data left.")]
        return '\n'.join(lines)

    def action_refresh(self):
        self.ensure_one()
        self.preview = self._build_preview()
        return self._reopen()

    def _reopen(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    # ------------------------------------------------------------------
    # Doing it
    # ------------------------------------------------------------------
    def _try_unlink(self, record, label, removed, skipped, reason=''):
        """Unlink one record, recording the outcome either way.

        Each on its own, because a single restricted foreign key would
        otherwise roll back everything that came before it in the same call.
        """
        if reason:
            skipped.append(_("kept %(name)s - %(why)s",
                             name=label, why=reason))
            return
        try:
            with self.env.cr.savepoint():
                record.unlink()
            removed.append(label)
        except Exception as err:  # noqa: BLE001
            _logger.info("Spa cleanup: could not remove %s: %s", label, err)
            skipped.append(_("kept %(name)s - %(why)s",
                             name=label, why=str(err).splitlines()[0][:120]))

    def action_apply(self):
        self.ensure_one()
        if not (self.remove_catalogue or self.untick_categories
                or self.remove_member_types):
            self.report = _("Nothing selected - tick at least one box.")
            return self._reopen()

        removed, skipped, notes = [], [], []

        if self.remove_catalogue:
            for tmpl in self._seeded('product.template', CATALOGUE_PREFIX):
                self._try_unlink(tmpl, tmpl.display_name, removed, skipped,
                                 reason=self._product_blockers(tmpl))
            # Categories after their packages: a category that just lost its
            # last package becomes removable in the same run.
            Template = self.env['product.template'].sudo()
            for cat in self._seeded('pos.category', CATALOGUE_PREFIX):
                # pos.category has no inverse to product.template, so ask the
                # products rather than reading a field that is not there.
                held = Template.search_count([('pos_categ_ids', 'in', cat.ids)])
                reason = _("still holds %s product(s)") % held if held else ''
                self._try_unlink(cat, cat.display_name, removed, skipped, reason)
            # Questions, headings and options hang off the category and go with
            # it. Anything orphaned by a kept category is removed here.
            for model in ('spa.question.option', 'spa.question',
                          'spa.question.heading'):
                for rec in self._seeded(model, CATALOGUE_PREFIX):
                    self._try_unlink(rec, rec.display_name, removed, skipped)

        if self.untick_categories:
            loose = self._unconfigured_therapies()
            if loose:
                loose.write({'spa_is_therapy': False})
                notes.append(_("Unticked 'Show as Therapy online' on %s "
                               "category(ies): %s")
                             % (len(loose), ', '.join(loose.mapped('name'))))

        if self.remove_member_types:
            for mtype in self._seeded('spa.member.type', MEMBER_TYPE_PREFIX):
                self._try_unlink(mtype, mtype.display_name, removed, skipped,
                                 reason=self._member_type_blockers(mtype))

        parts = []
        if removed:
            parts.append(_("Removed %s record(s):") % len(removed))
            parts += ['  - %s' % r for r in removed]
        if skipped:
            parts.append('')
            parts.append(_("Kept %s record(s):") % len(skipped))
            parts += ['  - %s' % s for s in skipped]
        if notes:
            parts.append('')
            parts += notes
        if not parts:
            parts = [_("Nothing to do.")]

        self.report = '\n'.join(parts)
        self.preview = self._build_preview()
        _logger.info("Spa starter cleanup: %s removed, %s kept.",
                     len(removed), len(skipped))
        return self._reopen()
