import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppText, Button, Card } from '@/components/primitives';

export function DriverPermissionGates(props: { children: React.ReactNode }): React.ReactElement {
  const [notifications, setNotifications] = useState<'granted' | 'missing'>('granted');
  const [location, setLocation] = useState<'granted' | 'missing'>('granted');
  useEffect(() => {
    void Notifications.getPermissionsAsync().then((result) => {
      setNotifications(result.granted ? 'granted' : 'missing');
    });
    void Location.getForegroundPermissionsAsync().then((result) => {
      setLocation(result.granted ? 'granted' : 'missing');
    });
  }, []);

  if (notifications === 'granted' && location === 'granted') return <>{props.children}</>;

  return (
    <Card>
      <AppText size="lg" weight="bold">Permissions needed</AppText>
      <AppText muted>Enable notifications and location before running jobs.</AppText>
      {notifications === 'missing' ? (
        <Button
          label="Enable notifications"
          onPress={() => {
            void Notifications.requestPermissionsAsync().then((result) => {
              setNotifications(result.granted ? 'granted' : 'missing');
            });
          }}
        />
      ) : null}
      {location === 'missing' ? (
        <Button
          label="Enable location"
          onPress={() => {
            void Location.requestForegroundPermissionsAsync().then((result) => {
              setLocation(result.granted ? 'granted' : 'missing');
            });
          }}
          tone="secondary"
        />
      ) : null}
    </Card>
  );
}
