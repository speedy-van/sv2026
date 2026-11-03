import { StyleSheet, View } from 'react-native';
import { AppText } from './primitives';

export function AdminToolFeedback(props: {
  error?: string | null;
  message?: string | null;
  offline?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.stack}>
      {props.offline ? (
        <AppText accessibilityRole="alert">You're offline. Changes are paused until you reconnect.</AppText>
      ) : null}
      {props.error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {props.error}
        </AppText>
      ) : null}
      {props.message ? (
        <AppText accessibilityLiveRegion="polite" tone="success">
          {props.message}
        </AppText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ stack: { gap: 10 } });
