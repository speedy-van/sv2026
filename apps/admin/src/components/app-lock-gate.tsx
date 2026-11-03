import { LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card } from './primitives';
import { useAuth } from '@/state/auth';
import { useAppColors } from '@/theme/theme';

export function AppLockGate(): React.ReactElement {
  const auth = useAuth();
  const colors = useAppColors();
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  async function unlock(): Promise<void> {
    if (unlocking) return;
    setError(false);
    setUnlocking(true);
    try {
      if (!(await auth.unlock())) setError(true);
    } catch {
      setError(true);
    } finally {
      setUnlocking(false);
    }
  }
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.canvas}>
          <View style={styles.introduction}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.emblem, { backgroundColor: colors.brandSoft }]}
            >
              <LockKeyhole color={colors.brand} size={32} strokeWidth={1.6} />
            </View>
            <AppText size="sm" tone="brand" weight="bold">
              Speedy Van · App locked
            </AppText>
            <AppText accessibilityRole="header" aria-level={1} size="title" style={styles.centerText}>
              Unlock SV Admin
            </AppText>
          </View>
          <Card padding="lg" style={styles.form}>
            <AppText muted style={styles.centerText}>
              Use Face ID or your device passcode before viewing bookings, payments or staff data.
            </AppText>
            {error ? (
              <View style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
                <AppText accessibilityLiveRegion="polite" accessibilityRole="alert" size="sm" tone="danger">
                  Unlock was not completed. Please try again.
                </AppText>
              </View>
            ) : null}
            <Button
              label="Unlock"
              loading={unlocking}
              loadingLabel="Unlocking…"
              onPress={() => {
                void unlock();
              }}
            />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  canvas: {
    alignSelf: 'center',
    gap: 28,
    maxWidth: 500,
    paddingHorizontal: 20,
    paddingVertical: 40,
    width: '100%',
  },
  centerText: { textAlign: 'center' },
  emblem: {
    alignItems: 'center',
    borderRadius: 28,
    height: 80,
    justifyContent: 'center',
    marginBottom: 12,
    width: 80,
  },
  form: { gap: 24 },
  introduction: { alignItems: 'center', gap: 10 },
  notice: { borderRadius: 12, padding: 14 },
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
});
