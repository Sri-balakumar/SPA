// Shared vendor footer — SAME as the Service page: the NexGenn POS logo
// between two short hairlines.
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme';

export default function NexFooter() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.footer, { paddingBottom: insets.bottom + 6 }]}>
      <View style={s.line} />
      <Image source={require('../assets/nexgen_dark.png')} style={s.logo} resizeMode="contain" />
      <View style={s.line} />
    </View>
  );
}

const s = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingHorizontal: 20 },
  line: { flex: 1, height: 1, backgroundColor: COLORS.line, maxWidth: 55 },
  logo: { width: 150, height: 30, marginHorizontal: 12 },
});
