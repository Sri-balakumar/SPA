// DEVICE SETUP (receptionist, one time): connect this tablet to Odoo.
// Four fields — Server URL → Database (auto-fetched) → Username → Password.
// After this succeeds once, the tablet remembers it and goes straight to the
// customer flow on future launches.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, Modal, FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../SessionContext';
import { listDatabases, odooAuthenticate } from '../odoo';
import { setBaseUrl, setDb, saveConnection, getBaseUrl, getDb } from '../connection';
import { COLORS, SHADOW } from '../theme';
import Logo from '../components/Logo';
import Button from '../components/Button';

export default function ConnectionScreen() {
  const insets = useSafeAreaInsets();
  const { login: doLogin } = useSession();

  const [url, setUrl] = useState(getBaseUrl());
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState('');
  const [dbList, setDbList] = useState(null);
  const [dbManual, setDbManual] = useState(false);
  const [db, setDbLocal] = useState(getDb());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function connect() {
    if (!url.trim()) { Alert.alert('Missing URL', 'Please enter your Odoo server address.'); return; }
    const clean = setBaseUrl(url); setUrl(clean);
    setConnecting(true); setConnectMsg(''); setDbList(null); setDbManual(false);
    try {
      const dbs = await listDatabases();
      if (!Array.isArray(dbs) || dbs.length === 0) {
        setDbManual(true); setConnectMsg('Connected. Couldn’t list databases — type the database name.');
      } else {
        setDbList(dbs); setConnectMsg(`Connected — ${dbs.length} database${dbs.length > 1 ? 's' : ''} found.`);
        if (dbs.length === 1) { setDbLocal(dbs[0]); setDb(dbs[0]); }
      }
    } catch (e) {
      setDbManual(true); setConnectMsg(e.message || 'Could not fetch databases. Type the database name.');
    } finally { setConnecting(false); }
  }

  async function connectDevice() {
    if (!getBaseUrl()) { Alert.alert('Missing URL', 'Enter the server URL and tap Connect.'); return; }
    const chosenDb = dbManual ? db.trim() : db;
    if (!chosenDb) { Alert.alert('Missing database', 'Choose or type your database.'); return; }
    if (!username.trim() || !password) { Alert.alert('Missing details', 'Enter username and password.'); return; }
    setDb(chosenDb); setLoggingIn(true);
    try {
      const info = await odooAuthenticate(username.trim(), password);
      if (!info || !info.uid) { Alert.alert('Login failed', 'Wrong username or password.'); return; }
      await saveConnection();
      doLogin(info);
    } catch (e) {
      const denied = e.odoo?.data?.name === 'odoo.exceptions.AccessDenied' || /access denied/i.test(e.message || '');
      Alert.alert(denied ? 'Login failed' : 'Login error', denied ? 'Wrong username or password.' : (e.message || 'Could not log in.'));
    } finally { setLoggingIn(false); }
  }

  const canConnect = !!getBaseUrl() && (dbManual ? !!db.trim() : !!db);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={[s.header, { paddingTop: insets.top + 26 }]}>
          <Logo size="large" />
          <Text style={s.setup}>Device Setup · Reception</Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Server URL</Text>
          <View style={s.field}>
            <Text style={s.ic}>🌐</Text>
            <TextInput style={s.input} placeholder="http://192.168.1.5:8069" placeholderTextColor="#B4A9C4"
              autoCapitalize="none" autoCorrect={false} keyboardType="url" value={url}
              onChangeText={setUrl} onSubmitEditing={connect} returnKeyType="go" />
          </View>
          <Button title="Connect" variant="ghost" onPress={connect} loading={connecting} style={{ marginBottom: 6 }} />
          {!!connectMsg && <Text style={s.msg}>{connectMsg}</Text>}

          <Text style={s.label}>Database</Text>
          {dbManual ? (
            <View style={s.field}>
              <Text style={s.ic}>🗄️</Text>
              <TextInput style={s.input} placeholder="database name" placeholderTextColor="#B4A9C4"
                autoCapitalize="none" autoCorrect={false} value={db} onChangeText={setDbLocal} />
            </View>
          ) : (
            <TouchableOpacity style={s.field} activeOpacity={0.8}
              disabled={!dbList || dbList.length <= 1} onPress={() => setPickerOpen(true)}>
              <Text style={s.ic}>🗄️</Text>
              <Text style={[s.input, { paddingVertical: 13 }, !db && { color: '#B4A9C4' }]}>
                {db || (dbList ? 'Select database' : 'Connect to load databases')}
              </Text>
              {dbList && dbList.length > 1 && <Text style={s.chev}>▾</Text>}
            </TouchableOpacity>
          )}

          <Text style={s.label}>Username</Text>
          <View style={s.field}>
            <Text style={s.ic}>👤</Text>
            <TextInput style={s.input} placeholder="Please enter username" placeholderTextColor="#B4A9C4"
              autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
          </View>

          <Text style={s.label}>Password</Text>
          <View style={s.field}>
            <Text style={s.ic}>🔒</Text>
            <TextInput style={s.input} placeholder="Please enter password" placeholderTextColor="#B4A9C4"
              secureTextEntry={!showPw} value={password} onChangeText={setPassword} />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.eye}>{showPw ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <Button title="Connect Device" onPress={connectDevice} loading={loggingIn} disabled={!canConnect} style={{ marginTop: 8 }} />
        </View>
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Select database</Text>
            <FlatList data={dbList || []} keyExtractor={(i) => i} renderItem={({ item }) => (
              <TouchableOpacity style={s.row} onPress={() => { setDbLocal(item); setDb(item); setPickerOpen(false); }}>
                <Text style={[s.rowTxt, item === db && { color: COLORS.purple, fontWeight: '800' }]}>{item}</Text>
                {item === db && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
            )} />
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  header: { alignItems: 'center', paddingBottom: 26, backgroundColor: COLORS.lavenderSoft,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  setup: { marginTop: 12, fontSize: 12.5, fontWeight: '700', color: COLORS.purple, letterSpacing: 0.5 },
  card: { backgroundColor: '#fff', marginHorizontal: 18, marginTop: 18, borderRadius: 22, padding: 20, ...SHADOW },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginBottom: 7, marginTop: 4 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field,
    borderWidth: 1.4, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, marginBottom: 12 },
  ic: { fontSize: 15, marginRight: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: COLORS.ink },
  chev: { fontSize: 15, color: COLORS.muted, paddingLeft: 6 },
  eye: { fontSize: 16, paddingLeft: 6 },
  msg: { fontSize: 12.5, color: COLORS.muted, marginBottom: 8, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(46,36,64,0.45)', justifyContent: 'center', padding: 26 },
  sheet: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 8, maxHeight: '60%' },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, padding: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.line },
  rowTxt: { fontSize: 15, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
