import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { AppText, Button, Card } from './primitives';

export function NotificationPermissionGate(props: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<'checking' | 'denied' | 'granted'>('checking');
  useEffect(() => {
    void Notifications.getPermissionsAsync().then((permission) => { setStatus(permission.granted ? 'granted' : 'denied'); });
  }, []);
  if (status === 'checking' || status === 'granted') return <>{props.children}</>;
  return (
    <View style={{ padding: 16 }}>
      <Card>
        <AppText size="lg" weight="bold">Turn on notifications</AppText>
        <AppText muted>Your phone needs to ring for every new booking, even when the app is closed.</AppText>
        <Button label="Open settings" onPress={() => void Linking.openSettings()} />
      </Card>
      {props.children}
    </View>
  );
}
