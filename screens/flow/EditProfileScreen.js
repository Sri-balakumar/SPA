// Existing customer — Edit Profile (Personal Information).
// Opened from the "Edit" button on the profile screen. Fields are auto-filled
// from the customer's record; Save Changes writes them back and returns.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, Platform, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import CodePicker from '../../components/CodePicker';
import { phoneRule, digitsOnly, splitNumber } from '../../data/phoneRules';
import { useLang } from '../../LanguageContext';
import AppAlert from '../../components/AppAlert';
import { saveProfile } from '../../spaApi';
import { parseDobDate } from '../../dateFmt';

const GENDERS = ['Female', 'Male', 'Other'];

// Same date handling as the New-customer form (PersonalInfoScreen).
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

export default function EditProfileScreen({ form, set, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const gt = (g) => t(String(g).toLowerCase());   // "Female" → localized label
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 500);
  const m = form.selectedCustomer || {};

  const [fullName, setFullName] = useState(m.name || '');
  // Picked from a calendar, as on the New-customer form - never typed.
  const [dobDate, setDobDate] = useState(() => parseDobDate(m.dob));
  const [showPicker, setShowPicker] = useState(false);
  const dob = dobDate ? fmt(dobDate) : '';
  // Worked out from the date of birth, so the two can never disagree.
  const age = dobDate ? String(ageFrom(dobDate)) : String(m.age || '');
  const [gender, setGender] = useState(m.gender || 'Female');
  const [cc, setCc] = useState(form.countryCode || '+968');
  const [ccIso, setCcIso] = useState(form.countryIso || 'OM');
  const [phone, setPhone] = useState(form.phone || '');
  // Open on the customer's own WhatsApp, under its own country - it can differ
  // from the mobile's. The server never sends whatsappSame (only a save here
  // sets it), so work it out from the numbers on file: ticked when there is
  // none or it matches the mobile (code and number), unticked otherwise.
  const [waInit] = useState(() => splitNumber(m.whatsapp, cc, ccIso));
  const [waCc, setWaCc] = useState(waInit.cc);
  const [waIso, setWaIso] = useState(waInit.iso);
  const [waSame, setWaSame] = useState(
    () => m.whatsappSame ?? (!waInit.local
      || digitsOnly(`${waInit.cc}${waInit.local}`) === digitsOnly(`${cc}${phone}`)));
  const [wa, setWa] = useState(() => (waSame ? '' : waInit.local));
  // Optional, as on the New-customer form; anything typed must be a real
  // address. Same rule as EMAIL_RE in PersonalInfoScreen and the server.
  const [email, setEmail] = useState(m.email || '');
  const badEmail = !!email.trim() && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email.trim());
  const [genderOpen, setGenderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alertBox, setAlertBox] = useState(null);

  // Digit count + validity per selected country. WhatsApp uses the phone's
  // while it is the same number, its own once that is unticked.
  const rule = phoneRule(ccIso);
  const waRule = waSame ? rule : phoneRule(waIso);
  const badPhone = !!phone && !rule.isValid(phone);
  const badWa = !waSame && !!wa && !waRule.isValid(wa);

  // Unticking starts the WhatsApp code on the phone's when nothing is typed
  // yet; it can then be changed on its own.
  function toggleSame() {
    if (waSame && !wa.trim()) { setWaCc(cc); setWaIso(ccIso); }
    setWaSame(!waSame);
  }

  function onPickDate(event, selected) {
    setShowPicker(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !selected) return;
    setDobDate(selected);
  }

  async function save() {
    if (badPhone || badWa || badEmail || busy) return;   // button is disabled, belt & braces
    if (!waSame && !wa.trim()) {
      setAlertBox({ title: t('missing'), message: t('enterWhatsapp'), tone: 'error' });
      return;
    }
    const mobile = `${cc} ${phone.trim()}`;
    const whatsapp = waSame ? mobile : `${waCc} ${wa.trim()}`;
    const dobISO = dobDate ? iso(dobDate) : '';
    // Onto the customer's contact in Odoo first. Only kept in the app, the
    // next lookup brought the old details straight back.
    if (m.id && !m.demo) {
      setBusy(true);
      try {
        await saveProfile(m.id, {
          name: fullName.trim() || m.name,
          ...(phone.trim() ? { phone: mobile.replace(/\s/g, '') } : {}),
          ...(phone.trim() || !waSame ? { whatsapp: whatsapp.replace(/\s/g, '') } : {}),
          // Left out when blank: clearing the box never wipes the e-mail on file.
          ...(email.trim() ? { email: email.trim() } : {}),
          gender: gender ? gender.toLowerCase() : false,
          ...(dobISO ? { date_of_birth: dobISO } : {}),
        });
      } catch (e) {
        setBusy(false);
        setAlertBox({ title: t('couldNotSave'), message: e.message || t('tryAgain'), tone: 'error' });
        return;
      }
      setBusy(false);
    }
    // ISO, like the server sends it, so every screen's formatDob reads it.
    const updated = {
      ...m, name: fullName, phone: mobile, whatsapp, whatsappSame: waSame, age, gender, dob: dobISO || m.dob,
      email: email.trim() || m.email || '',
    };
    set({
      fullName, dob, dobISO, age, gender, countryCode: cc, countryIso: ccIso, phone: phone.trim(),
      whatsapp: waSame ? phone.trim() : wa.trim(), whatsappSame: waSame,
      waCountryCode: waSame ? cc : waCc, waCountryIso: waSame ? ccIso : waIso,
      selectedCustomer: updated,
      // The profile list this customer was picked from, so Back shows them
      // with the new details too.
      membership: form.membership && {
        ...form.membership,
        customers: (form.membership.customers || []).map((c) => (c.id === m.id ? updated : c)),
      },
    });
    onBack();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader title={t('personalTitle')} subtitle={t('pleaseUpdate')} titleSize={23} onBack={onBack} onHome={onHome} />

      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={{ width: contentW }}>
          <Text style={[s.label, rtl && s.rtlTxt]}>{t('fullName')} *</Text>
          <TextInput style={[s.input, rtl && s.rtlTxt]} value={fullName} onChangeText={setFullName} placeholder={t('fullNamePh')} placeholderTextColor="#B4A9C4" />

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('dob')} *</Text>
          <TouchableOpacity style={s.inputRow} activeOpacity={0.8} onPress={() => setShowPicker(true)}>
            <Text style={[s.inputFlex, !dob && { color: '#B4A9C4' }]}>{dob || t('dobPh')}</Text>
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

          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, rtl && s.rtlTxt]}>{t('age')}</Text>
              {/* Read-only: worked out from the date of birth. */}
              <View style={[s.inputRow, s.readonly]}>
                <Text style={[s.inputFlex, !age && { color: '#B4A9C4' }]}>
                  {age ? `${age} ${t('years')}` : t('auto')}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, rtl && s.rtlTxt]}>{t('gender')} *</Text>
              <TouchableOpacity style={s.inputRow} activeOpacity={0.8} onPress={() => setGenderOpen(true)}>
                <Text style={s.inputFlex}>{gt(gender)}</Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('phone')} *</Text>
          <View style={[s.inputRow, badPhone && s.fieldError]}>
            <CodePicker value={cc} onChange={(d, iso) => { setCc(d); setCcIso(iso); }} />
            <TextInput style={s.inputFlex} value={phone} onChangeText={(v) => setPhone(digitsOnly(v))}
              keyboardType="phone-pad" maxLength={rule.len}
              placeholder={t('enterNDigits', { n: rule.len })} placeholderTextColor="#B4A9C4" />
          </View>
          {badPhone && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          <TouchableOpacity style={s.check} activeOpacity={0.8} onPress={toggleSame}>
            <View style={[s.box, waSame && s.boxOn]}>{waSame && <Ionicons name="checkmark" size={14} color="#fff" />}</View>
            <Text style={[s.checkTxt, rtl && s.rtlTxt]}>{t('whatsappSame')}</Text>
          </TouchableOpacity>

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('whatsapp')} *</Text>
          <View style={[s.inputRow, waSame && { opacity: 0.5 }, badWa && s.fieldError]}>
            <CodePicker value={waSame ? cc : waCc} disabled={waSame}
              onChange={(d, iso) => { setWaCc(d); setWaIso(iso); }} />
            <TextInput style={s.inputFlex} value={waSame ? phone : wa} onChangeText={(v) => setWa(digitsOnly(v))}
              editable={!waSame} keyboardType="phone-pad" maxLength={waRule.len}
              placeholder={t('enterNDigits', { n: waRule.len })} placeholderTextColor="#B4A9C4" />
          </View>
          {badWa && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('email')}</Text>
          <TextInput style={[s.input, badEmail && s.fieldError, rtl && s.rtlTxt]} value={email}
            onChangeText={(v) => setEmail(v.trim())} placeholder="name@example.com" placeholderTextColor="#B4A9C4"
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          {badEmail && <Text style={s.errTxt}>{t('emailInvalidMsg')}</Text>}

          <TouchableOpacity
            style={[s.cta, (badPhone || badWa || badEmail || busy) && { opacity: 0.6 }]}
            activeOpacity={0.9}
            onPress={save}
            disabled={badPhone || badWa || badEmail || busy}
          >
            <Text style={s.ctaTxt}>{busy ? t('saving') : t('saveChanges')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>


      <Modal visible={genderOpen} transparent animationType="fade" onRequestClose={() => setGenderOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setGenderOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{t('gender')}</Text>
            {GENDERS.map((g) => (
              <TouchableOpacity key={g} style={s.gRow} onPress={() => { setGender(g); setGenderOpen(false); }}>
                <Text style={[s.gTxt, g === gender && { color: COLORS.purple, fontWeight: '800' }]}>{gt(g)}</Text>
                {g === gender && <Ionicons name="checkmark" size={18} color={COLORS.purple} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  body: { alignItems: 'center', paddingTop: 6 },

  label: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 7, marginTop: 14, marginLeft: 2 },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15, color: COLORS.ink },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  readonly: { backgroundColor: '#F0EAF7' },
  calIcon: { fontSize: 16, paddingLeft: 6 },    // same as the New-customer form
  fieldError: { borderColor: COLORS.red },
  errTxt: { fontSize: 12.5, color: COLORS.red, marginTop: 6, marginLeft: 2 },
  inputFlex: { flex: 1, fontSize: 15, color: COLORS.ink },
  two: { flexDirection: 'row', gap: 12 },

  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#C9B9E0', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  checkTxt: { fontSize: 13.5, color: COLORS.ink, fontWeight: '600', flex: 1 },

  cta: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16, marginTop: 26 },
  ctaTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 6,
    width: '100%', maxWidth: 300, overflow: 'hidden',
  },
  sheetTitle: { fontSize: 14, fontWeight: '800', color: COLORS.purpleDeep, padding: 16, paddingBottom: 8 },
  gRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: COLORS.line },
  gTxt: { fontSize: 16, color: COLORS.ink },
  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
