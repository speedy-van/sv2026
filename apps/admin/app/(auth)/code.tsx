import { useLocalSearchParams, router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';
import { authFailureMessage } from '@/content/auth';
import { useAppColors } from '@/theme/theme';

export default function CodeScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const colors = useAppColors();
  const email = params.email ?? '';
  const submitting = auth.status === 'submitting';

  async function submit(): Promise<void> {
    if (submitting) return;
    setError(null);
    try {
      await auth.signInWithCode(email, code);
      router.replace('/(app)/today');
    } catch (cause) {
      setError(authFailureMessage(cause, 'code'));
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.canvas}>
          <View style={styles.introduction}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.emblem, { backgroundColor: colors.brandSoft }]}
            >
              <Mail color={colors.brand} size={28} strokeWidth={1.7} />
            </View>
            <AppText size="sm" tone="brand" weight="bold">
              Check your email
            </AppText>
            <AppText accessibilityRole="header" aria-level={1} size="title" style={styles.centerText}>
              Enter code
            </AppText>
            <AppText muted style={styles.centerText}>
              {email ? `Code sent to ${email}.` : 'Enter the six digit code from your email.'}
            </AppText>
          </View>
          <Card padding="lg" style={styles.form}>
            <TextField
              autoComplete="one-time-code"
              autoCorrect={false}
              editable={!submitting}
              hint="Enter all six digits from your sign-in email."
              inputMode="numeric"
              label="Code"
              maxLength={6}
              onChangeText={setCode}
              onSubmitEditing={() => {
                if (code.length === 6 && !submitting) void submit();
              }}
              placeholder="000000"
              returnKeyType="go"
              style={styles.codeInput}
              textContentType="oneTimeCode"
              value={code}
            />
            {error ? (
              <View style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
                <AppText accessibilityLiveRegion="polite" accessibilityRole="alert" size="sm" tone="danger">
                  {error}
                </AppText>
              </View>
            ) : null}
            <Button
              disabled={code.length !== 6 || submitting}
              label="Verify code"
              loading={submitting}
              loadingLabel="Verifying code…"
              onPress={() => {
                void submit();
              }}
            />
            <View style={[styles.divider, { backgroundColor: colors.separator }]} />
            <AppText muted size="sm" style={styles.centerText}>
              Need another code or a different email?
            </AppText>
            <Button
              disabled={submitting}
              label="Back to sign in"
              onPress={() => {
                router.replace('/(auth)/sign-in');
              }}
              tone="secondary"
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
  codeInput: {
    fontFamily: 'BricolageGrotesque_700Bold',
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    letterSpacing: 8,
    lineHeight: 38,
    minHeight: 64,
    textAlign: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  emblem: {
    alignItems: 'center',
    borderRadius: 22,
    height: 64,
    justifyContent: 'center',
    marginBottom: 8,
    width: 64,
  },
  form: { gap: 18 },
  introduction: { alignItems: 'center', gap: 9 },
  notice: { borderRadius: 12, padding: 14 },
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
});
