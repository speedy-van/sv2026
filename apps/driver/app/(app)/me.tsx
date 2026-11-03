import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Screen, AppText, Row } from '@/components/primitives';
import { getAvailability, getProfile, putAvailability } from '@/data/driver';
import { formatPayoutAgreement } from '@/earnings/format';
import { useAuth } from '@/state/auth';

export default function MeScreen(): React.ReactElement {
  const auth = useAuth();
  const { api } = auth;
  const [blocked, setBlocked] = useState(false);
  const profile = useQuery({ queryFn: () => getProfile(api), queryKey: ['driver-profile'] });
  const availability = useQuery({ queryFn: () => getAvailability(api), queryKey: ['driver-availability'] });
  return (
    <Screen title="Me" subtitle="Profile, availability and app security.">
      <Card>
        <AppText size="lg" weight="bold">{profile.data?.name ?? 'Driver'}</AppText>
        <AppText muted>{profile.data?.email}</AppText>
        <Row>
          <AppText>Payout</AppText>
          {profile.data ? <Badge label={formatPayoutAgreement(profile.data.payoutPercent)} tone="success" /> : null}
        </Row>
        <Button label="Lock app" onPress={() => { auth.lockApp(); }} tone="secondary" />
      </Card>
      <Card>
        <Row>
          <AppText weight="bold">Availability</AppText>
          <Badge label={`${String(availability.data?.unavailable.length ?? 0)} blocks`} />
        </Row>
        <Button
          label={blocked ? 'Clear tomorrow morning block' : 'Block tomorrow morning'}
          onPress={() => {
            const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
            const unavailable = blocked ? [] : [{ date: tomorrow, reason: 'Driver unavailable', slot: 'MORNING' as const }];
            void putAvailability(api, { unavailable }).then(() => {
              setBlocked(!blocked);
              void availability.refetch();
            });
          }}
        />
      </Card>
    </Screen>
  );
}
