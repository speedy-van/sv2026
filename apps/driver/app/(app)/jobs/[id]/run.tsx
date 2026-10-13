import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DriverSyncRequestSchema, type JobStage } from '@sv/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Badge, Button, Card, Screen, AppText, Row } from '@/components/primitives';
import { getJob, isJobStage, syncEvents } from '@/data/driver';
import { nextDriverStage, previousDriverStage, stageLabel } from '@/job/stages';
import { startJobLocationTracking, stopJobLocationTracking } from '@/location/task';
import { enqueueOfflineEvent } from '@/offline/sqlite';
import { useAuth } from '@/state/auth';

export default function RunScreen(): React.ReactElement {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [lastChangedAt, setLastChangedAt] = useState<Date | null>(null);
  const job = useQuery({ enabled: bookingId.length > 0, queryFn: () => getJob(api, bookingId), queryKey: ['driver-job', bookingId] });
  const detail = job.data;
  const stage = detail && isJobStage(detail.jobStage) ? detail.jobStage : 'NOT_STARTED';
  const next = detail ? nextDriverStage(detail.service as Parameters<typeof nextDriverStage>[0], stage) : null;
  const previous = detail ? previousDriverStage(detail.service as Parameters<typeof previousDriverStage>[0], stage) : null;
  const mutation = useMutation({
    mutationFn: async (toStage: JobStage) => {
      const event = {
        bookingId,
        clientEventId: globalThis.crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        toStage,
        type: 'STAGE' as const
      };
      await enqueueOfflineEvent({ attempts: 0, createdAt: event.occurredAt, event });
      return syncEvents(api, DriverSyncRequestSchema.parse({ events: [event] }));
    },
    onSuccess: async () => {
      setLastChangedAt(new Date());
      await queryClient.invalidateQueries({ queryKey: ['driver-job', bookingId] });
    }
  });

  async function move(toStage: JobStage): Promise<void> {
    if (toStage === 'EN_ROUTE_TO_PICKUP') await startJobLocationTracking();
    if (toStage === 'COMPLETED') await stopJobLocationTracking();
    await mutation.mutateAsync(toStage);
  }

  return (
    <Screen title="Run job" subtitle={detail?.reference}>
      <Card>
        <Row>
          <AppText weight="bold">Stage</AppText>
          <Badge label={stageLabel(stage)} tone={stage === 'COMPLETED' ? 'success' : 'warning'} />
        </Row>
        <AppText muted>{detail?.route ?? 'Loading route'}</AppText>
        {next ? <Button label={`Move to ${stageLabel(next)}`} loading={mutation.isPending} onPress={() => { void move(next); }} /> : null}
        {previous && lastChangedAt ? (
          <Button label={`Undo to ${stageLabel(previous)}`} loading={mutation.isPending} onPress={() => { void move(previous); }} tone="secondary" />
        ) : null}
        <Row>
          <Button label="Evidence" onPress={() => { router.push(`/(app)/jobs/${bookingId}/camera`); }} tone="secondary" />
          <Button label="Finish proof" onPress={() => { router.push(`/(app)/jobs/${bookingId}/signature`); }} tone="secondary" />
        </Row>
      </Card>
    </Screen>
  );
}
