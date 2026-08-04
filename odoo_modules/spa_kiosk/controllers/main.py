import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


def _kiosk_blocked():
    """The walk-in kiosk is OFF unless spa_kiosk.enable_kiosk is switched on.

    Its submit route creates res.partner records AND draft pos.order lines in
    the live register, anonymously and without CSRF, so an unused kiosk must not
    be reachable from the internet.
    """
    enabled = request.env['ir.config_parameter'].sudo().get_param(
        'spa_kiosk.enable_kiosk', 'False')
    if enabled not in ('True', 'true', '1'):
        return request.not_found()
    return None


class SpaKiosk(http.Controller):

    def _kiosk_services(self):
        Product = request.env['product.template'].sudo()
        return Product.search(Product._spa_bookable_domain())

    @http.route('/spa/kiosk', type='http', auth='public', csrf=False)
    def kiosk_home(self, src=None, **kw):
        blocked = _kiosk_blocked()
        if blocked is not None:
            return blocked
        return request.render('spa_kiosk.kiosk_home', {
            'services': self._kiosk_services(),
            'src': src or '',
        })

    @http.route('/spa/kiosk/form/<int:service_id>', type='http',
                auth='public', csrf=False)
    def kiosk_form(self, service_id, src=None, **kw):
        blocked = _kiosk_blocked()
        if blocked is not None:
            return blocked
        service = request.env['product.template'].sudo().browse(service_id)
        if not service.exists() or not service._spa_is_bookable():
            return request.redirect('/spa/kiosk')
        questions = service._spa_questions()
        return request.render('spa_kiosk.kiosk_form', {
            'service': service,
            'questions': questions,
            'src': src or '',
        })

    def _open_session(self):
        """Most recently opened POS session, if any."""
        return request.env['pos.session'].sudo().search(
            [('state', '=', 'opened')], order='id desc', limit=1)

    def _find_or_create_partner(self, name, mobile):
        Partner = request.env['res.partner'].sudo()
        partner = Partner.browse()
        if mobile:
            partner = Partner.search([('phone', '=', mobile)], limit=1)
        if not partner:
            partner = Partner.create({'name': name or mobile, 'phone': mobile})
        return partner

    def _push_booking_to_pos(self, booking, service, session, partner):
        """Create a draft POS order (customer + service) in the open session so
        the kiosk booking shows up in the POS Orders list."""
        config = session.config_id
        product = service.product_variant_id
        if not product:
            return
        currency = config.currency_id
        taxes = product.taxes_id.filtered_domain(
            request.env['account.tax']._check_company_domain(config.company_id))
        price = booking.price or service.list_price
        computed = taxes.compute_all(
            price, currency, 1.0, product=product, partner=partner)

        # Carry the kiosk question answers onto the order line as a note so the
        # cashier can see them when selecting the order/customer.
        answers_note = ' | '.join(
            '%s: %s' % (a.question_id.name, a.value_text)
            for a in booking.answer_ids if a.value_text
        )

        request.env['pos.order'].sudo().create({
            'session_id': session.id,
            'company_id': config.company_id.id,
            'partner_id': partner.id,
            # Tablet-kiosk orders are tagged 'tab' for the Spa channel reports.
            # (Field defined by the spa_online_booking module; guarded so this
            # still works if that module isn't installed.)
            **({'spa_channel': 'tab'}
               if 'spa_channel' in request.env['pos.order']._fields else {}),
            'amount_tax': computed['total_included'] - computed['total_excluded'],
            'amount_total': computed['total_included'],
            'amount_paid': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': product.id,
                'qty': 1.0,
                'price_unit': price,
                'tax_ids': [(6, 0, taxes.ids)],
                'price_subtotal': computed['total_excluded'],
                'price_subtotal_incl': computed['total_included'],
                'full_product_name': product.display_name,
                'customer_note': answers_note,
            })],
        })

    @http.route('/spa/kiosk/submit', type='http', auth='public',
                methods=['POST'], csrf=False)
    def kiosk_submit(self, **post):
        blocked = _kiosk_blocked()
        if blocked is not None:
            return blocked
        Product = request.env['product.template'].sudo()
        service = Product.browse(int(post.get('service_id', 0)))
        if not service.exists():
            return request.redirect('/spa/kiosk')

        name = (post.get('customer_name') or '').strip()
        mobile = (post.get('mobile') or '').strip()
        payment_mode = post.get('payment_mode') or 'offline'
        source = 'online_link' if post.get('src') == 'wa' else 'walk_in'
        if not name or not mobile:
            return request.redirect(
                '/spa/kiosk/form/%s?src=%s' % (service.id, post.get('src', '')))

        # Collect answers for this service's questions
        answers = []
        form = request.httprequest.form
        for question in service._spa_questions():
            key = 'q_%s' % question.id
            if question.question_type == 'multi_choice':
                values = form.getlist(key)
                value = ', '.join(values)
            else:
                value = (post.get(key) or '').strip()
            if question.required and not value:
                return request.redirect(
                    '/spa/kiosk/form/%s?src=%s' % (service.id,
                                                   post.get('src', '')))
            if value:
                answers.append((0, 0, {
                    'question_id': question.id,
                    'value_text': value,
                }))

        # Align the booking (and its POS order) with the open register's company.
        session = self._open_session()
        company_id = session.company_id.id if session \
            else (service.company_id.id or request.env.company.id)

        partner = self._find_or_create_partner(name, mobile)
        booking = request.env['spa.booking'].sudo().create({
            'partner_name': name,
            'mobile': mobile,
            'partner_id': partner.id,
            'product_id': service.id,
            # `product_ids` is the source of truth once spa_online_booking
            # is installed (it drives the stored `price` compute and the POS
            # Tab lists). Guarded like `spa_channel` below so the kiosk
            # still works without that module.
            **({'product_ids': [(6, 0, [service.id])]}
               if 'product_ids' in request.env['spa.booking']._fields else {}),
            'price': service.list_price,
            'payment_mode': payment_mode,
            'source': source,
            # Bookings made on the tablet kiosk show under the POS "Tab" tab.
            # (Field defined by spa_online_booking; guarded so the kiosk still
            # works when that module isn't installed.)
            **({'spa_channel': 'tab'}
               if 'spa_channel' in request.env['spa.booking']._fields else {}),
            'answer_ids': answers,
            'company_id': company_id,
        })

        # Auto-push to POS so it appears in the Orders list with the customer.
        if session:
            try:
                self._push_booking_to_pos(booking, service, session, partner)
            except Exception:
                _logger.exception('Spa: failed to push booking %s to POS',
                                  booking.name)

        return request.redirect('/spa/kiosk/done/%s' % booking.name)

    @http.route('/spa/kiosk/done/<string:token>', type='http', auth='public',
                csrf=False)
    def kiosk_done(self, token, **kw):
        blocked = _kiosk_blocked()
        if blocked is not None:
            return blocked
        return request.render('spa_kiosk.kiosk_done', {'token': token})
