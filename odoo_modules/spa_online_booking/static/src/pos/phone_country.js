// The country codes the spa actually serves, shared by every screen that takes
// a phone number - the Send Booking Link dialog and the Book Therapy details
// step. One list, so a number typed at the till and a number typed on the
// tablet cannot end up in different shapes.
export const COUNTRIES = [
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

export const DEFAULT_DIAL_CODE = "+968";

// Dial code + whatever was typed locally -> the E.164 the server stores.
// Anything that is not a digit is dropped, so "9876 54321" and "(98765) 4321"
// both come out the same.
export function joinPhone(dialCode, local) {
    const digits = String(local || "").replace(/\D/g, "");
    if (!digits) {
        return "";
    }
    return (dialCode || DEFAULT_DIAL_CODE) + digits;
}

// The other way round, for reopening a contact we already hold: the longest
// code that matches wins, so +971 is not read as +97.
export function splitPhone(full) {
    const value = String(full || "").trim().replace(/[^\d+]/g, "");
    if (value.startsWith("+")) {
        const match = [...COUNTRIES]
            .sort((a, b) => b.code.length - a.code.length)
            .find((c) => value.startsWith(c.code));
        if (match) {
            return { dialCode: match.code, local: value.slice(match.code.length) };
        }
    }
    // No country code we know: leave the digits alone rather than guessing a
    // country and pointing WhatsApp at a stranger.
    return { dialCode: DEFAULT_DIAL_CODE, local: value.replace(/^\+/, "") };
}
