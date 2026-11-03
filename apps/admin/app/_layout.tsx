import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RootShell } from '@/shell/root-shell';
import { useAuth } from '@/state/auth';
import { useAppColorScheme } from '@/theme/theme';
import { SessionRestoreGate } from '@/components/session-restore-gate';

export default function RootLayout(): React.ReactElement {
  const scheme = useAppColorScheme();
  return (
    <RootShell>
      <RootNavigator />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </RootShell>
  );
}

function RootNavigator(): React.ReactElement {
  const auth = useAuth();
  if (auth.status === 'restoring') return <SessionRestoreGate />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={auth.status === 'signed-in'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status !== 'signed-in'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
