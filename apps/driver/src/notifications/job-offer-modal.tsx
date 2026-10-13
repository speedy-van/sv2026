import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, AppText } from '@/components/primitives';
import { useAppColors } from '@/theme/theme';

export interface JobOfferAlert {
  bookingId: string;
  notificationId: string;
  route: string;
  slot: string;
}

export function JobOfferModal(props: { alerts: JobOfferAlert[]; onOpen: (bookingId: string) => void }): React.ReactElement | null {
  const alert = props.alerts[0];
  const colors = useAppColors();
  if (!alert) return null;
  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.backdrop}>
        <Card style={{ backgroundColor: colors.surface }}>
          <AppText size="lg" weight="bold">Job offer</AppText>
          <AppText muted>{alert.route}</AppText>
          <Text style={[styles.slot, { color: colors.text }]}>{alert.slot}</Text>
          <Button label="Review offer" onPress={() => { props.onOpen(alert.bookingId); }} />
          <Pressable accessibilityRole="button" onPress={() => { props.onOpen(alert.bookingId); }}>
            <Text style={{ color: colors.muted, fontFamily: 'Manrope_700Bold', textAlign: 'center' }}>Open details</Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.44)',
    flex: 1,
    justifyContent: 'center',
    padding: 24
  },
  slot: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18
  }
});
