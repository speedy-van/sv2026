import { DriverSyncRequestSchema } from '@sv/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Screen, TextField } from '@/components/primitives';
import { syncEvents } from '@/data/driver';
import { enqueueOfflineEvent } from '@/offline/sqlite';
import { useAuth } from '@/state/auth';

export default function ReportScreen(): React.ReactElement {
  const { api } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [text, setText] = useState('');
  const [category, setCategory] = useState('ACCESS');
  return (
    <Screen title="Report issue">
      <Card>
        <TextField label="Category" onChangeText={setCategory} value={category} />
        <TextField label="Details" multiline onChangeText={setText} value={text} />
        <Button
          label="Queue report"
          onPress={() => {
            const event = { bookingId, category, clientEventId: globalThis.crypto.randomUUID(), text, type: 'ISSUE' as const };
            void enqueueOfflineEvent({ attempts: 0, createdAt: new Date().toISOString(), event })
              .then(() => syncEvents(api, DriverSyncRequestSchema.parse({ events: [event] })));
          }}
        />
      </Card>
    </Screen>
  );
}
