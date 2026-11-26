import logging

from odoo import api, models

_logger = logging.getLogger(__name__)


class WhatsAppEmailDispatch(models.AbstractModel):
    _inherit = 'whatsapp.email.dispatch'

    @api.model
    def send_record(self, record, partner, *args, **kwargs):
        """Send as before, then once more to the partner's own WhatsApp.

        Every sender in whatsapp_email - invoice on post, payment receipt,
        "Send via channels" - comes through here, and the WhatsApp half reads
        only partner.phone. So the second send hands the very same method a
        stand-in partner whose phone IS the WhatsApp number: the PDF, the
        text fallback, the log row and the "WhatsApp sent to ..." chatter line
        are all whatsapp_email's own, nothing of its sending is copied here.

        The stand-in is `new()` - in memory, never saved - and reads every
        other field from the real contact. The first send has already happened
        by the time this runs, so whatever goes wrong below can cost the second
        message but never the one the customer gets today.
        """
        result = super().send_record(record, partner, *args, **kwargs)
        try:
            # Callers all pass keywords. A positional send_email/send_whatsapp
            # (5th/6th after partner) could not be overridden safely - skip.
            if not partner or len(args) > 4 \
                    or not kwargs.get('send_whatsapp', True) \
                    or 'whatsapp' not in partner._fields:
                return result
            second = partner._spa_second_whatsapp()
            if not second:
                return result
            stand_in = partner.new({'phone': second}, origin=partner)
            super().send_record(record, stand_in, *args, **dict(
                kwargs, send_email=False, send_whatsapp=True))
        except Exception as e:  # noqa: BLE001 - never fail the original send
            _logger.warning("spa: WhatsApp copy to %s failed: %s",
                            partner.display_name if partner else '?', e,
                            exc_info=True)
        return result
