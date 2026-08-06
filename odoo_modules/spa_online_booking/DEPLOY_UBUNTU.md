# Spa modules — deployment on a fresh Ubuntu Odoo 19 server

Covers `spa_kiosk`, `pos_spa_header`, `spa_online_booking` (+ the `whatsapp_gateway`
dependency). Written against Odoo **19.0.20260403**.

---

## 1. Copy the modules

Copy these folders into the server's addons path:

```
spa_kiosk/
pos_spa_header/
spa_online_booking/
whatsapp_gateway/          # now a hard dependency (booking links are sent on it)
```

**Exclude every `__pycache__/` directory** — they contain Windows-built
`cpython-312.pyc` files:

```bash
rsync -a --exclude '__pycache__' --exclude '*.bak-spa' \
      spa_kiosk pos_spa_header spa_online_booking whatsapp_gateway \
      odoo@server:/opt/odoo/addons/
```

Confirm the server runs **Python 3.12** (`python3 --version`).

> `*.bak-spa` files are the pre-fix backups left on the Windows box. Don't ship them.

## 2. Python packages

```bash
sudo -u odoo /opt/odoo/venv/bin/pip install phonenumbers neonize qrcode Pillow
```

- `phonenumbers` — now declared in `spa_online_booking`'s `external_dependencies`,
  so the module **will refuse to install without it**. It is *not* in Odoo's own
  `requirements.txt`.
- `neonize`, `qrcode`, `Pillow` — required by `whatsapp_gateway`.
- `pytz` is already a core Odoo dependency.

## 3. Install order

```bash
sudo -u odoo /opt/odoo/venv/bin/python3 odoo-bin \
     -c /etc/odoo/odoo.conf -d <DB> \
     -i spa_online_booking --stop-after-init
```

Installing `spa_online_booking` alone is enough — it pulls
`spa_kiosk` → `pos_spa_header` → `whatsapp_gateway` in the right order.
The dependency graph is acyclic:

```
point_of_sale ──┬──► spa_kiosk ───────┐
                └──► pos_spa_header ──┤
                                      ├──► spa_online_booking
   base, web, product, account,       │
   whatsapp_gateway ──────────────────┘
```

## 4. odoo.conf — the one line everything depends on

```ini
server_wide_modules = base,rpc,web,spa_online_booking
```

**Without this, every customer booking link returns 404 "No database is selected".**
Customers open the link with no session, so on a server hosting more than one database
Odoo cannot choose one. The link carries `&db=<name>` and `/spa/book` resolves it with
`ensure_db()` — but `odoo/http.py` builds the no-database routing map from
`server_wide_modules` **only**, so the route is invisible until the module is listed there.
**Since the entry link was added this is optional too.** The customer link goes through
`/odoo/spa-book?db=<db>&token=<token>` (see `controllers/booking_entry.py`), which works whether
or not this module is server-wide, so a shared multi-tenant box needs no configuration at all.
Listing the module here simply lets the older `/spa/book?token=..&db=..` form keep working; both
are generated identically today. You do **not** need `dbfilter`, and on a server hosting several
databases you must not use it.

⚠️ The **walk-in kiosk** (`/spa/kiosk`) has no `ensure_db()` and is therefore still
session-dependent. On a multi-database server a tablet must first open a `?db=`-carrying URL
(e.g. the booking link) or the kiosk answers 404. If the kiosk is used, either give that
server its own `dbfilter`, or add `spa_kiosk` to `server_wide_modules` and the same
`ensure_db()` treatment.

`workers` — on Ubuntu this is usually > 0. **The WhatsApp bridge lives in one process**:
`whatsapp_gateway` keeps its client in module-level dicts, so only the worker that connected
it can send. Any request served by another worker reports "not connected". Run `workers = 0`,
or expect intermittent send failures.

## 5. Post-install settings

| # | Where | Setting | Why |
|---|---|---|---|
| 1 | Settings → Technical → System Parameters | `web.base.url` = your public URL, **and `web.base.url.freeze` = `True`** | Every customer booking link is built from `get_base_url()`. Odoo keeps `web.base.url` in sync with whatever host an admin last logged in from, so without `freeze` it silently reverts to e.g. `http://localhost:8069`. A `localhost` link is doubly broken: on the customer's phone it means *their own phone*, and **WhatsApp will not even render it as a tappable link** — its linkifier needs a real domain or IP, so it arrives as dead plain text. |
| 2 | Settings → Spa Online Booking → **WhatsApp Delivery** | pick the **WhatsApp Session** | Booking links are sent on this session. There is normally more than one session on a database, so don't leave it to chance. If empty/disconnected, the first *connected* session is used. |
| 3 | WhatsApp → Sessions | scan the QR so the session shows **connected** | While no session is connected, "Send Link" still creates the link but falls back to the wa.me hand-off. |
| 3b | — | **Nothing to set.** Neither `dbfilter` nor `server_wide_modules` is required for the customer link any more | The link now points at `/odoo/spa-book?db=<db>&token=<token>`. `/odoo/<subpath>` is one of the routes Odoo serves before a database is chosen, so it is reachable on any server; it calls `ensure_db()`, which binds the session to `?db=` and re-dispatches through that database, and `controllers/booking_entry.py` then hands the customer to `/spa/book`. Three invisible redirects, no login screen. **Do not pin `dbfilter`** on a shared server — it would break every other tenant on the box. |
| 4 | Settings → Technical → System Parameters | `spa_online_booking.tab_api_key` = a long random string | **Security.** The tablet routes `/api/spa/tab/submit`, `/tab/passes`, `/tab/redeem` only check the key `if api_key:` — leaving it unset on a public server allows anonymous booking creation and customer-PII lookup by phone number. |

## 6. Re-branding (currently hardcoded "Stretch and Go")

| File | What |
|---|---|
| **POS receipt** | Nothing to edit — the receipt is stock Odoo again. The logo comes from **Settings → Companies → Logo**, and the address block from **Point of Sale → Configuration → your register → Receipt Header** (a plain text field, per register). The old hardcoded `receipt_brand.xml` was removed. |
| `spa_online_booking/static/src/pos/product_screen_therapy.js` | logo path |
| `spa_online_booking/models/booking_session.py` (`_wa_message_body`) | the WhatsApp message text |
| `spa_online_booking/TABLET_APP_API.md` | dev IP `192.168.1.6:8069` in the docs |
| `pos_custom_branding/static/src/img/NEXGENN_LOGO.png` | POS / customer-display logo, if you ship that module |

## 7. Known non-blocking items

- `spa_online_booking/static/src/pos/product_screen_therapy.js` calls
  `invoice.template.config` (from the third-party `dynamic_invoice_template`
  module) **unguarded**. If you don't ship that module, either guard the call or
  accept one failing RPC per POS boot.
- `spa_kiosk`'s public `/spa/kiosk/submit` is `auth='public'`, `csrf=False` and
  creates `res.partner` + `spa.booking` + a draft `pos.order` as `sudo()`, with no
  rate limit. It also merges onto an existing partner by phone number. Fine on a
  LAN tablet; put it behind auth or a rate limit if the kiosk URL is reachable
  from the internet.
- Neither `spa.session.pass` nor `spa.booking` has a multi-company `ir.rule`.
  Only relevant if you run more than one company on the database.

## 8. Verify the install

```bash
# 1. no errors during install
grep -E "ERROR|CRITICAL|Traceback" /var/log/odoo/odoo.log
```

2. Open the POS. It must reach the floor/product screen with **no "Oops!" dialog**.
   Odoo 19 resolves QWeb `t-inherit` **in the browser**, so a bad `xpath` shows up
   as an "owl lifecycle" error while every server call still returns HTTP 200 —
   check the browser console, not just the server log.
3. Complete one POS order and confirm the **receipt renders**.
4. POS → **Send Link** → type a mobile number → the Send button un-greys → send.
   Confirm the message arrives and **no new tab opens**.
5. Submit a walk-in booking on `/spa/kiosk` and confirm it saves with a
   **non-zero price**.
6. Open a Contact as a non-POS internal user — no `AccessError`.

---

## Appendix — what was changed and why (2026-07-28)

### The crash that started this
`pos_spa_header` deleted `<OrderTabs/>` from the POS Navbar with
`position="replace"`. `pos_total_discount` anchors
`<xpath expr="//OrderTabs" position="after">` and loads **after** it (asset order
is `(not application, sequence, name)`), so its inheritance threw
`Element ... cannot be located in element tree` while building
`point_of_sale.Navbar` — taking the whole POS chrome down.

**Rule of thumb: never `position="replace"` a node another module might anchor
on. Hide it with `position="attributes"` → `t-if="false"` instead.**

Three bugs of exactly this class were fixed:

| Module | Was | Now |
|---|---|---|
| `pos_spa_header/static/src/navbar_patch.xml` | deleted `//OrderTabs` | hides it via `t-if="false"` |
| `spa_online_booking/static/src/pos/receipt_brand.xml` | `//div[hasclass('footer-powered-by')]` — that class exists nowhere in Odoo 19 | xpath removed (`odoo_branding_customization_nexgenn` already handles that node) |
| `pos_custom_branding/static/src/xml/odoo_logo.xml` | `//svg` — never matches, because the core `<svg>` is in the SVG namespace and an unprefixed XPath name only matches null-namespace elements | replaces the plain wrapper `<div>` instead; also dropped the self-referential `t-name` on an extension-mode inherit |

`pos_spa_header` also used to `replace` the whole `navbar-menu` div, which
silently destroyed `pos_restaurant`'s **Tables** button and its `orders-button`
rewiring (injected into that same div earlier). It now appends with
`position="inside"`.

### Fresh-install correctness
- `pos_spa_header` now depends on `spa_kiosk` (its JS calls `spa.question` and
  `product.template.get_pos_spa_questions`).
- `spa_kiosk` now depends on `account` (uses `account.tax` directly).
- `spa_online_booking` now depends on `product` + `whatsapp_gateway`, declares
  `phonenumbers`, and has `license`/`author`.
- `spa.booking.session._sql_constraints` → `models.Constraint`. Odoo 19 **removed**
  `_sql_constraints` (logged and silently dropped), so the `UNIQUE(token)` index
  behind the public token auth had never actually been created.
- `spa.booking._check_services` now accepts `product_id` **or** `product_ids`, and
  `price` falls back to `product_id.list_price`. Previously every walk-in kiosk
  booking was rejected — or priced 0.00 — as soon as `spa_online_booking` was installed.
- `spa_kiosk`'s kiosk controller now also fills `product_ids`.
- "Spa Visits" pages on the Contact form are gated behind
  `point_of_sale.group_pos_user` (they embed `pos_order_ids`, which non-POS users
  cannot read).
- Read-only `base.group_user` ACLs added for the spa models that `res.partner` /
  `product.template` now expose to every internal user.
- The `spa.session.pass` `ir.sequence` is wrapped in `<data noupdate="1">` so `-u`
  stops resetting it.

### WhatsApp
Booking links are now sent **directly** on your own WhatsApp session via
`whatsapp.session.send_message(phone, message)` — synchronous, no queue, no
retry, raises `UserError` when the bridge is down. All call sites wrap it, so a
disconnected session degrades to the wa.me link instead of erroring.

The POS **Send Link** dialog was rebuilt to match the WhatsApp *Send Message*
wizard: **Contact** picker (fills name + number from the POS contact list),
**Customer Name**, **Mobile Number** with country picker, and a **Send Message**
button that stays greyed out until a number is entered. `spa.booking.session`
gained `partner_id` and `customer_name` to record who the link went to.

---

## Appendix — service visibility (changed 2026-07-28)

A service appears on the booking page **and** the walk-in kiosk when it is filed under a POS
category that has **Show as Therapy online** ticked. That is the only control.

`product.template.spa_kiosk_visible` is **no longer read anywhere** — the field still exists
for old data, but its checkbox was removed from the product form, so anything created after
that defaulted to `False` and silently vanished from the booking page. Do not re-add it.
The single rule lives in `product.template._spa_bookable_domain()`
(`spa_kiosk/models/product_template.py`, narrowed by `spa_online_booking`).

**If a package does not show: give it a POS category.** Nothing else matters.
