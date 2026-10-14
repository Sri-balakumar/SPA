// Screen 2 — Select Service (customer "Home").
// Services are loaded LIVE from Odoo (products flagged "Show on Kiosk"), so
// whatever the spa company adds/edits in Odoo appears here automatically.
// The card design (icon badge, wave colour, description) comes from local
// metadata keyed by service name, with sensible fallbacks for new services.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, useWindowDimensions, ActivityIndicator, Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import { SERVICES, SERVICE_I18N } from '../../data/options';
import { loadTherapies, mediaUrl } from '../../spaApi';
import { money } from '../../dateFmt';
import { useLang } from '../../LanguageContext';
import LangButton from '../../components/LangButton';

const SERIF = 'PlayfairDisplay_700Bold';
const META = {};
SERVICES.forEach((s) => { META[s.name] = s; });

export default function ServiceScreen({ set, next, onBack, onHome }) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const { width } = useWindowDimensions();
  // 2 columns on a phone, 3 on a wider tablet — fits both. The content grows
  // with the screen (capped) so it fills a tablet instead of a narrow column.
  const cols = width >= 900 ? 3 : 2;
  const GAP = 16;
  const contentW = Math.min(width - 36, 880);
  const cardW = Math.floor((contentW - GAP * (cols - 1)) / cols);
  const titleSize = width >= 720 ? 34 : 27;

  const [services, setServices] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);   // service tapped → show its full description

  async function fetchServices() {
    setError('');
    try {
      const data = await loadTherapies(lang);
      setServices(data.therapies || []);
      // Top-level catalogue settings, carried on the form because the screens
      // that need them are further down the flow and do not re-fetch:
      //   package_note  - commercial small print under the package list
      //   member_types  - the Individual / Family tabs the spa actually offers
      // Both come from the backend so adding one in Odoo reaches the tablet
      // without a release.
      set({
        packageNote: data.package_note || '',
        memberTypes: data.member_types || [],
      });
    } catch (e) {
      setError(e.message || 'Could not load services.');
      setServices([]);
    }
  }
  useEffect(() => { fetchServices(); }, [lang]);

  // A "service" card here is a THERAPY (GO Ease/Flex/Relief/Release). Its packages
  // travel with it (svc.packages) and are chosen on the next screen.
  function choose(svc) {
    set({ serviceObj: svc, service: svc.name, servicePrice: svc.from_price });
    next();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />

      <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headTop}>
          {onBack
            ? <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
            : <View style={{ width: 40 }} />}
          <LangButton />
        </View>
        {/* Client brand — long-press to end the session (reception only). */}
        <TouchableOpacity onLongPress={onHome} delayLongPress={800} activeOpacity={1} style={{ alignSelf: 'center' }}>
          <Image source={require('../../assets/nexgen_dark.png')} style={s.brandLogo} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[s.title, { fontSize: titleSize }]}>{t('chooseService')}</Text>
        <View style={s.divider}>
          <View style={s.line} />
          <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
          <View style={s.line} />
        </View>
        <Text style={s.subtitle}>{t('serviceSub')}</Text>
      </LinearGradient>

      {services === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={COLORS.purple} /><Text style={s.loadingTxt}>{t('loadingServices')}</Text></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errTxt}>{error}</Text>
          <TouchableOpacity style={s.retry} onPress={fetchServices}><Text style={s.retryTxt}>{t('retry')}</Text></TouchableOpacity>
        </View>
      ) : services.length === 0 ? (
        <View style={s.center}><Text style={s.errTxt}>{t('noServices')}</Text></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
          <View style={[s.grid, { width: contentW, columnGap: GAP, rowGap: GAP + 4 }]}>
            {services.map((svc) => {
              const meta = META[svc.name] || {};
              const imgSrc = (svc.image_data ? { uri: svc.image_data } : mediaUrl(svc.image_url)) || meta.img;
              const displayName = svc.name;
              // Description comes straight from Odoo (translated via ?lang).
              const displayDesc = svc.description || svc.tagline || meta.desc || '';
              // Not rounded: money() applies the currency's own precision.
              const priceTxt = money(svc.from_price || 0, lang);
              // Real minutes from Odoo, never a made-up 60: when Odoo sends none
              // the time is left off, same as the booking website.
              const minTxt = svc.duration_min ? `${svc.duration_min} min` : '';
              return (
                <TouchableOpacity key={svc.id} style={[s.card, { width: cardW }]} activeOpacity={0.9} onPress={() => choose(svc)}>
                  <View style={s.cardTop}>
                    <View style={s.photoWrap}>
                      {imgSrc
                        ? <Image source={imgSrc} style={s.photo} resizeMode="cover" />
                        : <View style={[s.photo, { backgroundColor: COLORS.lavenderSoft }]} />}
                      <View style={s.badge}>
                        <MaterialCommunityIcons name={meta.icon || 'spa'} size={18} color={COLORS.purple} />
                      </View>
                    </View>
                    <Text style={s.name} numberOfLines={2}>{displayName}</Text>
                  </View>
                  <View style={s.descBox}><Text style={s.desc} numberOfLines={4}>{displayDesc}</Text></View>
                  <View style={s.priceBar}>
                    <Text style={s.priceTxt}>{priceTxt}</Text>
                    {minTxt ? (
                      <>
                        <Text style={s.dot}>·</Text>
                        <Ionicons name="time-outline" size={12} color={COLORS.muted} style={{ marginRight: 3 }} />
                        <Text style={s.priceTxt}>{minTxt}</Text>
                      </>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <Ionicons name="arrow-forward" size={18} color={COLORS.purpleDark} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Service detail — shows the exact description (from Odoo) when a service is tapped. */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={s.detailBackdrop}>
          <View style={s.detailCard}>
            <TouchableOpacity style={s.detailClose} onPress={() => setSelected(null)} hitSlop={hit}>
              <Ionicons name="close" size={24} color={COLORS.muted} />
            </TouchableOpacity>
            <Text style={s.detailName}>{selected?.name}</Text>
            <View style={s.detailMetaRow}>
              <Text style={s.detailPrice}>{money(selected?.list_price || 0, lang)}</Text>
              <Text style={s.detailDot}>·</Text>
              <Ionicons name="time-outline" size={15} color={COLORS.muted} style={{ marginRight: 4 }} />
              <Text style={s.detailMin}>{selected?.duration_min || 0} min</Text>
            </View>
            <View style={s.detailRule} />
            <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingBottom: 6 }}>
              <Text style={s.detailDesc}>
                {selected?.description_sale || 'Description will appear here once added in Odoo.'}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={s.detailBtn}
              activeOpacity={0.9}
              onPress={() => { const sv = selected; setSelected(null); choose(sv); }}
            >
              <Text style={s.detailBtnTxt}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  header: { paddingHorizontal: 18, paddingBottom: 16, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  deco: { fontSize: 34 },
  bellWrap: { padding: 4 },
  bellDot: { position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.purple, borderWidth: 1.5, borderColor: '#EFE6F8' },
  title: { fontFamily: SERIF, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 2 },
  divider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  line: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 8 },
  // NexGenn brand, moved up from the footer. Same 320x68 as BrandHeader uses on
  // every other screen — this screen has its own inline header, so it needs the
  // size set here rather than inheriting it.
  brandLogo: { width: 320, height: 68, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
  headRibbon: { width: 28, height: 38 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  loadingTxt: { marginTop: 12, color: COLORS.muted, fontSize: 14 },
  errTxt: { color: COLORS.muted, fontSize: 14, textAlign: 'center' },
  retry: { marginTop: 14, borderWidth: 1.5, borderColor: COLORS.purple, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 22 },
  retryTxt: { color: COLORS.purple, fontWeight: '800' },

  scroll: { alignItems: 'center', paddingTop: 12, paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, paddingTop: 18, paddingHorizontal: 14, overflow: 'hidden',
    shadowColor: '#4A2F6B', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  photoWrap: { width: 64, height: 64, marginRight: 12 },
  photo: { width: 64, height: 64, borderRadius: 32 },
  badge: {
    position: 'absolute', bottom: -6, left: 18, width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4A2F6B', shadowOpacity: 0.15, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  name: { flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, lineHeight: 19 },
  // minHeight, NOT height: a fixed height is a hard clip, so anything even a
  // pixel taller loses the bottom of the last line. minHeight still reserves
  // the same space (keeping cards equal in the grid, since numberOfLines caps
  // the text at 4) but can never cut text off.
  descBox: { minHeight: 72, marginTop: 16 },
  desc: {
    fontSize: 12, color: COLORS.muted, textAlign: 'center', lineHeight: 17,
    // Android pads above/below the glyphs on top of lineHeight, so 4 lines
    // measure taller than 4 x 17 and overflow the box. Turning it off makes
    // the rendered height match the arithmetic.
    includeFontPadding: false,
  },
  priceBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.lavenderSoft,
    marginHorizontal: -14, marginTop: 14, paddingHorizontal: 14, paddingVertical: 15, borderTopLeftRadius: 22,
  },
  priceTxt: { fontSize: 12.5, fontWeight: '800', color: COLORS.purpleDeep },
  dot: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginHorizontal: 5 },

  // Service detail popup (shows the exact description on tap)
  detailBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  detailCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, paddingTop: 28, alignSelf: 'center', width: '100%', maxWidth: 460 },
  detailClose: { position: 'absolute', top: 14, right: 14, padding: 4, zIndex: 2 },
  detailName: { fontFamily: SERIF, fontSize: 24, color: COLORS.purpleDeep, paddingRight: 24 },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  detailPrice: { fontSize: 15, fontWeight: '800', color: COLORS.purple },
  detailDot: { fontSize: 15, fontWeight: '800', color: COLORS.muted, marginHorizontal: 8 },
  detailMin: { fontSize: 14, fontWeight: '700', color: COLORS.muted },
  detailRule: { height: 1, backgroundColor: COLORS.line, marginVertical: 16 },
  detailDesc: { fontSize: 15, lineHeight: 23, color: COLORS.ink },
  detailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 15, marginTop: 20 },
  detailBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
