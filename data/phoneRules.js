// Per-country phone rules for the mobile-number fields: how many digits the
// country uses, and whether what's typed is a real mobile number there.
//
// Uses the `/mobile` metadata build on purpose. The default build is far too
// lenient — it calls Indian "2876543210" valid — and `/max` accepts landlines,
// which customers never give us. Only `/mobile` rejects a wrong leading digit,
// which is the check we actually want:
//     IN  9/8/7/6 ok, 2 rejected      OM  9/7 ok, 2 rejected
import { getExampleNumber, isValidPhoneNumber } from 'libphonenumber-js/mobile';
import examples from 'libphonenumber-js/examples.mobile.json';

// Countries whose example number misrepresents the real limit. `len` here is
// the MAXIMUM digits the field will accept. Add an entry when a customer is
// blocked from typing a legitimate digit (see the variable-length note below).
const LENGTH_OVERRIDES = {
  // e.g. DE: 12,
};

// getExampleNumber parses metadata, so cache per ISO — this runs on keystrokes.
const cache = new Map();

const FALLBACK_LEN = 15;   // E.164 maximum, used when a country has no example

/**
 * Rules for one country.
 * @param {string} iso  ISO 3166-1 alpha-2, e.g. 'IN'. Falsy → permissive rule.
 * @returns {{ iso: string, len: number, isValid: (national: string) => boolean }}
 */
export function phoneRule(iso) {
  const key = (iso || '').toUpperCase();
  if (cache.has(key)) return cache.get(key);

  let len = FALLBACK_LEN;
  if (key) {
    if (LENGTH_OVERRIDES[key]) {
      len = LENGTH_OVERRIDES[key];
    } else {
      try {
        const ex = getExampleNumber(key, examples);
        if (ex && ex.nationalNumber) len = ex.nationalNumber.length;
      } catch (e) { /* unknown ISO → keep the fallback */ }
    }
  }

  const rule = {
    iso: key,
    len,
    isValid(national) {
      const n = digitsOnly(national);
      if (!n) return false;
      if (!key) return n.length >= 5;          // no country → only sanity-check
      try {
        return isValidPhoneNumber(n, key);
      } catch (e) {
        return n.length === len;               // unknown ISO → fall back to length
      }
    },
  };

  cache.set(key, rule);
  return rule;
}

// Strip everything that isn't a digit, so a pasted "+968 9123 4567" becomes
// "96891234567" -> the field's maxLength then counts real digits, not spaces.
export function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

// Get the LOCAL number only (no country code) — keeps the code selector clean.
// Handles "+91 6359863259", "+916359863259" and "6359863259".
export function localNumber(full, cc) {
  let s = String(full || '').trim();
  if (s.includes(' ')) return s.split(/\s+/).slice(1).join('').replace(/\D/g, '');
  s = s.replace(/\D/g, '');                       // digits only
  const ccd = String(cc || '').replace(/\D/g, ''); // "91"
  if (ccd && s.startsWith(ccd) && s.length > ccd.length) s = s.slice(ccd.length);
  return s;
}

// Resolve the ISO for a dial code. Only a fallback for state saved before the
// ISO was tracked — a dial code alone is ambiguous (+1 is US, CA and ~20
// Caribbean nations), so prefer the ISO the picker hands back.
export function isoForDial(dial, countries) {
  if (!dial) return '';
  const hit = (countries || []).find((c) => c.dial === dial);
  return hit ? hit.iso : '';
}
