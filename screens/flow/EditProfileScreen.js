// Existing customer — Edit Profile (Personal Information).
// Opened from the "Edit" button on the profile screen. Fields are auto-filled
// from the customer's record; Save Changes writes them back and returns.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import CodePicker from '../../components/CodePicker';
import { phoneRule, digitsOnly } from '../../data/phoneRules';
import { useLang } from '../../LanguageContext';
import { formatDob } from '../../dateFmt';

const GENDERS = ['Female', 'Male', 'Other'];

export default function EditProfileScreen({ form, set, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const gt = (g) => t(String(g).toLowerCase());   // "Female" → localized label
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 32, 500);
  const m = form.selectedCustomer || {};

  const [fullName, setFullName] = useState(m.name || '');
  // English digits: it's a typed field, and "12 May 1992" is the hint shown.
  const [dob, setDob] = useState(formatDob(m.dob, 'en'));
  const [age, setAge] = useState(String(m.age || ''));
  const [gender, setGender] = useState(m.gender || 'Female');
  const [cc, setCc] = useState(form.countryCode || '+968');
  const [ccIso, setCcIso] = useState(form.countryIso || 'OM');
  const [phone, setPhone] = useState(form.phone || '');
  const [waSame, setWaSame] = useState(m.whatsappSame !== false);
  const [wa, setWa] = useState('');
  const [genderOpen, setGenderOpen] = useState(false);

  // Digit count + validity for the selected country (phone and WhatsApp share one).
  const rule = phoneRule(ccIso);
  const badPhone = !!phone && !rule.isValid(phone);
  const badWa = !waSame && !!wa && !rule.isValid(wa);

  function save() {
    if (badPhone || badWa) return;              // button is disabled, belt & braces
    const mobile = `${cc} ${phone.trim()}`;
    const whatsapp = waSame ? mobile : `${cc} ${wa.trim()}`;
    set({
      fullName, dob, age, gender, countryCode: cc, phone: phone.trim(),
      whatsapp: waSame ? phone.trim() : wa.trim(), whatsappSame: waSame,
      selectedCustomer: { ...m, name: fullName, phone: mobile, whatsapp, age, gender, dob },
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
          <View style={s.inputRow}>
            <TextInput style={s.inputFlex} value={dob} onChangeText={setDob} placeholder="e.g. 12 May 1992" placeholderTextColor="#B4A9C4" />
            <Ionicons name="calendar-outline" size={20} color={COLORS.purple} />
          </View>

          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, rtl && s.rtlTxt]}>{t('age')}</Text>
              <TextInput style={s.input} value={age} onChangeText={setAge} keyboardType="number-pad" placeholder={t('age')} placeholderTextColor="#B4A9C4" />
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

          <TouchableOpacity style={s.check} activeOpacity={0.8} onPress={() => setWaSame((v) => !v)}>
            <View style={[s.box, waSame && s.boxOn]}>{waSame && <Ionicons name="checkmark" size={14} color="#fff" />}</View>
            <Text style={[s.checkTxt, rtl && s.rtlTxt]}>{t('whatsappSame')}</Text>
          </TouchableOpacity>

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('whatsapp')} *</Text>
          <View style={[s.inputRow, waSame && { opacity: 0.5 }, badWa && s.fieldError]}>
            <CodePicker value={cc} onChange={(d, iso) => { setCc(d); setCcIso(iso); }} />
            <TextInput style={s.inputFlex} value={waSame ? phone : wa} onChangeText={(v) => setWa(digitsOnly(v))}
              editable={!waSame} keyboardType="phone-pad" maxLength={rule.len}
              placeholder={t('enterNDigits', { n: rule.len })} placeholderTextColor="#B4A9C4" />
          </View>
          {badWa && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          <TouchableOpacity
            style={[s.cta, (badPhone || badWa) && { opacity: 0.6 }]}
            activeOpacity={0.9}
            onPress={save}
            disabled={badPhone || badWa}
          >
            <Text style={s.ctaTxt}>{t('saveChanges')}</Text>
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  body: { alignItems: 'center', paddingTop: 6 },

  label: { fontSize: 12.5, fontWeight: '800', color: COLORS.muted, marginBottom: 7, marginTop: 14, marginLeft: 2 },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15, color: COLORS.ink },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, height: 50 },
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
