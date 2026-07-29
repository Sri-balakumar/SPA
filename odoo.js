// ============================================================
//  Odoo JSON-RPC client — the "bridge" between the app and Odoo.
//  The app authenticates against Odoo (same as the website) to get a
//  real session, then reads/writes models via call_kw. Odoo's record
//  rules make sure each user only sees the data they're allowed to.
//
//  Session note: Odoo sets a `session_id` cookie on authenticate;
//  React Native's fetch keeps cookies in a shared native store, so
//  later call_kw requests carry it automatically (we also pass
//  credentials:'include').
//
//  Unlike a hardcoded config, the server URL + database come from the
//  runtime `connection` store — the user types them on the login screen.
// ============================================================
import { getBaseUrl, getDb } from './connection';

async function jsonrpc(path, params) {
  const base = getBaseUrl();
  if (!base) throw new Error('Please enter the server URL first.');

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
    });
  } catch (e) {
    throw new Error('Cannot reach the server. Check the URL and your connection.');
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('The server returned an unexpected response. Is this an Odoo server URL?');
  }
  if (data.error) {
    const msg = data.error?.data?.message || data.error?.message || 'Server error.';
    const err = new Error(msg);
    err.odoo = data.error;
    throw err;
  }
  return data.result;
}

// List the databases on the server so the app can auto-fill the DB field.
// Returns an array of names. Only works when the server has `list_db` enabled;
// otherwise this throws and the UI falls back to a manual DB text field.
export function listDatabases() {
  return jsonrpc('/web/database/list', {});
}

// Real Odoo login → establishes the session. Uses the database chosen on the
// login screen. Returns session_info (check `uid` is truthy) or throws on error.
export function odooAuthenticate(login, password) {
  return jsonrpc('/web/session/authenticate', { db: getDb(), login, password });
}

// Call any model method as the logged-in user (record rules apply). For future
// Spa data screens (services, bookings, etc.).
export function odooCallKw(model, method, args = [], kwargs = {}) {
  return jsonrpc('/web/dataset/call_kw', { model, method, args, kwargs });
}

// Who am I right now (or not logged in).
export function odooSessionInfo() {
  return jsonrpc('/web/session/get_session_info', {}).catch(() => null);
}

// End the Odoo session (used on logout).
export function odooLogout() {
  return jsonrpc('/web/session/destroy', {}).catch(() => {});
}

// ============================================================
//  Device registration (the `device_login_config` Odoo module).
//  Only devices pre-approved by an admin may configure the app.
//  QR payload from Odoo: {"a":"ng_reg","d":"<db>","rid":<record_id>}
// ============================================================

// Check whether this device (its UUID) is pre-registered/active.
// → { status:'found', device_status:'pre_registered'|'active'|'blocked' } or { status:'not_found' }
export function deviceLookup(deviceUuid, databaseName) {
  return jsonrpc('/device/lookup', { mac_address: deviceUuid, database_name: databaseName });
}

// Link this app's UUID to a pre-registered record and mark it Active.
export function deviceActivate(deviceUuid, databaseName, deviceId, baseUrl) {
  return jsonrpc('/device/activate', {
    mac_address: deviceUuid, database_name: databaseName, device_id: deviceId, base_url: baseUrl,
  });
}

// Security gate: after login, confirm this device is still allowed (admin can
// Block or remove it from the Device Registry — e.g. if the tablet is stolen).
// Reads device.registry.status directly (internal users have read access).
//   → 'allowed'  : status active/pre_registered (open the app)
//   → 'blocked'  : status blocked, OR the record was removed → revoked
//   → 'unknown'  : couldn't check (network/permission) → don't lock out a kiosk
export async function deviceGate(deviceUuid, databaseName) {
  try {
    const rows = await odooCallKw('device.registry', 'search_read',
      [[['device_id', '=', deviceUuid], ['database_name', '=', databaseName]]],
      { fields: ['status'], limit: 1 });
    // Only devices that are in the Device Registry may log in.
    if (!rows || !rows.length) return 'unregistered';       // not registered → deny
    return rows[0].status === 'blocked' ? 'blocked' : 'allowed';
  } catch (e) {
    return 'unknown';                                       // transient error → allow, don't brick a legit tablet
  }
}

// Register by scanning the QR shown on the Odoo Device Registry form. The loaded
// controller (main.py) exposes /device/register-from-scan; record_id (from the QR)
// updates that specific Pending row. Returns { status: 'registered'|'already_registered'|'blocked'|'error' }.
export function deviceRegisterFromScan({ deviceId, deviceName, databaseName, baseUrl, recordId }) {
  return jsonrpc('/device/register-from-scan', {
    device_id: deviceId, device_name: deviceName,
    database_name: databaseName, base_url: baseUrl, record_id: recordId,
  });
}
