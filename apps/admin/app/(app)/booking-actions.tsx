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
  addDays,
  formatGBP,
  londonToday,
  type AdminBookingActionsContext,
  type AdminCancelPreviewResponse,
  type BookingStatus,
} from '@sv/contracts';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { ToggleField } from '@/components/booking-edit-fields';
import { ChipChoices, ChoiceList, type ChoiceOption } from '@/components/choice-list';
import { AppText, Badge, Button, Card, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { penceToInput, poundsToPence } from '@/data/admin-tool-forms';
import { useAdminToolSession, type AdminToolSession } from '@/data/admin-tool-session';
import { bookingStatusLabel } from '@/data/operations';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';

type ActionKind = 'cancel' | 'refund' | 'offline-payment' | 'extra-charge' | 'resend-email';
type RefundMode = 'POLICY' | 'FULL' | 'NONE' | 'CUSTOM';
type EmailTemplate = 'CONFIRMATION' | 'PAYMENT_LINK' | 'MANAGE_LINK';

const actionPaths: Record<ActionKind, string> = {
  cancel: 'cancel',
  refund: 'refunds',
  'offline-payment': 'payments/offline',
  'extra-charge': 'extra-charges',
  'resend-email': 'resend-email',
};

const actionChoices: readonly ChoiceOption<ActionKind>[] = [
  {
    value: 'resend-email',
    title: 'Email the customer',
    description: 'Send a payment link, their booking confirmation or a link to manage the booking.',
  },
  {
    value: 'offline-payment',
    title: 'Record cash or bank transfer',
    description: 'The customer paid you directly. Only the owner can do this.',
  },
  {
    value: 'extra-charge',
    title: 'Add an extra charge',
    description: 'The customer is emailed a link to pay it.',
  },
  {
    value: 'refund',
    title: 'Refund a card payment',
    description: 'Send money back to the customer’s card.',
  },
  {
    value: 'cancel',
    title: 'Cancel this booking',
    description: 'You will see exactly what happens before anything is changed.',
  },
];

const emailChoices: readonly ChoiceOption<EmailTemplate>[] = [
  { value: 'PAYMENT_LINK', title: 'Payment link', description: 'Asks the customer to pay what they still owe.' },
  { value: 'CONFIRMATION', title: 'Booking confirmation', description: 'Sends their booking details again.' },
  {
    value: 'MANAGE_LINK',
    title: 'Manage booking link',
    description: 'Lets them view or change their booking online.',
  },
];

const successMessages: Record<ActionKind, string> = {
  cancel: 'Done. The booking is cancelled. Any refund will reach the customer’s card in a few working days.',
  refund: 'Done. The refund is on its way. It usually reaches the customer’s card in a few working days.',
  'resend-email': 'Done. The email is on its way to the customer.',
  'extra-charge': 'Done. The charge was added and the customer has been emailed a link to pay it.',
  'offline-payment': 'Done. The payment is saved on this booking.',
};

function defaultRefundMode(context: Pick<AdminBookingActionsContext, 'paidPence' | 'refundedPence'>): RefundMode {
  return context.paidPence === context.refundedPence ? 'NONE' : 'POLICY';
}

function statusTone(status: BookingStatus): 'danger' | 'neutral' | 'success' | 'warning' {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'PENDING_PAYMENT') return 'warning';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'danger';
  return 'neutral';
}

/** The last seven London days, newest first, labelled the way people say them. */
function recentDays(now: Date): { value: string; label: string }[] {
  const today = londonToday(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, -index);
    const label =
      index === 0
        ? 'Today'
        : index === 1
          ? 'Yesterday'
          : new Intl.DateTimeFormat('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'Europe/London',
            }).format(new Date(`${date}T12:00:00Z`));
    return { value: date, label };
  });
}

/** Today means "just now"; an earlier day is recorded at midday on that day. */
function paidAtFor(day: string, now: Date): string {
  return day === londonToday(now) ? now.toISOString() : new Date(`${day}T12:00:00Z`).toISOString();
}

function amountOrNull(value: string): number | null {
  try {
    return poundsToPence(value);
  } catch {
    // Not a complete amount yet while the person is still typing; the label simply stays generic.
    return null;
  }
}

export default function BookingActionsScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string; action?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const direct = params.action === 'cancel';
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
      title={direct ? 'Cancel booking' : 'Payments and emails'}
      subtitle={
        direct
          ? 'Choose the refund, check the summary, then confirm.'
          : 'Take a payment, give a refund, add a charge or email the customer.'
      }
      status={
        !id
          ? 'error'
          : !session.privateReady || (query.isPending && !session.offline)
            ? 'loading'
            : query.data
              ? 'ready'
              : 'error'
      }
      errorMessage="We couldn’t open this booking. Check your internet connection and try again."
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
          key={`${session.actorId ?? ''}:${id}:${direct ? 'cancel' : 'menu'}`}
          context={query.data}
          direct={direct}
          session={session}
          stale={query.isError}
        />
      ) : null}
    </ScreenState>
  );
}

function MoneyRow(props: { label: string; pence: number; strong?: boolean }): React.ReactElement {
  return (
    <View style={styles.moneyRow}>
      <AppText {...(props.strong ? { weight: 'bold' as const } : { muted: true })}>{props.label}</AppText>
      <AppText numeric {...(props.strong ? { weight: 'bold' as const } : {})}>
        {formatGBP(props.pence)}
      </AppText>
    </View>
  );
}

function ActionsWorkspace({
  context,
  direct,
  session,
  stale,
}: {
  context: AdminBookingActionsContext;
  direct: boolean;
  session: AdminToolSession;
  stale: boolean;
}): React.ReactElement {
  const action = useAdminToolAction(session);
  const [kind, setKind] = useState<ActionKind | null>(direct ? 'cancel' : null);
  const [version, setVersion] = useState(context.version);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [paidDay, setPaidDay] = useState(() => londonToday(new Date()));
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [refundMode, setRefundMode] = useState<RefundMode>(defaultRefundMode(context));
  const [notify, setNotify] = useState(true);
  const [template, setTemplate] = useState<EmailTemplate>('PAYMENT_LINK');
  const [preview, setPreview] = useState<AdminCancelPreviewResponse | null>(null);
  const [completed, setCompleted] = useState(false);
  const netPaidPence = context.paidPence - context.refundedPence;
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
  const typedPence = amountOrNull(amount);

  function reset(next: ActionKind | null, latest: AdminBookingActionsContext = context): void {
    if (action.busy) return;
    setKind(next);
    setVersion(latest.version);
    setReason('');
    setAmount(next === 'offline-payment' ? penceToInput(latest.balancePence) : '');
    setReference('');
    setPaidDay(londonToday(new Date()));
    setPaymentId(null);
    setRefundMode(defaultRefundMode(latest));
    setNotify(true);
    setTemplate('PAYMENT_LINK');
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
    if (!kind || disabled || (kind === 'cancel' && !preview)) return;
    const result = await action.run(
      async () => {
        const expectedVersion = version;
        const body =
          kind === 'cancel'
            ? AdminCancelApplySchema.parse({ ...cancellation(), expectedRefundPence: preview?.refundPence })
            : kind === 'refund'
              ? AdminPaymentRefundRequestSchema.parse({
                  expectedVersion,
                  paymentId: paymentId ?? '',
                  amountPence: poundsToPence(amount),
                  reason,
                })
              : kind === 'offline-payment'
                ? AdminOfflinePaymentRequestSchema.parse({
                    expectedVersion,
                    amountPence: poundsToPence(amount),
                    reference,
                    paidAt: paidAtFor(paidDay, new Date()),
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
          if (!payment) throw new Error('Choose which card payment to refund.');
          if (poundsToPence(amount) > payment.refundablePence)
            throw new Error(`You can refund up to ${formatGBP(payment.refundablePence)} from this payment.`);
        }
        if (kind === 'offline-payment' && (!session.owner || poundsToPence(amount) !== context.balancePence))
          throw new Error('Only the owner can record a payment, and it must be the full amount still owed.');
        return session.request(
          `/api/v1/admin/bookings/${encodeURIComponent(context.id)}/${actionPaths[kind]}`,
          AdminBookingMutationResponseSchema,
          { method: 'POST', body },
        );
      },
      {
        ...(kind !== 'resend-email'
          ? { authenticate: kind === 'cancel' ? 'Confirm booking cancellation' : 'Confirm this payment change' }
          : {}),
        success: successMessages[kind],
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
      reset(kind, result);
      await session.invalidate();
    }
  }
  const clearPreview = (): void => {
    setPreview(null);
  };

  return (
    <View style={styles.stack}>
      <AdminToolFeedback offline={session.offline} error={action.error} message={action.message} />
      <Card>
        <View style={styles.cardStack}>
          <View style={styles.moneyRow}>
            <AppText weight="bold">Booking</AppText>
            <Badge label={bookingStatusLabel(context.status)} tone={statusTone(context.status)} />
          </View>
          <MoneyRow label="Booking total" pence={context.totalPence} />
          <MoneyRow label="Paid so far" pence={context.paidPence} />
          {context.refundedPence > 0 ? <MoneyRow label="Refunded" pence={context.refundedPence} /> : null}
          <MoneyRow label="Still to pay" pence={context.balancePence} strong />
        </View>
      </Card>

      {(changed && !completed) || stale || action.needsReload ? (
        <Card tone="subtle">
          <View style={styles.cardStack}>
            <AppText accessibilityRole="alert" weight="bold">
              This booking has just changed.
            </AppText>
            <AppText>Tap Refresh to see the latest details before you carry on.</AppText>
            <Button
              label="Refresh"
              disabled={!session.enabled || action.busy}
              onPress={() => {
                void reloadActions();
              }}
            />
          </View>
        </Card>
      ) : null}

      {completed ? (
        <View style={styles.cardStack}>
          <Button
            label="Back to booking"
            onPress={() => {
              router.replace(`/(app)/bookings/${encodeURIComponent(context.id)}`);
            }}
          />
          {!direct ? (
            <Button
              label="Do something else"
              tone="secondary"
              onPress={() => {
                void reloadActions().then(() => {
                  setKind(null);
                });
              }}
            />
          ) : null}
        </View>
      ) : null}

      {!completed && !direct ? (
        <View style={styles.cardStack}>
          <AppText size="lg" weight="bold" accessibilityRole="header">
            What would you like to do?
          </AppText>
          <ChoiceList
            label="What would you like to do?"
            options={actionChoices}
            value={kind}
            disabled={action.busy}
            onChange={(next) => {
              reset(next);
            }}
          />
        </View>
      ) : null}

      {kind && !completed && capability && !capability.allowed ? (
        <Card tone="subtle">
          <AppText accessibilityRole="alert">
            {capability.reason ?? 'This can’t be done for this booking right now.'}
          </AppText>
        </Card>
      ) : null}
      {kind === 'offline-payment' && !completed && !session.owner && capability?.allowed ? (
        <Card tone="subtle">
          <AppText accessibilityRole="alert">Only the owner can record a cash or bank payment.</AppText>
        </Card>
      ) : null}

      {kind && !completed ? (
        <Card>
          <View style={styles.form}>
            {kind === 'resend-email' ? (
              <>
                <AppText weight="bold">Which email should we send?</AppText>
                <ChoiceList
                  label="Which email should we send?"
                  options={emailChoices}
                  value={template}
                  disabled={disabled}
                  onChange={(value) => {
                    setTemplate(value);
                  }}
                />
                <AppText muted size="sm">
                  It goes to the email address on this booking.
                </AppText>
                <Button
                  label="Send email"
                  disabled={disabled}
                  loading={action.busy}
                  onPress={() => {
                    void submit();
                  }}
                />
              </>
            ) : null}

            {kind === 'cancel' ? (
              <>
                {netPaidPence > 0 ? (
                  <>
                    <AppText weight="bold">How much should the customer get back?</AppText>
                    <ChoiceList
                      label="How much should the customer get back?"
                      disabled={disabled}
                      value={refundMode}
                      onChange={(value) => {
                        setRefundMode(value);
                        clearPreview();
                      }}
                      options={[
                        {
                          value: 'POLICY',
                          title: 'Follow our cancellation policy',
                          description: 'The amount depends on how close the move is. You’ll see it before confirming.',
                        },
                        {
                          value: 'FULL',
                          title: `Refund everything (${formatGBP(netPaidPence)})`,
                          description: 'Give back all the money they paid.',
                        },
                        { value: 'NONE', title: 'No refund', description: 'Keep the money that was paid.' },
                        { value: 'CUSTOM', title: 'Choose an amount', description: 'Type how much to give back.' },
                      ]}
                    />
                    {refundMode === 'CUSTOM' ? (
                      <TextField
                        label="Amount to give back (£)"
                        hint={`Up to ${formatGBP(netPaidPence)}.`}
                        keyboardType="decimal-pad"
                        value={amount}
                        editable={!disabled}
                        onChangeText={(value) => {
                          setAmount(value);
                          clearPreview();
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <AppText>The customer hasn’t paid anything, so there is nothing to refund.</AppText>
                )}
                <TextField
                  label="Why is it being cancelled?"
                  hint="Kept on the booking for your records."
                  value={reason}
                  onChangeText={(value) => {
                    setReason(value);
                    clearPreview();
                  }}
                  multiline
                  editable={!disabled}
                  maxLength={500}
                />
                <ToggleField
                  label="Email the customer to say it’s cancelled"
                  value={notify}
                  disabled={disabled}
                  onChange={(value) => {
                    setNotify(value);
                    clearPreview();
                  }}
                />
                {preview ? (
                  <Card tone="subtle">
                    <View style={styles.cardStack}>
                      <AppText size="lg" weight="bold" accessibilityRole="header">
                        Check before you cancel
                      </AppText>
                      <AppText>• The booking will be cancelled and its time slot freed up.</AppText>
                      <AppText weight="bold">
                        {preview.refundPence > 0
                          ? `• The customer gets ${formatGBP(preview.refundPence)} back.`
                          : '• No money will be refunded.'}
                      </AppText>
                      {refundMode === 'POLICY' && preview.paidNetPence > 0 ? (
                        <AppText muted size="sm">
                          {`Our policy gives back ${String(Math.round((preview.refundPence / preview.paidNetPence) * 100))}% of what they paid.`}
                        </AppText>
                      ) : null}
                      {preview.willUnassignDriver ? (
                        <AppText>• The driver will be taken off this job.</AppText>
                      ) : null}
                      <AppText>
                        {notify ? '• The customer will get an email.' : '• The customer will not be emailed.'}
                      </AppText>
                      <Button
                        label="Yes, cancel this booking"
                        tone="danger"
                        disabled={disabled}
                        loading={action.busy}
                        onPress={() => {
                          void submit();
                        }}
                      />
                      <Button label="Go back" tone="secondary" disabled={action.busy} onPress={clearPreview} />
                    </View>
                  </Card>
                ) : (
                  <Button
                    label="Continue"
                    disabled={disabled}
                    loading={action.busy}
                    onPress={() => {
                      void previewCancellation();
                    }}
                  />
                )}
              </>
            ) : null}

            {kind === 'refund' ? (
              <>
                <AppText weight="bold">Which payment do you want to refund?</AppText>
                {eligiblePayments.length ? (
                  <ChoiceList
                    label="Which payment do you want to refund?"
                    value={paymentId}
                    disabled={disabled}
                    onChange={setPaymentId}
                    options={eligiblePayments.map((payment) => ({
                      value: payment.id,
                      title: `Card payment, ${displayBookingCreatedAt(payment.createdAt)}`,
                      description: `Up to ${formatGBP(payment.refundablePence)} can be refunded.`,
                    }))}
                  />
                ) : (
                  <AppText>There are no card payments that can be refunded.</AppText>
                )}
                <TextField
                  label="Amount to refund (£)"
                  keyboardType="decimal-pad"
                  value={amount}
                  editable={!disabled}
                  onChangeText={setAmount}
                />
                <TextField
                  label="Why are you refunding?"
                  hint="Kept on the booking for your records."
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  editable={!disabled}
                  maxLength={500}
                />
                <Button
                  label={typedPence ? `Refund ${formatGBP(typedPence)}` : 'Refund'}
                  disabled={disabled}
                  loading={action.busy}
                  onPress={() => {
                    void submit();
                  }}
                />
              </>
            ) : null}

            {kind === 'offline-payment' ? (
              <>
                <AppText>Use this when the customer paid you in cash or by bank transfer.</AppText>
                <Card tone="subtle">
                  <View style={styles.moneyRow}>
                    <AppText weight="bold">Amount received</AppText>
                    <AppText numeric weight="bold">
                      {formatGBP(context.balancePence)}
                    </AppText>
                  </View>
                  <AppText muted size="sm">
                    This is everything they still owe. Only record it once you have all of it.
                  </AppText>
                </Card>
                <TextField
                  label="How did they pay?"
                  hint="For example: cash to the driver, or the bank transfer reference."
                  value={reference}
                  onChangeText={setReference}
                  editable={!disabled}
                  maxLength={120}
                />
                <AppText weight="bold">When did you get it?</AppText>
                <ChipChoices
                  label="When did you get it?"
                  options={recentDays(new Date())}
                  value={paidDay}
                  disabled={disabled}
                  onChange={setPaidDay}
                />
                <Button
                  label="Save payment"
                  disabled={disabled}
                  loading={action.busy}
                  onPress={() => {
                    void submit();
                  }}
                />
              </>
            ) : null}

            {kind === 'extra-charge' ? (
              <>
                <TextField
                  label="Amount (£)"
                  keyboardType="decimal-pad"
                  value={amount}
                  editable={!disabled}
                  onChangeText={setAmount}
                />
                <TextField
                  label="What is it for?"
                  hint="The customer will see this in their email."
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  editable={!disabled}
                  maxLength={200}
                />
                <Button
                  label="Add charge and email the customer"
                  disabled={disabled}
                  loading={action.busy}
                  onPress={() => {
                    void submit();
                  }}
                />
              </>
            ) : null}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 20 },
  cardStack: { gap: 10 },
  form: { gap: 16 },
  moneyRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
});
