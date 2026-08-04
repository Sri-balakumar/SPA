# Stretch & Go — Tablet App Integration Guide

This module (`spa_online_booking`) runs on the shop's **Odoo server** and exposes
a small JSON REST API. The tablet app (Expo / React Native → APK) calls these
endpoints over the network. A submitted booking appears instantly in the POS
under **Orders → Tab → Pending Approval**.

The app does **not** embed the module. It just makes HTTP requests to the
Odoo server. All endpoints are plain JSON, no login/token, no CORS problems for
native `fetch`.

---

## Base URL

```
http://<ODOO_SERVER_IP>:8069
```

- On the shop WiFi during development this is the PC's LAN IP, e.g. `http://192.168.1.6:8069`.
- For production (tablets in the shop), keep the Odoo PC on a **static IP** or
  give it a hostname. If tablets must work off‑site, put Odoo behind a public
  **domain + HTTPS** and use that URL instead.
- Android release builds block cleartext HTTP by default — either use HTTPS in
  production, or allow cleartext for the server host in the app config.

**Send this header on every request:**

```
X-Odoo-Database: spa
```

The server hosts several databases and has no `dbfilter`, so without it Odoo
cannot tell which one you mean and answers `404 "No database is selected and the
requested URL was not found in the server-wide controllers."` — an HTML page,
not JSON. That 404 is the usual reason the API looks "not installed".
`?db=spa` on the query string works too.

---

## 1. Get the catalogue (therapies + packages)

```
GET /api/spa/therapies?lang=en          (use lang=ar for Arabic)
```

Response (trimmed):
```json
{
  "currency": { "symbol": "ر.ع.", "position": "after" },
  "therapies": [
    {
      "id": 24,
      "name": "GO Ease",
      "tagline": "…",
      "description": "…",
      "ideal_for": "…",
      "focus_areas": "…",
      "duration_min": 30,
      "from_price": 18.0,
      "image_url": "/spa/therapy/24/image",
      "packages": [
        {
          "id": 150,
          "name": "GO Ease (30 min) – Single Session",
          "price": 18.0,
          "save": 0,
          "session_count": 1,
          "session_desc": "…",
          "duration_minutes": 30,
          "image_url": "/spa/service/150/image"
        }
      ]
    }
  ]
}
```
- Use the **package `id`** as the "service id" everywhere below.
- `image_url` values are paths — prefix with the Base URL to load them.

## 2. Get the questions for a chosen package

```
GET /api/spa/questions?service_ids=<packageId>&lang=en
```
```json
{
  "questions": [
    { "id": 20, "text": "Are you looking for a full-body stretching session?",
      "type": "yes_no", "required": true, "options": [] }
  ]
}
```
`type` is one of: `text`, `yes_no`, `single_choice`, `multi_choice`.
For choice types, render `options`.

## 3. Submit the booking  ← the tablet endpoint

```
POST /api/spa/tab/submit
Content-Type: application/json
```
Body:
```json
{
  "name": "Sunny",
  "mobile": "+96891234567",
  "service_ids": [150],
  "answers": { "20": "Yes", "21": "No" }
}
```
| field | required | notes |
|-------|----------|-------|
| `name` | yes | customer name |
| `service_ids` | yes | array of package ids (usually one) |
| `mobile` / `phone` | no | with country code, e.g. `+968…` |
| `whatsapp` | no | with country code |
| `date_of_birth` | no | `"YYYY-MM-DD"` (saved to the customer; age is derived from it) |
| `gender` | no | `"male"` / `"female"` / `"other"` |
| `answers` | no* | `{ "<questionId>": "answer" }`. *Required questions must be answered.* |
| `slot_datetime` | no | `"YYYY-MM-DD HH:MM"`; omit for a walk-in (defaults to now) |
| `time_note` | no | free-text preferred time |
| `api_key` | only if enabled | see "Security" below |

Success:
```json
{ "success": true, "booking_ref": "SPA-0028", "id": 28 }
```
Errors return HTTP 400/401 with `{ "error": "…" }` (e.g. `missing_fields`,
`invalid_service`, `missing_answer`, `invalid_phone`, `unauthorized`).

> This is the **New customer** flow: they pick a package, answer the questions,
> and submit. They pay at the counter afterwards.

---

## New vs Existing customer

The tablet's start screen should offer two buttons:

- **New** — the flow in section 3 above (pick a package → questions → submit).
- **Existing** — a customer who **already bought a package** (a "session pass")
  and is here to use one of their remaining sessions. They **do not pay again**.
  Use sections 4 & 5 below.

The Existing flow is: enter phone → we return their remaining packages → they
pick one → submit. A **prepaid** request lands in POS → Tab → Pending Approval.
The session is counted against their package **only when reception marks it
done**, so nothing is lost if a submit is abandoned.

## 4. Look up an existing customer's packages (by phone)

```
POST /api/spa/tab/passes
Content-Type: application/json
```
Body:
```json
{ "phone": "+96891234567" }
```
Response when found — **one object per person** who shares the number (families
stay separate, each with their own passes):
```json
{
  "found": true,
  "customers": [
    {
      "id": 12, "name": "Sonia Kuriakose",
      "age": 28, "gender": "Female",
      "phone": "+968 9876 5432", "whatsapp": "+968 9876 5432",
      "passes": [
        { "pass_id": 3, "reference": "PASS/00003", "package": "GO Relief …",
          "package_id": 24, "sessions_left": 13, "sessions_total": 14,
          "valid_till": null }
      ]
    },
    { "id": 18, "name": "George Kuriakose", "age": 60, "gender": "Male",
      "phone": "…", "whatsapp": "…", "passes": [] }
  ],

  "customer": { "id": 12, "name": "Sonia Kuriakose" },
  "passes": [ … first person's passes … ]
}
```
- **`customers`** is the new shape — one entry per matching `res.partner`, each
  carrying **only their own** passes (not merged).
- `age` is derived from the contact's date of birth; `gender`/`whatsapp` come
  from the contact. `valid_till` is `null` — passes don't expire in this build.
- `customer` + `passes` at the top level are kept for **backward compatibility**
  (the first matching person) so older app builds still work.
- Not found → `{ "found": false, "customers": [], "customer": null, "passes": [] }`.
- Only **active** packages with **sessions remaining** are returned.

## 5. Redeem a session (existing customer, walk-in today)

```
POST /api/spa/tab/redeem
Content-Type: application/json
```
Body:
```json
{ "phone": "+96891234567", "pass_id": 12 }
```
| field | required | notes |
|-------|----------|-------|
| `pass_id` | yes | the `pass_id` chosen from section 4 |
| `phone` / `mobile` / `whatsapp` | recommended | must match the pass's customer |
| `api_key` | only if enabled | see "Security" |

Success:
```json
{ "success": true, "booking_ref": "SPA-0031", "id": 31, "sessions_left": 8 }
```
- `sessions_left` is what **remains** — it is **not** decremented yet. The
  session is counted when reception completes the appointment in the POS.
- Errors: `no_sessions_left` (pass empty/inactive), `invalid_pass`,
  `pass_mismatch` (phone doesn't match the pass), `unauthorized`.

---

## Minimal React Native example

```js
const BASE = "http://192.168.1.6:8069";

async function getTherapies() {
  const r = await fetch(`${BASE}/api/spa/therapies?lang=en`);
  return (await r.json()).therapies;
}
async function getQuestions(packageId) {
  const r = await fetch(`${BASE}/api/spa/questions?service_ids=${packageId}&lang=en`);
  return (await r.json()).questions;
}
async function submit(booking) {
  const r = await fetch(`${BASE}/api/spa/tab/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  });
  return r.json(); // { success, booking_ref, id }
}

// booking example:
// { name: "Sunny", mobile: "+96891234567", service_ids: [150],
//   answers: { "20": "Yes", "21": "No" } }

// ----- Existing customer -----
async function getPasses(phone) {
  const r = await fetch(`${BASE}/api/spa/tab/passes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  return r.json(); // { found, customers: [{ id, name, age, gender, phone, whatsapp, passes:[...] }], customer, passes }
}
async function redeem(phone, passId) {
  const r = await fetch(`${BASE}/api/spa/tab/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, pass_id: passId }),
  });
  return r.json(); // { success, booking_ref, id, sessions_left }
}
```

---

## Security — REQUIRED, not optional

The three `/api/spa/tab/*` routes create bookings, read customer records and
spend prepaid passes, so they are **off by default and fail closed**. Two
Odoo System Parameters switch them on
(**Settings → Technical → System Parameters**):

| Key | Value |
|-----|-------|
| `spa_online_booking.enable_tab_api` | `True` |
| `spa_online_booking.tab_api_key` | the shared secret the app sends |

Then every tablet POST body must include `"api_key": "<that secret>"`.

- `enable_tab_api` not set → **404** (a bare werkzeug page, so a disabled API
  does not advertise that it exists).
- `tab_api_key` not set, or the body's key does not match → **401**
  `{"error": "unauthorized"}`.

The catalogue routes (`/api/spa/therapies`, `/api/spa/questions`) stay public
and need no key.

If you change these parameters outside the Odoo UI, restart the Odoo service —
`ir.config_parameter` values are cached per process.

---

## Installing the module (only if she runs her own Odoo)

`spa_online_booking` depends on the shop's other modules: **`spa_kiosk`** and
**`pos_spa_header`** (plus `point_of_sale` and `account`, which ship with Odoo).
To install it on a fresh Odoo 19, all three custom modules must be in the
addons path. To just build the app against the shop's live server, no install
is needed — only the Base URL above.
