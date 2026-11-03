import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RootShell } from '@/shell/root-shell';
import { useAuth } from '@/state/auth';
import { AppText, Button, Card, Screen } from '@/components/primitives';

export default function RootLayout(): React.ReactElement {
  return (
    <RootShell>
      <RootNavigator />
      <StatusBar style="auto" />
    </RootShell>
  );
}

function RootNavigator(): React.ReactElement {
  const auth = useAuth();
  if (auth.status === 'restoring') return (
    <Screen title={auth.restoreError ? 'Reconnect to Driver' : 'Restoring your session'}>
      <Card>
        <AppText accessibilityRole={auth.restoreError ? 'alert' : undefined} accessibilityLiveRegion="polite">
          {auth.restoreError ?? 'Checking your saved sign-in securely.'}
        </AppText>
        {auth.restoreError ? <Button label="Try again" onPress={() => { void auth.retryRestore(); }} /> : null}
      </Card>
    </Screen>
  );
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={auth.status === 'signed-in'}><Stack.Screen name="(app)" /></Stack.Protected>
      <Stack.Protected guard={auth.status !== 'signed-in'}><Stack.Screen name="(auth)" /></Stack.Protected>
    </Stack>
  );
}
