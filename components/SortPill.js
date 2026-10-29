// Compact "Sort by" chip for a list: ⇅ + the current order + ▾. Tapping opens
// a small sheet of the orders, the current one ticked and the one set in Odoo
// (Settings > Default ... order) badged "Default".
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { useLang } from '../LanguageContext';

// options: [{ key, label }]   value / defaultKey: option keys
export default function SortPill({ options, value, defaultKey, onChange }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) || options[0];

  return (
    <View style={[s.bar, rtl && s.barRtl]}>
      <TouchableOpacity style={[s.pill, rtl && s.rowRtl]} activeOpacity={0.85} onPress={() => setOpen(true)}>
        <Ionicons name="swap-vertical" size={16} color={COLORS.purple} />
        <Text style={s.pillLbl}>{t('sortBy')}:</Text>
        <Text style={s.pillVal} numberOfLines={1}>{current.label}</Text>
        <Ionicons name="chevron-down" size={15} color={COLORS.muted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={[s.sheetTitle, rtl && s.rtlTxt]}>{t('sortBy')}</Text>
            {options.map((o) => {
              const on = o.key === current.key;
              return (
                <TouchableOpacity key={o.key} style={[s.row, on && s.rowOn, rtl && s.rowRtl]} activeOpacity={0.85}
                  onPress={() => { onChange(o.key); setOpen(false); }}>
                  <Text style={[s.rowTxt, on && s.rowTxtOn, rtl && s.rtlTxt]}>{o.label}</Text>
                  {o.key === defaultKey ? (
                    <View style={s.badge}><Text style={s.badgeTxt}>{t('sortDefault')}</Text></View>
                  ) : null}
                  <View style={s.tickBox}>
                    {on ? <Ionicons name="checkmark" size={18} color={COLORS.purple} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  barRtl: { justifyContent: 'flex-start' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.line, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  rowRtl: { flexDirection: 'row-reverse' },
  pillLbl: { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  pillVal: { fontSize: 13, color: COLORS.purpleDeep, fontWeight: '800', flexShrink: 1 },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  // Same compact centred card as the other pop-up lists.
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 6,
    width: '100%', maxWidth: 320, overflow: 'hidden',
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: COLORS.purpleDeep, padding: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  rowOn: { backgroundColor: COLORS.field },
  rowTxt: { flex: 1, fontSize: 15, color: COLORS.ink },
  rowTxtOn: { color: COLORS.purple, fontWeight: '800' },
  rtlTxt: { textAlign: 'right' },
  badge: { backgroundColor: COLORS.lavenderSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '800', color: COLORS.purple },
  tickBox: { width: 20, alignItems: 'center' },
});
