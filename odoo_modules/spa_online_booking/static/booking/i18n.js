/**
 * Simple i18n: a dictionary of static UI strings + a switch function.
 * Dynamic content (service names, question text, error messages built in
 * script.js) is translated via the t() helper wherever it's rendered —
 * see the calls to window.i18n.t(...) in script.js.
 */
window.i18n = (() => {
  const STRINGS = {
    en: {
      page_title: 'Book your visit',
      step_service: 'Service',
      step_therapy: 'Therapy',
      step_details: 'Your details',
      step_questions: 'A few questions',
      step_datetime: 'Date & time',
      step_review: 'Review',

      services_title: 'Our Services',
      services_hint: 'Select one or more services.',
      services_sub: 'Choose the perfect stretching session for your needs.',

      therapy_none: 'No therapies available right now.',
      packages_avail: 'Available Packages',
      packages_none: 'No packages in this therapy yet.',
      select_package_hint: 'Select a package to continue',
      btn_view_details: 'View Details',
      btn_to_questions: 'Continue',
      desc_word: 'Description',
      choose_word: 'Choose…',
      yes_word: 'Yes',
      no_word: 'No',
      from_word: 'From',
      save_word: 'Save',
      selected_package: 'Selected package',
      ref_word: 'Reference',
      info_duration: 'Session Duration',
      info_ideal: 'Ideal For',
      info_focus: 'Focus Areas',
      info_sessions: 'Number of Sessions',
      sessions_word: 'Sessions',
      minutes_word: 'Minutes',
      min_word: 'min',

      details_title: 'Your details',
      field_name: 'Full name',
      field_dob: 'Date of birth',
      field_age: 'Age',
      field_gender: 'Gender',
      gender_select: 'Select',
      gender_male: 'Male',
      gender_female: 'Female',
      gender_other: 'Other',
      field_phone: 'Mobile number',
      field_email: 'Email',
      email_ph: 'name@example.com — optional',
      field_whatsapp: 'WhatsApp number',
      same_number: 'My mobile number is the same as my WhatsApp number',
      details_hint: 'Enter your WhatsApp number first \u2014 if we already know you, the rest fills in automatically.',
      match_checking: 'Checking\u2026',
      match_not_me: 'Not me',
      match_none: "We don't have this number yet \u2014 please fill in your details below.",
      match_new: 'Someone else on this number',
      field_signature: 'Signature',
      sig_on_file: 'We already have your signature on file.',
      sig_sign_again: 'Sign again',
      terms_agree: 'I agree to the terms and conditions and confirm the details above are correct.',
      terms_required: 'Please accept the terms to continue.',
      // Fallback only. The real title and body are written per therapy in Odoo
      // and translated there, so they are not repeated in this file.
      disclaimer_title: 'Disclaimer',
      client_info: 'Client Information',
      member_type: 'Select member type',
      // Waiting list. A busy time is still offered, but the customer has to
      // know before picking it - and afterwards - that it is a queue and not
      // a confirmed appointment.
      slot_waitlist: 'Waiting list',
      slot_wait_note: 'This time is already booked. You can join the waiting list — we will contact you if it becomes free.',
      wait_title: "You're on the waiting list",
      wait_message: 'This time is already taken. We have added you to the waiting list and will contact you on WhatsApp if it becomes free.',
      sig_required: 'Please sign to continue.',
      // No mention of uploading: that control was removed, consent is signed
      // on the spot. sig_upload below is kept only for the archived handler.
      sig_hint: 'Sign inside the box.',
      sig_clear: 'Clear',
      sig_upload: 'Upload image',
      sig_err_type: 'The signature has to be an image file.',
      sig_err_big: 'That image is too big (max 2 MB).',
      sig_err_read: 'Could not read that image.',

      questions_title: 'A few questions',
      questions_hint: 'This helps us personalize your session.',
      questions_placeholder: 'Type your answer here…',
      questions_none: 'No additional questions for the selected services.',
      questions_load_error: 'Could not load questions. You can continue and we\u2019ll follow up if needed.',

      slot_title: 'Choose a date & time',
      field_date: 'Date',
      slots_loading: 'Loading times\u2026',
      slots_empty: 'No times available this day \u2014 try another date.',
      slots_error: 'Could not load times. Please try another date.',
      time_note_label: 'Preferred time not listed? Tell us (optional)',
      time_note_ph: 'e.g. I\u2019d prefer around 8 PM',

      addons_title: 'Add-ons',
      addons_hint: 'Optional extras you can add to this package.',
      review_total: 'Total:',
      // %1 = which person, %2 = how many in total.
      person_of: 'Person %1 of %2',
      copy_answers: 'Same answers as Person 1',
      field_member_phone: 'Phone number (optional)',
      review_details: 'Details',
      review_title: 'Review your booking',
      review_services: 'Services',
      review_name: 'Name',
      review_phone: 'Phone',
      review_whatsapp: 'WhatsApp',
      review_date: 'Date',
      review_time: 'Time',

      confirm_title: 'Thank you!',
      confirm_message: 'Your booking has been submitted successfully. We\u2019ve sent a confirmation to your WhatsApp.',

      btn_back: 'Back',
      btn_continue: 'Continue',
      btn_confirm: 'Confirm booking',
      btn_submitting: 'Submitting\u2026',

      err_missing_link: 'This booking link is missing information. Please ask the spa to resend it.',
      err_expired: 'This booking link has expired. Please ask the spa to send a new one.',
      err_invalid_link: 'This booking link is no longer valid.',
      err_services_load: 'Could not load services right now. Please try again shortly.',
      err_incomplete_step: 'Please complete this step before continuing.',
      err_phone_country_code: 'Please include the country code (e.g. +971 …) for both numbers.',
      err_phone_invalid: 'Please enter a valid phone number, including the country code.',
      err_submit_failed: 'We could not submit your booking. Please check your details and try again.',
      err_already_booked: 'You already have a booking for this date. Please contact the spa to change it.',
    },
    ar: {
      page_title: 'احجز زيارتك',
      step_service: 'الخدمة',
      step_therapy: 'العلاج',
      step_details: 'بياناتك',
      step_questions: 'بعض الأسئلة',
      step_datetime: 'التاريخ والوقت',
      step_review: 'المراجعة',

      services_title: 'خدماتنا',
      services_hint: 'اختر خدمة واحدة أو أكثر.',
      services_sub: 'اختر جلسة الإطالة المثالية لاحتياجاتك.',

      therapy_none: 'لا توجد علاجات متاحة حاليًا.',
      packages_avail: 'الباقات المتاحة',
      packages_none: 'لا توجد باقات في هذا العلاج بعد.',
      select_package_hint: 'اختر باقة للمتابعة',
      btn_view_details: 'عرض التفاصيل',
      btn_to_questions: 'متابعة',
      desc_word: 'الوصف',
      choose_word: 'اختر…',
      yes_word: 'نعم',
      no_word: 'لا',
      from_word: 'من',
      save_word: 'وفّر',
      selected_package: 'الباقة المختارة',
      ref_word: 'المرجع',
      info_duration: 'مدة الجلسة',
      info_ideal: 'مناسب لـ',
      info_focus: 'مناطق التركيز',
      info_sessions: 'عدد الجلسات',
      sessions_word: 'جلسات',
      minutes_word: 'دقيقة',
      min_word: 'دقيقة',

      details_title: 'بياناتك',
      field_name: 'الاسم الكامل',
      field_dob: 'تاريخ الميلاد',
      field_age: 'العمر',
      field_gender: 'الجنس',
      gender_select: 'اختر',
      gender_male: 'ذكر',
      gender_female: 'أنثى',
      gender_other: 'أخرى',
      field_phone: 'رقم الجوال',
      field_email: 'البريد الإلكتروني',
      email_ph: 'name@example.com — اختياري',
      field_whatsapp: 'رقم واتساب',
      same_number: 'رقم جوالي هو نفس رقم واتساب',
      details_hint: 'أدخل رقم واتساب أولاً \u2014 إذا كنا نعرفك، سيتم تعبئة الباقي تلقائياً.',
      match_checking: 'جاري التحقق\u2026',
      match_not_me: 'لست أنا',
      match_none: 'لا نملك هذا الرقم بعد \u2014 يرجى تعبئة بياناتك أدناه.',
      match_new: 'شخص آخر على هذا الرقم',
      field_signature: 'التوقيع',
      sig_on_file: 'لدينا توقيعك مسجّل لدينا.',
      sig_sign_again: 'وقّع مرة أخرى',
      terms_agree: 'أوافق على الشروط والأحكام وأؤكد صحة البيانات أعلاه.',
      terms_required: 'يرجى الموافقة على الشروط للمتابعة.',
      disclaimer_title: 'إخلاء المسؤولية',
      client_info: 'بيانات العميل',
      member_type: 'اختر نوع العضوية',
      slot_waitlist: 'قائمة الانتظار',
      slot_wait_note: 'هذا الوقت محجوز بالفعل. يمكنك الانضمام إلى قائمة الانتظار — وسنتواصل معك إذا أصبح متاحاً.',
      wait_title: 'أنت على قائمة الانتظار',
      wait_message: 'هذا الوقت محجوز بالفعل. لقد أضفناك إلى قائمة الانتظار وسنتواصل معك عبر واتساب إذا أصبح متاحاً.',
      sig_required: 'يرجى التوقيع للمتابعة.',
      sig_hint: 'وقّع داخل المربع.',
      sig_clear: 'مسح',
      sig_upload: 'رفع صورة',
      sig_err_type: 'يجب أن يكون التوقيع ملف صورة.',
      sig_err_big: 'الصورة كبيرة جداً (الحد 2 ميجابايت).',
      sig_err_read: 'تعذّرت قراءة الصورة.',

      questions_title: 'بعض الأسئلة',
      questions_hint: 'يساعدنا هذا في تخصيص جلستك.',
      questions_placeholder: 'اكتب إجابتك هنا…',
      questions_none: 'لا توجد أسئلة إضافية للخدمات المختارة.',
      questions_load_error: 'تعذّر تحميل الأسئلة. يمكنك المتابعة وسنتواصل معك إذا لزم الأمر.',

      slot_title: 'اختر التاريخ والوقت',
      field_date: 'التاريخ',
      slots_loading: 'جارٍ تحميل الأوقات...',
      slots_empty: 'لا توجد أوقات متاحة في هذا اليوم — جرّب تاريخًا آخر.',
      slots_error: 'تعذّر تحميل الأوقات. الرجاء تجربة تاريخ آخر.',
      time_note_label: 'وقتك المفضّل غير مدرج؟ أخبرنا (اختياري)',
      time_note_ph: 'مثال: أفضّل حوالي الساعة 8 مساءً',

      addons_title: 'الإضافات',
      addons_hint: 'إضافات اختيارية يمكنك إضافتها إلى هذه الباقة.',
      review_total: 'الإجمالي:',
      person_of: 'الشخص %1 من %2',
      copy_answers: 'نفس إجابات الشخص 1',
      field_member_phone: 'رقم الهاتف (اختياري)',
      review_details: 'التفاصيل',
      review_title: 'راجع حجزك',
      review_services: 'الخدمات',
      review_name: 'الاسم',
      review_phone: 'الهاتف',
      review_whatsapp: 'واتساب',
      review_date: 'التاريخ',
      review_time: 'الوقت',

      confirm_title: 'شكرًا لك!',
      confirm_message: 'تم إرسال حجزك بنجاح. أرسلنا تأكيدًا إلى رقم واتساب الخاص بك.',

      btn_back: 'رجوع',
      btn_continue: 'متابعة',
      btn_confirm: 'تأكيد الحجز',
      btn_submitting: 'جارٍ الإرسال...',

      err_missing_link: 'رابط الحجز هذا ناقص المعلومات. يرجى طلب رابط جديد من مركز السبا.',
      err_expired: 'انتهت صلاحية رابط الحجز هذا. يرجى طلب رابط جديد من مركز السبا.',
      err_invalid_link: 'رابط الحجز هذا لم يعد صالحًا.',
      err_services_load: 'تعذّر تحميل الخدمات الآن. يرجى المحاولة مرة أخرى بعد قليل.',
      err_incomplete_step: 'يرجى إكمال هذه الخطوة قبل المتابعة.',
      err_phone_country_code: 'يرجى إدخال رمز الدولة (مثال: ‎+971 …) لكلا الرقمين.',
      err_phone_invalid: 'يرجى إدخال رقم هاتف صالح مع رمز الدولة.',
      err_submit_failed: 'تعذّر إرسال حجزك. يرجى التحقق من بياناتك والمحاولة مرة أخرى.',
      err_already_booked: 'لديك حجز بالفعل في هذا التاريخ. يرجى التواصل مع المركز لتغييره.',
    },
  };

  let currentLang = 'en';

  function t(key) {
    return (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.en[key] || key;
  }

  function applyStaticStrings() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
  }

  function setLanguage(lang) {
    if (!STRINGS[lang]) return;
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    applyStaticStrings();
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });
    try { localStorage.setItem('spa_booking_lang', lang); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
  }

  function init() {
    let saved = 'en';
    try { saved = localStorage.getItem('spa_booking_lang') || 'en'; } catch (e) { /* ignore */ }
    setLanguage(saved);
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });
  }

  return { t, setLanguage, init, get current() { return currentLang; } };
})();

document.addEventListener('DOMContentLoaded', () => window.i18n.init());
