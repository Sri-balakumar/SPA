// Screen 6 — Review & Confirm. Shows everything the customer entered, then
// Submit Request creates a Spa Booking in Odoo (the receptionist sees it).
// (The "I agree" + signature step now lives on the Health/Questions screen.)
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS, SHADOW } from '../../theme';
import AppAlert from '../../components/AppAlert';
import StepHeader from '../../components/StepHeader';
import Button from '../../components/Button';
import { submitBooking, saveHealthOnFile } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { money } from '../../dateFmt';

function Row({ label, value }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export default function ReviewScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [alertBox, setAlertBox] = useState(null);

  async function submit() {
    setBusy(true);
    try {
      console.log('[SUBMIT] sending booking →', JSON.stringify({
        serviceId: form.serviceId, package: form.packageName,
        name: form.fullName, phone: `${form.countryCode} ${form.phone}`,
        answers: (form.answers || []).length, hasSignature: !!form.signature,
      }));
      const res = await submitBooking(form);        // { success, booking_ref, id }
      console.log('[SUBMIT] ok →', JSON.stringify(res));
      // Answers given this time (not the on-file ones reused) become the
      // customer's answers on file, as the POS does after a booking.
      if (!form.healthOk && form.existingCustomerId && form.healthMap) {
        await saveHealthOnFile(form.existingCustomerId, form.healthMap, form.signature);
      }
      set({ bookingToken: res?.booking_ref || '' });
      next();
    } catch (e) {
      // Log everything the server sent back — `message` alone often hides the
      // real Odoo cause, which lives in e.odoo.data.
      console.log('[SUBMIT] FAILED →', e.message);
      console.log('[SUBMIT] odoo error →', JSON.stringify(e.odoo || null, null, 2));
      console.log('[SUBMIT] payload was →', JSON.stringify(form, null, 2));
      const detail = e.odoo?.data?.message || e.odoo?.message || e.message || t('tryAgain');
      setAlertBox({ title: t('couldNotSubmit'), message: detail, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const genderAge = [form.gender, form.age !== '' ? `${form.age} yrs` : ''].filter(Boolean).join(' / ');
  const answered = (form.answers || []).filter((a) => a.value).length;

  // Itemise the extras and show what will actually be charged. Read off the
  // package payload rather than any stored figure, so the total here cannot
  // disagree with the one on the package screen.
  const offered = form.package?.addons || [];
  const chosen = offered.filter((a) => (form.addonIds || []).includes(a.id));
  const total = (Number(form.package?.price) || 0)
    + chosen.reduce((sum, a) => sum + (Number(a.price) || 0), 0);

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <StepHeader title={t('reviewTitle')} subtitle={t('reviewSub')} onBack={onBack} onHome={onHome} />

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.card}>
          <Row label={t('name')} value={form.fullName} />
          <Row label={t('service')} value={form.service} />
          <Row label={t('genderAge')} value={genderAge} />
          <Row label={t('mobile')} value={form.phone} />
          <Row label={t('whatsapp')} value={form.whatsapp} />
          <Row label={t('dob')} value={form.dob} />
          <Row label={t('specialReq')} value={form.specialRequests} />
          <Row label={t('qAnswered')} value={form.healthOk ? t('healthOnFile') : (answered ? `${answered}` : '')} />
          {chosen.length ? (
            <Row label={t('addonsLabel')} value={chosen.map((a) => a.name).join(', ')} />
          ) : null}
        </View>

        {/* Only worth a card of its own once there is more than the package
            price to add up. */}
        {chosen.length ? (
          <View style={s.card}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>{t('reviewTotal')}</Text>
              <Text style={s.totalValue}>{money(total, lang)}</Text>
            </View>
          </View>
        ) : null}

        <Button title={busy ? t('submitting') : t('submit')} onPress={submit} loading={busy} style={{ marginTop: 4 }} />
      </ScrollView>

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scroll: { padding: 18, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 16, ...SHADOW },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 11, borderTopWidth: 1, borderTopColor: COLORS.line },
  rowLabel: { fontSize: 13.5, fontWeight: '700', color: COLORS.muted, flex: 1 },
  rowValue: { fontSize: 14, color: COLORS.ink, flex: 1.4, textAlign: 'right', fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14.5, fontWeight: '800', color: COLORS.ink },
  totalValue: { fontSize: 18, fontWeight: '900', color: COLORS.purple },
});
