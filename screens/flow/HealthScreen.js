// Screen 4 — Health & Preferences. DYNAMIC: it loads the questions the spa
// company set in Odoo for the chosen service and renders each by its type
// (Yes/No, Single choice, Multiple choice, Free text). Answers are collected and
// carried forward to be saved on the booking.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '../../theme';
import AppAlert from '../../components/AppAlert';
import StepHeader from '../../components/StepHeader';
import Dropdown from '../../components/Dropdown';
import Button from '../../components/Button';
import PersonBanner from '../../components/PersonBanner';
import { loadQuestions } from '../../spaApi';
import { useLang } from '../../LanguageContext';

// Group the (already ordered) questions into sections and number them 1.. per
// section — render a heading whenever heading_id changes (0 = no section).
function decorate(questions) {
  let last = null, num = 0;
  return questions.map((q) => {
    const hid = q.headingId || 0;
    const isNew = hid !== last;
    if (isNew) { last = hid; num = 0; }
    num += 1;
    return { q, showHeading: isNew && hid !== 0, number: num };
  });
}

export default function HealthScreen({ form, set, next, onBack, onHome }) {
  const { t, lang } = useLang();
  const rtl = lang === 'ar';
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});   // { [qid]: string | string[] }

  async function fetch() {
    setError('');
    try {
      const { questions: qs, disclaimer } = await loadQuestions(form.serviceId, lang);
      setQuestions(qs);
      // Carried on the form so App.js can decide whether the disclaimer screen
      // exists at all. It has to be known before Next is pressed here, which is
      // why it rides along on this call rather than having its own.
      set({ disclaimer });
    } catch (e) {
      setError(e.message || 'Could not load questions.');
      setQuestions([]);
      // Do not strand the customer on a network blip: with no disclaimer the
      // flow steps over that screen rather than showing an empty one.
      set({ disclaimer: null });
    }
  }
  useEffect(() => { fetch(); }, [form.serviceId]);

  // In-app popup styled like the rest of the app, in place of the OS Alert.
  const [alertBox, setAlertBox] = useState(null);
  const showAlert = (title, message, tone = 'error') => setAlertBox({ title, message, tone });

  const setAns = (qid, val) => setAnswers((a) => ({ ...a, [qid]: val }));

  // Copy person 1's answers onto this person. Reads the SAVED lead, not the live
  // form, because the form now holds this person's own working set.
  function copyLeadAnswers() {
    const lead = (form.members || [])[0];
    const src = (lead && lead.answers) || [];
    const byId = {};
    src.forEach((a) => { if (a && a.questionId != null) byId[a.questionId] = a.value; });
    // proceed() flattens a multi_choice answer to "a, b" on the way out, so it
    // has to be split back into a list here or its options render unticked.
    const next = {};
    (questions || []).forEach((q) => {
      const v = byId[q.id];
      if (v == null || v === '') return;
      next[q.id] = q.type === 'multi_choice'
        ? String(v).split(',').map((x) => x.trim()).filter(Boolean)
        : v;
    });
    setAnswers(next);
  }
  function toggleMulti(qid, opt) {
    setAnswers((a) => {
      const cur = Array.isArray(a[qid]) ? a[qid] : [];
      return { ...a, [qid]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });
  }

  function proceed() {
    for (const q of questions) {
      const v = answers[q.id];
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (q.required && empty) return showAlert(t('required'), `${t('answerThis')} ${q.name}`);
    }
    // Consent is checked on the disclaimer screen now, against the wording the
    // customer was actually shown.
    const out = questions.map((q) => ({
      questionId: q.id,
      value: Array.isArray(answers[q.id]) ? answers[q.id].join(', ') : (answers[q.id] || ''),
    }));
    set({ answers: out });
    next();
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <StepHeader title={t('healthTitle')} subtitle={t('healthSub')} onBack={onBack} onHome={onHome} />

      {questions === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={COLORS.purple} /><Text style={s.dim}>{t('loadingQuestions')}</Text></View>
      ) : error ? (
        <View style={s.center}><Text style={s.dim}>{error}</Text><TouchableOpacity style={s.retry} onPress={fetch}><Text style={s.retryTxt}>{t('retry')}</Text></TouchableOpacity></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <PersonBanner form={form} />

            {/* Ten questions for a family of four is forty answers at a busy
                counter; without this the family flow is unusable. Everything
                stays editable afterwards. */}
            {(form.memberIndex || 0) > 0 && questions.length ? (
              <TouchableOpacity style={s.copyBtn} onPress={copyLeadAnswers} activeOpacity={0.8}>
                <Text style={s.copyTxt}>{t('copyAnswers')}</Text>
              </TouchableOpacity>
            ) : null}

            {questions.length === 0 && (
              <Text style={s.none}>{t('noQuestions')}</Text>
            )}

            {decorate(questions).map(({ q, showHeading, number }) => (
              <View key={q.id}>
                {showHeading && <Text style={[s.section, rtl && s.rtl]}>{q.heading}</Text>}
                <View style={s.qBlock}>
                <Text style={s.label}>{number}. {q.name}{q.required ? <Text style={s.req}> *</Text> : null}</Text>

                {q.type === 'yes_no' && (
                  <View style={s.yesNo}>
                    {['Yes', 'No'].map((opt) => {
                      const on = answers[q.id] === opt;
                      return (
                        <TouchableOpacity key={opt} style={[s.pill, on && s.pillOn]} onPress={() => setAns(q.id, opt)} activeOpacity={0.8}>
                          <Text style={[s.pillTxt, on && s.pillTxtOn]}>{opt === 'Yes' ? t('yes') : t('no')}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {q.type === 'single_choice' && (
                  <Dropdown value={answers[q.id] || ''} options={q.options} onSelect={(v) => setAns(q.id, v)} placeholder={t('select')} />
                )}

                {q.type === 'multi_choice' && (
                  <View>
                    {q.options.map((opt) => {
                      const on = Array.isArray(answers[q.id]) && answers[q.id].includes(opt);
                      return (
                        <TouchableOpacity key={opt} style={s.check} activeOpacity={0.8} onPress={() => toggleMulti(q.id, opt)}>
                          <View style={[s.box, on && s.boxOn]}>{on && <Text style={s.tick}>✓</Text>}</View>
                          <Text style={s.checkTxt}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {q.type === 'text' && (
                  <View style={s.field}>
                    <TextInput style={s.input} placeholder={t('typeAnswer')} placeholderTextColor="#B4A9C4"
                      value={answers[q.id] || ''} onChangeText={(v) => setAns(q.id, v)} multiline />
                  </View>
                )}
                </View>
              </View>
            ))}

            {/* No consent block here. The tick and the signature moved to the
                disclaimer screen, so they are given on the page carrying the
                wording being agreed to. A therapy with no waiver asks for
                neither - the same as the POS and the booking page. */}

            <Button title={t('next')} onPress={proceed} style={{ marginTop: 12 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  dim: { color: COLORS.muted, fontSize: 14, marginTop: 10, textAlign: 'center' },
  retry: { marginTop: 14, borderWidth: 1.5, borderColor: COLORS.purple, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 22 },
  retryTxt: { color: COLORS.purple, fontWeight: '800' },
  scroll: { padding: 20, paddingBottom: 40 },
  none: { color: COLORS.muted, textAlign: 'center', marginVertical: 20 },

  qBlock: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: COLORS.ink, marginBottom: 9 },
  req: { color: COLORS.purple },

  yesNo: { flexDirection: 'row', columnGap: 12 },
  pill: { flex: 1, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: COLORS.field },
  pillOn: { borderColor: COLORS.purple, backgroundColor: COLORS.lavenderSoft },
  pillTxt: { fontSize: 15, fontWeight: '700', color: COLORS.muted },
  pillTxtOn: { color: COLORS.purpleDark },

  check: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.6, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: '#fff' },
  boxOn: { backgroundColor: COLORS.purple },
  tick: { color: '#fff', fontSize: 14, fontWeight: '900' },
  checkTxt: { fontSize: 14.5, color: COLORS.ink, flex: 1 },

  field: { backgroundColor: COLORS.field, borderWidth: 1.4, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14 },
  input: { paddingVertical: 12, fontSize: 15, color: COLORS.ink, minHeight: 70, textAlignVertical: 'top' },

  // section heading (e.g. "GENERAL HEALTH (PAR-Q)")
  section: {
    fontSize: 14, fontWeight: '800', color: COLORS.purpleDeep, letterSpacing: 0.4,
    textTransform: 'uppercase', marginTop: 18, marginBottom: 10,
    borderBottomWidth: 1.5, borderBottomColor: COLORS.line, paddingBottom: 8,
  },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  copyBtn: {
    alignSelf: 'flex-start', borderWidth: 1.5, borderColor: COLORS.purple, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 16, marginBottom: 16,
  },
  copyTxt: { color: COLORS.purple, fontWeight: '800', fontSize: 13 },
  // The consent and signature styles moved to DisclaimerScreen with the
  // controls they belonged to.
});
