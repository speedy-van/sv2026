import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Card, Screen, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';
import { authFailureMessage } from '@/content/auth';

export default function CodeScreen(): React.ReactElement {
  const auth = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = auth.status === 'submitting';
  async function submit(): Promise<void> {
    if (submitting || !/^\d{6}$/u.test(code)) return;
    setError(null);
    try {
      await auth.signInWithCode(email, code);
      setCode('');
      router.replace('/(app)/today');
    } catch (cause) { setError(authFailureMessage(cause, 'code')); }
  }
  return (
    <Screen title="Enter code">
      <Card>
        <TextField autoComplete="one-time-code" editable={!submitting} inputMode="numeric" label="Six-digit code" maxLength={6} onChangeText={setCode} textContentType="oneTimeCode" value={code}
          onSubmitEditing={() => { void submit(); }} />
        {error ? <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</AppText> : null}
        <Button
          disabled={!/^\d{6}$/u.test(code) || submitting}
          label="Sign in"
          loadingLabel="Verifying code…"
          loading={submitting}
          onPress={() => { void submit(); }}
        />
        <Button disabled={submitting} label="Back to sign in" tone="secondary"
          onPress={() => { router.replace('/(auth)/sign-in'); }} />
      </Card>
    </Screen>
  );
}
