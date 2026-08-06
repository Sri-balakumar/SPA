// "Person 2 of 3" — shown on the details, questions and disclaimer screens when
// the booking covers more than one person.
//
// Renders nothing on an individual booking, so that flow looks exactly as it
// always did. One shared component because all three screens need the identical
// strip, and three copies would drift.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { useLang } from '../LanguageContext';

export default function PersonBanner({ form, note }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const total = { family_2: 2, family_3: 3, family_4: 4 }[form.memberType] || 1;
  if (total < 2) return null;

  const index = form.memberIndex || 0;
  return (
    <View style={[s.wrap, rtl && s.wrapRtl]}>
      <Text style={s.badge}>
        {t('personOf').replace('%1', String(index + 1)).replace('%2', String(total))}
      </Text>
      <Text style={[s.note, rtl && s.rtl]} numberOfLines={2}>
        {note || (index === 0 ? t('leadPersonNote') : t('memberPersonNote'))}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3E9FC',
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14,
  },
  wrapRtl: { flexDirection: 'row-reverse' },
  badge: {
    fontSize: 12.5, fontWeight: '900', color: '#fff', backgroundColor: COLORS.purple,
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, overflow: 'hidden',
    marginRight: 10,
  },
  note: { flex: 1, fontSize: 12.5, color: COLORS.purpleDeep, fontWeight: '600', lineHeight: 17 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
