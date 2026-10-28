import { router } from 'expo-router';
import { ChevronRight, RefreshCw, Truck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText, Badge, Button, Card, IconButton, SearchField, SectionHeader, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { adminToday, displayAdminDate, slotLabel, useDrivers } from '@/data/operations';
import { useAppColors } from '@/theme/theme';
import { driverCopy } from '@/content/drivers';

type DriverFilter = 'all' | 'ACTIVE' | 'DISABLED' | 'INVITED';
const filters: { label: string; value: DriverFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Invited', value: 'INVITED' },
  { label: 'Disabled', value: 'DISABLED' }
];

export default function DriversScreen(): React.ReactElement {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const [focusedDriver, setFocusedDriver] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  const [filter, setFilter] = useState<DriverFilter>('all');
  useEffect(() => {
    const timeout = setTimeout(() => { setQueryText(search.trim()); }, 300);
    return () => { clearTimeout(timeout); };
  }, [search]);
  const date = adminToday();
  const query = useDrivers({ date, ...(queryText ? { q: queryText } : {}), ...(filter === 'all' ? {} : { status: filter }) });
  const hasRows = (query.data?.items.length ?? 0) > 0;
  const status = query.isPending ? 'loading' : query.isError && !hasRows ? 'error' : hasRows ? 'ready' : 'empty';
  const toolbar = (
    <View style={styles.toolbar}>
      <SearchField label="Find a driver" placeholder="Name, email or phone" value={search} onChangeText={setSearch} maxLength={120} autoCapitalize="none" autoCorrect={false} />
      <SegmentedControl label="Filter driver accounts" options={filters} value={filter} onChange={setFilter} />
      {search || filter !== 'all' ? <View style={styles.reset}><Button label="Clear filters" tone="secondary" onPress={() => { setSearch(''); setQueryText(''); setFilter('all'); }} /></View> : null}
    </View>
  );

  return (
    <ScreenState
      title="Drivers"
      subtitle="Your team, contacts and daily assignments."
      toolbar={toolbar}
      action={<View style={styles.actions}><Button label={driverCopy.add} onPress={() => { router.push('/(app)/drivers/add'); }} /><IconButton label="Refresh drivers" icon={<RefreshCw color={colors.text} size={20} />} tone="ghost" onPress={() => { void query.refetch(); }} /></View>}
      status={status}
      emptyMessage={search || filter !== 'all' ? 'No drivers match these filters. Try another search or clear the filters.' : 'No drivers have been added yet.'}
      errorMessage="Drivers could not be loaded. Check your connection and try again."
      onRetry={() => { void query.refetch(); }}
      onRefresh={() => { void query.refetch(); }}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
    >
      <View style={styles.content}>
        <SectionHeader title="Driver directory" subtitle={`Assignments for ${displayAdminDate(date)}`} />
        <View style={styles.grid}>
          {query.data?.items.map((driver) => (
            <Pressable key={driver.id} accessibilityRole="button" accessibilityLabel={`Open ${driver.name}, ${driver.status.toLowerCase()} account`} onFocus={() => { setFocusedDriver(driver.id); }} onBlur={() => { setFocusedDriver(null); }} onPress={() => { router.push(`/(app)/drivers/${driver.id}`); }} style={({ pressed }) => [styles.driverItem, { flexBasis: width >= 768 ? '48%' : '100%', opacity: pressed ? 0.72 : 1 }, focusedDriver === driver.id && Platform.OS === 'web' && { outlineColor: colors.focus, outlineOffset: 3, outlineStyle: 'solid', outlineWidth: 3 }]}>
              <Card style={styles.driverCard}>
                <View style={styles.driverTop}>
                  <View style={[styles.avatar, { backgroundColor: colors.background }]}><AppText weight="bold">{driver.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</AppText></View>
                  <View style={styles.driverName}>
                    <AppText weight="bold">{driver.name}</AppText>
                    <AppText muted size="sm">{driver.phone ?? driver.email}</AppText>
                  </View>
                  <ChevronRight color={colors.muted} size={18} />
                </View>
                <View style={styles.accountStatus}>
                  <Badge label={driver.status === 'ACTIVE' ? 'Active account' : driver.status === 'INVITED' ? 'Invited' : 'Disabled'} tone={driver.status === 'DISABLED' ? 'danger' : driver.status === 'INVITED' ? 'warning' : 'neutral'} />
                  <AppText muted size="sm">{driver.jobsOnDate === 0 ? 'No jobs today' : `${String(driver.jobsOnDate)} ${driver.jobsOnDate === 1 ? 'job' : 'jobs'} today`}</AppText>
                </View>
                {driver.defaultVan ? <View style={styles.van}><Truck color={colors.muted} size={16} /><View style={styles.vanText}><AppText muted size="sm">{driver.defaultVan.label} · {driver.defaultVan.registration}</AppText></View></View> : null}
                {driver.unavailableSlots.length > 0 ? <AppText muted size="sm">Unavailable: {driver.unavailableSlots.map(slotLabel).join(', ')}</AppText> : null}
              </Card>
            </Pressable>
          ))}
        </View>
        {query.isError && hasRows ? <Card><AppText>The list could not be updated. Your last loaded drivers are shown.</AppText><Button label="Try again" tone="secondary" onPress={() => { if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch(); }} /></Card> : null}
        {query.hasNextPage ? <Button label="Load more drivers" tone="secondary" loading={query.isFetchingNextPage} onPress={() => { void query.fetchNextPage(); }} /> : null}
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accountStatus: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  avatar: { alignItems: 'center', borderRadius: 16, height: 48, justifyContent: 'center', width: 48 },
  content: { gap: 16 },
  driverCard: { flex: 1, gap: 15 },
  driverItem: { borderRadius: 22, flexGrow: 1, minWidth: 0 },
  driverName: { flex: 1, gap: 4, minWidth: 0 },
  driverTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  reset: { alignSelf: 'flex-start' },
  toolbar: { gap: 14 },
  van: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  vanText: { flex: 1, minWidth: 0 }
});
