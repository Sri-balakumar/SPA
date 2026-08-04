// Screen 3 — Packages under the selected service.
// The customer picks Single / Starter / Commit / Lifestyle. The packages come
// live from Odoo alongside the therapy. Purple/lavender theme.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import LangButton from '../../components/LangButton';
import { loadTherapies } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { toDigits } from '../../dateFmt';

const SERIF = 'PlayfairDisplay_700Bold';

export default function PackagesScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 620);

  // Real packages that came with the chosen therapy (from /api/spa/therapies).
  const packages = (form.serviceObj?.packages || []).map((p) => {
    const n = p.session_count || 1;
    return {
      id: p.id, key: String(p.id), name: p.name,
      sessions: n,
      sessionsLabel: `${toDigits(n, lang)} ${n === 1 ? t('sessionWord') : t('sessionsWord')}`,
      description: p.session_desc || (p.details && p.details[0] && p.details[0].description) || '',
      duration: p.duration_minutes || 0,
      price: p.price, save: p.save || 0,
    };
  });
  const [selected, setSelected] = useState(null);

  // Package names and descriptions come from Odoo and were captured on the
  // Service page in whatever language was active THEN — switching language here
  // would otherwise only re-label the chrome and leave the packages in the old
  // language. Re-fetch this therapy so the Odoo text follows the switch too.
  useEffect(() => {
    const id = form.serviceObj?.id;
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const data = await loadTherapies(lang);
        const fresh = (data.therapies || []).find((x) => x.id === id);
        if (alive && fresh) set({ serviceObj: fresh, service: fresh.name });
      } catch (e) { /* keep showing what we already have */ }
    })();
    return () => { alive = false; };
  }, [lang]);

  function cont() {
    const pkg = packages[selected];
    // serviceId = the PACKAGE id — that's what /questions and /tab/submit expect.
    set({ serviceId: pkg.id, package: pkg, packageName: pkg.name, servicePrice: pkg.price });
    next();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headTop}>
          <TouchableOpacity onPress={onBack} hitSlop={hit}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
          <LangButton />
        </View>
        <Text style={s.svcName}>{form.service}</Text>
        <Text style={s.subtitle}>{t('choosePackage')}</Text>
      </LinearGradient>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}>
        <View style={{ width: contentW }}>
          <Text style={[s.sectionTitle, rtl && s.rtlTxt]}>{t('availablePackages')}</Text>
          {packages.map((p, i) => {
            const active = selected === i;
            return (
              <TouchableOpacity key={p.key} activeOpacity={0.9} onPress={() => setSelected(i)}
                style={[s.card, active && s.cardActive]}>
                <View style={[s.radio, active && s.radioActive]}>
                  {active && <View style={s.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pkgName, rtl && s.rtlTxt]}>{p.name}</Text>
                  <Text style={[s.pkgSessions, rtl && s.rtlTxt]}>{p.sessionsLabel}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.pkgPrice}>OMR {toDigits(p.price, lang)}</Text>
                  {p.save > 0 && <Text style={s.pkgSave}>{t('saveWord')} OMR {toDigits(p.save, lang)}</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[s.cta, selected === null && { opacity: 0.5 }]}
          disabled={selected === null}
          onPress={cont}
          activeOpacity={0.9}
        >
          <Text style={s.ctaTxt}>{t('continueWord')}</Text>
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
  sectionTitle: { fontSize: 13, fontWeight: '800', color: COLORS.muted, marginBottom: 12, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18,
    padding: 16, marginBottom: 12, borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  cardActive: { borderColor: COLORS.purple, backgroundColor: '#FBF8FE' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.line, marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: COLORS.purple },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.purple },
  pkgName: { fontSize: 15.5, fontWeight: '800', color: COLORS.purpleDeep },
  pkgSessions: { fontSize: 12.5, color: COLORS.muted, marginTop: 3 },
  pkgPrice: { fontSize: 17, fontWeight: '800', color: COLORS.purpleDeep },
  pkgSave: { fontSize: 11.5, fontWeight: '800', color: COLORS.green, marginTop: 3 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: 'rgba(245,239,251,0.96)' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16 },
  ctaTxt: { color: '#fff', fontSize: 17, fontWeight: '800' },
  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
