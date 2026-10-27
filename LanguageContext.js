// App language: English / Hindi / Arabic. Provides t(key) for UI text, the
// current language, a setter (persisted), and text direction for Arabic.
import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Manager wants only English + Arabic. (Hindi strings stay in STR below,
// unused, in case more languages are re-enabled later.)
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

const STR = {
  // common
  next: { en: 'Next', hi: 'आगे', ar: 'التالي' },
  back: { en: 'Back', hi: 'पीछे', ar: 'رجوع' },
  retry: { en: 'Retry', hi: 'पुनः प्रयास करें', ar: 'إعادة المحاولة' },
  select: { en: 'Select', hi: 'चुनें', ar: 'اختر' },
  yes: { en: 'Yes', hi: 'हाँ', ar: 'نعم' },
  no: { en: 'No', hi: 'नहीं', ar: 'لا' },
  missing: { en: 'Missing', hi: 'अपूर्ण', ar: 'ناقص' },
  required: { en: 'Required', hi: 'आवश्यक', ar: 'مطلوب' },

  // service screen
  chooseService: { en: 'Choose a Service', hi: 'सेवा चुनें', ar: 'اختر خدمة' },
  serviceSub: { en: 'Select the service you would like to enjoy', hi: 'जिस सेवा का आप आनंद लेना चाहते हैं उसे चुनें', ar: 'اختر الخدمة التي ترغب بها' },
  loadingServices: { en: 'Loading services…', hi: 'सेवाएँ लोड हो रही हैं…', ar: 'جارٍ تحميل الخدمات…' },
  noServices: { en: 'No services available yet.', hi: 'अभी कोई सेवा उपलब्ध नहीं है।', ar: 'لا توجد خدمات متاحة بعد.' },
  bannerTitle: { en: 'Treat Yourself, You Deserve It!', hi: 'अपना ख्याल रखें, आप इसके हकदार हैं!', ar: 'دلل نفسك، أنت تستحق ذلك!' },
  bannerSub: { en: 'Relax • Refresh • Rejuvenate', hi: 'आराम • ताज़गी • कायाकल्प', ar: 'استرخِ • انتعش • تجدد' },

  // packages screen
  choosePackage: { en: 'Choose a package', ar: 'اختر الباقة' },
  availablePackages: { en: 'Available Packages', ar: 'الباقات المتاحة' },
  saveWord: { en: 'Save', ar: 'وفّر' },
  continueWord: { en: 'Continue', ar: 'متابعة' },
  packageDetails: { en: 'Package details', ar: 'تفاصيل الباقة' },

  // personal-info mobile lookup
  findMyDetails: { en: 'Find My Details', ar: 'ابحث عن بياناتي' },
  lookupSub: { en: 'Enter your mobile number to check if your details already exist.', ar: 'أدخل رقم جوالك للتحقق مما إذا كانت بياناتك موجودة مسبقاً.' },
  findSecure: { en: 'We use your number to find your details securely.', ar: 'نستخدم رقمك للعثور على بياناتك بأمان.' },
  registerNew: { en: 'Register as New Customer', ar: 'التسجيل كعميل جديد' },
  notYouNew: { en: 'Not you? Register as New Customer', ar: 'لست أنت؟ سجّل كعميل جديد' },
  foundYourDetails: { en: 'We found your details', ar: 'وجدنا بياناتك' },
  descriptionLabel: { en: 'Description', ar: 'الوصف' },
  numberOfSessions: { en: 'Number of Sessions', ar: 'عدد الجلسات' },
  youSave: { en: 'You Save', ar: 'أنت توفّر' },
  continueToPersonal: { en: 'Continue to Personal Info', ar: 'متابعة إلى المعلومات الشخصية' },

  // personal info
  personalTitle: { en: 'Personal Information', hi: 'व्यक्तिगत जानकारी', ar: 'المعلومات الشخصية' },
  personalSub: { en: 'Please enter your details', hi: 'कृपया अपना विवरण दर्ज करें', ar: 'يرجى إدخال بياناتك' },
  fullName: { en: 'Full Name', hi: 'पूरा नाम', ar: 'الاسم الكامل' },
  fullNamePh: { en: 'Enter your full name', hi: 'अपना पूरा नाम दर्ज करें', ar: 'أدخل اسمك الكامل' },
  dob: { en: 'Date of Birth', hi: 'जन्म तिथि', ar: 'تاريخ الميلاد' },
  dobPh: { en: 'Select date of birth', hi: 'जन्म तिथि चुनें', ar: 'اختر تاريخ الميلاد' },
  age: { en: 'Age', hi: 'आयु', ar: 'العمر' },
  auto: { en: 'Auto', hi: 'स्वतः', ar: 'تلقائي' },
  years: { en: 'years', hi: 'वर्ष', ar: 'سنة' },
  gender: { en: 'Gender', hi: 'लिंग', ar: 'الجنس' },
  female: { en: 'Female', hi: 'महिला', ar: 'أنثى' },
  male: { en: 'Male', hi: 'पुरुष', ar: 'ذكر' },
  other: { en: 'Other', hi: 'अन्य', ar: 'آخر' },
  phone: { en: 'Phone Number', hi: 'फ़ोन नंबर', ar: 'رقم الهاتف' },
  phonePh: { en: 'Enter phone number', hi: 'फ़ोन नंबर दर्ज करें', ar: 'أدخل رقم الهاتف' },
  whatsappSame: { en: 'WhatsApp number same as phone number', hi: 'व्हाट्सएप नंबर फ़ोन नंबर के समान', ar: 'رقم واتساب نفس رقم الهاتف' },
  whatsapp: { en: 'WhatsApp Number', hi: 'व्हाट्सएप नंबर', ar: 'رقم واتساب' },
  whatsappPh: { en: 'Enter WhatsApp number', hi: 'व्हाट्सएप नंबर दर्ज करें', ar: 'أدخل رقم واتساب' },
  enterName: { en: 'Please enter your full name.', hi: 'कृपया अपना पूरा नाम दर्ज करें।', ar: 'يرجى إدخال اسمك الكامل.' },
  selectDob: { en: 'Please select your date of birth.', hi: 'कृपया अपनी जन्म तिथि चुनें।', ar: 'يرجى اختيار تاريخ ميلادك.' },
  selectGender: { en: 'Please select your gender.', hi: 'कृपया अपना लिंग चुनें।', ar: 'يرجى اختيار جنسك.' },
  enterPhone: { en: 'Please enter your phone number.', hi: 'कृपया अपना फ़ोन नंबर दर्ज करें।', ar: 'يرجى إدخال رقم هاتفك.' },
  enterWhatsapp: { en: 'Please enter your WhatsApp number.', hi: 'कृपया अपना व्हाट्सएप नंबर दर्ज करें।', ar: 'يرجى إدخال رقم واتساب.' },
  email: { en: 'Email Address', hi: 'ईमेल पता', ar: 'البريد الإلكتروني' },
  emailPh: { en: 'Enter your email address', hi: 'अपना ईमेल पता दर्ज करें', ar: 'أدخل بريدك الإلكتروني' },
  invalidEmail: { en: 'Invalid email', hi: 'अमान्य ईमेल', ar: 'بريد إلكتروني غير صالح' },
  invalidEmailMsg: { en: 'Please enter a valid email address.', hi: 'कृपया एक मान्य ईमेल पता दर्ज करें।', ar: 'يرجى إدخال بريد إلكتروني صالح.' },
  signature: { en: 'Digital Signature', hi: 'डिजिटल हस्ताक्षर', ar: 'التوقيع الرقمي' },
  signHint: { en: 'Sign here with your finger', hi: 'यहाँ अपनी उंगली से हस्ताक्षर करें', ar: 'وقّع هنا بإصبعك' },
  clearSign: { en: 'Clear', hi: 'साफ़ करें', ar: 'مسح' },
  signatureRequired: { en: 'Please sign in the box to continue.', hi: 'जारी रखने के लिए कृपया बॉक्स में हस्ताक्षर करें।', ar: 'يرجى التوقيع في المربع للمتابعة.' },
  agreeText: { en: 'I agree to the terms and conditions and confirm the details above are correct.', hi: 'मैं नियम और शर्तों से सहमत हूँ और पुष्टि करता/करती हूँ कि ऊपर दिए गए विवरण सही हैं।', ar: 'أوافق على الشروط والأحكام وأؤكد أن التفاصيل أعلاه صحيحة.' },
  agreeFirst: { en: 'Please tick “I agree” before signing.', hi: 'हस्ताक्षर करने से पहले कृपया "मैं सहमत हूँ" पर टिक करें।', ar: 'يरجى تحديد "أوافق" قبل التوقيع.' },

  // disclaimer screen — the waiver's own title and body are written per therapy
  // in Odoo and translated there, so they are not repeated here. These are only
  // the surrounding chrome.
  disclaimerTitle: { en: 'Disclaimer', ar: 'إخلاء المسؤولية' },
  disclaimerSub: { en: 'Please read and accept to continue', ar: 'يرجى القراءة والموافقة للمتابعة' },
  clientInfo: { en: 'Client Information', ar: 'معلومات العميل' },
  agreeToThis: { en: 'I have read and accept the above.', ar: 'لقد قرأت وأوافق على ما ورد أعلاه.' },

  // member types / family bookings
  memberType: { en: 'Who is this for?', ar: 'لمن هذا الحجز؟' },
  noPackagesForOption: { en: 'No packages for this option yet.', ar: 'لا توجد باقات لهذا الخيار بعد.' },
  // %1 = this person's number, %2 = how many the package covers
  personOf: { en: 'Person %1 of %2', ar: 'الشخص %1 من %2' },
  leadPersonNote: { en: 'Books and pays for the session.', ar: 'يحجز ويدفع مقابل الجلسة.' },
  memberPersonNote: { en: 'Phone and email are optional for this person.', ar: 'الهاتف والبريد الإلكتروني اختياريان لهذا الشخص.' },
  copyAnswers: { en: 'Same answers as Person 1', ar: 'نفس إجابات الشخص 1' },
  healthyNoChanges: { en: 'Healthy - no changes', ar: 'بصحة جيدة - لا تغييرات' },
  lastUpdated: { en: 'Last updated', ar: 'آخر تحديث' },
  healthOnFile: { en: 'Health answers on file', ar: 'الإجابات الصحية محفوظة' },
  // Same wording as the POS questions box.
  healthSkipNote: { en: 'The answers on file will be used. Untick the box if anything has changed.', ar: 'سيتم استخدام الإجابات المحفوظة. أزل العلامة من المربع إذا تغيّر أي شيء.' },
  healthChanged: { en: 'Health changed - update answers', ar: 'تغيّرت الحالة الصحية - حدّث الإجابات' },
  healthNewQuestion: { en: 'A new question has been added since the last visit - please answer it.', ar: 'تمت إضافة سؤال جديد منذ آخر زيارة - يرجى الإجابة عليه.' },
  by: { en: 'by', ar: 'بواسطة' },
  memberPhone: { en: 'Phone Number (optional)', ar: 'رقم الهاتف (اختياري)' },
  peopleLabel: { en: 'People', ar: 'الأشخاص' },

  // optional extras
  addonsTitle: { en: 'Optional Extras', ar: 'إضافات اختيارية' },
  addonsHint: { en: 'Tick anything you would like to add.', ar: 'حدّد ما ترغب في إضافته.' },
  reviewTotal: { en: 'Total', ar: 'الإجمالي' },
  addonsLabel: { en: 'Extras', ar: 'الإضافات' },

  // health
  healthTitle: { en: 'Your Health & Preferences', hi: 'आपका स्वास्थ्य और प्राथमिकताएँ', ar: 'صحتك وتفضيلاتك' },
  healthSub: { en: 'Help us serve you better', hi: 'हमें आपकी बेहतर सेवा करने में मदद करें', ar: 'ساعدنا على خدمتك بشكل أفضل' },
  loadingQuestions: { en: 'Loading questions…', hi: 'प्रश्न लोड हो रहे हैं…', ar: 'جارٍ تحميل الأسئلة…' },
  noQuestions: { en: 'No questions for this service. You can continue.', hi: 'इस सेवा के लिए कोई प्रश्न नहीं। आप आगे बढ़ सकते हैं।', ar: 'لا توجد أسئلة لهذه الخدمة. يمكنك المتابعة.' },
  typeAnswer: { en: 'Type your answer', hi: 'अपना उत्तर लिखें', ar: 'اكتب إجابتك' },
  answerThis: { en: 'Please answer:', hi: 'कृपया उत्तर दें:', ar: 'يرجى الإجابة:' },

  // review
  reviewTitle: { en: 'Review Your Details', hi: 'अपना विवरण जांचें', ar: 'راجع بياناتك' },
  reviewSub: { en: 'Please confirm your information', hi: 'कृपया अपनी जानकारी की पुष्टि करें', ar: 'يرجى تأكيد معلوماتك' },
  name: { en: 'Name', hi: 'नाम', ar: 'الاسم' },
  service: { en: 'Service', hi: 'सेवा', ar: 'الخدمة' },
  genderAge: { en: 'Gender / Age', hi: 'लिंग / आयु', ar: 'الجنس / العمر' },
  mobile: { en: 'Mobile', hi: 'मोबाइल', ar: 'الجوال' },
  specialReq: { en: 'Special Request', hi: 'विशेष अनुरोध', ar: 'طلب خاص' },
  qAnswered: { en: 'Questions answered', hi: 'उत्तर दिए प्रश्न', ar: 'الأسئلة المجابة' },
  submit: { en: 'Submit Request', hi: 'अनुरोध सबमिट करें', ar: 'إرسال الطلب' },
  submitting: { en: 'Submitting…', hi: 'सबमिट हो रहा है…', ar: 'جارٍ الإرسال…' },
  couldNotSubmit: { en: 'Could not submit', hi: 'सबमिट नहीं हो सका', ar: 'تعذر الإرسال' },
  tryAgain: { en: 'Please try again.', hi: 'कृपया पुनः प्रयास करें।', ar: 'يرجى المحاولة مرة أخرى.' },

  // success
  successTitle: { en: 'Your request has been submitted successfully!', hi: 'आपका अनुरोध सफलतापूर्वक सबमिट हो गया है!', ar: 'تم إرسال طلبك بنجاح!' },
  successSub: { en: 'Our reception team will review your details and confirm your appointment shortly.', hi: 'हमारी रिसेप्शन टीम आपके विवरण की समीक्षा करेगी और शीघ्र ही आपकी अपॉइंटमेंट की पुष्टि करेगी।', ar: 'سيراجع فريق الاستقبال بياناتك ويؤكد موعدك قريبًا.' },
  reference: { en: 'Reference', hi: 'संदर्भ', ar: 'المرجع' },
  goHome: { en: 'Go to Home', hi: 'होम पर जाएँ', ar: 'العودة للرئيسية' },

  // welcome screen (text only — design stays identical in both languages)
  // Standalone greeting — the Arabic drops the trailing في ("to"), which only
  // made sense while a venue name followed it.
  welcomeTitle: { en: 'Welcome', hi: 'Welcome', ar: 'مرحبًا بك' },
  howContinue: { en: 'How would you like to continue?', hi: 'How would you like to continue?', ar: 'كيف تود المتابعة؟' },
  newCustomer: { en: 'New Customer', hi: 'New Customer', ar: 'عميل جديد' },
  newCustomerDesc: { en: 'Book a new package and get started', hi: 'Book a new package and get started', ar: 'احجز باقة جديدة وابدأ' },
  existingCustomer: { en: 'Existing Customer', hi: 'Existing Customer', ar: 'عميل حالي' },
  existingCustomerDesc: { en: 'Continue with your existing package', hi: 'Continue with your existing package', ar: 'تابع مع باقتك الحالية' },
  selectLanguage: { en: 'Select Your Language', hi: 'Select Your Language', ar: 'اختر لغتك' },

  // existing-customer flow — Welcome Back (mobile lookup)
  welcomeBack: { en: 'Welcome Back!', ar: 'مرحبًا بعودتك!' },
  enterMobile: { en: 'Enter your registered mobile number', ar: 'أدخل رقم هاتفك المسجل' },
  mobileNumber: { en: 'Mobile Number', ar: 'رقم الهاتف' },
  enterMobilePh: { en: 'Enter mobile number', ar: 'أدخل رقم الهاتف' },
  // {n} is filled with the selected country's digit count.
  enterNDigits: { en: 'Enter {n} digit number', ar: 'أدخل رقمًا من {n} أرقام' },
  phoneInvalid: { en: 'Enter a valid mobile number for the selected country.', ar: 'أدخل رقم هاتف محمول صالحًا للدولة المختارة.' },
  gmailOnly: { en: 'Please enter a Gmail address ending in @gmail.com', ar: 'يرجى إدخال بريد Gmail ينتهي بـ @gmail.com' },
  findMyPackages: { en: 'Find My Packages', ar: 'ابحث عن باقاتي' },
  secureNote: { en: 'We use your number to find your active packages securely.', ar: 'نستخدم رقمك للعثور على باقاتك النشطة بأمان.' },
  needAssistance: { en: 'Need assistance? Please contact the reception desk.', ar: 'بحاجة إلى مساعدة؟ يرجى التواصل مع مكتب الاستقبال.' },
  notFound: { en: 'Not found', ar: 'غير موجود' },
  notFoundMsg: { en: 'No packages found for this number. Please check it, or ask reception for help.', ar: 'لا توجد باقات لهذا الرقم. يرجى التحقق منه أو طلب المساعدة من الاستقبال.' },
  missingMobile: { en: 'Please enter your mobile number.', ar: 'يرجى إدخال رقم هاتفك.' },
  couldNotLookup: { en: 'Could not look up', ar: 'تعذّر البحث' },

  // Select Your Profile
  selectProfile: { en: 'Select Your Profile', ar: 'اختر ملفك الشخصي' },
  foundMultiple: { en: 'We found multiple customers linked to this mobile number.', ar: 'وجدنا عدة عملاء مرتبطين بهذا الرقم.' },
  activePkg: { en: 'Active Package', ar: 'باقة نشطة' },
  activePkgs: { en: 'Active Packages', ar: 'باقات نشطة' },
  noActivePkg: { en: 'No Active Package', ar: 'لا توجد باقة نشطة' },
  noCustomers: { en: 'No customers found for this number.', ar: 'لا يوجد عملاء لهذا الرقم.' },
  sampleData: { en: 'SAMPLE DATA · until the backend is connected', ar: 'بيانات تجريبية · حتى يتم ربط الخادم' },

  // My Profile & Active Packages
  hello: { en: 'Hello', ar: 'مرحبًا' },
  myActivePackages: { en: 'My Active Packages', ar: 'باقاتي النشطة' },
  edit: { en: 'Edit', ar: 'تعديل' },
  ofWord: { en: 'of', ar: 'من' },
  usedWord: { en: 'used', ar: 'مُستخدمة' },
  sessionsRemaining: { en: 'Sessions Remaining', ar: 'جلسة متبقية' },
  noSessionsLeft: { en: 'No sessions left', ar: 'لا توجد جلسات متبقية' },
  active: { en: 'Active', ar: 'نشط' },
  completed: { en: 'Completed', ar: 'مكتمل' },
  noPackages: { en: 'No packages found for this customer.', ar: 'لا توجد باقات لهذا العميل.' },

  // Package Details + Booking Successful
  packageTotal: { en: 'Package Total', ar: 'إجمالي الباقة' },
  completedSessions: { en: 'Completed Sessions', ar: 'الجلسات المكتملة' },
  remainingSessions: { en: 'Remaining Sessions', ar: 'الجلسات المتبقية' },
  sessionDuration: { en: 'Session Duration', ar: 'مدة الجلسة' },
  idealFor: { en: 'Ideal For', ar: 'مناسب لـ' },
  focusAreas: { en: 'Focus Areas', ar: 'مناطق التركيز' },
  pricePerSession: { en: 'Price per Session', ar: 'سعر الجلسة' },
  validTill: { en: 'Valid Till', ar: 'صالحة حتى' },
  nextSession: { en: 'Next Session', ar: 'الجلسة التالية' },
  checkInHint: { en: "You can check in for today's session.", ar: 'يمكنك تسجيل الوصول لجلسة اليوم.' },
  checkInToday: { en: "Check In for Today's Session", ar: 'سجّل الوصول لجلسة اليوم' },
  allCompleted: { en: 'All Sessions Completed', ar: 'اكتملت جميع الجلسات' },
  bookingSuccessful: { en: 'Booking Successful!', ar: 'تم الحجز بنجاح!' },
  bookingSuccessSub: { en: 'Your session has been booked successfully.', ar: 'تم حجز جلستك بنجاح.' },
  dateTimeLabel: { en: 'Date & Time', ar: 'التاريخ والوقت' },
  sessionLabel: { en: 'Session', ar: 'الجلسة' },
  sessionWord: { en: 'Session', ar: 'جلسة' },
  sessionsWord: { en: 'Sessions', ar: 'جلسات' },
  minutesWord: { en: 'Minutes', ar: 'دقيقة' },
  done: { en: 'Done', ar: 'تم' },

  // Edit Profile
  pleaseUpdate: { en: 'Please update your details', ar: 'يرجى تحديث بياناتك' },
  saveChanges: { en: 'Save Changes', ar: 'حفظ التغييرات' },
};

const LanguageContext = createContext(null);
const KEY = 'spa.lang';

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (v) setLangState(v); });
  }, []);

  function setLang(code) {
    setLangState(code);
    AsyncStorage.setItem(KEY, code).catch(() => {});
  }

  // t('key') as before; t('key', { n: 10 }) fills {n} placeholders in the string.
  const t = (key, vars) => {
    const str = STR[key] ? (STR[key][lang] || STR[key].en) : key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  };
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
