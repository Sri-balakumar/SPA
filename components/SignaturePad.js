// A lightweight finger-drawn signature pad (no WebView).
// The customer draws with a finger (SVG strokes). When a stroke finishes we
// snapshot the pad to a PNG and hand the parent the raw base64 (no data-URI
// prefix) — that's exactly what an Odoo image/binary field expects, so the
// signature shows up as a picture on the contact. onChange('') when cleared.
//
// With `allowUpload` (set per therapy in Odoo, like the POS) an "Upload image"
// button also lets a picture of the signature stand in for drawing it.
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, PanResponder, StyleSheet, Image } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../theme';

const INK = '#1A1230';
const STROKE = 2.6;
// The server refuses a signature over 2 MB decoded (MAX_SIGNATURE_BYTES).
const MAX_BYTES = 2 * 1024 * 1024;

export default function SignaturePad({
  label, required, hint, clearLabel, onChange, height = 170, rtl,
  allowUpload, uploadLabel, onTooLarge,
}) {
  const [uploaded, setUploaded] = useState(null);   // { uri } of a picked picture
  const [paths, setPaths] = useState([]);      // finished strokes (SVG "d" strings)
  const [current, setCurrent] = useState('');  // stroke being drawn
  const [w, setW] = useState(0);
  const curRef = useRef('');
  const pathsRef = useRef([]);                 // mirror of `paths` so we never setState-in-updater
  const padRef = useRef(null);                 // the pad view we snapshot to PNG
  const wRef = useRef(0);

  // Fallback when PNG capture isn't available (e.g. Expo Go): an SVG data-URI so
  // the form still has a signature value and the flow can continue.
  function svgDataUri() {
    const d = pathsRef.current.join(' ');
    if (!d) return '';
    const width = Math.round(wRef.current || 300);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#ffffff"/>` +
      `<path d="${d}" stroke="${INK}" stroke-width="${STROKE}" fill="none" ` +
      `stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  // Snapshot the pad to a PNG (raw base64) shortly after the stroke has rendered,
  // and hand it to the parent for the Odoo image field. Falls back to SVG.
  function capturePng() {
    setTimeout(async () => {
      try {
        const b64 = await captureRef(padRef, { format: 'png', quality: 0.9, result: 'base64' });
        onChange && onChange(b64 || svgDataUri());
      } catch (e) {
        onChange && onChange(svgDataUri());   // Expo Go / capture unavailable
      }
    }, 60);
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        curRef.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        setCurrent(curRef.current);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        curRef.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        setCurrent(curRef.current);
      },
      onPanResponderRelease: () => {
        const stroke = curRef.current;
        curRef.current = '';
        setCurrent('');
        if (stroke) {
          const all = [...pathsRef.current, stroke];
          pathsRef.current = all;
          setPaths(all);
          capturePng();       // snapshot AFTER the stroke renders, never inside the updater
        }
      },
    })
  ).current;

  function clear() {
    pathsRef.current = [];
    setPaths([]); setCurrent(''); curRef.current = '';
    setUploaded(null);
    onChange && onChange('');
  }

  // A picture replaces whatever was drawn. Raw base64 like the drawn PNG; the
  // server tells JPEG from PNG by its bytes.
  async function upload() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.6, base64: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (!a.base64) return;
      if (a.base64.length * 0.75 > MAX_BYTES) { onTooLarge && onTooLarge(); return; }
      pathsRef.current = [];
      setPaths([]); setCurrent(''); curRef.current = '';
      setUploaded({ uri: a.uri });
      onChange && onChange(a.base64);
    } catch (e) { /* picker unavailable or closed - keep what was there */ }
  }

  const hasInk = paths.length > 0 || current.length > 0 || !!uploaded;

  return (
    <View>
      <View style={st.head}>
        <Text style={[st.label, rtl && st.rtl]}>
          {label}{required ? <Text style={st.req}> *</Text> : null}
        </Text>
        <View style={st.actions}>
          {allowUpload ? (
            <TouchableOpacity onPress={upload} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={st.clear}>{uploadLabel || 'Upload image'}</Text>
            </TouchableOpacity>
          ) : null}
          {hasInk ? (
            <TouchableOpacity onPress={clear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={st.clear}>{clearLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View
        ref={padRef}
        collapsable={false}
        style={[st.pad, { height }]}
        onLayout={(e) => { const width = e.nativeEvent.layout.width; setW(width); wRef.current = width; }}
        {...(uploaded ? {} : pan.panHandlers)}
      >
        {!hasInk && <Text style={st.hint}>{hint}</Text>}
        {uploaded ? <Image source={{ uri: uploaded.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke={INK} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {current ? (
            <Path d={current} stroke={INK} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7, marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  req: { color: COLORS.purple },
  clear: { fontSize: 13, fontWeight: '800', color: COLORS.purple },
  actions: { flexDirection: 'row', alignItems: 'center', columnGap: 18 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  pad: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.6, borderColor: COLORS.line,
    borderStyle: 'dashed', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  hint: { fontSize: 14, color: '#B4A9C4', fontWeight: '600' },
});
