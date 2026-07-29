// Existing customer, screen 3 — Select Your Profile.
// One phone number can belong to several family members. After the number is
// entered we show everyone linked to it, and the customer picks themselves,
// so each person continues with their OWN packages.
import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import NexFooter from '../../components/NexFooter';
import { useLang } from '../../LanguageContext';
import { toDigits } from '../../dateFmt';

function activeCount(c) {
  return (c.packages || []).filter((p) => (p.sessions_left || 0) > 0).length;
}

export default function ProfileSelectScreen({ form, onSelect, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 520);
  const customers = form.membership?.customers || [];

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader title={t('selectProfile')} subtitle={t('foundMultiple')} titleSize={24} onBack={onBack} onHome={onHome} />

      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 20 }]}>
        <View style={{ width: contentW }}>
          {customers.map((c, i) => {
            const n = activeCount(c);
            const label = n === 0 ? t('noActivePkg') : `${toDigits(n, lang)} ${n === 1 ? t('activePkg') : t('activePkgs')}`;
            return (
              <TouchableOpacity key={c.id ?? i} style={s.card} activeOpacity={0.9} onPress={() => onSelect(c)}>
                <View style={s.avatar}><Ionicons name="person" size={24} color={COLORS.purple} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, rtl && s.rtlTxt]}>{c.name}</Text>
                  <Text style={[s.count, rtl && s.rtlTxt, n === 0 && { color: COLORS.muted }]}>{label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="#C9B9E0" />
              </TouchableOpacity>
            );
          })}

          {customers.length === 0 && <Text style={s.empty}>{t('noCustomers')}</Text>}
          {form.membership?.demo && <Text style={s.demo}>{t('sampleData')}</Text>}
        </View>
      </ScrollView>

      <NexFooter />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  body: { alignItems: 'center', paddingTop: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 18,
    padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: '#EADFF6',
    shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16.5, fontWeight: '900', color: COLORS.purpleDeep },
  count: { fontSize: 13, color: COLORS.green, fontWeight: '700', marginTop: 3 },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 24, fontSize: 14 },
  demo: { fontSize: 10, fontWeight: '800', color: COLORS.muted, letterSpacing: 0.4, marginTop: 8, textAlign: 'center' },
  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
