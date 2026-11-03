import type { AdminBookingDetailResponse, AdminBookingEditContext } from '@sv/contracts';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import {
  BookingDetailsForm,
  BookingDriverForm,
  BookingMoveForm,
  BookingScheduleForm,
} from '@/components/booking-edit-forms';
import { bookingEditCopy, bookingEditFailure } from '@/content/booking-edit';
import {
  useBookingEditor,
  type BookingEditMutation,
  type BookingEditSection,
  type BookingEditorData,
} from '@/data/booking-editor';

export default function EditBookingScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [section, setSection] = useState<BookingEditSection>('details');
  const data = useBookingEditor(id, section);
  const loaded = data.context.data && data.booking.data;
  const ready = Boolean(loaded && data.privateReady);
  const status = !id
    ? 'error'
    : !data.privateReady ||
        (data.context.isPending && !data.offline) ||
        (data.booking.isPending && !data.offline)
      ? 'loading'
      : ready
        ? 'ready'
        : 'error';
  const refresh = (): void => {
    void Promise.all([data.context.refetch(), data.booking.refetch()]);
  };
  return (
    <ScreenState
      title="Edit booking"
      {...(data.booking.data ? { subtitle: data.booking.data.reference } : {})}
      status={status}
      errorMessage={
        !id
          ? 'Choose a booking before opening the editor.'
          : data.offline
            ? bookingEditCopy.offline
            : bookingEditCopy.loadError
      }
      onRetry={refresh}
      {...(!ready
        ? {
            toolbar: (
              <Button
                label="Back to bookings"
                tone="secondary"
                onPress={() => {
                  router.replace('/(app)/bookings');
                }}
              />
            ),
          }
        : {})}
    >
      {data.context.data && data.booking.data && data.privateReady ? (
        <BookingEditorWorkspace
          key={`${data.actorId ?? ''}:${id}`}
          data={data}
          initialContext={data.context.data}
          initialBooking={data.booking.data}
          section={section}
          onSectionChange={setSection}
        />
      ) : null}
    </ScreenState>
  );
}

function BookingEditorWorkspace(props: {
  data: BookingEditorData;
  initialContext: AdminBookingEditContext;
  initialBooking: AdminBookingDetailResponse;
  section: BookingEditSection;
  onSectionChange(section: BookingEditSection): void;
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState({ context: props.initialContext, booking: props.initialBooking });
  const [epoch, setEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [nextSection, setNextSection] = useState<BookingEditSection | 'back' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [success, setSuccess] = useState(false);
  const mounted = useRef(true);
  const saving = useRef(false);
  const current = useRef(props.data);
  current.current = props.data;
  const session = useRef({ actorId: props.data.actorId, enabled: props.data.enabled, revision: 0 });
  const identity = useRef({
    actorId: props.data.actorId,
    token: props.data.sessionIdentity,
    owner: props.data.owner,
    privateReady: props.data.privateReady,
    revision: 0,
  });
  if (
    identity.current.actorId !== props.data.actorId ||
    identity.current.token !== props.data.sessionIdentity ||
    identity.current.owner !== props.data.owner ||
    identity.current.privateReady !== props.data.privateReady
  ) {
    identity.current = {
      actorId: props.data.actorId,
      token: props.data.sessionIdentity,
      owner: props.data.owner,
      privateReady: props.data.privateReady,
      revision: identity.current.revision + 1,
    };
  }
  if (session.current.actorId !== props.data.actorId || session.current.enabled !== props.data.enabled) {
    session.current = {
      actorId: props.data.actorId,
      enabled: props.data.enabled,
      revision: session.current.revision + 1,
    };
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current.revision += 1;
    };
  }, []);
  const changed =
    snapshot.context.version !== snapshot.booking.version ||
    (props.data.context.data && props.data.context.data.version !== snapshot.context.version);
  const busy = props.data.save.isPending || authenticating || reloading;
  const disabled = !props.data.enabled || busy || Boolean(changed) || mustReload || success;

  function goTo(section: BookingEditSection | 'back'): void {
    if (section === 'back') router.replace(`/(app)/bookings/${encodeURIComponent(snapshot.context.id)}`);
    else props.onSectionChange(section);
    setDirty(false);
    setNextSection(null);
    setError(null);
    setEpoch((value) => value + 1);
  }
  function changeSection(section: BookingEditSection | 'back'): void {
    if (busy || section === props.section) return;
    if (dirty && !success) setNextSection(section);
    else goTo(section);
  }
  async function reload(): Promise<void> {
    if (!props.data.enabled || busy) return;
    setReloading(true);
    setError(null);
    const attempt = session.current.revision;
    try {
      const [context, booking] = await Promise.all([
        props.data.context.refetch(),
        props.data.booking.refetch(),
        props.data.assignment.refetch(),
        props.data.calendar.refetch(),
      ]);
      if (!mounted.current || attempt !== session.current.revision) return;
      if (
        !context.data ||
        !booking.data ||
        context.isError ||
        booking.isError ||
        context.data.version !== booking.data.version
      ) {
        setError(
          'The latest booking could not be loaded consistently. Your draft is still here. Retry the reload.',
        );
        return;
      }
      setSnapshot({ context: context.data, booking: booking.data });
      setEpoch((value) => value + 1);
      setDirty(false);
      setSuccess(false);
      setMustReload(false);
      setNextSection(null);
      props.data.save.reset();
      props.data.previewMove.reset();
      props.data.previewSchedule.reset();
    } catch {
      if (mounted.current && attempt === session.current.revision)
        setError(
          'The latest booking could not be loaded. Your draft is still here. Check your connection and retry.',
        );
    } finally {
      if (mounted.current) setReloading(false);
    }
  }
  async function save(variables: BookingEditMutation): Promise<void> {
    if (disabled || saving.current) return;
    saving.current = true;
    setError(null);
    let attempt = session.current.revision;
    const identityAttempt = identity.current.revision;
    const hasIdentity = (): boolean =>
      mounted.current && identity.current.revision === identityAttempt && current.current.privateReady;
    const isCurrent = (): boolean =>
      hasIdentity() && attempt === session.current.revision && current.current.enabled;
    try {
      if (
        (variables.operation === 'move' || variables.operation === 'schedule') &&
        variables.input.settle === 'REFUND'
      ) {
        if (Platform.OS === 'web') {
          setError('Confirm refunds in the installed admin app using Face ID or your device passcode.');
          return;
        }
        setAuthenticating(true);
        const confirmation = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm booking refund',
          cancelLabel: 'Cancel',
        });
        if (!hasIdentity()) return;
        if (!confirmation.success) {
          setError('Refund confirmation was cancelled. No changes were sent.');
          return;
        }
        const deadline = Date.now() + 2000;
        const ready = await new Promise<boolean>((resolve) => {
          function check(): void {
            if (!hasIdentity()) {
              resolve(false);
              return;
            }
            if (current.current.enabled && !current.current.offline) {
              resolve(true);
              return;
            }
            if (Date.now() >= deadline) {
              resolve(false);
              return;
            }
            setTimeout(check, 25);
          }
          check();
        });
        if (!hasIdentity()) return;
        if (!ready) {
          setError('Return to the unlocked admin app while online, then try again. No changes were sent.');
          return;
        }
        if (
          current.current.context.data?.version !== variables.input.expectedVersion ||
          current.current.booking.data?.version !== variables.input.expectedVersion
        ) {
          setError('This booking changed during device confirmation. Reload it and review the refund again.');
          setMustReload(true);
          return;
        }
        attempt = session.current.revision;
      }
      if (!isCurrent()) return;
      await props.data.save.mutateAsync(variables);
      if (!isCurrent()) return;
      setSuccess(true);
      setDirty(false);
      setMustReload(false);
    } catch (cause) {
      if (!isCurrent()) return;
      const outcome = bookingEditFailure(cause);
      setError(outcome.message);
      setMustReload(outcome.reload);
    } finally {
      saving.current = false;
      if (mounted.current) setAuthenticating(false);
    }
  }
  const formProps = {
    context: snapshot.context,
    booking: snapshot.booking,
    data: props.data,
    disabled,
    onDirty: () => {
      setDirty(true);
    },
    onSave: (variables: BookingEditMutation) => {
      void save(variables);
    },
  };
  return (
    <View style={styles.stack}>
      <Button
        label="Back to booking"
        tone="secondary"
        disabled={busy}
        onPress={() => {
          changeSection('back');
        }}
      />
      {props.data.offline ? (
        <AppText accessibilityRole="alert" tone="danger">
          {bookingEditCopy.offline}
        </AppText>
      ) : null}
      {success ? (
        <Card>
          <AppText accessibilityRole="header" aria-level={2} tone="success" weight="bold">
            Booking updated
          </AppText>
          <AppText accessibilityLiveRegion="polite">Your changes were saved.</AppText>
          <Button
            label="View updated booking"
            onPress={() => {
              goTo('back');
            }}
          />
          <Button
            label="Edit more details"
            tone="secondary"
            disabled={!props.data.enabled || reloading}
            loading={reloading}
            onPress={() => {
              void reload();
            }}
          />
        </Card>
      ) : (
        <>
          <SegmentedControl
            label="Booking section"
            value={props.section}
            options={[
              { label: 'Details', value: 'details', disabled: busy },
              { label: 'Move & price', value: 'move', disabled: busy },
              { label: 'Date & time', value: 'schedule', disabled: busy },
              { label: 'Driver', value: 'driver', disabled: busy },
            ]}
            onChange={changeSection}
          />
          {nextSection ? (
            <Card>
              <AppText weight="bold">Discard unsaved changes?</AppText>
              <AppText>Your changes in this section have not been saved.</AppText>
              <Button
                label="Keep editing"
                tone="secondary"
                onPress={() => {
                  setNextSection(null);
                }}
              />
              <Button
                label="Discard draft and continue"
                tone="secondary"
                onPress={() => {
                  goTo(nextSection);
                }}
              />
            </Card>
          ) : null}
          {changed || mustReload ? (
            <Card>
              <AppText accessibilityRole="alert" tone="danger">
                {changed ? bookingEditCopy.conflict : bookingEditCopy.uncertain}
              </AppText>
              <AppText muted>Reloading replaces this unsaved draft with the current booking.</AppText>
              <Button
                label="Reload latest booking"
                disabled={!props.data.enabled || reloading}
                loading={reloading}
                onPress={() => {
                  void reload();
                }}
              />
            </Card>
          ) : null}
          {props.data.context.isError && !mustReload ? (
            <Card>
              <AppText accessibilityRole="alert" tone="danger">
                The latest booking could not be refreshed. Your draft is kept.
              </AppText>
              <Button
                label="Retry booking check"
                tone="secondary"
                disabled={!props.data.enabled}
                onPress={() => {
                  void props.data.context.refetch();
                }}
              />
            </Card>
          ) : null}
          <View key={`${props.section}:${String(epoch)}`}>
            {props.section === 'details' ? (
              <BookingDetailsForm {...formProps} />
            ) : props.section === 'move' ? (
              <BookingMoveForm {...formProps} />
            ) : props.section === 'schedule' ? (
              <BookingScheduleForm {...formProps} />
            ) : (
              <BookingDriverForm {...formProps} />
            )}
          </View>
        </>
      )}
      {error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: 20 } });
