// Existing customer, screen 2 — Enter Mobile Number.
// Looks up the customer's packages by their registered mobile number.
// Header + footer match the Service page (lavender band + tulip, NexGenn logo).
// The body is a ScrollView so it fits small phones and large tablets alike.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import CodePicker from '../../components/CodePicker';
import AppAlert from '../../components/AppAlert';
import { phoneRule, digitsOnly } from '../../data/phoneRules';
import { findMembership } from '../../spaApi';
import { useLang } from '../../LanguageContext';

export default function IdentifyScreen({ set, onFound, onBack, onHome, onBookNew }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 40, 460);
  const [value, setValue] = useState('');
  const [cc, setCc] = useState('+968');
  const [ccIso, setCcIso] = useState('OM');
  const [loading, setLoading] = useState(false);
  const [alertBox, setAlertBox] = useState(null);   // in-app popup, replaces Alert

  // Digit count + validity for the selected country.
  const rule = phoneRule(ccIso);
  const badPhone = value.length > 0 && !rule.isValid(value);

  async function findPackages() {
    if (!value.trim()) { setAlertBox({ title: t('missing'), message: t('missingMobile') }); return; }
    if (badPhone) return;                       // button is disabled, belt & braces
    setLoading(true);
    try {
      const full = `${cc} ${value.trim()}`;
      const membership = await findMembership(full, lang);
      if (membership && (membership.customers || []).length) {
        set({ countryCode: cc, countryIso: ccIso, phone: value.trim(), mobile: full });
        onFound(membership);
      } else setAlertBox({ title: t('notFound'), message: t('notFoundMsg'), tone: 'info' });
    } catch (e) {
      setAlertBox({ title: t('couldNotLookup'), message: e.message || t('tryAgain') });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      {/* Logo only. "Welcome Back" used to be a header title, which pinned it
          to the top of the screen — it now sits inside the centred block below
          so it moves down and centres together with the mobile field. */}
      <BrandHeader onBack={onBack} onHome={onHome} />

      {/* style={flex:1} makes the ScrollView fill the space under the header —
          without it it shrinks to its content and there is nothing for
          contentContainerStyle's justifyContent:'center' to centre within. */}
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: contentW }}>
          <Text style={s.title}>{t('welcomeBack')}</Text>
          <View style={s.divider}>
            <View style={s.dLine} />
            <MaterialCommunityIcons name="flower-tulip" size={16} color={COLORS.purple} />
            <View style={s.dLine} />
          </View>
          <Text style={s.subtitle}>{t('enterMobile')}</Text>

          <Text style={[s.label, rtl && s.rtlTxt]}>{t('mobileNumber')}</Text>
          <View style={[s.field, badPhone && s.fieldError]}>
            <CodePicker value={cc} onChange={(d, iso) => { setCc(d); setCcIso(iso); }} />
            <TextInput
              style={s.input}
              placeholder={t('enterNDigits', { n: rule.len })}
              placeholderTextColor="#B4A9C4"
              keyboardType="phone-pad"
              maxLength={rule.len}
              value={value}
              onChangeText={(v) => setValue(digitsOnly(v))}
              onSubmitEditing={findPackages}
              returnKeyType="go"
            />
          </View>
          {badPhone && <Text style={s.errTxt}>{t('phoneInvalid')}</Text>}

          <TouchableOpacity
            style={[s.btn, (loading || badPhone) && { opacity: 0.6 }]}
            activeOpacity={0.9}
            onPress={findPackages}
            disabled={loading || badPhone}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={s.btnTxt}>{t('findMyPackages')}</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>

          <View style={s.secure}>
            <Ionicons name="shield-checkmark" size={30} color={COLORS.purple} style={{ marginRight: 12 }} />
            <Text style={[s.secureTxt, rtl && s.rtlTxt]}>{t('secureNote')}</Text>
          </View>

          <Text style={s.assist}>{t('needAssistance')}</Text>
        </View>
      </ScrollView>

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scrollView: { flex: 1 },
  // Centred, biased upward: the extra bottom padding shrinks the centring box
  // from below, lifting the whole block above the true middle.
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 24, paddingBottom: 130, paddingHorizontal: 20 },

  // "Welcome Back" block — moved out of BrandHeader so it centres with the form.
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, color: COLORS.purpleDeep, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dLine: { width: 46, height: 1, backgroundColor: '#D7C7EA', marginHorizontal: 8 },
  subtitle: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 10, marginBottom: 26 },

  label: { fontSize: 13, fontWeight: '800', color: COLORS.muted, marginBottom: 8, marginLeft: 2 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 14, paddingHorizontal: 14, height: 56 },
  fieldError: { borderColor: COLORS.red },
  errTxt: { fontSize: 12.5, color: COLORS.red, marginTop: 7, marginLeft: 2 },
  input: { flex: 1, fontSize: 16, color: COLORS.ink },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 16, marginTop: 20 },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },

  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: COLORS.line },
  orTxt: { fontSize: 12, fontWeight: '800', color: COLORS.muted, marginHorizontal: 12 },

  ghost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: '#DCCBF0' },
  ghostTxt: { color: COLORS.purple, fontSize: 15, fontWeight: '800' },

  secure: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.lavenderSoft, borderRadius: 16, padding: 16, marginTop: 22 },
  secureTxt: { flex: 1, fontSize: 13.5, color: COLORS.purpleDeep, fontWeight: '600', lineHeight: 19 },

  assist: { textAlign: 'center', fontSize: 12.5, color: COLORS.muted, marginTop: 18, lineHeight: 18 },
  rtlTxt: { textAlign: 'right', writingDirection: 'rtl' },
});
