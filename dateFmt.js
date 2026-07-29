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
