# Spa Booking API

Every endpoint the `spa_online_booking` module exposes: the customer booking link, the in-store
tablet app, and the public image URLs.

All responses are JSON (`Content-Type: application/json`). Errors carry an `error` key with a
machine-readable code and, where useful, the field it applies to. Read the codes, not the HTTP
status alone.

Host: `https://<your-host>` — currently
`http://organisation-drawing-oasis-testimony.trycloudflare.com` (a Cloudflare tunnel; the address
changes when the tunnel restarts).

---

## At a glance

| | URL | Auth | Payload | Returns |
|---|---|---|---|---|
| `GET` | `/spa/book?db=spa` | — | query only | HTML + `session_id` cookie (**do this first**) |
| `GET` | `/api/spa/session` | token | `token` | link validity + bookable date window |
| `GET` | `/api/spa/services` | — | — | flat list of bookable services |
| `GET` | `/api/spa/therapies` | — | `lang` | therapies → packages → detail blocks, + currency |
| `GET` | `/api/spa/questions` | — | `service_ids`, `lang` | questions, grouped into sections |
| `GET` | `/api/spa/availability` | — | `service_ids`, `date` | free `HH:MM` slots for that day |
| `POST` | `/api/spa/submit` | token | booking JSON | `{success, booking_ref}` |
| `POST` | `/api/spa/lookup` | token | `{token, phone}` | matching customers (profile only) |
| `POST` | `/api/spa/tab/submit` | api_key | booking JSON | `{success, booking_ref, id}` |
| `POST` | `/api/spa/tab/passes` | api_key | `{phone, lang}` | customers + their prepaid passes |
| `POST` | `/api/spa/tab/redeem` | api_key | `{phone, pass_id}` | `{success, booking_ref, id, sessions_left}` |
| `GET` | `/spa/<service\|therapy\|detail>/<id>/image` | — | id in path | image bytes, 404 if none |

Each of those has its full request and response below. **The `api_key` is deliberately not
written down here — send it to the developer separately.**

---

## Changes in this release — read first

*Updated 1 Aug 2026. Items 1–6 are new since the version first sent over; none of them
change a URL or a payload shape. Items 7 and 8 are the breaking ones, unchanged.*

**1. `date_of_birth` and `email` on `POST /api/spa/tab/passes`.**
Each entry in `customers` now carries the customer's `date_of_birth` (`"YYYY-MM-DD"`, the same format `/api/spa/lookup` uses) and `email`, so the tablet can pre-fill the whole booking form for a returning customer instead of leaving those two boxes to be retyped. Both are `""` when unset. Purely additive — no existing key changed. They are **not** added to the public `/api/spa/lookup`: that one answers to a shared link anyone may hold, so it stays as narrow as it is.

**2. `terms_accepted` on both submit endpoints.**
A tick sits immediately above the signature on our questions screen — *"I agree to the terms and conditions and confirm the details above are correct."* — and it is required before the customer can continue. Send `terms_accepted: true` with the booking; it is stored on the record so the acceptance can be looked up later. Omitted or false is still accepted for now, and reads as not accepted in the back office.

**3. Phone numbers now always come back in E.164.**
`/api/spa/lookup` and `/api/spa/tab/passes` used to return whatever shape a contact was stored in
— the same customer could read `+91 95397 84092` on one record and `+919539784092` on another.
Every stored number has been converted and new ones are normalised on save, so `phone` and
`whatsapp` are now always `+<code><digits>` with no spaces. Anything comparing, caching or using
these as a WhatsApp identity gets one stable value.

**4. Use a country picker for phone entry, not a free text box.**
The API refuses a number with no country code (`invalid_phone` / `missing_country_code`) and will
not guess one — guessing would point WhatsApp at a stranger. The POS and the booking page now put
a country dropdown in front of the number field; the app should match it. The list both use:

| | | | |
|---|---|---|---|
| `+968` Oman | `+971` UAE | `+966` Saudi Arabia | `+974` Qatar |
| `+973` Bahrain | `+965` Kuwait | `+91` India | `+44` UK |
| `+1` US | | | |

Default to `+968`, join the dial code to the digits typed, send that.

**5. Collect the customer's email.**
`email` is accepted on both `/api/spa/submit` and `/api/spa/tab/submit` and is **optional** — send
it when the customer has one, omit it when they don't. Both our screens now ask for it and it
lands on the contact. Malformed or over-long addresses come back as `invalid_email`.

**6. The screen order changed: details before the questions.**
Both our flows now run **package → personal details → questions and signature**. No endpoint
changed — one submit still carries everything — but the app should reorder its screens to match,
or a customer meets two different journeys depending which one they use.

**7. `has_signature` is gone from `POST /api/spa/lookup`.**
It used to tell the app that a returning customer already had a signature on file, so the app
could skip the signature step. That is no longer true and the key no longer exists. A signature
is consent to **one service**, so it must be collected again for every booking, whoever the
customer is. Any code branching on `has_signature` has to be removed.

**8. `signature` is now expected on every booking.**
On `POST /api/spa/tab/submit` it is documented as required. To keep tablets on the current app
working, a booking without one is **still accepted for now** and flagged *Not Signed* in the back
office. Once the updated app is deployed this becomes a hard `400 missing_signature` — you will
be told before that is switched on.

**9. Questions now come in sections.**
Each question in `GET /api/spa/questions` carries three extra keys — `heading`, `heading_id` and
`heading_style`. Questions arrive already grouped: render a section title whenever `heading_id`
changes, styled with the inline CSS in `heading_style`. See that endpoint for the detail.

---

## Conventions

| | |
|---|---|
| **Base URL** | `https://<your-odoo-host>` |
| **Database** | `X-Odoo-Database: <db name>` on every call — see the section above. Without it the server cannot tell which database you mean and answers 404. |
| **Phone numbers** | E.164 with a `+` and country code: `+96891234567`, no spaces, brackets or dashes — **in both directions**. The API **rejects** numbers without a country code (`invalid_phone` / `missing_country_code`) and will not guess one, so put a country picker in front of the field rather than a free text box. |
| **Signatures** | base64 **PNG**, *without* the `data:image/png;base64,` prefix. Max 2 MB decoded. |
| **Dates / times** | `slot_datetime` is `"YYYY-MM-DD HH:MM"`, store local time. Dates are `"YYYY-MM-DD"`. |
| **Language** | Endpoints that return customer-facing text accept `lang` (e.g. `ar`) — as a query parameter on GETs, in the body on POSTs. |
| **Request body** | POST endpoints take a JSON body. A malformed body is `400 invalid_json`. |

---

## Before anything else: reaching the right database

This Odoo server hosts several databases and has no `dbfilter` set, so it cannot work out which
one you mean. Call any endpoint cold and you get:

```
HTTP 404
<h1>Not Found</h1> <p>No database is selected...
```

That is not your request being wrong. Name the database on every call.

**Send the `X-Odoo-Database` header — do this.**
One header per request. No cookie, no session to keep alive, and it works on a host serving many
databases.

```http
GET /api/spa/therapies
X-Odoo-Database: STRETCH_AND_GO
→ 200 OK
```

Send it on **every** `/api/spa/*` call, GET and POST alike. Two things to know:

* Do **not** also carry an Odoo `session_id` cookie naming a different database — that
  combination is refused with `403 Cannot use both the session_id cookie and the
  x-odoo-database header`. A plain HTTP client with no cookie jar is what you want.
* An unknown database name gives the same 404 page as sending nothing at all, so check the
  spelling — it is case-sensitive.

**The customer's booking link is different.**
A browser opening a link from a WhatsApp message cannot send a custom header, so the customer link
carries the database in the URL instead:

```
/odoo/spa-book?db=<database>&token=<token>
```

`/odoo/<subpath>` is one of the routes Odoo serves before a database is chosen, so it is reachable
on any server. It binds the session to `?db=` and hands the customer on to the booking page —
three invisible redirects, no login screen, no auth. **Nothing has to be configured on the
server**, which matters because these boxes host a dozen tenants behind one hostname: pinning
`dbfilter` would break all the others.

The older `/spa/book?token=…&db=…` form still works wherever it already did, so links already
sent stay valid.

Everything below assumes the header is in place.

---

## Authentication

There are two separate schemes. They do not mix.

### A. Booking link — `token`

For the customer-facing flow reached from the WhatsApp link. The token comes from the link
(`/spa/book?token=…`) and identifies a `spa.booking.session`.

Required by: `GET /api/spa/session`, `POST /api/spa/submit`, `POST /api/spa/lookup`.

> `GET /api/spa/services`, `/therapies`, `/questions` and `/availability` are **catalogue reads
> and need no token**. They expose nothing about a customer.

An expired or unknown token gives `410 invalid_or_expired_session`.

### B. Tablet app — `api_key`

For the in-store tablet (`/api/spa/tab/*`). Two system parameters control it, both under
**Settings → Technical → System Parameters**:

| Parameter | Meaning |
|---|---|
| `spa_online_booking.enable_tab_api` | Must be `True`. While it is off, all three tablet routes return **404** — an unused API must not sit on the internet. |
| `spa_online_booking.tab_api_key` | The shared secret. If it is not set the routes return `401 unauthorized` and refuse to work; they never fall open. |

Send it in the JSON body of every tablet request:

```json
{ "api_key": "<the key>", "...": "..." }
```

A wrong or missing key is `401 unauthorized`.

---

# Booking-link endpoints

## `GET /api/spa/session`

Check that a booking link is still good, and learn the bookable date window.

**Query:** `token` (required)

```json
{
  "token": "c40d9daa26554930b3f0a86dc328fc78",
  "state": "pending",
  "min_booking_date": "2026-08-02",
  "max_booking_date": "2026-09-01"
}
```

`max_booking_date` is `null` when no maximum notice is configured.

**Errors:** `400 missing_token` · `404 not_found` · `410 expired` (with `state`)

---

## `GET /api/spa/services`

Flat list of every bookable service. No token needed.

```json
{ "services": [
  { "id": 2, "name": "GO Ease (30 min) – Single Session",
    "duration_minutes": 30, "price": 120.0,
    "image_url": "/spa/service/2/image" }
] }
```

`image_url` is `null` when the product has no image — keep your placeholder for those.

---

## `GET /api/spa/therapies`

The two-level catalogue the booking page is built from: each **therapy** with its intro and
photo, and the **packages** filed under it. This is the one to build a browse screen on.

**Query:** `lang` (optional)

```json
{
  "therapies": [{
    "id": 1,
    "name": "Go Ease",
    "tagline": "A light and relaxing stretch session",
    "description": "<p>…HTML…</p>",
    "ideal_for": "Beginners, Office Workers",
    "focus_areas": "Neck, Shoulders, Back",
    "duration_min": 30,
    "from_price": 120.0,
    "image_url": "/spa/therapy/1/image",
    "headings": [
      { "id": 1, "name": "General Health (PAR-Q)",
        "style": "color: #22272f; font-weight: 800" }
    ],
    "packages": [{
      "id": 2,
      "name": "GO Ease (30 min) – Single Session",
      "price": 120.0,
      "save": 0,
      "session_count": 1,
      "session_desc": "",
      "duration_minutes": 30,
      "image_url": "/spa/service/2/image",
      "details": [{
        "heading": "What to expect",
        "subheading": "",
        "description": "<p>…</p>",
        "image_url": "/spa/detail/3/image",
        "photos": [ { "url": "/spa/detail/photo/9/image", "caption": "" } ]
      }]
    }]
  }],
  "currency": { "symbol": "ر.ع.", "position": "before" }
}
```

`save` is the amount saved against buying single sessions — show it as a badge when it is
non-zero. `headings` lists that therapy's question sections in order.

---

## `GET /api/spa/questions`

The questions to ask for the chosen package(s), already de-duplicated and **already grouped into
sections**.

**Query:** `service_ids` (required — comma-separated ids), `lang` (optional)

```json
{ "questions": [
  { "id": 1,
    "text": "Is this your first assisted stretching session?",
    "heading": "General Health (PAR-Q)",
    "heading_id": 1,
    "heading_style": "color: #22272f; font-weight: 800",
    "type": "yes_no",
    "required": true,
    "options": [] }
] }
```

**Rendering the sections.** The list arrives in section order, so:

* print `heading` as a section title whenever `heading_id` differs from the previous question's,
  applying `heading_style` as inline CSS on that title;
* restart the question numbering at 1 inside each section;
* `heading_id: 0` means the question belongs to no section — no title.

`type` is one of `text`, `yes_no`, `single_choice`, `multi_choice`. `options` is filled for the
two choice types. `required: true` means the booking will be rejected without an answer.

**Errors:** `400 missing_service_ids` · `400 invalid_service_ids` · `404 not_found`

---

## `GET /api/spa/availability`

Free slots for a day. Hourly, within opening hours, minus slots already taken, minus anything
outside the configured booking-notice window.

**Query:** `service_ids` (required), `date` (required, `YYYY-MM-DD`)

```json
{ "date": "2026-08-03", "service_ids": [2], "slots": ["09:00", "10:00", "14:00"] }
```

An empty `slots` array is a valid answer — the day is full or outside the window.

**Errors:** `400 missing_params` · `400 invalid_params`

---

## `POST /api/spa/submit`

Create a booking from the customer link. Lands in the back office as channel **online**, state
*pending*.

```json
{
  "token": "c40d9daa…",
  "name": "Karthi",
  "phone": "+917010616092",
  "whatsapp": "+917010616092",
  "service_ids": [2],
  "slot_datetime": "2026-08-03 10:00",
  "terms_accepted": true,
  "signature": "iVBORw0KGgoAAAANS…",
  "answers": { "1": "Yes", "2": "No" },
  "date_of_birth": "1997-07-30",
  "gender": "male",
  "email": "karthi@example.com",
  "time_note": "prefer late afternoon"
}
```

Required: `token`, `name`, `phone`, `whatsapp`, `service_ids`, `slot_datetime`.
`answers` is keyed by **question id as a string**; every question with `required: true` must have
a non-empty value.

```json
{ "success": true, "booking_ref": "SPA-0042" }
```

**Errors**

| Code | Status | Meaning |
|---|---|---|
| `invalid_or_expired_session` | 410 | Bad or dead `token`. |
| `missing_fields` | 400 | With `fields: [...]`. |
| `invalid_phone` | 400 | With `field` and `reason` (`missing_country_code` / `invalid_number`). |
| `invalid_service` | 400 | Unknown, archived or non-bookable service id. |
| `too_many_services` | 400 | More than 10 in one booking. |
| `invalid_slot_datetime` | 400 | Not `YYYY-MM-DD HH:MM`, or outside the bookable window. |
| `missing_answer` | 400 | With `question_id`. |
| `invalid_signature` / `signature_too_large` | 400 | Not a decodable image, or over 2 MB. |
| `already_booked` | 409 | Same person, same date. Returns `date` and `booking_ref`. |
| `too_many_requests` | 429 | Per-IP and per-number booking limits. |

---

## `POST /api/spa/lookup`

Who is behind this number, so the app can pre-fill the form. Deliberately narrow: it returns
profile fields only.

```json
{ "token": "c40d9daa…", "phone": "+917010616092" }
```

```json
{ "found": true, "customers": [
  { "id": 7, "name": "karthi", "age": 29,
    "date_of_birth": "1997-07-30", "gender": "male",
    "whatsapp": "+917010616092" }
] }
```

One entry per person — families share a number, and each stays separate.

* **No signature information is returned.** (`has_signature` was removed — see *Changes*.)
* A number with **fewer than 8 digits** returns `{"found": false, "customers": []}` rather than
  matching on a prefix.
* Rate limited to 20 lookups per IP per minute → `429 too_many_requests`.

**Errors:** `410 invalid_or_expired_session` · `429 too_many_requests`

---

# Tablet endpoints

All three require `api_key` in the body, and all three are **404** while
`spa_online_booking.enable_tab_api` is off.

## `POST /api/spa/tab/submit`

Create a booking from the in-store tablet. Tagged channel **tab**, state *pending*, so it appears
in POS → Tab → Pending Approval.

```json
{
  "api_key": "<the key>",
  "name": "Karthi",
  "service_ids": [2],
  "terms_accepted": true,
  "signature": "iVBORw0KGgoAAAANS…",
  "mobile": "+96891234567",
  "whatsapp": "+96891234567",
  "answers": { "1": "Yes" },
  "slot_datetime": "2026-08-03 10:00",
  "time_note": "",
  "date_of_birth": "1997-07-30",
  "gender": "male",
  "email": "k@example.com"
}
```

| Field | | |
|---|---|---|
| `name` | **required** | Customer name. |
| `service_ids` | **required** | List of package ids. |
| `signature` | **required** | Base64 PNG, freshly drawn **for this booking**. Never reuse one from a previous visit. Still accepted when absent for now; those bookings are flagged *Not Signed*, and it becomes `400 missing_signature` once the updated app ships. |
| `mobile` / `phone` | optional | E.164. |
| `whatsapp` | optional | E.164. |
| `answers` | optional | `{"<question_id>": "answer"}`. Required questions must be answered. |
| `slot_datetime` | optional | Omit for a walk-in — it defaults to now. |
| `time_note` | optional | Free text. |

```json
{ "success": true, "booking_ref": "SPA-0043", "id": 43 }
```

**Errors:** `400 invalid_json` · `401 unauthorized` · `400 missing_fields` · `400 invalid_service` ·
`400 invalid_phone` · `400 missing_answer` · `400 invalid_slot_datetime` ·
`400 invalid_signature` / `signature_too_large`

---

## `POST /api/spa/tab/passes`

An existing customer's prepaid packages, by number.

```json
{ "api_key": "<the key>", "phone": "+96891234567", "lang": "ar" }
```

```json
{
  "found": true,
  "customers": [{
    "id": 7, "name": "karthi", "age": 29,
    "date_of_birth": "1997-07-30", "gender": "Male",
    "phone": "+917010616092", "whatsapp": "+917010616092",
    "email": "karthi@example.com",
    "passes": [{
      "pass_id": 12,
      "reference": "PASS-0012",
      "package": "GO Ease (30 min) – Commit Pack (8+1 Sessions)",
      "package_id": 4,
      "sessions_left": 6,
      "sessions_total": 9,
      "valid_till": null
    }]
  }],
  "customer": { "id": 7, "name": "karthi" },
  "passes": [ "…same as customers[0].passes…" ]
}
```

`customer` and the top-level `passes` are the first match only, kept for older app builds — **use
`customers`**, because a number shared by a family returns several people, each with their own
passes. `valid_till` is always `null`; passes do not expire in this build. Only active passes with
sessions remaining are returned.

**Errors:** `400 invalid_json` · `401 unauthorized` · `400 missing_fields`

---

## `POST /api/spa/tab/redeem`

Spend one session off a prepaid pass, as a walk-in today. Creates a *tab* booking linked to the
pass, marked Prepaid, state *pending*.

```json
{ "api_key": "<the key>", "phone": "+96891234567", "pass_id": 12 }
```

```json
{ "success": true, "booking_ref": "SPA-0044", "id": 44, "sessions_left": 6 }
```

**The session is not counted here.** It comes off the pass when reception marks the visit done,
so an accidental submit never silently burns one — which is why `sessions_left` still shows the
pre-redemption figure.

The number given must belong to the pass's owner, so one customer cannot spend another's.

**Errors:** `400 invalid_json` · `401 unauthorized` · `400 invalid_pass` ·
`400 no_sessions_left` (also returned for an unknown or inactive pass)

---

# Images

Public, no authentication, streamed straight from the record. Use the `image_url` values the
catalogue endpoints hand you rather than building these by hand.

| URL | |
|---|---|
| `GET /spa/service/<id>/image` | Package / service photo |
| `GET /spa/therapy/<id>/image` | Therapy photo |
| `GET /spa/detail/<id>/image` | Package detail block image |
| `GET /spa/detail/photo/<id>/image` | Photo inside a detail block |
| `GET /spa/booking/logo` | Company logo for the app header |

A record with no image returns **404** — keep a placeholder.

---

# Limits

| | |
|---|---|
| Services per booking | 10 |
| Signature | 2 MB decoded |
| Name | 200 characters |
| Free text (`time_note`) | 500 characters |
| Email | 254 characters |
| Customer lookups | 20 per IP per minute |
| Bookings per IP | `spa_online_booking.max_bookings_per_ip_hour` (default 10/hour) |
| Bookings per number | `spa_online_booking.max_bookings_per_phone_day` (default 5/day) |

---

*Written from the route definitions in `spa_online_booking/controllers/main.py` and checked
against a running server — every status code, error string and response key above was observed,
not assumed. When an endpoint changes, update this file in the same commit.*
