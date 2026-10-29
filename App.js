// App shell:
//   Loading splash → Login (receptionist connects the tablet to Odoo) →
//   customer flow. We're building the customer flow one screen at a time.
//   Right now, after login the customer goes straight to Select Service.
import React, { useState, useEffect } from 'react';
import { Alert, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { SessionProvider, useSession } from './SessionContext';
import { LanguageProvider } from './LanguageContext';
import { clearDeviceRegistered, clearCredentials } from './connection';
import LoadingScreen from './screens/LoadingScreen';
import LoginScreen from './screens/LoginScreen';
import WelcomeScreen from './screens/flow/WelcomeScreen';
import IdentifyScreen from './screens/flow/IdentifyScreen';
import AccountScreen from './screens/flow/AccountScreen';
import ProfileSelectScreen from './screens/flow/ProfileSelectScreen';
import MembershipScreen from './screens/flow/MembershipScreen';
import EditProfileScreen from './screens/flow/EditProfileScreen';
import ServiceScreen from './screens/flow/ServiceScreen';
import ServiceDetailScreen from './screens/flow/ServiceDetailScreen';
import PackagesScreen from './screens/flow/PackagesScreen';
import PackageDetailsScreen from './screens/flow/PackageDetailsScreen';
import PersonalInfoScreen from './screens/flow/PersonalInfoScreen';
import HealthScreen from './screens/flow/HealthScreen';
import DisclaimerScreen from './screens/flow/DisclaimerScreen';
import ReviewScreen from './screens/flow/ReviewScreen';
import SuccessScreen from './screens/flow/SuccessScreen';

// Keep the native (Android) splash on screen until our loading work is done,
// so the app reveals straight into the first page — no second splash flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

const EMPTY_FORM = {
  membership: null, selectedCustomer: null, selectedPackage: null,
  serviceId: null, service: '', servicePrice: 0, serviceObj: null,
  package: null, packageName: '',
  // countryIso pairs with countryCode — the dial code alone can't identify a
  // country, and the per-country phone rules key off the ISO.
  fullName: '', dob: '', dobISO: '', age: '', gender: '', countryCode: '+968', countryIso: 'OM', phone: '', whatsapp: '', whatsappSame: true,
  email: '', signature: '',
  answers: [],
  // Returning customer left "Healthy - no changes" ticked: the questions were
  // skipped and the server copies their answers on file onto the booking.
  healthOk: false,
  // The answers given this time, to save as the customer's new answers on file
  // after submit (set only when the questions were answered, not skipped).
  healthMap: null,
  // The chosen therapy's waiver, loaded with its questions on the Health screen:
  // { title, body, allowUpload } or null. null means the therapy has none, and
  // the disclaimer step is skipped rather than shown empty.
  disclaimer: null,
  terms: false,
  // Optional extras: IDS ONLY. Prices are always read back off the package
  // payload, so a stale number can never reach the total or the booking.
  addonIds: [],
  // Top-level catalogue settings, filled on the Service screen.
  packageNote: '', memberTypes: [], packageSort: '',
  // Which Individual / Family option was chosen, and everyone it covers.
  //
  // ONE set of screens filled N times, not N copies on screen: the details form
  // and the signature pad both reach for fixed refs, so a second copy at once
  // would collide with the first. The scalar fields above (fullName, dob,
  // gender, email, answers, signature, terms) are the WORKING SET for whoever
  // is on screen; savePerson stores them into members[] and loadPerson brings
  // the next person's back.
  memberType: 'individual',
  members: [],
  memberIndex: 0,
  // Persons 2+ type a plain optional number here. Kept OFF `phone` on purpose:
  // that field, its country code and the matched contact belong to the lead and
  // must survive being on person 2's screen - they are what the booking is
  // contacted on.
  memberPhone: '',
  therapist: '', date: '', time: '', branch: '', specialRequests: '', paymentMode: 'offline',
};

function CustomerFlow() {
  const { logout } = useSession();
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState('welcome');
  // Once the customer has picked a language, going Back to Welcome should land on
  // the New/Existing choice — not re-open language select. A fresh session resets it.
  const [langPicked, setLangPicked] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // ---- the people this booking covers ----
  // How many the chosen family size covers. Mirrors spa_headcount() on the
  // server, which re-checks - so a wrong number here is refused, not booked.
  const headcount = () => ({ family_2: 2, family_3: 3, family_4: 4 }[form.memberType] || 1);
  const isLastPerson = () => form.memberIndex >= headcount() - 1;

  const blankPerson = () => ({
    name: '', dob: '', dobISO: '', age: '', gender: '', phone: '', email: '',
    answers: [], terms: false, signature: '',
  });

  // Snapshot the working set onto the person being filled, on the way out.
  function savePerson(f) {
    const people = [...(f.members || [])];
    people[f.memberIndex] = {
      name: f.fullName, dob: f.dob, dobISO: f.dobISO, age: f.age, gender: f.gender,
      // The lead is contacted on `phone`; everyone else has their own optional one.
      phone: f.memberIndex === 0 ? f.phone : f.memberPhone,
      email: f.email, answers: f.answers, terms: f.terms, signature: f.signature,
    };
    return people;
  }

  // Bring person `i` back into the working set. Deliberately does NOT touch
  // phone / whatsapp / countryCode / existingCustomerId: those hold the lead's
  // contact details, which the booking is made on and which have to still be
  // there when we come back to submit it.
  function loadPerson(people, i) {
    const p = people[i] || blankPerson();
    return {
      memberIndex: i,
      fullName: p.name || '', dob: p.dob || '', dobISO: p.dobISO || '',
      age: p.age || '', gender: p.gender || '', email: p.email || '',
      answers: p.answers || [], terms: !!p.terms, signature: p.signature || '',
      memberPhone: i === 0 ? '' : (p.phone || ''),
    };
  }

  // Leaving the package screen starts the cycle: size the list to the family,
  // keeping anyone already entered, then always repaint from person 1.
  //
  // The repaint matters. Without it the form keeps whoever was entered last:
  // fill in person 3 of a Family 4, go Back and switch to Family 2, and their
  // name and date of birth reappear labelled "Person 1 of 2" - booking one
  // person under another's details.
  function startPeople() {
    setForm((f) => {
      const want = ({ family_2: 2, family_3: 3, family_4: 4 }[f.memberType] || 1);
      const kept = (f.members || []).slice(0, want);
      while (kept.length < want) kept.push(blankPerson());
      return { ...f, members: kept, ...loadPerson(kept, 0) };
    });
    setStep('personal');
  }

  // End of one person's turn - the disclaimer, or the questions when the therapy
  // has no waiver. Either start the next person or move on to Review.
  function endOfPerson() {
    setForm((f) => {
      const people = savePerson(f);
      const last = f.memberIndex >= (({ family_2: 2, family_3: 3, family_4: 4 }[f.memberType] || 1) - 1);
      if (last) { setStep('review'); return { ...f, members: people }; }
      setStep('personal');
      return { ...f, members: people, ...loadPerson(people, f.memberIndex + 1) };
    });
  }

  // A therapy with no waiver has no disclaimer screen at all. Both directions
  // consult this, so Back can never land on the blank page Next stepped over.
  const afterHealth = () => (form.disclaimer ? setStep('disclaimer') : endOfPerson());
  const lastScreenOfPerson = () => (form.disclaimer ? 'disclaimer' : 'health');

  // Back off person N's details returns to person N-1's LAST screen, with their
  // data reloaded - otherwise the previous person's form would be shown filled
  // with the current one's answers.
  function backFromPersonal() {
    if (form.memberIndex <= 0) { setStep('packageDetails'); return; }
    setForm((f) => {
      const people = savePerson(f);
      setStep(f.disclaimer ? 'disclaimer' : 'health');
      return { ...f, members: people, ...loadPerson(people, f.memberIndex - 1) };
    });
  }

  // Back off Review returns to the LAST person, since they are who was on screen
  // when Review was reached.
  function backFromReview() {
    setForm((f) => {
      const want = ({ family_2: 2, family_3: 3, family_4: 4 }[f.memberType] || 1);
      const people = [...(f.members || [])];
      setStep(f.disclaimer ? 'disclaimer' : 'health');
      return { ...f, ...loadPerson(people, Math.max(0, want - 1)) };
    });
  }

  // Home = hand the tablet back to reception (return to login).
  const onHome = () => Alert.alert('End session?', 'Return to the reception login screen?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes', onPress: logout },
  ]);
  // Fresh start for the next customer — Welcome screen re-opens at language select.
  const restart = () => { setForm(EMPTY_FORM); setLangPicked(false); setStep('welcome'); };

  // Hidden 7-tap gear → device config. This is a RE-CONFIGURE, so it undoes the
  // device setup: clearing the registration makes the next login re-open the QR
  // scanner, and clearing the saved staff login stops LoadingScreen from
  // silently auto-logging back in and skipping the config screen entirely.
  const openDeviceConfig = async () => {
    try {
      await clearDeviceRegistered();
      await clearCredentials();
    } catch (e) { /* best effort — still drop to the config screen */ }
    logout();
  };

  // Android hardware Back button: walk back one step in the flow instead of
  // closing the app. On Welcome/Success it does nothing (kiosk — no accidental exit).
  useEffect(() => {
    const onBackPress = () => {
      const multi = (form.membership?.customers || []).length > 1;
      switch (step) {
        case 'welcome': return true;                       // first screen — don't close
        case 'service': setStep('welcome'); return true;
        case 'identify': setStep('welcome'); return true;
        case 'profileSelect': setStep('identify'); return true;
        case 'account': setStep(multi ? 'profileSelect' : 'identify'); return true;
        case 'editProfile': setStep('account'); return true;
        case 'membership': setStep('account'); return true;
        case 'packages': setStep('service'); return true;
        case 'packageDetails': setStep('packages'); return true;
        case 'personal': backFromPersonal(); return true;
        case 'health': setStep('personal'); return true;
        case 'disclaimer': setStep('health'); return true;
        case 'review': backFromReview(); return true;
        case 'success': return true;                        // finished — don't re-open
        default: return true;
      }
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [step, form.membership]);

  if (step === 'welcome') {
    return (
      <WelcomeScreen
        startChosen={langPicked}
        onChoose={() => setLangPicked(true)}
        onUnchoose={() => setLangPicked(false)}
        onNew={() => setStep('service')}
        onExisting={() => setStep('identify')}
        onDeviceConfig={openDeviceConfig}
        onHome={onHome} />
    );
  }
  if (step === 'identify') {
    return (
      <IdentifyScreen form={form} set={set}
        onFound={(m) => {
          set({ membership: m });
          const people = m.customers || [];
          if (people.length > 1) setStep('profileSelect');           // family shares the number → pick who
          else { set({ selectedCustomer: people[0] || null }); setStep('account'); }
        }}
        onBack={() => setStep('welcome')} onHome={onHome}
        onBookNew={() => setStep('service')} />
    );
  }
  if (step === 'profileSelect') {
    return (
      <ProfileSelectScreen form={form}
        onSelect={(c) => { set({ selectedCustomer: c }); setStep('account'); }}
        onBack={() => setStep('identify')} onHome={onHome} />
    );
  }
  if (step === 'account') {
    const multi = (form.membership?.customers || []).length > 1;
    return (
      <AccountScreen form={form}
        onSelect={(pkg) => { set({ selectedPackage: pkg }); setStep('membership'); }}
        onEdit={() => setStep('editProfile')}
        onBack={() => setStep(multi ? 'profileSelect' : 'identify')} onHome={onHome} />
    );
  }
  if (step === 'editProfile') {
    return (
      <EditProfileScreen form={form} set={set}
        onBack={() => setStep('account')} onHome={onHome} />
    );
  }
  if (step === 'membership') {
    return (
      <MembershipScreen form={form}
        onBack={() => setStep('account')} onHome={onHome} onDone={restart} />
    );
  }
  if (step === 'packages') {
    return (
      <PackagesScreen form={form} set={set}
        next={() => setStep('packageDetails')} onBack={() => setStep('service')} onHome={onHome} />
    );
  }
  if (step === 'packageDetails') {
    return (
      <PackageDetailsScreen form={form} set={set}
        next={startPeople} onBack={() => setStep('packages')} onHome={onHome} />
    );
  }
  if (step === 'personal') {
    return (
      <PersonalInfoScreen
        form={form} set={set}
        next={() => setStep('health')}
        onBack={backFromPersonal}
        onHome={onHome}
        // The customer already has a package with sessions left and wants to
        // use it: hand over to the Existing flow's screens for that person.
        onUseExisting={(c) => {
          set({ membership: { customers: [c] }, selectedCustomer: c });
          setStep('account');
        }}
      />
    );
  }
  if (step === 'health') {
    return (
      <HealthScreen form={form} set={set}
        next={afterHealth} onBack={() => setStep('personal')} onHome={onHome} />
    );
  }
  if (step === 'disclaimer') {
    return (
      <DisclaimerScreen form={form} set={set}
        next={endOfPerson} onBack={() => setStep('health')} onHome={onHome} />
    );
  }
  if (step === 'review') {
    return (
      <ReviewScreen form={form} set={set}
        next={() => setStep('success')} onBack={backFromReview} onHome={onHome} />
    );
  }
  if (step === 'success') {
    // Go to Home = start a fresh session for the next customer.
    return <SuccessScreen form={form} onHome={restart} />;
  }
  return <ServiceScreen form={form} set={set} next={() => setStep('packages')} onBack={() => setStep('welcome')} onHome={onHome} />;
}

function Shell() {
  const { loggedIn, login } = useSession();
  const [ready, setReady] = useState(false);
  const [fontsLoaded] = useFonts({ PlayfairDisplay_700Bold, PlayfairDisplay_600SemiBold });
  // Once loading is done and the real first page is about to render, drop the
  // native splash. Because it stays up the whole time, the user sees ONE splash,
  // then the app — never the logo twice.
  useEffect(() => {
    if (ready && fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [ready, fontsLoaded]);
  // LoadingScreen passes back a session (info) when a saved kiosk login logs in
  // automatically → we skip the login page and go straight to the customer flow.
  if (!ready || !fontsLoaded) {
    return <LoadingScreen onDone={(info) => { if (info) login(info); setReady(true); }} />;
  }
  if (!loggedIn) return <LoginScreen />;
  return <CustomerFlow />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
