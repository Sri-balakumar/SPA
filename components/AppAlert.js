// App-styled replacement for the OS Alert popup: white card, serif title,
// tone-coloured icon and a purple pill button — matching the rest of the app.
//
// Usage:
//   const [alertBox, setAlertBox] = useState(null);
//   setAlertBox({ title: 'Not found', message: '…', tone: 'error' });
//   <AppAlert box={alertBox} onClose={() => setAlertBox(null)} />
import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW } from '../theme';

const TONES = {
  error:   { icon: 'alert-circle',      color: COLORS.red,    bg: '#FBE9E9' },
  success: { icon: 'checkmark-circle',  color: COLORS.green,  bg: '#E6F5EE' },
  info:    { icon: 'information-circle', color: COLORS.purple, bg: COLORS.lavenderSoft },
};

export default function AppAlert({ box, onClose, closeLabel = 'OK' }) {
  const tone = TONES[box?.tone] || TONES.error;

  return (
    <Modal visible={!!box} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={34} color={tone.color} />
          </View>
          <Text style={s.title}>{box?.title}</Text>
          <Text style={s.msg}>{box?.message}</Text>
          <TouchableOpacity style={s.btn} activeOpacity={0.9} onPress={onClose}>
            <Text style={s.btnTxt}>{closeLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(46,36,64,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 24, paddingVertical: 26, paddingHorizontal: 24,
    width: '100%', maxWidth: 380, alignItems: 'center', ...SHADOW,
  },
  iconWrap: {
    width: 62, height: 62, borderRadius: 31,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  title: {
    fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22,
    color: COLORS.purpleDeep, textAlign: 'center',
  },
  msg: { fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  btn: {
    backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 13,
    alignSelf: 'stretch', alignItems: 'center', marginTop: 20,
  },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
