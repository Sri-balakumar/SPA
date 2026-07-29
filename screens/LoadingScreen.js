// Brief splash: rehydrates the last-used connection (URL + DB) from storage,
// then hands control back to the app shell.
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { loadSaved, loadCredentials, clearCredentials, getBaseUrl, getDb, getDeviceId } from '../connection';
import { odooAuthenticate, odooLogout, deviceGate } from '../odoo';
import { COLORS } from '../theme';

export default function LoadingScreen({ onDone }) {
  useEffect(() => {
    let alive = true;
    (async () => {
      await loadSaved();
      // Kiosk auto-login: if the staff login was saved, open the Odoo session
      // silently so the tablet lands straight on the customer flow (no login page).
      let info = null;
      let blocked = false;
      try {
        const cred = await loadCredentials();
        if (cred && cred.login && getBaseUrl() && getDb()) {
          const auth = await odooAuthenticate(cred.login, cred.password);
          if (auth && auth.uid) {
            // Stolen-tablet protection: if the admin Blocked this device in Odoo's
            // Device Registry, refuse to open and forget the login.
            const gate = await deviceGate(await getDeviceId(), getDb());
            if (gate === 'blocked' || gate === 'unregistered') {
              blocked = true;
              await clearCredentials();
              await odooLogout();
            } else {
              info = auth;   // allowed (or couldn't check) → open
            }
          }
        }
      } catch (e) { info = null; }
      if (alive) {
        if (blocked) {
          Alert.alert('Device not authorized',
            'This device is not authorized to use the app. Please contact the administrator.');
        }
        onDone(info);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <Text style={s.brand}>Spa</Text>
      <Text style={s.tag}>Relax. Rejuvenate.</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: 22 }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.tealDeep, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: 1 },
  tag: { color: '#bfe3de', fontSize: 15, marginTop: 8, fontWeight: '600' },
});
