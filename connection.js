// ============================================================
//  Runtime connection store — the Odoo server URL + database the
//  user typed on the login screen. Unlike a hardcoded config, these
//  are entered at runtime, kept in memory for the JSON-RPC layer to
//  read, and persisted so the next launch prefills them.
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'spa.connection';
const DEVICE_KEY = 'spa.deviceId';        // this tablet's permanent UUID
const REG_KEY = 'spa.deviceRegistered';   // '1' once approved by Odoo
const CRED_KEY = 'spa.cred';              // saved login for kiosk auto-login

// In-memory current connection. `odoo.js` reads baseUrl/db from here.
let current = { baseUrl: '', db: '' };
let deviceId = '';

// RFC-4122 v4 UUID — the app's permanent Device ID (what the admin approves).
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Get (or create once) this tablet's permanent Device ID.
export async function getDeviceId() {
  if (deviceId) return deviceId;
  try {
    let id = await AsyncStorage.getItem(DEVICE_KEY);
    if (!id) { id = uuidv4(); await AsyncStorage.setItem(DEVICE_KEY, id); }
    deviceId = id;
  } catch (e) { deviceId = uuidv4(); }
  return deviceId;
}

// Per-database registration, stored as a JSON map { "<db>": true }. A device
// registered on one Odoo database is NOT automatically registered on another,
// so switching databases correctly re-triggers the QR scan.
export async function isDeviceRegistered(db) {
  try {
    const raw = await AsyncStorage.getItem(REG_KEY);
    if (!raw) return false;
    if (raw === '1') return false;            // legacy global flag → force a fresh per-DB scan
    const map = JSON.parse(raw);
    return db ? !!map[db] : Object.values(map).some(Boolean);
  } catch (e) { return false; }
}
export async function setDeviceRegistered(db, v) {
  try {
    const raw = await AsyncStorage.getItem(REG_KEY);
    let map = {};
    if (raw && raw !== '1') { try { map = JSON.parse(raw); } catch (e) {} }
    if (db) map[db] = !!v;
    await AsyncStorage.setItem(REG_KEY, JSON.stringify(map));
  } catch (e) {}
}
export async function clearDeviceRegistered() {
  try { await AsyncStorage.removeItem(REG_KEY); } catch (e) {}
}

// --- Kiosk auto-login: remember the staff login so the tablet opens
//     straight to the Service page next time (no login page). ---
export async function saveCredentials(login, password) {
  try { await AsyncStorage.setItem(CRED_KEY, JSON.stringify({ login, password })); } catch (e) {}
}
export async function loadCredentials() {
  try { const raw = await AsyncStorage.getItem(CRED_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export async function clearCredentials() {
  try { await AsyncStorage.removeItem(CRED_KEY); } catch (e) {}
}

// A LAN / on-premise address, as opposed to something on the internet.
// These are the hosts that essentially never have a valid TLS certificate: a
// self-hosted Odoo on the shop network is plain http, and Android rejects a
// self-signed certificate anyway. Guessing https for them is what made the
// connect screen fail with nothing more than "cannot reach the server".
function isLanHost(url) {
  const host = url.replace(/^https?:\/\//i, '').split('/')[0]
    .replace(/:\d+$/, '').toLowerCase();
  return (
    host === 'localhost'
    || /\.local$/.test(host)
    || !host.includes('.')                        // bare name, e.g. "shop-pc"
    || /^10\./.test(host)                         // private ranges
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^127\./.test(host)
    || /^169\.254\./.test(host)
  );
}

// Turn whatever the user typed into a clean base URL:
//  - trim spaces and a trailing slash
//  - if no scheme was given, GUESS one: http for a LAN address, https for a
//    public hostname.
// The guess used to be https always, which meant typing "10.0.0.5:8069" - the
// obvious thing to type for a shop server - produced a URL that could never
// connect. It is only a guess either way, so jsonrpc() in odoo.js retries with
// the other scheme when the transport fails and keeps whichever answers; this
// heuristic just means the first attempt is usually the right one.
export function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    u = (isLanHost(u) ? 'http://' : 'https://') + u;
  }
  return u.replace(/\/+$/, '');
}

// The same URL on the other scheme, for the retry described above.
export function swapScheme(url) {
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  if (/^https:\/\//i.test(url)) return url.replace(/^https:\/\//i, 'http://');
  return url;
}

export function getBaseUrl() {
  return current.baseUrl;
}

export function getDb() {
  return current.db;
}

// Set the server URL (normalized) for subsequent requests.
export function setBaseUrl(raw) {
  current.baseUrl = normalizeUrl(raw);
  return current.baseUrl;
}

// Set the chosen database for authenticate.
export function setDb(db) {
  current.db = (db || '').trim();
  return current.db;
}

// Load the last-used connection from storage (called on splash).
export async function loadSaved() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      current.baseUrl = saved.baseUrl || '';
      current.db = saved.db || '';
    }
  } catch (e) {}
  return { ...current };
}

// Persist the current connection after a successful login.
export async function saveConnection() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(current));
  } catch (e) {}
}
