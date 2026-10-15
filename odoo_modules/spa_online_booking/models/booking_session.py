import logging
import os
import socket
import time
import uuid
from datetime import timedelta
from urllib.parse import quote, urlsplit

from markupsafe import escape

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
# '/scoped_app/' rather than '/odoo/': core registers both on the same handler
# with the same `subpath`, so both reach controllers/booking_entry.py - and this
# one keeps the vendor's name out of a link the customer reads, which the
# white-label branding needs. Links already sent through /odoo/spa-book still work.
BOOKING_ENTRY_PATH = '/scoped_app/spa-book'


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

    # Both spellings, because Odoo 19 changed which one works partway through
    # its life: newer builds ignore `_sql_constraints` (they log "no longer
    # supported" and drop it, so the index is never created), older ones have
    # no `models.Constraint` at all and raise AttributeError on import - which
    # takes the whole module down, not just the constraint. Asking the running
    # build which it has is the only form that installs on both.
    if hasattr(models, 'Constraint'):
        _token_unique = models.Constraint(
            'UNIQUE(token)', 'Booking session token must be unique.')
    else:
        _sql_constraints = [
            ('token_unique', 'UNIQUE(token)',
             'Booking session token must be unique.')]

    @api.depends('token', 'whatsapp_number')
    def _compute_booking_url(self):
        for rec in self:
            if not rec.token:
                rec.booking_url = False
                rec.whatsapp_share_url = False
                continue
            # <base>/odoo/spa-book?db=<db>&token=...
            #
            # The short <base>/spa/book?token=... form lived here while
            # odoo.conf pinned `dbfilter` to one database. That pin is gone for
            # good: this server hosts a dozen client databases behind one host
            # name, so pinning it would take the other eleven offline. Without
            # it a session-less request cannot resolve a database on its own and
            # the short link drops the customer on the database selector - which
            # is exactly what it did over the Cloudflare tunnel.
            #
            # Carrying ?db= through BOOKING_ENTRY_PATH is what survives that,
            # and it also survives this module being dropped from
            # `server_wide_modules` - which /spa/book?db= alone does NOT, since
            # Odoo builds its no-database routing map from those modules only.
            # See controllers/booking_entry.py for the hand-off.
            url = '%s%s?db=%s&token=%s' % (
                rec.get_base_url(), BOOKING_ENTRY_PATH,
                quote(rec.env.cr.dbname), rec.token)
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

    def _email_message_body(self, url=None, name=None):
        """The booking link as an email: (subject, body_html, body_text).

        Kept beside _wa_message_body so the two channels say the same thing,
        and so whoever wires the transport up has the wording ready rather than
        inventing a second one. Deliberately plain HTML - this module has no
        mail.template records and adding one would put the text somewhere the
        WhatsApp copy is not.
        """
        self.ensure_one()
        link = url or self.booking_url or ''
        name = (name if name is not None else self.customer_name or '').strip()
        greeting = 'Hi %s,' % name if name else 'Hello,'
        subject = "Book your sessions at Stretch and Go"
        body_text = '%s\n\nBook your sessions at Stretch and Go here:\n%s' % (
            greeting, link)
        body_html = (
            '<p>%s</p>'
            '<p>Book your sessions at Stretch and Go here:</p>'
            '<p><a href="%s">%s</a></p>'
        ) % (escape(greeting), escape(link), escape(link))
        return subject, body_html, body_text

    def action_send_email_now(self, to_email=None, to_name=None,
                              session_id=None):
        """Send the booking link by email. Returns {'sent': bool, 'error': str}.

        Never raises, mirroring action_send_whatsapp_now: a failed send must not
        roll back the booking session or block the cashier, so the caller gets a
        flag and falls back to Copy Link.

        Sent on the gateway rather than through an ir.mail_server so that email
        lands under the same opt-out list, blocked words and caps as the
        WhatsApp message. A customer who asked this vendor to stop should not
        have to ask again on the other channel, which is exactly what happens
        when the two run through separate systems. It also means the vendor's
        mail credentials stay on the gateway - this database never sees them.
        """
        self.ensure_one()
        email = (to_email or '').strip()
        if not email:
            return {'sent': False, 'error': "No email address to send to."}
        # A link built on localhost is as useless in an inbox as in a WhatsApp
        # message: the customer's browser resolves it to their own machine.
        unreachable = self._wa_unreachable_base_url()
        if unreachable:
            return {'sent': False, 'error': unreachable}
        # Nothing to send with at all, as opposed to a session that is merely
        # switched off. Worth saying apart: ticking a checkbox cannot fix a
        # module that was never installed, and that is the advice below.
        if 'whatsapp.session' not in self.env:
            return {
                'sent': False,
                'error': "No mail gateway is installed on this database - "
                         "copy the link and send it yourself.",
            }
        session = self._get_wa_session(session_id)
        if not session:
            return {
                'sent': False,
                'error': "No gateway session is available to send email. Open "
                         "WhatsApp > Sessions and check the connection.",
            }
        # send_email() belongs to whatsapp_gateway. Another WhatsApp module can
        # satisfy _get_wa_session() without carrying an email channel at all.
        if not hasattr(session, 'send_email'):
            return {
                'sent': False,
                'error': "This gateway session cannot send email - copy the "
                         "link and send it yourself.",
            }
        if not session.use_email:
            return {
                'sent': False,
                'error': "Email is switched off for this gateway session - "
                         "tick Email on WhatsApp > Sessions, then try again.",
            }
        subject, body_html, body_text = self._email_message_body(name=to_name)
        try:
            sent = session.send_email(
                email, subject, body_html=body_html, body_text=body_text)
        except Exception as e:
            _logger.warning(
                "Spa booking link: email send to %s failed: %s", email, e)
            return {'sent': False, 'error': str(e)}
        if not sent:
            # send_email() returns False rather than raising when one of the
            # gateway's own rules stopped it - an opt-out, a blocked word, the
            # daily cap. The gateway has already logged which one; a
            # receptionist only needs to know not to keep pressing the button.
            return {
                'sent': False,
                'error': "The gateway did not send to %s - the address may "
                         "have opted out, or a sending limit was reached."
                         % email,
            }
        return {'sent': True, 'error': ''}

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

        Returns False when no WhatsApp module is installed. Callers already
        handle "no session" - that is the same state as one that is merely
        disconnected - so there is nothing extra for them to learn.
        """
        if 'whatsapp.session' not in self.env:
            return False
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
        # get_connected_session() belongs to whatsapp_gateway, not to every
        # WhatsApp module. Where it is missing, do the same job with the fields
        # they all carry: the configured session if it is still there, else
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
                return chosen[0]
        return (sessions.filtered(lambda s: s.status == 'connected')[:1]
                or sessions[:1])

    @api.model
    def pos_wa_sessions(self, wake=False):
        """The WhatsApp senders the POS can choose from, best first.

        `wake` is accepted and ignored: the Send Link dialog still passes it,
        and there is no longer anything to wake. Kept rather than removed so an
        older POS bundle in a browser cache does not fail on an unexpected
        argument.

        No WhatsApp module means no senders to offer. The dialog handles an
        empty list already - it shows the booking link and Copy Link, which is
        what staff need most of the time anyway.
        """
        if 'whatsapp.session' not in self.env:
            return {
                'sessions': [],
                'default_id': False,
                'any_connected': False,
                'can_wake': False,
            }
        Session = self.env['whatsapp.session'].sudo()
        sessions = Session.search([('active', '=', True)])
        # Asks the gateway and writes the answer back, so the flags below are
        # live rather than however stale the column happened to be. Gateway-only
        # again: without it the rows below still read session.status, so the
        # dialog lists every sender and still says which is connected - just
        # from whatever the column last recorded.
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
        # Nothing to send with at all, as opposed to a session that is merely
        # disconnected. Worth saying apart: scanning a QR code cannot fix a
        # module that was never installed, and that is the advice below.
        if 'whatsapp.session' not in self.env:
            return {
                'sent': False,
                'error': "No WhatsApp module is installed on this database - "
                         "copy the link and send it yourself.",
            }
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

        `vals` is a dict {whatsapp_number, email, customer_name, partner_id}; a
        bare string is still accepted for backwards compatibility. sudo() so a
        plain POS user can create the session.

        The customer may be reachable on a number, on an address, or on both,
        and NEITHER is required on its own - only that there is one of them.
        Each channel is attempted independently and reported separately, so a
        link that goes out on WhatsApp but not by email says exactly that.
        """
        if isinstance(vals, str):
            vals = {'whatsapp_number': vals}
        vals = vals or {}
        number = (vals.get('whatsapp_number') or '').strip()
        email = (vals.get('email') or '').strip()
        if not number and not email:
            return False
        # ONE shared link for the whole spa - we send the same URL to everybody
        # instead of minting a new one per customer. Each send is still
        # recorded as a whatsapp.message row, so the audit trail survives.
        session = self._get_shared_session()
        name = (vals.get('customer_name') or '').strip()
        # Only the channels actually asked for are attempted: an empty box is a
        # channel the customer did not give us, not one that failed.
        wa = {'sent': False, 'error': ''}
        if number:
            wa = session.action_send_whatsapp_now(
                vals.get('session_id'), to_number=number, to_name=name)
        mail = {'sent': False, 'error': ''}
        if email:
            mail = session.action_send_email_now(
                to_email=email, to_name=name,
                session_id=vals.get('session_id'))
        return {
            'token': session.token,
            'booking_url': session.booking_url,
            'whatsapp_share_url':
                session._wa_share_url_for(number, name) if number else False,
            'whatsapp_number': number,
            'email': email,
            'whatsapp_sent': wa['sent'],
            'whatsapp_error': wa['error'],
            'email_sent': mail['sent'],
            'email_error': mail['error'],
            # The original key names, kept as aliases of the WhatsApp result so
            # a POS still running a cached older bundle keeps reporting sends
            # correctly instead of always showing "did not accept".
            'sent': wa['sent'],
            'send_error': wa['error'],
        }
