import { formatGBP } from '@sv/contracts';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { AppText, Button, Card } from '@/components/primitives';
import { addAlerts, dismissAlert, type NewJobAlert } from './new-job-queue';

export function NewJobModal(props: { alerts: NewJobAlert[]; onOpen: (bookingId: string) => void }): React.ReactElement | null {
  const [alerts, setAlerts] = useState<NewJobAlert[]>([]);
  useEffect(() => {
    setAlerts((current) => addAlerts(current, props.alerts));
  }, [props.alerts]);
  useEffect(() => {
    if (alerts.length > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [alerts.length]);
  const alert = alerts[0];
  if (!alert) return null;
  return (
    <Modal animationType="slide" transparent visible>
      <View style={{ backgroundColor: 'rgba(11,31,51,0.7)', flex: 1, justifyContent: 'flex-end', padding: 16 }}>
        <Card>
          <AppText size="lg" weight="bold">{alerts.length > 1 ? `${String(alerts.length)} new bookings` : 'New booking'}</AppText>
          <AppText weight="bold">{formatGBP(alert.pricePence)}</AppText>
          <AppText>{alert.service} · {alert.slot}</AppText>
          <AppText muted>{alert.route}</AppText>
          <Button label="Assign driver" onPress={() => { props.onOpen(alert.bookingId); }} />
          <Button label="View booking" onPress={() => { props.onOpen(alert.bookingId); }} tone="secondary" />
          <Button label="Dismiss" onPress={() => { setAlerts((current) => dismissAlert(current, alert.notificationId)); }} tone="secondary" />
        </Card>
      </View>
    </Modal>
  );
}
