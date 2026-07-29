// Screen 5 — Appointment Preference. Preferred therapist, date, time, branch,
// and an optional special request. All optional-ish; the receptionist confirms
// the actual slot later.
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from '../../theme';
import StepHeader from '../../components/StepHeader';
import Dropdown from '../../components/Dropdown';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { THERAPIST, TIME_SLOTS, BRANCHES } from '../../data/options';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export default function AppointmentScreen({ form, set, next, onBack, onHome }) {
  const [showPicker, setShowPicker] = useState(false);

  function onPickDate(event, selected) {
    setShowPicker(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !selected) return;
    set({ date: fmt(selected) });
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <StepHeader title="Appointment Preference" subtitle="Choose your preferred options" onBack={onBack} onHome={onHome} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Dropdown label="Preferred Therapist (Optional)" value={form.therapist} options={THERAPIST}
            onSelect={(v) => set({ therapist: v })} placeholder="Any" />

          <Text style={s.label}>Preferred Date</Text>
          <TouchableOpacity style={s.field} activeOpacity={0.8} onPress={() => setShowPicker(true)}>
            <Text style={[s.value, !form.date && { color: '#B4A9C4' }]}>{form.date || 'Select date'}</Text>
            <Text style={s.cal}>📅</Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker value={new Date()} mode="date" display="default" minimumDate={new Date()} onChange={onPickDate} />
          )}

          <Dropdown label="Preferred Time" value={form.time} options={TIME_SLOTS}
            onSelect={(v) => set({ time: v })} placeholder="Select time" />

          <Dropdown label="Spa Branch / Location" value={form.branch} options={BRANCHES}
            onSelect={(v) => set({ branch: v })} placeholder="Select branch" />

          <Input label="Special Requests (Optional)" value={form.specialRequests}
            onChangeText={(v) => set({ specialRequests: v })} placeholder="Please specify if you have any special request"
            multiline maxLength={150} />

          <Button title="Next" onPress={next} style={{ marginTop: 8 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.lavender },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginBottom: 7 },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.field, borderWidth: 1.4, borderColor: COLORS.line,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14,
  },
  value: { fontSize: 15, color: COLORS.ink },
  cal: { fontSize: 16 },
});
