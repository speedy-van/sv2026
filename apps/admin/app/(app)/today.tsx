import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, AppText, Badge, Button } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { JobCard } from '@/components/job-card';
import { dashboardJobs } from '@/data/admin';

export default function TodayScreen(): React.ReactElement {
  return (
    <ScreenState title="Today" subtitle="Live control room for bookings, leads and dispatch." action={<Button label="Refresh" onPress={() => undefined} tone="secondary" />}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <Metric label="Moves today" value="2" />
          <Metric label="Need a driver" tone="danger" value="1" />
          <Metric label="Paid today" value="£158.90" />
          <Metric label="Paid this week" value="£382.90" />
        </View>
        <Card>
          <Badge label="Notifications on" tone="success" />
          <AppText muted>Feed polling runs every 20 seconds while focused and pushes invalidate dashboard data immediately.</AppText>
        </Card>
        {dashboardJobs.map((job) => <JobCard key={job.bookingId} job={job} onPress={() => { router.push(`/(app)/bookings/${job.bookingId}`); }} />)}
      </View>
    </ScreenState>
  );
}

function Metric(props: { label: string; tone?: 'danger'; value: string }): React.ReactElement {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
      <AppText muted size="sm">{props.label}</AppText>
      <AppText size="lg" weight="bold">{props.value}</AppText>
      {props.tone ? <Badge label="Action needed" tone={props.tone} /> : null}
    </Card>
  );
}
