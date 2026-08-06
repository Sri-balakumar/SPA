// Screen 2 — Service detail (full page, matches the mockup).
// Big photo + name + description + duration/price, then "Select a Package".
import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import LangButton from '../../components/LangButton';
import { odooImage } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { money } from '../../dateFmt';

const SERIF = 'PlayfairDisplay_700Bold';

export default function ServiceDetailScreen({ form, next, onBack, onHome }) {
  const insets = useSafeAreaInsets();
  const { lang } = useLang();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 620);
  const svc = form.serviceObj || {};
  const imgSrc = odooImage(svc.image_256);
  // Not rounded any more: money() applies the currency's own precision, and
  // rounding here would throw away the decimals a 3-decimal currency needs.
  const price = svc.list_price || 0;
  const dur = svc.spa_duration || 60;

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headTop}>
          <TouchableOpacity onPress={onBack} hitSlop={hit}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
          <View style={s.headRight}>
            <LangButton />
            <TouchableOpacity onLongPress={onHome} delayLongPress={800} activeOpacity={1}><Text style={s.deco}>🪷</Text></TouchableOpacity>
          </View>
        </View>
        <Text style={s.svcName}>{form.service}</Text>
        <Text style={s.subtitle}>Service details</Text>
      </LinearGradient>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}>
        <View style={{ width: contentW }}>
          <View style={s.imageWrap}>
            {imgSrc
              ? <Image source={imgSrc} style={s.image} resizeMode="cover" />
              : <View style={[s.image, { backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' }]}>
                  <MaterialCommunityIcons name="spa" size={54} color={COLORS.purple} />
                </View>}
          </View>

          <View style={s.chips}>
            <View style={s.chip}><Text style={s.chipTxt}>From {money(price, lang)}</Text></View>
            <View style={s.chip}>
              <Ionicons name="time-outline" size={14} color={COLORS.purple} style={{ marginRight: 4 }} />
              <Text style={s.chipTxt}>{dur} min</Text>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.descLabel}>Description</Text>
            <Text style={s.desc}>{svc.description_sale || ''}</Text>
            <View style={s.rule} />
            <View style={s.row}>
              <Ionicons name="time-outline" size={18} color={COLORS.purple} style={{ marginRight: 10 }} />
              <Text style={s.rowLabel}>Session Duration</Text>
              <Text style={s.rowValue}>{dur} Minutes</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={s.cta} onPress={next} activeOpacity={0.9}>
          <Text style={s.ctaTxt}>Select a Package</Text>
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
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deco: { fontSize: 30 },
  svcName: { fontFamily: SERIF, fontSize: 26, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 4 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 6 },

  scroll: { alignItems: 'center', paddingTop: 14 },
  imageWrap: {
    borderRadius: 22, overflow: 'hidden',
    shadowColor: '#4A2F6B', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  image: { width: '100%', height: 200, borderRadius: 22 },
  name: { fontFamily: SERIF, fontSize: 28, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 18 },

  chips: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, marginBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 5,
    shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  chipTxt: { fontSize: 13.5, fontWeight: '800', color: COLORS.purple },

  card: {
    backgroundColor: '#fff', borderRadius: 22, padding: 22, marginTop: 18,
    shadowColor: '#4A2F6B', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  descLabel: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  desc: { fontSize: 15, lineHeight: 23, color: COLORS.ink },
  rule: { height: 1, backgroundColor: COLORS.line, marginVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowLabel: { fontSize: 14, color: COLORS.muted, fontWeight: '600', flex: 1 },
  rowValue: { fontSize: 14.5, color: COLORS.purpleDeep, fontWeight: '800' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: 'rgba(245,239,251,0.96)' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16 },
  ctaTxt: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
