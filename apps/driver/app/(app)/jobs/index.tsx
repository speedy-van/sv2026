import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/screen-state';
import { JobCardView } from '@/components/job-card';
import { Button, Card, Screen, AppText } from '@/components/primitives';
import { listJobs } from '@/data/driver';
import { useAuth } from '@/state/auth';

export default function JobsScreen(): React.ReactElement {
  const { api } = useAuth();
  const upcoming = useQuery({ queryFn: () => listJobs(api, 'upcoming'), queryKey: ['driver-jobs', 'upcoming'] });
  const history = useQuery({ queryFn: () => listJobs(api, 'history'), queryKey: ['driver-jobs', 'history'] });
  return (
    <Screen title="Jobs" subtitle="Upcoming and active accepted work.">
      <Button label="Refresh jobs" onPress={() => { void upcoming.refetch(); void history.refetch(); }} tone="secondary" />
      <Card>
        <AppText size="lg" weight="bold">Upcoming</AppText>
      </Card>
      {upcoming.data?.items.map((job) => <JobCardView key={job.bookingId} job={job} />)}
      {!upcoming.isLoading && !upcoming.data?.items.length ? <EmptyState title="No upcoming jobs" message="Accepted future jobs appear here after dispatch assigns them." /> : null}
      <Card>
        <AppText size="lg" weight="bold">History</AppText>
      </Card>
      {history.data?.items.map((job) => <JobCardView key={job.bookingId} job={job} />)}
      {!history.isLoading && !history.data?.items.length ? <EmptyState title="No history yet" message="Completed and cancelled jobs appear here." /> : null}
    </Screen>
  );
}
