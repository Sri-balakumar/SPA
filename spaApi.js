// Spa data layer — talks to the `spa_online_booking` REST API on Odoo.
// These endpoints are PUBLIC (no login): the app only needs the server Base URL
// (set on the connect screen, read from ./connection). Everything the spa team
// edits in Odoo shows up here automatically.
//
// Endpoints (see the module's TABLET_APP_API.md):
//   GET  /api/spa/therapies?lang=      → catalogue (therapies + packages + currency)
//   GET  /api/spa/questions?service_ids=<packageId>
//   POST /api/spa/tab/submit           → new booking → POS ▸ Spa ▸ Tab (Pending)
//   POST /api/spa/tab/passes  {phone}  → existing customer's remaining packages
//   POST /api/spa/tab/redeem  {phone,pass_id} → check in for today
import { getBaseUrl, getDb } from './connection';

// Set to true ONLY to demo the "Select Your Profile" flow without a live server.
// When false, the lookup shows REAL customers (or "not found" → Register as New) —
// never the fake sample people.
const DEMO_MODE = false;

// Shared key for the tablet REST endpoints (Odoo system param
// `spa_online_booking.tab_api_key`). The server rejects /tab/* calls without it
// ("unauthorized"). If the backend team rotates the key, update this value.
const TAB_API_KEY = 'YRyMXZZO7eJP2ebm5NzuJVyU0CfAtEGF';

function base() {
  const b = getBaseUrl();
  if (!b) throw new Error('Please connect to the server first.');
  return b;
}

async function readJson(res) {
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (e) {
    // Not JSON — most likely a 404 route/DB page or a 500 error page. Surface a
    // short snippet so we can see WHAT the server actually returned.
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`Unexpected response (${res.status}): ${snippet || 'empty'}`);
  }
  if (!res.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Server error (${res.status}).`);
  }
  return data;
}

// Multi-DB servers have no dbfilter, so a cold /api/spa/* call 404s with
// "No database is selected". Per the API docs, hitting GET /spa/book?db=<db>
// once sets a session cookie bound to that DB; RN's fetch then carries it on
// every later call. We do this lazily and cache per (url, db).
let _boundKey = null;
async function ensureDbSession() {
  const db = getDb();
  const key = `${getBaseUrl()}|${db}`;
  if (!db || _boundKey === key) return;
  try {
    await fetch(`${base()}/spa/book?db=${encodeURIComponent(db)}`);
    _boundKey = key;
  } catch (e) { /* fall through — the login session cookie may already cover it */ }
}

async function restGet(path) {
  await ensureDbSession();
  let res;
  try { res = await fetch(base() + path); }
  catch (e) { throw new Error('Cannot reach the server. Check the connection.'); }
  return readJson(res);
}

async function restPost(path, body) {
  await ensureDbSession();
  let res;
  try {
    res = await fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (e) { throw new Error('Cannot reach the server. Check the connection.'); }
  return readJson(res);
}

// Turn an API image path (e.g. "/spa/service/12/image") into an <Image> source.
export function mediaUrl(path) {
  return path ? { uri: base() + path } : null;
}

// Fetch an image THROUGH the app's authenticated connection so it carries the
// login-session cookie the multi-database server needs to pick the right DB,
// and return a base64 data URI usable directly by <Image>. (Native <Image>
// requests don't send the session cookie, so a plain URL 404s on this server.)
// Falls back to null on any error.
export async function loadImageDataUri(path) {
  if (!path) return null;
  try {
    const res = await fetch(base() + path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// Legacy base64 image helper (kept for any screen that still references it).
export function odooImage(b64) {
  if (!b64) return null;
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  return { uri: `data:${mime};base64,${b64}` };
}

// ---------- Catalogue ----------

// Odoo rich-text fields come back as HTML ("<div ...>text</div>"). Strip tags
// and decode the common entities so the app shows clean plain text.
function stripHtml(s) {
  if (!s || typeof s !== 'string') return s || '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Therapies (GO Ease/Flex/Relief/Release) with their packages + shop currency.
// Returns { therapies:[...], currency:{symbol,position} }.
export async function loadTherapies(lang = 'en') {
  const data = await restGet(`/api/spa/therapies?lang=${encodeURIComponent(lang)}`);
  (data.therapies || []).forEach((t) => {
    t.description = stripHtml(t.description);
    t.tagline = stripHtml(t.tagline);
    t.ideal_for = stripHtml(t.ideal_for);
    t.focus_areas = stripHtml(t.focus_areas);
    (t.packages || []).forEach((p) => {
      p.session_desc = stripHtml(p.session_desc);
      (p.details || []).forEach((d) => {
        d.heading = stripHtml(d.heading);
        d.subheading = stripHtml(d.subheading);
        d.description = stripHtml(d.description);
      });
    });
  });
  // Load images through the session (the multi-DB server needs the cookie that
  // native <Image> requests don't send). Each therapy gets an inline data URI.
  await Promise.all((data.therapies || []).map(async (t) => {
    t.image_data = await loadImageDataUri(t.image_url);
    await Promise.all((t.packages || []).map(async (p) => {
      p.image_data = await loadImageDataUri(p.image_url);
    }));
  }));
  return data;
}

// Questions for a chosen PACKAGE (its therapy's questions). Mapped to the shape
// the screens already use: { id, name, type, required, options }.
export async function loadQuestions(packageId, lang = 'en') {
  const data = await restGet(`/api/spa/questions?service_ids=${encodeURIComponent(packageId)}&lang=${encodeURIComponent(lang)}`);
  return (data.questions || []).map((q) => ({
    id: q.id, name: q.text, type: q.type, required: q.required, options: q.options || [],
    heading: q.heading || '', headingId: q.heading_id ?? 0,   // section grouping
  }));
}

// ---------- New booking (tablet → POS Spa Tab) ----------

export async function submitBooking(form) {
  const answers = {};
  (form.answers || []).forEach((a) => {
    if (a.value !== '' && a.value != null) answers[String(a.questionId)] = String(a.value);
  });
  const cc = form.countryCode || '';
  // E.164: leading +, country code, NO spaces/brackets/dashes (per the API docs).
  const withCc = (n) => (n ? `${cc}${String(n).replace(/\D/g, '')}` : '');
  const body = {
    name: form.fullName,
    service_ids: [form.serviceId],                 // the chosen PACKAGE id
    mobile: withCc(form.phone),
    whatsapp: form.whatsappSame ? withCc(form.phone) : withCc(form.whatsapp),
    // Save the personal details onto the customer's Contact too.
    birthday: form.dobISO || form.dob || '',        // date of birth (YYYY-MM-DD preferred)
    dob: form.dobISO || form.dob || '',
    date_of_birth: form.dobISO || form.dob || '',   // the key the API docs name
    gender: form.gender || '',
    age: form.age !== '' && form.age != null ? String(form.age) : '',
    email: form.email || '',                         // contact email
    signature: form.signature || '',                 // digital signature (base64 PNG, no prefix)
    answers,
    api_key: TAB_API_KEY,
  };
  return restPost('/api/spa/tab/submit', body);     // { success, booking_ref, id }
}

// ---------- Existing customer (passes / redeem) ----------

// Look up who is behind a phone number and their remaining packages.
// One number can belong to several family members, so this returns a LIST of
// customers: { found, customers:[ {id,name,age,gender,phone,whatsapp,packages:[...]} ] }.
// Handles both the new multi-customer response and the older single-customer
// one, and falls back to SAMPLE people if the server can't be reached.
export async function findMembership(phone, lang = 'en') {
  // E.164, no spaces — matches how the server stores/compares numbers.
  const clean = `+${String(phone || '').replace(/\D/g, '')}`;
  try {
    const data = await restPost('/api/spa/tab/passes', { phone: clean, lang, api_key: TAB_API_KEY });
    // New shape: a list of people who share this number.
    if (Array.isArray(data.customers) && data.customers.length) {
      return { demo: false, customers: data.customers.map((c) => shapeCustomer(c, phone)) };
    }
    // Old shape: one customer + a flat passes list → wrap as a single person.
    if (data.found && Array.isArray(data.passes)) {
      const c = data.customer || {};
      return { demo: false, customers: [shapeCustomer({ id: c.id, name: c.name, passes: data.passes }, phone)] };
    }
    return null;                                   // reachable, but nobody found for this number
  } catch (e) {
    // No fake people. In demo mode only, show the sample profiles; otherwise treat
    // a failed lookup as "nobody found" → the screen offers "Register as New Customer".
    if (DEMO_MODE) {
      const digits = String(phone || '').replace(/\D/g, '');
      return digits.length >= 4 ? demoProfiles(phone) : null;
    }
    return null;
  }
}

// Normalise one customer + their passes into the shape the screens use.
function shapeCustomer(c, phone) {
  return {
    id: c.id, name: c.name || 'Customer', demo: !!c.demo,
    age: c.age || '', gender: c.gender || '',
    // date of birth + email — pass through whatever key the backend uses
    dob: c.dob || c.birthday || c.date_of_birth || c.birthdate || '',
    email: c.email || '',
    phone: c.phone || phone, whatsapp: c.whatsapp || c.phone || phone,
    packages: (c.passes || []).map((p) => ({
      id: p.pass_id, pass_id: p.pass_id, package_id: p.package_id, reference: p.reference,
      service_name: p.package, package_name: p.reference || '',
      sessions_total: p.sessions_total || 0, sessions_left: p.sessions_left || 0,
      sessions_used: Math.max(0, (p.sessions_total || 0) - (p.sessions_left || 0)),
      valid_till: p.valid_till || '',
    })),
  };
}

// Check in for today on one package. The server does NOT decrement sessions yet
// (reception counts the session when the visit is marked done); it returns the
// current sessions_left. → { success, booking_ref, id, sessions_left }.
export async function checkInSession(pkg, phone) {
  if (!pkg || pkg.demo) {
    return { success: true, booking_ref: 'DEMO', sessions_left: pkg ? pkg.sessions_left : 0 };
  }
  return restPost('/api/spa/tab/redeem', { phone, pass_id: pkg.pass_id || pkg.id, api_key: TAB_API_KEY });
}

// Sample people — used only when the live server isn't reachable yet, so the
// "Select Your Profile" flow can be shown. Several people share one number.
function demoProfiles(phone) {
  const m = String(phone || '').trim();
  const mobile = m.startsWith('+') ? m : `+968 ${m}`;
  const mk = (svc, ref, total, left) => ({
    id: 0, pass_id: 0, demo: true, reference: ref,
    service_name: svc, package_name: ref,
    sessions_total: total, sessions_left: left, sessions_used: total - left,
    valid_till: '15 May 2026',
  });
  return {
    demo: true,
    customers: [
      { id: 1, name: 'Sonia Kuriakose', age: '28', gender: 'Female', dob: '12 May 1996', phone: mobile, whatsapp: mobile, demo: true,
        packages: [mk('GO Relief (60 min) – Lifestyle Pack (12+2)', 'PASS/00003', 14, 13), mk('GO Ease (30 min) – Starter Pack (4+1)', 'PASS/00004', 5, 4)] },
      { id: 2, name: 'Regi George', age: '34', gender: 'Male', dob: '3 Aug 1990', phone: mobile, whatsapp: mobile, demo: true,
        packages: [mk('GO Flex (40 min) – Commit Pack (8+1)', 'PASS/00001', 9, 4)] },
      { id: 3, name: 'George Kuriakose', age: '60', gender: 'Male', dob: '20 Jan 1964', phone: mobile, whatsapp: mobile, demo: true,
        packages: [] },
    ],
  };
}
