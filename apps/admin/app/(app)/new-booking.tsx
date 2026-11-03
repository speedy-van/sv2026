import {
  AdminBookingCreateContextSchema,
  AdminPhoneBookingCreateSchema,
  AdminPhoneBookingResponseSchema,
  AdminQuoteResponseSchema,
  CatalogueResponseSchema,
  ContactSchema,
  ManualQuoteRequestResponseSchema,
  ManualQuoteRequestSchema,
  PostcodeLookupResponseSchema,
  QuoteRequestSchema,
  UkPostcodeSchema,
  formatGBP,
} from '@sv/contracts';
import { useQuery } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import type { z } from 'zod';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import {
  BookingAccessFields,
  BookingAddressFields,
  BookingExtrasFields,
  BookingItemsFields,
} from '@/components/booking-edit-fields';
import { AppText, Button, Card, TextField, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { useAdminToolSession, type AdminToolSession } from '@/data/admin-tool-session';
import { displayAdminDate, slotLabel } from '@/data/operations';

type CreateContext = z.infer<typeof AdminBookingCreateContextSchema>;
type Catalogue = z.infer<typeof CatalogueResponseSchema>;
type QuoteResult = z.infer<typeof AdminQuoteResponseSchema>;
type CreatedBooking = z.infer<typeof AdminPhoneBookingResponseSchema>;
type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
type Address = QuoteRequest['pickup'];
const emptyAccess: QuoteRequest['pickupAccess'] = {
  floorChoice: 'GROUND',
  hasLift: false,
  carryMetres: 0,
  narrowAccess: false,
  permitZone: false,
};
export default function NewPhoneBookingScreen(): React.ReactElement {
  const session = useAdminToolSession();
  const context = useQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'booking-create-context'],
    queryFn: ({ signal }) =>
      session.request('/api/v1/admin/bookings/create-context', AdminBookingCreateContextSchema, { signal }),
  });
  const catalogue = useQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'booking-create-catalogue'],
    queryFn: ({ signal }) => session.request('/api/v1/catalogue', CatalogueResponseSchema, { signal }),
  });
  const loaded = context.data && catalogue.data;
  return (
    <ScreenState
      title="New phone booking"
      subtitle="Quote the move, choose a slot and record the customer’s details."
      status={
        !session.privateReady || ((context.isPending || catalogue.isPending) && !session.offline)
          ? 'loading'
          : loaded
            ? 'ready'
            : 'error'
      }
      errorMessage="The booking form could not be loaded. Check your connection and retry."
      onRetry={() => {
        void Promise.all([context.refetch(), catalogue.refetch()]);
      }}
      toolbar={
        <Button
          label="Back to bookings"
          tone="secondary"
          onPress={() => {
            router.replace('/(app)/bookings');
          }}
        />
      }
    >
      {context.data && catalogue.data && session.privateReady ? (
        <PhoneBookingWizard
          key={session.actorId}
          session={session}
          context={context.data}
          catalogue={catalogue.data}
          stale={context.isError || catalogue.isError}
        />
      ) : null}
    </ScreenState>
  );
}

function PhoneBookingWizard({
  session,
  context,
  catalogue,
  stale,
}: {
  session: AdminToolSession;
  context: CreateContext;
  catalogue: Catalogue;
  stale: boolean;
}): React.ReactElement {
  const action = useAdminToolAction(session);
  const [step, setStep] = useState(0);
  const [service, setService] = useState<QuoteRequest['service']>(context.services[0]?.key ?? 'man-and-van');
  const serviceConfig = context.services.find((item) => item.key === service);
  const [variant, setVariant] = useState(context.services[0]?.variants[0]?.key ?? '');
  const [pickup, setPickup] = useState<Address | null>(null);
  const [dropoff, setDropoff] = useState<Address | null>(null);
  const [pickupValid, setPickupValid] = useState(false);
  const [dropoffValid, setDropoffValid] = useState(false);
  const [pickupAccess, setPickupAccess] = useState<QuoteRequest['pickupAccess']>({ ...emptyAccess });
  const [dropoffAccess, setDropoffAccess] = useState<QuoteRequest['pickupAccess']>({ ...emptyAccess });
  const [items, setItems] = useState<QuoteRequest['items']>([]);
  const [addons, setAddons] = useState<QuoteRequest['addons']>({
    helpers: 0,
    packing: false,
    assembly: false,
  });
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<'MORNING' | 'AFTERNOON' | 'EVENING'>('MORNING');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<'LINK' | 'OFFLINE'>('LINK');
  const [reference, setReference] = useState('');
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [manualReference, setManualReference] = useState<string | null>(null);
  const creationKey = useRef(uuid.v4());
  const submittedPayload = useRef<string | null>(null);
  const requiresDropoff = serviceConfig?.requiresDropoff ?? true;
  const disabled =
    !session.enabled ||
    action.busy ||
    stale ||
    !context.ready ||
    !serviceConfig ||
    Boolean(created || manualReference);
  const standardQuote = quote && 'quote' in quote ? quote.quote : null;
  const manualQuote = quote && 'manualQuote' in quote ? quote.manualQuote : null;
  const selectedDay = standardQuote?.calendar.find((day) => day.date === date);
  const selectedSlot = selectedDay?.slots.find((item) => item.slot === slot && item.available);
  function change(): void {
    setQuote(null);
    action.clear();
  }
  async function lookup(postcode: string): Promise<z.infer<typeof PostcodeLookupResponseSchema>> {
    const normalized = UkPostcodeSchema.parse(postcode);
    const result = await session.request(
      `/api/v1/address/postcode/${encodeURIComponent(normalized)}`,
      PostcodeLookupResponseSchema,
    );
    if (result.postcode !== normalized)
      throw new Error('The returned postcode did not match the requested address.');
    return result;
  }
  async function requestQuote(): Promise<void> {
    if (disabled) return;
    const result = await action.run(async () => {
      if (!pickupValid || (requiresDropoff && !dropoffValid))
        throw new Error('Choose a verified pickup and delivery address before requesting a quote.');
      const body = QuoteRequestSchema.parse({
        service,
        variant,
        pickup,
        dropoff: requiresDropoff ? dropoff : null,
        pickupAccess,
        dropoffAccess: requiresDropoff ? dropoffAccess : null,
        items,
        addons,
      });
      return session.request('/api/v1/admin/quotes', AdminQuoteResponseSchema, { method: 'POST', body });
    });
    if (result) {
      setQuote(result);
      if ('quote' in result) {
        const first =
          result.quote.cheapest ??
          result.quote.calendar.flatMap((day) =>
            day.slots.filter((item) => item.available).map((item) => ({ date: day.date, slot: item.slot })),
          )[0];
        if (first) {
          setDate(first.date);
          setSlot(first.slot);
        }
      }
      setStep(3);
    }
  }
  async function submit(): Promise<void> {
    if (disabled || !quote) return;
    const result = await action.run<CreatedBooking | { reference: string }>(
      async () => {
        const contact = ContactSchema.parse({ name, email, phone });
        if (manualQuote) {
          const body = ManualQuoteRequestSchema.parse({ contact, ...(notes ? { details: notes } : {}) });
          return session.request(
            `/api/v1/quotes/${encodeURIComponent(manualQuote.quotePublicId)}/manual-request`,
            ManualQuoteRequestResponseSchema,
            { method: 'POST', body },
          );
        }
        if (!standardQuote || !selectedSlot) throw new Error('Choose an available date and slot.');
        if (Date.parse(standardQuote.expiresAt) <= Date.now())
          throw new Error('This quote has expired. Go back and request a new quote.');
        if (payment === 'OFFLINE' && !session.owner)
          throw new Error('Only the account owner can record an offline payment.');
        const payload = {
          quotePublicId: standardQuote.publicId,
          date,
          slot,
          contact,
          expectedTotalPence: selectedSlot.pricePence,
          payment: payment === 'OFFLINE' ? { mode: payment, reference } : { mode: payment },
          ...(notes ? { notes } : {}),
        };
        const identity = JSON.stringify(payload);
        if (submittedPayload.current !== null && submittedPayload.current !== identity)
          creationKey.current = uuid.v4();
        submittedPayload.current = identity;
        const body = AdminPhoneBookingCreateSchema.parse({ ...payload, idempotencyKey: creationKey.current });
        return session.request('/api/v1/admin/bookings', AdminPhoneBookingResponseSchema, {
          method: 'POST',
          body,
        });
      },
      {
        ...(payment === 'OFFLINE' && !manualQuote
          ? { authenticate: 'Confirm received payment and create booking' }
          : {}),
      },
    );
    if (result) {
      if ('id' in result) setCreated(result);
      else setManualReference(result.reference);
      await session.invalidate();
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <AdminToolFeedback offline={session.offline} error={action.error} />
      {!context.ready ? (
        <AppText accessibilityRole="alert">
          {context.reason ?? 'Booking creation is temporarily unavailable.'}
        </AppText>
      ) : null}
      {stale ? (
        <AppText accessibilityRole="alert">
          The latest booking options could not be refreshed. Reopen this form before submitting.
        </AppText>
      ) : null}
      {created ? (
        <Card>
          <View style={{ gap: 16 }}>
            <AppText size="lg" weight="bold">
              Booking {created.reference} created
            </AppText>
            <AppText>
              {created.status === 'PENDING_PAYMENT'
                ? 'Waiting for customer payment.'
                : 'Payment has been recorded.'}
            </AppText>
            <AppText>Total: {formatGBP(created.totalPence)}</AppText>
            <Button
              label="Open created booking"
              onPress={() => {
                router.replace(`/(app)/bookings/${encodeURIComponent(created.id)}`);
              }}
            />
            {created.paymentUrl ? (
              <Button
                label="Open customer payment page"
                tone="secondary"
                onPress={() => {
                  void action.run(() => Linking.openURL(created.paymentUrl ?? ''));
                }}
              />
            ) : null}
          </View>
        </Card>
      ) : manualReference ? (
        <Card>
          <View style={{ gap: 16 }}>
            <AppText weight="bold">Quote request {manualReference} created</AppText>
            <AppText>This move needs a manual price. Open Quote requests to review and price it.</AppText>
            <Button
              label="Open quote requests"
              onPress={() => {
                router.replace('/(app)/manual-quotes');
              }}
            />
          </View>
        </Card>
      ) : (
        <>
          <AppText weight="bold">
            Step {step + 1} of 5 ·{' '}
            {['Service', 'Move details', 'Items and extras', 'Date and price', 'Customer and review'][step]}
          </AppText>
          {step === 0 ? (
            <Card>
              <View style={{ gap: 16 }}>
                <SegmentedControl
                  label="Service"
                  sizing="content"
                  value={service}
                  disabled={disabled}
                  options={context.services.map((item) => ({ label: item.label, value: item.key }))}
                  onChange={(next) => {
                    setService(next);
                    setVariant(context.services.find((item) => item.key === next)?.variants[0]?.key ?? '');
                    change();
                  }}
                />
                {serviceConfig ? (
                  <SegmentedControl
                    label="Move size or option"
                    sizing="content"
                    value={variant}
                    disabled={disabled}
                    options={serviceConfig.variants.map((item) => ({
                      label: `${item.label}${item.manualQuote ? ' · manual quote' : ''}`,
                      value: item.key,
                    }))}
                    onChange={(next) => {
                      setVariant(next);
                      change();
                    }}
                  />
                ) : null}
                <Button
                  label="Continue to move details"
                  disabled={disabled || !variant}
                  onPress={() => {
                    setStep(1);
                  }}
                />
              </View>
            </Card>
          ) : null}
          {step === 1 ? (
            <>
              <Card>
                <BookingAddressFields
                  label="Pickup"
                  value={pickup}
                  disabled={disabled}
                  lookup={lookup}
                  onValidityChange={setPickupValid}
                  onChange={(value) => {
                    setPickup(value);
                    change();
                  }}
                />
                <BookingAccessFields
                  label="Pickup"
                  value={pickupAccess}
                  disabled={disabled}
                  onChange={(value) => {
                    setPickupAccess(value);
                    change();
                  }}
                />
              </Card>
              {requiresDropoff ? (
                <Card>
                  <BookingAddressFields
                    label="Delivery"
                    value={dropoff}
                    disabled={disabled}
                    lookup={lookup}
                    onValidityChange={setDropoffValid}
                    onChange={(value) => {
                      setDropoff(value);
                      change();
                    }}
                  />
                  <BookingAccessFields
                    label="Delivery"
                    value={dropoffAccess}
                    disabled={disabled}
                    onChange={(value) => {
                      setDropoffAccess(value);
                      change();
                    }}
                  />
                </Card>
              ) : null}
              <Button
                label="Continue to items"
                disabled={disabled || !pickupValid || (requiresDropoff && !dropoffValid)}
                onPress={() => {
                  setStep(2);
                }}
              />
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Card>
                <BookingItemsFields
                  value={items}
                  catalogue={catalogue}
                  disabled={disabled}
                  onChange={(value) => {
                    setItems(value);
                    change();
                  }}
                />
              </Card>
              <Card>
                <BookingExtrasFields
                  value={addons}
                  disabled={disabled}
                  onChange={(value) => {
                    setAddons(value);
                    change();
                  }}
                />
              </Card>
              <Button
                label="Get quote and available dates"
                loading={action.busy}
                disabled={disabled || !pickupValid || (requiresDropoff && !dropoffValid)}
                onPress={() => {
                  void requestQuote();
                }}
              />
            </>
          ) : null}
          {step === 3 && standardQuote ? (
            <Card>
              <View style={{ gap: 16 }}>
                <AppText weight="bold">Choose an available date and slot</AppText>
                <SegmentedControl
                  label="Move date"
                  sizing="content"
                  value={date}
                  disabled={disabled}
                  options={standardQuote.calendar
                    .filter((day) => day.slots.some((item) => item.available))
                    .map((day) => ({ label: displayAdminDate(day.date), value: day.date }))}
                  onChange={(next) => {
                    setDate(next);
                    const first = standardQuote.calendar
                      .find((day) => day.date === next)
                      ?.slots.find((item) => item.available);
                    if (first) setSlot(first.slot);
                  }}
                />
                <SegmentedControl
                  label="Available slot"
                  sizing="content"
                  value={slot}
                  disabled={disabled}
                  options={(selectedDay?.slots ?? [])
                    .filter((item) => item.available)
                    .map((item) => ({
                      label: `${item.windowLabel} · ${formatGBP(item.pricePence)}`,
                      value: item.slot,
                    }))}
                  onChange={setSlot}
                />
                {!selectedSlot ? (
                  <AppText>
                    No slot is available for this date. Choose another date or request a new quote.
                  </AppText>
                ) : (
                  <AppText numeric weight="bold">
                    Total: {formatGBP(selectedSlot.pricePence)}
                  </AppText>
                )}
                <Button
                  label="Continue to customer details"
                  disabled={disabled || !selectedSlot}
                  onPress={() => {
                    setStep(4);
                  }}
                />
              </View>
            </Card>
          ) : null}
          {step === 3 && manualQuote ? (
            <Card>
              <View style={{ gap: 16 }}>
                <AppText weight="bold">A manual price is required</AppText>
                {manualQuote.reasons.map((reason) => (
                  <AppText key={reason}>{reason.replaceAll('_', ' ').toLowerCase()}</AppText>
                ))}
                <AppText>Add the customer details to save a quote request for review.</AppText>
                <Button
                  label="Continue to customer details"
                  disabled={disabled}
                  onPress={() => {
                    setStep(4);
                  }}
                />
              </View>
            </Card>
          ) : null}
          {step === 4 ? (
            <Card>
              <View style={{ gap: 16 }}>
                <TextField
                  label="Customer name"
                  value={name}
                  onChangeText={setName}
                  editable={!disabled}
                  maxLength={80}
                />
                <TextField
                  label="Customer email"
                  value={email}
                  onChangeText={setEmail}
                  editable={!disabled}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  maxLength={254}
                />
                <TextField
                  label="Customer phone"
                  value={phone}
                  onChangeText={setPhone}
                  editable={!disabled}
                  keyboardType="phone-pad"
                  maxLength={25}
                />
                <TextField
                  label="Notes"
                  value={notes}
                  onChangeText={setNotes}
                  editable={!disabled}
                  multiline
                  maxLength={manualQuote ? 500 : 2000}
                />
                {!manualQuote ? (
                  <>
                    <SegmentedControl
                      label="Payment method"
                      sizing="content"
                      value={payment}
                      disabled={disabled}
                      onChange={setPayment}
                      options={
                        session.owner
                          ? [
                              { label: 'Send payment link', value: 'LINK' },
                              { label: 'Already paid offline', value: 'OFFLINE' },
                            ]
                          : [{ label: 'Send payment link', value: 'LINK' }]
                      }
                    />
                    {payment === 'OFFLINE' ? (
                      <>
                        <AppText muted>Only choose this after the full payment has been received.</AppText>
                        <TextField
                          label="Payment reference"
                          value={reference}
                          onChangeText={setReference}
                          editable={!disabled}
                          maxLength={120}
                        />
                      </>
                    ) : null}
                    <AppText weight="bold">
                      {displayAdminDate(date)} · {slotLabel(slot)} ·{' '}
                      {selectedSlot ? formatGBP(selectedSlot.pricePence) : 'Choose a slot'}
                    </AppText>
                  </>
                ) : null}
                <AppText>
                  {pickup?.label}
                  {requiresDropoff && dropoff ? ` → ${dropoff.label}` : ''}
                </AppText>
                <AppText muted>
                  {manualQuote
                    ? 'Save this request for a manual price.'
                    : payment === 'LINK'
                      ? 'Create a pending booking and send the customer a payment email.'
                      : 'Create the booking and record the full offline payment.'}
                </AppText>
                <Button
                  label={
                    manualQuote
                      ? 'Save quote request'
                      : payment === 'LINK'
                        ? 'Create booking and send payment link'
                        : 'Create booking with received payment'
                  }
                  loading={action.busy}
                  disabled={disabled}
                  onPress={() => {
                    void submit();
                  }}
                />
              </View>
            </Card>
          ) : null}
          {step > 0 ? (
            <Button
              label="Back one step"
              tone="secondary"
              disabled={action.busy}
              onPress={() => {
                setStep((value) => value - 1);
                action.clear();
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
