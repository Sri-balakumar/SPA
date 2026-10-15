import pytz

from odoo import api, fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    spa_brand_logo_url = fields.Char(
        compute='_compute_spa_brand_logo_url',
        help="Where the POS should fetch this company's brand image, or empty "
             "when there is nothing to show.",
    )
    spa_display_tz = fields.Char(
        compute='_compute_spa_display_tz',
        help="Timezone the POS prints this company's dates in, derived from "
             "the company's country.")

    def _compute_spa_display_tz(self):
        for company in self:
            company.spa_display_tz = company._spa_display_tz_name()

    def _compute_spa_brand_logo_url(self):
        """Resolve the brand image once, on the server, per company.

        The POS used to decide this in the browser and it could not be made to
        work, for two reasons:

        * `/web/image/<model>/<id>/<field>` answers an **empty** field with HTTP
          200 and Odoo's grey camera (web/static/img/placeholder.png), so the
          client cannot tell "no logo" from "a logo" and no onerror handler ever
          fires. Only the server can see the difference.
        * The company itself has to be resolved per record. On a database with
          branch companies the till belongs to a branch, which has its own logo -
          not necessarily the one showing on the parent's Settings page.

        Returning an empty string when nothing is set is the whole point: the
        template renders no <img> at all rather than a placeholder.
        """
        Config = None
        if 'invoice.template.config' in self.env:
            Config = self.env['invoice.template.config'].sudo()

        for company in self:
            url = ''
            # `Config is not None`, never `if Config`: an empty recordset is
            # falsy, so a plain truth test reads "no records yet" as "module not
            # installed" and silently skips the template logo for everyone.
            #
            # get_config() filters active=True and the company. Worth using
            # rather than a hand-written search: the module's own booking-page
            # route does neither, and can serve an archived config's logo.
            config = Config.get_config(company) if Config is not None else None
            if config and config.company_logo:
                url = '/web/image/invoice.template.config/%s/company_logo' % config.id
            elif company.logo:
                url = '/web/image/res.company/%s/logo' % company.id
            company.spa_brand_logo_url = url

    # ---- the timezone the business runs in ------------------------------
    #
    # `env.tz` (the context tz, else res.users.tz) answers "who is looking".
    # For a spa that is the wrong question: an appointment, a payment and a
    # redeemed session all happened in the CLIENT's country, and must read the
    # same whether the person opening the till sits in Muscat or in Chennai.
    # Before this, a receptionist in India saw every Oman timestamp 1h30 late.
    #
    # Derived from the company's COUNTRY, so there is nothing to configure and
    # it follows the company on a multi-company database.

    def _spa_display_tz_name(self):
        """Name of the timezone this company's dates should be shown in.

        The country is trusted OVER res.partner.tz deliberately: that field is
        already wrong on live data (an Oman company carrying Asia/Calcutta -
        this very bug frozen into a record), and it is consulted only for the
        few countries that span several zones.

        Never raises. Anything unrecognised falls back to today's behaviour, so
        a company with no country behaves exactly as it did before this existed.
        """
        company = (self[:1] or self.env.company).sudo()
        try:
            fallback = self.env.context.get('tz') or self.env.user.tz or 'UTC'
        except Exception:
            fallback = 'UTC'
        partner_tz = company.partner_id.tz or ''
        try:
            code = (company.country_id.code or '').upper()
            zones = list(pytz.country_timezones.get(code) or ()) if code else []
        except Exception:
            zones = []
        if zones:
            if len(zones) == 1:
                return zones[0]
            # US / AU / RU / BR span several. Let the company contact break the
            # tie, but only with a zone that is really in that country.
            return partner_tz if partner_tz in zones else zones[0]
        return partner_tz or fallback

    def _spa_display_tz(self):
        """`_spa_display_tz_name` as a tzinfo. Always usable."""
        try:
            return pytz.timezone(self._spa_display_tz_name())
        except Exception:
            return pytz.UTC

    def _spa_localize(self, dt):
        """A naive UTC datetime -> the same instant on the company's clock.

        Use this wherever `fields.Datetime.context_timestamp` used to be called
        on a stored value that belongs to the business rather than to whoever
        happens to be reading it.
        """
        if not dt:
            return dt
        if dt.tzinfo is None:
            dt = pytz.UTC.localize(dt)
        return dt.astimezone(self._spa_display_tz())

    def _spa_today(self):
        """Today's date on the company's clock - `fields.Date.context_today`
        asked of the business rather than of the viewer."""
        return self._spa_localize(fields.Datetime.now()).date()

    @api.model
    def _load_pos_data_fields(self, config):
        """Send the resolved URL to the POS - a short string, never the image.

        Core deliberately keeps `logo` out of the POS payload because it is a
        base64 blob loaded on every session start. This keeps it out.
        """
        return super()._load_pos_data_fields(config) + [
            'spa_brand_logo_url', 'spa_display_tz']
