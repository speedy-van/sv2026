import {
  AdminBookingPatchSchema,
  AdminReschedulePreviewRequestSchema,
  RepricePreviewSchema,
  formatGBP,
  type AdminBookingDetailResponse,
  type AdminBookingEditContext,
  type AdminBookingRepricePreview,
  type AdminBookingReschedulePreview,
} from '@sv/contracts';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, SegmentedControl, TextField } from './primitives';
import {
  BookingAccessFields,
  BookingAddressFields,
  BookingExtrasFields,
  BookingItemsFields,
  ToggleField,
} from './booking-edit-fields';
import { bookingEditCopy, bookingEditFailure } from '@/content/booking-edit';
import type { BookingEditMutation, BookingEditorData } from '@/data/booking-editor';
import { displayAdminDate, slotLabel } from '@/data/operations';

export interface BookingFormProps {
  context: AdminBookingEditContext;
  booking: AdminBookingDetailResponse;
  data: BookingEditorData;
  disabled: boolean;
  onDirty(): void;
  onSave(variables: BookingEditMutation): void;
}

function Feedback({ message }: { message: string | null }): React.ReactElement | null {
  return message ? (
    <AppText accessibilityRole="alert" tone="danger">
      {message}
    </AppText>
  ) : null;
}

export function BookingDetailsForm(props: BookingFormProps): React.ReactElement {
  const [contact, setContact] = useState(props.context.contact);
  const [notes, setNotes] = useState(props.context.notes ?? '');
  const [vanId, setVanId] = useState(props.context.vanId);
  const [error, setError] = useState<string | null>(null);
  const changed =
    JSON.stringify(contact) !== JSON.stringify(props.context.contact) ||
    notes !== (props.context.notes ?? '') ||
    vanId !== props.context.vanId;
  const options = props.data.assignment;
  const disabled = props.disabled || !props.context.editable;
  return (
    <Card>
      <AppText accessibilityRole="header" aria-level={2} weight="bold">
        Contact and internal notes
      </AppText>
      {!props.context.editable ? <Feedback message={props.context.reason} /> : null}
      <TextField
        label="Contact name"
        value={contact.name}
        onChangeText={(name) => {
          setContact((current) => ({ ...current, name }));
          props.onDirty();
        }}
        editable={!disabled}
        maxLength={80}
      />
      <TextField
        label="Contact phone"
        value={contact.phone}
        onChangeText={(phone) => {
          setContact((current) => ({ ...current, phone }));
          props.onDirty();
        }}
        editable={!disabled}
        keyboardType="phone-pad"
        maxLength={30}
      />
      <TextField
        label="Contact email"
        value={contact.email}
        onChangeText={(email) => {
          setContact((current) => ({ ...current, email }));
          props.onDirty();
        }}
        editable={!disabled}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={160}
      />
      {contact.email.trim().toLowerCase() !== props.context.contact.email ? (
        <AppText weight="bold">{bookingEditCopy.emailWarning}</AppText>
      ) : null}
      <TextField
        label="Internal notes"
        value={notes}
        onChangeText={(value) => {
          setNotes(value);
          props.onDirty();
        }}
        editable={!disabled}
        multiline
        maxLength={1000}
      />
      {props.booking.customerNotes ? (
        <>
          <AppText weight="bold">Customer notes</AppText>
          <AppText selectable>{props.booking.customerNotes}</AppText>
          <AppText muted size="sm">
            Customer notes are read-only.
          </AppText>
        </>
      ) : null}
      <AppText weight="bold">Van</AppText>
      <AppText muted>
        Current:{' '}
        {props.booking.van
          ? `${props.booking.van.label} · ${props.booking.van.registration}`
          : 'No van selected'}
      </AppText>
      {options.isPending ? <AppText accessibilityRole="progressbar">Loading vans…</AppText> : null}
      {options.isError ? (
        <>
          <Feedback message="Vans could not be loaded. You can still update contact details and notes." />
          <Button
            label="Retry vans"
            tone="secondary"
            disabled={!props.data.enabled}
            onPress={() => {
              void options.refetch();
            }}
          />
        </>
      ) : null}
      {options.data ? (
        <View style={styles.stack}>
          <Button
            label={vanId === null ? 'No van · selected' : 'Select no van'}
            tone="secondary"
            disabled={disabled}
            onPress={() => {
              setVanId(null);
              props.onDirty();
            }}
          />
          {options.data.vans.map((van) => (
            <View key={van.id} style={styles.stack}>
              <Button
                label={`${van.label} · ${van.registration}${vanId === van.id ? ' · selected' : ''}`}
                tone="secondary"
                disabled={disabled || !van.available}
                onPress={() => {
                  setVanId(van.id);
                  props.onDirty();
                }}
              />
              {!van.available && van.reason ? (
                <AppText muted size="sm">
                  {van.reason}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <Feedback message={error} />
      <Button
        label="Save contact and notes"
        disabled={disabled || !changed}
        loading={props.data.save.isPending}
        onPress={() => {
          const parsed = AdminBookingPatchSchema.safeParse({
            expectedVersion: props.context.version,
            contact,
            notes,
            ...(vanId !== props.context.vanId ? { vanId } : {}),
          });
          if (!parsed.success) {
            setError(
              'Enter a name, valid email and phone number. Notes must be no longer than 1,000 characters.',
            );
            return;
          }
          setError(null);
          props.onSave({ operation: 'details', input: parsed.data });
        }}
      />
    </Card>
  );
}

type PricePreview = Pick<
  AdminBookingRepricePreview,
  'currentTotalPence' | 'newTotalPence' | 'settle' | 'settlementAmountPence'
>;
export function BookingPriceReview({ preview }: { preview: PricePreview }): React.ReactElement {
  return (
    <Card tone="subtle">
      <AppText accessibilityRole="header" aria-level={3} weight="bold">
        Review the price
      </AppText>
      <AppText>Current total: {formatGBP(preview.currentTotalPence)}</AppText>
      <AppText weight="bold">New total: {formatGBP(preview.newTotalPence)}</AppText>
      <AppText accessibilityLiveRegion="polite">
        {preview.settle === 'EXTRA_CHARGE'
          ? `Send a payment link for ${formatGBP(preview.settlementAmountPence)}.`
          : preview.settle === 'REFUND'
            ? `Refund ${formatGBP(preview.settlementAmountPence)}.`
            : 'No additional payment or refund is required.'}
      </AppText>
    </Card>
  );
}
function savePriceLabel(preview: PricePreview, operation: 'move' | 'schedule'): string {
  return preview.settle === 'EXTRA_CHARGE'
    ? 'Save and send payment link'
    : preview.settle === 'REFUND'
      ? `Save and refund ${formatGBP(preview.settlementAmountPence)}`
      : operation === 'move'
        ? 'Save move changes'
        : 'Save new date and time';
}

export function BookingMoveForm(props: BookingFormProps): React.ReactElement {
  return props.context.changes && props.context.repriceEditable ? (
    <MoveFields {...props} initial={props.context.changes} />
  ) : (
    <Card>
      <AppText>This move cannot be repriced.</AppText>
      <AppText muted>
        {props.context.repriceReason ?? 'The original move details are unavailable for repricing.'}
      </AppText>
    </Card>
  );
}

function MoveFields(
  props: BookingFormProps & { initial: NonNullable<AdminBookingEditContext['changes']> },
): React.ReactElement {
  const [changes, setChanges] = useState(props.initial);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<AdminBookingRepricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validAddress, setValidAddress] = useState({ pickup: true, dropoff: true });
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const blocked = useRef(props.disabled);
  blocked.current = props.disabled;
  const busy = props.disabled || props.data.previewMove.isPending;
  const catalogue = props.data.catalogue;
  const selectedService = props.context.services.find((service) => service.key === changes.service);
  function update(value: typeof changes): void {
    revision.current += 1;
    setChanges(value);
    setPreview(null);
    setError(null);
    props.onDirty();
  }
  async function previewPrice(): Promise<void> {
    const parsed = RepricePreviewSchema.safeParse({ expectedVersion: props.context.version, changes });
    if (!validAddress.pickup || !validAddress.dropoff) {
      setError('Verify changed addresses before previewing the price.');
      return;
    }
    if (!parsed.success) {
      setError(
        `Check the move details: ${parsed.error.issues[0]?.message ?? 'One or more fields are invalid.'}`,
      );
      return;
    }
    const attempt = revision.current;
    setError(null);
    setPreview(null);
    try {
      const result = await props.data.previewMove.mutateAsync(parsed.data);
      if (mounted.current && !blocked.current && attempt === revision.current) setPreview(result);
    } catch (cause) {
      if (mounted.current && attempt === revision.current) setError(bookingEditFailure(cause).message);
    }
  }
  if (!catalogue.data)
    return (
      <Card>
        <AppText>
          {catalogue.isPending ? 'Loading the item catalogue…' : 'The item catalogue could not be loaded.'}
        </AppText>
        {catalogue.isError ? (
          <Button
            label="Retry catalogue"
            disabled={!props.data.enabled}
            onPress={() => {
              void catalogue.refetch();
            }}
          />
        ) : null}
      </Card>
    );
  return (
    <Card>
      <AppText accessibilityRole="header" aria-level={2} weight="bold">
        Move details and price
      </AppText>
      <AppText muted>{bookingEditCopy.previewRequired}</AppText>
      {catalogue.isError ? (
        <>
          <Feedback message="The catalogue could not be refreshed. Retry before choosing recently added items." />
          <Button
            label="Retry catalogue"
            tone="secondary"
            disabled={!props.data.enabled}
            onPress={() => {
              void catalogue.refetch();
            }}
          />
        </>
      ) : null}
      <SegmentedControl
        label="Service"
        value={changes.service}
        options={props.context.services
          .filter((service) => service.variants.some((variant) => !variant.manualQuote))
          .map((service) => ({ label: service.label, value: service.key, disabled: busy }))}
        onChange={(serviceKey) => {
          const service = props.context.services.find((entry) => entry.key === serviceKey);
          const variant = service?.variants.find((entry) => !entry.manualQuote);
          if (!service || !variant) return;
          update({
            ...changes,
            service: service.key,
            variant: variant.key,
            dropoff: service.requiresDropoff ? changes.dropoff : null,
            dropoffAccess: service.requiresDropoff
              ? (changes.dropoffAccess ?? {
                  floorChoice: 'GROUND',
                  hasLift: false,
                  carryMetres: 0,
                  narrowAccess: false,
                  permitZone: false,
                })
              : null,
          });
          setValidAddress((current) => ({
            ...current,
            dropoff: !service.requiresDropoff || Boolean(changes.dropoff),
          }));
        }}
      />
      {selectedService ? (
        <SegmentedControl
          label="Move size or type"
          value={changes.variant}
          options={selectedService.variants
            .filter((variant) => !variant.manualQuote)
            .map((variant) => ({ label: variant.label, value: variant.key, disabled: busy }))}
          onChange={(variant) => {
            update({ ...changes, variant });
          }}
        />
      ) : null}
      <BookingAddressFields
        label="Pickup"
        value={changes.pickup}
        disabled={busy}
        lookup={props.data.lookupPostcode}
        onChange={(pickup) => {
          update({ ...changes, pickup });
        }}
        onValidityChange={(valid) => {
          setValidAddress((current) => ({ ...current, pickup: valid }));
          if (!valid) {
            revision.current += 1;
            setPreview(null);
            props.onDirty();
          }
        }}
      />
      <BookingAccessFields
        label="Pickup"
        value={changes.pickupAccess}
        disabled={busy}
        onChange={(pickupAccess) => {
          update({ ...changes, pickupAccess });
        }}
      />
      {selectedService?.requiresDropoff ? (
        <>
          <BookingAddressFields
            label="Delivery"
            value={changes.dropoff}
            disabled={busy}
            lookup={props.data.lookupPostcode}
            onChange={(dropoff) => {
              update({ ...changes, dropoff });
            }}
            onValidityChange={(valid) => {
              setValidAddress((current) => ({ ...current, dropoff: valid }));
              if (!valid) {
                revision.current += 1;
                setPreview(null);
                props.onDirty();
              }
            }}
          />
          {changes.dropoffAccess ? (
            <BookingAccessFields
              label="Delivery"
              value={changes.dropoffAccess}
              disabled={busy}
              onChange={(dropoffAccess) => {
                update({ ...changes, dropoffAccess });
              }}
            />
          ) : null}
        </>
      ) : null}
      <BookingItemsFields
        value={changes.items}
        catalogue={catalogue.data}
        disabled={busy}
        onChange={(items) => {
          update({ ...changes, items });
        }}
      />
      <BookingExtrasFields
        value={changes.addons}
        disabled={busy}
        onChange={(addons) => {
          update({ ...changes, addons });
        }}
      />
      <TextField
        label="Reason for move changes"
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          props.onDirty();
        }}
        editable={!busy}
        multiline
        maxLength={500}
      />
      <Feedback message={error} />
      <Button
        label="Check the new price"
        tone="secondary"
        disabled={busy || !validAddress.pickup || !validAddress.dropoff}
        loading={props.data.previewMove.isPending}
        onPress={() => {
          void previewPrice();
        }}
      />
      {preview ? (
        <>
          <BookingPriceReview preview={preview} />
          <View style={styles.columns}>
            <Card style={styles.column}>
              <AppText weight="bold">Current breakdown</AppText>
              {preview.oldBreakdownLines.map((line) => (
                <AppText key={line.key}>
                  {line.label}: {formatGBP(line.pence)}
                </AppText>
              ))}
            </Card>
            <Card style={styles.column}>
              <AppText weight="bold">Revised breakdown</AppText>
              {preview.newBreakdownLines.map((line) => (
                <AppText key={line.key}>
                  {line.label}: {formatGBP(line.pence)}
                </AppText>
              ))}
            </Card>
          </View>
          <Button
            label={savePriceLabel(preview, 'move')}
            disabled={busy || !reason.trim()}
            loading={props.data.save.isPending}
            onPress={() => {
              props.onSave({
                operation: 'move',
                input: {
                  expectedVersion: props.context.version,
                  changes,
                  expectedTotalPence: preview.newTotalPence,
                  expectedSettlementPence: preview.settlementAmountPence,
                  settle: preview.settle,
                  reason,
                },
              });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

export function BookingScheduleForm(props: BookingFormProps): React.ReactElement {
  const [date, setDate] = useState(props.booking.moveDate);
  const [slot, setSlot] = useState(props.booking.slot);
  const [priceMode, setPriceMode] = useState<'KEEP_PRICE' | 'NEW_PRICE'>('KEEP_PRICE');
  const [reason, setReason] = useState('');
  const [overrideCapacity, setOverride] = useState(false);
  const [preview, setPreview] = useState<AdminBookingReschedulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const blocked = useRef(props.disabled);
  blocked.current = props.disabled;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const calendar = props.data.calendar;
  const busy = props.disabled || props.data.previewSchedule.isPending;
  const selectedDay = calendar.data?.days.find((day) => day.date === date);
  const selectedSlot = selectedDay?.slots.find((entry) => entry.slot === slot);
  const versionChanged = calendar.data && calendar.data.version !== props.context.version;
  const canSelect =
    selectedSlot &&
    (selectedSlot.available || selectedSlot.current || (props.data.owner && overrideCapacity));
  function changed(): void {
    revision.current += 1;
    setPreview(null);
    setError(null);
    props.onDirty();
  }
  async function previewDate(): Promise<void> {
    const parsed = AdminReschedulePreviewRequestSchema.safeParse({
      expectedVersion: props.context.version,
      date,
      slot,
      priceMode,
      reason,
      ...(props.data.owner && overrideCapacity ? { overrideCapacity: true } : {}),
    });
    if (!parsed.success) {
      setError('Choose an available date and time, and enter a reason.');
      return;
    }
    const attempt = revision.current;
    setError(null);
    setPreview(null);
    try {
      const result = await props.data.previewSchedule.mutateAsync(parsed.data);
      if (mounted.current && !blocked.current && attempt === revision.current) setPreview(result);
    } catch (cause) {
      if (mounted.current && attempt === revision.current) setError(bookingEditFailure(cause).message);
    }
  }
  if (!calendar.data)
    return (
      <Card>
        <AppText>
          {calendar.isPending ? 'Loading available dates…' : 'Available dates could not be loaded.'}
        </AppText>
        {calendar.isError ? (
          <Button
            label="Retry available dates"
            disabled={!props.data.enabled}
            onPress={() => {
              void calendar.refetch();
            }}
          />
        ) : null}
      </Card>
    );
  return (
    <Card>
      <AppText accessibilityRole="header" aria-level={2} weight="bold">
        Date and time
      </AppText>
      <AppText>
        Current: {displayAdminDate(props.booking.moveDate)} · {slotLabel(props.booking.slot)}
      </AppText>
      {calendar.isError ? (
        <>
          <Feedback message="Available dates could not be refreshed. Retry to check the current availability." />
          <Button
            label="Retry available dates"
            tone="secondary"
            disabled={!props.data.enabled}
            onPress={() => {
              void calendar.refetch();
            }}
          />
        </>
      ) : null}
      {versionChanged ? <Feedback message={bookingEditCopy.conflict} /> : null}
      {calendar.data.days.length === 0 ? (
        <AppText muted>No dates are currently available for this booking.</AppText>
      ) : (
        <>
          <ScrollView horizontal accessibilityLabel="Move dates" contentContainerStyle={styles.dateChoices}>
            {calendar.data.days.map((day) => (
              <Button
                key={day.date}
                label={`${displayAdminDate(day.date)}${date === day.date ? ' · selected' : ''}`}
                tone="secondary"
                disabled={busy}
                onPress={() => {
                  setDate(day.date);
                  changed();
                }}
              />
            ))}
          </ScrollView>
          <View style={styles.stack}>
            {selectedDay?.slots.map((entry) => (
              <View key={entry.slot} style={styles.stack}>
                <Button
                  label={`${entry.windowLabel}${priceMode === 'NEW_PRICE' ? ` · ${formatGBP(entry.pricePence)}` : ''}${entry.slot === slot ? ' · selected' : ''}`}
                  tone="secondary"
                  disabled={
                    busy || (!entry.available && !entry.current && !(props.data.owner && overrideCapacity))
                  }
                  onPress={() => {
                    setSlot(entry.slot);
                    changed();
                  }}
                />
                {!entry.available && entry.reason ? <AppText muted>{entry.reason}</AppText> : null}
              </View>
            ))}
          </View>
          <SegmentedControl
            label="Price for the new date"
            value={priceMode}
            options={[
              { label: 'Keep agreed price', value: 'KEEP_PRICE', disabled: busy },
              { label: 'Use new date price', value: 'NEW_PRICE', disabled: busy },
            ]}
            onChange={(mode) => {
              setPriceMode(mode);
              changed();
            }}
          />
          {props.data.owner ? (
            <ToggleField
              label="Override capacity"
              value={overrideCapacity}
              disabled={busy}
              onChange={(value) => {
                setOverride(value);
                changed();
              }}
            />
          ) : null}
          <TextField
            label="Reason for date change"
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              changed();
            }}
            editable={!busy}
            multiline
            maxLength={500}
          />
          <Feedback message={error} />
          <Button
            label="Check the date change"
            tone="secondary"
            disabled={
              busy ||
              Boolean(versionChanged) ||
              !canSelect ||
              !reason.trim() ||
              (date === props.booking.moveDate && slot === props.booking.slot)
            }
            loading={props.data.previewSchedule.isPending}
            onPress={() => {
              void previewDate();
            }}
          />
        </>
      )}
      {preview ? (
        <>
          <BookingPriceReview preview={preview} />
          {preview.willUnassignDriver ? (
            <AppText weight="bold">
              Changing the date will remove the current driver assignment. Assign a driver again after saving.
            </AppText>
          ) : null}
          <Button
            label={savePriceLabel(preview, 'schedule')}
            disabled={busy || Boolean(versionChanged)}
            loading={props.data.save.isPending}
            onPress={() => {
              props.onSave({
                operation: 'schedule',
                input: {
                  expectedVersion: props.context.version,
                  date,
                  slot,
                  priceMode,
                  reason,
                  ...(props.data.owner && overrideCapacity ? { overrideCapacity: true } : {}),
                  expectedTotalPence: preview.newTotalPence,
                  expectedSettlementPence: preview.settlementAmountPence,
                  settle: preview.settle,
                },
              });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

export function BookingDriverForm(props: BookingFormProps): React.ReactElement {
  const [driverId, setDriver] = useState(props.booking.driver?.id ?? '');
  const [vanId, setVan] = useState(props.context.vanId ?? '');
  const [mode, setMode] = useState<'DIRECT' | 'OFFER'>('DIRECT');
  const [reason, setReason] = useState('');
  const query = props.data.assignment;
  if (!query.data)
    return (
      <Card>
        <AppText>
          {query.isPending ? 'Checking drivers and vans…' : 'Drivers and vans could not be loaded.'}
        </AppText>
        {query.isError ? (
          <Button
            label="Retry drivers and vans"
            disabled={!props.data.enabled}
            onPress={() => {
              void query.refetch();
            }}
          />
        ) : null}
      </Card>
    );
  const options = query.data;
  const changedVersion = options.version !== props.context.version;
  const disabled = props.disabled || !options.editable || changedVersion;
  const driverAvailable = options.drivers.some((driver) => driver.id === driverId && driver.available);
  const vanAvailable = options.vans.some((van) => van.id === vanId && van.available);
  return (
    <Card>
      <AppText accessibilityRole="header" aria-level={2} weight="bold">
        Driver and van
      </AppText>
      <AppText>Current driver: {props.booking.driver?.name ?? 'Not assigned'}</AppText>
      {query.isError ? (
        <>
          <Feedback message="Driver availability could not be refreshed. Retry to check the current assignments." />
          <Button
            label="Retry drivers and vans"
            tone="secondary"
            disabled={!props.data.enabled}
            onPress={() => {
              void query.refetch();
            }}
          />
        </>
      ) : null}
      {changedVersion ? (
        <Feedback message={bookingEditCopy.conflict} />
      ) : !options.editable ? (
        <Feedback message={options.reason} />
      ) : null}
      {options.drivers.length === 0 ? (
        <AppText muted>
          No drivers are available. Add or activate a driver before assigning this booking.
        </AppText>
      ) : null}
      {options.drivers.map((driver) => (
        <View key={driver.id} style={styles.stack}>
          <Button
            label={`${driver.name}${driver.id === driverId ? ' · selected' : ''}`}
            tone="secondary"
            disabled={disabled || !driver.available}
            onPress={() => {
              setDriver(driver.id);
              setVan(driver.defaultVanId ?? '');
              props.onDirty();
            }}
          />
          {!driver.available ? (
            <AppText muted>{driver.reason ?? 'This driver is unavailable.'}</AppText>
          ) : null}
        </View>
      ))}
      <AppText weight="bold">Select a van</AppText>
      {options.vans.length === 0 ? (
        <AppText muted>No active vans are available for this slot.</AppText>
      ) : null}
      {options.vans.map((van) => (
        <View key={van.id} style={styles.stack}>
          <Button
            label={`${van.label} · ${van.registration}${van.id === vanId ? ' · selected' : ''}`}
            tone="secondary"
            disabled={disabled || !van.available}
            onPress={() => {
              setVan(van.id);
              props.onDirty();
            }}
          />
          {!van.available ? <AppText muted>{van.reason ?? 'This van is unavailable.'}</AppText> : null}
        </View>
      ))}
      <SegmentedControl
        label="Assignment mode"
        value={mode}
        options={[
          { label: 'Assign directly', value: 'DIRECT', disabled },
          { label: 'Offer to driver', value: 'OFFER', disabled },
        ]}
        onChange={(value) => {
          setMode(value);
          props.onDirty();
        }}
      />
      {mode === 'OFFER' ? (
        <AppText muted>The driver must accept the offer before the assignment is confirmed.</AppText>
      ) : null}
      <Button
        label={mode === 'DIRECT' ? 'Assign driver and van' : 'Send driver offer'}
        disabled={disabled || !driverAvailable || !vanAvailable}
        loading={props.data.save.isPending}
        onPress={() => {
          props.onSave({
            operation: 'assign',
            input: { expectedVersion: props.context.version, driverId, vanId, mode },
          });
        }}
      />
      {props.booking.driver || props.booking.dispatchStatus === 'OFFERED' ? (
        <>
          <Badge label="Current dispatch can be removed" tone="neutral" />
          <TextField
            label="Reason for removing assignment"
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              props.onDirty();
            }}
            editable={!disabled}
            multiline
            maxLength={500}
          />
          <Button
            label="Remove assignment and offers"
            tone="secondary"
            disabled={disabled || !reason.trim()}
            loading={props.data.save.isPending}
            onPress={() => {
              props.onSave({
                operation: 'unassign',
                input: { expectedVersion: props.context.version, reason },
              });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  column: { flexBasis: 240, flexGrow: 1 },
  dateChoices: { gap: 8, paddingVertical: 4 },
});
