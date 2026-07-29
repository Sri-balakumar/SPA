// Existing customer, screen 2 — Enter Mobile Number.
// Looks up the customer's packages by their registered mobile number.
// Header + footer match the Service page (lavender band + tulip, NexGenn logo).
// The body is a ScrollView so it fits small phones and large tablets alike.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import BrandHeader from '../../components/BrandHeader';
import NexFooter from '../../components/NexFooter';
import CodePicker from '../../components/CodePicker';
import { findMembership } from '../../spaApi';
import { useLang } from '../../LanguageContext';

export default function IdentifyScreen({ set, onFound, onBack, onHome, onBookNew }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const { width } = useWindowDimensions();
  const contentW = Math.min(width - 40, 460);
  const [value, setValue] = useState('');
  const [cc, setCc] = useState('+968');
  const [loading, setLoading] = useState(false);

  async function findPackages() {
    if (!value.trim()) { Alert.alert(t('missing'), t('missingMobile')); return; }
    setLoading(true);
    try {
      const full = `${cc} ${value.trim()}`;
      const membership = await findMembership(full, lang);
      if (membership && (membership.customers || []).length) {
        set({ countryCode: cc, phone: value.trim(), mobile: full });
        onFound(membership);
      } else Alert.alert(t('notFound'), t('notFoundMsg'));
    } catch (e) {
      Alert.alert(t('couldNotLookup'), e.message || t('tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <BrandHeader title={t('welcomeBack')} subtitle={t('enterMobile')} titleSize={28} onBack={onBack} onHome={onHome} />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ width: contentW }}>
          <Text style={[s.label, rtl && s.rtlTxt]}>{t('mobileNumber')}</Text>
          <View style={s.field}>
            <CodePicker value={cc} onChange={setCc} />
            <TextInput
              style={s.input}
              placeholder={t('enterMobilePh')}
              placeholderTextColor="#B4A9C4"
              keyboardType="phone-pad"
              value={value}
              onChangeText={setValue}
              onSubmitEditing={findPackages}
              returnKeyType="go"
            />
          </View>

          <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]} activeOpacity={0.9} onPress={findPackages} disabled={loading}>
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

      <NexFooter />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24, paddingHorizontal: 20 },

  label: { fontSize: 13, fontWeight: '800', color: COLORS.muted, marginBottom: 8, marginLeft: 2 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 14, paddingHorizontal: 14, height: 56 },
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
