import { router } from 'expo-router';
import { LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, SegmentedControl, TextField } from '@/components/primitives';
import { useAuth } from '@/state/auth';
import { authFailureMessage } from '@/content/auth';
import { useAppColors } from '@/theme/theme';

type SignInMethod = 'password' | 'code';

export default function SignInScreen(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<SignInMethod>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const submitting = auth.status === 'submitting';
  const canSubmit = email.includes('@') && (method === 'code' || password.length > 0) && !submitting;

  async function submit(): Promise<void> {
    if (submitting) return;
    setError(null);
    try {
      if (method === 'password') {
        await auth.signInWithPassword(email, password);
        setPassword('');
        router.replace('/(app)/today');
      } else {
        await auth.requestCode(email);
        router.push({ pathname: '/(auth)/code', params: { email } });
      }
    } catch (cause) {
      setError(authFailureMessage(cause, method));
    }
  }

  function changeMethod(next: SignInMethod): void {
    if (submitting) return;
    setMethod(next);
    setPassword('');
    setShowPassword(false);
    setError(null);
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.canvas, width >= 768 && styles.canvasWide]}>
          <View style={styles.introduction}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.emblem, { backgroundColor: colors.brandSoft }]}
            >
              <LockKeyhole color={colors.brand} size={28} strokeWidth={1.7} />
            </View>
            <AppText size="sm" tone="brand" weight="bold">
              Speedy Van · Staff workspace
            </AppText>
            <AppText accessibilityRole="header" aria-level={1} size="title" style={styles.centerText}>
              Sign in
            </AppText>
            <AppText muted style={styles.introCopy}>
              Your bookings, team and daily operations in one place.
            </AppText>
          </View>
          <Card padding="lg" style={styles.form}>
            {auth.signOutWarning ? (
              <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}>
                <AppText
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  size="sm"
                  style={{ color: colors.warning }}
                >
                  {auth.signOutWarning}
                </AppText>
              </View>
            ) : null}
            <SegmentedControl<SignInMethod>
              label="Sign-in method"
              onChange={changeMethod}
              options={[
                { disabled: submitting, label: 'Use password', value: 'password' },
                { disabled: submitting, label: 'Email code', value: 'code' },
              ]}
              value={method}
            />
            <AppText muted size="sm">
              {method === 'password'
                ? 'Use your staff email and password.'
                : 'We will send a six digit code to your staff email.'}
            </AppText>
            <TextField
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!submitting}
              inputMode="email"
              label="Email"
              onChangeText={setEmail}
              onSubmitEditing={() => {
                if (method === 'code' && canSubmit) void submit();
              }}
              placeholder="you@speedyvan.uk"
              textContentType="emailAddress"
              value={email}
            />
            {method === 'password' ? (
              <View style={styles.passwordGroup}>
                <TextField
                  autoCapitalize="none"
                  autoComplete="current-password"
                  autoCorrect={false}
                  editable={!submitting}
                  label="Password"
                  maxLength={1024}
                  onChangeText={setPassword}
                  onSubmitEditing={() => {
                    if (canSubmit) void submit();
                  }}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  value={password}
                />
                <Button
                  disabled={submitting}
                  label={showPassword ? 'Hide password' : 'Show password'}
                  onPress={() => {
                    setShowPassword((current) => !current);
                  }}
                  style={styles.passwordToggle}
                  tone="ghost"
                />
              </View>
            ) : null}
            {error ? (
              <View style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
                <AppText accessibilityLiveRegion="polite" accessibilityRole="alert" size="sm" tone="danger">
                  {error}
                </AppText>
              </View>
            ) : null}
            <Button
              disabled={!canSubmit}
              label={method === 'password' ? 'Sign in' : 'Send code'}
              loading={submitting}
              loadingLabel={method === 'password' ? 'Signing in…' : 'Sending code…'}
              onPress={() => {
                void submit();
              }}
            />
          </Card>
          <AppText muted size="xs" style={styles.centerText}>
            Staff access only
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  canvas: {
    alignSelf: 'center',
    gap: 24,
    maxWidth: 500,
    paddingHorizontal: 20,
    paddingVertical: 32,
    width: '100%',
  },
  canvasWide: { paddingVertical: 56 },
  centerText: { textAlign: 'center' },
  emblem: {
    alignItems: 'center',
    borderRadius: 22,
    height: 64,
    justifyContent: 'center',
    marginBottom: 8,
    width: 64,
  },
  form: { gap: 20 },
  introCopy: { maxWidth: 360, textAlign: 'center' },
  introduction: { alignItems: 'center', gap: 9 },
  notice: { borderRadius: 12, padding: 14 },
  passwordGroup: { gap: 6 },
  passwordToggle: { alignSelf: 'flex-end' },
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
});
