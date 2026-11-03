import { ApiClientError } from '@sv/api-client';
import type { AdminScheduleSlot } from '@sv/contracts';
import { AdminSlotClosureRequestSchema } from '@sv/contracts';
import NetInfo from '@react-native-community/netinfo';
import { useId, useRef, useState, useEffect } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, TextField } from './primitives';
import { displayAdminDate, slotLabel, useSlotClosure } from '@/data/operations';
import { useAuth } from '@/state/auth';
import { useAppColors } from '@/theme/theme';

interface ClosureIntent {
  closed: boolean;
  expectedClosureId: string | null;
}
type Phase = 'idle' | 'checking' | 'saving';
const offlineMessage = "You're offline. Reconnect before changing this time window.";

export function SlotClosureControl(props: { date: string; window: AdminScheduleSlot }): React.ReactElement {
  return <SlotClosureDialog key={`${props.date}:${props.window.slot}`} {...props} />;
}

function SlotClosureDialog({
  date,
  window,
}: {
  date: string;
  window: AdminScheduleSlot;
}): React.ReactElement {
  const colors = useAppColors();
  const auth = useAuth();
  const mutation = useSlotClosure();
  const network = NetInfo.useNetInfo();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const authReason =
    auth.status !== 'signed-in'
      ? 'Sign in to change this time window.'
      : auth.appLocked
        ? 'Unlock the app to change this time window.'
        : auth.user?.role !== 'OWNER' && auth.user?.role !== 'ADMIN'
          ? 'Only an admin or owner can change time-window closures.'
          : null;
  const [intent, setIntent] = useState<ClosureIntent | null>(null);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [focused, setFocused] = useState<'switch' | 'cancel' | null>(null);
  const cancelButton = useRef<View>(null);
  const submitting = useRef(false);
  const attempt = useRef(0);
  const mounted = useRef(true);
  const stage = useRef<Phase>('idle');
  const currentState = useRef({ authReason, window });
  currentState.current = { authReason, window };
  const id = useId();
  const manualClosed = window.manualClosure !== null;
  const closureId = window.manualClosure?.id ?? null;
  const blockedReason =
    !manualClosed && !window.closeAllowed
      ? (window.closeBlockedReason ?? 'This time window cannot be closed right now.')
      : null;
  const busy = phase !== 'idle' || mutation.isPending;
  const saving = phase === 'saving' || mutation.isPending;
  const changed = intent !== null && closureId !== intent.expectedClosureId;
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 200;
  const title = intent?.closed === false ? 'Remove this manual closure?' : 'Close this time window?';
  const cancelLabel = intent?.closed === false ? 'Keep closed' : 'Keep open';
  const confirmLabel = intent?.closed === false ? 'Remove closure' : 'Close window';
  const unavailable = Boolean(authReason || blockedReason || offline || busy);
  const modalBlocked = authReason || (intent?.closed ? blockedReason : null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current += 1;
    };
  }, []);

  function cancel(): void {
    if (stage.current === 'saving' || mutation.isPending) return;
    attempt.current += 1;
    setIntent(null);
    setError(null);
    mutation.reset();
  }

  function show(): void {
    if (unavailable || submitting.current || intent) return;
    mutation.reset();
    setReason('');
    setReasonTouched(false);
    setError(null);
    setUncertain(false);
    setAnnouncement(null);
    setIntent({ closed: !manualClosed, expectedClosureId: closureId });
  }

  async function confirm(): Promise<void> {
    if (!intent || submitting.current || mutation.isPending || uncertain) return;
    setReasonTouched(true);
    const parsed = AdminSlotClosureRequestSchema.safeParse({
      date,
      slot: window.slot,
      closed: intent.closed,
      expectedClosureId: intent.expectedClosureId,
      reason,
    });
    if (!parsed.success) return;
    if (authReason || modalBlocked || offline || changed) {
      setError(
        authReason ||
          modalBlocked ||
          (offline
            ? offlineMessage
            : 'This time window changed. Close this message and review its latest details.'),
      );
      return;
    }
    submitting.current = true;
    const activeAttempt = ++attempt.current;
    const isCurrent = (): boolean => mounted.current && activeAttempt === attempt.current;
    stage.current = 'checking';
    setPhase('checking');
    setError(null);
    try {
      const connection = await NetInfo.fetch();
      if (!isCurrent()) return;
      if (connection.isConnected === false || connection.isInternetReachable === false) {
        setError(offlineMessage);
        return;
      }
      const latest = currentState.current;
      if (latest.authReason) {
        setError(latest.authReason);
        return;
      }
      if ((latest.window.manualClosure?.id ?? null) !== intent.expectedClosureId) {
        setError('This time window changed. Close this message and review its latest details.');
        return;
      }
      if (intent.closed && !latest.window.closeAllowed) {
        setError(latest.window.closeBlockedReason ?? 'This time window cannot be closed right now.');
        return;
      }
      stage.current = 'saving';
      setPhase('saving');
      await mutation.mutateAsync(parsed.data);
      if (!isCurrent()) return;
      setIntent(null);
      setAnnouncement(
        intent.closed
          ? 'Time window manually closed to new bookings.'
          : 'Manual closure removed. Capacity rules and existing jobs and holds determine availability.',
      );
    } catch (cause) {
      if (!isCurrent()) return;
      if (cause instanceof ApiClientError && cause.status === 409) {
        setError(
          `${cause.message} The latest availability is being checked. Close this message and review the time window.`,
        );
      } else if (cause instanceof ApiClientError && cause.status === 403) {
        setError('You do not have permission to change this time window.');
      } else if (stage.current === 'checking') {
        setError(
          'The connection could not be checked. Nothing was sent. Check your connection and try again.',
        );
      } else {
        setUncertain(true);
        setError(
          'Could not confirm the result. Close this message and refresh the schedule before trying again.',
        );
      }
    } finally {
      submitting.current = false;
      stage.current = 'idle';
      if (mounted.current) setPhase('idle');
    }
  }

  function handleSwitchKey(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) show();
  }

  function focusOutline(target: 'switch' | 'cancel'): ViewStyle | undefined {
    return focused === target && Platform.OS === 'web'
      ? { outlineColor: colors.focus, outlineOffset: 3, outlineStyle: 'solid', outlineWidth: 3 }
      : undefined;
  }

  return (
    <>
      <Pressable
        accessibilityHint={`${displayAdminDate(date)}, ${slotLabel(window.slot)}. ${manualClosed ? 'Remove the manual closure after confirmation.' : 'Close this window after confirmation.'}`}
        accessibilityLabel="Closed to new bookings"
        accessibilityRole="switch"
        accessibilityState={{ checked: manualClosed, disabled: unavailable, busy }}
        aria-checked={manualClosed}
        disabled={unavailable}
        onBlur={() => {
          setFocused(null);
        }}
        onFocus={() => {
          setFocused('switch');
        }}
        onPress={show}
        {...(Platform.OS === 'web' ? { onKeyDown: handleSwitchKey } : {})}
        style={({ pressed }) => [
          styles.control,
          { borderColor: colors.borderStrong, opacity: unavailable ? 0.5 : pressed ? 0.7 : 1 },
          focusOutline('switch'),
        ]}
      >
        <AppText size="sm" weight="bold" style={styles.label}>
          Closed to new bookings
        </AppText>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.track, { backgroundColor: manualClosed ? colors.brand : colors.borderStrong }]}
        >
          <View
            style={[
              styles.thumb,
              { backgroundColor: colors.surface, alignSelf: manualClosed ? 'flex-end' : 'flex-start' },
            ]}
          />
        </View>
      </Pressable>
      {window.manualClosure ? (
        <AppText muted size="sm">
          Reason: {window.manualClosure.reason}
        </AppText>
      ) : null}
      {authReason || blockedReason ? (
        <AppText muted size="sm">
          {authReason || blockedReason}
        </AppText>
      ) : null}
      {offline ? (
        <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger" size="sm">
          {offlineMessage}
        </AppText>
      ) : null}
      {announcement ? (
        <AppText accessibilityLiveRegion="polite" size="sm" tone="success">
          {announcement}
        </AppText>
      ) : null}
      <Modal
        accessibilityLabel={title}
        animationType="none"
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-title`}
        onRequestClose={cancel}
        onShow={() => {
          cancelButton.current?.focus();
        }}
        presentationStyle="overFullScreen"
        role="dialog"
        transparent
        visible={intent !== null}
      >
        <SafeAreaView style={[styles.backdrop, { backgroundColor: `${colors.shadow}B8` }]}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View accessibilityViewIsModal style={styles.dialog} testID="slot-closure-dialog">
              <Card padding="lg">
                <AppText accessibilityRole="header" aria-level={2} nativeID={`${id}-title`} size="xl">
                  {title}
                </AppText>
                <View style={[styles.date, { backgroundColor: colors.surfaceMuted }]}>
                  <AppText weight="bold">{displayAdminDate(date)}</AppText>
                  <AppText muted size="sm">
                    {slotLabel(window.slot)}
                  </AppText>
                </View>
                <AppText muted nativeID={`${id}-description`} size="sm">
                  {intent?.closed === false
                    ? 'Removing this manual closure returns the window to its original capacity rules. Existing jobs and active holds still determine availability. It does not guarantee free space.'
                    : 'New bookings will be blocked for this time window. Existing jobs stay unchanged. A checkout in progress must finish before this window can close. No booking is created.'}
                </AppText>
                <TextField
                  editable={!busy}
                  {...(reasonTouched && !reasonValid
                    ? { error: 'Enter a reason between 3 and 200 characters.' }
                    : {})}
                  hint="Required for the audit record. Use 3–200 characters."
                  label="Reason for this change"
                  maxLength={200}
                  multiline
                  onBlur={() => {
                    setReasonTouched(true);
                  }}
                  onChangeText={setReason}
                  value={reason}
                />
                {modalBlocked ? (
                  <AppText accessibilityRole="alert" tone="danger" size="sm">
                    {modalBlocked}
                  </AppText>
                ) : null}
                {changed ? (
                  <AppText accessibilityRole="alert" tone="danger" size="sm">
                    This time window changed. Close this message and review its latest details.
                  </AppText>
                ) : null}
                {offline ? (
                  <AppText accessibilityRole="alert" tone="danger" size="sm">
                    {offlineMessage}
                  </AppText>
                ) : null}
                {error && !(offline && error === offlineMessage) ? (
                  <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger" size="sm">
                    {error}
                  </AppText>
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={cancelLabel}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: saving }}
                    disabled={saving}
                    onBlur={() => {
                      setFocused(null);
                    }}
                    onFocus={() => {
                      setFocused('cancel');
                    }}
                    onPress={cancel}
                    ref={cancelButton}
                    style={({ pressed }) => [
                      styles.cancel,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                        opacity: saving ? 0.5 : pressed ? 0.7 : 1,
                      },
                      focusOutline('cancel'),
                    ]}
                  >
                    <AppText size="sm" weight="bold">
                      {cancelLabel}
                    </AppText>
                  </Pressable>
                  <Button
                    disabled={
                      !reasonValid || Boolean(modalBlocked) || changed || offline || busy || uncertain
                    }
                    label={confirmLabel}
                    loading={busy}
                    loadingLabel={
                      phase === 'checking'
                        ? 'Checking connection…'
                        : intent?.closed === false
                          ? 'Removing closure…'
                          : 'Closing window…'
                    }
                    onPress={() => {
                      void confirm();
                    }}
                    tone={intent?.closed === false ? 'brand' : 'danger'}
                  />
                </View>
              </Card>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10, marginTop: 6 },
  backdrop: { flex: 1 },
  cancel: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  control: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  date: { borderRadius: 12, gap: 4, padding: 14 },
  dialog: { alignSelf: 'center', maxWidth: 480, width: '100%' },
  label: { flex: 1, minWidth: 0 },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  thumb: { borderRadius: 12, height: 24, width: 24 },
  track: { borderRadius: 14, justifyContent: 'center', padding: 2, width: 50 },
});
