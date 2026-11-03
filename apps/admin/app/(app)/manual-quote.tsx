import {
  AdminManualQuoteDeclineRequestSchema,
  AdminManualQuoteDetailSchema,
  AdminManualQuoteMutationResponseSchema,
  AdminManualQuotePriceRequestSchema,
  formatGBP,
  type AdminManualQuoteDetail,
} from '@sv/contracts';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { AppText, Badge, Button, Card, TextField, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { penceToInput, poundsToPence, todayInLondon } from '@/data/admin-tool-forms';
import { useAdminToolSession, type AdminToolSession } from '@/data/admin-tool-session';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';
import { displayAdminDate, serviceLabel, slotLabel } from '@/data/operations';

export default function ManualQuoteScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const session = useAdminToolSession();
  const [epoch, setEpoch] = useState(0);
  const query = useQuery({
    ...session.queryOptions,
    enabled: session.enabled && Boolean(id),
    queryKey: ['admin', session.actorId, 'manual-quote', id],
    queryFn: ({ signal }) =>
      session.request(`/api/v1/admin/manual-quotes/${encodeURIComponent(id)}`, AdminManualQuoteDetailSchema, {
        signal,
      }),
  });
  return (
    <ScreenState
      title="Quote request"
      status={
        !id
          ? 'error'
          : !session.privateReady || (query.isPending && !session.offline)
            ? 'loading'
            : query.data
              ? 'ready'
              : 'error'
      }
      errorMessage="The quote request could not be loaded. Check your connection and retry."
      onRetry={() => {
        void query.refetch();
      }}
      toolbar={
        <Button
          label="Back to quote requests"
          tone="secondary"
          onPress={() => {
            router.replace('/(app)/manual-quotes');
          }}
        />
      }
    >
      {query.data && session.privateReady ? (
        <QuoteWorkspace
          key={`${session.actorId ?? ''}:${id}:${String(epoch)}`}
          item={query.data}
          session={session}
          reload={async () => {
            const revision = session.revision;
            const refreshed = await query.refetch();
            if (refreshed.data && !refreshed.isError && session.isCurrent(revision))
              setEpoch((value) => value + 1);
          }}
          stale={query.isError}
        />
      ) : null}
    </ScreenState>
  );
}

function QuoteWorkspace({
  item,
  session,
  reload,
  stale,
}: {
  item: AdminManualQuoteDetail;
  session: AdminToolSession;
  reload: () => Promise<unknown>;
  stale: boolean;
}): React.ReactElement {
  const action = useAdminToolAction(session);
  const [price, setPrice] = useState(item.pricePence === null ? '' : penceToInput(item.pricePence));
  const [date, setDate] = useState(item.preferredDate ?? todayInLondon());
  const [slot, setSlot] = useState<'MORNING' | 'AFTERNOON' | 'EVENING'>(item.preferredSlot ?? 'MORNING');
  const [hours, setHours] = useState('48');
  const [message, setMessage] = useState('');
  const [snapshot] = useState(item.updatedAt);
  const [completed, setCompleted] = useState(false);
  const changed = item.updatedAt !== snapshot;
  const allowed = item.status === 'REQUESTED' || item.status === 'PRICED';
  const disabled =
    !session.enabled || action.busy || action.needsReload || completed || stale || changed || !allowed;
  async function submit(mode: 'price' | 'decline'): Promise<void> {
    if (disabled) return;
    const result = await action.run(
      async () => {
        const body =
          mode === 'price'
            ? AdminManualQuotePriceRequestSchema.parse({
                expectedUpdatedAt: snapshot,
                pricePence: poundsToPence(price),
                date,
                slot,
                message,
                validForHours: Number(hours),
              })
            : AdminManualQuoteDeclineRequestSchema.parse({ expectedUpdatedAt: snapshot, message });
        return session.request(
          `/api/v1/admin/manual-quotes/${encodeURIComponent(item.id)}/${mode}`,
          AdminManualQuoteMutationResponseSchema,
          { method: 'POST', body },
        );
      },
      {
        authenticate: mode === 'price' ? 'Confirm manual quote price' : 'Confirm declining this quote',
        success:
          mode === 'price'
            ? 'The price was saved and the customer email was queued.'
            : 'The request was declined and the customer email was queued.',
      },
    );
    if (result) {
      setCompleted(true);
      await session.invalidate();
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <AdminToolFeedback offline={session.offline} error={action.error} message={action.message} />
      <Card>
        <View style={{ gap: 12 }}>
          <Badge label={item.status} />
          <AppText size="lg" weight="bold">
            {item.contact.name}
          </AppText>
          <AppText>{item.contact.email}</AppText>
          <AppText>{item.contact.phone}</AppText>
          <AppText>
            {serviceLabel(item.service)} · {item.variant}
          </AppText>
          <AppText>
            {item.pickupLabel}
            {item.dropoffLabel ? ` → ${item.dropoffLabel}` : ''}
          </AppText>
          {item.preferredDate ? (
            <AppText>
              Requested {displayAdminDate(item.preferredDate)}
              {item.preferredSlot ? ` · ${slotLabel(item.preferredSlot)}` : ''}
            </AppText>
          ) : null}
          {item.details ? <AppText>{item.details}</AppText> : null}
          {item.reasons.map((reason) => (
            <AppText muted key={reason}>
              {reason}
            </AppText>
          ))}
          <AppText muted>Received {displayBookingCreatedAt(item.createdAt)}</AppText>
          {item.pricePence !== null ? <AppText>Current price: {formatGBP(item.pricePence)}</AppText> : null}
          {item.validUntil ? (
            <AppText muted>Offer expires {displayBookingCreatedAt(item.validUntil)}</AppText>
          ) : null}
          {item.bookingId ? (
            <Button
              label="Open booking"
              onPress={() => {
                router.push(`/(app)/bookings/${encodeURIComponent(item.bookingId ?? '')}`);
              }}
            />
          ) : null}
        </View>
      </Card>
      <QuoteMoveSummary item={item} />
      {(changed && !completed) || stale ? (
        <AdminToolFeedback error="This request has changed or could not be refreshed. Return to the list and reopen it before submitting." />
      ) : null}
      {allowed && !completed ? (
        <Card>
          <View style={{ gap: 16 }}>
            <AppText size="lg" weight="bold">
              Price or decline
            </AppText>
            <TextField
              label="Price in pounds"
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              editable={!disabled}
            />
            <TextField
              label="Move date (YYYY-MM-DD)"
              value={date}
              onChangeText={setDate}
              editable={!disabled}
              maxLength={10}
            />
            <SegmentedControl
              label="Move slot"
              sizing="content"
              value={slot}
              onChange={setSlot}
              disabled={disabled}
              options={[
                { label: 'Morning', value: 'MORNING' },
                { label: 'Afternoon', value: 'AFTERNOON' },
                { label: 'Evening', value: 'EVENING' },
              ]}
            />
            <TextField
              label="Offer valid for hours (1–720)"
              value={hours}
              onChangeText={setHours}
              keyboardType="number-pad"
              editable={!disabled}
            />
            <TextField
              label="Message to customer"
              multiline
              value={message}
              onChangeText={setMessage}
              maxLength={1000}
              editable={!disabled}
            />
            <AppText muted size="sm">
              Submitting sends an email to the customer. Pricing creates an offer they can accept and pay.
            </AppText>
            <Button
              label="Save price and email offer"
              disabled={disabled}
              loading={action.busy}
              onPress={() => {
                void submit('price');
              }}
            />
            <Button
              label="Decline and email customer"
              tone="danger"
              disabled={disabled || !message.trim()}
              onPress={() => {
                void submit('decline');
              }}
            />
          </View>
        </Card>
      ) : null}
      <Button
        label="Reload latest request"
        tone="secondary"
        disabled={!session.enabled || action.busy}
        onPress={() => {
          void action.run(reload);
        }}
      />
    </View>
  );
}

function QuoteMoveSummary({ item }: { item: AdminManualQuoteDetail }): React.ReactElement {
  const input = item.pricingInput;
  const access = item.accessDetail;
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <AppText size="lg" weight="bold">
          Move details
        </AppText>
        <AppText>
          {item.distanceMiles} miles · {item.durationMinutes} minutes
        </AppText>
        {input ? (
          <>
            <AppText weight="bold">Items</AppText>
            {input.inventory.length ? (
              input.inventory.map((line, index) => (
                <AppText key={`${line.itemId}:${String(index)}`}>
                  {line.quantity} × {line.name} · {line.unitVolumeM3} m³ each
                </AppText>
              ))
            ) : (
              <AppText muted>No items were listed.</AppText>
            )}
            <AppText>Additional helpers: {input.addons.helpers}</AppText>
            <AppText>
              Packing: {input.addons.packing ? 'Yes' : 'No'} · Assembly:{' '}
              {input.addons.assembly ? 'Yes' : 'No'}
            </AppText>
          </>
        ) : (
          <AppText muted>
            Detailed items are unavailable for this older request. Confirm them with the customer before
            pricing.
          </AppText>
        )}
        {access ? (
          (['pickup', 'dropoff'] as const).map((side) => {
            const details = access[side];
            return details ? (
              <View key={side} style={{ gap: 4 }}>
                <AppText weight="bold">{side === 'pickup' ? 'Pickup access' : 'Delivery access'}</AppText>
                <AppText>
                  {details.floorChoice === 'BASEMENT'
                    ? 'Basement'
                    : details.floorChoice === 'GROUND'
                      ? 'Ground floor'
                      : `Floor ${String(details.floorNumber ?? '')}`}{' '}
                  · Lift: {details.hasLift ? 'Yes' : 'No'}
                </AppText>
                <AppText>
                  Carry: {details.carryMetres} m · Narrow access: {details.narrowAccess ? 'Yes' : 'No'} ·
                  Permit: {details.permitZone ? 'Yes' : 'No'}
                </AppText>
                {details.notes ? <AppText>{details.notes}</AppText> : null}
              </View>
            ) : null;
          })
        ) : (
          <AppText muted>Per-address access details are unavailable. Confirm access before pricing.</AppText>
        )}
      </View>
    </Card>
  );
}
