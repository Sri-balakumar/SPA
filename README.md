# NEXGENN SPA

> A walk-in kiosk for spa reception — the customer picks a service on a tablet, answers the
> questions that service requires, signs the disclaimer, and the booking lands in Odoo for the
> receptionist to approve.

NEXGENN SPA is an [Expo](https://expo.dev) React Native app built for a tablet standing in a spa
lobby. A receptionist connects the device to Odoo once; after that it runs unattended. Everything
the customer sees — the therapy catalogue, prices, currency, and the questions attached to each
service — is edited by the spa team in Odoo and appears on the tablet without a rebuild.

## The customer flow

Seventeen screens, walked in order, each one a step in [screens/flow/](screens/flow/):

```
Welcome ─▶ Identify ─▶ Account / Profile Select ─▶ Membership ─▶ Edit Profile
        ─▶ Service ─▶ Service Detail ─▶ Packages ─▶ Package Details
        ─▶ Personal Info ─▶ Health ─▶ Disclaimer ─▶ Review ─▶ Success
```

**Identify** looks the customer up by phone. A match offers their existing profiles and any
remaining package passes; no match leads to Register as New.

**Service and packages** come from the live catalogue, with per-service questions fetched for the
chosen package.

**Health and disclaimer** collect the medical questionnaire and a signature captured on-screen.

**Review then Success** submits the booking, which arrives in Odoo under *POS ▸ Spa ▸ Tab* with a
Pending state for the receptionist to approve.

## Features

**Two languages** — English and Arabic, with right-to-left text for Arabic, chosen on the tablet
and remembered. Hindi strings are present in `LanguageContext.js` but disabled; the manager asked
for English and Arabic only.

**Phone numbers that validate properly** — `libphonenumber-js` plus per-country rules in
[data/phoneRules.js](data/phoneRules.js). The country ISO is tracked alongside the dial code,
because a dial code alone cannot identify a country and the rules key off the ISO.

**Currency from the server** — taken from Odoo rather than hard-coded, so a deployment in another
country needs no code change.

**Device registration** — each tablet generates a permanent UUID on first run and must be approved
in Odoo before it can be configured, via `device_login_config`. Credentials are saved so the kiosk
auto-logs-in on restart.

**Signature capture** — `SignaturePad` with `react-native-view-shot` to render the signature as an
image for the booking record.

## Tech stack

| | |
|---|---|
| Framework | Expo SDK ~54, React Native 0.81.5, React 19.1 |
| Navigation | Hand-rolled — [App.js](App.js) advances the flow by state. No navigation library. |
| State | React context — [SessionContext.js](SessionContext.js), [LanguageContext.js](LanguageContext.js) |
| Data layer | [spaApi.js](spaApi.js) over the `spa_online_booking` REST API; [odoo.js](odoo.js) for JSON-RPC |
| Connection | [connection.js](connection.js) — server URL, database, device UUID, saved credentials |
| Typography | Playfair Display via `@expo-google-fonts` |
| Other | libphonenumber-js, react-native-svg, react-native-view-shot, expo-camera |

Eighteen runtime dependencies — deliberately small for a device that must stay up all day.

## Odoo backend

All four modules are in [odoo_modules/](odoo_modules/) and target **Odoo 19**.

| Module | Purpose |
|---|---|
| `spa_kiosk` | Walk-in kiosk: select a service, enter details, answer service-specific questions, choose payment mode, submit for receptionist approval. v19.0.1.7.0 |
| `spa_online_booking` | JSON API + static booking page — the REST layer this app calls. v19.0.11.12.0 |
| `pos_spa_header` | POS header showing Orders / Customers / Services, with no order tabs. v19.0.1.3.0 |
| `device_login_config` | Pre-register devices by MAC address; only approved devices can configure the app |

### The REST API

[spaApi.js](spaApi.js) talks to `spa_online_booking`. The catalogue endpoints are **public** — the
app only needs the base URL — while the `/tab/*` endpoints require a shared key held in the Odoo
system parameter `spa_online_booking.tab_api_key`.

| Endpoint | Purpose |
|---|---|
| `GET /api/spa/therapies?lang=` | Catalogue — therapies, packages, currency |
| `GET /api/spa/questions?service_ids=` | Questions for the chosen package |
| `POST /api/spa/tab/submit` | New booking → POS ▸ Spa ▸ Tab (Pending) |
| `POST /api/spa/tab/passes` | An existing customer's remaining packages, by phone |
| `POST /api/spa/tab/redeem` | Check in a pass for today |

Full reference in [odoo_modules/spa_online_booking/TABLET_APP_API.md](odoo_modules/spa_online_booking/TABLET_APP_API.md).

## Getting started

**Prerequisites** — Node.js 18+, npm, and a reachable Odoo 19 server with the modules above
installed.

```bash
npm install
npx expo start
```

On first launch the connect screen asks for the server URL and database. The tablet then registers
its device UUID, which an administrator approves in Odoo before the kiosk will run.

`spaApi.js` has a `DEMO_MODE` flag. Leave it `false` — with it on, the profile lookup shows sample
people instead of real customers.

## Building

Two profiles in [eas.json](eas.json), both producing an APK:

```bash
eas build --profile preview      # internal distribution
eas build --profile production
```

Current release: **v1.0.0**, Android package `com.alphalize.spa`, EAS owner `donav`.

## Project structure

```
App.js               the flow state machine
index.js             entry point
screens/
  LoadingScreen, LoginScreen, ConnectionScreen, HomeScreen
  flow/              the 17 customer-flow screens, Welcome through Success
components/          Button, Input, Dropdown, CodePicker, SignaturePad,
                     BrandHeader, StepHeader, PersonBanner, RichText,
                     AppAlert, LangButton, Logo, NexFooter
data/                countries.js, phoneRules.js, options.js
spaApi.js            REST client for spa_online_booking
odoo.js              JSON-RPC layer
connection.js        server URL, database, device UUID, saved credentials
SessionContext.js    booking form state across the flow
LanguageContext.js   EN/AR strings, direction, persistence
theme.js dateFmt.js
odoo_modules/        the four Odoo modules
```

## Documentation

- [odoo_modules/spa_online_booking/TABLET_APP_API.md](odoo_modules/spa_online_booking/TABLET_APP_API.md) —
  the endpoints this app calls.
- [odoo_modules/spa_online_booking/API.md](odoo_modules/spa_online_booking/API.md) — the wider
  booking API.
- [odoo_modules/spa_online_booking/DEPLOY_UBUNTU.md](odoo_modules/spa_online_booking/DEPLOY_UBUNTU.md) —
  server deployment.
