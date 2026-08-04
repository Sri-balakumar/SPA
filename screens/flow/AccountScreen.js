// Existing customer, screen 3 — My Profile & Active Packages.
// Shows the customer + a list of every package they hold. A package with 0
// sessions left shows "Completed" instead of "Active". Tap a package to open it.
import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import { useLang } from '../../LanguageContext';
import { toDigits } from '../../dateFmt';

function PackageCard({ pkg, onPress }) {
  const { t, lang } = useLang();
  const total = pkg.sessions_total || 0;
  const used = pkg.sessions_used || 0;
  const remaining = Math.max(0, total - used);
  const done = remaining <= 0;
  const pct = total ? Math.min(1, used / total) : 0;

  return (
    <TouchableOpacity style={s.pkg} activeOpacity={0.9} onPress={onPress}>
      <View style={s.thumb}><MaterialCommunityIcons name="yoga" size={30} color={COLORS.purple} /></View>
      <View style={{ flex: 1 }}>
        <View style={s.pkgTop}>
          <Text style={s.pkgName} numberOfLines={1}>{pkg.service_name}</Text>
          <View style={[s.badge, done ? s.badgeDone : s.badgeActive]}>
            <Text style={[s.badgeTxt, done ? s.badgeTxtDone : s.badgeTxtActive]}>{done ? t('completed') : t('active')}</Text>
          </View>
        </View>
        <Text style={s.pkgPack} numberOfLines={1}>{pkg.package_name}</Text>
        <View style={s.barTrack}><View style={[s.barFill, { width: `${pct * 100}%`, backgroundColor: done ? COLORS.muted : COLORS.purple }]} /></View>
        <View style={s.pkgBottom}>
          <Text style={s.used}>{toDigits(used, lang)} {t('ofWord')} {toDigits(total, lang)} {t('usedWord')}</Text>
          <Text style={[s.remain, done && { color: COLORS.muted }]}>{done ? t('noSessionsLeft') : `${toDigits(remaining, lang)} ${t('sessionsRemaining')}`}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#C9B9E0" style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

export default function AccountScreen({ form, onSelect, onEdit, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 520);
  const m = form.selectedCustomer || {};
  const packages = m.packages || [];

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader onBack={onBack} onHome={onHome} />

      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 20 }]}>
        <View style={{ width: contentW }}>
          <View style={s.profile}>
            <View style={s.avatar}><Ionicons name="person" size={26} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.hello, rtl && s.rtlTxt]}>{t('hello')}، {(m.name || 'Guest').split(' ')[0]} 👋</Text>
              {!!m.phone && <Text style={s.phone}>{m.phone}</Text>}
            </View>
            <TouchableOpacity style={s.edit} activeOpacity={0.85} onPress={onEdit}>
              <Ionicons name="create-outline" size={15} color="#fff" />
              <Text style={s.editTxt}>{t('edit')}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[s.section, rtl && s.rtlTxt]}>{t('myActivePackages')} ({toDigits(packages.length, lang)})</Text>

          {packages.map((pkg, i) => (
            <PackageCard key={pkg.id ?? i} pkg={pkg} onPress={() => onSelect(pkg)} />
          ))}

          {packages.length === 0 && <Text style={s.empty}>{t('noPackages')}</Text>}
          {m.demo && <Text style={s.demo}>{t('sampleData')}</Text>}
        </View>
      </ScrollView>

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  body: { alignItems: 'center', paddingTop: 6 },

  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: '#EADFF6', shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' },
  hello: { fontSize: 18, fontWeight: '900', color: COLORS.purpleDeep },
  phone: { fontSize: 13, color: COLORS.muted, marginTop: 2, fontWeight: '600' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  editTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },

  section: { fontSize: 15, fontWeight: '900', color: COLORS.purpleDeep, marginTop: 22, marginBottom: 10, marginLeft: 2 },

  pkg: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12, shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  thumb: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' },
  pkgTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pkgName: { fontSize: 15.5, fontWeight: '900', color: COLORS.purpleDeep, flex: 1, marginRight: 8 },
  pkgPack: { fontSize: 13, color: COLORS.muted, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  badgeActive: { backgroundColor: '#E4F6EC' },
  badgeDone: { backgroundColor: '#ECE7F3' },
  badgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  badgeTxtActive: { color: '#2E8B57' },
  badgeTxtDone: { color: COLORS.muted },

  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#EFE7F7', marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  pkgBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
  used: { fontSize: 12, color: COLORS.muted, fontWeight: '700' },
  remain: { fontSize: 12, color: COLORS.green, fontWeight: '800' },

  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 20, fontSize: 14 },
  demo: { fontSize: 10, fontWeight: '800', color: COLORS.muted, letterSpacing: 0.4, marginTop: 6, textAlign: 'center' },
  powered: { textAlign: 'center', fontSize: 11.5, color: COLORS.muted, fontWeight: '600', paddingTop: 8 },
  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
