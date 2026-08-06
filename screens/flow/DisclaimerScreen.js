// Screen 5 — the therapy's disclaimer, and the consent given against it.
//
// The tick and the signature live HERE, not on the questions screen where they
// used to be. Consenting on the questions page meant agreeing to text that had
// never been shown - the wording is per-therapy and written in Odoo, so the
// customer has to see it on the page they accept it on. This mirrors what the
// POS and the public booking page now do.
//
// The screen only exists when the therapy actually has a waiver: App.js skips
// it entirely when form.disclaimer is null, so there is no blank page to sign.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS, SHADOW } from '../../theme';
import AppAlert from '../../components/AppAlert';
import StepHeader from '../../components/StepHeader';
import Button from '../../components/Button';
import SignaturePad from '../../components/SignaturePad';
import RichText from '../../components/RichText';
import PersonBanner from '../../components/PersonBanner';
import { useLang } from '../../LanguageContext';

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={s.ciRow}>
      <Text style={s.ciLabel}>{label}</Text>
      <Text style={s.ciValue}>{value}</Text>
    </View>
  );
}

export default function DisclaimerScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const [agree, setAgree] = useState(!!form.terms);
  const [alertBox, setAlertBox] = useState(null);
  const showAlert = (title, message, tone = 'error') => setAlertBox({ title, message, tone });

  const disclaimer = form.disclaimer || {};

  function proceed() {
    // The tick first, then the signature that stands for it.
    if (!agree) return showAlert(t('missing'), t('agreeFirst'));
    if (!form.signature) return showAlert(t('missing'), t('signatureRequired'));
    set({ terms: true });
    next();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <StepHeader
        title={disclaimer.title || t('disclaimerTitle')}
        subtitle={t('disclaimerSub')}
        onBack={onBack}
        onHome={onHome}
      />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Consent is per person: each signs for the health history they gave. */}
        <PersonBanner form={form} />

        {/* The waiver. Capped so a long one cannot push Continue off screen -
            it scrolls inside its own card instead. */}
        <View style={s.card}>
          <ScrollView style={s.bodyBox} nestedScrollEnabled>
            <RichText html={disclaimer.body} rtl={rtl} />
          </ScrollView>
        </View>

        {/* Read-only: what the customer already typed, restated so the consent
            record says who gave it. */}
        <View style={s.card}>
          <Text style={[s.ciHead, rtl && s.rtl]}>{t('clientInfo')}</Text>
          <InfoRow label={t('fullName')} value={form.fullName} />
          {/* The lead is contacted on `phone`; persons 2+ have their own optional
              number, so showing the lead's here would attribute it to them. */}
          <InfoRow
            label={t('phone')}
            value={(form.memberIndex || 0) === 0
              ? (form.phone ? `${form.countryCode} ${form.phone}` : '')
              : (form.memberPhone || '')}
          />
          <InfoRow label={t('email')} value={form.email} />
        </View>

        <View style={s.card}>
          <TouchableOpacity
            style={[s.agreeRow, rtl && s.agreeRowRtl]}
            onPress={() => setAgree((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[s.box, agree && s.boxOn]}>
              {agree ? <Text style={s.tick}>✓</Text> : null}
            </View>
            <Text style={[s.agreeTxt, rtl && s.rtl]}>{t('agreeToThis')}</Text>
          </TouchableOpacity>

          {agree ? (
            <SignaturePad
              label={t('signature')}
              required
              hint={t('signHint')}
              clearLabel={t('clearSign')}
              onChange={(sig) => set({ signature: sig })}
              rtl={rtl}
            />
          ) : null}
        </View>

        <Button title={t('next')} onPress={proceed} style={{ marginTop: 4 }} />
      </ScrollView>

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scroll: { padding: 18, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 14, ...SHADOW },
  // Only the frame is styled. Colour, weight and size arrive inside the wording
  // itself from the therapy's own editor, so anything set here that the operator
  // can also choose would fight with it.
  bodyBox: { maxHeight: 300 },
  ciHead: { fontSize: 13, fontWeight: '800', color: COLORS.purpleDeep, marginBottom: 4, letterSpacing: 0.3 },
  ciRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderTopWidth: 1, borderTopColor: COLORS.line },
  ciLabel: { fontSize: 13, fontWeight: '700', color: COLORS.muted, flex: 1 },
  ciValue: { fontSize: 13.5, color: COLORS.ink, flex: 1.4, textAlign: 'right', fontWeight: '600' },
  agreeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  agreeRowRtl: { flexDirection: 'row-reverse' },
  box: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: COLORS.line,
    alignItems: 'center', justifyContent: 'center', marginRight: 11, backgroundColor: '#fff',
  },
  boxOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  tick: { color: '#fff', fontSize: 15, fontWeight: '900', lineHeight: 18 },
  agreeTxt: { flex: 1, fontSize: 13.5, color: COLORS.ink, fontWeight: '600', lineHeight: 20 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
