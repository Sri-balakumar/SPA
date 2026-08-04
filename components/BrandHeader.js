// Shared header for the existing-customer flow — SAME design as the Service page:
// a soft lavender band with [back]  [English] on top, the NexGenn logo
// centred, then an optional serif title + tulip divider + subtitle.
// Long-press the logo ends the session (reception only).
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import LangButton from './LangButton';

const SERIF = 'PlayfairDisplay_700Bold';
const hit = { top: 10, bottom: 10, left: 10, right: 10 };

// `logo` / `logoStyle` override the default brand mark for screens that show a
// different one (the Welcome/language screen uses the NexGenn logo). Omitting
// them keeps the default NexGenn header used by the rest of the flow.
// `showLang={false}` hides the top-right language switcher — used on the
// Welcome screen, where picking the language IS the content.
// `onLogoPress` is the tap handler on the brand mark (the Welcome screen uses
// it for the hidden 7-tap service gesture); `rightExtra` renders before the
// language switcher in the top row — that's where the service gear goes.
export default function BrandHeader({
  title, subtitle, onBack, onHome, titleSize = 27, logo, logoStyle,
  showLang = true, onLogoPress, rightExtra,
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 10 }]}>
      <View style={s.headTop}>
        {onBack
          ? <TouchableOpacity onPress={onBack} hitSlop={hit}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
          : <View style={{ width: 40 }} />}
        <View style={s.headRight}>
          {rightExtra}
          {showLang ? <LangButton /> : null}
        </View>
      </View>
      <TouchableOpacity
        onPress={onLogoPress}
        onLongPress={onHome}
        delayLongPress={800}
        activeOpacity={1}
        style={{ alignSelf: 'center' }}
      >
        <Image
          source={logo || require('../assets/nexgen_dark.png')}
          style={[s.logo, logoStyle]}
          resizeMode="contain"
        />
      </TouchableOpacity>
      {!!title && <Text style={[s.title, { fontSize: titleSize }]}>{title}</Text>}
      {!!title && (
        <View style={s.divider}>
          <View style={s.line} />
          <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
          <View style={s.line} />
        </View>
      )}
      {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingBottom: 16, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  // Fixed min width keeps the row balanced whether or not the gear is showing.
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 40, justifyContent: 'flex-end' },
  // NexGenn mark at its 5:1 aspect (so `resizeMode="contain"` doesn't
  // letterbox), sized to match the Welcome/language screen.
  logo: { width: 320, height: 68, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
  title: { fontFamily: SERIF, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 2 },
  divider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  line: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 8 },
});
