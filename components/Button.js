// Primary purple button + a subtle secondary (outline/ghost) variant.
import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export default function Button({ title, onPress, loading, disabled, variant = 'primary', style }) {
  const ghost = variant === 'ghost';
  return (
    <TouchableOpacity
      style={[ghost ? s.ghost : s.primary, (disabled || loading) && { opacity: 0.6 }, style]}
      onPress={onPress}
      activeOpacity={0.9}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={ghost ? COLORS.purple : '#fff'} />
      ) : (
        <Text style={ghost ? s.ghostTxt : s.primaryTxt}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  primary: { backgroundColor: COLORS.purple, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ghost: { backgroundColor: COLORS.lavenderSoft, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  ghostTxt: { color: COLORS.purpleDark, fontSize: 16, fontWeight: '800' },
});
