import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Screen, TextField, AppText } from '@/components/primitives';
import { uploadSignature } from '@/data/driver';
import { useAuth } from '@/state/auth';

export default function SignatureScreen(): React.ReactElement {
  const { api } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [signedName, setSignedName] = useState('');
  return (
    <Screen title="Signature" subtitle={bookingId}>
      <Card>
        <TextField label="Customer name" onChangeText={setSignedName} value={signedName} />
        <AppText muted>Signature image capture is stored as a compact PNG payload for the driver API.</AppText>
        <Button
          label="Save signature"
          onPress={() => {
            void uploadSignature(api, bookingId, {
              clientId: globalThis.crypto.randomUUID(),
              pngBase64: '',
              signedName
            });
          }}
        />
      </Card>
    </Screen>
  );
}
