// Brief splash: rehydrates the last-used connection (URL + DB) from storage,
// then hands control back to the app shell. Shows the Stretch & Go logo.
import React, { useEffect } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { loadSaved, loadCredentials, clearCredentials, getBaseUrl, getDb, getDeviceId } from '../connection';
import { odooAuthenticate, odooLogout, deviceGate } from '../odoo';
import { COLORS } from '../theme';

export default function LoadingScreen({ onDone }) {
  useEffect(() => {
    let alive = true;
    (async () => {
      const start = Date.now();   // keep the splash on screen for a moment (branding)
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
      // Show the splash for at least ~2 seconds so the logo is clearly visible.
      const MIN_SPLASH = 1000;
      const wait = MIN_SPLASH - (Date.now() - start);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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
      <StatusBar style="dark" />
      <Image source={require('../assets/stretchandgo_black.png')} style={s.logo} resizeMode="contain" />
      <ActivityIndicator color={COLORS.purple} style={s.spinner} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5EEFB', alignItems: 'center', justifyContent: 'center' },
  logo: { width: '70%', height: 150 },
  spinner: { marginTop: 20 },
});
