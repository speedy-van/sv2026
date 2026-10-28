import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card } from './primitives';
import { useAuth } from '@/state/auth';
import { useAppColors } from '@/theme/theme';

export function SessionRestoreGate(): React.ReactElement {
  const auth = useAuth();
  const colors = useAppColors();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry(): Promise<void> {
    setError(null);
    try {
      await auth.retryRestore();
    } catch {
      setError('Your saved session could not be checked. Reconnect and try again.');
    }
  }
  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await auth.signOut();
    } catch {
      setError('The server could not confirm sign-out. Please reconnect and try again.');
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.canvas}>
          <AppText muted size="sm" weight="bold">
            Speedy Van · Staff workspace
          </AppText>
          <AppText accessibilityRole="header" aria-level={1} size="title">
            {auth.restoreError ? 'Reconnect to your workspace' : 'Restoring your session'}
          </AppText>
          <Card padding="lg">
            {auth.restoreError ? (
              <>
                <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {auth.restoreError}
                </AppText>
                <Button
                  label="Try again"
                  disabled={signingOut}
                  onPress={() => {
                    void retry();
                  }}
                />
              </>
            ) : (
              <>
                <ActivityIndicator accessibilityLabel="Checking saved session" color={colors.brand} />
                <AppText muted>Checking your saved sign-in securely.</AppText>
              </>
            )}
            {error ? (
              <AppText accessibilityRole="alert" tone="danger">
                {error}
              </AppText>
            ) : null}
            <Button
              label="Sign out on this device"
              tone="secondary"
              loading={signingOut}
              loadingLabel="Signing out…"
              onPress={() => {
                void signOut();
              }}
            />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  canvas: { alignSelf: 'center', gap: 20, maxWidth: 480, width: '100%' },
});
