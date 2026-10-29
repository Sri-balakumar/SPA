// Screen 3 — Packages under the selected service.
// The customer picks Single / Starter / Commit / Lifestyle. The packages come
// live from Odoo alongside the therapy. Purple/lavender theme.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import LangButton from '../../components/LangButton';
import SortPill from '../../components/SortPill';
import { loadTherapies, mediaUrl } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { toDigits, money } from '../../dateFmt';

const SERIF = 'PlayfairDisplay_700Bold';

// Package "Sort by" orders, the same as the booking website and the POS: value,
// direction, tie-breaker, label. The price is the one on the open member tab.
const byPrice = (p, priceFor) => priceFor(p);
const bySessions = (p) => p.sessions;
const PKG_SORTS = {
  price_asc: [byPrice, 1, bySessions, 'sortPriceAsc'],
  price_desc: [byPrice, -1, bySessions, 'sortPriceDesc'],
  sess_asc: [bySessions, 1, byPrice, 'sortSessAsc'],
  sess_desc: [bySessions, -1, byPrice, 'sortSessDesc'],
};

// One line of the therapy's details. Left out when Odoo has no value for it,
// same as the POS, so an unfilled field never shows as a blank row.
function InfoRow({ label, value, rtl, first }) {
  if (!value) return null;
  return (
    <View style={[s.infoRow, !first && s.infoRowLine, rtl && s.infoRowRtl]}>
      <Text style={[s.infoLbl, rtl && s.rtlTxt]}>{label}</Text>
      <Text style={[s.infoVal, rtl ? s.infoValRtl : null]}>{value}</Text>
    </View>
  );
}

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
      // Carried through so the next screen can offer the extras and price the
      // family sizes without re-fetching the catalogue.
      //   addons - [{ id, name, price, image_url }], merged server-side from the
      //            add-on product category and this package's own upsell list
      //   prices - { member_type: amount }; a member type ABSENT from this map
      //            means the package is not sold to that family size at all
      addons: p.addons || [],
      prices: p.prices || {},
    };
  });
  // The chosen package's key, not its position: Sort by reorders the list.
  const [selected, setSelected] = useState(null);

  // ---- therapy details (same block the POS shows above the tabs) ----
  // All of it comes from the therapy's POS category in Odoo, translated via
  // ?lang by the re-fetch below.
  const svc = form.serviceObj || {};
  const bannerSrc = svc.image_data ? { uri: svc.image_data } : mediaUrl(svc.image_url);
  const aboutTxt = svc.description || svc.tagline || '';
  const infoRows = [
    { key: 'dur', label: t('sessionDuration'),
      value: svc.duration_min ? `${toDigits(svc.duration_min, lang)} ${t('minutesWord')}` : '' },
    { key: 'ideal', label: t('idealFor'), value: svc.ideal_for },
    { key: 'focus', label: t('focusAreas'), value: svc.focus_areas },
  ].filter((r) => r.value);
  const hasInfo = !!(bannerSrc || aboutTxt || infoRows.length);

  // ---- Individual / Family tabs ----
  const memberType = form.memberType || 'individual';

  // Only the member types this therapy actually prices. A spa selling individual
  // packages only then sees no tab bar at all, rather than three empty tabs.
  // The labels come from the backend, so adding a type in Odoo reaches the
  // tablet without a release.
  const priced = new Set();
  packages.forEach((p) => {
    Object.keys(p.prices && Object.keys(p.prices).length ? p.prices : { individual: 0 })
      .forEach((k) => priced.add(k));
  });
  const memberTabs = (form.memberTypes || []).filter((m) => priced.has(m.key));

  // What one package costs on the selected tab, or null when it is not sold to
  // that member type. Availability and price are the same question.
  function priceFor(p) {
    const map = p.prices || {};
    // An older backend sends no prices map at all; fall back to the product's
    // own price, which IS the individual price.
    if (!Object.keys(map).length) return memberType === 'individual' ? p.price : null;
    const v = map[memberType];
    return v === undefined || v === null ? null : v;
  }

  // A package with no price for this tab is left out entirely - an empty cell
  // means "not offered", not "same price as individual". Shown in the "Sort by"
  // order, which opens on Odoo's Settings > Default package order.
  const [pkgSort, setPkgSort] = useState(PKG_SORTS[form.packageSort] ? form.packageSort : 'price_asc');
  const [get, dir, then] = PKG_SORTS[pkgSort];
  const visible = packages
    .filter((p) => priceFor(p) !== null)
    .sort((a, b) => dir * ((get(a, priceFor) || 0) - (get(b, priceFor) || 0))
      || dir * ((then(a, priceFor) || 0) - (then(b, priceFor) || 0)));
  // The Settings default is labelled "(Default)" in the list.
  const defaultPkgSort = PKG_SORTS[form.packageSort] ? form.packageSort : 'price_asc';

  function pickMemberType(key) {
    // Clearing the selection is deliberate: the package list itself changes,
    // and the chosen package may not be sold on the new tab. `members` is
    // deliberately NOT cleared - the same customer is still booking, and
    // retyping person 1 because they switched Family 2 to Family 3 is needless.
    setSelected(null);
    set({ memberType: key, addonIds: [] });
  }

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
    const pkg = visible.find((p) => p.key === selected);
    // serviceId = the PACKAGE id — that's what /questions and /tab/submit expect.
    // addonIds is cleared here rather than merged: the extras on offer belong to
    // the package, so an id ticked on a previous choice must not survive into a
    // package that does not offer it.
    // servicePrice is the price for the CHOSEN member type, not the individual
    // one - a Family 3 customer must be quoted what they will actually be charged.
    const price = priceFor(pkg);
    set({
      serviceId: pkg.id,
      package: { ...pkg, price },
      packageName: pkg.name,
      servicePrice: price,
      addonIds: [],
    });
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
          {hasInfo ? (
            <View style={s.info}>
              {bannerSrc ? <Image source={bannerSrc} style={s.banner} resizeMode="cover" /> : null}
              {aboutTxt ? <Text style={[s.about, rtl && s.rtlTxt]}>{aboutTxt}</Text> : null}
              {infoRows.map((r, i) => (
                <InfoRow key={r.key} label={r.label} value={r.value} rtl={rtl} first={i === 0 && !aboutTxt} />
              ))}
            </View>
          ) : null}

          {/* Shown only when this therapy really has more than one member type,
              so a spa selling individual packages only never sees a row of tabs
              where three of them are empty. */}
          {memberTabs.length > 1 ? (
            <>
              <Text style={[s.sectionTitle, rtl && s.rtlTxt]}>{t('memberType')}</Text>
              <View style={[s.mtabs, rtl && s.mtabsRtl]}>
                {memberTabs.map((m) => {
                  const on = m.key === memberType;
                  return (
                    <TouchableOpacity key={m.key} onPress={() => pickMemberType(m.key)}
                      style={[s.mtab, on && s.mtabOn]} activeOpacity={0.85}>
                      <Text style={[s.mtabTxt, on && s.mtabTxtOn]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          <Text style={[s.sectionTitle, rtl && s.rtlTxt]}>{t('availablePackages')}</Text>
          {visible.length > 1 ? (
            <SortPill value={pkgSort} defaultKey={defaultPkgSort} onChange={setPkgSort}
              options={Object.keys(PKG_SORTS).map((k) => ({ key: k, label: t(PKG_SORTS[k][3]) }))} />
          ) : null}
          {!visible.length ? (
            <Text style={[s.noPkg, rtl && s.rtlTxt]}>{t('noPackagesForOption')}</Text>
          ) : null}
          {visible.map((p) => {
            const active = selected === p.key;
            return (
              <TouchableOpacity key={p.key} activeOpacity={0.9} onPress={() => setSelected(p.key)}
                style={[s.card, active && s.cardActive]}>
                <View style={[s.radio, active && s.radioActive]}>
                  {active && <View style={s.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pkgName, rtl && s.rtlTxt]}>{p.name}</Text>
                  <Text style={[s.pkgSessions, rtl && s.rtlTxt]}>{p.sessionsLabel}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.pkgPrice}>{money(priceFor(p), lang)}</Text>
                  {/* The "Save X" figure is computed against the individual
                      price, so it only means anything on that tab. */}
                  {p.save > 0 && memberType === 'individual'
                    ? <Text style={s.pkgSave}>{t('saveWord')} {money(p.save, lang)}</Text>
                    : null}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Commercial small print, e.g. "Valid 3 months • Non-transferable".
              Written in Odoo Settings rather than hard-coded here, because it
              states terms that change without a release. */}
          {form.packageNote ? (
            <Text style={[s.pkgNote, rtl && s.rtlTxt]}>{form.packageNote}</Text>
          ) : null}
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
  // Therapy details card above the tabs.
  info: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 20,
    shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  banner: { width: '100%', height: 180, borderRadius: 14, marginBottom: 14 },
  about: { fontSize: 14, lineHeight: 21, color: COLORS.ink, marginBottom: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  infoRowLine: { borderTopWidth: 1, borderTopColor: COLORS.line },
  infoRowRtl: { flexDirection: 'row-reverse' },
  infoLbl: { fontSize: 13.5, color: COLORS.muted },
  infoVal: { flex: 1, fontSize: 14, fontWeight: '800', color: COLORS.purpleDeep, textAlign: 'right', marginLeft: 12 },
  infoValRtl: { textAlign: 'left', writingDirection: 'rtl', marginLeft: 0, marginRight: 12 },

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
  pkgNote: { fontSize: 12.5, color: COLORS.muted, marginTop: 6, marginBottom: 4, lineHeight: 18, fontStyle: 'italic' },
  noPkg: { fontSize: 14, color: COLORS.muted, textAlign: 'center', paddingVertical: 22 },

  // Individual / Family tabs. Wraps rather than scrolls: four across is
  // unreadable on a narrow tablet, and a hidden tab is a hidden price.
  mtabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  mtabsRtl: { flexDirection: 'row-reverse' },
  mtab: {
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, marginRight: 8, marginBottom: 8,
    backgroundColor: '#fff', borderWidth: 1.6, borderColor: COLORS.line,
  },
  // The selected tab reads as selected on its own, not only by contrast with
  // its neighbours - reception and customers scan this at a glance.
  mtabOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  mtabTxt: { fontSize: 13.5, fontWeight: '700', color: COLORS.purpleDeep },
  mtabTxtOn: { color: '#fff' },

  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
