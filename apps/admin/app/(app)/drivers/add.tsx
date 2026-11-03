import { DriverCreateSchema } from '@sv/contracts';
import { router, useFocusEffect } from 'expo-router';
import { Check, Users } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View, type TextInput } from 'react-native';
import { AppText, Button, Card, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { driverCopy, driverCreateFailure } from '@/content/drivers';
import { useAddDriver } from '@/data/drivers';
import { useAuth } from '@/state/auth';
import { useAppColors } from '@/theme/theme';

type Field = 'email' | 'password' | 'phone';
type FieldErrors = Partial<Record<Field, string>>;

export default function AddDriverScreen(): React.ReactElement {
  const colors = useAppColors();
  const auth = useAuth();
  const create = useAddDriver();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; email: string } | null>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const phoneInput = useRef<TextInput>(null);
  const submitting = useRef(false);
  const active = useRef(false);
  const screenEpoch = useRef(0);

  const reset = useCallback((): void => {
    setEmail('');
    setPassword('');
    setPhone('');
    setShowPassword(false);
    setErrors({});
    setError(null);
    setAdded(null);
  }, []);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
        screenEpoch.current += 1;
        reset();
      };
    }, [reset]),
  );
  useEffect(() => {
    if (auth.status !== 'signed-in' || auth.appLocked) {
      screenEpoch.current += 1;
      reset();
    }
  }, [auth.appLocked, auth.status, reset]);
  useEffect(() => {
    screenEpoch.current += 1;
    reset();
  }, [auth.user?.id, reset]);

  function update(field: Field, value: string): void {
    ({ email: setEmail, password: setPassword, phone: setPhone })[field](value);
    setErrors((current) => {
      const next = { ...current };
      if (field === 'email') delete next.email;
      else if (field === 'password') delete next.password;
      else delete next.phone;
      return next;
    });
    setError(null);
  }
  function back(): void {
    reset();
    router.replace('/(app)/drivers');
  }
  async function submit(): Promise<void> {
    if (submitting.current || create.isPending || create.offline || !create.authorized || added) return;
    setError(null);
    const parsed = DriverCreateSchema.safeParse({ email, password, phone });
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        ...(invalid.has('email') ? { email: driverCopy.invalidEmail } : {}),
        ...(invalid.has('password') ? { password: driverCopy.invalidPassword } : {}),
        ...(invalid.has('phone') ? { phone: driverCopy.invalidPhone } : {}),
      });
      if (invalid.has('email')) emailInput.current?.focus();
      else if (invalid.has('password')) passwordInput.current?.focus();
      else phoneInput.current?.focus();
      return;
    }
    submitting.current = true;
    const epoch = screenEpoch.current;
    try {
      const response = await create.addDriver(parsed.data);
      if (active.current && epoch === screenEpoch.current) {
        Keyboard.dismiss();
        setAdded({ id: response.id, email: parsed.data.email });
        setEmail('');
        setPassword('');
        setPhone('');
        setShowPassword(false);
        setErrors({});
      }
    } catch (cause) {
      if (active.current && epoch === screenEpoch.current) setError(driverCreateFailure(cause));
    } finally {
      submitting.current = false;
    }
  }
  const disabled = create.isPending || create.offline || !create.authorized;
  return (
    <ScreenState
      eyebrow="Drivers"
      title={driverCopy.add}
      subtitle={driverCopy.subtitle}
      toolbar={
        <View style={styles.back}>
          <Button label={driverCopy.back} disabled={create.isPending} tone="ghost" onPress={back} />
        </View>
      }
    >
      <View style={styles.canvas}>
        {added ? (
          <Card padding="lg" style={styles.success}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.emblem, { backgroundColor: colors.successSoft }]}
            >
              <Check color={colors.success} size={28} />
            </View>
            <AppText accessibilityRole="header" aria-level={2} size="xl">
              {driverCopy.success}
            </AppText>
            <AppText selectable weight="bold">
              {added.email}
            </AppText>
            <AppText accessibilityLiveRegion="polite">{driverCopy.successHint}</AppText>
            <Button
              label={driverCopy.open}
              onPress={() => {
                router.replace(`/(app)/drivers/${added.id}`);
              }}
            />
            <Button label={driverCopy.another} tone="secondary" onPress={reset} />
          </Card>
        ) : (
          <Card padding="lg" style={styles.form}>
            <View style={styles.introduction}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.emblem, { backgroundColor: colors.brandSoft }]}
              >
                <Users color={colors.brand} size={26} />
              </View>
              <AppText accessibilityRole="header" aria-level={2} size="lg" weight="bold">
                {driverCopy.accountTitle}
              </AppText>
              <AppText muted size="sm">
                {driverCopy.accountHint}
              </AppText>
            </View>
            <TextField
              label={driverCopy.email}
              value={email}
              onChangeText={(value) => {
                update('email', value);
              }}
              inputRef={emailInput}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              inputMode="email"
              keyboardType="email-address"
              maxLength={160}
              textContentType="none"
              editable={!create.isPending}
              {...(errors.email ? { error: errors.email } : {})}
              returnKeyType="next"
              onSubmitEditing={() => {
                passwordInput.current?.focus();
              }}
            />
            <View style={styles.password}>
              <TextField
                label={driverCopy.password}
                hint={driverCopy.passwordHint}
                value={password}
                onChangeText={(value) => {
                  update('password', value);
                }}
                inputRef={passwordInput}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                maxLength={1024}
                secureTextEntry={!showPassword}
                editable={!create.isPending}
                {...(errors.password ? { error: errors.password } : {})}
                returnKeyType="next"
                onSubmitEditing={() => {
                  phoneInput.current?.focus();
                }}
              />
              <Button
                label={showPassword ? 'Hide password' : 'Show password'}
                disabled={create.isPending}
                tone="ghost"
                style={styles.reveal}
                onPress={() => {
                  setShowPassword((current) => !current);
                }}
              />
            </View>
            <TextField
              label={driverCopy.phone}
              hint={driverCopy.phoneHint}
              value={phone}
              onChangeText={(value) => {
                update('phone', value);
              }}
              inputRef={phoneInput}
              autoComplete="off"
              textContentType="none"
              keyboardType="phone-pad"
              inputMode="tel"
              maxLength={26}
              editable={!create.isPending}
              {...(errors.phone ? { error: errors.phone } : {})}
              returnKeyType="done"
              onSubmitEditing={() => {
                void submit();
              }}
            />
            {create.offline ? (
              <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger" size="sm">
                {driverCopy.offline}
              </AppText>
            ) : null}
            {error ? (
              <View style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
                <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger" size="sm">
                  {error}
                </AppText>
              </View>
            ) : null}
            <Button
              label={driverCopy.add}
              loadingLabel={driverCopy.adding}
              loading={create.isPending}
              disabled={disabled || !email.trim() || !password || !phone.trim()}
              onPress={() => {
                void submit();
              }}
            />
          </Card>
        )}
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start' },
  canvas: { alignSelf: 'center', maxWidth: 640, width: '100%' },
  emblem: { alignItems: 'center', borderRadius: 18, height: 56, justifyContent: 'center', width: 56 },
  form: { gap: 24 },
  introduction: { alignItems: 'flex-start', gap: 10 },
  notice: { borderRadius: 12, padding: 14 },
  password: { gap: 4 },
  reveal: { alignSelf: 'flex-end' },
  success: { gap: 18 },
});
