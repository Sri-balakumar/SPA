// DEVICE SETUP (reception, one time) — URL + device registration (no login).
// 1) Enter the server address → Connect (tested against /api/spa/therapies).
// 2) Register this tablet by scanning the QR shown on Odoo's Device Registry
//    (device_login_config). After that the tablet opens straight to the flow;
//    if an admin BLOCKS it in Odoo, it refuses to open (stolen-tablet lock).
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Modal,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useSession } from '../SessionContext';
import {
  setBaseUrl, saveConnection, getBaseUrl, setDb,
  getDeviceId, isDeviceRegistered, setDeviceRegistered, clearDeviceRegistered,
} from '../connection';
import { deviceRegisterFromScan } from '../odoo';
import { loadTherapies } from '../spaApi';
import { COLORS, SHADOW } from '../theme';

const SERIF = 'PlayfairDisplay_700Bold';
const DEFAULT_URL = 'https://occasions-preceding-enclosure-determines.trycloudflare.com';
const hit = { top: 10, bottom: 10, left: 10, right: 10 };

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const { login: doLogin } = useSession();
  const [url, setUrl] = useState(getBaseUrl() || DEFAULT_URL);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [connected, setConnected] = useState(false);   // URL tested OK → show device step
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function connect() {
    if (!url.trim()) { Alert.alert('Missing address', 'Please enter the server address.'); return; }
    setBaseUrl(url);
    setBusy(true); setMsg('Connecting…');
    try {
      const data = await loadTherapies();
      const n = (data.therapies || []).length;
      await saveConnection();
      setMsg(`Connected — ${n} service${n === 1 ? '' : 's'} found.`);
      // Already registered on any db → straight in. Otherwise show the device step.
      if (await isDeviceRegistered()) doLogin({ connected: true });
      else setConnected(true);
    } catch (e) {
      setMsg('');
      Alert.alert('Could not connect', e.message || 'Check the address and try again.');
    } finally { setBusy(false); }
  }

  async function openScanner() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r?.granted) { Alert.alert('Camera needed', 'Please allow camera access to scan the QR.'); return; }
    }
    setScanBusy(false); setScanning(true);
  }

  async function onScan({ data }) {
    if (scanBusy) return;
    setScanBusy(true);
    let p = null;
    try { p = JSON.parse(data); } catch (e) {}
    if (!p || p.a !== 'ng_reg' || !p.d) {
      setScanning(false); setScanBusy(false);
      Alert.alert('Invalid QR', 'This is not a NexGen device-registration QR code.');
      return;
    }
    try {
      const deviceId = await getDeviceId();
      const res = await deviceRegisterFromScan({
        deviceId, deviceName: Device.deviceName || Device.modelName || 'Spa Tablet', databaseName: p.d, baseUrl: getBaseUrl(), recordId: p.rid,
      });
      if (res && res.status === 'blocked') {
        setScanning(false); setScanBusy(false);
        Alert.alert('Device blocked', 'This device has been blocked by the administrator.');
        return;
      }
    } catch (e) { /* best-effort — still register locally so the tablet works */ }
    await setDeviceRegistered(p.d, true); setDb(p.d); await saveConnection();
    setScanning(false); setScanBusy(false);
    doLogin({ connected: true });
  }

  function skip() { doLogin({ connected: true }); }   // continue without the device lock

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <View style={[s.header, { paddingTop: insets.top + 30 }]}>
        <Image source={require('../assets/stretchandgo_black.png')} style={s.logo} resizeMode="contain" />
        <View style={s.deco}>
          <View style={s.line} />
          <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
          <View style={s.line} />
        </View>
        <Text style={s.setup}>Device Setup · Reception</Text>
      </View>

      <View style={s.body}>
        {!connected ? (
          <View style={s.card}>
            <Text style={s.title}>Connect this tablet</Text>
            <Text style={s.sub}>Enter your spa server address. You only do this once — no login needed.</Text>
            <Text style={s.label}>Server Address</Text>
            <View style={s.field}>
              <Text style={s.ic}>🌐</Text>
              <TextInput
                style={s.input}
                placeholder="https://your-spa-server"
                placeholderTextColor="#B4A9C4"
                autoCapitalize="none" autoCorrect={false} keyboardType="url"
                value={url} onChangeText={setUrl} onSubmitEditing={connect} returnKeyType="go"
              />
            </View>
            <TouchableOpacity style={[s.btn, busy && { opacity: 0.7 }]} onPress={connect} activeOpacity={0.9} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>Connect</Text>}
            </TouchableOpacity>
            {!!msg && <Text style={s.msg}>{msg}</Text>}
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.shield}><Ionicons name="shield-checkmark" size={30} color={COLORS.purple} /></View>
            <Text style={s.title}>Register this device</Text>
            <Text style={s.sub}>In Odoo, open Device Registry → New, then scan the QR code shown. This lets the admin block the tablet if it's lost or stolen.</Text>
            <TouchableOpacity style={s.btn} onPress={openScanner} activeOpacity={0.9}>
              <Ionicons name="qr-code-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.btnTxt}>Scan Device QR</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={skip} activeOpacity={0.8} style={{ marginTop: 14 }}>
              <Text style={s.skip}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Text style={[s.powered, { paddingBottom: insets.bottom + 14 }]}>Powered by NexGenn POS</Text>

      {/* Camera — scan the QR on Odoo's Device Registry */}
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
  header: { alignItems: 'center', paddingBottom: 20 },
  logo: { width: 190, height: 46 },
  deco: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  line: { width: 42, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  setup: { marginTop: 12, fontSize: 12, fontWeight: '800', color: COLORS.purple, letterSpacing: 0.6 },

  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 22, alignItems: 'center', ...SHADOW },
  shield: { width: 58, height: 58, borderRadius: 29, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontFamily: SERIF, fontSize: 22, color: COLORS.purpleDeep, textAlign: 'center' },
  sub: { fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 8, marginBottom: 18, lineHeight: 19 },
  label: { alignSelf: 'stretch', fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 7 },
  field: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14 },
  ic: { fontSize: 15, marginRight: 8 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.ink },
  btn: { alignSelf: 'stretch', flexDirection: 'row', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  msg: { fontSize: 12.5, color: COLORS.muted, textAlign: 'center', marginTop: 10 },
  skip: { fontSize: 13.5, fontWeight: '700', color: COLORS.muted },

  powered: { textAlign: 'center', fontSize: 11.5, color: COLORS.muted, fontWeight: '600' },

  camRoot: { flex: 1, backgroundColor: '#000' },
  camOverlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 24 },
  camTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  camSub: { color: '#D9C9EF', fontSize: 13.5, textAlign: 'center', marginTop: 8, marginBottom: 26 },
  camFrame: { width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: '#fff', backgroundColor: 'transparent', marginTop: 10 },
  camCancel: { marginTop: 'auto', borderWidth: 1.5, borderColor: '#fff', borderRadius: 999, paddingVertical: 13, paddingHorizontal: 40 },
  camCancelTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
