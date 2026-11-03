import type { AdminBookingDetailResponse } from '@sv/contracts';
import { ApiClientError } from '@sv/api-client';
import NetInfo from '@react-native-community/netinfo';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { RotateCcw, Trash2 } from 'lucide-react-native';
import { useEffect, useId, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, IconButton } from './primitives';
import { useBookingCleanup } from '@/data/operations';
import { useAppColors } from '@/theme/theme';

type Operation = 'delete' | 'restore';
type Phase = 'idle' | 'checking' | 'saving';
const offlineMessage = "You're offline. Reconnect before changing this job.";

export function BookingCleanupActions({
  booking,
}: {
  booking: AdminBookingDetailResponse;
}): React.ReactElement {
  const colors = useAppColors();
  const cleanup = useBookingCleanup();
  const network = NetInfo.useNetInfo();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cancelFocused, setCancelFocused] = useState(false);
  const cancelButton = useRef<View>(null);
  const submitting = useRef(false);
  const attempt = useRef(0);
  const mounted = useRef(true);
  const stage = useRef<Phase>('idle');
  const id = useId();
  const operation: Operation = booking.deletedAt ? 'restore' : 'delete';
  const allowed = operation === 'restore' || booking.deletion.allowed;
  const busy = phase !== 'idle' || cleanup.isPending;
  const saving = phase === 'saving' || cleanup.isPending;
  const title = operation === 'delete' ? 'Delete this job?' : 'Restore this job?';
  const actionLabel = operation === 'delete' ? 'Delete job' : 'Restore job';
  const cancelLabel = operation === 'delete' ? 'Keep job' : 'Cancel';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current += 1;
    };
  }, [booking.id]);

  function close(): void {
    if (stage.current === 'saving' || cleanup.isPending) return;
    attempt.current += 1;
    setOpen(false);
    setError(null);
  }

  function show(): void {
    if (submitting.current || cleanup.isPending) return;
    setError(null);
    setOpen(true);
  }

  async function confirm(): Promise<void> {
    if (!open || submitting.current || cleanup.isPending || !allowed) return;
    if (offline) {
      setError(offlineMessage);
      return;
    }
    submitting.current = true;
    const current = ++attempt.current;
    const isCurrent = (): boolean => mounted.current && current === attempt.current;
    const requested = { id: booking.id, expectedVersion: booking.version, operation };
    stage.current = 'checking';
    setPhase('checking');
    setError(null);
    try {
      if (Platform.OS !== 'web') {
        const verified = await LocalAuthentication.authenticateAsync({
          biometricsSecurityLevel: 'strong',
          cancelLabel,
          disableDeviceFallback: false,
          promptMessage: `${actionLabel} ${booking.reference}`,
        });
        if (!isCurrent()) return;
        if (!verified.success) {
          setError('Verification was not completed. Nothing changed. Try again when you are ready.');
          return;
        }
      }
      if (!isCurrent()) return;
      const connection = await NetInfo.fetch();
      if (!isCurrent()) return;
      if (connection.isConnected === false || connection.isInternetReachable === false) {
        setError(offlineMessage);
        return;
      }
      stage.current = 'saving';
      setPhase('saving');
      await cleanup.mutateAsync(requested);
      if (!isCurrent()) return;
      setOpen(false);
      router.replace({
        pathname: '/(app)/bookings',
        params: { view: 'all', notice: operation === 'delete' ? 'deleted' : 'restored' },
      });
    } catch (cause) {
      if (!isCurrent()) return;
      setError(
        cause instanceof ApiClientError && cause.status === 409
          ? `${cause.message} The latest details are being checked. Review the job before trying again.`
          : cause instanceof ApiClientError && cause.status === 403
            ? 'You do not have permission to change this job.'
            : cause instanceof ApiClientError && cause.envelope?.error.code === 'UPSTREAM_UNAVAILABLE'
              ? `${cause.message} The job has not been removed. Please try again when the payment service is available.`
            : stage.current === 'checking'
              ? 'Verification could not be completed. Nothing changed. Check your connection and try again.'
              : 'Could not confirm the result. Close this message and refresh the job before trying again.',
      );
    } finally {
      submitting.current = false;
      stage.current = 'idle';
      if (mounted.current) setPhase('idle');
    }
  }

  return (
    <>
      <IconButton
        disabled={busy}
        icon={
          operation === 'delete' ? (
            <Trash2 color={colors.danger} size={21} />
          ) : (
            <RotateCcw color={colors.brand} size={21} />
          )
        }
        label={actionLabel}
        onPress={show}
      />
      <Modal
        accessibilityLabel={title}
        animationType="none"
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-title`}
        onRequestClose={close}
        onShow={() => {
          cancelButton.current?.focus();
        }}
        presentationStyle="overFullScreen"
        role="dialog"
        transparent
        visible={open}
      >
        <SafeAreaView style={[styles.backdrop, { backgroundColor: `${colors.shadow}B8` }]}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View accessibilityViewIsModal style={styles.dialog} testID="booking-cleanup-dialog">
              <Card padding="lg">
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.emblem,
                    { backgroundColor: operation === 'delete' ? colors.dangerSoft : colors.brandSoft },
                  ]}
                >
                  {operation === 'delete' ? (
                    <Trash2 color={colors.danger} size={26} />
                  ) : (
                    <RotateCcw color={colors.brand} size={26} />
                  )}
                </View>
                <AppText accessibilityRole="header" aria-level={2} nativeID={`${id}-title`} size="xl">
                  {title}
                </AppText>
                <View style={[styles.job, { backgroundColor: colors.surfaceMuted }]}>
                  <AppText weight="bold">{booking.reference}</AppText>
                  <AppText muted size="sm">
                    {booking.routeLabel}
                  </AppText>
                </View>
                <AppText muted nativeID={`${id}-description`} size="sm">
                  {operation === 'delete'
                    ? 'The record and payment history will stay in Deleted jobs. An unpaid checkout will be closed. Restoring brings back the record, not its old checkout.'
                    : 'This job will return to your booking lists. The record and payment history are kept. An old unpaid checkout will not be reopened.'}
                </AppText>
                {!allowed ? (
                  <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}>
                    <AppText accessibilityLiveRegion="polite" size="sm" style={{ color: colors.warning }}>
                      {booking.deletion.reason ?? 'This job cannot be deleted in its current state.'}
                    </AppText>
                  </View>
                ) : null}
                {offline ? (
                  <AppText accessibilityLiveRegion="polite" accessibilityRole="alert" size="sm" tone="danger">
                    {offlineMessage}
                  </AppText>
                ) : null}
                {error && !(offline && error === offlineMessage) ? (
                  <AppText accessibilityLiveRegion="polite" accessibilityRole="alert" size="sm" tone="danger">
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
                      setCancelFocused(false);
                    }}
                    onFocus={() => {
                      setCancelFocused(true);
                    }}
                    onPress={close}
                    ref={cancelButton}
                    style={({ pressed }) => [
                      styles.cancelButton,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                        opacity: saving ? 0.5 : pressed ? 0.7 : 1,
                      },
                      cancelFocused &&
                        Platform.OS === 'web' && {
                          outlineColor: colors.focus,
                          outlineOffset: 3,
                          outlineStyle: 'solid',
                          outlineWidth: 3,
                        },
                    ]}
                  >
                    <AppText size="sm" weight="bold">
                      {cancelLabel}
                    </AppText>
                  </Pressable>
                  {allowed ? (
                    <Button
                      disabled={offline || busy}
                      label={actionLabel}
                      loading={busy}
                      loadingLabel={
                        phase === 'checking'
                          ? 'Checking…'
                          : operation === 'delete'
                            ? 'Deleting job…'
                            : 'Restoring job…'
                      }
                      onPress={() => {
                        void confirm();
                      }}
                      tone={operation === 'delete' ? 'danger' : 'brand'}
                    />
                  ) : null}
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
  cancelButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  dialog: { alignSelf: 'center', maxWidth: 480, width: '100%' },
  emblem: {
    alignItems: 'center',
    borderRadius: 17,
    height: 52,
    justifyContent: 'center',
    marginBottom: 2,
    width: 52,
  },
  job: { borderRadius: 12, gap: 4, padding: 14 },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  notice: { borderRadius: 12, padding: 12 },
});
