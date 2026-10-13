import { useLocalSearchParams, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAuth } from '@/state/auth';

export default function CodeScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const auth = useAuth();
  const email = params.email ?? '';

  async function submit(): Promise<void> {
    await auth.signInWithCode(email, code);
    router.replace('/(app)/today');
  }

  return (
    <ScreenState title="Enter code" subtitle={email ? `Code sent to ${email}.` : 'Enter the six digit code from your email.'}>
      <View style={{ gap: 16 }}>
        <TextField inputMode="numeric" label="Code" maxLength={6} onChangeText={setCode} placeholder="000000" value={code} />
        <Button
          disabled={code.length !== 6 || auth.status === 'submitting'}
          label="Verify code"
          loading={auth.status === 'submitting'}
          onPress={() => { void submit(); }}
        />
      </View>
    </ScreenState>
  );
}
