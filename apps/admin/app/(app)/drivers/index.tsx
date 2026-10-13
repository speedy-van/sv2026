import { router } from 'expo-router';
import { View } from 'react-native';
import { AppText, Badge, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';

const drivers = [
  { id: 'driver_ali', name: 'Ali', status: 'Free', jobs: 0 },
  { id: 'driver_maya', name: 'Maya', status: 'On job', jobs: 1 }
];

export default function DriversScreen(): React.ReactElement {
  return (
    <ScreenState title="Drivers" subtitle="Availability, documents, earnings and live map." action={<Button label="Invite" onPress={() => undefined} />}>
      <View style={{ gap: 12 }}>
        {drivers.map((driver) => (
          <Card key={driver.id}>
            <AppText weight="bold">{driver.name}</AppText>
            <AppText muted>{String(driver.jobs)} jobs today</AppText>
            <Badge label={driver.status} tone={driver.status === 'On job' ? 'warning' : 'success'} />
            <Button label="Open driver" onPress={() => { router.push(`/(app)/drivers/${driver.id}`); }} tone="secondary" />
          </Card>
        ))}
      </View>
    </ScreenState>
  );
}
