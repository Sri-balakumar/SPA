from odoo import models


def _digits(number):
    return ''.join(c for c in (number or '') if c.isdigit())


class ResPartner(models.Model):
    _inherit = 'res.partner'

    def _spa_second_whatsapp(self):
        """The WhatsApp number, when it is NOT the phone; else False.

        "WhatsApp same as phone" on the tablet saves the phone into both
        fields, so comparing digits is what keeps that customer from getting
        every invoice twice. Both are E.164 already (spa_kiosk formats them),
        the digits only guard against a hand-typed space.
        """
        self.ensure_one()
        whatsapp = (self.whatsapp or '').strip()
        if not _digits(whatsapp) or _digits(whatsapp) == _digits(self.phone):
            return False
        return whatsapp
