// Screen 0 — Language selection. The FIRST screen the customer sees when the
// tablet is handed over. Two choices only: English and Arabic. Picking one sets
// the app language and continues to the Welcome screen.
import React from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import { useLang } from '../../LanguageContext';

const SERIF = 'PlayfairDisplay_700Bold';

// Only the two languages the manager asked for.
const CHOICES = [
  { code: 'en', name: 'English', hint: 'English', flag: '🇬🇧' },
  { code: 'ar', name: 'العربية', hint: 'Arabic', flag: '🇴🇲' },
];

export default function LanguageSelectScreen({ onDone, onHome }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 40, 460);
  const { setLang } = useLang();

  function pick(code) {
    setLang(code);
    onDone();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />

      <View style={[s.top, { paddingTop: insets.top + 28 }]}>
        {/* NexGenn brand, moved up from the footer.
            Long-press the logo to end the session (reception only). */}
        <TouchableOpacity onLongPress={onHome} delayLongPress={800} activeOpacity={1}>
          <Image source={require('../../assets/nexgen_dark.png')} style={s.logo} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      <View style={s.body}>
        <View style={{ width: contentW, alignItems: 'center' }}>
          <View style={s.globe}><Ionicons name="globe-outline" size={38} color={COLORS.purple} /></View>
          <Text style={s.title}>Select Your Language</Text>
          <Text style={s.sub}>اختر لغتك</Text>

          <View style={{ width: '100%', marginTop: 26 }}>
            {CHOICES.map((c) => (
              <TouchableOpacity key={c.code} style={s.card} activeOpacity={0.9} onPress={() => pick(c.code)}>
                <Text style={s.flag}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{c.name}</Text>
                  <Text style={s.hint}>{c.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.purple} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  top: { alignItems: 'center', paddingBottom: 8 },
  logo: { width: 210, height: 42 },   // 5:1, matching nexgen_dark.png

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  globe: { width: 74, height: 74, borderRadius: 37, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: SERIF, fontSize: 26, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 16 },
  sub: { fontSize: 18, color: COLORS.muted, textAlign: 'center', marginTop: 6, fontWeight: '600' },

  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20,
    paddingVertical: 20, paddingHorizontal: 22, marginTop: 14, borderWidth: 1.5, borderColor: '#EADFF6',
    shadowColor: '#4A2F6B', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  flag: { fontSize: 34, marginRight: 16 },
  name: { fontSize: 22, fontWeight: '900', color: COLORS.purpleDeep },
  hint: { fontSize: 12.5, color: COLORS.muted, marginTop: 3, fontWeight: '600' },
});

