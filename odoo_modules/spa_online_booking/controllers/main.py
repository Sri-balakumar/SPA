import base64
import json
import logging
import re
import time
from datetime import datetime, timedelta, time as dtime

import pytz

from odoo import fields, http
from odoo.http import request
from odoo.addons.web.controllers.utils import ensure_db
from odoo.addons.spa_online_booking.models.date_of_birth import date_of_birth_error
from odoo.addons.spa_online_booking.models.package_price import spa_headcount

try:
    import phonenumbers
except ImportError:  # pragma: no cover - phonenumbers ships with Odoo
    phonenumbers = None

_logger = logging.getLogger(__name__)


def normalize_phone(raw):
    """Validate a phone number and return it in E.164 form.

    Requires an explicit country code (leading '+'). Returns
    ``(e164, None)`` when valid, otherwise ``(None, reason)`` where reason is
    ``'missing_country_code'``, ``'invalid_number'`` or ``'not_mobile'``.

    A landline is refused: every booking taken here is confirmed and chased on
    WhatsApp, so a number that cannot receive a message is not a number we can
    use. The browser enforces this with a table of per-country mobile prefixes
    (spa_validation.js); here it comes from `phonenumbers`, which knows the real
    allocated ranges and is the stricter of the two.
    """
    value = (raw or '').strip()
    if not value.startswith('+'):
        return None, 'missing_country_code'

    if phonenumbers is None:
        # Fallback light check if the library is unavailable: E.164 is a '+'
        # followed by 8-15 digits.
        digits = re.sub(r'\D', '', value)
        if not 8 <= len(digits) <= 15:
            return None, 'invalid_number'
        return '+' + digits, None

    try:
        parsed = phonenumbers.parse(value, None)
    except phonenumbers.NumberParseException:
        return None, 'invalid_number'
    if not phonenumbers.is_valid_number(parsed):
        return None, 'invalid_number'
    # FIXED_LINE_OR_MOBILE is the North American case: +1 has no separate
    # mobile range, so the library cannot tell them apart and refusing it would
    # reject every legitimate US number.
    if phonenumbers.number_type(parsed) not in (
            phonenumbers.PhoneNumberType.MOBILE,
            phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE):
        return None, 'not_mobile'
    return phonenumbers.format_number(
        parsed, phonenumbers.PhoneNumberFormat.E164), None


def json_response(data, status=200):
    return request.make_response(
        json.dumps(data, default=str),
        status=status,
        headers=[('Content-Type', 'application/json')],
    )


def parse_service_ids(raw):
    """Parse a service_ids value (comma-separated string, list, or single
    value) into a de-duplicated list of ints, preserving order. Returns None
    if any token is not a valid integer."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        tokens = raw
    else:
        tokens = str(raw).split(',')
    ids = []
    for tok in tokens:
        tok = str(tok).strip()
        if not tok:
            continue
        try:
            val = int(tok)
        except (ValueError, TypeError):
            return None
        if val not in ids:
            ids.append(val)
    return ids


def _same_person_booking_on(name, numbers, day):
    """An existing booking by the SAME person on the SAME date, or empty.

    "Same person" = same name (trimmed, case-insensitive) AND same number.
    Numbers are compared on the last 8 digits so +96891400038 and 91400038 are
    recognised as one person - the same rule _find_partners_by_phone and
    _pos_find_or_create_partner use. Rejected bookings do not block a re-try.
    """
    name = (name or '').strip().lower()
    tails = set()
    for number in numbers:
        digits = re.sub(r'\D', '', number or '')
        if digits:
            tails.add(digits[-8:] if len(digits) >= 8 else digits)
    if not name or not tails or not day:
        return request.env['spa.booking'].sudo().browse()

    candidates = request.env['spa.booking'].sudo().search([
        ('state', '!=', 'rejected'),
        ('slot_datetime', '>=', datetime.combine(day, dtime.min)),
        ('slot_datetime', '<=', datetime.combine(day, dtime.max)),
    ])

    def matches(booking):
        if (booking.partner_name or '').strip().lower() != name:
            return False
        for value in (booking.mobile, booking.whatsapp_number):
            digits = re.sub(r'\D', '', value or '')
            if not digits:
                continue
            tail = digits[-8:] if len(digits) >= 8 else digits
            if tail in tails:
                return True
        return False

    return candidates.filtered(matches)[:1]


MAX_SERVICES_PER_BOOKING = 10
MAX_NAME_LEN = 200
MAX_TEXT_LEN = 500


def _client_ip():
    """Best-effort caller IP, honouring a reverse proxy."""
    env = request.httprequest.environ
    fwd = env.get('HTTP_X_FORWARDED_FOR') or ''
    if fwd:
        return fwd.split(',')[0].strip()[:64]
    return (env.get('REMOTE_ADDR') or '')[:64]


def _json_payload():
    """Parse the body, refusing anything that is not a JSON object.

    The routes read the raw body, so a body of `"x"` or `5` used to reach
    payload.get() and raise AttributeError -> HTTP 500 with a traceback.
    Requiring application/json also forces a CORS preflight, which stops any
    web page silently POSTing bookings from a visitor's browser (these routes
    are csrf=False by necessity).
    """
    ctype = (request.httprequest.content_type or '').split(';')[0].strip()
    if ctype != 'application/json':
        return None, json_response({'error': 'invalid_content_type'}, 415)
    try:
        payload = json.loads(request.httprequest.data)
    except (ValueError, TypeError):
        return None, json_response({'error': 'invalid_json'}, 400)
    if not isinstance(payload, dict):
        return None, json_response({'error': 'invalid_json'}, 400)
    return payload, None


def _slot_is_bookable(slot_dt, products):
    """Why this slot may not be booked, or None when it is fine.

    Only strptime() used to run here, so 1900-01-01 03:17 was accepted and
    stored. Worse, the slot was never checked against what /api/spa/availability
    offers, so a script could book every hour for months and shut the salon's
    calendar down. Mirror the availability rules exactly.
    """
    if slot_dt.minute or slot_dt.second:
        return 'slot_not_on_grid'
    if not (OPEN_HOUR <= slot_dt.hour < CLOSE_HOUR):
        return 'slot_outside_opening_hours'
    now = _local_now()
    if slot_dt < now + timedelta(hours=_min_lead_hours()):
        return 'slot_too_soon'
    # 0 means NO maximum - the same convention get_availability and
    # _latest_booking_date use. Treating 0 as "zero hours ahead" rejected every
    # real booking with slot_too_far.
    max_hours = _max_lead_hours()
    if max_hours and slot_dt > now + timedelta(hours=max_hours):
        return 'slot_too_far'
    # A taken slot is NOT an error any more: the customer joins the waiting list
    # for it instead of being turned away. Only the lead-time rules above can
    # refuse a slot now. Who ends up holding it is decided at creation by
    # _spa_slot_taken() below.
    return None


def _spa_offered_addons(products):
    """The extras offered on `products`, via the one resolver every surface uses.

    Goes through `pos.category._spa_addons_for` so the therapy's list and the
    package's own built-in Upsell & Cross-Sell field are both honoured. Reading
    either source directly here would put this out of step with what the
    screens actually show.
    """
    if not products:
        return products.browse()
    therapies = products.mapped('pos_categ_ids').filtered('spa_is_therapy')
    return therapies._spa_addons_for(products)


def _spa_valid_addon_ids(raw_ids, products):
    """The submitted add-on ids that are genuinely offered on these packages.

    The booking endpoint is public, so an id arriving in the payload proves
    nothing. Anything not actually offered on one of the booked packages is
    dropped rather than charged for - otherwise a caller could attach any
    product in the database to their booking.
    """
    if not raw_ids or not products:
        return []
    try:
        wanted = {int(value) for value in raw_ids}
    except (TypeError, ValueError):
        return []
    return [addon.id for addon in _spa_offered_addons(products) if addon.id in wanted]


def _spa_slot_taken(slot_dt, products):
    """True when somebody already holds this slot for one of these services.

    Asks spa.booking._spa_slot_holder so availability, submit and promotion all
    use one definition of "taken" rather than three copies of the domain.
    """
    if not slot_dt or not products:
        return False
    Booking = request.env['spa.booking'].sudo()
    return bool(Booking._spa_slot_holder(slot_dt, products.ids))


def _rate_limited(ip, phone):
    """True when this caller has already booked more than we allow.

    Counts rows rather than keeping an in-memory counter, so the limit holds
    across every worker and every database on the server. Also gives the audit
    trail that was completely missing - online bookings are all created by the
    public user, so without client_ip there was no way to tell one abuser from
    a thousand customers.
    """
    ICP = request.env['ir.config_parameter'].sudo()
    per_ip = int(ICP.get_param('spa_online_booking.max_bookings_per_ip_hour', 10))
    per_phone = int(ICP.get_param('spa_online_booking.max_bookings_per_phone_day', 5))
    Booking = request.env['spa.booking'].sudo()
    now = fields.Datetime.now()
    if ip and per_ip > 0:
        if Booking.search_count([
                ('client_ip', '=', ip),
                ('create_date', '>=', now - timedelta(hours=1))]) >= per_ip:
            return True
    if phone and per_phone > 0:
        if Booking.search_count([
                ('mobile', '=', phone),
                ('create_date', '>=', now - timedelta(days=1))]) >= per_phone:
            return True
    return False


def _tab_api_blocked():
    """Guard for the tablet endpoints. Returns a response to send, or None.

    Two deliberate changes:
      * OFF unless `spa_online_booking.enable_tab_api` is switched on. These
        routes create bookings, read customer records and spend prepaid passes,
        so an unused feature must not sit on the internet.
      * FAIL CLOSED. The old check was `if api_key and payload != api_key`, and
        the parameter was never created - so `if api_key` was False and the
        check was skipped entirely, leaving all three routes anonymous.
    """
    ICP = request.env['ir.config_parameter'].sudo()
    if ICP.get_param('spa_online_booking.enable_tab_api', 'False') not in (
            'True', 'true', '1'):
        return request.not_found()
    if not ICP.get_param('spa_online_booking.tab_api_key'):
        _logger.warning(
            "Tablet API called but spa_online_booking.tab_api_key is not set - "
            "refusing. Set a key before enabling this API.")
        return json_response({'error': 'unauthorized'}, 401)
    return None


def _tab_api_key_ok(payload):
    key = request.env['ir.config_parameter'].sudo().get_param(
        'spa_online_booking.tab_api_key')
    return bool(key) and payload.get('api_key') == key


def _find_partners_by_phone(number):
    """Find customer contacts by phone / WhatsApp number. Tries an exact E.164
    match first, then a loose match on the last 8 digits (numbers get stored in
    slightly different formats). Returns a res.partner recordset (sudo)."""
    Partner = request.env['res.partner'].sudo()
    e164, _reason = normalize_phone(number)
    if e164:
        partners = Partner.search(['|', ('phone', '=', e164), ('whatsapp', '=', e164)])
        if partners:
            return partners
    digits = re.sub(r'\D', '', number or '')
    # A SHORT value here is a customer-database export, not a lookup: Odoo's
    # `like` wraps the value in %...%, so phone="5" matched every contact whose
    # number contains a 5 and handed back 20 of them - name, phone, WhatsApp,
    # age, gender and prepaid balances - to an anonymous caller. Walking 0-9,
    # 00-99 ... dumped the lot. Demand a full local number before matching.
    if len(digits) < 8:
        return Partner.browse()
    tail = digits[-8:]
    return Partner.search(
        ['|', ('phone', 'like', tail), ('whatsapp', 'like', tail)], limit=20)


def _partner_age(partner):
    """Age in whole years from res.partner.date_of_birth, or None if unset."""
    dob = getattr(partner, 'date_of_birth', False)
    if not dob:
        return None
    today = datetime.today().date()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


# A signature arrives as base64 PNG from the tablet. Cap the DECODED size: the
# request body is already unbounded, and an image field with no limit is an easy
# way to fill the disk.
MAX_SIGNATURE_BYTES = 2 * 1024 * 1024
MAX_EMAIL_LEN = 254

# Deliberately not the full RFC 5322 grammar - nobody wants that regex, and the
# strict version rejects addresses that work. This catches what people actually
# get wrong: no @, no dot in the domain, a space, or a bare domain like
# "angitha.com". Kept in step with EMAIL_RE in static/booking/spa_validation.js,
# which is the same rule in the browser.
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$')


# Per-IP throttle for the public customer lookup. Deliberately in memory: it
# only has to blunt someone walking a range of phone numbers through a page
# whose link is shared, and a database row per keystroke would be a worse trade.
_LOOKUP_HITS = {}
_LOOKUP_WINDOW = 60        # seconds
_LOOKUP_MAX = 20           # lookups per IP per window


def _lookup_rate_limited(ip):
    now = time.monotonic()
    hits = [h for h in _LOOKUP_HITS.get(ip, []) if now - h < _LOOKUP_WINDOW]
    if len(hits) >= _LOOKUP_MAX:
        _LOOKUP_HITS[ip] = hits
        return True
    hits.append(now)
    _LOOKUP_HITS[ip] = hits
    if len(_LOOKUP_HITS) > 5000:   # never let it grow without bound
        for key in [k for k, v in _LOOKUP_HITS.items()
                    if not v or now - v[-1] > _LOOKUP_WINDOW]:
            _LOOKUP_HITS.pop(key, None)
    return False


def _parse_email(payload):
    """Normalise the optional customer email. Returns (email_or_False, error)."""
    email = (payload.get('email') or '').strip()
    if not email:
        return False, None
    if len(email) > MAX_EMAIL_LEN or not EMAIL_RE.match(email):
        return False, 'invalid_email'
    return email, None


def _parse_signature(payload):
    """Return (base64_or_False, error) for a submitted signature.

    Accepts both the bare base64 the built app sends and a full
    "data:image/png;base64,..." URL, because different app builds send
    different shapes. Anything unusable is REPORTED rather than silently
    dropped - a signature that quietly vanishes is exactly the bug this fixes.
    """
    raw = payload.get('signature') or payload.get('signature_base64') or ''
    if not isinstance(raw, str):
        return False, 'invalid_signature'
    raw = raw.strip()
    if not raw:
        return False, None
    if raw.startswith('data:'):
        _head, sep, raw = raw.partition(',')
        if not sep:
            return False, 'invalid_signature'
    # Some encoders wrap base64 at 76 chars; validate=True rejects the newlines.
    raw = ''.join(raw.split())
    try:
        blob = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError):
        return False, 'invalid_signature'
    if not blob:
        return False, None
    if len(blob) > MAX_SIGNATURE_BYTES:
        return False, 'signature_too_large'
    # It must really be an image, or the POS shows a broken box for ever.
    if not (blob.startswith(b'\x89PNG\r\n\x1a\n')      # png
            or blob[:3] == b'\xff\xd8\xff'               # jpeg
            or blob[:6] in (b'GIF87a', b'GIF89a')         # gif
            or blob[:4] == b'RIFF'):                      # webp
        return False, 'invalid_signature'
    # Re-encode so padding/whitespace is normalised before it hits the ORM.
    return base64.b64encode(blob).decode(), None


def _spa_parse_members(payload, questions, member_type):
    """Normalise the people on this booking to exactly one dict per person.

    Returns (people, error_response). `people` always has as many entries as
    the member type covers - Family 3 means three - so callers never have to
    ask whether members were sent.

    Person 1 is the lead booker and falls back to the payload's own top-level
    name / phone / date_of_birth / signature / answers. That fallback is what
    keeps every existing client working: a caller that knows nothing about
    members still produces one correct person.
    """
    expected = spa_headcount(member_type)
    raw = payload.get('members')
    if raw and not isinstance(raw, list):
        return None, json_response({'error': 'invalid_members'}, 400)
    raw = list(raw or [])
    if not raw:
        # No members sent: the top-level fields ARE person 1.
        raw = [payload]
    elif not isinstance(raw[0], dict):
        return None, json_response({'error': 'invalid_members'}, 400)
    else:
        # The lead's contact details are only ever collected at the top level,
        # so fold them in rather than requiring the client to repeat them.
        lead = dict(payload)
        lead.update({k: v for k, v in raw[0].items() if v not in (None, '')})
        raw[0] = lead

    if len(raw) != expected:
        return None, json_response({
            'error': 'wrong_member_count',
            'expected': expected,
            'received': len(raw),
        }, 400)

    people = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            return None, json_response({'error': 'invalid_members'}, 400)
        name = (entry.get('name') or '').strip()
        if not name:
            return None, json_response(
                {'error': 'missing_member_name', 'person': index + 1}, 400)

        signature, sig_error = _parse_signature(entry)
        if sig_error:
            return None, json_response(
                {'error': sig_error, 'person': index + 1}, 400)
        dob, gender, dob_error = _parse_personal(entry)
        if dob_error:
            return None, json_response({
                'error': 'invalid_dob',
                'field': 'date_of_birth',
                'reason': dob_error,
                'person': index + 1,
            }, 400)
        # Person 2's email was never checked at all - only the lead's. Same
        # rule for everyone, or the family flow is the way round it.
        member_email, member_email_error = _parse_email(entry)
        if member_email_error:
            return None, json_response(
                {'error': member_email_error, 'field': 'email',
                 'person': index + 1}, 400)

        # Each person answers for themselves, so required questions are
        # checked per person - person 2's blank health history is exactly the
        # gap this whole feature exists to close.
        answers_in = entry.get('answers') or {}
        if not isinstance(answers_in, dict):
            return None, json_response({'error': 'invalid_answers'}, 400)
        answers = {}
        for q in questions:
            value = (answers_in.get(str(q.id)) or '').strip()
            if q.required and not value:
                return None, json_response({
                    'error': 'missing_answer',
                    'question_id': q.id,
                    'person': index + 1,
                }, 400)
            if value:
                answers[q.id] = value[:MAX_TEXT_LEN]

        people.append({
            'sequence': index + 1,
            'name': name[:MAX_NAME_LEN],
            'date_of_birth': dob,
            'gender': gender,
            'phone': (entry.get('phone') or '').strip()[:MAX_NAME_LEN],
            'email': member_email,
            'signature': signature,
            'terms_accepted': bool(entry.get('terms_accepted')),
            'answers': answers,
        })
    return people, None


def _parse_personal(payload):
    """Pull the optional Date of Birth + Gender from a booking payload.

    Returns (date_or_False, 'male'/'female'/'other'/False, reason_or_None).
    The date stays OPTIONAL - callers that never send one keep working - but a
    date that IS sent has to be a real, past, plausible one. It used to be
    swallowed: a birthday of 2029 simply became False and the booking was
    accepted with no date at all and nobody any the wiser.
    """
    dob_raw = (payload.get('date_of_birth') or payload.get('dob')
               or payload.get('birthday') or '').strip()
    gender = (payload.get('gender') or '').strip().lower()
    if gender not in ('male', 'female', 'other'):
        gender = False
    if not dob_raw:
        return False, gender, None
    try:
        dob = datetime.strptime(dob_raw, '%Y-%m-%d').date()
    except ValueError:
        return False, gender, 'invalid_date'
    # Same helper the model constraint raises from, so the API and the till
    # cannot drift apart on what counts as a plausible birthday.
    reason = date_of_birth_error(dob, request.env)
    if reason:
        return False, gender, reason
    return dob, gender, None


# Salon opening hours for the (stubbed) hourly slot grid. Used by both the
# availability filter and the earliest-bookable-date calc so they stay in sync.
OPEN_HOUR = 9
CLOSE_HOUR = 18


def resolve_lang(raw):
    """Map a UI language ('ar' / 'en' / a full code) to an active res.lang
    code, so translated content is returned in that language. Returns None if
    nothing suitable is active (caller then keeps the request default)."""
    if not raw:
        return None
    Lang = request.env['res.lang'].sudo()
    if Lang.search_count([('code', '=', raw), ('active', '=', True)]):
        return raw
    prefix = raw.split('_')[0].split('@')[0]
    match = Lang.search(
        [('code', '=like', prefix + '%'), ('active', '=', True)], limit=1)
    return match.code or None


def lang_env(raw):
    """request.env forced to the resolved language (or unchanged if none)."""
    lang = resolve_lang(raw)
    if lang:
        return request.env(context=dict(request.env.context, lang=lang))
    return request.env


def therapy_questions(products):
    """The questions to ask for a set of chosen packages (products).

    Thin wrapper kept for the existing call sites. All resolution lives in
    product.template._spa_questions() so the POS, the walk-in kiosk and the
    booking page can never drift apart again (they used to: the form showed
    one question while the booking page asked two)."""
    return products._spa_questions()


def _local_now():
    """Current wall-clock time in the salon's timezone as a NAIVE datetime,
    matching how slot_datetime is stored (the local time the customer picked).

    This is what makes "hide already-passed times for today" correct even when
    the Odoo server itself runs in a different timezone (e.g. UTC). Falls back
    to the raw server clock if no timezone is configured."""
    # The company's zone, derived from its country: the public user (tablet /
    # website endpoints run as public) gets the salon's clock rather than none,
    # and a staff member abroad gets the salon's clock rather than their own.
    # sudo() because public cannot read res.partner or res.country directly.
    try:
        return datetime.now(
            request.env.company.sudo()._spa_display_tz()).replace(tzinfo=None)
    except Exception:
        return datetime.now()


def _lead_hours(param, default=0):
    """Read a configurable booking-notice bound (in hours) from settings."""
    raw = request.env['ir.config_parameter'].sudo().get_param(param, default)
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


def _min_lead_hours():
    """Minimum booking notice, in hours (Settings → Spa Online Booking).
    Customers can only book a slot at least this far in the future."""
    return _lead_hours('spa_online_booking.min_lead_hours')


def _max_lead_hours():
    """Maximum booking notice, in hours. Customers cannot book a slot more than
    this far in the future. 0 = no maximum."""
    return _lead_hours('spa_online_booking.max_lead_hours')


def _earliest_booking_date():
    """First date ('YYYY-MM-DD') that still has a bookable slot given the
    minimum lead time — today if a slot before closing still qualifies,
    otherwise the next day. Used to set the date picker's minimum."""
    cutoff = _local_now() + timedelta(hours=_min_lead_hours())
    day = cutoff.date()
    if cutoff.hour >= CLOSE_HOUR:
        day = day + timedelta(days=1)
    return day.strftime('%Y-%m-%d')


def _latest_booking_date():
    """Last date ('YYYY-MM-DD') that still has a bookable slot given the maximum
    lead time, or None when no maximum is set. Used to set the picker's max —
    if the limit falls before opening time, that day has no valid slot, so the
    previous day is the last bookable one."""
    max_hours = _max_lead_hours()
    if not max_hours:
        return None
    limit = _local_now() + timedelta(hours=max_hours)
    day = limit.date()
    if limit.hour < OPEN_HOUR:
        day = day - timedelta(days=1)
    return day.strftime('%Y-%m-%d')


class SpaBookingApiController(http.Controller):
    """Plain REST-style JSON endpoints (not Odoo's JSON-RPC envelope) so the
    static HTML/JS page can call them with a normal fetch(). Runs as sudo()
    since callers are unauthenticated website visitors — every endpoint
    independently validates the token before touching data.

    Matches the real spa_kiosk models:
      - services  = product.template (type='service', filed under a therapy
                    POS category - see product.template._spa_bookable_domain)
      - questions = spa.question, resolved by product.template._spa_questions()
                    (therapy-level, i.e. the package's POS category)
      - booking   = spa.booking (product_ids: one OR MORE services per booking;
                    product_id keeps the first as the "primary" for back-compat)
    """

    # ---------- booking page (served with no-cache) ----------

    @http.route('/spa/book', type='http', auth='none', methods=['GET'], csrf=False)
    def booking_page(self, **kw):
        """Serve the static booking page HTML with a no-cache header so the
        browser always revalidates it.

        The page's CSS/JS carry ?v=, and Odoo serves those files with
        max-age=604800 - a week. So the version is what decides whether a
        returning visitor sees a change at all, and it is STAMPED HERE from the
        module's own version rather than typed into index.html. A hard-coded
        number has to be remembered on every edit, and forgetting it looks
        exactly like a broken feature: the server has the new file, the browser
        keeps serving the old one, and nothing in the logs says so.

        The ?token= query is preserved for the JS.

        auth='none' + ensure_db(): the customer arrives with no session, so on a
        multi-database server Odoo cannot pick a database and returns
        "No database is selected" (404). The link carries ?db=; ensure_db()
        checks it against db_filter (no database forging), stores it on the
        session and redirects once so the cookie is set. Every /api/spa/* call
        the page then makes resolves normally. ensure_db() only works on routes
        reachable without a database, hence auth='none' - safe here because this
        handler just streams a static file and never touches request.env."""
        ensure_db()
        import os
        path = os.path.join(
            os.path.dirname(__file__), '..', 'static', 'booking', 'index.html')
        with open(path, 'rb') as fh:
            html = fh.read()
        html = html.replace(b'__SPA_ASSET_V__', self._spa_asset_version())
        return request.make_response(html, headers=[
            ('Content-Type', 'text/html; charset=utf-8'),
            ('Cache-Control', 'no-cache, no-store, must-revalidate'),
            ('Pragma', 'no-cache'),
            ('Expires', '0'),
        ])

    @staticmethod
    def _spa_asset_version():
        """The cache-busting token for the booking page's CSS/JS, as bytes.

        The newest modification time of the page's asset files. That changes
        exactly when one of them is edited - no upgrade needed, and nothing to
        remember. Deliberately NOT read from the ORM: this route is auth='none'
        precisely so a customer with no session can reach it, and request.env
        is not dependable there.

        Not cached on the class either. It is a few stat() calls on a page that
        is served once per customer, and caching would mean a file edited while
        the server runs stays invisible until a restart - the exact failure
        this replaces.
        """
        import os
        here = os.path.join(os.path.dirname(__file__), '..', 'static', 'booking')
        newest = 0
        for name in ('style.css', 'i18n.js', 'script.js', 'spa_validation.js'):
            try:
                newest = max(newest, int(os.path.getmtime(os.path.join(here, name))))
            except OSError:
                # A missing asset is the page's problem, not this helper's; the
                # tag still needs a value so the URL stays well-formed.
                _logger.warning("spa booking page: cannot stat %s", name)
        return str(newest or 'dev').encode()

    # ---------- booking page logo (public) ----------

    @http.route('/spa/booking/logo', type='http', auth='public', methods=['GET'], csrf=False)
    def booking_logo(self, **kw):
        """Public logo for the booking page: the Dynamic Invoice Template's
        'Invoice Logo' (invoice.template.config.company_logo), falling back to
        the company logo. Served sudo so unauthenticated visitors can load it."""
        import base64
        from odoo.tools.mimetypes import guess_mimetype
        env = request.env
        config = None
        if 'invoice.template.config' in env:
            Config = env['invoice.template.config'].sudo()
            config = Config.search([('company_id', '=', env.company.id)], limit=1)
            if not (config and config.company_logo):
                # Fall back to any config that actually has a logo set.
                config = Config.search([]).filtered('company_logo')[:1] or config
        if config and config.company_logo:
            raw = base64.b64decode(config.company_logo)
            return request.make_response(raw, headers=[
                ('Content-Type', guess_mimetype(raw) or 'image/png'),
                ('Cache-Control', 'public, max-age=3600'),
            ])
        # Fallback: the company logo.
        company = env.company.sudo()
        if company.logo:
            return env['ir.binary']._get_image_stream_from(
                company, field_name='logo').get_response()
        return request.not_found()

    # ---------- POS sales report (PDF) ----------

    @http.route('/spa/sales_report', type='http', auth='user', methods=['GET'], csrf=False)
    def spa_sales_report(self, date_from=None, date_to=None, config_id=None,
                         title='SALE REPORT', **kw):
        """Render the POS Sales Report PDF for a date range. Called from the POS
        'Sales Report' button (auth='user' — the cashier is logged in). The JS
        computes date_from/date_to (local YYYY-MM-DD) for the chosen period."""
        # auth='user' includes PORTAL users - customers with a website login -
        # and the body runs sudo(), so without this check anyone with any login
        # could download the salon's complete revenue report.
        if not request.env.user.has_group('point_of_sale.group_pos_user'):
            return request.make_response('Forbidden', status=403)
        if not date_from or not date_to:
            return request.make_response('Missing date range.', status=400)
        try:
            cfg_id = int(config_id) if config_id else False
        except (TypeError, ValueError):
            cfg_id = False
        # Restrict to registers the user's own companies own; config_id used to
        # be accepted verbatim, so any register in any company could be read.
        allowed = request.env['pos.config'].sudo().search(
            [('company_id', 'in', request.env.user.company_ids.ids)])
        if cfg_id and cfg_id not in allowed.ids:
            return request.make_response('Forbidden', status=403)
        if not cfg_id:
            cfg_id = allowed[:1].id
        if not cfg_id:
            return request.make_response('No register available.', status=404)
        r = request.env['pos.config'].sudo().build_spa_sales_report(
            cfg_id, date_from, date_to, title)
        pdf, _ = request.env['ir.actions.report'].sudo()._render_qweb_pdf(
            'spa_online_booking.action_report_pos_sales',
            res_ids=[cfg_id], data={'r': r})
        return request.make_response(pdf, headers=[
            ('Content-Type', 'application/pdf'),
            ('Content-Disposition', 'inline; filename="sales_report.pdf"'),
        ])

    # ---------- session ----------

    @http.route('/api/spa/session', type='http', auth='public', methods=['GET'], csrf=False)
    def get_session(self, token=None, **kw):
        if not token:
            return json_response({'error': 'missing_token'}, 400)

        session = request.env['spa.booking.session'].sudo().search(
            [('token', '=', token)], limit=1
        )
        if not session:
            return json_response({'error': 'not_found'}, 404)
        if not session.is_valid():
            return json_response({'error': 'expired', 'state': session.state}, 410)

        return json_response({
            'token': session.token,
            # whatsapp_number deliberately NOT returned: the shared link reuses
            # the oldest session row, which on an existing database is a legacy
            # per-customer one - so this handed that customer's number to every
            # single person who opened the public booking link.
            'state': session.state,
            # Earliest / latest dates the customer may pick, given the configured
            # minimum and maximum booking notice (max_booking_date is null when
            # no maximum is set).
            'min_booking_date': _earliest_booking_date(),
            'max_booking_date': _latest_booking_date(),
        })

    # ---------- services (product.template, same set as the kiosk) ----------

    @http.route('/api/spa/services', type='http', auth='public', methods=['GET'], csrf=False)
    def get_services(self, **kw):
        # Reuses the same visibility flag as the tablet kiosk. If you later
        # want a different set of services shown online vs. on the tablet,
        # add a separate boolean (e.g. spa_online_visible) to product.template
        # and filter on that instead.
        Product = request.env['product.template'].sudo()
        services = Product.search(Product._spa_bookable_domain())
        data = [{
            'id': s.id,
            'name': s.name,
            'duration_minutes': s.spa_duration,
            'price': s.list_price,
            # Only expose an image URL when the product actually has one, so
            # the front-end keeps its emoji fallback for imageless services.
            'image_url': ('/spa/service/%s/image' % s.id) if s.image_128 else None,
        } for s in services]
        return json_response({'services': data})

    # ---------- service image (public, streams the product image) ----------

    @http.route('/spa/service/<int:service_id>/image', type='http', auth='public', csrf=False)
    def service_image(self, service_id, **kw):
        product = request.env['product.template'].sudo().browse(service_id)
        # Must use the same rule as the package list, or a newly visible
        # package's photo 404s while the package itself renders.
        if not product.exists() or not product._spa_is_bookable():
            return request.not_found()
        return request.env['ir.binary']._get_image_stream_from(
            product, field_name='image_512').get_response()

    # ---------- therapies (pos.category) + their session packages ----------

    @http.route('/api/spa/therapies', type='http', auth='public', methods=['GET'], csrf=False)
    def get_therapies(self, **kw):
        """Two-level catalogue for the booking page: each THERAPY (a POS
        category flagged ``spa_is_therapy``) with its intro description/photo
        and the session PACKAGES (products) filed under it. Each package
        carries its price, sessions, short description and any rich detail
        blocks (heading / subheading / description / photos). Images are served
        as URLs (see the routes below) so this JSON stays light.

        Pass ?lang=ar (or a full code) to get translatable content — name,
        description, ideal_for, focus_areas, session desc — in that language."""
        env = lang_env(kw.get('lang'))
        Product = env['product.template'].sudo()
        categories = env['pos.category'].sudo().search(
            [('spa_is_therapy', '=', True)])
        categories = categories.sorted(lambda c: (c.spa_sequence, c.name or ''))

        # Settings > Spa Online Booking > Hide "Save" amount.
        hide_save = env['ir.config_parameter'].sudo().get_param(
            'spa_online_booking.hide_savings') in ('True', '1')

        therapies = []
        for cat in categories:
            packages = Product.search(
                Product._spa_bookable_domain() + [('pos_categ_ids', 'in', cat.id)])
            # Cheapest first (Single -> Starter -> Commit -> Lifestyle).
            packages = packages.sorted(lambda p: (p.list_price, p.name or ''))

            # The per-session baseline for the "Save X" badge: the price of the
            # single-session package (session_count <= 1), else the cheapest.
            single_pkg = next(
                (p for p in packages if (p.spa_session_count or 0) <= 1), None)
            if single_pkg is None and packages:
                single_pkg = packages[0]
            single_unit = single_pkg.list_price if single_pkg else 0.0

            # Therapy duration + "From" price are read off the packages so we
            # don't duplicate that data on the category.
            durations = [p.spa_duration for p in packages if p.spa_duration]
            # The therapy's own Session Duration wins; packages are the fallback.
            duration_min = cat.spa_duration or (durations[0] if durations else 0)
            from_price = min((p.list_price for p in packages), default=0.0)

            pkg_data = []
            for p in packages:
                sessions = p.spa_session_count or 0
                raw_save = (sessions * single_unit) - p.list_price if single_unit else 0
                save = round(raw_save) if raw_save and raw_save > 0 and not hide_save else 0
                pkg_data.append({
                    'id': p.id,
                    'name': p.name,
                    'price': p.list_price,
                    'save': save,
                    # Price per member type. A member type missing from this map
                    # is not sold for this package, which is what tells the
                    # screens not to offer it under that tab. `price` above
                    # stays the individual price, so older clients are
                    # unaffected.
                    'prices': p._spa_member_prices(),
                    # The package's optional extras: this therapy's list plus
                    # anything on the package's own Upsell & Cross-Sell field.
                    # Same resolver the POS wizard and the submit check use, so
                    # all three always agree on what is on offer.
                    'addons': [{
                        'id': a.id,
                        'name': a.name,
                        'price': a.list_price,
                        'image_url': ('/spa/service/%s/image' % a.id)
                                     if a.image_128 else None,
                    } for a in cat._spa_addons_for(p)],
                    'session_count': sessions,
                    'session_desc': p.spa_session_desc or '',
                    'duration_minutes': p.spa_duration,
                    'image_url': ('/spa/service/%s/image' % p.id) if p.image_128 else None,
                    'details': [{
                        'heading': d.heading or '',
                        'subheading': d.subheading or '',
                        'description': d.description or '',
                        'image_url': ('/spa/detail/%s/image' % d.id) if d.image else None,
                        'photos': [{
                            'url': '/spa/detail/photo/%s/image' % img.id,
                            'caption': img.name or '',
                        } for img in d.image_ids],
                    } for d in p.spa_detail_ids],
                })
            therapies.append({
                'id': cat.id,
                'name': cat.name,
                'tagline': cat.spa_tagline or '',
                'description': cat.spa_description or '',
                'ideal_for': cat.spa_ideal_for or '',
                'focus_areas': cat.spa_focus_areas or '',
                'duration_min': duration_min,
                'from_price': from_price,
                'image_url': ('/spa/therapy/%s/image' % cat.id) if cat.image_128 else None,
                # Sections of this therapy, in their own order - the POS "New
                # Question" dialog offers these to file a question under.
                'headings': [{'id': h.id, 'name': h.name,
                              'style': h._spa_heading_style()}
                             for h in cat.spa_heading_ids],
                # `{}` when this therapy has no disclaimer - the page is then
                # skipped rather than shown empty.
                'disclaimer': cat._spa_disclaimer_payload(),
                'packages': pkg_data,
            })
            # Packages that no member type prices are invisible on every
            # screen, and nothing used to say so - the therapy rendered with
            # "no packages" while the products sat there correctly configured.
            # One line here is the difference between a five-minute answer and
            # an afternoon of guessing.
            if pkg_data and not any(p.get('prices') for p in pkg_data):
                _logger.warning(
                    "Therapy %r returned %s package(s) but none of them is "
                    "priced for any member type, so all of them will be hidden. "
                    "Check spa.member.type has a record with is_individual set.",
                    cat.name, len(pkg_data))
        # Settings > Default service order, so every screen opens in it before
        # its own "Sort by" is touched. Same four orders as the screens: key,
        # direction, tie-breaker. list.sort is stable, so full ties keep the
        # Therapy Order above; a therapy with no price or no duration for the
        # key goes to the end either way.
        sorts = {
            'price_asc': ('from_price', 1, 'duration_min'),
            'price_desc': ('from_price', -1, 'duration_min'),
            'dur_asc': ('duration_min', 1, 'from_price'),
            'dur_desc': ('duration_min', -1, 'from_price'),
        }
        params = env['ir.config_parameter'].sudo()
        default_sort = params.get_param('spa_online_booking.default_sort')
        if default_sort not in sorts:
            default_sort = 'price_asc'
        # Settings > Default package order. The screens sort the packages
        # themselves, by the price on the member tab that is open.
        default_package_sort = params.get_param(
            'spa_online_booking.default_package_sort')
        if default_package_sort not in ('price_asc', 'price_desc', 'sess_asc', 'sess_desc'):
            default_package_sort = 'price_asc'
        key, direction, then = sorts[default_sort]
        therapies.sort(key=lambda t: (
            not t[key], direction * (t[key] or 0),
            not t[then], direction * (t[then] or 0)))
        # The public user's default company may use a different currency than
        # the register that fulfils these bookings. Show the currency of the POS
        # that sells the therapies so the page matches the counter.
        Config = request.env['pos.config'].sudo()
        config = Config.search(
            [('iface_available_categ_ids', 'in', categories.ids)], limit=1)
        if not config:
            config = Config.search(
                [('company_id', '!=', request.env.company.id)], limit=1)
        company = (config.company_id if config and config.company_id
                   else request.env.company)
        currency = company.currency_id
        # Member-type tabs and the small print, both driven from the backend so
        # the screens do not hard-code commercial wording. `headcount` rides
        # along so neither client has to keep its own copy of how many people
        # a type covers - which is exactly what used to need editing in two
        # JavaScript files every time a type was added.
        member_types = request.env['spa.member.type'].sudo()._spa_payload()
        note = request.env['ir.config_parameter'].sudo().get_param(
            'spa_online_booking.package_note', '')

        return json_response({
            'therapies': therapies,
            'member_types': member_types,
            'package_note': note or '',
            'default_sort': default_sort,
            'default_package_sort': default_package_sort,
            'currency': {
                'symbol': currency.symbol or '',
                'position': currency.position or 'before',  # 'before' | 'after'
            },
        })

    # ---------- images for therapies + package detail blocks (public) ----------

    @http.route('/spa/therapy/<int:category_id>/image', type='http', auth='public', csrf=False)
    def therapy_image(self, category_id, **kw):
        cat = request.env['pos.category'].sudo().browse(category_id)
        if not cat.exists() or not cat.spa_is_therapy:
            return request.not_found()
        return request.env['ir.binary']._get_image_stream_from(
            cat, field_name='image_512').get_response()

    @http.route('/spa/detail/<int:detail_id>/image', type='http', auth='public', csrf=False)
    def detail_image(self, detail_id, **kw):
        detail = request.env['spa.product.detail'].sudo().browse(detail_id)
        if not detail.exists() or not detail.image:
            return request.not_found()
        return request.env['ir.binary']._get_image_stream_from(
            detail, field_name='image').get_response()

    @http.route('/spa/detail/photo/<int:image_id>/image', type='http', auth='public', csrf=False)
    def detail_photo(self, image_id, **kw):
        photo = request.env['spa.product.detail.image'].sudo().browse(image_id)
        if not photo.exists() or not photo.image:
            return request.not_found()
        return request.env['ir.binary']._get_image_stream_from(
            photo, field_name='image').get_response()

    # ---------- questions (spa.question, from the therapies of the packages) ----------

    @http.route('/api/spa/questions', type='http', auth='public', methods=['GET'], csrf=False)
    def get_questions(self, service_ids=None, **kw):
        ids = parse_service_ids(service_ids)
        if ids is None:
            return json_response({'error': 'invalid_service_ids'}, 400)
        if not ids:
            return json_response({'error': 'missing_service_ids'}, 400)

        products = lang_env(kw.get('lang'))['product.template'].sudo().browse(ids).exists()
        if not products:
            return json_response({'error': 'not_found'}, 404)

        # Questions come from the packages' therapies (deduped, ordered),
        # translated to ?lang when supplied.
        questions = therapy_questions(products)
        data = [{
            'id': q.id,
            'text': q.name,
            'heading': q.heading_id.name or '',   # section title, '' = none
            'heading_id': q.heading_id.id or 0,   # compare on this to tell
                                                  # where a new section starts
            'heading_style': q.heading_id._spa_heading_style(),
            'type': q.question_type,          # text / yes_no / single_choice / multi_choice
            'required': q.required,
            'options': [o.name for o in q.option_ids] if q.option_ids else [],
        } for q in questions]
        # The disclaimer of the therapy these packages belong to, shown on its
        # own page after the questions. `{}` when the therapy has none, which
        # is how a client knows to skip that page rather than show a blank one.
        therapy = products.pos_categ_ids.filtered('spa_is_therapy')[:1]
        return json_response({
            'questions': data,
            'disclaimer': therapy._spa_disclaimer_payload(),
        })

    # ---------- availability ----------

    @http.route('/api/spa/availability', type='http', auth='public', methods=['GET'], csrf=False)
    def get_availability(self, service_ids=None, date=None, **kw):
        ids = parse_service_ids(service_ids)
        if ids is None:
            return json_response({'error': 'invalid_params'}, 400)
        if not ids or not date:
            return json_response({'error': 'missing_params'}, 400)
        try:
            day = datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return json_response({'error': 'invalid_params'}, 400)

        # ---- simple stub: 09:00-18:00 in 1hr slots ----
        # spa_kiosk has no scheduling concept at all today (it's a walk-in
        # queue: pending -> in_service -> completed -> paid). This checks
        # for clashes only against other online bookings' slot_datetime
        # (the field this module adds) — it does NOT know about tablet
        # walk-ins, since those have no slot_datetime. Confirm with your
        # team whether pre-booked online slots should also block out
        # walk-in capacity before this goes live.
        slots = []
        cursor = day.replace(hour=OPEN_HOUR, minute=0, second=0, microsecond=0)
        end = day.replace(hour=CLOSE_HOUR, minute=0, second=0, microsecond=0)

        # Enforce the configured booking-notice window: a slot must be at least
        # `min_lead_hours` in the future (also hides today's already-passed
        # times) and no more than `max_lead_hours` ahead when a maximum is set.
        # Naive/local clock, consistent with how slot_datetime is stored.
        now = _local_now()
        min_cutoff = now + timedelta(hours=_min_lead_hours())
        max_hours = _max_lead_hours()
        max_cutoff = now + timedelta(hours=max_hours) if max_hours else None

        # A slot is HELD when any of the selected services already has a booking
        # at that time. Held times are still offered - the customer joins a
        # waiting list for them - so this only decides which ones get flagged.
        # 'waiting' bookings are excluded here on purpose: they do not hold the
        # slot, they are queuing for it. Matches the legacy single-service field
        # too, as the submit check does.
        Booking = request.env['spa.booking'].sudo()
        booked = Booking.search([
            ('state', 'in', Booking._SPA_HOLDING_STATES),
            ('slot_datetime', '>=', cursor),
            ('slot_datetime', '<', end),
            '|',
            ('product_ids', 'in', ids),
            ('product_id', 'in', ids),
        ]).mapped('slot_datetime')
        booked_set = {b.strftime('%H:%M') for b in booked}

        # `slots` keeps its old meaning - "times you may choose" - so a client
        # that ignores `waitlist` still works; it simply offers the busy time
        # too, which is the point. `waitlist` names which of them are queued.
        waitlist = []
        while cursor < end:
            label = cursor.strftime('%H:%M')
            within_window = cursor >= min_cutoff and (
                max_cutoff is None or cursor <= max_cutoff)
            if within_window:
                slots.append(label)
                if label in booked_set:
                    waitlist.append(label)
            cursor += timedelta(hours=1)

        return json_response({'date': date, 'service_ids': ids,
                              'slots': slots, 'waitlist': waitlist})

    # ---------- submit ----------

    @http.route('/api/spa/submit', type='http', auth='public', methods=['POST'], csrf=False)
    def submit_booking(self, **kw):
        payload, payload_error = _json_payload()
        if payload_error is not None:
            return payload_error

        token = payload.get('token')
        session = request.env['spa.booking.session'].sudo().search(
            [('token', '=', token)], limit=1
        )
        if not session or not session.is_valid():
            return json_response({'error': 'invalid_or_expired_session'}, 410)

        required = ['name', 'phone', 'whatsapp', 'service_ids', 'slot_datetime']
        missing = [f for f in required if not payload.get(f)]
        if missing:
            return json_response({'error': 'missing_fields', 'fields': missing}, 400)

        # Validate both numbers have a country code and are real phone numbers;
        # store the normalized E.164 form.
        mobile_e164, reason = normalize_phone(payload['phone'])
        if reason:
            return json_response(
                {'error': 'invalid_phone', 'field': 'phone', 'reason': reason}, 400)
        whatsapp_e164, reason = normalize_phone(payload['whatsapp'])
        if reason:
            return json_response(
                {'error': 'invalid_phone', 'field': 'whatsapp', 'reason': reason}, 400)

        email, email_error = _parse_email(payload)
        if email_error:
            return json_response({'error': email_error, 'field': 'email'}, 400)
        # The date of birth is checked HERE rather than left to the model
        # constraint, so the caller gets a field name and a reason back instead
        # of a 500 with a traceback in it.
        dob, gender, dob_error = _parse_personal(payload)
        if dob_error:
            return json_response({
                'error': 'invalid_dob', 'field': 'date_of_birth',
                'reason': dob_error,
            }, 400)
        signature, sig_error = _parse_signature(payload)
        if sig_error:
            return json_response({'error': sig_error, 'field': 'signature'}, 400)

        ids = parse_service_ids(payload['service_ids'])
        if not ids:
            return json_response({'error': 'invalid_service'}, 400)
        if len(ids) > MAX_SERVICES_PER_BOOKING:
            return json_response({'error': 'too_many_services'}, 400)
        products = request.env['product.template'].sudo().browse(ids)
        if any(not p.exists() for p in products):
            return json_response({'error': 'invalid_service'}, 400)
        # Existence was the ONLY check here, so any product.template id was
        # bookable: archived items, another company's products, storable goods.
        # price is the sum of whatever was chosen, so the booking's value was
        # attacker-controlled too.
        if any(not p._spa_is_bookable() for p in products):
            return json_response({'error': 'invalid_service'}, 400)

        try:
            slot_dt = datetime.strptime(payload['slot_datetime'], '%Y-%m-%d %H:%M')
        except ValueError:
            return json_response({'error': 'invalid_slot_datetime'}, 400)
        slot_problem = _slot_is_bookable(slot_dt, products)
        if slot_problem:
            return json_response({'error': slot_problem}, 400)

        # Questions are the deduped union across all selected services.
        questions = therapy_questions(products)

        # One entry per person the package covers. Validates the count and each
        # person's required answers, and folds the top-level fields in as
        # person 1 - so a client that sends no `members` still books correctly.
        MemberType = request.env['spa.member.type'].sudo()
        # Clients send the CODE; an unknown one falls back to the base type
        # rather than being trusted, so a bad payload cannot book a family
        # for a headcount nobody configured.
        member_type = (MemberType._spa_by_code(payload.get('member_type'))
                       or MemberType._spa_base_type())
        people, member_error = _spa_parse_members(payload, questions, member_type)
        if member_error is not None:
            return member_error

        # Answers are NOT written here. _spa_set_members creates one row per
        # person after the booking exists, each carrying booking_id, so
        # booking.answer_ids still returns everything - and writing the lead's
        # here as well would store their answers twice, the duplicate having no
        # member at all.

        # payment_mode intentionally not collected here — matches your
        # flow (cash at counter, or a payment link sent after the session);
        # left at the model's default ('offline') until reception updates it.
        # price is now a stored computed sum of product_ids.list_price, so we
        # don't write it here. product_id keeps the first selected service as
        # the "primary" for backward compatibility.
        # One booking per person per day. The link is shared and open to
        # everyone, so the same customer must not be able to book the same date
        # twice through it; a different name on the same number, or the same
        # person on another date, is fine.
        client_ip = _client_ip()
        if _rate_limited(client_ip, mobile_e164):
            return json_response({'error': 'too_many_requests'}, 429)

        clash = _same_person_booking_on(
            payload['name'], (mobile_e164, whatsapp_e164), slot_dt.date())
        if clash:
            return json_response({
                'error': 'already_booked',
                'date': slot_dt.date().isoformat(),
                'booking_ref': clash.name,
            }, 409)

        # Somebody already holding this time means the waiting list, not a
        # refusal. Decided before create so the row is born in the right state.
        waitlisted = _spa_slot_taken(slot_dt, products)

        booking = request.env['spa.booking'].sudo().create({
            'partner_name': (payload['name'] or '')[:MAX_NAME_LEN],
            'client_ip': client_ip,
            'mobile': mobile_e164,
            'whatsapp_number': whatsapp_e164,
            'product_ids': [(6, 0, products.ids)],
            'product_id': products[0].id,
            'source': 'online_link',
            'spa_channel': 'online',
            # Which family size was booked. The stored price is computed from
            # this, so an unknown value falls back to individual rather than
            # reaching the field and being refused (normalised further up,
            # because the member count is checked against it).
            'spa_member_type': member_type.id,
            # Only extras actually offered on one of the booked packages are
            # accepted - this endpoint is public, so an id from the payload is
            # never trusted to be a legitimate add-on.
            'spa_addon_ids': [(6, 0, _spa_valid_addon_ids(
                payload.get('addon_ids'), products))],
            'state': 'waiting' if waitlisted else 'pending',
            'slot_datetime': slot_dt,
            'date_of_birth': dob,
            'gender': gender,
            'email': email,
            'signature': signature,
            'terms_accepted': bool(payload.get('terms_accepted')),
            # Free-text time request when no offered slot suited the customer.
            # Capped: these are fields.Char with no size, so an unbounded body
            # meant unbounded row growth.
            'time_note': (payload.get('time_note') or '').strip()[:MAX_TEXT_LEN],
            'company_id': products[0].company_id.id or request.env.company.id,
        })

        # Everyone the package covers, with their own answers and signature.
        # After the booking exists, because spa.booking.answer.booking_id is
        # required - nested commands under member_ids would never set it.
        booking._spa_set_members(people)

        # Two people submitting the same time at once can BOTH see the slot
        # free - each transaction is blind to the other's uncommitted row. So
        # re-check now that ours exists: whoever is not the earliest holder
        # steps back onto the waiting list. Self-correcting, and cheaper than
        # locking the table on every booking.
        if not waitlisted:
            holder = request.env['spa.booking'].sudo()._spa_slot_holder(
                slot_dt, products.ids)
            if holder and holder.id != booking.id:
                booking.write({'state': 'waiting'})
                waitlisted = True

        # Deliberately NOT marking the link used: it is a single shared link
        # that many customers book through, so 'completed' would kill it after
        # the first booking and booking_id (a Many2one) would only ever show
        # the most recent one.

        # Trigger WhatsApp confirmation here, e.g.:
        # request.env['spa.whatsapp'].sudo().send_confirmation(booking)

        # `waiting` goes back so the page can say so. Putting somebody on a
        # waiting list without telling them would be the wrong kind of quiet.
        return json_response({
            'success': True,
            'booking_ref': booking.name,
            'state': booking.state,
            'waiting': booking.state == 'waiting',
        })

    @http.route('/api/spa/lookup', type='http', auth='public', methods=['POST'], csrf=False)
    def lookup_customer(self, **kw):
        """Who is behind this phone number, so the booking page can fill the
        rest of the form in for a customer we already know - the same "type the
        number first" flow the POS Book Therapy screen uses.

        Guarded three ways, because this link is shared and effectively public:
          * a valid link token is required;
          * the FULL number must be given (8+ digits), so nobody can probe by
            prefix;
          * per-IP rate limiting.

        Nothing about a signature is returned, not even whether one exists.
        Handing someone's signature to anyone who knows their phone number
        would be a forgery kit - and a returning customer signs again for each
        new service anyway, so there is nothing here worth telling the page.
        """
        payload, payload_error = _json_payload()
        if payload_error is not None:
            return payload_error

        session = request.env['spa.booking.session'].sudo().search(
            [('token', '=', payload.get('token'))], limit=1)
        if not session or not session.is_valid():
            return json_response({'error': 'invalid_or_expired_session'}, 410)

        number = (payload.get('phone') or payload.get('whatsapp')
                  or payload.get('mobile') or '').strip()
        digits = ''.join(c for c in number if c.isdigit())
        if len(digits) < 8:
            # Not enough to identify anybody - answer "nobody" rather than
            # matching on a prefix.
            return json_response({'found': False, 'customers': []})

        if _lookup_rate_limited(_client_ip()):
            return json_response({'error': 'too_many_requests'}, 429)

        customers = [{
            'id': partner.id,
            'name': partner.name or '',
            'age': _partner_age(partner),
            'date_of_birth': fields.Date.to_string(partner.date_of_birth) or '',
            'gender': partner.gender or '',
            'whatsapp': partner.whatsapp or '',
        } for partner in _find_partners_by_phone(number)]
        return json_response({'found': bool(customers), 'customers': customers})

    # ---------- tablet (in-store app) submit -> channel 'tab' ----------

    @http.route('/api/spa/tab/submit', type='http', auth='public', methods=['POST'], csrf=False)
    def submit_tab_booking(self, **kw):
        """Create a booking from the in-store TABLET app. Tags the booking as
        channel='tab' (state pending) so it lands in POS -> Tab -> Pending
        Approval. No Send-Link token is required (the tablet is trusted,
        in-store); optionally protect it with a shared key stored in the
        system parameter 'spa_online_booking.tab_api_key' — if set, the request
        must include a matching 'api_key'.

        JSON body:
          name            (required)  customer name
          service_ids     (required)  list of package (product.template) ids
          mobile / phone  (optional)  contact number (+country code)
          whatsapp        (optional)  WhatsApp number (+country code)
          answers         (optional)  { "<question_id>": "answer", ... }
          terms_accepted  (REQUIRED)  true when the customer ticked that they
                                      agree to the terms and that their details
                                      are correct. Recorded on the booking.
          signature       (REQUIRED)  base64 PNG of the customer's signature,
                                      without the "data:image/png;base64,"
                                      prefix. Consent is per service, so send a
                                      freshly drawn one with every booking -
                                      never one kept from a previous visit.
                                      Still accepted when absent so tablets on
                                      the old app keep working; those bookings
                                      are flagged 'Not Signed'. It becomes a
                                      hard 400 'missing_signature' once the
                                      updated app is out.
          slot_datetime   (optional)  "YYYY-MM-DD HH:MM"; omitted = now (walk-in)
          time_note       (optional)  free-text preferred time
          api_key         (optional)  required only if the key param is set
        """
        try:
            payload = json.loads(request.httprequest.data)
        except (ValueError, TypeError):
            return json_response({'error': 'invalid_json'}, 400)

        blocked = _tab_api_blocked()
        if blocked is not None:
            return blocked
        if not _tab_api_key_ok(payload):
            return json_response({'error': 'unauthorized'}, 401)

        name = (payload.get('name') or '').strip()
        if not name:
            return json_response({'error': 'missing_fields', 'fields': ['name']}, 400)

        ids = parse_service_ids(payload.get('service_ids'))
        if not ids:
            return json_response({'error': 'invalid_service'}, 400)
        products = request.env['product.template'].sudo().browse(ids)
        if any(not p.exists() for p in products):
            return json_response({'error': 'invalid_service'}, 400)

        # Phone/WhatsApp optional; normalized to E.164 when provided.
        mobile_e164 = ''
        if payload.get('mobile') or payload.get('phone'):
            mobile_e164, reason = normalize_phone(
                payload.get('mobile') or payload.get('phone'))
            if reason:
                return json_response(
                    {'error': 'invalid_phone', 'field': 'mobile', 'reason': reason}, 400)
        whatsapp_e164 = ''
        if payload.get('whatsapp'):
            whatsapp_e164, reason = normalize_phone(payload.get('whatsapp'))
            if reason:
                return json_response(
                    {'error': 'invalid_phone', 'field': 'whatsapp', 'reason': reason}, 400)

        email, email_error = _parse_email(payload)
        if email_error:
            return json_response({'error': email_error, 'field': 'email'}, 400)
        # The date of birth is checked HERE rather than left to the model
        # constraint, so the caller gets a field name and a reason back instead
        # of a 500 with a traceback in it.
        dob, gender, dob_error = _parse_personal(payload)
        if dob_error:
            return json_response({
                'error': 'invalid_dob', 'field': 'date_of_birth',
                'reason': dob_error,
            }, 400)
        signature, sig_error = _parse_signature(payload)
        if sig_error:
            return json_response({'error': sig_error, 'field': 'signature'}, 400)

        # Slot optional — a walk-in defaults to "now".
        slot_raw = payload.get('slot_datetime')
        if slot_raw:
            try:
                slot_dt = datetime.strptime(slot_raw, '%Y-%m-%d %H:%M')
            except ValueError:
                return json_response({'error': 'invalid_slot_datetime'}, 400)
        else:
            slot_dt = _local_now().replace(second=0, microsecond=0)

        answers_payload = payload.get('answers', {}) or {}
        questions = therapy_questions(products)
        answer_commands = []
        for q in questions:
            value = (answers_payload.get(str(q.id)) or '').strip()
            if q.required and not value:
                return json_response(
                    {'error': 'missing_answer', 'question_id': q.id}, 400)
            if value:
                answer_commands.append((0, 0, {
                    'question_id': q.id,
                    'value_text': value,
                }))

        booking = request.env['spa.booking'].sudo().create({
            'partner_name': name,
            'mobile': mobile_e164,
            'whatsapp_number': whatsapp_e164,
            'product_ids': [(6, 0, products.ids)],
            'product_id': products[0].id,
            'source': 'online_link',
            'spa_channel': 'tab',
            'slot_datetime': slot_dt,
            'date_of_birth': dob,
            'gender': gender,
            'email': email,
            'signature': signature,
            'terms_accepted': bool(payload.get('terms_accepted')),
            'time_note': (payload.get('time_note') or '').strip(),
            'answer_ids': answer_commands,
            'company_id': products[0].company_id.id or request.env.company.id,
        })
        return json_response({
            'success': True, 'booking_ref': booking.name, 'id': booking.id})

    # ---------- tablet: EXISTING customer (has a prepaid package) ----------

    @http.route('/api/spa/tab/passes', type='http', auth='public', methods=['POST'], csrf=False)
    def tab_passes(self, **kw):
        """Look up EXISTING customers' prepaid packages from the tablet, by
        phone / WhatsApp number. Returns ONE object per res.partner that shares
        the number (families sharing a phone stay separate, each with their own
        passes) plus profile fields for the app.

        JSON body:  { "phone": "+9689XXXXXXX", "api_key": "<if set>" }
        Returns:    { "found": bool,
                      "customers": [ {"id", "name", "age", "date_of_birth",
                                      "gender", "phone", "whatsapp", "email",
                                      "passes": [ {"pass_id", "reference",
                                                   "package", "package_id",
                                                   "sessions_left",
                                                   "sessions_total",
                                                   "valid_till"} ] } ],
                      # backward-compat (first matching person):
                      "customer": {"id", "name"} | null,
                      "passes": [ ... ] }
        Notes: age is derived from date_of_birth; valid_till is null (passes
        don't expire in this build).
        """
        try:
            payload = json.loads(request.httprequest.data)
        except (ValueError, TypeError):
            return json_response({'error': 'invalid_json'}, 400)

        blocked = _tab_api_blocked()
        if blocked is not None:
            return blocked
        if not _tab_api_key_ok(payload):
            return json_response({'error': 'unauthorized'}, 401)

        number = (payload.get('phone') or payload.get('mobile')
                  or payload.get('whatsapp') or '').strip()
        if not number:
            return json_response({'error': 'missing_fields', 'fields': ['phone']}, 400)

        partners = _find_partners_by_phone(number)
        if not partners:
            return json_response(
                {'found': False, 'customers': [], 'customer': None, 'passes': []})

        # Read package names in the requested language (POST body "lang": "ar"),
        # so the tablet's Existing-customer screen shows Arabic package names.
        Pass = lang_env(payload.get('lang'))['spa.session.pass'].sudo()
        customers = []
        for partner in partners:
            partner_passes = Pass.search([
                ('partner_id', '=', partner.id),
                ('state', '=', 'active'),
                ('sessions_left', '>', 0),
            ])
            customers.append({
                'id': partner.id,
                'name': partner.name,
                'age': _partner_age(partner),
                # The tablet pre-fills the booking form from this, so it needs
                # the fields that form asks for. Safe here and NOT on the public
                # /api/spa/lookup: this route is api_key-guarded and in-store,
                # where that one answers to a shared link anyone may hold.
                'date_of_birth': fields.Date.to_string(partner.date_of_birth) or '',
                'gender': (partner.gender or '').capitalize() or None,
                'phone': partner.phone or '',
                'whatsapp': partner.whatsapp or '',
                'email': partner.email or '',
                'passes': [{
                    'pass_id': p.id,
                    'reference': p.name,
                    'package': p.product_tmpl_id.name if p.product_tmpl_id else '',
                    'package_id': p.product_tmpl_id.id if p.product_tmpl_id else False,
                    'sessions_left': p.sessions_left,
                    'sessions_total': p.sessions_total,
                    # passes have no expiry in this build -> always null
                    'valid_till': None,
                } for p in partner_passes],
            })

        # New shape: one object per matching person (families sharing a number
        # stay separate). Old `customer`/`passes` kept for backward compatibility
        # (the first matching person).
        first = customers[0] if customers else None
        return json_response({
            'found': True,
            'customers': customers,
            'customer': {'id': first['id'], 'name': first['name']} if first else None,
            'passes': first['passes'] if first else [],
        })

    @http.route('/api/spa/tab/redeem', type='http', auth='public', methods=['POST'], csrf=False)
    def tab_redeem(self, **kw):
        """EXISTING customer redeems a session at the tablet (walk-in, today).
        Creates a prepaid 'tab' booking (state pending) linked to the pass, so
        it lands in POS -> Tab -> Pending Approval with a "Prepaid" badge. The
        session is COUNTED against the pass when reception marks it done — not
        here — so an unattended submit never silently burns a session.

        JSON body:  { "phone": "+9689XXXXXXX", "pass_id": 12,
                      "api_key": "<if set>" }
        Returns:    { "success": true, "booking_ref": "SPA-00xx", "id": <int>,
                      "sessions_left": <int, still remaining> }
        """
        try:
            payload = json.loads(request.httprequest.data)
        except (ValueError, TypeError):
            return json_response({'error': 'invalid_json'}, 400)

        blocked = _tab_api_blocked()
        if blocked is not None:
            return blocked
        if not _tab_api_key_ok(payload):
            return json_response({'error': 'unauthorized'}, 401)

        try:
            pass_id = int(payload.get('pass_id'))
        except (ValueError, TypeError):
            return json_response({'error': 'invalid_pass'}, 400)

        pass_rec = request.env['spa.session.pass'].sudo().browse(pass_id)
        if not pass_rec.exists() or pass_rec.state != 'active' or pass_rec.sessions_left <= 0:
            return json_response({'error': 'no_sessions_left'}, 400)

        # The tablet is in-store/trusted, but still make sure the number given
        # belongs to this pass's customer so one person can't spend another's.
        number = (payload.get('phone') or payload.get('mobile')
                  or payload.get('whatsapp') or '').strip()
        # MANDATORY. This used to be `if number and ...`, so omitting the phone
        # skipped the check completely - and pass_id is a sequential integer,
        # so anyone could enumerate passes, read their balances and book against
        # another customer's prepaid sessions.
        if not number:
            return json_response({'error': 'phone_required'}, 400)
        if pass_rec.partner_id not in _find_partners_by_phone(number):
            return json_response({'error': 'pass_mismatch'}, 403)

        partner = pass_rec.partner_id
        tmpl = pass_rec.product_tmpl_id
        vals = {
            'partner_id': partner.id,
            'partner_name': partner.name,
            'mobile': partner.phone or '',
            'whatsapp_number': getattr(partner, 'whatsapp', '') or '',
            'source': 'online_link',
            'spa_channel': 'tab',
            'state': 'pending',
            'slot_datetime': _local_now().replace(second=0, microsecond=0),
            'session_pass_id': pass_rec.id,
            'company_id': (tmpl.company_id.id if tmpl else False) or request.env.company.id,
        }
        if tmpl:
            vals['product_ids'] = [(6, 0, tmpl.ids)]
            vals['product_id'] = tmpl.id
        booking = request.env['spa.booking'].sudo().create(vals)
        return json_response({
            'success': True,
            'booking_ref': booking.name,
            'id': booking.id,
            'sessions_left': pass_rec.sessions_left,
        })
