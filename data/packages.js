// Stretch & Go packages.
// Prices are GENERATED from each service's SINGLE price (Odoo list_price):
//   Single = 1× · Starter (4+1) = 4× · Commit (8+1) = 8× · Lifestyle (12+2) = 12×
// You pay for 4/8/12 and get 1/1/2 free. Only the descriptions are fixed text
// (word-for-word from stretchandgo.om), keyed by service name → package.

export const PACKAGE_TYPES = [
  { key: 'single',    name: 'Single Session',                 paid: 1,  free: 0 },
  { key: 'starter',   name: 'Starter Pack (4+1 Sessions)',    paid: 4,  free: 1 },
  { key: 'commit',    name: 'Commit Pack (8+1 Sessions)',     paid: 8,  free: 1 },
  { key: 'lifestyle', name: 'Lifestyle Pack (12+2 Sessions)', paid: 12, free: 2 },
];

export const PACKAGE_DESC = {
  'GO Ease (30 min)': {
    single: 'A light and relaxing assisted stretching session designed to release daily muscle tension and improve overall comfort. Perfect for those who want to try assisted stretching for the first time or need a quick recovery session.',
    starter: 'A great starter package for those who want to make stretching part of their weekly routine. Helps improve flexibility and gradually reduce muscle tension.',
    commit: 'Designed for individuals who are committed to improving their mobility and flexibility. Regular sessions help enhance physical performance and reduce muscle tightness.',
    lifestyle: 'The perfect package to make stretching part of your lifestyle. Regular sessions to improve flexibility, reduce muscle tension, and maintain an active, balanced body.',
  },
  'GO Flex (40 min)': {
    single: 'A focused assisted stretching session designed to release deeper muscle tension and improve flexibility. Ideal for those looking for a more complete stretch and better body mobility.',
    starter: 'A great starter package to begin improving flexibility and mobility. Regular sessions help reduce muscle tightness and support better movement in daily activities.',
    commit: 'Perfect for those committed to improving their flexibility and body performance. Consistent sessions help enhance mobility and support muscle recovery.',
    lifestyle: 'The ideal package for making stretching part of your lifestyle. Regular assisted stretching helps improve flexibility, reduce muscle tension, and keep your body moving freely.',
  },
  'GO Relief (60 min)': {
    single: 'A therapeutic assisted stretching session designed to relieve deep muscle pain, reduce tension, and support better recovery. Ideal for those experiencing stiffness, fatigue, or muscle discomfort.',
    starter: 'A great package to start addressing muscle tension and improving recovery. Regular sessions help release deep tightness and support better body movement.',
    commit: 'Designed for individuals committed to improving recovery and reducing chronic muscle tension. Consistent sessions help restore mobility and improve overall physical comfort.',
    lifestyle: 'The perfect package to maintain long-term muscle health and recovery. Regular assisted stretching sessions help reduce pain, improve flexibility, and keep your body balanced and relaxed.',
  },
  'GO Release (90 min)': {
    single: 'An extended assisted stretching session designed for deep muscle release and full-body relaxation. Ideal for those who want a complete recovery experience and maximum flexibility improvement.',
    starter: 'A great package to begin experiencing deeper stretching and improved body mobility. Regular sessions help release long-term muscle tension and support full-body recovery.',
    commit: 'Perfect for those committed to improving flexibility, recovery, and overall body performance. Consistent sessions provide deeper muscle release and long-lasting relief.',
    lifestyle: 'The ultimate package for making assisted stretching a regular part of your lifestyle. These extended sessions help improve flexibility, release deep tension, and keep your body balanced and energized.',
  },
};

// Build the 4 packages for a service (from its list_price + spa_duration).
export function buildPackages(service) {
  const single = Math.round(service?.list_price || 0);
  const dur = service?.spa_duration || 60;
  const descs = PACKAGE_DESC[service?.name] || {};
  return PACKAGE_TYPES.map((t) => {
    const total = t.paid + t.free;
    const sessionsLabel = total === 1
      ? `1 Session (${dur} minutes)`
      : `${total} Sessions (${t.paid} + ${t.free} Free)`;
    return {
      key: t.key,
      name: t.name,
      price: t.paid * single,
      save: t.free * single,
      sessions: total,
      sessionsLabel,
      description: descs[t.key] || service?.description_sale || '',
    };
  });
}
