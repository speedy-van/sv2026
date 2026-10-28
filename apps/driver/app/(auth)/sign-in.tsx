import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Screen, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';
import { authFailureMessage } from '@/content/auth';

export default function SignInScreen(): React.ReactElement {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = auth.status === 'submitting';
  const canSubmit = email.includes('@') && (method === 'code' || password.length > 0) && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setError(null);
    try {
      if (method === 'password') {
        await auth.signInWithPassword(email, password);
        setPassword('');
        router.replace('/(app)/today');
      } else {
        await auth.requestCode(email);
        router.push({ pathname: '/(auth)/code', params: { email } });
      }
    } catch (cause) {
      setError(authFailureMessage(cause, method));
    }
  }

  return (
    <Screen title="Driver sign in" subtitle="Your jobs, routes and earnings in one place.">
      <Card style={{ alignSelf: 'center', maxWidth: 520, width: '100%', gap: 20 }}>
        <AppText muted>{method === 'password'
          ? 'Use the email and password your admin set up for you.'
          : 'We will send a six-digit code to your driver email.'}</AppText>
        <TextField
          autoCapitalize="none" autoComplete="email" autoCorrect={false} editable={!submitting}
          inputMode="email" label="Email" onChangeText={setEmail} textContentType="emailAddress" value={email}
          onSubmitEditing={() => { if (method === 'code') void submit(); }}
        />
        {method === 'password' ? (
          <View style={{ gap: 8 }}>
            <TextField
              autoCapitalize="none" autoComplete="current-password" autoCorrect={false}
              editable={!submitting} label="Password" maxLength={1024} onChangeText={setPassword}
              onSubmitEditing={() => { void submit(); }} secureTextEntry={!showPassword}
              textContentType="password" value={password}
            />
            <Button disabled={submitting} label={showPassword ? 'Hide password' : 'Show password'}
              onPress={() => { setShowPassword((current) => !current); }} tone="secondary" />
          </View>
        ) : null}
        {error ? <AppText accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</AppText> : null}
        <Button
          disabled={!canSubmit} label={method === 'password' ? 'Sign in' : 'Send code'}
          loadingLabel={method === 'password' ? 'Signing in…' : 'Sending code…'}
          loading={submitting} onPress={() => { void submit(); }}
        />
        <Button
          disabled={submitting} label={method === 'password' ? 'Sign in with an email code' : 'Use password instead'}
          tone="secondary" onPress={() => {
            setMethod((current) => current === 'password' ? 'code' : 'password');
            setPassword(''); setShowPassword(false); setError(null);
          }}
        />
        {method === 'code' ? <AppText muted size="sm">Codes are single-use and expire after ten minutes.</AppText> : null}
      </Card>
    </Screen>
  );
}
