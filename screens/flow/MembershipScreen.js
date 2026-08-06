// Existing customer, screens 4 & 5 — Package Details + Check-In, then Booking
// Successful. Works on the single package the customer tapped on screen 3.
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import { checkInSession } from '../../spaApi';
import { useLang } from '../../LanguageContext';
import { formatDateTime, toDigits, money } from '../../dateFmt';

const SERIF = 'PlayfairDisplay_700Bold';
const CHECKIN_ERR = {
  no_sessions_left: 'This package has no sessions left.',
  pass_mismatch: 'This package belongs to a different phone number.',
  invalid_pass: 'This package could not be found.',
  unauthorized: 'Not authorized. Please ask reception.',
};

function DetailRow({ icon, label, value, valColor, last }) {
  return (
    <View style={[s.dRow, !last && s.dRowLine]}>
      <Ionicons name={icon} size={17} color={COLORS.purple} style={{ marginRight: 10 }} />
      <Text style={s.dLbl}>{label}</Text>
      <Text style={[s.dVal, valColor && { color: valColor }]}>{value}</Text>
    </View>
  );
}

function DoneRow({ icon, label, value, valColor }) {
  return (
    <View style={s.doneRow}>
      <Ionicons name={icon} size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
      <Text style={s.doneLbl}>{label}</Text>
      <Text style={[s.doneVal, valColor && { color: valColor }]}>{value}</Text>
    </View>
  );
}

export default function MembershipScreen({ form, onBack, onHome, onDone }) {
  const { t, lang } = useLang();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 500);
  const pkg = form.selectedPackage || {};
  const total = pkg.sessions_total || 0;
  const [used] = useState(pkg.sessions_used || 0);
  const [view, setView] = useState('detail');   // 'detail' | 'done'
  const [busy, setBusy] = useState(false);

  const remaining = Math.max(0, total - used);
  const done = remaining <= 0;
  const sessionNo = Math.min(total, used + 1);
  // What's left AFTER today's session (shown on the success screen).
  const remainingAfter = Math.max(0, total - sessionNo);

  const dateTime = formatDateTime(new Date(), lang);

  async function checkIn() {
    if (done || busy) return;
    setBusy(true);
    try {
      // The pass is redeemed; reception counts the session when the visit is
      // marked done, so sessions_left stays the same for now (by design).
      await checkInSession(pkg, form.mobile || form.phone);
      setBusy(false);
      setView('done');
    } catch (e) {
      setBusy(false);
      Alert.alert('Could not check in', CHECKIN_ERR[e.message] || e.message || 'Please try again.');
    }
  }

  if (view === 'done') {
    return (
      <View style={s.root}>
        <StatusBar style="dark" />
        <BrandHeader onHome={onHome} />
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 20 }]}>
          <View style={{ width: contentW, alignItems: 'center' }}>
            <View style={s.checkWrap}>
              <View style={[s.dot, { top: 2, left: '26%', backgroundColor: '#E7B84B' }]} />
              <View style={[s.dot, { top: 10, right: '22%', backgroundColor: COLORS.purple }]} />
              <View style={[s.dot, { bottom: 8, left: '20%', backgroundColor: COLORS.green }]} />
              <View style={[s.dot, { bottom: 2, right: '28%', backgroundColor: '#E7724B' }]} />
              <View style={s.check}><Ionicons name="checkmark" size={46} color="#fff" /></View>
            </View>
            <Text style={s.doneTitle}>{t('bookingSuccessful')}</Text>
            <Text style={s.doneSub}>{t('bookingSuccessSub')}</Text>

            <View style={s.doneCard}>
              <DoneRow icon="body-outline" label={t('service')} value={pkg.service_name} />
              <DoneRow icon="time-outline" label={t('dateTimeLabel')} value={dateTime} />
              <DoneRow icon="repeat-outline" label={t('sessionLabel')} value={`${t('sessionWord')} ${toDigits(sessionNo, lang)} ${t('ofWord')} ${toDigits(total, lang)}`} />
              <DoneRow icon="ticket-outline" label={t('remainingSessions')} value={`${toDigits(remainingAfter, lang)} ${remainingAfter === 1 ? t('sessionWord') : t('sessionsWord')}`} valColor={COLORS.green} />
            </View>

            <TouchableOpacity style={[s.cta, { width: '100%' }]} activeOpacity={0.9} onPress={onDone}>
              <Text style={s.ctaTxt}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader onBack={onBack} onHome={onHome} />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 20 }]}>
        <View style={{ width: contentW }}>
          <View style={s.hero}>
            <View style={s.heroThumb}><MaterialCommunityIcons name="yoga" size={28} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroName}>{pkg.service_name}</Text>
              <Text style={s.heroPack}>{pkg.package_name}</Text>
            </View>
            <View style={[s.badge, done ? s.badgeDone : s.badgeActive]}>
              <Text style={[s.badgeTxt, { color: done ? '#EDE7F6' : '#DFF6E7' }]}>{done ? t('completed') : t('active')}</Text>
            </View>
          </View>

          <View style={s.card}>
            <DetailRow icon="albums-outline" label={t('packageTotal')} value={`${toDigits(total, lang)} ${t('sessionsWord')}`} />
            <DetailRow icon="checkmark-done-outline" label={t('completedSessions')} value={`${toDigits(used, lang)} ${t('sessionsWord')}`} />
            <DetailRow icon="ticket-outline" label={t('remainingSessions')} value={`${toDigits(remaining, lang)} ${t('sessionsWord')}`} valColor={COLORS.green} />
            <DetailRow icon="time-outline" label={t('sessionDuration')} value={`${toDigits(pkg.duration || 0, lang)} ${t('minutesWord')}`} />
            <DetailRow icon="pricetag-outline" label={t('pricePerSession')} value={money(pkg.price_per_session || 0, lang)} />
            <DetailRow icon="calendar-outline" label={t('validTill')} value={pkg.valid_till || '—'} last />
          </View>

          {!done && (
            <View style={s.next}>
              <View style={s.nextTop}>
                <Text style={s.nextLbl}>{t('nextSession')}</Text>
                <Text style={s.nextVal}>{t('sessionWord')} {toDigits(sessionNo, lang)}</Text>
              </View>
              <Text style={s.nextHint}>{t('checkInHint')}</Text>
            </View>
          )}

          <TouchableOpacity style={[s.cta, (busy || done) && { opacity: 0.55 }]} activeOpacity={0.9} onPress={checkIn} disabled={busy || done}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={s.ctaTxt}>{done ? t('allCompleted') : t('checkInToday')}</Text>
                {!done && <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />}
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Text style={[s.powered, { paddingBottom: insets.bottom + 10 }]}>Powered by NexGenn POS</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  body: { alignItems: 'center', paddingTop: 6 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.purple, borderRadius: 18, padding: 16 },
  heroThumb: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroName: { fontSize: 16.5, fontWeight: '900', color: '#fff' },
  heroPack: { fontSize: 13, color: '#EBDFF7', marginTop: 2, fontWeight: '600' },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeActive: { backgroundColor: 'rgba(59,167,118,0.9)' },
  badgeDone: { backgroundColor: 'rgba(255,255,255,0.22)' },
  badgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },

  card: { backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4, marginTop: 14, shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  dRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  dRowLine: { borderBottomWidth: 1, borderBottomColor: COLORS.line },
  dLbl: { flex: 1, fontSize: 14, color: COLORS.ink, fontWeight: '600' },
  dVal: { fontSize: 14, fontWeight: '900', color: COLORS.purpleDeep },

  next: { backgroundColor: COLORS.lavenderSoft, borderRadius: 16, padding: 16, marginTop: 14 },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextLbl: { fontSize: 14, fontWeight: '800', color: COLORS.purpleDeep },
  nextVal: { fontSize: 14, fontWeight: '900', color: COLORS.purple },
  nextHint: { fontSize: 12.5, color: COLORS.muted, marginTop: 6, fontWeight: '600' },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16, marginTop: 18 },
  ctaTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },

  checkWrap: { width: 150, height: 120, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5 },
  check: { width: 92, height: 92, borderRadius: 46, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontFamily: SERIF, fontSize: 25, color: COLORS.purpleDeep, marginTop: 6 },
  doneSub: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },

  doneCard: { alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 18, padding: 18, marginTop: 20, shadowColor: '#4A2F6B', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  doneRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  doneLbl: { width: 96, fontSize: 13, color: COLORS.muted, fontWeight: '700' },
  doneVal: { flex: 1, fontSize: 13.5, fontWeight: '900', color: COLORS.purpleDeep, textAlign: 'right', lineHeight: 18 },

  powered: { textAlign: 'center', fontSize: 11.5, color: COLORS.muted, fontWeight: '600', paddingTop: 8 },
});
