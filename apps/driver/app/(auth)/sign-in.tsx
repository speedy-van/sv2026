import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Card, Screen, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';

export default function SignInScreen(): React.ReactElement {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  return (
    <Screen title="Driver sign in" subtitle="Use the email your dispatcher invited.">
      <Card>
        <TextField autoCapitalize="none" inputMode="email" label="Email" onChangeText={setEmail} value={email} />
        <Button
          label="Send code"
          loading={auth.status === 'submitting'}
          onPress={() => {
            void auth.requestCode(email).then(() => {
              router.push({ pathname: '/(auth)/code', params: { email } });
            });
          }}
        />
        <AppText muted size="sm">Codes are single-use and expire after ten minutes.</AppText>
      </Card>
    </Screen>
  );
}
