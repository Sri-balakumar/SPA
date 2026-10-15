// The country codes the spa actually serves, and the rules for what a valid
// number, email address and date of birth look like - shared by every screen
// that takes them: the Send Booking Link dialog, the Book Therapy details step,
// and the public booking page.
//
// The rules themselves live in static/booking/spa_validation.js, which the
// booking page loads with a plain <script> tag and the POS bundle loads (listed
// BEFORE this file in __manifest__.py) as a classic script. One file, so a
// number typed at the till and a number typed on the tablet are judged by the
// same code. This file stays as the import path every POS screen already uses.

const V = globalThis.SpaValidate;

// Deploy safety net, not a second copy of the rules. Adding a file to the POS
// bundle needs an Apps -> Upgrade; between deploying these files and doing that
// upgrade, spa_validation.js is on disk but not yet in the bundle. Without this
// the country picker would come up EMPTY and the Book Therapy screen would
// break at the till. So: keep the list and the number formatting working, and
// skip validation until the upgrade lands - exactly how the screen behaved
// before this change, rather than worse.
const FALLBACK_COUNTRIES = [
    { code: "+968", flag: "\u{1F1F4}\u{1F1F2}", name: "Oman" },
    { code: "+971", flag: "\u{1F1E6}\u{1F1EA}", name: "United Arab Emirates" },
    { code: "+966", flag: "\u{1F1F8}\u{1F1E6}", name: "Saudi Arabia" },
    { code: "+974", flag: "\u{1F1F6}\u{1F1E6}", name: "Qatar" },
    { code: "+973", flag: "\u{1F1E7}\u{1F1ED}", name: "Bahrain" },
    { code: "+965", flag: "\u{1F1F0}\u{1F1FC}", name: "Kuwait" },
    { code: "+91", flag: "\u{1F1EE}\u{1F1F3}", name: "India" },
    { code: "+44", flag: "\u{1F1EC}\u{1F1E7}", name: "United Kingdom" },
    { code: "+1", flag: "\u{1F1FA}\u{1F1F8}", name: "United States" },
];

if (!V) {
    console.warn(
        "spa_online_booking: spa_validation.js is not in the POS bundle yet - " +
            "upgrade the module (Apps -> Spa Online Booking -> Upgrade) to turn " +
            "phone, email and date-of-birth validation on at the till."
    );
}

export const COUNTRIES = V ? V.COUNTRIES : FALLBACK_COUNTRIES;
export const DEFAULT_DIAL_CODE = V ? V.DEFAULT_DIAL_CODE : "+968";

// Dial code + whatever was typed locally -> the E.164 the server stores.
// Anything that is not a digit is dropped, so "9876 54321" and "(98765) 4321"
// both come out the same. The fallback has to be RIGHT rather than absent:
// getting this wrong would store malformed numbers, which is worse than
// skipping a validation message.
export const joinPhone = V
    ? V.joinPhone
    : (dialCode, local) => {
          const digits = String(local || "").replace(/\D/g, "");
          return digits ? (dialCode || DEFAULT_DIAL_CODE) + digits : "";
      };

// The other way round, for reopening a contact we already hold: the longest
// code that matches wins, so +971 is not read as +97.
export const splitPhone = V
    ? V.splitPhone
    : (full) => {
          const value = String(full || "").trim().replace(/[^\d+]/g, "");
          if (value.startsWith("+")) {
              const match = [...FALLBACK_COUNTRIES]
                  .sort((a, b) => b.code.length - a.code.length)
                  .find((c) => value.startsWith(c.code));
              if (match) {
                  return { dialCode: match.code, local: value.slice(match.code.length) };
              }
          }
          return { dialCode: DEFAULT_DIAL_CODE, local: value.replace(/^\+/, "") };
      };

// The validators, re-exported here so a POS screen has one import to reach for.
// With no rules loaded the fallbacks keep the ONE check the screen already had
// - a booking needs a contact number - and stay silent about everything else,
// so staff never see a complaint they have no way to clear.
export const phoneError = V
    ? V.phoneError
    : (dialCode, local, required) =>
          String(local || "").replace(/\D/g, "") || required === false
              ? null
              : "err_phone_required";
// A specimen number for the selected country, used as the field's placeholder.
export const phoneExample = V ? V.phoneExample : () => "";
export const emailError = V ? V.emailError : () => null;
export const dobError = V ? V.dobError : () => null;
export const ageFromDob = V ? V.ageFromDob : () => null;
// No `max` on the date input rather than a wrong one: an empty attribute is
// ignored, a bad one would block real dates.
export const todayIso = V ? V.todayIso : () => "";
export const resolveMessage = V
    ? V.resolve
    : (code) =>
          ({
              err_phone_required: "Please enter the customer's phone number.",
              err_alt_number_required:
                  "Please enter the WhatsApp number, or tick the box above.",
          }[code] || "");
