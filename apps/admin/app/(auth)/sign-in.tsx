import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAuth } from '@/state/auth';

export default function SignInScreen(): React.ReactElement {
  const [email, setEmail] = useState('');
  const auth = useAuth();

  async function submit(): Promise<void> {
    await auth.requestCode(email);
    router.push({ pathname: '/(auth)/code', params: { email } });
  }

  return (
    <ScreenState title="Sign in" subtitle="Use your Speedy Van staff email to receive a six digit code.">
      <View style={{ gap: 16 }}>
        <TextField
          autoCapitalize="none"
          inputMode="email"
          label="Email"
          onChangeText={setEmail}
          placeholder="you@speedyvan.uk"
          value={email}
        />
        <Button
          disabled={!email.includes('@') || auth.status === 'submitting'}
          label="Send code"
          loading={auth.status === 'submitting'}
          onPress={() => { void submit(); }}
        />
      </View>
    </ScreenState>
  );
}
