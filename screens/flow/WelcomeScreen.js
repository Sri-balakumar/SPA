// Screen 0 — Welcome. The FIRST screen the customer sees. The logo, glowing
// illustration and background stay fixed; only the bottom section changes:
//   1) Select Language  (English / العربية)
//   2) after a language is picked, it cross-fades in place to the Welcome
//      content (New Customer / Existing Customer) — no page change.
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, useWindowDimensions, Animated, Easing,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import NexFooter from '../../components/NexFooter';
import { useLang } from '../../LanguageContext';

const SERIF = 'PlayfairDisplay_700Bold';

const LANG_CARDS = [
  { code: 'en', flag: '🇬🇧', name: 'English', hint: 'Continue in English' },
  { code: 'ar', flag: '🇴🇲', name: 'العربية', hint: 'متابعة باللغة العربية' },
];

function Divider() {
  return (
    <View style={s.divider}>
      <View style={s.line} />
      <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
      <View style={s.line} />
    </View>
  );
}

export default function WelcomeScreen({ onNew, onExisting, onHome }) {
  const { t, lang, setLang } = useLang();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 40, 540);
  const [chosen, setChosen] = useState(false);
  const [pick, setPick] = useState(lang);            // which language is ticked
  const anim = useRef(new Animated.Value(0)).current; // 0 = language, 1 = welcome

  const rtl = lang === 'ar';
  const cardTxt = rtl ? { textAlign: 'right', writingDirection: 'rtl' } : null;

  function choose(code) {
    setLang(code);
    setPick(code);
    setChosen(true);
    // smooth in-place cross-fade + slide (≈420ms)
    Animated.timing(anim, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
  }

  const langOpacity = anim.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const langShift = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -22] });
  const welOpacity = anim.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const welShift = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader onHome={onHome} />

      <View style={s.body}>
        {/* fixed illustration */}
        <Image source={require('../../assets/man_hero.png')} style={s.hero} resizeMode="contain" />

        {/* the changing bottom section — both panels overlap and cross-fade */}
        <View style={[s.stage, { width: contentW }]}>
          {/* 1) LANGUAGE SELECTION */}
          <Animated.View
            style={[s.panel, { opacity: langOpacity, transform: [{ translateY: langShift }] }]}
            pointerEvents={chosen ? 'none' : 'auto'}>
            <Text style={s.title}>Select Language</Text>
            <Text style={s.titleAlt}>اختر اللغة</Text>
            <Divider />
            <Text style={s.sub}>Please select your preferred language</Text>
            <Text style={s.subAlt}>يرجى اختيار لغتك المفضلة</Text>

            <View style={s.cards}>
              {LANG_CARDS.map((c) => (
                <TouchableOpacity key={c.code} style={[s.opt, pick === c.code && s.optPrimary]} activeOpacity={0.9} onPress={() => choose(c.code)}>
                  <Text style={s.flag}>{c.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.optTitle}>{c.name}</Text>
                    <Text style={s.optDesc}>{c.hint}</Text>
                  </View>
                  <View style={[s.radio, pick === c.code && s.radioOn]}>
                    {pick === c.code && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* 2) WELCOME CONTENT (unchanged design) */}
          <Animated.View
            style={[s.panel, { opacity: welOpacity, transform: [{ translateY: welShift }] }]}
            pointerEvents={chosen ? 'auto' : 'none'}>
            <Text style={[s.title, rtl && { writingDirection: 'rtl' }]}>{t('welcomeTitle')}</Text>
            <Divider />
            <Text style={[s.sub, rtl && { writingDirection: 'rtl' }]}>{t('howContinue')}</Text>

            <View style={s.cards}>
              <TouchableOpacity style={[s.opt, s.optPrimary]} activeOpacity={0.9} onPress={onNew}>
                <View style={[s.ic, { backgroundColor: COLORS.purple }]}><Ionicons name="person-add" size={25} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optTitle, cardTxt]}>{t('newCustomer')}</Text>
                  <Text style={[s.optDesc, cardTxt]}>{t('newCustomerDesc')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.purple} />
              </TouchableOpacity>

              <TouchableOpacity style={s.opt} activeOpacity={0.9} onPress={onExisting}>
                <View style={[s.ic, { backgroundColor: COLORS.green }]}><MaterialCommunityIcons name="account-sync" size={26} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optTitle, cardTxt]}>{t('existingCustomer')}</Text>
                  <Text style={[s.optDesc, cardTxt]}>{t('existingCustomerDesc')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.purple} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </View>

      <Text style={s.poweredBy}>Powered by 369ai · v1.0.0</Text>
      <NexFooter />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5EEFB' },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 4 },
  hero: { width: 224, height: 184, marginTop: 6, marginBottom: 6 },

  stage: { flex: 1 },
  panel: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },

  title: { fontFamily: SERIF, fontSize: 32, lineHeight: 39, color: COLORS.purpleDeep, textAlign: 'center' },
  titleAlt: { fontSize: 20, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 2, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  line: { width: 54, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 10 },
  sub: { fontSize: 15, color: COLORS.muted, textAlign: 'center', marginTop: 12 },
  subAlt: { fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 3 },

  cards: { width: '100%', marginTop: 20 },
  opt: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 20,
    padding: 18, marginTop: 14, borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#4A2F6B', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  optPrimary: { borderColor: '#DCCBF0' },
  flag: { fontSize: 32 },
  ic: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 17, fontWeight: '800', color: COLORS.purpleDeep },
  optDesc: { fontSize: 12.5, color: COLORS.muted, marginTop: 3 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#D7C7EA', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },

  poweredBy: { textAlign: 'center', fontSize: 11.5, color: COLORS.muted, fontWeight: '600', letterSpacing: 0.3, paddingBottom: 6 },
});
