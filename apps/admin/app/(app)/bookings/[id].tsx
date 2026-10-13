import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Badge, AppText, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { SheetList } from '@/components/sheet-list';
import { bookingSheets, dashboardJobs } from '@/data/admin';

export default function BookingDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = dashboardJobs.find((job) => job.bookingId === id) ?? dashboardJobs[0];
  if (!booking) throw new Error('Booking fixture missing.');
  return (
    <ScreenState title={booking.reference} subtitle={`${booking.route} · ${booking.slot}`}>
      <View style={{ gap: 14 }}>
        <Card>
          <Badge label={booking.stage} tone="warning" />
          <AppText size="lg" weight="bold">{booking.customer}</AppText>
          <AppText muted>Customer, route, access, items, price breakdown, payments, refunds, driver, photos, signature and audit sections are available from this detail surface.</AppText>
        </Card>
        <SheetList items={bookingSheets} />
      </View>
    </ScreenState>
  );
}
