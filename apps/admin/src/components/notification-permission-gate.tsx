import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { AppText, Button, Card } from './primitives';

export function NotificationPermissionGate(props: {
  children: React.ReactNode;
  enabled?: boolean;
  onPermissionGranted?: () => void;
}): React.ReactElement {
  const enabled = props.enabled ?? true;
  const [status, setStatus] = useState<'checking' | 'denied' | 'error' | 'granted' | 'quiet'>('checking');
  const [canAskAgain, setCanAskAgain] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || !enabled) return;
    let active = true;
    setBusy(true);
    void Notifications.getPermissionsAsync()
      .then((permission) => {
        if (!active) return;
        setStatus(
          permission.granted ? (permission.ios?.allowsSound === false ? 'quiet' : 'granted') : 'denied',
        );
        setCanAskAgain(permission.canAskAgain);
        if (permission.granted) props.onPermissionGranted?.();
      })
      .catch(() => {
        if (active) setStatus('error');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setReadVersion((current) => current + 1);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled, props.onPermissionGranted, readVersion]);

  async function openSettings(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await Linking.openSettings();
    } catch {
      setActionError(
        'Device settings could not be opened. Open Settings on your device to manage notifications.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestPermission(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      const permission = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      setStatus(
        permission.granted ? (permission.ios?.allowsSound === false ? 'quiet' : 'granted') : 'denied',
      );
      setCanAskAgain(permission.canAskAgain);
      if (permission.granted) props.onPermissionGranted?.();
    } catch {
      setActionError('Notifications could not be enabled. Try again or open device settings.');
    } finally {
      setBusy(false);
    }
  }

  const showBanner =
    enabled && Platform.OS !== 'web' && (status === 'denied' || status === 'error' || status === 'quiet');
  return (
    <View style={styles.container}>
      {showBanner ? (
        <View style={styles.banner}>
          <Card>
            <AppText size="lg" weight="bold">
              {status === 'error'
                ? 'Check notifications'
                : status === 'quiet'
                  ? 'Notification sounds are off'
                  : 'Notifications are off'}
            </AppText>
            <AppText muted>
              {status === 'error'
                ? 'Notification permissions could not be checked. Try again.'
                : status === 'quiet'
                  ? 'Allow Sounds for SV Admin in device settings to hear new booking alerts.'
                  : 'Turn on notifications so your phone can alert you to new bookings, even when the app is closed.'}
            </AppText>
            {actionError ? (
              <AppText accessibilityRole="alert" tone="danger">
                {actionError}
              </AppText>
            ) : null}
            {status === 'error' ? (
              <Button
                label="Check again"
                loading={busy}
                onPress={() => {
                  setActionError(null);
                  setReadVersion((current) => current + 1);
                }}
              />
            ) : status === 'denied' && canAskAgain ? (
              <Button
                label="Enable notifications"
                loading={busy}
                onPress={() => {
                  void requestPermission();
                }}
              />
            ) : null}
            <Button
              label="Open settings"
              tone="secondary"
              disabled={busy}
              onPress={() => {
                void openSettings();
              }}
            />
          </Card>
        </View>
      ) : null}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 16 },
  container: { flex: 1 },
});
