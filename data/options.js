// Default data for the tablet flow.
//
// SERVICES: the fallback list shown when Odoo has no kiosk services yet.
// Later these come live from Odoo (products flagged "Show on Spa Kiosk").
// Each has an emoji placeholder in place of a real photo.
// Each service: photo, a line-icon for the badge (MaterialCommunityIcons name),
// a short description, and a pastel "wave" colour for the card footer.
export const SERVICES = [
  { name: 'Massage Therapy', img: require('../assets/services/massage.jpg'), icon: 'spa', desc: 'Relieves stress and relaxes muscles', wave: '#EDE3F7' },
  { name: 'Facial Treatment', img: require('../assets/services/facial.jpg'), icon: 'face-woman', desc: 'Rejuvenate your skin and glow naturally', wave: '#F7E3EE' },
  { name: 'Hair Spa', img: require('../assets/services/hairspa.jpg'), icon: 'hair-dryer', desc: 'Nourish, strengthen and shine', wave: '#F7E7E0' },
  { name: 'Body Scrub', img: require('../assets/services/bodyscrub.jpg'), icon: 'shimmer', desc: 'Exfoliate and refresh your skin', wave: '#EDE3F7' },
  { name: 'Manicure', img: require('../assets/services/manicure.jpg'), icon: 'hand-back-right', desc: 'Perfect care for your hands and nails', wave: '#E3F1E8' },
  { name: 'Pedicure', img: require('../assets/services/pedicure.jpg'), icon: 'foot-print', desc: 'Relax and rejuvenate your feet', wave: '#FaF0DC' },
  { name: 'Aromatherapy', img: require('../assets/services/aromatherapy.jpg'), icon: 'bottle-tonic', desc: 'Natural oils for mind and body balance', wave: '#F7E3EE' },
  { name: 'Steam & Sauna', img: require('../assets/services/steam.jpg'), icon: 'hot-tub', desc: 'Detoxify and improve circulation', wave: '#EDE3F7' },
  { name: 'Spa Packages', img: require('../assets/services/packages.jpg'), icon: 'gift-outline', desc: 'Relax with our exclusive packages', wave: '#E3EBF7' },
];

// Translations for the built-in service names + descriptions (Hindi / Arabic).
// New services added in Odoo fall back to their Odoo name until the company
// adds Odoo translations.
export const SERVICE_I18N = {
  'Massage Therapy': { name: { hi: 'मसाज थेरेपी', ar: 'العلاج بالتدليك' }, desc: { hi: 'तनाव कम करता है और मांसपेशियों को आराम देता है', ar: 'يخفف التوتر ويرخي العضلات' } },
  'Facial Treatment': { name: { hi: 'फेशियल ट्रीटमेंट', ar: 'علاج الوجه' }, desc: { hi: 'त्वचा को फिर से निखारें और प्राकृतिक चमक पाएं', ar: 'جدد بشرتك واحصل على إشراقة طبيعية' } },
  'Hair Spa': { name: { hi: 'हेयर स्पा', ar: 'سبا الشعر' }, desc: { hi: 'पोषण, मजबूती और चमक', ar: 'تغذية وتقوية ولمعان' } },
  'Body Scrub': { name: { hi: 'बॉडी स्क्रब', ar: 'تقشير الجسم' }, desc: { hi: 'त्वचा को एक्सफोलिएट और तरोताजा करें', ar: 'قشّر بشرتك وأنعشها' } },
  'Manicure': { name: { hi: 'मैनीक्योर', ar: 'مانيكير' }, desc: { hi: 'आपके हाथों और नाखूनों की उत्तम देखभाल', ar: 'عناية مثالية ليديك وأظافرك' } },
  'Pedicure': { name: { hi: 'पेडीक्योर', ar: 'باديكير' }, desc: { hi: 'अपने पैरों को आराम और ताजगी दें', ar: 'أرح قدميك وجددهما' } },
  'Aromatherapy': { name: { hi: 'अरोमाथेरेपी', ar: 'العلاج بالروائح' }, desc: { hi: 'मन और शरीर के संतुलन के लिए प्राकृतिक तेल', ar: 'زيوت طبيعية لتوازن الجسم والعقل' } },
  'Steam & Sauna': { name: { hi: 'स्टीम और सॉना', ar: 'البخار والساونا' }, desc: { hi: 'विषहरण करें और रक्त संचार सुधारें', ar: 'التخلص من السموم وتحسين الدورة الدموية' } },
  'Spa Packages': { name: { hi: 'स्पा पैकेज', ar: 'باقات السبا' }, desc: { hi: 'हमारे विशेष पैकेजों के साथ आराम करें', ar: 'استرخِ مع باقاتنا الحصرية' } },
};

// Dropdown option lists (Health & Preferences, Personal Info, Appointment).
export const GENDER = ['Female', 'Male', 'Other'];
export const YES_NO = ['No', 'Yes'];
export const SKIN_TYPE = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
export const SKIN_HAIR_ISSUES = ['None', 'Acne', 'Hair fall', 'Acne, Hair fall', 'Dandruff', 'Dryness', 'Pigmentation'];
export const HEALTH_CONDITIONS = ['No', 'Diabetes', 'Blood Pressure', 'Heart Condition', 'Skin Condition', 'Other'];
export const PREGNANT = ['No', 'Yes', 'Not Applicable'];
export const HEAR_ABOUT = ['Google', 'Friend / Family', 'Social Media', 'Walk-in', 'Advertisement', 'Other'];

export const THERAPIST = ['Any', 'Female Therapist', 'Male Therapist'];
export const TIME_SLOTS = [
  '09:00 AM – 10:00 AM', '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM',
  '12:00 PM – 01:00 PM', '02:00 PM – 03:00 PM', '03:00 PM – 04:00 PM',
  '04:00 PM – 05:00 PM', '05:00 PM – 06:00 PM',
];
export const BRANCHES = ['Spa Downtown Branch', 'Spa Uptown Branch', 'Spa Mall Branch'];

// Country dialing codes for the phone / WhatsApp fields (India default first).
export const COUNTRY_CODES = ['+91', '+971', '+966', '+974', '+965', '+968', '+973', '+1', '+44', '+60', '+65'];
