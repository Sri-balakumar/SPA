// App shell:
//   Loading splash → Login (receptionist connects the tablet to Odoo) →
//   customer flow. We're building the customer flow one screen at a time.
//   Right now, after login the customer goes straight to Select Service.
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

const EMPTY_FORM = {
  membership: null, selectedCustomer: null, selectedPackage: null,
  serviceId: null, service: '', servicePrice: 0, serviceObj: null,
  package: null, packageName: '',
  fullName: '', dob: '', dobISO: '', age: '', gender: '', countryCode: '+91', phone: '', whatsapp: '', whatsappSame: true,
  answers: [],
  therapist: '', date: '', time: '', branch: '', specialRequests: '', paymentMode: 'offline',
};

function CustomerFlow() {
  const { logout } = useSession();
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState('welcome');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Home = hand the tablet back to reception (return to login).
  const onHome = () => Alert.alert('End session?', 'Return to the reception login screen?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes', onPress: logout },
  ]);
  // Fresh start for the next customer — Welcome screen re-opens at language select.
  const restart = () => { setForm(EMPTY_FORM); setStep('welcome'); };

  if (step === 'welcome') {
    return (
      <WelcomeScreen
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
