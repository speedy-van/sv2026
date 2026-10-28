import { ApiClientError } from '@sv/api-client';
import { formatGBP } from '@sv/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import { JobCard } from '@/components/job-card';
import { AppText, Badge, Button, Card, SectionHeader } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { slotLabel, useDriverDetail } from '@/data/operations';
import { useAppColors } from '@/theme/theme';

function displayDate(value: string, civilDate = true): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
    .format(new Date(civilDate ? `${value}T12:00:00Z` : value));
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return <View style={styles.detailRow}><AppText muted size="sm">{label}</AppText><AppText selectable>{value}</AppText></View>;
}

export default function DriverDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const query = useDriverDetail(id);
  const driver = query.data;
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const [contactError, setContactError] = useState<string | null>(null);
  const [openingContact, setOpeningContact] = useState<'call' | 'email' | null>(null);
  const missing = !id || (query.error instanceof ApiClientError && query.error.status === 404);
  const status = missing ? 'empty' : query.isPending ? 'loading' : query.isError && !driver ? 'error' : 'ready';

  async function openContact(kind: 'call' | 'email', value: string): Promise<void> {
    setContactError(null);
    setOpeningContact(kind);
    try {
      await Linking.openURL(kind === 'call' ? `tel:${value.replace(/[^\d+]/gu, '')}` : `mailto:${encodeURIComponent(value)}`);
    } catch {
      setContactError(kind === 'call' ? 'The phone app could not be opened. You can copy the number above.' : 'The email app could not be opened. You can copy the address above.');
    } finally {
      setOpeningContact(null);
    }
  }

  return (
    <ScreenState
      eyebrow="Drivers"
      title={driver?.name ?? 'Driver details'}
      subtitle="Contact details and assigned moves."
      toolbar={
        <View style={styles.toolbar}>
          <Button label="Back to drivers" tone="ghost" onPress={() => { router.replace('/(app)/drivers'); }} />
          <Button label="Refresh driver" tone="secondary" loading={query.isRefetching} onPress={() => { void query.refetch(); }} disabled={!id} />
        </View>
      }
      status={status}
      emptyMessage="This driver could not be found. Return to the driver directory to choose another account."
      errorMessage="Driver details could not be loaded. Check your connection and try again."
      onRetry={() => { void query.refetch(); }}
      onRefresh={() => { void query.refetch(); }}
      refreshing={query.isRefetching}
    >
      {driver ? (
        <View style={styles.content}>
          {query.isError ? <Card><AppText accessibilityRole="alert">The driver details could not be updated. Your last loaded information is shown.</AppText><Button label="Try again" tone="secondary" onPress={() => { void query.refetch(); }} /></Card> : null}

          <View style={styles.summary}>
            <Badge label={driver.status === 'ACTIVE' ? 'Active account' : driver.status === 'INVITED' ? 'Invited account' : 'Disabled account'} tone={driver.status === 'DISABLED' ? 'danger' : driver.status === 'INVITED' ? 'warning' : 'neutral'} />
            <AppText muted size="sm">{String(driver.jobsOnDate)} {driver.jobsOnDate === 1 ? 'assigned job' : 'assigned jobs'} today</AppText>
          </View>

          <View style={styles.grid}>
            <View style={[styles.column, { flexBasis: width >= 768 ? '48%' : '100%' }]}>
              <Card>
                <SectionHeader title="Contact" />
                <DetailRow label="Email" value={driver.email} />
                <DetailRow label="Phone" value={driver.phone || 'No phone number recorded'} />
                <View style={styles.contactActions}>
                  {driver.phone ? <Button label="Call driver" tone="brand" loading={openingContact === 'call'} disabled={openingContact !== null} onPress={() => { if (driver.phone) void openContact('call', driver.phone); }} /> : null}
                  {driver.email ? <Button label="Email driver" tone="secondary" loading={openingContact === 'email'} disabled={openingContact !== null} onPress={() => { void openContact('email', driver.email); }} /> : null}
                </View>
                {contactError ? <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" size="sm" tone="danger">{contactError}</AppText> : null}
              </Card>
              <Card>
                <SectionHeader title="Driver record" />
                <DetailRow label="Home postcode" value={driver.homePostcode || 'Not recorded'} />
                <DetailRow label="Licence expiry" value={driver.licenceExpiry ? displayDate(driver.licenceExpiry) : 'Not recorded'} />
                <DetailRow label="Right-to-work check recorded" value={driver.rightToWorkAt ? displayDate(driver.rightToWorkAt, false) : 'Not recorded'} />
                <DetailRow label="Configured earnings rate" value={driver.payoutPercent === null ? 'Agreed by phone' : `${String(driver.payoutPercent)}%`} />
                {driver.notes ? <DetailRow label="Notes" value={driver.notes} /> : null}
              </Card>
            </View>

            <View style={[styles.column, { flexBasis: width >= 768 ? '48%' : '100%' }]}>
              <Card tone="subtle">
                <SectionHeader title="Unpaid earnings" />
                <AppText numeric size="display" weight="bold">{formatGBP(driver.unpaidEarningsPence)}</AppText>
                <AppText muted size="sm">Recorded earnings not yet linked to a payout.</AppText>
              </Card>
              <Card>
                <SectionHeader title="Default van" />
                {driver.defaultVan ? <View style={styles.detailRow}><AppText weight="bold">{driver.defaultVan.label}</AppText><AppText selectable muted>{driver.defaultVan.registration}</AppText></View> : <AppText muted>No default van recorded.</AppText>}
              </Card>
              <Card>
                <SectionHeader title="Today's unavailability" />
                {driver.unavailableSlots.length > 0 ? <View style={styles.badges}>{driver.unavailableSlots.map((slot) => <Badge key={slot} label={slotLabel(slot)} tone="warning" />)}</View> : <AppText muted>No unavailable periods recorded for today.</AppText>}
              </Card>
            </View>
          </View>

          <View style={[styles.bookings, { borderTopColor: colors.border }]}>
            <SectionHeader title="Current and upcoming moves" subtitle="Confirmed and in-progress bookings assigned to this driver." />
            {driver.upcomingBookings.length > 0 ? driver.upcomingBookings.map((booking) => <JobCard key={booking.id} job={booking} showDate onPress={() => { router.push(`/(app)/bookings/${booking.id}`); }} />) : <Card><AppText muted>No current or upcoming confirmed bookings are assigned to this driver.</AppText></Card>}
            {driver.hasMoreUpcomingBookings ? <AppText muted size="sm">Showing the next 25 assigned bookings. More bookings are assigned beyond this list.</AppText> : null}
          </View>
        </View>
      ) : null}
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bookings: { borderTopWidth: StyleSheet.hairlineWidth, gap: 14, paddingTop: 24 },
  column: { flexGrow: 1, gap: 16, minWidth: 0 },
  contactActions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  content: { gap: 24 }, detailRow: { gap: 4, minWidth: 0 },
  grid: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  summary: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  toolbar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
});
