// Labeled text input matching the mockup (label above, rounded field).
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export default function Input({
  label, required, value, onChangeText, placeholder, keyboardType,
  multiline, maxLength, autoCapitalize, right,
}) {
  return (
    <View style={s.wrap}>
      {!!label && (
        <Text style={s.label}>
          {label}{required ? <Text style={s.req}> *</Text> : null}
        </Text>
      )}
      <View style={[s.field, multiline && { alignItems: 'flex-start' }]}>
        <TextInput
          style={[s.input, multiline && { height: 80, textAlignVertical: 'top' }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#B4A9C4"
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
        />
        {right}
      </View>
      {typeof maxLength === 'number' && multiline && (
        <Text style={s.count}>{(value || '').length}/{maxLength}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginBottom: 7 },
  req: { color: COLORS.purple },
  field: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field,
    borderWidth: 1.4, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: COLORS.ink },
  count: { alignSelf: 'flex-end', fontSize: 11, color: COLORS.muted, marginTop: 4 },
});
