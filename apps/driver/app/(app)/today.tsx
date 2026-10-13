import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/screen-state';
import { JobCardView } from '@/components/job-card';
import { Button, Card, Screen, AppText, Row } from '@/components/primitives';
import { listJobs } from '@/data/driver';
import { useAuth } from '@/state/auth';

export default function TodayScreen(): React.ReactElement {
  const { api } = useAuth();
  const today = useQuery({ queryFn: () => listJobs(api, 'today'), queryKey: ['driver-jobs', 'today'] });
  const offers = useQuery({ queryFn: () => listJobs(api, 'offers'), queryKey: ['driver-jobs', 'offers'] });
  return (
    <Screen title="Today" subtitle="Run sheet, active offers and queued updates.">
      <Card>
        <Row>
          <AppText weight="bold">Sync</AppText>
          <Button label="Refresh" onPress={() => { void today.refetch(); void offers.refetch(); }} tone="secondary" />
        </Row>
        <AppText muted size="sm">Pull-to-refresh is backed by the same driver API.</AppText>
      </Card>
      {offers.data?.items.map((job) => <JobCardView key={job.bookingId} job={job} mode="offer" />)}
      {today.data?.items.length ? today.data.items.map((job) => <JobCardView key={job.bookingId} job={job} />) : null}
      {!today.isLoading && !today.data?.items.length ? (
        <EmptyState title="No jobs today" message="Accepted jobs for the current move date appear here." actionLabel="Refresh" onAction={() => { void today.refetch(); }} />
      ) : null}
    </Screen>
  );
}
