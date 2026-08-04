// Screen 8 — Thank You / Submission Success. Confirms the request went to
// reception and shows the selected package summary (matches the mockup finale).
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW } from '../../theme';
import Button from '../../components/Button';
import LangButton from '../../components/LangButton';
import { useLang } from '../../LanguageContext';

export default function SuccessScreen({ form, onHome }) {
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const pkg = form.package;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      {/* No header on this screen, so the switcher sits on its own top row. */}
      <View style={s.topBar}>
        <LangButton />
      </View>
      <ScrollView contentContainerStyle={s.center}>
        <View style={s.checkWrap}>
          <Ionicons name="checkmark" size={54} color="#fff" />
        </View>
        <Text style={s.title}>{t('successTitle')}</Text>
        <Text style={s.sub}>{t('successSub')}</Text>

        {!!pkg && (
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>Selected Package</Text>
            <View style={s.rule} />
            <View style={s.summaryRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.summaryName}>{form.service} – {pkg.name}</Text>
                <Text style={s.summarySessions}>{pkg.sessionsLabel}</Text>
              </View>
              <Text style={s.summaryPrice}>OMR {pkg.price}</Text>
            </View>
          </View>
        )}

        {!!form.bookingToken && (
          <View style={s.tokenBox}>
            <Text style={s.tokenLabel}>{t('reference')}</Text>
            <Text style={s.token}>{form.bookingToken}</Text>
          </View>
        )}
      </ScrollView>

      <View style={{ padding: 22, paddingBottom: insets.bottom + 22 }}>
        <Button title={t('goHome')} onPress={onHome} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  topBar: { alignItems: 'flex-end', paddingHorizontal: 18, paddingTop: 10 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  checkWrap: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center', marginBottom: 26, ...SHADOW,
  },
  title: { fontSize: 24, fontWeight: '800', color: COLORS.purpleDeep, textAlign: 'center', lineHeight: 30 },
  sub: { fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 14, lineHeight: 20, paddingHorizontal: 10 },

  summaryCard: {
    alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 18, padding: 18, marginTop: 26, ...SHADOW,
  },
  summaryLabel: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  rule: { height: 1, backgroundColor: COLORS.line, marginVertical: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryName: { fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, lineHeight: 20 },
  summarySessions: { fontSize: 12.5, color: COLORS.muted, marginTop: 4 },
  summaryPrice: { fontSize: 19, fontWeight: '800', color: COLORS.purple },

  tokenBox: { marginTop: 18, alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 30, ...SHADOW },
  tokenLabel: { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  token: { fontSize: 20, fontWeight: '900', color: COLORS.purple, marginTop: 4, letterSpacing: 1 },
});
