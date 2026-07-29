// Shared header for the existing-customer flow — SAME design as the Service page:
// a soft lavender band with [back]  [English] on top, the stretch & go logo
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

export default function BrandHeader({ title, subtitle, onBack, onHome, titleSize = 27 }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.header, { paddingTop: insets.top + 10 }]}>
      <View style={s.headTop}>
        {onBack
          ? <TouchableOpacity onPress={onBack} hitSlop={hit}><Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} /></TouchableOpacity>
          : <View style={{ width: 40 }} />}
        <LangButton />
      </View>
      <TouchableOpacity onLongPress={onHome} delayLongPress={800} activeOpacity={1} style={{ alignSelf: 'center' }}>
        <Image source={require('../assets/stretchandgo_black.png')} style={s.logo} resizeMode="contain" />
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
  logo: { width: 190, height: 44, alignSelf: 'center', marginTop: 2, marginBottom: 2 },
  title: { fontFamily: SERIF, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 2 },
  divider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  line: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 8 },
});
