# STAND-IN for spa_kiosk. Delete this file when spa_kiosk supplies these.
#
# 19.0.11.12.0 of this module reads a per-therapy waiver off pos.category and
# calls _spa_disclaimer_payload() through super(), plus _spa_disclaimer() on the
# product - all of which belong to spa_kiosk, the module that owns the therapy
# concept. The spa_kiosk installed here is 19.0.1.7.0 and has none of them, so
# the views would fail to load on unknown fields and the POS sign sheet would
# raise at runtime.
#
# Everything here is therefore written to the shape the CONSUMERS already
# expect, not invented: controllers/main.py builds `'disclaimer': <payload>`
# for the booking page and the tablet, pos_category_therapy.py adds
# 'allow_upload' to it, and pos_order.py / service_signature.py read 'body' and
# 'title' off the product's payload.
#
# When the real spa_kiosk arrives: drop this file and its line in __init__.py.
# The field names and the payload keys are the contract - if spa_kiosk names
# them differently, the views and those three consumers are what to re-check.

from odoo import fields, models


class PosCategoryDisclaimer(models.Model):
    """The waiver a therapy asks its customers to accept.

    Lives on the therapy rather than on each package so one edit covers every
    package under it - the same reasoning the questions already follow.
    """
    _inherit = 'pos.category'

    # Off by default: a therapy that has never been given a waiver must not
    # start demanding consent to an empty page. Turning it off is also how a
    # therapy opts out entirely - see _spa_disclaimer_payload.
    spa_disclaimer_active = fields.Boolean(
        string='Show Disclaimer Page', default=False,
        help="Show the waiver as its own page after the questions, where the "
             "customer accepts it and signs. With this off no consent is "
             "asked and no signature is taken for this therapy.")
    # Translatable like every other customer-facing field on this model
    # (name, spa_tagline, spa_description): the booking page and the tablet
    # both request a language.
    spa_disclaimer_title = fields.Char(
        string='Disclaimer Title', translate=True)
    spa_disclaimer = fields.Html(
        string='Disclaimer', translate=True, sanitize=True,
        help="The waiver wording. Leave it empty and no disclaimer page is "
             "shown, even with the switch above on.")

    def _spa_disclaimer_payload(self):
        """The waiver for ONE therapy, or `{}` when it has none.

        `{}` is the documented "no disclaimer page" signal: the POS screens,
        the booking page and the tablet all test this for truthiness and skip
        the step when it is empty. So an inactive switch and an empty body have
        to give the same answer as a therapy that never had a waiver - anything
        else would show a blank page and ask the customer to sign it.

        Empty recordset gives `{}` too, following _spa_heading_style in
        spa_kiosk: the callers reach this through a product that may not be
        filed under any therapy.
        """
        if not self:
            return {}
        self.ensure_one()
        if not self.spa_disclaimer_active:
            return {}
        body = self.spa_disclaimer or ''
        # An "active" switch over an empty editor is a waiver still being
        # drafted, not one to put in front of a customer.
        if not body.strip():
            return {}
        return {
            # Defaulted rather than passed through empty: the POS renders this
            # with a bare t-esc (therapy_screen.xml, therapy_booking_dialog.xml)
            # and would draw a headless page. The booking page has its own
            # fallback, which this simply makes redundant.
            'title': self.spa_disclaimer_title or 'Disclaimer',
            'body': body,
        }


class ProductTemplateDisclaimer(models.Model):
    _inherit = 'product.template'

    def _spa_disclaimer(self):
        """The waiver a package's customer is asked to accept, or `{}`.

        Resolved from the THERAPY, the same way _spa_questions resolves the
        questions, so a package never carries wording of its own to drift out
        of step.

        First therapy with a waiver wins. Deliberately not merged the way
        questions are: two waivers concatenated would be a document nobody
        wrote, and a package under two therapies is a configuration mistake
        rather than a case to accommodate.
        """
        if not self:
            return {}
        self.ensure_one()
        for therapy in self.pos_categ_ids.filtered('spa_is_therapy'):
            payload = therapy._spa_disclaimer_payload()
            if payload:
                return payload
        return {}
