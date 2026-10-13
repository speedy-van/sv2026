import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { JobCard } from '@/components/job-card';
import { dashboardJobs } from '@/data/admin';

export default function BookingsScreen(): React.ReactElement {
  return (
    <ScreenState title="Bookings" subtitle="Search references, customers, phones, emails and postcodes." action={<Button label="+" onPress={() => { router.push('/(app)/new-booking'); }} />}>
      <View style={{ gap: 12 }}>
        {dashboardJobs.map((job) => <JobCard key={job.bookingId} job={job} onPress={() => { router.push(`/(app)/bookings/${job.bookingId}`); }} />)}
      </View>
    </ScreenState>
  );
}
