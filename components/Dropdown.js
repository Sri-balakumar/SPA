// Labeled dropdown: shows a field that opens a modal list of options.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export default function Dropdown({ label, required, value, options, onSelect, placeholder }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.wrap}>
      {!!label && (
        <Text style={s.label}>
          {label}{required ? <Text style={s.req}> *</Text> : null}
        </Text>
      )}
      <TouchableOpacity style={s.field} activeOpacity={0.8} onPress={() => setOpen(true)}>
        <Text style={[s.value, !value && { color: '#B4A9C4' }]} numberOfLines={1}>
          {value || placeholder || 'Select'}
        </Text>
        <Text style={s.chev}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            {!!label && <Text style={s.sheetTitle}>{label}</Text>}
            <FlatList
              data={options}
              keyExtractor={(item) => String(item)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.row}
                  onPress={() => { onSelect(item); setOpen(false); }}
                >
                  <Text style={[s.rowTxt, item === value && { color: COLORS.purple, fontWeight: '800' }]}>{item}</Text>
                  {item === value && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginBottom: 7 },
  req: { color: COLORS.purple },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.field, borderWidth: 1.4, borderColor: COLORS.line,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
  },
  value: { fontSize: 15, color: COLORS.ink, flex: 1 },
  chev: { fontSize: 15, color: COLORS.muted, paddingLeft: 8 },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  // maxWidth keeps the sheet a compact centred card instead of stretching to
  // the full width of a tablet screen — same sizing as the language popup.
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 6,
    width: '100%', maxWidth: 300, maxHeight: '65%', overflow: 'hidden',
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, padding: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  rowTxt: { fontSize: 15, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
