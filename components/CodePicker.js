// Compact country-code selector shown as a prefix inside phone fields.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { COUNTRY_CODES } from '../data/options';

export default function CodePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={s.btn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={s.code}>{value || '+91'}</Text>
        <Text style={s.chev}>▾</Text>
      </TouchableOpacity>
      <View style={s.sep} />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.title}>Country code</Text>
            <FlatList
              data={COUNTRY_CODES}
              keyExtractor={(i) => i}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.row} onPress={() => { onChange(item); setOpen(false); }}>
                  <Text style={[s.rowTxt, item === value && { color: COLORS.purple, fontWeight: '800' }]}>{item}</Text>
                  {item === value && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  code: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  chev: { fontSize: 12, color: COLORS.muted, marginLeft: 3 },
  sep: { width: 1, height: 22, backgroundColor: COLORS.line, marginRight: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(46,36,64,0.45)', justifyContent: 'center', padding: 40 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  title: { fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, padding: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: COLORS.line },
  rowTxt: { fontSize: 16, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
