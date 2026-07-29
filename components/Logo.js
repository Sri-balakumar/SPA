// The spa wordmark — a lotus above a lowercase "spa".
// Placeholder mark (emoji lotus); swap for a real logo image later if wanted.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export default function Logo({ size = 'large', tagline = true }) {
  const big = size === 'large';
  return (
    <View style={s.wrap}>
      <Text style={[s.lotus, big ? { fontSize: 46 } : { fontSize: 30 }]}>🪷</Text>
      <Text style={[s.word, big ? { fontSize: 44 } : { fontSize: 30 }]}>spa</Text>
      {tagline && big && <Text style={s.tag}>Relax. Refresh. Rejuvenate.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center' },
  lotus: { marginBottom: 2 },
  word: { color: COLORS.purpleDeep, fontWeight: '800', letterSpacing: 1, fontStyle: 'italic' },
  tag: { color: COLORS.purple, fontSize: 13, fontWeight: '600', marginTop: 4, letterSpacing: 0.5 },
});
