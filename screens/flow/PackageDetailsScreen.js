// Screen 5 — Package details (before Personal Info).
// Shows the selected package's exact description, sessions, duration, price.
import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import LangButton from '../../components/LangButton';
import { loadTherapies } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { toDigits, money } from '../../dateFmt';

const SERIF = 'PlayfairDisplay_700Bold';

function Row({ label, value, rtl }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, rtl && s.rtlTxt]}>{label}</Text>
      <Text style={[s.rowValue, rtl && s.rtlTxt]}>{value}</Text>
    </View>
  );
}

export default function PackageDetailsScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 620);
  const pkg = form.package || {};
  const dur = pkg.duration || form.serviceObj?.duration_min || 0;

  // ---- optional extras ----
  const addons = pkg.addons || [];
  // Only ids still offered by THIS package. Guards a stale id surviving a
  // package switch, and means a removed extra silently drops out rather than
  // being charged for.
  const chosenIds = (form.addonIds || []).filter((id) => addons.some((a) => a.id === id));

  function toggleAddon(id) {
    const next = chosenIds.includes(id)
      ? chosenIds.filter((x) => x !== id)
      : [...chosenIds, id];
    set({ addonIds: next });
  }

  // Prices are always read back off the package payload, never carried in state,
  // so a stale number can never reach the total or the order. Extras are not
  // multiplied per person: a family pays for one heat pack, not one each.
  const addonTotal = addons
    .filter((a) => chosenIds.includes(a.id))
    .reduce((sum, a) => sum + (Number(a.price) || 0), 0);
  const total = (Number(pkg.price) || 0) + addonTotal;

  // `form.package` is a snapshot taken on the Packages screen, so its Odoo text
  // is frozen in the language chosen back then. Re-fetch on a language switch
  // so the package name and description follow it.
  useEffect(() => {
    const therapyId = form.serviceObj?.id;
    const pkgId = form.package?.id;
    if (!therapyId || !pkgId || !set) return;
    let alive = true;
    (async () => {
      try {
        const data = await loadTherapies(lang);
        const therapy = (data.therapies || []).find((x) => x.id === therapyId);
        const fresh = (therapy?.packages || []).find((p) => p.id === pkgId);
        if (!alive || !therapy || !fresh) return;
        set({
          serviceObj: therapy,
          service: therapy.name,
          packageName: fresh.name,
          package: {
            ...form.package,
            name: fresh.name,
            description: fresh.session_desc
              || (fresh.details && fresh.details[0] && fresh.details[0].description)
              || '',
          },
        });
      } catch (e) { /* keep showing what we already have */ }
    })();
    return () => { alive = false; };
  }, [lang]);

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headTop}>
          <TouchableOpacity onPress={onBack} hitSlop={hit}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
          <LangButton />
        </View>
        <Text style={s.svcName}>{form.service}</Text>
        <Text style={s.subtitle}>{t('packageDetails')}</Text>
      </LinearGradient>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}>
        <View style={[s.card, { width: contentW }]}>
          <View style={s.titleRow}>
            <Text style={[s.pkgName, rtl && s.rtlTxt]}>{pkg.name}</Text>
            <Text style={s.pkgPrice}>{money(pkg.price, lang)}</Text>
          </View>
          <Text style={[s.sessions, rtl && s.rtlTxt]}>{pkg.sessionsLabel}</Text>
          <View style={s.rule} />
          <Text style={[s.descLabel, rtl && s.rtlTxt]}>{t('descriptionLabel')}</Text>
          <Text style={[s.desc, rtl && s.rtlTxt]}>{pkg.description}</Text>
          <View style={s.rule} />
          <Row rtl={rtl} label={t('numberOfSessions')} value={`${toDigits(pkg.sessions, lang)} ${pkg.sessions > 1 ? t('sessionsWord') : t('sessionWord')}`} />
          {dur > 0 && <Row rtl={rtl} label={t('sessionDuration')} value={`${toDigits(dur, lang)} ${t('minutesWord')}`} />}
          {pkg.save > 0 && <Row rtl={rtl} label={t('youSave')} value={money(pkg.save, lang)} />}
        </View>

        {/* Optional extras. Same place and behaviour as the POS and the booking
            website, so staff reading a customer's order see the same screen.
            Only shown when this package actually offers any. */}
        {addons.length ? (
          <View style={[s.card, { width: contentW, marginTop: 14 }]}>
            <Text style={[s.descLabel, rtl && s.rtlTxt]}>{t('addonsTitle')}</Text>
            <Text style={[s.addonHint, rtl && s.rtlTxt]}>{t('addonsHint')}</Text>
            {addons.map((a) => {
              const on = chosenIds.includes(a.id);
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[s.aRow, rtl && s.aRowRtl]}
                  onPress={() => toggleAddon(a.id)}
                  activeOpacity={0.8}
                >
                  <View style={[s.aBox, on && s.aBoxOn]}>{on ? <Text style={s.aTick}>✓</Text> : null}</View>
                  <Text style={[s.aName, rtl && s.rtlTxt]}>{a.name}</Text>
                  <Text style={s.aPrice}>{money(a.price, lang)}</Text>
                </TouchableOpacity>
              );
            })}
            <View style={s.rule} />
            <View style={s.totalRow}>
              <Text style={[s.totalLabel, rtl && s.rtlTxt]}>{t('reviewTotal')}</Text>
              <Text style={s.totalValue}>{money(total, lang)}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={s.cta} onPress={next} activeOpacity={0.9}>
          <Text style={s.ctaTxt}>{t('continueToPersonal')}</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  header: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deco: { fontSize: 30 },
  svcName: { fontFamily: SERIF, fontSize: 26, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 4 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 6 },

  scroll: { alignItems: 'center', paddingTop: 18 },
  card: {
    backgroundColor: '#fff', borderRadius: 22, padding: 22,
    shadowColor: '#4A2F6B', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  pkgName: { fontFamily: SERIF, fontSize: 21, color: COLORS.purpleDeep, flex: 1, paddingRight: 10 },
  pkgPrice: { fontSize: 20, fontWeight: '800', color: COLORS.purple },
  sessions: { fontSize: 13.5, color: COLORS.muted, marginTop: 6 },
  rule: { height: 1, backgroundColor: COLORS.line, marginVertical: 16 },
  descLabel: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  desc: { fontSize: 15, lineHeight: 23, color: COLORS.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: COLORS.muted, fontWeight: '600' },
  rowValue: { fontSize: 14.5, color: COLORS.purpleDeep, fontWeight: '800' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: 'rgba(245,239,251,0.96)' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16 },
  ctaTxt: { color: '#fff', fontSize: 16.5, fontWeight: '800' },

  // add-ons. A square box rather than a radio: several can be ticked, and the
  // control should say so at a glance.
  addonHint: { fontSize: 12.5, color: COLORS.muted, marginBottom: 12, lineHeight: 18 },
  aRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  aRowRtl: { flexDirection: 'row-reverse' },
  aBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.8, borderColor: COLORS.line,
    alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: '#fff',
  },
  aBoxOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  aTick: { color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  aName: { flex: 1, fontSize: 14.5, color: COLORS.ink, fontWeight: '600' },
  aPrice: { fontSize: 14.5, fontWeight: '800', color: COLORS.purpleDeep, marginLeft: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14.5, fontWeight: '800', color: COLORS.ink },
  totalValue: { fontSize: 18, fontWeight: '900', color: COLORS.purple },

  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
