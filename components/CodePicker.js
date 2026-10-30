// Compact country-code selector shown as a prefix inside phone fields.
// Tapping it opens the full country list — flag, name and dial code — with a
// search box that matches on country name, dial code or ISO code.
//
// The value passed in/out stays a plain dial string ('+968'), so every caller
// (IdentifyScreen, PersonalInfoScreen, EditProfileScreen) is unchanged.
import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { COUNTRY_ROWS, flagOf, matchCountry } from '../data/countries';

export default function CodePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => COUNTRY_ROWS.filter((c) => matchCountry(c, query)),
    [query],
  );

  // Several countries share a dial code, so the button shows the code only.
  const current = value || '+968';

  function close() {
    setOpen(false);
    setQuery('');          // next open starts clean
  }

  // The ISO goes out alongside the dial code: a dial code alone can't identify
  // a country (+1 is US, Canada and ~20 more), and the phone rules need the
  // ISO. Second argument is additive — callers that ignore it still work.
  function pick(c) {
    onChange(c.dial, c.iso);
    close();
  }

  return (
    <>
      {/* disabled: the field follows another one (WhatsApp same as phone). */}
      <TouchableOpacity style={s.btn} onPress={() => setOpen(true)} activeOpacity={0.7} disabled={disabled}>
        <Text style={s.code}>{current}</Text>
        <Text style={s.chev}>▾</Text>
      </TouchableOpacity>
      <View style={s.sep} />

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        {/* Backdrop closes; the sheet swallows taps so the list stays open. */}
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={close}>
          <TouchableOpacity style={s.sheet} activeOpacity={1}>
            <View style={s.head}>
              <Text style={s.title}>Select country</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={COLORS.muted} />
              </TouchableOpacity>
            </View>

            <View style={s.searchBox}>
              <Ionicons name="search" size={17} color={COLORS.muted} />
              <TextInput
                style={s.search}
                placeholder="Search country or code"
                placeholderTextColor="#B4A9C4"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={17} color={COLORS.muted} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={rows}
              keyExtractor={(c) => c.iso}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={14}
              ListEmptyComponent={<Text style={s.empty}>No country matches “{query}”.</Text>}
              renderItem={({ item }) => {
                const on = item.dial === current;
                return (
                  <TouchableOpacity style={s.row} onPress={() => pick(item)} activeOpacity={0.7}>
                    <Text style={s.flag}>{flagOf(item.iso)}</Text>
                    <Text style={[s.name, on && s.onTxt]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[s.dial, on && s.onTxt]}>{item.dial}</Text>
                    {on && <Text style={s.check}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  code: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  chev: { fontSize: 12, color: COLORS.muted, marginLeft: 3 },
  sep: { width: 1, height: 22, backgroundColor: COLORS.line, marginRight: 10 },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  sheet: {
    backgroundColor: '#fff', borderRadius: 18, paddingBottom: 8,
    // Wider than the other pickers because each row carries three columns
    // (flag, country name, dial code) plus a search box.
    width: '100%', maxWidth: 380, maxHeight: '80%',
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.purpleDeep },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12,
    backgroundColor: COLORS.field, borderWidth: 1.5, borderColor: COLORS.line,
    borderRadius: 12,
  },
  search: { flex: 1, paddingVertical: 10, fontSize: 15, color: COLORS.ink },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  flag: { fontSize: 22 },
  name: { flex: 1, fontSize: 15.5, color: COLORS.ink },
  dial: { fontSize: 15, color: COLORS.muted, fontWeight: '700' },
  onTxt: { color: COLORS.purple, fontWeight: '800' },
  check: { color: COLORS.purple, fontWeight: '900', fontSize: 16 },
  empty: { padding: 24, textAlign: 'center', color: COLORS.muted, fontSize: 14 },
});
