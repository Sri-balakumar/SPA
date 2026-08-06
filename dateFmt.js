// Date/number formatting that follows the chosen language.
// English → "28 Jul 2026, 12:42 PM"; Arabic → "٢٨ يوليو ٢٠٢٦، ١٢:٤٢ م".
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

// "123" → "١٢٣" when Arabic, unchanged otherwise.
export function toDigits(value, lang) {
  const s = String(value);
  return lang === 'ar' ? s.replace(/[0-9]/g, (d) => AR_DIGITS[+d]) : s;
}

// ============================================================
//  Money — the ONLY place a price is turned into text.
//
//  The currency comes from Odoo: /api/spa/therapies returns
//  { symbol, position } for the company that owns the POS selling these
//  therapies, and loadTherapies() hands it to setCurrency() below. Change the
//  currency in Odoo and every price in the app follows, with no release.
//
//  Every screen used to write `OMR ${toDigits(x, lang)}` by hand, in eleven
//  places. That hard-coded a currency the backend already knew, printed a Latin
//  code beside Arabic-Indic numerals, and could not show decimals at all - so
//  12.5 rendered as "12.5" rather than "12.500".
// ============================================================

// Arabic decimal separator (U+066B). Leaving a Latin '.' between Arabic-Indic
// digits is the same half-localised look this replaces.
const AR_DECIMAL = '٫';

// The payload carries no decimal count, so it has to be inferred. These are the
// ISO 4217 currencies subdivided by 1000 rather than 100 - Omani Rial is 1000
// baisa, so 12 is "12.000". Everything else is 2.
//
// Matched on the SYMBOL because that is all the API sends. This is a second
// source of truth and it can drift: adding `decimal_places` to the currency
// dict in the module's controllers/main.py would delete this table outright.
//
// Taken verbatim from res_currency where decimal_places = 3, TRIMMED - Odoo
// pads most of these with spaces (JOD, KWD and LYD are stored as ' د.ك ' and
// friends), and two of the seven are Latin rather than Arabic. Read them from
// the database rather than assuming, as the Tunisian dinar shows.
const THREE_DP_SYMBOLS = new Set([
  'ر.ع.',   // OMR
  'BD',     // BHD - Latin
  'DT',     // TND - Latin, not the Arabic form
  'د.ك',    // KWD
  'د.ا',    // JOD - plain alif
  'ل.د',    // LYD
  'ع.د',    // IQD
]);

const DEFAULT_DP = 2;

// Shown until the catalogue has loaded, and if the fetch fails. A bare number
// with no currency at all would be worse than a slightly stale label.
const FALLBACK = { symbol: 'OMR', position: 'before', decimals: 3 };

let _cur = null;

// Called by loadTherapies() with whatever Odoo sent. Tolerates a missing or
// malformed value by staying on the fallback rather than throwing.
export function setCurrency(c) {
  if (!c || typeof c !== 'object') return;
  const symbol = typeof c.symbol === 'string' ? c.symbol.trim() : '';
  if (!symbol) return;                       // nothing useful to show
  _cur = {
    symbol,
    // Odoo's own values; anything unexpected reads as a prefix.
    position: c.position === 'after' ? 'after' : 'before',
    // Honour decimal_places if a future backend starts sending it, so this
    // keeps working without the table above.
    decimals: Number.isInteger(c.decimal_places)
      ? c.decimal_places
      : (THREE_DP_SYMBOLS.has(symbol) ? 3 : DEFAULT_DP),
  };
}

// Exposed for the tests, and so a screen can show the symbol on its own.
export function getCurrency() {
  return _cur || FALLBACK;
}

// A price as the customer should read it: "₹ 12.00", "12.000 ر.ع.", "١٢٫٠٠٠ ر.ع."
export function money(value, lang) {
  const { symbol, position, decimals } = getCurrency();
  const n = Number(value);
  // Guards a null/undefined/'' price rendering as "NaN" on a live screen.
  let text = (Number.isFinite(n) ? n : 0).toFixed(decimals);
  if (lang === 'ar') {
    // Digits first, then the separator - toDigits only maps 0-9, so doing it
    // the other way round would leave the '.' untouched.
    text = toDigits(text, lang).replace('.', AR_DECIMAL);
  }
  // Built in logical order; the screens' own rtl styles handle alignment.
  return position === 'after' ? `${text} ${symbol}` : `${symbol} ${text}`;
}

export function formatDateTime(date, lang) {
  const ar = lang === 'ar';
  const d = date.getDate();
  const mo = (ar ? AR_MONTHS : EN_MONTHS)[date.getMonth()];
  const y = date.getFullYear();
  let hh = date.getHours();
  const ampm = hh >= 12 ? (ar ? 'م' : 'PM') : (ar ? 'ص' : 'AM');
  hh = hh % 12 || 12;
  const mm = String(date.getMinutes()).padStart(2, '0');
  const out = `${d} ${mo} ${y}${ar ? '،' : ','} ${hh}:${mm} ${ampm}`;
  return toDigits(out, lang);
}
