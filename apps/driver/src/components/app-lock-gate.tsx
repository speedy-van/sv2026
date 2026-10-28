import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card } from './primitives';
import { useAuth } from '@/state/auth';

export function AppLockGate(): React.ReactElement {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  async function unlock(): Promise<void> {
    if (unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      if (!(await auth.unlock())) setError('Unlock was not completed. Please try again.');
    } catch { setError('Unlock was not completed. Please try again.'); }
    finally { setUnlocking(false); }
  }
  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Card>
        <AppText size="lg" weight="bold">Unlock Driver</AppText>
        <AppText muted>Use Face ID or your device passcode before viewing jobs, pay or customer details.</AppText>
        {error ? <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</AppText> : null}
        <Button label="Unlock" loading={unlocking} loadingLabel="Unlocking…" onPress={() => { void unlock(); }} />
      </Card>
    </SafeAreaView>
  );
}
