import { formatGBP, type AdminBookingDetailResponse } from '@sv/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, CreditCard, MapPin, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, IconButton, SectionHeader } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { BookingCleanupActions } from '@/components/booking-cleanup-actions';
import {
  bookingStatusLabel,
  displayAdminDate,
  jobStageLabel,
  serviceLabel,
  slotLabel,
  useBookingDetail,
} from '@/data/operations';
import { useAppColors } from '@/theme/theme';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';

const paymentLabels = {
  REQUIRES_PAYMENT: 'Awaiting payment',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Received',
  FAILED: 'Failed',
  CANCELED: 'Cancelled',
} as const;

export default function BookingDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBookingDetail(id);
  const booking = query.data;
  const colors = useAppColors();
  const [contactError, setContactError] = useState<string | null>(null);
  const refresh = (): void => {
    void query.refetch();
  };
  function openContact(url: string): void {
    setContactError(null);
    void Linking.openURL(url).catch(() => {
      setContactError('This contact app could not be opened. You can use the details shown below.');
    });
  }
  return (
    <ScreenState
      eyebrow="BOOKING DETAILS"
      title={booking?.reference ?? 'Booking'}
      {...(booking ? { subtitle: booking.customerName } : {})}
      toolbar={
        <View style={styles.toolbar}>
          <Button
            label="Bookings"
            icon={<ChevronLeft color={colors.text} size={18} />}
            tone="secondary"
            onPress={() => {
              router.navigate('/(app)/bookings');
            }}
          />
          <View style={styles.toolbarActions}>
            <IconButton
              label="Refresh booking"
              icon={<RefreshCw color={colors.text} size={20} />}
              onPress={refresh}
            />
            {booking ? <BookingCleanupActions booking={booking} /> : null}
          </View>
        </View>
      }
      status={query.isPending ? 'loading' : !booking ? 'error' : 'ready'}
      errorMessage="This booking could not be loaded. It may no longer be available, or your connection may be offline."
      onRetry={refresh}
      onRefresh={refresh}
      refreshing={query.isRefetching}
    >
      {booking ? (
        <>
          {booking.deletedAt ? (
            <Card tone="subtle">
              <AppText weight="bold">In Deleted jobs</AppText>
              <AppText muted>
                This record and its payment history are retained. Restoring the record does not reopen an
                expired checkout.
              </AppText>
            </Card>
          ) : null}
          {query.isError ? (
            <Card>
              <AppText accessibilityRole="alert">
                The booking could not be updated. The last loaded details are shown.
              </AppText>
              <Button label="Try again" tone="secondary" onPress={refresh} />
            </Card>
          ) : null}
          <Card padding="lg">
            <View style={styles.badges}>
              <Badge
                label={bookingStatusLabel(booking.status)}
                tone={
                  booking.status === 'COMPLETED'
                    ? 'success'
                    : booking.status === 'CANCELLED'
                      ? 'danger'
                      : 'neutral'
                }
              />
              {booking.status === 'CONFIRMED' && booking.dispatchStatus === 'UNASSIGNED' ? (
                <Badge label="Needs a driver" tone="danger" />
              ) : null}
            </View>
            <AppText size="xl">{booking.routeLabel}</AppText>
            <View style={styles.timing}>
              <View style={styles.timestamp}>
                <AppText muted size="sm">
                  Move date
                </AppText>
                <AppText>
                  {displayAdminDate(booking.moveDate)} · {slotLabel(booking.slot)}
                </AppText>
              </View>
              <View style={styles.timestamp}>
                <AppText muted size="sm">
                  Booking created
                </AppText>
                <AppText selectable weight="semibold">
                  {displayBookingCreatedAt(booking.createdAt)}
                </AppText>
              </View>
            </View>
            <View style={[styles.total, { borderTopColor: colors.separator }]}>
              <AppText muted>Booking total</AppText>
              <AppText numeric size="xl">
                {formatGBP(booking.totalPence)}
              </AppText>
            </View>
          </Card>

          <View style={styles.addresses}>
            <AddressCard title="Pickup" address={booking.pickup} />
            <AddressCard title="Delivery" address={booking.dropoff} />
          </View>

          <Card>
            <SectionHeader title="Move details" />
            <DetailRow label="Service" value={serviceLabel(booking.service)} />
            <DetailRow label="Size or type" value={serviceLabel(booking.variant)} />
            <DetailRow label="Job progress" value={jobStageLabel(booking.jobStage)} />
            <DetailRow label="Driver" value={booking.driver?.name ?? 'Not assigned'} />
            {booking.driver ? (
              <Button
                label="View driver"
                tone="secondary"
                onPress={() => {
                  router.push(`/(app)/drivers/${booking.driver?.id ?? ''}`);
                }}
              />
            ) : null}
            <DetailRow
              label="Van"
              value={booking.van ? `${booking.van.label} · ${booking.van.registration}` : 'Not assigned'}
            />
          </Card>

          <Card>
            <SectionHeader title="Customer" />
            <AppText weight="bold">{booking.customerName}</AppText>
            <AppText selectable>{booking.contactEmail}</AppText>
            <AppText selectable>{booking.contactPhone}</AppText>
            <View style={styles.contactActions}>
              <Button
                label="Call customer"
                tone="secondary"
                onPress={() => {
                  openContact(`tel:${encodeURIComponent(booking.contactPhone)}`);
                }}
              />
              <Button
                label="Email customer"
                tone="secondary"
                onPress={() => {
                  openContact(`mailto:${encodeURIComponent(booking.contactEmail)}`);
                }}
              />
            </View>
            {contactError ? (
              <AppText accessibilityRole="alert" tone="danger" size="sm">
                {contactError}
              </AppText>
            ) : null}
          </Card>

          {booking.customerNotes || booking.adminNotes ? (
            <Card>
              <SectionHeader title="Notes" />
              {booking.customerNotes ? (
                <View style={styles.note}>
                  <AppText muted size="sm">
                    Customer notes
                  </AppText>
                  <AppText selectable>{booking.customerNotes}</AppText>
                </View>
              ) : null}
              {booking.adminNotes ? (
                <View style={styles.note}>
                  <AppText muted size="sm">
                    Internal notes
                  </AppText>
                  <AppText selectable>{booking.adminNotes}</AppText>
                </View>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <SectionHeader title="Payments" />
            <DetailRow label="Recorded paid" value={formatGBP(booking.paidPence)} />
            {booking.refundedPence > 0 ? (
              <DetailRow label="Recorded refunded" value={formatGBP(booking.refundedPence)} />
            ) : null}
            {booking.payments.length === 0 ? (
              <AppText muted>No payment records for this booking.</AppText>
            ) : (
              booking.payments.map((payment) => (
                <View key={payment.id} style={[styles.payment, { borderTopColor: colors.separator }]}>
                  <View style={[styles.paymentIcon, { backgroundColor: colors.surfaceMuted }]}>
                    <CreditCard color={colors.muted} size={21} />
                  </View>
                  <View style={styles.paymentCopy}>
                    <AppText weight="bold">
                      {payment.method === 'STRIPE' ? 'Stripe payment' : 'Offline payment'}
                    </AppText>
                    <AppText muted size="sm">
                      {paymentLabels[payment.status]}
                    </AppText>
                  </View>
                  <AppText numeric weight="bold">
                    {payment.currency.toUpperCase() === 'GBP'
                      ? formatGBP(payment.amountPence)
                      : `${String(payment.amountPence)} minor units (${payment.currency.toUpperCase()})`}
                  </AppText>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </ScreenState>
  );
}

function AddressCard({
  title,
  address,
}: {
  title: string;
  address: AdminBookingDetailResponse['pickup'];
}): React.ReactElement {
  const colors = useAppColors();
  return (
    <Card style={styles.address}>
      <View style={styles.addressHeading}>
        <View style={[styles.addressIcon, { backgroundColor: colors.brandSoft }]}>
          <MapPin color={colors.brand} size={21} />
        </View>
        <AppText weight="bold">{title}</AppText>
      </View>
      {address ? (
        <View style={styles.note}>
          {address.flat ? <AppText selectable>{address.flat}</AppText> : null}
          <AppText selectable>{address.line1}</AppText>
          {address.line2 ? <AppText selectable>{address.line2}</AppText> : null}
          <AppText selectable>{address.town}</AppText>
          <AppText selectable weight="bold">
            {address.postcode}
          </AppText>
        </View>
      ) : (
        <AppText muted>Address not recorded.</AppText>
      )}
    </Card>
  );
}
function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.detailRow}>
      <AppText muted style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText weight="semibold" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  toolbarActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  address: { flexBasis: 240, flexGrow: 1 },
  addresses: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  addressHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  addressIcon: { alignItems: 'center', borderRadius: 13, height: 40, justifyContent: 'center', width: 40 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailLabel: { flexBasis: 120, flexGrow: 1 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  detailValue: { flexBasis: 160, flexGrow: 1 },
  note: { gap: 4 },
  payment: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 16,
  },
  paymentCopy: { flexBasis: 130, flexGrow: 1, gap: 3 },
  paymentIcon: { alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  toolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  timing: { gap: 14 },
  timestamp: { gap: 4 },
  total: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 18,
  },
});
