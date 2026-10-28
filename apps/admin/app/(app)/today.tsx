import { formatGBP } from '@sv/contracts';
import { router } from 'expo-router';
import { CalendarDays, Check, ChevronLeft, ChevronRight, RefreshCw, Truck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText, Badge, Button, Card, IconButton, SectionHeader } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { JobCard } from '@/components/job-card';
import { adminToday, displayAdminDate, shiftAdminDate, useDashboard } from '@/data/operations';
import { useAppColors } from '@/theme/theme';

export default function TodayScreen(): React.ReactElement {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const [date, setDate] = useState(adminToday);
  const query = useDashboard(date);
  const data = query.data;
  const scheduledJobs =
    data?.jobs.filter((job) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(job.status)) ?? [];
  const isToday = date === adminToday();
  const refresh = (): void => {
    void query.refetch();
  };
  const dateToolbar = (
    <View style={styles.dateBar}>
      <View style={styles.dateCopy}>
        <CalendarDays color={colors.brand} size={20} />
        <AppText size="sm" weight="bold" style={styles.dateText}>
          {displayAdminDate(date)}
        </AppText>
      </View>
      <View style={styles.dateActions}>
        {!isToday ? (
          <Button
            label="Today"
            tone="secondary"
            onPress={() => {
              setDate(adminToday());
            }}
          />
        ) : null}
        <IconButton
          label="Previous day"
          icon={<ChevronLeft color={colors.text} size={20} />}
          onPress={() => {
            setDate(shiftAdminDate(date, -1));
          }}
        />
        <IconButton
          label="Next day"
          icon={<ChevronRight color={colors.text} size={20} />}
          onPress={() => {
            setDate(shiftAdminDate(date, 1));
          }}
        />
      </View>
    </View>
  );

  return (
    <ScreenState
      eyebrow="SPEEDY VAN · OPERATIONS"
      title={isToday ? 'Today' : 'Day overview'}
      subtitle="A clear view of the day ahead."
      toolbar={dateToolbar}
      action={
        <IconButton
          label="Refresh overview"
          icon={<RefreshCw color={colors.text} size={20} />}
          onPress={refresh}
        />
      }
      status={query.isPending ? 'loading' : !data ? 'error' : 'ready'}
      errorMessage="Your overview could not be loaded. Check your connection and try again."
      onRetry={refresh}
      onRefresh={refresh}
      refreshing={query.isRefetching}
    >
      {data ? (
        <>
          {query.isError ? (
            <Card>
              <AppText accessibilityRole="alert">
                The overview could not be updated. Your last loaded information is shown.
              </AppText>
              <Button label="Try again" tone="secondary" onPress={refresh} />
            </Card>
          ) : null}
          <Card tone="brand" padding="lg">
            <View style={styles.overviewHeading}>
              <View style={[styles.heroIcon, { backgroundColor: colors.brand }]}>
                <Truck color={colors.onBrand} size={26} />
              </View>
              <View style={styles.overviewCopy}>
                <AppText size="sm" tone="brand" weight="bold">
                  YOUR DAY AT A GLANCE
                </AppText>
                <AppText size="xl">
                  {data.counts.scheduled === 1
                    ? '1 move scheduled'
                    : `${String(data.counts.scheduled)} moves scheduled`}
                </AppText>
              </View>
            </View>
            <AppText muted>
              {data.counts.needsDriver > 0
                ? `${String(data.counts.needsDriver)} ${data.counts.needsDriver === 1 ? 'move needs' : 'moves need'} a driver. Review the bookings before dispatch.`
                : data.counts.scheduled > 0
                  ? 'No scheduled moves are waiting for a driver. Open a booking for the latest details.'
                  : 'No confirmed moves for this date. You can browse all bookings or check another day.'}
            </AppText>
            <View style={styles.heroActions}>
              <Button
                label="View bookings"
                icon={<ChevronRight color={colors.onAction} size={18} />}
                onPress={() => {
                  router.push('/(app)/bookings');
                }}
              />
            </View>
          </Card>

          <View style={styles.metrics}>
            <Metric
              label="Needs a driver"
              value={String(data.counts.needsDriver)}
              warning={data.counts.needsDriver > 0}
              wide={width >= 1180}
            />
            <Metric label="In progress" value={String(data.counts.inProgress)} wide={width >= 1180} />
            <Metric label="Completed" value={String(data.counts.completed)} wide={width >= 1180} />
            <Metric label="Booked value" value={formatGBP(data.bookedValuePence)} wide={width >= 1180} />
          </View>

          <View style={styles.section}>
            <SectionHeader
              title="Scheduled moves"
              subtitle="Confirmed, in progress and completed moves for this date."
            />
            {scheduledJobs.length > 0 ? (
              scheduledJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onPress={() => {
                    router.push(`/(app)/bookings/${job.id}`);
                  }}
                />
              ))
            ) : (
              <Card padding="lg" style={styles.empty}>
                <View style={[styles.heroIcon, { backgroundColor: colors.surfaceMuted }]}>
                  <CalendarDays color={colors.muted} size={26} />
                </View>
                <AppText size="lg" weight="bold">
                  {data.counts.scheduled > 0 ? 'No moves to show' : 'Room for the next move'}
                </AppText>
                <AppText muted style={styles.emptyCopy}>
                  {data.counts.scheduled > 0
                    ? 'Deleted move records stay in your history and remain included in daily totals.'
                    : 'No scheduled moves for this date. New confirmed bookings will appear here.'}
                </AppText>
                <Button
                  label="Open schedule"
                  tone="secondary"
                  onPress={() => {
                    router.push({ pathname: '/(app)/schedule', params: { date } });
                  }}
                />
              </Card>
            )}
          </View>
          <Card tone="subtle">
            <View style={styles.reassurance}>
              <Check color={colors.muted} size={18} />
              <AppText muted size="sm">
                Times and dates use Europe/London.
              </AppText>
            </View>
            <AppText muted size="sm">
              Daily totals include records in Deleted jobs.
            </AppText>
            {data.counts.pendingPayment > 0 ? (
              <AppText muted size="sm">
                {String(data.counts.pendingPayment)}{' '}
                {data.counts.pendingPayment === 1 ? 'booking is' : 'bookings are'} awaiting payment for this
                date.
              </AppText>
            ) : null}
          </Card>
        </>
      ) : null}
    </ScreenState>
  );
}

function Metric(props: {
  label: string;
  value: string;
  warning?: boolean;
  wide: boolean;
}): React.ReactElement {
  return (
    <Card style={[styles.metric, { flexBasis: props.wide ? '22%' : '45%' }]} padding="sm">
      <AppText muted size="sm">
        {props.label}
      </AppText>
      <AppText numeric size="xl" tone={props.warning ? 'danger' : 'default'}>
        {props.value}
      </AppText>
      {props.warning ? <Badge label="Action needed" tone="danger" /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  dateActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  dateBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  dateCopy: { alignItems: 'center', flexDirection: 'row', flexBasis: 190, flexGrow: 1, gap: 10 },
  dateText: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyCopy: { maxWidth: 400, textAlign: 'center' },
  heroActions: { alignSelf: 'flex-start', marginTop: 4 },
  heroIcon: { alignItems: 'center', borderRadius: 18, height: 54, justifyContent: 'center', width: 54 },
  metric: { flexGrow: 1, gap: 7, minWidth: 120 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  overviewCopy: { flex: 1, gap: 4, minWidth: 0 },
  overviewHeading: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  reassurance: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  section: { gap: 14 },
});
