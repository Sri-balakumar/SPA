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
    """The process key whatsapp_neonize stamps on a session it owns."""
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
            # Carry the database in the link. Customers open it with no
            # session, so on a server hosting several databases Odoo cannot
            # tell which one to use and answers "No database is selected"
            # (404). ensure_db() in the controller validates this against
            # db_filter, so it cannot be used to reach a database the filter
            # would not allow.
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
    # WhatsApp delivery, through our own session (whatsapp_neonize)
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
    def _wa_live_session(self):
        """The WhatsApp session that can actually send right now.

        The `status` column alone is not enough: it outlives the process that
        held the client, so a session left over from before a restart still
        reads 'connected' while nothing can send through it.
        """
        Session = self.env['whatsapp.session'].sudo()
        for session in Session.search([('active', '=', True)]):
            if session.status == 'connected' and self._wa_owner_alive(session):
                return session
        return Session.browse()

    @api.model
    def _wa_wakeable(self):
        """Sessions neonize could reopen on its own - saved credentials, no QR."""
        return self.env['whatsapp.session'].sudo().search([
            ('active', '=', True),
            ('auto_reconnect', '=', True),
            ('db_path', '!=', False),
        ]).filtered(lambda s: s.db_path and os.path.exists(s.db_path))

    @api.model
    def _wa_release_dead_owner(self, session):
        """Free a session still marked as held by a process that is gone.

        neonize refuses to let anyone take a session over until the recorded
        owner has been silent for WA_OWNER_TIMEOUT (90s). That is the right
        rule for a busy process, but wrong immediately after a restart: the
        owner died with the server, so the whole POS waits 90 seconds for a
        heartbeat that will never arrive again. When owner_key names a PID on
        THIS machine that is no longer running, the heartbeat is provably
        stale - clear it so the session can be reopened at once.

        Deliberately limited to this host: a PID from another server says
        nothing about what is running here. And if we cannot PROVE the process
        is gone we leave the row alone, because stealing a session from a
        healthy client is exactly the bug the ownership rule prevents.
        """
        owner = session.owner_key or ''
        host, sep, pid = owner.rpartition(':')
        if not sep or host != socket.gethostname():
            return False
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return False
        if pid == os.getpid():
            return False                     # that is us
        try:
            import psutil
            if psutil.pid_exists(pid):
                return False                 # still running - hands off
        except ImportError:
            return False                     # cannot prove it is dead
        self.env.cr.execute(
            "UPDATE whatsapp_session SET owner_key = NULL, owner_heartbeat = NULL, "
            "       status = 'disconnected' "
            "WHERE id = %s AND owner_key = %s", (session.id, owner))
        session.invalidate_recordset(['owner_key', 'owner_heartbeat', 'status'])
        _logger.info(
            "Spa: WhatsApp session %s was still marked as held by %s, which is "
            "no longer running - released it.", session.name, owner)
        return True

    @api.model
    def _wa_owner_alive(self, session):
        """_owner_is_live(), corrected for an owner that no longer exists.

        The heartbeat age alone cannot tell "busy process" from "process that
        died 20 seconds ago", and for those 90 seconds the POS showed a dead
        session as ready to send. Ask whether the owning PID is still running
        too - and when it is not, release the row here so the very next step
        can reopen the session instead of waiting the timeout out.
        """
        if not session._owner_is_live():
            return False
        if session.owner_key == _wa_me():
            return True
        return not self._wa_release_dead_owner(session)

    @api.model
    def _wake_wa_session(self, timeout=WA_WAKE_TIMEOUT):
        """Reopen a WhatsApp session that no process is holding any more.

        Restarting Odoo leaves the session row pointing at the process that
        died with it. That owner's heartbeat only goes stale after
        WA_OWNER_TIMEOUT (90s), so the reconnect neonize runs ~10s into startup
        stands down ("session N is already held by ... - standing down") and
        nothing tries again until the 5-minute auto-reconnect cron. For up to
        those five minutes the POS shows "(not connected)" and Send fails,
        which is what staff kept hitting after a restart - so bring the session
        back on demand, from the till.

        Only sessions neonize would reconnect by itself are touched
        (auto_reconnect + credentials on disk), so this never pops a QR prompt
        and never disturbs a client that is already healthy.
        """
        live = self._wa_live_session()
        if live:
            return live
        Session = self.env['whatsapp.session'].sudo()
        candidates = self._wa_wakeable()
        if not candidates:
            return Session.browse()

        fresh = ['status', 'owner_key', 'owner_heartbeat']
        deadline = time.time() + max(0, timeout)
        last_try = None
        while True:
            # Retry the claim, don't only poll: the dead owner's heartbeat may
            # age out partway through our wait, and until it does every attempt
            # to take the session over is refused.
            if last_try is None or time.time() - last_try >= WA_WAKE_RETRY_EVERY:
                last_try = time.time()
                for session in candidates:
                    # Anyone holding it - including our own first attempt from a
                    # previous round - means a connect is already under way, and
                    # kicking it again would only reset it to 'connecting'.
                    # _wa_owner_alive() also frees the dead PID a restart leaves
                    # behind, which is what lets the first round through.
                    if self._wa_owner_alive(session):
                        continue
                    try:
                        session.action_connect()
                    except Exception as exc:
                        _logger.warning(
                            "Spa: could not wake WhatsApp session %s: %s",
                            session.name, exc)
            if time.time() >= deadline:
                break
            time.sleep(WA_WAKE_POLL)
            # action_connect() does its work in another thread on its own
            # cursor, so re-read from the database, not from this request's
            # cache - otherwise we would poll a value that can never change.
            Session.invalidate_model(fresh)
            # ...and push the owner's in-memory state into the column, rather
            # than waiting up to two minutes for the health-check cron to do it.
            candidates._wa_sync_status()
            Session.invalidate_model(fresh)
            live = self._wa_live_session()
            if live:
                _logger.info("Spa: WhatsApp session %s is back up.", live.name)
                return live
        Session.invalidate_model(fresh)
        return self._wa_live_session()

    @api.model
    def _get_wa_session(self, session_id=None):
        """The whatsapp.session used to send booking links.

        Prefers the one configured in Settings (there is usually more than one
        session on the database), otherwise falls back to the first connected
        one, and reopens a session whose owner died rather than failing the
        send. sudo() because a POS/receptionist user only has read access to
        whatsapp.session.
        """
        Session = self.env['whatsapp.session'].sudo()
        # An explicit choice from the Send Link dialog wins over everything.
        # Trust it even if the status column disagrees - send_message() checks
        # the live state itself and we degrade gracefully if it really is down.
        if session_id:
            try:
                chosen = Session.browse(int(session_id)).exists()
            except (TypeError, ValueError):
                chosen = Session.browse()
            if chosen:
                if not (chosen.status == 'connected'
                        and self._wa_owner_alive(chosen)):
                    # Picked, but nobody is holding it - reopen it before
                    # handing it to send_message().
                    self._wake_wa_session()
                    Session.invalidate_model(
                        ['status', 'owner_key', 'owner_heartbeat'])
                return chosen
        configured = self.env['ir.config_parameter'].sudo().get_param(
            'spa_online_booking.whatsapp_session_id')
        # Prefer the live-accurate picker: the `status` column is only refreshed
        # by a 2-minute cron, so searching it can miss a session that is in fact
        # connected. Falls back to the column for older whatsapp_neonize builds.
        if hasattr(Session, 'get_connected_session'):
            found = Session.get_connected_session(configured)
        else:
            found = Session.browse()
            if configured:
                try:
                    session = Session.browse(int(configured)).exists()
                except (TypeError, ValueError):
                    session = Session
                if session and session.status == 'connected':
                    found = session
            if not found:
                found = Session.search([('status', '=', 'connected')], limit=1)
        # Nothing usable: the process that held the session most likely went
        # down with the last restart, so reopen it instead of failing the send.
        return found or self._wake_wa_session()

    @api.model
    def pos_wa_sessions(self, wake=False):
        """The WhatsApp senders the POS can choose from, best first.

        Connected sessions are listed first and one is preselected, so staff
        never have to configure anything; when there is more than one number
        they can switch sender before sending.

        The Send Link dialog calls this twice: once plain, to paint the dialog
        immediately, and again with wake=True when nothing came back usable -
        that second call reopens a session whose owner died (see
        _wake_wa_session) so the till heals itself after a restart.
        """
        Session = self.env['whatsapp.session'].sudo()
        if wake:
            self._wake_wa_session()
            Session.invalidate_model(['status', 'owner_key', 'owner_heartbeat'])
        # Refreshes the (cron-lagged) status column as a side effect, so the
        # `connected` flags below are live rather than up to 2 minutes stale.
        live = (Session.get_connected_session()
                if hasattr(Session, 'get_connected_session') else Session.browse())
        rows = []
        for session in Session.search([('active', '=', True)]):
            rows.append({
                'id': session.id,
                'name': session.name or 'WhatsApp',
                'status': session.status,
                # Not `status == 'connected'` alone: that column outlives the
                # process that held the client, so a dead session was offered as
                # ready and only failed once staff pressed Send.
                'connected': (session.status == 'connected'
                              and self._wa_owner_alive(session)),
            })
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
        if not default_id and live:
            default_id = live.id
        if not default_id and rows:
            default_id = rows[0]['id']
        return {
            'sessions': rows,
            'default_id': default_id,
            'any_connected': any(r['connected'] for r in rows),
            # Whether waking one could help at all: a session that was never
            # scanned on this machine needs a QR, not a reconnect, and the
            # dialog must say so instead of offering a button that can't work.
            'can_wake': bool(self._wa_wakeable()),
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
