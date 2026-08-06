// Renders the small subset of HTML that Odoo's editor produces, as native Text.
//
// The therapy disclaimer is an Html field written in Odoo's WYSIWYG editor, so
// it arrives as markup - paragraphs, bold, italic, underline, lists, and inline
// colour / size from the toolbar. React Native cannot put HTML inside <Text>,
// and the two community HTML renderers are either unmaintained or need a
// WebView (another native rebuild). Nested <Text> already inherits style, so
// the handful of tags the editor actually emits are cheap to support directly.
//
// Deliberately forgiving: an unknown tag is transparent (its children still
// render), and anything that cannot be parsed falls back to the text with tags
// stripped. A waiver must never fail to display - showing it unstyled is bad,
// showing nothing is worse.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

// Tags that end the current line and start a new block.
const BLOCK = new Set(['p', 'div', 'li', 'br', 'tr', 'blockquote',
                       'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol']);
// Content of these is markup, not prose - drop it entirely.
const DROP = new Set(['style', 'script']);

function decode(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

// The inline style a single tag contributes. Only what the editor's toolbar can
// actually set - everything else is ignored rather than guessed at.
function styleFor(tag, attrs) {
  const st = {};
  if (tag === 'b' || tag === 'strong') st.fontWeight = '800';
  if (tag === 'i' || tag === 'em') st.fontStyle = 'italic';
  if (tag === 'u') st.textDecorationLine = 'underline';
  if (tag === 's' || tag === 'del' || tag === 'strike') st.textDecorationLine = 'line-through';
  const h = /^h([1-6])$/.exec(tag);
  if (h) { st.fontWeight = '800'; st.fontSize = 22 - (Number(h[1]) - 1) * 2; }

  const raw = attrs || '';
  const css = (/style\s*=\s*"([^"]*)"/i.exec(raw) || /style\s*=\s*'([^']*)'/i.exec(raw) || [])[1] || '';

  const color = (/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(css) || [])[1]
    || (/color\s*=\s*"([^"]*)"/i.exec(raw) || [])[1];      // legacy <font color>
  if (color) st.color = color.trim();

  const size = (/font-size\s*:\s*([\d.]+)\s*px/i.exec(css) || [])[1];
  if (size) st.fontSize = Number(size);

  const weight = (/font-weight\s*:\s*(bold|[1-9]00)/i.exec(css) || [])[1];
  if (weight) st.fontWeight = /bold/i.test(weight) ? '800' : weight;

  if (/font-style\s*:\s*italic/i.test(css)) st.fontStyle = 'italic';
  const deco = (/text-decoration(?:-line)?\s*:\s*([^;]+)/i.exec(css) || [])[1];
  if (deco && /underline/i.test(deco)) st.textDecorationLine = 'underline';

  return st;
}

// html -> [{ bullet, runs: [{ text, style }] }]
function parse(html) {
  const blocks = [];
  let runs = [];
  let bullet = null;
  const stack = [];                 // open tags, innermost last
  const listStack = [];             // { ordered, n } per nested list
  let dropDepth = 0;

  const flush = () => {
    // Keep a block only if it has visible text; this is what collapses the
    // empty <p></p> the editor leaves behind between paragraphs.
    if (runs.some((r) => r.text.trim())) blocks.push({ bullet, runs });
    runs = [];
    bullet = null;
  };

  const merged = () => Object.assign({}, ...stack.map((f) => f.style));

  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = html.slice(last, m.index);
    last = re.lastIndex;
    if (text && !dropDepth) {
      const clean = decode(text).replace(/[ \t\r\n]+/g, ' ');
      if (clean) runs.push({ text: clean, style: merged() });
    }

    const closing = m[0][1] === '/';
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';

    if (DROP.has(tag)) { dropDepth += closing ? -1 : 1; if (dropDepth < 0) dropDepth = 0; continue; }
    if (dropDepth) continue;

    if (tag === 'br') { flush(); continue; }

    if (closing) {
      if (tag === 'ul' || tag === 'ol') { flush(); listStack.pop(); continue; }
      if (BLOCK.has(tag)) flush();
      // Pop the matching open tag. Search from the top so stray closers - which
      // hand-edited HTML has plenty of - cannot unwind the whole stack.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.splice(i, 1); break; }
      }
      continue;
    }

    if (tag === 'ul' || tag === 'ol') { flush(); listStack.push({ ordered: tag === 'ol', n: 0 }); continue; }
    if (tag === 'li') {
      flush();
      const list = listStack[listStack.length - 1];
      if (list) { list.n += 1; bullet = list.ordered ? `${list.n}.` : '•'; }
      else bullet = '•';
      continue;
    }
    if (BLOCK.has(tag)) flush();

    // Self-closing (<img/>, <hr/>) contributes no style and never closes.
    if (!/\/\s*>$/.test(m[0])) stack.push({ tag, style: styleFor(tag, attrs) });
  }

  const tail = html.slice(last);
  if (tail && !dropDepth) {
    const clean = decode(tail).replace(/[ \t\r\n]+/g, ' ');
    if (clean) runs.push({ text: clean, style: merged() });
  }
  flush();
  return blocks;
}

export default function RichText({ html, style, rtl }) {
  if (!html || typeof html !== 'string') return null;

  let blocks;
  try {
    blocks = parse(html);
  } catch (e) {
    // Never let a waiver fail to display over a parsing detail.
    console.log('[RichText] parse failed, falling back to plain text', e);
    blocks = [{ bullet: null, style: {}, runs: [{ text: decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(), style: {} }] }];
  }
  if (!blocks.length) return null;

  return (
    <View>
      {blocks.map((b, i) => (
        <View key={i} style={[st.block, b.bullet ? st.listRow : null, rtl && st.rtlRow]}>
          {b.bullet ? <Text style={[st.bullet, style]}>{b.bullet} </Text> : null}
          <Text style={[st.text, style, rtl && st.rtlText, b.bullet ? st.flex : null]}>
            {b.runs.map((r, j) => (
              <Text key={j} style={r.style}>{r.text}</Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  block: { marginBottom: 8 },
  listRow: { flexDirection: 'row', marginBottom: 4 },
  rtlRow: { flexDirection: 'row-reverse' },
  bullet: { fontSize: 14.5, lineHeight: 22, color: COLORS.ink, fontWeight: '700' },
  text: { fontSize: 14.5, lineHeight: 22, color: COLORS.ink },
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  flex: { flex: 1 },
});
