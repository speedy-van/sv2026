import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Card, Screen, AppText, Row } from '@/components/primitives';
import { EmptyState } from '@/components/screen-state';
import { getJob, isJobStage } from '@/data/driver';
import { formatPence } from '@/earnings/format';
import { stageLabel } from '@/job/stages';
import { useAuth } from '@/state/auth';

export default function JobDetailScreen(): React.ReactElement {
  const { api } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const job = useQuery({ enabled: bookingId.length > 0, queryFn: () => getJob(api, bookingId), queryKey: ['driver-job', bookingId] });
  if (!bookingId) return <EmptyState title="Missing job" message="Open a job from Today or Jobs." />;
  const detail = job.data;
  return (
    <Screen title={detail?.reference ?? 'Job'} subtitle={detail?.route}>
      {detail ? (
        <>
          <Card>
            <Row>
              <Badge label={detail.status} tone={detail.status === 'COMPLETED' ? 'success' : 'neutral'} />
              <Badge label={detail.dispatchStatus} tone={detail.dispatchStatus === 'ACCEPTED' ? 'success' : 'warning'} />
            </Row>
            <AppText size="lg" weight="bold">{formatPence(detail.earningPence)}</AppText>
            <AppText muted>{detail.moveDate} · {detail.slot} · {detail.service}</AppText>
            <AppText>{detail.contact.name} · {detail.contact.phone}</AppText>
            <AppText muted>{detail.customerNotes ?? 'No customer notes'}</AppText>
          </Card>
          <Button label="Start run" onPress={() => { router.push(`/(app)/jobs/${bookingId}/run`); }} />
          <Row>
            <Button label="Photo" onPress={() => { router.push(`/(app)/jobs/${bookingId}/camera`); }} tone="secondary" />
            <Button label="Signature" onPress={() => { router.push(`/(app)/jobs/${bookingId}/signature`); }} tone="secondary" />
          </Row>
          <Row>
            <Button label="Report issue" onPress={() => { router.push(`/(app)/jobs/${bookingId}/report`); }} tone="secondary" />
            <Button label="Extra charge" onPress={() => { router.push(`/(app)/jobs/${bookingId}/extra`); }} tone="secondary" />
          </Row>
          <Card>
            <AppText weight="bold">Current stage</AppText>
            <AppText>{isJobStage(detail.jobStage) ? stageLabel(detail.jobStage) : detail.jobStage}</AppText>
          </Card>
        </>
      ) : (
        <EmptyState title="Loading job" message="Fetching customer and route details." actionLabel="Retry" onAction={() => { void job.refetch(); }} />
      )}
    </Screen>
  );
}
