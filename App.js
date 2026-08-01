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
import ReviewScreen from './screens/flow/ReviewScreen';
import SuccessScreen from './screens/flow/SuccessScreen';

// Keep the native (Android) splash on screen until our loading work is done,
// so the app reveals straight into the first page — no second splash flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

const EMPTY_FORM = {
  membership: null, selectedCustomer: null, selectedPackage: null,
  serviceId: null, service: '', servicePrice: 0, serviceObj: null,
  package: null, packageName: '',
  fullName: '', dob: '', dobISO: '', age: '', gender: '', countryCode: '+968', phone: '', whatsapp: '', whatsappSame: true,
  email: '', signature: '',
  answers: [],
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

  // Home = hand the tablet back to reception (return to login).
  const onHome = () => Alert.alert('End session?', 'Return to the reception login screen?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes', onPress: logout },
  ]);
  // Fresh start for the next customer — Welcome screen re-opens at language select.
  const restart = () => { setForm(EMPTY_FORM); setLangPicked(false); setStep('welcome'); };

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
        case 'personal': setStep('packageDetails'); return true;
        case 'health': setStep('personal'); return true;
        case 'review': setStep('health'); return true;
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
        onNew={() => setStep('service')}
        onExisting={() => setStep('identify')}
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
        next={() => setStep('personal')} onBack={() => setStep('packages')} onHome={onHome} />
    );
  }
  if (step === 'personal') {
    return (
      <PersonalInfoScreen
        form={form} set={set}
        next={() => setStep('health')}
        onBack={() => setStep('packageDetails')}
        onHome={onHome}
      />
    );
  }
  if (step === 'health') {
    return (
      <HealthScreen form={form} set={set}
        next={() => setStep('review')} onBack={() => setStep('personal')} onHome={onHome} />
    );
  }
  if (step === 'review') {
    return (
      <ReviewScreen form={form} set={set}
        next={() => setStep('success')} onBack={() => setStep('health')} onHome={onHome} />
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
