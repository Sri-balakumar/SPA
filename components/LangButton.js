// Globe language switcher — shows current language, opens a picker.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { useLang, LANGS } from '../LanguageContext';

export default function LangButton() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.code === lang) || LANGS[0];

  return (
    <>
      <TouchableOpacity style={s.btn} onPress={() => setOpen(true)} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="globe-outline" size={18} color={COLORS.purpleDeep} />
        <Text style={s.lbl}>{current.label}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.title}>Language / اللغة</Text>
            {LANGS.map((l) => (
              <TouchableOpacity key={l.code} style={s.row} onPress={() => { setLang(l.code); setOpen(false); }}>
                <Text style={[s.rowTxt, l.code === lang && { color: COLORS.purple, fontWeight: '800' }]}>{l.label}</Text>
                {l.code === lang && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line },
  lbl: { fontSize: 12, fontWeight: '700', color: COLORS.purpleDeep },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  // maxWidth is the fix: without it the sheet stretched to the full width of a
  // tablet screen for two short rows. alignItems on the backdrop centres it.
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 6,
    width: '100%', maxWidth: 300, overflow: 'hidden',
  },
  title: { fontSize: 14, fontWeight: '800', color: COLORS.purpleDeep, textAlign: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13, borderTopWidth: 1, borderTopColor: COLORS.line },
  rowTxt: { fontSize: 17, color: COLORS.ink },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
});
