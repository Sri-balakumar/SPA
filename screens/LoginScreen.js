// CONNECT & LOGIN — the Odoo-style four-field login the manager asked for:
//   1) Server URL   2) Database (auto-fetched from the server)   3) Username   4) Password
// Enter the URL and tap Connect → the app calls Odoo's /web/database/list and
// fills the Database field (a dropdown when there are several). Then username +
// password authenticate over JSON-RPC and open a real Odoo session.
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Image,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  const [connectMsg, setConnectMsg] = useState('');   // info/error under the URL field

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
      if (!r?.granted) { Alert.alert('Camera needed', 'Please allow camera access to scan the QR.'); return false; }
    }
    setScanBusy(false);
    setScanning(true);
    return true;
  }

  // Forget this device's registration → next Login re-opens the QR scanner.
  async function resetDevice() {
    await clearDeviceRegistered();
    setRegistered(false);
    Alert.alert('Device reset', 'This device is no longer registered. Tap Login to scan the QR again.');
  }

  // A QR was scanned → register this device on Odoo.
  async function onScan({ data }) {
    if (scanBusy) return;
    setScanBusy(true);
    let payload = null;
    try { payload = JSON.parse(data); } catch (e) {}
    if (!payload || payload.a !== 'ng_reg' || !payload.d) {
      setScanning(false); setScanBusy(false);
      Alert.alert('Invalid QR', 'This is not a NexGen device registration QR code.');
      return;
    }
    // Remember which pre-registered record this QR belongs to. The device is
    // written to Odoo AFTER login (authenticated call_kw in registerDeviceNow),
    // which works even on multi-database servers where the pre-login route can't.
    scanRecordRef.current = payload.rid || null;
    await setDeviceRegistered(payload.d, true); setRegistered(true);
    setScanning(false); setScanBusy(false);
    if (pendingLogin) { setPendingLogin(false); doAuth(); }
    else { Alert.alert('Ready ✅', 'Tap Login to finish registering this device.'); }
  }

  // Tap "Connect" → normalize the URL and ask Odoo for its database list.
  async function connect() {
    if (!url.trim()) {
      Alert.alert('Missing URL', 'Please enter your Odoo server address.');
      return;
    }
    const clean = setBaseUrl(url);   // normalize + store; reflect it back into the field
    setUrl(clean);
    setConnecting(true);
    setConnectMsg('');
    setDbList(null);
    setDbManual(false);
    try {
      const dbs = await listDatabases();
      if (!Array.isArray(dbs) || dbs.length === 0) {
        // Server didn't list any databases (list_db off, or filtered) → let the user type it.
        setDbManual(true);
        setConnectMsg('Connected. Couldn’t list databases — type the database name.');
      } else {
        setDbList(dbs);
        setConnectMsg(`Connected — ${dbs.length} database${dbs.length > 1 ? 's' : ''} found.`);
        if (dbs.length === 1) {
          setDbState(dbs[0]);
          setDb(dbs[0]);
        }
      }
    } catch (e) {
      // Reachability error, or list_db disabled → allow manual DB entry as a fallback.
      setDbManual(true);
      setConnectMsg(e.message || 'Could not fetch databases. Type the database name.');
    } finally {
      setConnecting(false);
    }
  }

  function chooseDb(name) {
    setDbState(name);
    setDb(name);
    setPickerOpen(false);
  }

  // Tap "Login" → if the device isn't approved yet, open the QR scanner first;
  // after a successful scan it continues to authenticate automatically.
  async function login() {
    if (!getBaseUrl()) { Alert.alert('Missing URL', 'Enter the server URL and tap Connect.'); return; }
    const chosenDb = dbManual ? db.trim() : db;
    if (!chosenDb) { Alert.alert('Missing database', 'Choose or type your database.'); return; }
    if (!username.trim() || !password) {
      Alert.alert('Missing details', 'Please enter your username and password.');
      return;
    }
    setDb(chosenDb);

    // Always scan the device registration QR after entering the details.
    // After a successful scan, onScan() continues to authenticate + register.
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

  // The actual Odoo authentication (runs directly, or after the device is approved).
  async function doAuth() {
    setLoggingIn(true);
    try {
      const info = await odooAuthenticate(username.trim(), password);
      if (!info || !info.uid) {
        Alert.alert('Login failed', 'Wrong username or password.');
        return;
      }
      // Security: only devices registered in Odoo's Device Registry may log in.
      const dId = await getDeviceId();
      let gate = await deviceGate(dId, getDb());
      if (gate === 'blocked') {
        await odooLogout();
        Alert.alert('Device blocked', 'This device has been blocked by the administrator. Please contact them.');
        return;
      }
      if (gate === 'unregistered') {
        // Auto-register now using the authenticated session (works on multi-DB servers).
        const ok = await registerDeviceNow(dId);
        if (ok) gate = await deviceGate(dId, getDb());
      }
      if (gate === 'unregistered') {
        await odooLogout();
        Alert.alert('Device not authorized',
          'This device is not registered, so it cannot log in.\n\nDevice ID:\n' + dId +
          '\n\nAsk your admin to add this Device ID in the Device Registry.');
        return;
      }
      await saveConnection();   // remember URL + DB for next launch
      await saveCredentials(username.trim(), password);  // kiosk: open straight to services next time
      doLogin(info);
    } catch (e) {
      // Odoo returns wrong credentials as an AccessDenied error, not a uid:false result.
      const denied = e.odoo?.data?.name === 'odoo.exceptions.AccessDenied'
        || /access denied/i.test(e.message || '');
      if (denied) Alert.alert('Login failed', 'Wrong username or password.');
      else Alert.alert('Login error', e.message || 'Could not log in.');
    } finally {
      setLoggingIn(false);
    }
  }

  const canLogin = !!getBaseUrl() && (dbManual ? !!db.trim() : !!db);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* Header — logo + decorative serif "Spa" */}
        <View style={[s.header, { paddingTop: insets.top + 24 }]}>
          <Image source={require('../assets/nexgen_dark.png')} style={s.logo} resizeMode="contain" />

          {/* small flower + dots above the title */}
          <View style={s.topDeco}>
            <View style={s.tinyDot} />
            <MaterialCommunityIcons name="flower-tulip" size={20} color={COLORS.purple} style={{ marginHorizontal: 6 }} />
            <View style={s.tinyDot} />
          </View>

          {/* Client brand — Stretch & Go (long-press to reset the device) */}
          <TouchableOpacity onLongPress={resetDevice} delayLongPress={1000} activeOpacity={1}>
            <Image source={require('../assets/stretchandgo_black.png')} style={s.brandLogo} resizeMode="contain" />
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
          {/* 1 — Server URL */}
          <Text style={s.label}>Server URL</Text>
          <View style={s.field}>
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
              onSubmitEditing={connect}
              returnKeyType="go"
            />
          </View>
          <TouchableOpacity
            style={[s.connectBtn, connecting && { opacity: 0.7 }]}
            onPress={connect}
            activeOpacity={0.9}
            disabled={connecting}
          >
            {connecting ? <ActivityIndicator color={COLORS.purple} /> : <Text style={s.connectTxt}>Connect</Text>}
          </TouchableOpacity>
          {!!connectMsg && <Text style={s.msg}>{connectMsg}</Text>}

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
              disabled={!dbList || dbList.length <= 1}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={s.icon}>🗄️</Text>
              <Text style={[s.input, { paddingVertical: 15 }, !db && { color: '#B4A9C4' }]}>
                {db || (dbList ? 'Select database' : 'Connect to load databases')}
              </Text>
              {dbList && dbList.length > 1 && <Text style={s.chev}>▾</Text>}
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
            {loggingIn ? <ActivityIndicator color="#fff" /> : <Text style={s.loginTxt}>Login</Text>}
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
  logo: { width: 260, height: 54, marginBottom: 14 },

  topDeco: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  tinyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#C9B6E4' },

  spaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dLine: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 10 },
  spaTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 52, color: COLORS.purpleDeep, lineHeight: 62 },
  brandLogo: { width: 250, height: 58, marginVertical: 8 },

  dotsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#C9B6E4', marginHorizontal: 4 },

  card: {
    backgroundColor: '#fff', marginHorizontal: 18, marginTop: 6, marginBottom: 24, borderRadius: 24,
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

  connectBtn: {
    borderWidth: 1.5, borderColor: COLORS.purple, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', marginBottom: 6,
  },
  connectTxt: { color: COLORS.purple, fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 12.5, color: COLORS.muted, marginBottom: 8, marginTop: 2 },

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

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 28 },
  sheet: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 8, maxHeight: '60%' },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink, padding: 16, paddingBottom: 8 },
  dbRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  dbRowTxt: { fontSize: 15.5, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
