// Placeholder Home — confirms the JSON-RPC connection is live and shows who's
// logged in. Real Spa features (services, therapists, bookings) go here later.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../SessionContext';
import { getBaseUrl } from '../connection';
import { COLORS, SHADOW } from '../theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useSession();

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={[s.header, { paddingTop: insets.top + 30 }]}>
        <Text style={s.brand}>Spa</Text>
        <Text style={s.tag}>Connected</Text>
      </View>

      <View style={s.card}>
        <Text style={s.hi}>Welcome{user?.name ? `, ${user.name}` : ''} 👋</Text>
        <Row label="Server" value={getBaseUrl()} />
        <Row label="Database" value={user?.db} />
        <Row label="User" value={user?.username || user?.name} />
        <Row label="User ID" value={user?.uid != null ? String(user.uid) : ''} />

        <TouchableOpacity style={s.logoutBtn} onPress={logout} activeOpacity={0.9}>
          <Text style={s.logoutTxt}>Log out</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.note}>Spa features coming soon.</Text>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    backgroundColor: COLORS.tealDeep, paddingHorizontal: 24, paddingBottom: 46,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
  },
  brand: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  tag: { color: '#bfe3de', fontSize: 14, marginTop: 6, fontWeight: '600' },

  card: {
    backgroundColor: '#fff', marginHorizontal: 18, marginTop: -28, borderRadius: 24,
    padding: 22, ...SHADOW,
  },
  hi: { fontSize: 19, fontWeight: '800', color: COLORS.ink, marginBottom: 16 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  rowLabel: { fontSize: 13.5, fontWeight: '700', color: COLORS.muted },
  rowValue: { fontSize: 14.5, color: COLORS.ink, flexShrink: 1, marginLeft: 12, fontWeight: '600' },

  logoutBtn: {
    marginTop: 20, borderWidth: 1.5, borderColor: COLORS.red, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  logoutTxt: { color: COLORS.red, fontSize: 15, fontWeight: '800' },

  note: { textAlign: 'center', color: COLORS.muted, marginTop: 24, fontSize: 13 },
});
