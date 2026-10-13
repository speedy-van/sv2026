import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Screen, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';

export default function CodeScreen(): React.ReactElement {
  const auth = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  return (
    <Screen title="Enter code">
      <Card>
        <TextField inputMode="numeric" label="Six-digit code" maxLength={6} onChangeText={setCode} value={code} />
        <Button
          label="Sign in"
          loading={auth.status === 'submitting'}
          onPress={() => {
            void auth.signInWithCode(email, code).then(() => {
              router.replace('/(app)/today');
            });
          }}
        />
      </Card>
    </Screen>
  );
}
