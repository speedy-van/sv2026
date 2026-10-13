import { View } from 'react-native';
import { AppText, Button, Card, Badge } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';

const days = ['Today', 'Tomorrow', 'Friday', 'Saturday', 'Sunday'];
const slots = ['Morning', 'Afternoon', 'Evening'] as const;

export default function ScheduleScreen(): React.ReactElement {
  return (
    <ScreenState title="Schedule" subtitle="Capacity, held slots and confirmed jobs by day." action={<Button label="Capacity" onPress={() => undefined} tone="secondary" />}>
      <View style={{ gap: 12 }}>
        {days.map((day) => (
          <Card key={day}>
            <AppText weight="bold">{day}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {slots.map((slot) => (
                <Card key={slot} style={{ flexGrow: 1, minWidth: 150 }}>
                  <AppText>{slot}</AppText>
                  <Badge label={slot === 'Morning' ? '1/2 used' : '0/2 used'} tone={slot === 'Morning' ? 'warning' : 'success'} />
                </Card>
              ))}
            </View>
          </Card>
        ))}
      </View>
    </ScreenState>
  );
}
