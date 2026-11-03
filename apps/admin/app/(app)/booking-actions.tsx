import {
  AdminBookingActionsContextSchema,
  AdminBookingMutationResponseSchema,
  AdminCancelApplySchema,
  AdminCancelPreviewRequestSchema,
  AdminCancelPreviewResponseSchema,
  AdminExtraChargeRequestSchema,
  AdminOfflinePaymentRequestSchema,
  AdminPaymentRefundRequestSchema,
  AdminResendEmailRequestSchema,
  formatGBP,
  type AdminBookingActionsContext,
  type AdminCancelPreviewResponse,
} from '@sv/contracts';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { ToggleField } from '@/components/booking-edit-fields';
import { AppText, Badge, Button, Card, TextField, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { penceToInput, poundsToPence } from '@/data/admin-tool-forms';
import { useAdminToolSession, type AdminToolSession } from '@/data/admin-tool-session';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';

type ActionKind = 'cancel' | 'refund' | 'offline-payment' | 'extra-charge' | 'resend-email';
const actionPaths: Record<ActionKind, string> = {
  cancel: 'cancel',
  refund: 'refunds',
  'offline-payment': 'payments/offline',
  'extra-charge': 'extra-charges',
  'resend-email': 'resend-email',
};
export default function BookingActionsScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const session = useAdminToolSession();
  const query = useQuery({
    ...session.queryOptions,
    enabled: session.enabled && Boolean(id),
    queryKey: ['admin', session.actorId, 'booking-actions', id],
    queryFn: ({ signal }) =>
      session.request(
        `/api/v1/admin/bookings/${encodeURIComponent(id)}/actions-context`,
        AdminBookingActionsContextSchema,
        { signal },
      ),
  });
  return (
    <ScreenState
      title="Booking actions"
      subtitle="Payments, cancellation and customer emails."
      status={
        !id
          ? 'error'
          : !session.privateReady || (query.isPending && !session.offline)
            ? 'loading'
            : query.data
              ? 'ready'
              : 'error'
      }
      errorMessage="Booking actions could not be loaded. Check your connection and retry."
      onRetry={() => {
        void query.refetch();
      }}
      toolbar={
        <Button
          label="Back to booking"
          tone="secondary"
          onPress={() => {
            router.replace(id ? `/(app)/bookings/${encodeURIComponent(id)}` : '/(app)/bookings');
          }}
        />
      }
    >
      {query.data && session.privateReady ? (
        <ActionsWorkspace
          key={`${session.actorId ?? ''}:${id}`}
          context={query.data}
          session={session}
          stale={query.isError}
        />
      ) : null}
    </ScreenState>
  );
}

function ActionsWorkspace({
  context,
  session,
  stale,
}: {
  context: AdminBookingActionsContext;
  session: AdminToolSession;
  stale: boolean;
}): React.ReactElement {
  const action = useAdminToolAction(session);
  const [kind, setKind] = useState<ActionKind>('resend-email');
  const [version, setVersion] = useState(context.version);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString());
  const [paymentId, setPaymentId] = useState('');
  const [refundMode, setRefundMode] = useState<'POLICY' | 'FULL' | 'NONE' | 'CUSTOM'>('POLICY');
  const [notify, setNotify] = useState(true);
  const [template, setTemplate] = useState<'CONFIRMATION' | 'PAYMENT_LINK' | 'MANAGE_LINK'>('PAYMENT_LINK');
  const [preview, setPreview] = useState<AdminCancelPreviewResponse | null>(null);
  const [completed, setCompleted] = useState(false);
  const changed = context.version !== version;
  const capability =
    kind === 'cancel'
      ? context.cancellation
      : kind === 'refund'
        ? context.refund
        : kind === 'offline-payment'
          ? context.offlinePayment
          : kind === 'extra-charge'
            ? context.extraCharge
            : null;
  const disabled =
    !session.enabled ||
    action.busy ||
    action.needsReload ||
    stale ||
    changed ||
    completed ||
    (capability !== null && !capability.allowed) ||
    (kind === 'offline-payment' && !session.owner);
  const eligiblePayments = context.payments.filter(
    (payment) => payment.method === 'STRIPE' && payment.refundablePence > 0,
  );
  function reset(next: ActionKind, nextVersion = context.version, balance = context.balancePence): void {
    if (action.busy) return;
    setKind(next);
    setVersion(nextVersion);
    setReason('');
    setAmount(next === 'offline-payment' ? penceToInput(balance) : '');
    setReference('');
    setPreview(null);
    setCompleted(false);
    action.clear();
  }
  function cancellation(): ReturnType<typeof AdminCancelPreviewRequestSchema.parse> {
    return AdminCancelPreviewRequestSchema.parse({
      expectedVersion: version,
      reason,
      notifyCustomer: notify,
      refund:
        refundMode === 'CUSTOM'
          ? { mode: 'CUSTOM', amountPence: poundsToPence(amount) }
          : { mode: refundMode },
    });
  }
  async function previewCancellation(): Promise<void> {
    if (disabled) return;
    setPreview(null);
    const result = await action.run(() =>
      session.request(
        `/api/v1/admin/bookings/${encodeURIComponent(context.id)}/cancel-preview`,
        AdminCancelPreviewResponseSchema,
        { method: 'POST', body: cancellation() },
      ),
    );
    if (result) setPreview(result);
  }
  async function submit(): Promise<void> {
    if (disabled || (kind === 'cancel' && !preview)) return;
    const result = await action.run(
      async () => {
        const expectedVersion = version;
        const body =
          kind === 'cancel'
            ? AdminCancelApplySchema.parse({ ...cancellation(), expectedRefundPence: preview?.refundPence })
            : kind === 'refund'
              ? AdminPaymentRefundRequestSchema.parse({
                  expectedVersion,
                  paymentId,
                  amountPence: poundsToPence(amount),
                  reason,
                })
              : kind === 'offline-payment'
                ? AdminOfflinePaymentRequestSchema.parse({
                    expectedVersion,
                    amountPence: poundsToPence(amount),
                    reference,
                    paidAt,
                  })
                : kind === 'extra-charge'
                  ? AdminExtraChargeRequestSchema.parse({
                      expectedVersion,
                      amountPence: poundsToPence(amount),
                      description: reason,
                    })
                  : AdminResendEmailRequestSchema.parse({ expectedVersion, template });
        if (kind === 'refund') {
          const payment = eligiblePayments.find((item) => item.id === paymentId);
          if (!payment || poundsToPence(amount) > payment.refundablePence)
            throw new Error('Choose a payment and an amount no greater than its refundable balance.');
        }
        if (kind === 'offline-payment' && (!session.owner || poundsToPence(amount) !== context.balancePence))
          throw new Error('The owner must record the complete remaining balance.');
        return session.request(
          `/api/v1/admin/bookings/${encodeURIComponent(context.id)}/${actionPaths[kind]}`,
          AdminBookingMutationResponseSchema,
          { method: 'POST', body },
        );
      },
      {
        ...(kind !== 'resend-email'
          ? { authenticate: kind === 'cancel' ? 'Confirm booking cancellation' : 'Confirm financial action' }
          : {}),
        success:
          kind === 'cancel'
            ? 'The booking was cancelled. Any approved refund is processed separately by the payment provider.'
            : kind === 'refund'
              ? 'The refund was requested. Your payment provider will process it.'
              : kind === 'resend-email'
                ? 'The customer email was queued.'
                : kind === 'extra-charge'
                  ? 'The extra charge was added and its payment email was queued.'
                  : 'The offline payment was recorded.',
      },
    );
    if (result) {
      setCompleted(true);
      setPreview(null);
      await session.invalidate();
    }
  }
  async function reloadActions(): Promise<void> {
    const result = await action.run(() =>
      session.request(
        `/api/v1/admin/bookings/${encodeURIComponent(context.id)}/actions-context`,
        AdminBookingActionsContextSchema,
      ),
    );
    if (result) {
      reset(kind, result.version, result.balancePence);
      await session.invalidate();
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <AdminToolFeedback offline={session.offline} error={action.error} message={action.message} />
      <Card>
        <View style={{ gap: 10 }}>
          <Badge label={context.status} />
          <AppText>Total: {formatGBP(context.totalPence)}</AppText>
          <AppText>Received: {formatGBP(context.paidPence)}</AppText>
          <AppText>Refunded: {formatGBP(context.refundedPence)}</AppText>
          <AppText weight="bold">Remaining: {formatGBP(context.balancePence)}</AppText>
        </View>
      </Card>
      <SegmentedControl
        label="Booking action"
        sizing="content"
        value={kind}
        disabled={action.busy}
        onChange={reset}
        options={[
          { label: 'Send email', value: 'resend-email' },
          { label: 'Cancel booking', value: 'cancel' },
          { label: 'Refund payment', value: 'refund' },
          { label: 'Record payment', value: 'offline-payment' },
          { label: 'Extra charge', value: 'extra-charge' },
        ]}
      />
      {(changed && !completed) || stale ? (
        <AdminToolFeedback error="This booking has changed or could not be refreshed. Reload it before taking another action." />
      ) : null}
      {capability && !capability.allowed ? (
        <AppText accessibilityRole="alert">
          {capability.reason ?? 'This action is unavailable for this booking.'}
        </AppText>
      ) : null}
      {kind === 'offline-payment' && !session.owner ? (
        <AppText accessibilityRole="alert">Only the account owner can record an offline payment.</AppText>
      ) : null}
      {!completed ? (
        <Card>
          <View style={{ gap: 16 }}>
            {kind === 'resend-email' ? (
              <>
                <SegmentedControl
                  label="Customer email"
                  sizing="content"
                  disabled={disabled}
                  value={template}
                  onChange={setTemplate}
                  options={[
                    { label: 'Payment link', value: 'PAYMENT_LINK' },
                    { label: 'Confirmation', value: 'CONFIRMATION' },
                    { label: 'Manage booking', value: 'MANAGE_LINK' },
                  ]}
                />
                <AppText muted>The selected email will be sent to the booking’s customer address.</AppText>
              </>
            ) : null}
            {kind === 'cancel' ? (
              <>
                <SegmentedControl
                  label="Cancellation refund"
                  sizing="content"
                  disabled={disabled}
                  value={refundMode}
                  onChange={(value) => {
                    setRefundMode(value);
                    setPreview(null);
                  }}
                  options={[
                    { label: 'Policy', value: 'POLICY' },
                    { label: 'Full', value: 'FULL' },
                    { label: 'None', value: 'NONE' },
                    { label: 'Custom', value: 'CUSTOM' },
                  ]}
                />
                <ToggleField
                  label="Notify customer by email"
                  value={notify}
                  disabled={disabled}
                  onChange={(value) => {
                    setNotify(value);
                    setPreview(null);
                  }}
                />
              </>
            ) : null}
            {kind === 'refund' ? (
              <>
                <AppText weight="bold">Choose the original card payment</AppText>
                {eligiblePayments.length ? (
                  <SegmentedControl
                    label="Original payment"
                    sizing="content"
                    value={paymentId}
                    disabled={disabled}
                    onChange={setPaymentId}
                    options={eligiblePayments.map((payment) => ({
                      label: `${displayBookingCreatedAt(payment.createdAt)} · ${formatGBP(payment.refundablePence)} refundable`,
                      value: payment.id,
                    }))}
                  />
                ) : (
                  <AppText>No refundable card payments are available.</AppText>
                )}
              </>
            ) : null}
            {kind === 'refund' ||
            kind === 'extra-charge' ||
            kind === 'offline-payment' ||
            (kind === 'cancel' && refundMode === 'CUSTOM') ? (
              <TextField
                label="Amount in pounds"
                keyboardType="decimal-pad"
                value={amount}
                editable={!disabled && kind !== 'offline-payment'}
                onChangeText={(value) => {
                  setAmount(value);
                  setPreview(null);
                }}
              />
            ) : null}
            {kind === 'offline-payment' ? (
              <>
                <AppText muted>
                  Record the full outstanding balance only after payment has been received.
                </AppText>
                <TextField
                  label="Payment reference"
                  value={reference}
                  onChangeText={setReference}
                  editable={!disabled}
                  maxLength={120}
                />
                <TextField
                  label="Received at (ISO timestamp, for example 2026-11-03T14:30:00Z)"
                  value={paidAt}
                  onChangeText={setPaidAt}
                  editable={!disabled}
                  maxLength={30}
                />
              </>
            ) : null}
            {kind === 'cancel' || kind === 'refund' || kind === 'extra-charge' ? (
              <TextField
                label={kind === 'extra-charge' ? 'Charge description for customer' : 'Reason'}
                value={reason}
                onChangeText={(value) => {
                  setReason(value);
                  setPreview(null);
                }}
                multiline
                editable={!disabled}
                maxLength={kind === 'extra-charge' ? 200 : 500}
              />
            ) : null}
            {kind === 'cancel' ? (
              <>
                <Button
                  label="Preview cancellation"
                  tone="secondary"
                  disabled={disabled}
                  loading={action.busy}
                  onPress={() => {
                    void previewCancellation();
                  }}
                />
                {preview ? (
                  <Card tone="subtle">
                    <View style={{ gap: 10 }}>
                      <AppText weight="bold">Refund: {formatGBP(preview.refundPence)}</AppText>
                      <AppText>{preview.policySummary}</AppText>
                      <AppText>
                        {preview.willUnassignDriver
                          ? 'The driver assignment will be removed.'
                          : 'No driver assignment will be removed.'}
                      </AppText>
                      <AppText>This cancels the booking and releases its reserved slot.</AppText>
                      <Button
                        label="Confirm cancellation"
                        tone="danger"
                        disabled={disabled}
                        onPress={() => {
                          void submit();
                        }}
                      />
                    </View>
                  </Card>
                ) : null}
              </>
            ) : (
              <Button
                label={
                  kind === 'refund'
                    ? 'Confirm refund'
                    : kind === 'offline-payment'
                      ? 'Confirm received payment'
                      : kind === 'extra-charge'
                        ? 'Add charge and send payment email'
                        : 'Send customer email'
                }
                disabled={disabled}
                loading={action.busy}
                onPress={() => {
                  void submit();
                }}
              />
            )}
          </View>
        </Card>
      ) : null}
      <Button
        label="Reload booking actions"
        tone="secondary"
        disabled={!session.enabled || action.busy}
        onPress={() => {
          void reloadActions();
        }}
      />
    </View>
  );
}
