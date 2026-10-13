import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Badge, Button, Card, Screen, AppText, Row, TextField } from '@/components/primitives';
import { acceptOffer, declineOffer, getJob } from '@/data/driver';
import { useAuth } from '@/state/auth';

export default function OfferScreen(): React.ReactElement {
  const { api } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const job = useQuery({ enabled: bookingId.length > 0, queryFn: () => getJob(api, bookingId), queryKey: ['driver-job', bookingId] });
  const accept = useMutation({
    mutationFn: () => acceptOffer(api, bookingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['driver-jobs'] });
      router.replace(`/(app)/jobs/${bookingId}`);
    }
  });
  const decline = useMutation({
    mutationFn: () => declineOffer(api, bookingId, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['driver-jobs'] });
      router.replace('/(app)/today');
    }
  });
  return (
    <Screen title="Job offer" subtitle={job.data?.route}>
      <Card>
        <Row>
          <AppText weight="bold">{job.data?.reference ?? 'Offer'}</AppText>
          <Badge label={job.data?.dispatchStatus ?? 'OFFERED'} tone="warning" />
        </Row>
        <AppText>{job.data?.moveDate} · {job.data?.slot}</AppText>
        <AppText muted>{job.data?.customerNotes ?? 'No customer notes'}</AppText>
        <Button label="Accept job" loading={accept.isPending} onPress={() => { accept.mutate(); }} />
        <TextField label="Decline reason" onChangeText={setReason} value={reason} />
        <Button label="Decline" loading={decline.isPending} onPress={() => { decline.mutate(); }} tone="danger" />
      </Card>
    </Screen>
  );
}
