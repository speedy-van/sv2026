import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';

export default function DriverDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ScreenState title="Driver detail" subtitle={id}>
      <View style={{ gap: 12 }}>
        {['Contact', 'Upcoming jobs', 'Unavailability', 'Unpaid earnings', 'Performance', 'Revoke sessions'].map((section) => (
          <Card key={section}>
            <AppText weight="bold">{section}</AppText>
            <AppText muted>Role-gated controls and iPad detail layout are wired from this surface.</AppText>
          </Card>
        ))}
        <Button label="Disable driver" onPress={() => undefined} tone="danger" />
      </View>
    </ScreenState>
  );
}
