import { SlotSchema, formatGBP } from '@sv/contracts';
import * as Sentry from '@sentry/react-native';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, Card } from '@/components/primitives';
import { displayAdminDate, serviceLabel, slotLabel } from '@/data/operations';
import { BookingAlertSound } from './booking-alert-sound';
import type { NewJobAlert } from './new-job-queue';

export function NewJobModal(props: {
  alerts: NewJobAlert[];
  onDismiss: (notificationId: string) => void;
  onOpen: (bookingId: string) => void;
}): React.ReactElement | null {
  const alert = props.alerts[0];
  const alertId = alert?.notificationId;
  const slot = SlotSchema.safeParse(alert?.slot);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!alertId || Platform.OS === 'web') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((error: unknown) => {
      Sentry.captureException(error, { tags: { feature: 'admin-booking-alert-haptics' } });
    });
  }, [alertId]);
  if (!alert) return null;
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        props.onDismiss(alert.notificationId);
      }}
      transparent
      visible
    >
      <View style={{ backgroundColor: 'rgba(11,31,51,0.7)', flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'flex-end',
            paddingHorizontal: 16,
            paddingTop: Math.max(16, insets.top),
            paddingBottom: Math.max(16, insets.bottom),
          }}
        >
          <Card>
            <BookingAlertSound alertId={alert.notificationId} />
            <AppText size="lg" weight="bold">
              {props.alerts.length > 1 ? `${String(props.alerts.length)} new bookings` : 'New booking'}
            </AppText>
            {alert.reference ? <AppText muted>{alert.reference}</AppText> : null}
            {alert.pricePence !== undefined && alert.pricePence > 0 ? (
              <AppText weight="bold">{formatGBP(alert.pricePence)}</AppText>
            ) : null}
            {alert.service || alert.slot ? (
              <AppText>
                {[
                  alert.service ? serviceLabel(alert.service) : undefined,
                  slot.success ? slotLabel(slot.data) : alert.slot,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            ) : null}
            {alert.moveDate ? <AppText>{displayAdminDate(alert.moveDate)}</AppText> : null}
            {alert.route ? <AppText muted>{alert.route}</AppText> : null}
            <Button
              label="View booking"
              onPress={() => {
                props.onOpen(alert.bookingId);
              }}
            />
            <Button
              label="Dismiss"
              onPress={() => {
                props.onDismiss(alert.notificationId);
              }}
              tone="secondary"
            />
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
}
