import { formatGBP, type AdminBookingSummary } from '@sv/contracts';
import { ChevronRight, Truck } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Card } from './primitives';
import {
  bookingStatusLabel,
  displayAdminDate,
  jobStageLabel,
  serviceLabel,
  slotLabel,
} from '@/data/operations';
import { useAppColors } from '@/theme/theme';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';

function statusTone(status: AdminBookingSummary['status']): 'danger' | 'neutral' | 'success' | 'warning' {
  if (status === 'CANCELLED') return 'danger';
  if (status === 'COMPLETED') return 'success';
  if (status === 'IN_PROGRESS' || status === 'PENDING_PAYMENT') return 'warning';
  return 'neutral';
}

export function JobCard(props: {
  job: AdminBookingSummary;
  onPress?: () => void;
  showDate?: boolean;
}): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  const { job } = props;
  const active = job.status === 'CONFIRMED' || job.status === 'IN_PROGRESS';
  const content = (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <AppText muted size="sm" weight="bold">
          {job.reference}
        </AppText>
        <View style={styles.statuses}>
          <Badge label={bookingStatusLabel(job.status)} tone={statusTone(job.status)} />
          {active && job.dispatchStatus === 'UNASSIGNED' ? (
            <Badge label="Needs a driver" tone="danger" />
          ) : null}
          {active && job.dispatchStatus === 'OFFERED' ? (
            <Badge label="Driver offered" tone="warning" />
          ) : null}
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={styles.routeText}>
          <AppText weight="bold">{job.routeLabel}</AppText>
          <AppText muted size="sm">
            {serviceLabel(job.service)} · {slotLabel(job.slot)}
          </AppText>
          {props.showDate ? (
            <AppText muted size="sm">
              {displayAdminDate(job.moveDate)}
            </AppText>
          ) : null}
          <AppText muted size="sm">
            Created {displayBookingCreatedAt(job.createdAt)}
          </AppText>
        </View>
        {props.onPress ? <ChevronRight color={colors.muted} size={19} /> : null}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.customer}>
          <AppText size="sm">{job.customerName}</AppText>
          {job.driver ? (
            <View style={styles.driver}>
              <Truck color={colors.muted} size={14} />
              <AppText muted size="sm">
                {job.driver.name}
              </AppText>
            </View>
          ) : null}
          {job.status === 'IN_PROGRESS' && job.jobStage !== 'NOT_STARTED' ? (
            <AppText muted size="sm">
              {jobStageLabel(job.jobStage)}
            </AppText>
          ) : null}
        </View>
        <View style={styles.price}>
          <AppText muted size="sm">
            Total
          </AppText>
          <AppText numeric weight="bold">
            {formatGBP(job.totalPence)}
          </AppText>
        </View>
      </View>
    </Card>
  );
  return props.onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.reference}. ${job.routeLabel}. ${displayAdminDate(job.moveDate)}, ${slotLabel(job.slot)}. Booking created ${displayBookingCreatedAt(job.createdAt)}. ${bookingStatusLabel(job.status)}. ${formatGBP(job.totalPence)}.`}
      accessibilityHint="Opens booking details"
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onPress={props.onPress}
      style={({ pressed }) => [
        { borderRadius: 22, opacity: pressed ? 0.72 : 1 },
        focused &&
          Platform.OS === 'web' && {
            outlineColor: colors.focus,
            outlineOffset: 3,
            outlineStyle: 'solid',
            outlineWidth: 3,
          },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  customer: { flex: 1, gap: 5, minWidth: 0 },
  driver: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  footer: {
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingTop: 13,
  },
  price: { alignItems: 'flex-end', gap: 2 },
  routeRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  routeText: { flex: 1, gap: 5, minWidth: 0 },
  statuses: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  topRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
});
