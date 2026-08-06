import logging
import os
import socket
import time
import uuid
from datetime import timedelta
from urllib.parse import quote, urlsplit

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

# Public path where the booking page is served. This is a controller route
# (see controllers/main.py: booking_page) that returns the page HTML with a
# no-cache header, so browsers always revalidate and pick up new asset
# versions immediately. The raw static path
# (/spa_online_booking/static/booking/index.html) still works too, for any
# links already sent, but it is cached by the browser for 7 days.
BOOKING_PAGE_PATH = '/spa/book'

# What the customer actually receives. `/spa/book` is only reachable before a
# database is chosen on a server that lists this module in
# `server_wide_modules`; this entry goes through `/odoo/<subpath>`, which every
# Odoo serves, and is handed on from there (controllers/booking_entry.py). One
# link format that works on a dedicated server and on a shared one alike.
BOOKING_ENTRY_PATH = '/odoo/spa-book'


def _wa_me():
    """The process key whatsapp_gateway stamps on a session it owns."""
    return '%s:%s' % (socket.gethostname(), os.getpid())

# How long the Send Link dialog may wait for a WhatsApp session it had to
# wake up. neonize reopens the socket from saved credentials in a couple of
# seconds; the retry exists because the dead owner's heartbeat has to age out
# first (WA_OWNER_TIMEOUT, 90s) when the wake happens right after a restart.
WA_WAKE_TIMEOUT = 20       # seconds a request is allowed to wait
WA_WAKE_RETRY_EVERY = 3    # seconds between attempts to take the session over
WA_WAKE_POLL = 0.5         # seconds between status re-reads


class SpaBookingSession(models.Model):
    """One row per WhatsApp link sent to a customer.

    Created when staff sends a booking link. The public booking page
    reads/writes to this record (via sudo, through the controller) using
    only the token - never a raw record ID - so a session can't be
    guessed or enumerated.
    """
    _name = 'spa.booking.session'
    _description = 'Online Booking Session (WhatsApp link)'
    _rec_name = 'token'

    token = fields.Char(
        required=True, index=True, copy=False, readonly=True,
        default=lambda self: uuid.uuid4().hex,
    )
    # Optional: the ONE shared link belongs to no single number. Legacy
    # per-customer rows still carry the number they were sent to.
    whatsapp_number = fields.Char()
    # Who the link was sent to. Either picked from the contacts (partner_id)
    # or typed by the cashier (customer_name) in the POS "Send Link" dialog.
    partner_id = fields.Many2one('res.partner', string='Contact')
    customer_name = fields.Char(string='Customer Name')
    state = fields.Selection([
        ('pending', 'Pending'),
        ('completed', 'Completed'),
        ('expired', 'Expired'),
    ], default='pending', required=True)
    # Kept for the existing rows only - booking links no longer expire, so
    # nothing sets or reads this any more.
    expires_at = fields.Datetime()
    booking_id = fields.Many2one('spa.booking', readonly=True)
    booking_url = fields.Char(
        string='Booking Link', compute='_compute_booking_url',
        help="Share this link with the customer to open the booking page.")
    whatsapp_share_url = fields.Char(
        string='WhatsApp Share Link', compute='_compute_booking_url')

    # Odoo 19 removed `_sql_constraints` (it is logged and silently dropped,
    # see odoo/orm/model_classes.py) - so the UNIQUE index never existed.
    _token_unique = models.Constraint(
        'UNIQUE(token)', 'Booking session token must be unique.')

    @api.depends('token', 'whatsapp_number')
    def _compute_booking_url(self):
        for rec in self:
            if not rec.token:
                rec.booking_url = False
                rec.whatsapp_share_url = False
                continue
            # LOCAL DEVIATION, and it is the rollback this code's own comment
            # prescribes. Upstream sends the short <base>/spa/book?token=...
            # form, which requires `dbfilter` to pin one database. THIS server
            # has an empty dbfilter and six databases, so the short form gives
            # the customer a database picker instead of a booking page.
            #
            # So: back to the BOOKING_ENTRY_PATH form, which is what 19.0.4.0.0
            # generated here and what every link already sent uses. It resolves
            # ?db= through ensure_db() in controllers/booking_entry.py and hands
            # the customer on, with no login and nothing to configure.
            #
            # Switch back to the short form only together with pinning
            # `dbfilter = ^SPA$` in odoo.conf - one without the other breaks it.
            url = '%s%s?db=%s&token=%s' % (
                rec.get_base_url(), BOOKING_ENTRY_PATH,
                rec.env.cr.dbname, rec.token)
            rec.booking_url = url
            # wa.me needs the number as digits only (no '+', spaces or dashes).
            digits = ''.join(c for c in (rec.whatsapp_number or '') if c.isdigit())
            if digits:
                text = quote(rec._wa_message_body(url))
                rec.whatsapp_share_url = 'https://wa.me/%s?text=%s' % (digits, text)
            else:
                rec.whatsapp_share_url = False

    @api.onchange('partner_id')
    def _onchange_partner_id(self):
        """Same convenience as the WhatsApp Send Message wizard: picking a
        contact fills in the name and number."""
        if self.partner_id:
            self.customer_name = self.partner_id.name or ''
            number = (
                getattr(self.partner_id, 'whatsapp', '')
                or self.partner_id.mobile
                or self.partner_id.phone
                or ''
            )
            if number:
                self.whatsapp_number = number

    # ------------------------------------------------------------------
    # WhatsApp delivery, through our own session (whatsapp_gateway)
    # ------------------------------------------------------------------
    def _wa_share_url_for(self, number, name=None):
        """wa.me fallback for ONE recipient. The link itself is shared, so the
        target number is per-send and cannot come off the record."""
        self.ensure_one()
        digits = ''.join(c for c in (number or '') if c.isdigit())
        if not digits:
            return False
        text = quote(self._wa_message_body(name=name))
        return 'https://wa.me/%s?text=%s' % (digits, text)

    def _wa_message_body(self, url=None, name=None):
        self.ensure_one()
        link = url or self.booking_url or ''
        name = (name if name is not None else self.customer_name or '').strip()
        greeting = 'Hi %s, ' % name if name else ''
        return '%sbook your sessions at Stretch and Go here: %s' % (greeting, link)

    @api.model
    def _get_wa_session(self, session_id=None):
        """The whatsapp.session used to send booking links.

        One question, asked of the gateway: which session can send right now.
        An explicit choice from the Send Link dialog wins; otherwise the one
        configured in Settings; otherwise whichever is connected.

        This used to be several hundred lines that woke a sleeping session -
        reading owner PIDs and heartbeats, checking credentials on disk,
        calling action_connect() and waiting for it. That was necessary when a
        neonize client died with the worker holding it. The gateway keeps the
        connection open across Odoo restarts, so there is nothing to wake, and
        the fields that machinery read no longer exist.

        sudo() because a POS or receptionist user has only read access to
        whatsapp.session.
        """
        Session = self.env['whatsapp.session'].sudo()
        if session_id:
            try:
                chosen = Session.browse(int(session_id)).exists()
            except (TypeError, ValueError):
                chosen = Session.browse()
            if chosen:
                return chosen
        configured = self.env['ir.config_parameter'].sudo().get_param(
            'spa_online_booking.whatsapp_session_id')
        # LOCAL DEVIATION: get_connected_session() is a whatsapp_gateway method.
        # The whatsapp_neonize build installed here does not have it, and an
        # AttributeError would land on staff pressing Send Link. Falls back to
        # the same order of preference by hand: the configured session, else
        # whichever is connected, else the first active one.
        if hasattr(Session, 'get_connected_session'):
            return Session.get_connected_session(configured)
        sessions = Session.search([('active', '=', True)])
        if configured:
            try:
                chosen = sessions.filtered(lambda s: s.id == int(configured))
            except (TypeError, ValueError):
                chosen = Session.browse()
            if chosen:
                return chosen
        return sessions.filtered(
            lambda s: s.status == 'connected')[:1] or sessions[:1]

    @api.model
    def pos_wa_sessions(self, wake=False):
        """The WhatsApp senders the POS can choose from, best first.

        `wake` is accepted and ignored: the Send Link dialog still passes it,
        and there is no longer anything to wake. Kept rather than removed so an
        older POS bundle in a browser cache does not fail on an unexpected
        argument.
        """
        Session = self.env['whatsapp.session'].sudo()
        sessions = Session.search([('active', '=', True)])
        # Asks the gateway and writes the answer back, so the flags below are
        # live rather than however stale the column happened to be.
        #
        # LOCAL DEVIATION: _refresh_state() is a whatsapp_gateway method and the
        # neonize build installed here does not have it. Skipped rather than
        # reimplemented: the rows below read session.status either way, so the
        # dialog still lists every sender and still says which is connected -
        # just from the stored column rather than a fresh check. Exactly what
        # this method was added to improve on, so the panel is the place to look
        # if a status looks wrong.
        if hasattr(sessions, '_refresh_state'):
            sessions._refresh_state()

        rows = [{
            'id': session.id,
            'name': session.name or 'WhatsApp',
            'status': session.status,
            'connected': session.status == 'connected',
        } for session in sessions]
        rows.sort(key=lambda r: (not r['connected'], r['id']))

        configured = self.env['ir.config_parameter'].sudo().get_param(
            'spa_online_booking.whatsapp_session_id')
        default_id = False
        if configured:
            try:
                cfg = int(configured)
            except (TypeError, ValueError):
                cfg = 0
            if any(r['id'] == cfg for r in rows):
                default_id = cfg
        if not default_id:
            connected = [r for r in rows if r['connected']]
            if connected:
                default_id = connected[0]['id']
            elif rows:
                default_id = rows[0]['id']
        return {
            'sessions': rows,
            'default_id': default_id,
            'any_connected': any(r['connected'] for r in rows),
            # Nothing to wake any more: when nothing is connected the number
            # needs attention in the panel, and offering a button that cannot
            # help would only send staff round in circles.
            'can_wake': False,
        }

    def _wa_unreachable_base_url(self):
        """Explain why this booking link can't be sent, or '' when it is fine.

        Guards against the classic mis-set web.base.url: the link is built from
        get_base_url(), and Odoo keeps that in sync with whatever host an admin
        last logged in from unless web.base.url.freeze is set.
        """
        self.ensure_one()
        url = self.booking_url or ''
        try:
            host = urlsplit(url).hostname or ''
        except ValueError:
            host = ''
        host = host.lower()
        bad_hosts = ('localhost', '127.0.0.1', '0.0.0.0', '::1')
        if host in bad_hosts or (host and '.' not in host and not host.isdigit()):
            return (
                "This booking link points at '%s', which the customer's phone "
                "cannot open (and WhatsApp will not make it tappable). Set "
                "web.base.url to the address customers reach the site on, and "
                "set web.base.url.freeze to True so it stops changing: "
                "Settings > Technical > System Parameters." % (host or url)
            )
        return ''

    def action_send_whatsapp_now(self, session_id=None, to_number=None, to_name=None):
        """Send the booking link over our own WhatsApp session.

        Never raises. whatsapp.session.send_message() raises UserError when the
        bridge is disconnected, and there is no queue or retry behind it - but a
        failed send must not roll back the booking session or block the cashier,
        so the caller gets a flag and falls back to the wa.me hand-off.
        """
        self.ensure_one()
        # The shared link has no number of its own, so the recipient is passed
        # in per send. Legacy per-customer rows still fall back to their own.
        number = (to_number or self.whatsapp_number or '').strip()
        if not number:
            return {'sent': False, 'error': "No WhatsApp number to send to."}
        # A link built on localhost is useless to a customer: on their phone
        # "localhost" is their OWN phone, and WhatsApp does not even render it
        # as a tappable link (its linkifier needs a real domain or IP), so it
        # arrives as dead plain text. Catch it here rather than at the customer.
        unreachable = self._wa_unreachable_base_url()
        if unreachable:
            return {'sent': False, 'error': unreachable}
        session = self._get_wa_session(session_id)
        if not session:
            return {
                'sent': False,
                'error': "No WhatsApp session is connected. Open WhatsApp > "
                         "Sessions and scan the QR code, then try again.",
            }
        try:
            # send_message() strips '+', spaces and dashes and builds the JID
            # itself, so hand it the number as stored.
            session.send_message(number, self._wa_message_body(name=to_name))
            return {'sent': True, 'error': ''}
        except Exception as e:
            _logger.warning(
                "Spa booking link: WhatsApp send to %s failed: %s", number, e)
            return {'sent': False, 'error': str(e)}

    def action_share_whatsapp(self):
        """Send on our own session. Only if that is unavailable do we fall back
        to opening wa.me in a new tab."""
        self.ensure_one()
        result = self.action_send_whatsapp_now()
        if result['sent']:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': "WhatsApp",
                    'message': "Booking link sent to %s." % self.whatsapp_number,
                    'type': 'success',
                    'sticky': False,
                },
            }
        if not self.whatsapp_share_url:
            return False
        return {
            'type': 'ir.actions.act_url',
            'url': self.whatsapp_share_url,
            'target': 'new',
        }

    def is_valid(self):
        """A link that exists is usable - forever, by anyone, any number of times.

        It used to also require state == 'pending' and expires_at >= now, which
        made every link single-use and dead after two hours. Dropping both is
        what revives the links already sitting in customers' WhatsApp: validity
        no longer depends on either field, so no data migration is needed.
        """
        self.ensure_one()
        return bool(self.token)

    SHARED_ICP = 'spa_online_booking.shared_session_id'

    @api.model
    def _get_shared_session(self):
        """THE booking link. One per database, created on first use.

        Send Link no longer mints a link per customer - the same URL goes to
        everyone, and any number of people can book through it. Its id lives in
        ir.config_parameter, the same pattern as the WhatsApp session setting.
        """
        ICP = self.env['ir.config_parameter'].sudo()
        stored = ICP.get_param(self.SHARED_ICP)
        if stored:
            try:
                shared = self.sudo().browse(int(stored)).exists()
            except (TypeError, ValueError):
                shared = self.sudo().browse()
            if shared:
                return shared
        # Reuse the oldest existing row if there is one, so links already sent
        # keep working, rather than minting yet another token.
        shared = self.sudo().search([], order='id', limit=1)
        if not shared:
            shared = self.sudo().create({'customer_name': 'Booking link'})
        ICP.set_param(self.SHARED_ICP, str(shared.id))
        return shared

    @api.model
    def create_for_number(self, whatsapp_number):
        """Called from the staff-side 'send link' action."""
        return self.create({'whatsapp_number': whatsapp_number})

    @api.model
    def pos_booking_link(self):
        """The one shared booking link, WITHOUT sending anything.

        The POS dialog shows the URL the moment it opens, so staff can copy it
        or read it out even when no WhatsApp session is connected. Returns the
        same URL every time - there is one permanent link for the whole spa.
        """
        session = self._get_shared_session()
        return {'token': session.token, 'booking_url': session.booking_url}

    @api.model
    def pos_create_link(self, vals):
        """Create a booking session from the POS "Send Link" button, send the
        link on our WhatsApp session, and report back whether it went out.

        `vals` is a dict {whatsapp_number, customer_name, partner_id}; a bare
        string is still accepted for backwards compatibility. sudo() so a plain
        POS user can create the session.
        """
        if isinstance(vals, str):
            vals = {'whatsapp_number': vals}
        vals = vals or {}
        number = (vals.get('whatsapp_number') or '').strip()
        if not number:
            return False
        # ONE shared link for the whole spa - we send the same URL to everybody
        # instead of minting a new one per customer. Each send is still
        # recorded as a whatsapp.message row, so the audit trail survives.
        session = self._get_shared_session()
        name = (vals.get('customer_name') or '').strip()
        sent = session.action_send_whatsapp_now(
            vals.get('session_id'), to_number=number, to_name=name)
        return {
            'token': session.token,
            'booking_url': session.booking_url,
            'whatsapp_share_url': session._wa_share_url_for(number, name),
            'whatsapp_number': number,
            'sent': sent['sent'],
            'send_error': sent['error'],
        }
