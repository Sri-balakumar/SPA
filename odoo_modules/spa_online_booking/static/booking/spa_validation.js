// The one place that knows what a valid phone number, email address and date
// of birth look like. Loaded BOTH by the public booking page (plain <script>
// tag in index.html) and by the POS bundle (listed before phone_country.js in
// __manifest__.py), so a number rejected at the till is rejected on the website
// and vice versa.
//
// Deliberately a classic script assigning window.SpaValidate, not an ES module:
// static/booking/*.js is served raw, outside any Odoo asset bundle, and cannot
// use `import`. A plain IIFE is the only shape both worlds can load.
//
// Everything here returns a CODE, never a sentence. The website translates the
// code through i18n.js (en + ar); the POS reads MESSAGES below. That way a new
// language never has to touch the rules.
(function (root) {
    "use strict";

    // The countries the spa actually serves, and what a MOBILE number looks
    // like in each. Everyone booked here gets messaged on WhatsApp, so a
    // landline is not a number we can use - which is why the ranges below are
    // the mobile ones only.
    //
    //   lengths  - digits in the national number, i.e. what is typed AFTER the
    //              dial code.
    //   prefixes - what such a number may start with. A number is rejected only
    //              once it is long enough to judge, so "5" is still accepted
    //              while typing a UAE "50…".
    //   example  - shown as the field's placeholder for that country.
    //
    // Sorted the way the menu should read, default country first.
    var COUNTRIES = [
        { code: "+968", flag: "\u{1F1F4}\u{1F1F2}", name: "Oman",
          lengths: [8], prefixes: ["7", "9"], example: "91234567" },
        { code: "+971", flag: "\u{1F1E6}\u{1F1EA}", name: "United Arab Emirates",
          lengths: [9], prefixes: ["50", "52", "54", "55", "56", "58"],
          example: "501234567" },
        { code: "+966", flag: "\u{1F1F8}\u{1F1E6}", name: "Saudi Arabia",
          lengths: [9], prefixes: ["5"], example: "512345678" },
        { code: "+974", flag: "\u{1F1F6}\u{1F1E6}", name: "Qatar",
          lengths: [8], prefixes: ["3", "5", "6", "7"], example: "55123456" },
        { code: "+973", flag: "\u{1F1E7}\u{1F1ED}", name: "Bahrain",
          lengths: [8], prefixes: ["3", "6"], example: "36123456" },
        // 41 is a real Kuwaiti mobile range as well as the 5/6/9 blocks.
        { code: "+965", flag: "\u{1F1F0}\u{1F1FC}", name: "Kuwait",
          lengths: [8], prefixes: ["5", "6", "9", "41"], example: "51234567" },
        { code: "+91", flag: "\u{1F1EE}\u{1F1F3}", name: "India",
          lengths: [10], prefixes: ["6", "7", "8", "9"], example: "9876543210" },
        { code: "+44", flag: "\u{1F1EC}\u{1F1E7}", name: "United Kingdom",
          lengths: [10], prefixes: ["7"], example: "7123456789" },
        // North America has no separate mobile range - the rule is structural:
        // neither the area code nor the exchange after it may start 0 or 1.
        // `exchangeRule` is what applies that second half.
        { code: "+1", flag: "\u{1F1FA}\u{1F1F8}", name: "United States",
          lengths: [10], prefixes: ["2", "3", "4", "5", "6", "7", "8", "9"],
          prefixLabel: "2-9", exchangeRule: true, example: "2125551234" },
    ];

    var DEFAULT_DIAL_CODE = "+968";

    // The widest net any country could need. Used for a dial code we have no
    // `lengths` for, so adding a country to the list above can never hard-block
    // a booking just because nobody filled in its digit count yet.
    var FALLBACK_MIN = 6;
    var FALLBACK_MAX = 15;

    var MAX_EMAIL_LEN = 254; // RFC 5321, and what controllers/main.py enforces.
    var MAX_AGE = 120;

    // --- phone ------------------------------------------------------------

    // Dial code + whatever was typed locally -> the E.164 the server stores.
    // Anything that is not a digit is dropped, so "9876 54321" and "(98765) 4321"
    // both come out the same.
    function joinPhone(dialCode, local) {
        var digits = String(local || "").replace(/\D/g, "");
        if (!digits) {
            return "";
        }
        return (dialCode || DEFAULT_DIAL_CODE) + digits;
    }

    // The other way round, for reopening a contact we already hold: the longest
    // code that matches wins, so +971 is not read as +97.
    function splitPhone(full) {
        var value = String(full || "").trim().replace(/[^\d+]/g, "");
        if (value.startsWith("+")) {
            var match = COUNTRIES.slice()
                .sort(function (a, b) {
                    return b.code.length - a.code.length;
                })
                .find(function (c) {
                    return value.startsWith(c.code);
                });
            if (match) {
                return { dialCode: match.code, local: value.slice(match.code.length) };
            }
        }
        // No country code we know: leave the digits alone rather than guessing a
        // country and pointing WhatsApp at a stranger.
        return { dialCode: DEFAULT_DIAL_CODE, local: value.replace(/^\+/, "") };
    }

    function countryFor(dialCode) {
        var code = dialCode || DEFAULT_DIAL_CODE;
        return (
            COUNTRIES.find(function (c) {
                return c.code === code;
            }) || null
        );
    }

    // How many digits this country expects, as a bare figure for the error
    // message: "10", "8/9", "6-15". Deliberately no words - the surrounding
    // sentence comes from the message table, so Arabic reads as Arabic instead
    // of an Arabic sentence with "8 or 9 digits" wedged into the middle of it.
    function phoneHint(dialCode) {
        var country = countryFor(dialCode);
        var lengths = country && country.lengths;
        if (!lengths || !lengths.length) {
            return FALLBACK_MIN + "-" + FALLBACK_MAX;
        }
        return lengths.join("/");
    }

    function countryName(dialCode) {
        var country = countryFor(dialCode);
        return country ? country.name : dialCode || DEFAULT_DIAL_CODE;
    }

    // What such a number may start with, spelled out for the error message:
    // "6, 7, 8 or 9". A country may override it (the US range reads far better
    // as "2-9" than as eight numbers in a row).
    function phonePrefixes(dialCode) {
        var country = countryFor(dialCode);
        if (!country || !country.prefixes || !country.prefixes.length) {
            return "";
        }
        if (country.prefixLabel) {
            return country.prefixLabel;
        }
        var list = country.prefixes;
        if (list.length === 1) {
            return list[0];
        }
        return list.slice(0, -1).join(", ") + " or " + list[list.length - 1];
    }

    // A specimen number for this country, for the input's placeholder.
    function phoneExample(dialCode) {
        var country = countryFor(dialCode);
        return (country && country.example) || "";
    }

    // Does what has been typed so far still stand a chance of being one of the
    // allowed openings? Half of "50" is "5", and rejecting that mid-keystroke
    // would put an error under a UAE number the moment it was started.
    function _prefixPossible(digits, prefixes) {
        return prefixes.some(function (p) {
            return digits.length >= p.length
                ? digits.slice(0, p.length) === p
                : p.slice(0, digits.length) === digits;
        });
    }

    // null when the number is fine. `required` false lets an empty box pass -
    // persons 2+ of a family booking have an optional number.
    function phoneError(dialCode, local, required) {
        var digits = String(local || "").replace(/\D/g, "");
        if (!digits) {
            return required === false ? null : "err_phone_required";
        }
        var country = countryFor(dialCode);
        // The opening digits are checked BEFORE the length: they can be judged
        // from the first keystroke, and "that is not a mobile number" is more
        // use than "keep typing" when the number was never going to work.
        if (country && country.prefixes && country.prefixes.length
                && !_prefixPossible(digits, country.prefixes)) {
            return "err_phone_prefix";
        }
        // North America only: the three digits after the area code are an
        // exchange code, and it may not start 0 or 1 either.
        if (country && country.exchangeRule && digits.length >= 4
                && "01".indexOf(digits.charAt(3)) !== -1) {
            return "err_phone_exchange";
        }
        var lengths = country && country.lengths;
        if (!lengths || !lengths.length) {
            return digits.length >= FALLBACK_MIN && digits.length <= FALLBACK_MAX
                ? null
                : "err_phone_length";
        }
        return lengths.indexOf(digits.length) === -1 ? "err_phone_length" : null;
    }

    // Same rule, but starting from a stored E.164 like "+919876543210" - used
    // when validating something we did not collect through a country picker.
    function fullPhoneError(full, required) {
        var value = String(full || "").trim();
        if (!value) {
            return required === false ? null : "err_phone_required";
        }
        if (!value.startsWith("+")) {
            return "err_phone_country_code";
        }
        var parts = splitPhone(value);
        return phoneError(parts.dialCode, parts.local, required);
    }

    // --- email ------------------------------------------------------------

    // Intentionally not a full RFC 5322 grammar - nobody wants that regex, and
    // the strict version rejects addresses that work. This catches what people
    // actually get wrong: no @, no dot in the domain, a space, a bare domain
    // like "angitha.com". Mirrored by _parse_email in controllers/main.py.
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

    // Email is optional everywhere, so blank is fine. Anything typed has to be
    // a real address - a half-finished one silently loses the customer their
    // confirmation mail.
    function emailError(value) {
        var email = String(value || "").trim();
        if (!email) {
            return null;
        }
        if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
            return "err_email_invalid";
        }
        return null;
    }

    // --- date of birth ----------------------------------------------------

    // Today as YYYY-MM-DD in the BROWSER's timezone, which is the timezone the
    // date input and the customer are both in. Deliberately not toISOString():
    // that converts to UTC and hands back yesterday for anyone east of London
    // in the early hours, making today's date look like the future.
    function todayIso() {
        var now = new Date();
        var month = String(now.getMonth() + 1).padStart(2, "0");
        var day = String(now.getDate()).padStart(2, "0");
        return now.getFullYear() + "-" + month + "-" + day;
    }

    // Whole years between the date of birth and today, or null if unusable.
    // Does NOT clamp - dobError decides what is acceptable, this just counts.
    function ageFromDob(value) {
        var raw = String(value || "").trim();
        if (!raw) {
            return null;
        }
        // Parse the parts by hand rather than `new Date(raw)`: that reads a
        // bare "2029-02-11" as UTC midnight, which is the previous day in any
        // timezone behind UTC.
        var parts = raw.split("-");
        if (parts.length !== 3) {
            return null;
        }
        var year = Number(parts[0]);
        var month = Number(parts[1]);
        var day = Number(parts[2]);
        if (!year || !month || !day) {
            return null;
        }
        var born = new Date(year, month - 1, day);
        // Rejects 31 February and friends: the Date constructor rolls them over
        // into the next month instead of failing.
        if (
            born.getFullYear() !== year ||
            born.getMonth() !== month - 1 ||
            born.getDate() !== day
        ) {
            return null;
        }
        var now = new Date();
        var age = now.getFullYear() - year;
        var monthDiff = now.getMonth() - (month - 1);
        if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < day)) {
            age--;
        }
        return age;
    }

    function dobError(value, required) {
        var raw = String(value || "").trim();
        if (!raw) {
            return required === false ? null : "err_dob_required";
        }
        var age = ageFromDob(raw);
        if (age === null) {
            return "err_dob_invalid";
        }
        if (age < 0) {
            return "err_dob_future";
        }
        if (age >= MAX_AGE) {
            return "err_dob_too_old";
        }
        return null;
    }

    // --- messages ---------------------------------------------------------

    // English text for every code above. The POS uses these directly; the
    // public page looks the same keys up in i18n.js so Arabic works too.
    // {hint} and {country} are filled by resolve() below.
    var MESSAGES = {
        err_phone_required: "Please enter the customer's phone number.",
        err_phone_country_code: "Please include the country code, starting with +.",
        err_phone_length: "Enter {hint} digits for {country}.",
        err_phone_prefix: "A mobile number for {country} starts with {prefixes}.",
        err_phone_exchange:
            "After the area code, the next three digits must also start with 2-9.",
        // The second number, when "same as the first" is unticked. Which field
        // that is depends on the screen - the POS asks for the phone number
        // first and WhatsApp second, the booking page the other way round - so
        // the code is neutral and each surface supplies its own wording. This
        // is the POS one; the page overrides it through i18n.js.
        err_alt_number_required: "Please enter the WhatsApp number, or tick the box above.",
        err_name_required: "Please enter the full name.",
        err_email_invalid: "Enter a valid email address, like name@example.com.",
        err_dob_required: "Please enter the date of birth.",
        err_dob_invalid: "That date of birth is not a real date.",
        err_dob_future: "The date of birth cannot be in the future.",
        err_dob_too_old: "Please check the year of birth.",
        err_gender_required: "Please select a gender.",
    };

    // Code -> sentence, with the country-specific bits filled in. `dialCode` is
    // only needed for the phone-length message.
    function resolve(code, dialCode, messages) {
        if (!code) {
            return "";
        }
        var table = messages || MESSAGES;
        var text = table[code] || MESSAGES[code] || code;
        return text
            .replace("{hint}", phoneHint(dialCode))
            .replace("{prefixes}", phonePrefixes(dialCode))
            .replace("{country}", countryName(dialCode));
    }

    root.SpaValidate = {
        COUNTRIES: COUNTRIES,
        DEFAULT_DIAL_CODE: DEFAULT_DIAL_CODE,
        MAX_EMAIL_LEN: MAX_EMAIL_LEN,
        MAX_AGE: MAX_AGE,
        MESSAGES: MESSAGES,
        joinPhone: joinPhone,
        splitPhone: splitPhone,
        countryFor: countryFor,
        countryName: countryName,
        phoneHint: phoneHint,
        phonePrefixes: phonePrefixes,
        phoneExample: phoneExample,
        phoneError: phoneError,
        fullPhoneError: fullPhoneError,
        emailError: emailError,
        todayIso: todayIso,
        ageFromDob: ageFromDob,
        dobError: dobError,
        resolve: resolve,
    };
})(typeof window !== "undefined" ? window : globalThis);
