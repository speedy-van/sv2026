import { View } from 'react-native';
import { AppText, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { phoneBookingSteps } from '@/data/admin';

export default function NewPhoneBookingScreen(): React.ReactElement {
  return (
    <ScreenState title="New phone booking" subtitle="Create a booking from a quote and send a payment link or record offline payment.">
      <View style={{ gap: 12 }}>
        {phoneBookingSteps.map((step, index) => (
          <Card key={step}>
            <AppText weight="bold">{String(index + 1)}. {step}</AppText>
            <AppText muted>{step === 'Prices' ? 'Uses POST /quotes in JSON mode and shows the 28 day calendar.' : 'Ready for staff entry and validation.'}</AppText>
          </Card>
        ))}
        <Button label="Create booking" onPress={() => undefined} />
      </View>
    </ScreenState>
  );
}
