// CONNECT & LOGIN — the Odoo-style four-field login the manager asked for:
//   1) Server URL   2) Database (auto-fetched from the server)   3) Username   4) Password
// Type the URL → once typing settles the app calls Odoo's /web/database/list on
// its own and fills the Database dropdown (no Connect button). Then username +
// password authenticate over JSON-RPC and open a real Odoo session.
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useSession } from '../SessionContext';
import { listDatabases, odooAuthenticate, deviceGate, odooLogout, odooCallKw } from '../odoo';
import {
  setBaseUrl, setDb, saveConnection, getBaseUrl, getDb,
  getDeviceId, isDeviceRegistered, setDeviceRegistered, clearDeviceRegistered, saveCredentials,
} from '../connection';
import { COLORS, SHADOW } from '../theme';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login: doLogin } = useSession();

  // Field 1 — server URL (prefilled from the last saved connection).
  const [url, setUrl] = useState(getBaseUrl());
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState('');   // success info under the URL field
  const [urlError, setUrlError] = useState('');       // bad URL → red border + red message

  // Field 2 — database.
  const [dbList, setDbList] = useState(null);          // array once fetched, else null
  const [dbManual, setDbManual] = useState(false);     // true → user types the DB name
  const [db, setDbState] = useState(getDb());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fields 3 & 4 — credentials.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  // Device registration (device_login_config): this tablet must be approved.
  const [registered, setRegistered] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(false); // true → after scan, continue login
  const [permission, requestPermission] = useCameraPermissions();
  const scanRecordRef = useRef(null); // record_id from the scanned QR (written to Odoo after login)
  const authInfoRef = useRef(null);   // session_info held between auth and the QR scan

  // In-app alert styled like the rest of the app, in place of the OS popup.
  // tone: 'error' (red) | 'success' (green) | 'info' (purple).
  const [alertBox, setAlertBox] = useState(null);   // { title, message, tone }
  function showAlert(title, message, tone = 'error') {
    setAlertBox({ title, message, tone });
  }

  useEffect(() => {
    (async () => {
      await getDeviceId();                       // create this tablet's UUID once
      setRegistered(await isDeviceRegistered());
    })();
  }, []);

  // Open the camera to scan the QR shown on Odoo's Device Registry.
  // Returns true if the camera opened, false otherwise (e.g. permission denied).
  async function openScanner() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r?.granted) { showAlert('Camera needed', 'Please allow camera access to scan the QR.'); return false; }
    }
    setScanBusy(false);
    setScanning(true);
    return true;
  }

  // Forget this device's registration → next login re-opens the QR scanner.
  async function resetDevice() {
    await clearDeviceRegistered();
    setRegistered(false);
    showAlert('Device reset', 'This device is no longer registered. Tap Scan & Login to scan the QR again.', 'info');
  }

  // A QR was scanned → register this device on Odoo.
  async function onScan({ data }) {
    if (scanBusy) return;
    setScanBusy(true);
    let payload = null;
    try { payload = JSON.parse(data); } catch (e) {}
    if (!payload || payload.a !== 'ng_reg' || !payload.d) {
      setScanning(false); setScanBusy(false);
      showAlert('Invalid QR', 'This is not a NexGen device registration QR code.');
      return;
    }
    // Remember which pre-registered record this QR belongs to. The device is
    // written to Odoo AFTER login (authenticated call_kw in registerDeviceNow),
    // which works even on multi-database servers where the pre-login route can't.
    scanRecordRef.current = payload.rid || null;
    await setDeviceRegistered(payload.d, true); setRegistered(true);
    setScanning(false); setScanBusy(false);
    if (pendingLogin) { setPendingLogin(false); doAuth(); }
    else { showAlert('Ready', 'Tap Scan & Login to finish registering this device.', 'success'); }
  }

  // Auto-fetch the database list as soon as the URL settles — no Connect button.
  // Debounced so we fire once the user stops typing, not on every keystroke.
  // A stale request can't clobber a newer one: `cancelled` gates every setState.
  useEffect(() => {
    const raw = url.trim();
    if (!raw) {
      setDbList(null); setDbManual(false);
      setConnectMsg(''); setUrlError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBaseUrl(raw);            // normalize + store (not reflected back into the
                                  // field — that would retrigger this effect)
      setConnecting(true); setConnectMsg(''); setUrlError('');
      setDbList(null); setDbManual(false);
      try {
        const dbs = await listDatabases();
        if (cancelled) return;
        if (!Array.isArray(dbs) || dbs.length === 0) {
          // Reachable, but list_db is off or filtered → let the user type the name.
          setDbManual(true);
          setConnectMsg('Connected — couldn’t list databases, type the name below.');
        } else {
          setDbList(dbs);
          setConnectMsg(`${dbs.length} database${dbs.length > 1 ? 's' : ''} found.`);
          // Keep a still-valid saved pick; otherwise auto-select a lone database.
          setDbState((prev) => {
            if (prev && dbs.includes(prev)) { setDb(prev); return prev; }
            if (dbs.length === 1) { setDb(dbs[0]); return dbs[0]; }
            setDb(''); return '';
          });
        }
      } catch (e) {
        if (cancelled) return;
        if (e.odoo) {
          // The server answered as Odoo but refused to list databases — almost
          // always `list_db = False`, which is normal on production servers.
          // The URL is CORRECT, so no red line: just let the user type the name.
          setDbManual(true);
          setConnectMsg('Connected — couldn’t list databases, type the name below.');
        } else {
          // No JSON-RPC reply at all: unreachable host, or not an Odoo server.
          setUrlError(e.message || 'Could not reach this server. Check the address.');
          setDbList(null); setDbManual(false);
          setDbState(''); setDb('');
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url]);

  function chooseDb(name) {
    setDbState(name);
    setDb(name);
    setPickerOpen(false);
  }

  // Tap "Scan & Login" → STEP 1: prove the credentials against Odoo first.
  // The camera only opens once Odoo has accepted BOTH the username and the
  // password. Odoo raises the same AccessDenied for an unknown user as for a
  // bad password, so either one exits here and never reaches the QR scanner.
  async function login() {
    if (!getBaseUrl()) { showAlert('Missing URL', 'Enter the server URL first.'); return; }
    const chosenDb = dbManual ? db.trim() : db;
    if (!chosenDb) { showAlert('Missing database', 'Choose or type your database.'); return; }
    if (!username.trim() || !password) {
      showAlert('Missing details', 'Please enter your username and password.');
      return;
    }
    setDb(chosenDb);

    setLoggingIn(true);
    let info = null;
    try {
      info = await odooAuthenticate(username.trim(), password);
    } catch (e) {
      setLoggingIn(false);
      // Odoo reports bad credentials as an AccessDenied error, not uid:false.
      const denied = e.odoo?.data?.name === 'odoo.exceptions.AccessDenied'
        || /access denied/i.test(e.message || '');
      if (denied) showAlert('Login failed', 'Wrong username or password.');
      else showAlert('Login error', e.message || 'Could not log in.');
      return;                                   // no scanner
    }
    if (!info || !info.uid) {
      setLoggingIn(false);
      showAlert('Login failed', 'Wrong username or password.');
      return;                                   // no scanner
    }

    // Credentials accepted.
    authInfoRef.current = info;

    // Registration is a ONE-TIME step per database. If this tablet already
    // registered on the chosen db, skip the QR entirely and finish the login.
    // Safe even if the flag is stale: doAuth() still runs the Odoo device gate,
    // which re-registers or denies as needed.
    if (await isDeviceRegistered(getDb())) {
      setRegistered(true);
      doAuth();
      return;
    }

    // First time on this database → scan the Device Registry QR.
    setLoggingIn(false);
    setPendingLogin(true);
    const opened = await openScanner();
    if (!opened) setPendingLogin(false);
  }

  // Register/activate this device in Odoo using the LOGGED-IN session (call_kw).
  // This works on multi-database servers, where the pre-login scan route cannot.
  // Fills the scanned pre-registered record if we have one, else finds/creates one.
  async function registerDeviceNow(dId) {
    try {
      const dbName = getDb();
      const name = Device.deviceName || Device.modelName || 'Spa Tablet';
      const vals = {
        device_id: dId, mac_address: dId, device_name: name,
        database_name: dbName, status: 'active', base_url: getBaseUrl(),
      };
      const found = await odooCallKw('device.registry', 'search', [[['device_id', '=', dId]]], { limit: 1 });
      if (found && found.length) {
        await odooCallKw('device.registry', 'write', [found, vals]);
      } else if (scanRecordRef.current) {
        await odooCallKw('device.registry', 'write', [[scanRecordRef.current], vals]);
      } else {
        await odooCallKw('device.registry', 'create', [vals]);
      }
      await setDeviceRegistered(dbName, true);
      return true;
    } catch (e) {
      return false;
    }
  }

  // STEP 2 — runs after the QR scan, on the session login() already opened.
  // Credentials are known-good by this point; this is purely the device gate.
  async function doAuth() {
    const info = authInfoRef.current;
    if (!info || !info.uid) {
      showAlert('Login failed', 'Please enter your details and try again.');
      return;
    }
    setLoggingIn(true);
    try {
      // Security: only devices registered in Odoo's Device Registry may log in.
      const dId = await getDeviceId();
      let gate = await deviceGate(dId, getDb());
      if (gate === 'blocked') {
        await odooLogout();
        showAlert('Device blocked', 'This device has been blocked by the administrator. Please contact them.');
        return;
      }
      if (gate === 'unregistered') {
        // Auto-register now using the authenticated session (works on multi-DB servers).
        const ok = await registerDeviceNow(dId);
        if (ok) gate = await deviceGate(dId, getDb());
      }
      if (gate === 'unregistered') {
        await odooLogout();
        showAlert('Device not authorized',
          'This device is not registered, so it cannot log in.\n\nDevice ID:\n' + dId +
          '\n\nAsk your admin to add this Device ID in the Device Registry.');
        return;
      }
      // The gate allowed this device, so mark it registered for THIS database.
      // Must be keyed on getDb(): registerDeviceNow() only runs when the gate
      // said 'unregistered', and onScan() keys off the QR's own db name — so
      // without this, an already-approved tablet never sets the flag and would
      // be asked to scan on every single login.
      await setDeviceRegistered(getDb(), true);
      setRegistered(true);

      await saveConnection();   // remember URL + DB for next launch
      await saveCredentials(username.trim(), password);  // kiosk: open straight to services next time
      doLogin(info);
    } catch (e) {
      // Credentials were already accepted in login(), so anything here is a
      // registry/network failure rather than a bad password.
      showAlert('Login error', e.message || 'Could not complete login.');
    } finally {
      setLoggingIn(false);
    }
  }

  const canLogin = !!getBaseUrl() && (dbManual ? !!db.trim() : !!db);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView
        // Centred, then biased upward: the extra bottom padding pulls the
        // logo + card block above the true middle of the screen.
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header — NexGenn logo (long-press to reset the device) */}
        <View style={[s.header, { paddingTop: insets.top + 24 }]}>
          <TouchableOpacity onLongPress={resetDevice} delayLongPress={1000} activeOpacity={1}>
            <Image source={require('../assets/nexgen_dark.png')} style={s.logo} resizeMode="contain" />
          </TouchableOpacity>

          {/* three dots below */}
          <View style={s.dotsRow}>
            <View style={s.dot} />
            <View style={s.dot} />
            <View style={s.dot} />
          </View>
        </View>

        {/* Card */}
        <View style={s.card}>
          {/* 1 — Server URL (databases load automatically once typing settles) */}
          <Text style={s.label}>Server URL</Text>
          <View style={[s.field, !!urlError && s.fieldError]}>
            <Text style={s.icon}>🌐</Text>
            <TextInput
              style={s.input}
              placeholder="http://192.168.1.5:8069"
              placeholderTextColor="#B4A9C4"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={url}
              onChangeText={setUrl}
              returnKeyType="done"
            />
            {connecting && <ActivityIndicator color={COLORS.purple} style={{ marginLeft: 6 }} />}
          </View>
          {!!urlError && <Text style={s.errTxt}>{urlError}</Text>}
          {!urlError && !!connectMsg && <Text style={s.okTxt}>{connectMsg}</Text>}

          {/* 2 — Database */}
          <Text style={s.label}>Database</Text>
          {dbManual ? (
            <View style={s.field}>
              <Text style={s.icon}>🗄️</Text>
              <TextInput
                style={s.input}
                placeholder="database name"
                placeholderTextColor="#B4A9C4"
                autoCapitalize="none"
                autoCorrect={false}
                value={db}
                onChangeText={(v) => { setDbState(v); }}
              />
            </View>
          ) : (
            <TouchableOpacity
              style={s.field}
              activeOpacity={0.8}
              disabled={!dbList || dbList.length === 0}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={s.icon}>🗄️</Text>
              <Text style={[s.input, { paddingVertical: 15 }, !db && { color: '#B4A9C4' }]}>
                {db || 'Select your database'}
              </Text>
              {!!dbList && dbList.length > 0 && <Text style={s.chev}>▾</Text>}
            </TouchableOpacity>
          )}

          {/* 3 — Username */}
          <Text style={s.label}>Username</Text>
          <View style={s.field}>
            <Text style={s.icon}>👤</Text>
            <TextInput
              style={s.input}
              placeholder="Please enter username"
              placeholderTextColor="#B4A9C4"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
          </View>

          {/* 4 — Password */}
          <Text style={s.label}>Password</Text>
          <View style={s.field}>
            <Text style={s.icon}>🔒</Text>
            <TextInput
              style={s.input}
              placeholder="Please enter password"
              placeholderTextColor="#B4A9C4"
              secureTextEntry={!showPw}
              value={password}
              onChangeText={setPassword}
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.eye}>{showPw ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.loginBtn, (loggingIn || !canLogin) && { opacity: 0.6 }]}
            onPress={login}
            activeOpacity={0.9}
            disabled={loggingIn || !canLogin}
          >
            {loggingIn ? <ActivityIndicator color="#fff" /> : <Text style={s.loginTxt}>Scan &amp; Login</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Database picker (shown when the server returns more than one DB) */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Select database</Text>
            <FlatList
              data={dbList || []}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.dbRow} onPress={() => chooseDb(item)}>
                  <Text style={[s.dbRowTxt, item === db && { color: COLORS.purple, fontWeight: '800' }]}>{item}</Text>
                  {item === db && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* In-app alert — the app-styled replacement for the OS popup */}
      <Modal visible={!!alertBox} transparent animationType="fade" onRequestClose={() => setAlertBox(null)}>
        <View style={s.alertBackdrop}>
          <View style={s.alertCard}>
            <View style={[s.alertIcon, alertBox?.tone === 'success' && { backgroundColor: '#E6F5EE' },
                                       alertBox?.tone === 'error' && { backgroundColor: '#FBE9E9' }]}>
              <Ionicons
                name={alertBox?.tone === 'success' ? 'checkmark-circle'
                    : alertBox?.tone === 'info' ? 'information-circle' : 'alert-circle'}
                size={34}
                color={alertBox?.tone === 'success' ? COLORS.green
                     : alertBox?.tone === 'info' ? COLORS.purple : COLORS.red}
              />
            </View>
            <Text style={s.alertTitle}>{alertBox?.title}</Text>
            <Text style={s.alertMsg}>{alertBox?.message}</Text>
            <TouchableOpacity style={s.alertBtn} activeOpacity={0.9} onPress={() => setAlertBox(null)}>
              <Text style={s.alertBtnTxt}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Camera — scan the QR shown on Odoo's Device Registry */}
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={s.camRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanBusy ? undefined : onScan}
          />
          <View style={[s.camOverlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
            <Text style={s.camTitle}>Scan Device QR</Text>
            <Text style={s.camSub}>Odoo → Device Registry → New → point the camera at the QR</Text>
            <View style={s.camFrame} />
            {scanBusy && <ActivityIndicator color="#fff" size="large" style={{ marginTop: 20 }} />}
            <TouchableOpacity style={s.camCancel} onPress={() => setScanning(false)} activeOpacity={0.85}>
              <Text style={s.camCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  header: {
    paddingHorizontal: 24, paddingBottom: 22, alignItems: 'center',
  },
  logo: { width: 320, height: 68, marginBottom: 14 },

  dotsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#C9B6E4', marginHorizontal: 4 },

  card: {
    backgroundColor: '#fff', alignSelf: 'center', width: '92%', maxWidth: 520,
    marginTop: 6, marginBottom: 24, borderRadius: 24,
    padding: 22, paddingTop: 22, ...SHADOW,
  },
  label: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 7, marginTop: 4 },

  field: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.line,
    borderRadius: 14, paddingHorizontal: 14, marginBottom: 12, backgroundColor: COLORS.field,
  },
  icon: { fontSize: 16, marginRight: 8 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15.5, color: COLORS.ink },
  chev: { fontSize: 16, color: COLORS.muted, paddingLeft: 6 },
  eye: { fontSize: 17, paddingLeft: 6 },

  fieldError: { borderColor: COLORS.red },
  errTxt: { fontSize: 12.5, color: COLORS.red, marginTop: -6, marginBottom: 10 },
  okTxt: { fontSize: 12.5, color: COLORS.green, marginTop: -6, marginBottom: 10 },

  serverRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field,
    borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, marginTop: 2,
  },
  serverDb: { fontSize: 15, fontWeight: '800', color: COLORS.ink },
  serverUrl: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  changeLink: { fontSize: 13.5, fontWeight: '800', color: COLORS.purple },

  loginBtn: { backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  loginTxt: { color: '#fff', fontSize: 18, fontWeight: '800' },
  resetLink: { fontSize: 13, fontWeight: '700', color: COLORS.muted },

  deviceRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field,
    borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
  },
  deviceStatus: { fontSize: 14.5, fontWeight: '800', color: COLORS.ink },
  deviceHint: { fontSize: 11.5, color: COLORS.muted, marginTop: 1 },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.purple,
    borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12,
  },
  scanBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },

  camRoot: { flex: 1, backgroundColor: '#000' },
  camOverlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 24 },
  camTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  camSub: { color: '#D9C9EF', fontSize: 13.5, textAlign: 'center', marginTop: 8, marginBottom: 26 },
  camFrame: {
    width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: '#fff',
    backgroundColor: 'transparent', marginTop: 10,
  },
  camCancel: {
    marginTop: 'auto', borderWidth: 1.5, borderColor: '#fff', borderRadius: 999,
    paddingVertical: 13, paddingHorizontal: 40,
  },
  camCancelTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },

  alertBackdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  alertCard: {
    backgroundColor: '#fff', borderRadius: 24, paddingVertical: 26, paddingHorizontal: 24,
    width: '100%', maxWidth: 380, alignItems: 'center', ...SHADOW,
  },
  alertIcon: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.lavenderSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  alertTitle: {
    fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22,
    color: COLORS.purpleDeep, textAlign: 'center',
  },
  alertMsg: {
    fontSize: 14, color: COLORS.muted, textAlign: 'center',
    marginTop: 8, lineHeight: 20,
  },
  alertBtn: {
    backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 13,
    alignSelf: 'stretch', alignItems: 'center', marginTop: 20,
  },
  alertBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 6,
    width: '100%', maxWidth: 320, maxHeight: '60%', overflow: 'hidden',
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink, padding: 16, paddingBottom: 8 },
  dbRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  dbRowTxt: { fontSize: 15.5, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
