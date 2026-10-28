import { IsoDateSchema } from '@sv/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { JobCard } from '@/components/job-card';
import { AppText, Badge, Button, Card, IconButton, SectionHeader } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { SlotClosureControl } from '@/components/slot-closure-control';
import { adminToday, displayAdminDate, shiftAdminDate, slotLabel, useSchedule } from '@/data/operations';
import { useAppColors } from '@/theme/theme';

export default function ScheduleScreen(): React.ReactElement {
  const colors = useAppColors();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const requestedDate = IsoDateSchema.safeParse(params.date);
  const date = requestedDate.success ? requestedDate.data : adminToday();
  const query = useSchedule(date);
  const today = adminToday();
  const toolbar = (
    <Card style={styles.dateControl}>
      <View style={styles.dateRow}>
        <IconButton
          label="Previous day"
          icon={<ChevronLeft color={colors.text} size={22} />}
          tone="ghost"
          onPress={() => {
            router.setParams({ date: shiftAdminDate(date, -1) });
          }}
        />
        <View style={styles.dateLabel}>
          <AppText weight="bold" style={styles.centerText}>
            {displayAdminDate(date)}
          </AppText>
          {date === today ? (
            <AppText muted size="sm">
              Today
            </AppText>
          ) : null}
        </View>
        <IconButton
          label="Next day"
          icon={<ChevronRight color={colors.text} size={22} />}
          tone="ghost"
          onPress={() => {
            router.setParams({ date: shiftAdminDate(date, 1) });
          }}
        />
      </View>
      {date !== today ? (
        <Button
          label="Back to today"
          tone="secondary"
          onPress={() => {
            router.setParams({ date: adminToday() });
          }}
        />
      ) : null}
    </Card>
  );

  return (
    <ScreenState
      title="Schedule"
      subtitle="A clear view of the day ahead."
      toolbar={toolbar}
      action={
        <IconButton
          label="Refresh schedule"
          icon={<RefreshCw color={colors.text} size={20} />}
          tone="ghost"
          onPress={() => {
            void query.refetch();
          }}
        />
      }
      status={query.isPending ? 'loading' : !query.data ? 'error' : 'ready'}
      errorMessage="The schedule could not be loaded. Check your connection and try again."
      onRetry={() => {
        void query.refetch();
      }}
      onRefresh={() => {
        void query.refetch();
      }}
      refreshing={query.isRefetching}
    >
      <View style={styles.content}>
        {query.isError && query.data ? (
          <Card>
            <AppText accessibilityRole="alert">The schedule could not be updated. Your last loaded information is shown.</AppText>
            <Button label="Try again" tone="secondary" onPress={() => { void query.refetch(); }} />
          </Card>
        ) : null}
        <View style={styles.section}>
          <SectionHeader
            title="Capacity"
            subtitle="Review capacity or close a time window to new bookings."
          />
          <View style={styles.capacityGrid}>
            {query.data?.slots.map((slot) => {
              const used = slot.confirmedUnits + slot.heldUnits;
              const proportion =
                slot.configuredCapacity > 0 ? Math.min(1, used / slot.configuredCapacity) : 0;
              return (
                <Card key={`${date}-${slot.slot}`} style={styles.capacityCard}>
                  <View style={styles.slotHeader}>
                    <AppText weight="bold">{slotLabel(slot.slot)}</AppText>
                    <Badge
                      label={
                        slot.manualClosure
                          ? 'Manually closed'
                          : slot.configuredCapacity === 0
                            ? 'Closed by rules'
                            : slot.availableUnits === 0
                              ? 'At capacity'
                              : `${String(slot.availableUnits)} ${slot.availableUnits === 1 ? 'unit' : 'units'} free`
                      }
                      tone={
                        slot.capacity === 0 ? 'neutral' : slot.availableUnits === 0 ? 'warning' : 'success'
                      }
                    />
                  </View>
                  <AppText muted size="sm">
                    {String(used)} of {String(slot.configuredCapacity)} units used
                  </AppText>
                  <View
                    accessibilityLabel={`${slotLabel(slot.slot)}: ${String(used)} of ${String(slot.configuredCapacity)} capacity units used`}
                    style={[styles.capacityTrack, { backgroundColor: colors.border }]}
                  >
                    <View
                      style={[styles.capacityFill, { backgroundColor: colors.brand, flex: proportion }]}
                    />
                    <View style={{ flex: 1 - proportion }} />
                  </View>
                  <AppText muted size="sm">
                    {String(slot.confirmedUnits)} confirmed · {String(slot.heldUnits)} held
                  </AppText>
                  <SlotClosureControl date={date} window={slot} />
                </Card>
              );
            })}
          </View>
        </View>
        {query.data?.jobs.length === 0 ? (
          <Card>
            <AppText weight="bold">No jobs to show for this day</AppText>
            <AppText muted>Choose another day or review Deleted jobs in Bookings.</AppText>
          </Card>
        ) : (
          query.data?.slots.map((slot) => {
            const jobs = query.data.jobs.filter((job) => job.slot === slot.slot);
            return jobs.length > 0 ? (
              <View key={slot.slot} style={styles.section}>
                <SectionHeader title={slotLabel(slot.slot)} />
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onPress={() => {
                      router.push(`/(app)/bookings/${job.id}`);
                    }}
                  />
                ))}
              </View>
            ) : null;
          })
        )}
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  capacityCard: { flexBasis: 240, flexGrow: 1, gap: 13 },
  capacityFill: { borderRadius: 99, height: '100%' },
  capacityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  capacityTrack: { borderRadius: 99, flexDirection: 'row', height: 6, overflow: 'hidden' },
  centerText: { textAlign: 'center' },
  content: { gap: 28 },
  dateControl: { gap: 12, padding: 8 },
  dateLabel: { alignItems: 'center', flex: 1, gap: 4, minWidth: 0, paddingVertical: 7 },
  dateRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  section: { gap: 14 },
  slotHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
});
