import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Screen, TextField } from '@/components/primitives';
import { requestExtra } from '@/data/driver';
import { useAuth } from '@/state/auth';

export default function ExtraScreen(): React.ReactElement {
  const { api } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('0');
  return (
    <Screen title="Extra charge">
      <Card>
        <TextField label="Description" onChangeText={setDescription} value={description} />
        <TextField inputMode="numeric" label="Suggested amount in pence" onChangeText={setAmount} value={amount} />
        <Button
          label="Request approval"
          onPress={() => {
            void requestExtra(api, bookingId, {
              description,
              suggestedAmountPence: Number.parseInt(amount, 10) || 0
            });
          }}
        />
      </Card>
    </Screen>
  );
}
