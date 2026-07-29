// Branded top bar for every form step — matches the service/package pages:
// soft lavender gradient with a rounded bottom, a back arrow (left), a centered
// serif title and a subtitle.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

const SERIF = 'PlayfairDisplay_700Bold';

export default function StepHeader({ title, subtitle, onBack }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={['#EFE6F8', '#F5EFFb']} style={[s.wrap, { paddingTop: insets.top + 10 }]}>
      <View style={s.row}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={hit}>
            <Ionicons name="chevron-back" size={26} color={COLORS.purpleDeep} />
          </TouchableOpacity>
        ) : <View style={{ width: 26 }} />}
        <View style={{ width: 26 }} />
      </View>
      <Text style={s.title}>{title}</Text>
      {!!subtitle && <Text style={s.sub}>{subtitle}</Text>}
    </LinearGradient>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };
const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 18, paddingBottom: 18,
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: SERIF, fontSize: 26, color: COLORS.purpleDeep, textAlign: 'center', marginTop: 4 },
  sub: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 6 },
});
