// Screen 3 — Personal Information (New Customer flow).
// It now opens on a MOBILE LOOKUP step:
//   1) 'lookup'   — enter mobile + "Find My Details"
//   2) 'profiles' — if the number exists, pick your profile → auto-fills the form
//                   (or "Not you? Register as New Customer")
//      if not found — a "Register as New Customer" button appears
//   3) 'form'     — the full details form (pre-filled for returning customers,
//                   empty for new ones); everything stays editable before Next.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import StepHeader from '../../components/StepHeader';
import BrandHeader from '../../components/BrandHeader';
import Dropdown from '../../components/Dropdown';
import Button from '../../components/Button';
import CodePicker from '../../components/CodePicker';
import AppAlert from '../../components/AppAlert';
import { phoneRule, digitsOnly } from '../../data/phoneRules';
import { findMembership } from '../../spaApi';
import { useLang } from '../../LanguageContext';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function ageFrom(d) {
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
// Get the LOCAL number only (no country code) — keeps the code selector clean.
// Handles "+91 6359863259", "+916359863259" and "6359863259".
function localNumber(full, cc) {
  let s = String(full || '').trim();
  if (s.includes(' ')) return s.split(/\s+/).slice(1).join('').replace(/\D/g, '');
  s = s.replace(/\D/g, '');                       // digits only
  const ccd = String(cc || '').replace(/\D/g, ''); // "91"
  if (ccd && s.startsWith(ccd) && s.length > ccd.length) s = s.slice(ccd.length);
  return s;
}
// Normalise gender from the backend ("female" / "F" / "Male" …) to the form values.
function normGender(g) {
  const s = String(g || '').trim().toLowerCase();
  if (!s) return '';
  if (s[0] === 'f') return 'Female';
  if (s[0] === 'm') return 'Male';
  return 'Other';
}
// Build the DOB display text + ISO + age from whatever the backend sends.
function parseDob(dob, age) {
  let dobText = '', dobISO = '', a = age || '';
  if (dob) {
    const d = new Date(dob);
    if (!isNaN(d.getTime())) {
      dobText = fmt(d); dobISO = iso(d);
      if (!a) a = ageFrom(d);
    } else {
      dobText = String(dob);   // already a display string like "12 Feb 1990"
    }
  }
  return { dobText, dobISO, age: a };
}

export default function PersonalInfoScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 480);

  const [mode, setMode] = useState('lookup');       // 'lookup' | 'profiles' | 'form'
  const [prevMode, setPrevMode] = useState('lookup'); // where the form was opened from
  const [lookupCc, setLookupCc] = useState(form.countryCode || '+968');
  const [lookupIso, setLookupIso] = useState(form.countryIso || 'OM');
  const [lookupNum, setLookupNum] = useState(form.phone || '');

  // Digit count + validity per selected country, for the lookup field and for
  // the two fields on the form (phone and WhatsApp share one country).
  const lookupRule = phoneRule(lookupIso);
  const badLookup = !!lookupNum && !lookupRule.isValid(lookupNum);
  const formRule = phoneRule(form.countryIso || 'OM');
  const badPhone = !!form.phone && !formRule.isValid(form.phone);
  const badWa = !!form.whatsapp && !formRule.isValid(form.whatsapp);

  // Email must be a Gmail address: something before the @, then @gmail.com.
  const GMAIL_RE = /^[^\s@]+@gmail\.com$/i;
  const emailOk = GMAIL_RE.test((form.email || '').trim());
  const badEmail = !!form.email && !emailOk;   // red line only once they've typed
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [customers, setCustomers] = useState([]);

  const [showPicker, setShowPicker] = useState(false);
  const [dobDate, setDobDate] = useState(null);

  // In-app popup styled like the rest of the app, in place of the OS Alert.
  const [alertBox, setAlertBox] = useState(null);
  function showAlert(title, message, tone = 'error') {
    setAlertBox({ title, message, tone });
  }
  const gLabel = { Female: t('female'), Male: t('male'), Other: t('other') };
  const gValue = { [t('female')]: 'Female', [t('male')]: 'Male', [t('other')]: 'Other' };

  // ---- Lookup ----
  async function find() {
    if (!lookupNum.trim()) return showAlert(t('missing'), t('missingMobile'));
    setLoading(true);
    setNotFound(false);
    try {
      const full = `${lookupCc} ${lookupNum.trim()}`;
      const membership = await findMembership(full, lang);
      const list = membership?.customers || [];
      if (list.length) { setCustomers(list); setMode('profiles'); }
      else setNotFound(true);
    } catch (e) {
      showAlert(t('couldNotLookup'), e.message || t('tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  // Returning customer picked their profile → auto-fill ALL available details.
  function selectProfile(c) {
    const cc = lookupCc;                                  // keep the selected code (+91) intact
    const phoneNum = localNumber(c.phone, cc);
    const waRaw = c.whatsapp || c.phone;
    const waNum = localNumber(waRaw, cc);
    const same = !waRaw || waNum === phoneNum;
    const { dobText, dobISO, age } = parseDob(c.dob, c.age);
    set({
      fullName: c.name || '',
      dob: dobText,
      dobISO,
      age,
      gender: normGender(c.gender),
      email: c.email || '',
      countryCode: cc,
      phone: phoneNum,
      whatsapp: same ? phoneNum : waNum,
      whatsappSame: same,
      existingCustomerId: c.id || null,
    });
    setPrevMode('profiles');
    setMode('form');
  }

  // New customer → start a CLEAN, empty form (keep only the number they typed).
  function registerNew() {
    set({
      fullName: '', dob: '', dobISO: '', age: '', gender: '', email: '',
      countryCode: lookupCc, phone: lookupNum.trim(), whatsapp: lookupNum.trim(),
      whatsappSame: true, existingCustomerId: null,
    });
    setPrevMode(mode);                                    // remember lookup vs profiles for Back
    setNotFound(false);
    setMode('form');
  }

  function onPickDate(event, selected) {
    setShowPicker(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !selected) return;
    setDobDate(selected);
    set({ dob: fmt(selected), dobISO: iso(selected), age: ageFrom(selected) });
  }
  // Sanitise once at the source, so the mirrored WhatsApp copy is clean too.
  function onPhone(v) {
    const n = digitsOnly(v);
    set(form.whatsappSame ? { phone: n, whatsapp: n } : { phone: n });
  }
  function toggleSame() {
    const nextSame = !form.whatsappSame;
    set({ whatsappSame: nextSame, whatsapp: nextSame ? form.phone : '' });
  }
  function proceed() {
    if (!form.fullName.trim()) return showAlert(t('missing'), t('enterName'));
    // DOB is required for brand-new customers; returning ones may not have it on file yet.
    if (!form.existingCustomerId && !form.dob) return showAlert(t('missing'), t('selectDob'));
    if (!form.gender) return showAlert(t('missing'), t('selectGender'));
    if (!form.phone.trim()) return showAlert(t('missing'), t('enterPhone'));
    if (badPhone || badWa) return showAlert(t('missing'), t('phoneInvalid'));
    if (!form.whatsapp.trim()) return showAlert(t('missing'), t('enterWhatsapp'));
    // Email is required and must be a Gmail address.
    if (!emailOk) return showAlert(t('invalidEmail'), t('gmailOnly'));
    // Belt & braces: the picker's maximumDate already blocks future dates, but
    // guard the stored value too in case it ever arrives from elsewhere.
    if (form.dobISO && new Date(form.dobISO) > new Date())
      return showAlert(t('missing'), t('selectDob'));
    next();
  }

  // Back: profiles → lookup; form → wherever it was opened from (profiles or lookup).
  const backToLookup = () => { setMode('lookup'); setNotFound(false); };
  const backFromForm = () => { setMode(prevMode); };

  // ---------- 1) LOOKUP ----------
  if (mode === 'lookup') {
    return (
      <View style={s.root}>
        <StatusBar style="dark" />
        {/* Logo only — the heading moved into the centred block below so it
            sits next to the number field instead of pinned to the top. */}
        <BrandHeader onBack={onBack} onHome={onHome} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.centerScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ width: contentW }}>
              <Text style={s.bTitle}>{t('findMyDetails')}</Text>
              <View style={s.bDivider}>
                <View style={s.bLine} />
                <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
                <View style={s.bLine} />
              </View>
              <Text style={s.bSubtitle}>{t('lookupSub')}</Text>

              <Text style={[s.bLabel, rtl && s.rtl]}>{t('mobileNumber')}</Text>
              <View style={[s.bField, badLookup && s.fieldError]}>
                <CodePicker value={lookupCc} onChange={(d, iso) => { setLookupCc(d); setLookupIso(iso); }} />
                <TextInput style={s.bInput} placeholder={t('enterNDigits', { n: lookupRule.len })} placeholderTextColor="#B4A9C4"
                  keyboardType="phone-pad" maxLength={lookupRule.len}
                  value={lookupNum} onChangeText={(v) => { setLookupNum(digitsOnly(v)); setNotFound(false); }}
                  onSubmitEditing={find} returnKeyType="search" />
              </View>
              {badLookup && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

              <TouchableOpacity style={[s.cta, loading && { opacity: 0.7 }]} activeOpacity={0.9} onPress={find} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={s.ctaTxt}>{t('findMyDetails')}</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>

              {notFound ? (
                <View style={s.notFoundBox}>
                  <Ionicons name="person-add-outline" size={26} color={COLORS.purple} />
                  <Text style={[s.notFoundTxt, rtl && s.rtl]}>{t('notFoundMsg')}</Text>
                  <TouchableOpacity style={s.newBtn} activeOpacity={0.9} onPress={registerNew}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={s.newBtnTxt}>{t('newCustomer')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.secure}>
                  <Ionicons name="shield-checkmark" size={26} color={COLORS.purple} style={{ marginRight: 12 }} />
                  <Text style={[s.secureTxt, rtl && s.rtl]}>{t('findSecure')}</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
      </View>
    );
  }

  // ---------- 2) PROFILES ----------
  if (mode === 'profiles') {
    return (
      <View style={s.root}>
        <StatusBar style="dark" />
        <BrandHeader title={t('selectProfile')} subtitle={t('foundMultiple')} titleSize={24} onBack={backToLookup} onHome={onHome} />
        <ScrollView contentContainerStyle={s.centerTop}>
          <View style={{ width: contentW }}>
            {customers.map((c, i) => (
              <TouchableOpacity key={c.id ?? i} style={s.pCard} activeOpacity={0.9} onPress={() => selectProfile(c)}>
                <View style={s.avatar}><Ionicons name="person" size={22} color={COLORS.purple} /></View>
                <Text style={[s.pName, { flex: 1 }, rtl && s.rtl]}>{c.name}</Text>
                <Ionicons name="chevron-forward" size={20} color="#C9B9E0" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={s.newOutline} activeOpacity={0.85} onPress={registerNew}>
              <Ionicons name="add" size={18} color={COLORS.purple} />
              <Text style={s.newOutlineTxt}>{t('newCustomer')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ---------- 3) FORM ----------
  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <StepHeader title={t('personalTitle')} subtitle={t('personalSub')} onBack={backFromForm} onHome={onHome} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Full Name */}
          <Text style={s.label}>{t('fullName')} <Text style={s.req}>*</Text></Text>
          <View style={s.field}>
            <TextInput style={s.input} placeholder={t('fullNamePh')} placeholderTextColor="#B4A9C4"
              value={form.fullName} onChangeText={(v) => set({ fullName: v })} />
          </View>

          {/* Date of Birth */}
          <Text style={s.label}>{t('dob')} <Text style={s.req}>*</Text></Text>
          <TouchableOpacity style={s.field} activeOpacity={0.8} onPress={() => setShowPicker(true)}>
            <Text style={[s.inputText, !form.dob && { color: '#B4A9C4' }]}>{form.dob || t('dobPh')}</Text>
            <Text style={s.calIcon}>📅</Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker
              value={dobDate || new Date(2000, 0, 1)}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={onPickDate}
            />
          )}

          {/* Age (auto) + Gender */}
          <View style={s.row}>
            <View style={s.half}>
              <Text style={s.label}>{t('age')}</Text>
              <View style={[s.field, s.readonly]}>
                <Text style={[s.inputText, form.age === '' && { color: '#B4A9C4' }]}>
                  {form.age === '' ? t('auto') : `${form.age} ${t('years')}`}
                </Text>
              </View>
            </View>
            <View style={s.half}>
              <Dropdown label={t('gender')} required value={gLabel[form.gender] || ''}
                options={[t('female'), t('male'), t('other')]}
                onSelect={(l) => set({ gender: gValue[l] })} placeholder={t('select')} />
            </View>
          </View>

          {/* Phone */}
          <Text style={s.label}>{t('phone')} <Text style={s.req}>*</Text></Text>
          <View style={[s.field, badPhone && s.fieldError]}>
            <CodePicker value={form.countryCode} onChange={(c, iso) => set({ countryCode: c, countryIso: iso })} />
            <TextInput style={s.input} placeholder={t('enterNDigits', { n: formRule.len })} placeholderTextColor="#B4A9C4"
              keyboardType="phone-pad" maxLength={formRule.len} value={form.phone} onChangeText={onPhone} />
          </View>
          {badPhone && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          {/* WhatsApp same-as-phone */}
          <TouchableOpacity style={s.check} activeOpacity={0.8} onPress={toggleSame}>
            <View style={[s.box, form.whatsappSame && s.boxOn]}>
              {form.whatsappSame && <Text style={s.tick}>✓</Text>}
            </View>
            <Text style={s.checkTxt}>{t('whatsappSame')}</Text>
          </TouchableOpacity>

          {/* WhatsApp */}
          <Text style={s.label}>{t('whatsapp')} <Text style={s.req}>*</Text></Text>
          <View style={[s.field, form.whatsappSame && s.readonly, badWa && s.fieldError]}>
            <CodePicker value={form.countryCode} onChange={(c, iso) => set({ countryCode: c, countryIso: iso })} />
            <TextInput style={s.input} placeholder={t('enterNDigits', { n: formRule.len })} placeholderTextColor="#B4A9C4"
              keyboardType="phone-pad" maxLength={formRule.len} editable={!form.whatsappSame}
              value={form.whatsapp} onChangeText={(v) => set({ whatsapp: digitsOnly(v) })} />
          </View>
          {badWa && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          {/* Email */}
          <Text style={s.label}>{t('email')} <Text style={s.req}>*</Text></Text>
          <View style={[s.field, badEmail && s.fieldError]}>
            <TextInput style={s.input} placeholder="name@gmail.com" placeholderTextColor="#B4A9C4"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              value={form.email} onChangeText={(v) => set({ email: v.trim() })} />
          </View>
          {badEmail && <Text style={s.errTxt}>{t('gmailOnly')}</Text>}

          <Button title={t('next')} onPress={proceed} style={{ marginTop: 18 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginBottom: 7, marginTop: 2 },
  req: { color: COLORS.purple },
  field: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.field,
    borderWidth: 1.4, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, marginBottom: 14,
  },
  readonly: { backgroundColor: '#F0EAF7' },
  fieldError: { borderColor: COLORS.red },
  errTxt: { fontSize: 12.5, color: COLORS.red, marginTop: 6, marginLeft: 2 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: COLORS.ink },
  inputText: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.ink },
  calIcon: { fontSize: 16, paddingLeft: 6 },
  row: { flexDirection: 'row', columnGap: 12 },
  half: { flex: 1 },
  check: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: -2 },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.6, borderColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: '#fff',
  },
  boxOn: { backgroundColor: COLORS.purple },
  tick: { color: '#fff', fontSize: 14, fontWeight: '900' },
  checkTxt: { fontSize: 13.5, color: COLORS.ink, fontWeight: '600', flex: 1 },

  // lookup + profiles (branded, no footer)
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  // Centred, biased upward so the block sits near the top of the free space.
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 24, paddingBottom: 130, paddingHorizontal: 16 },
  centerTop: { alignItems: 'center', paddingTop: 14, paddingBottom: 30 },

  // "Find My Details" block — moved out of BrandHeader so it centres with the
  // number field rather than sitting pinned at the top of the screen.
  bTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, color: COLORS.purpleDeep, textAlign: 'center' },
  bDivider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  bLine: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  bSubtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 10, marginBottom: 26 },

  bLabel: { fontSize: 13, fontWeight: '800', color: COLORS.muted, marginBottom: 8, marginLeft: 2 },
  bField: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 14, paddingHorizontal: 14, height: 56 },
  bInput: { flex: 1, fontSize: 16, color: COLORS.ink },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16, marginTop: 20 },
  ctaTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },

  secure: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.lavenderSoft, borderRadius: 16, padding: 16, marginTop: 22 },
  secureTxt: { flex: 1, fontSize: 13.5, color: COLORS.purpleDeep, fontWeight: '600', lineHeight: 19 },

  notFoundBox: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 20, marginTop: 22, borderWidth: 1.5, borderColor: '#EADFF6' },
  notFoundTxt: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 8, marginBottom: 14, lineHeight: 19 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22 },
  newBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },

  pCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: '#EADFF6',
    shadowColor: '#4A2F6B', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.lavenderSoft, alignItems: 'center', justifyContent: 'center' },
  pName: { fontSize: 16, fontWeight: '900', color: COLORS.purpleDeep },
  newOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff',
    borderRadius: 14, paddingVertical: 15, marginTop: 6, borderWidth: 1.5, borderColor: '#DCCBF0',
  },
  newOutlineTxt: { color: COLORS.purple, fontSize: 15, fontWeight: '800' },
});
