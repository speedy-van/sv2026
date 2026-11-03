import type { AdminBookingSummary, BookingStatus } from '@sv/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { JobCard } from '@/components/job-card';
import { AppText, Button, Card, IconButton, SearchField, SectionHeader, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { displayAdminDate, useBookings } from '@/data/operations';
import { useAppColors } from '@/theme/theme';

type BookingFilter = 'all' | 'deleted' | 'needs-driver' | BookingStatus;
const BookingViewSchema = z.enum(['all', 'deleted']);
const BookingNoticeSchema = z.enum(['deleted', 'restored']);
const filters: { label: string; value: BookingFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Needs driver', value: 'needs-driver' },
  { label: 'Unpaid', value: 'PENDING_PAYMENT' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Deleted jobs', value: 'deleted' }
];

export default function BookingsScreen(): React.ReactElement {
  const colors = useAppColors();
  const params = useLocalSearchParams<{ view?: string | string[]; notice?: string | string[] }>();
  const parsedView = BookingViewSchema.safeParse(params.view);
  const routeView = parsedView.success ? parsedView.data : 'all';
  const parsedNotice = BookingNoticeSchema.safeParse(params.notice);
  const notice = parsedNotice.success ? parsedNotice.data : null;
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  const [activeFilter, setActiveFilter] = useState<Exclude<BookingFilter, 'deleted'>>('all');
  const filter: BookingFilter = routeView === 'deleted' ? 'deleted' : activeFilter;
  useEffect(() => {
    if (routeView === 'deleted') setActiveFilter('all');
  }, [routeView]);
  useEffect(() => {
    const timeout = setTimeout(() => { setQueryText(search.trim()); }, 300);
    return () => { clearTimeout(timeout); };
  }, [search]);
  const query = useBookings({
    deleted: filter === 'deleted' ? 'only' : 'exclude',
    ...(queryText ? { q: queryText } : {}),
    ...(filter === 'needs-driver' ? { status: 'CONFIRMED', dispatch: 'UNASSIGNED' } : filter === 'all' || filter === 'deleted' ? {} : { status: filter })
  });
  const groups = useMemo(() => {
    const dates = new Map<string, AdminBookingSummary[]>();
    for (const job of query.data?.items ?? []) {
      const group = dates.get(job.moveDate) ?? [];
      group.push(job);
      dates.set(job.moveDate, group);
    }
    return [...dates.entries()].sort(([first], [second]) => first.localeCompare(second));
  }, [query.data]);
  const hasRows = groups.length > 0;
  const status = query.isPending ? 'loading' : query.isError && !hasRows ? 'error' : hasRows ? 'ready' : 'empty';

  function resetFilters(): void {
    setSearch('');
    setQueryText('');
    setActiveFilter('all');
    router.setParams({ view: 'all' });
  }

  function changeFilter(next: BookingFilter): void {
    setActiveFilter(next === 'deleted' ? 'all' : next);
    router.setParams({ view: next === 'deleted' ? 'deleted' : 'all' });
  }

  const toolbar = (
    <View style={styles.toolbar}>
      {notice ? <Card tone="brand">
        <AppText accessibilityLiveRegion="polite" weight="bold">{notice === 'deleted' ? 'Job moved to Deleted jobs.' : 'Job restored.'}</AppText>
        <View style={styles.reset}><Button label="Dismiss notice" tone="secondary" onPress={() => { router.setParams({ notice: undefined }); }} /></View>
      </Card> : null}
      <SearchField label="Find a booking" placeholder="Reference, name, email, phone or postcode" value={search} onChangeText={setSearch} maxLength={120} autoCapitalize="none" autoCorrect={false} />
      <SegmentedControl label="Filter bookings" options={filters} value={filter} onChange={changeFilter} />
      {filter === 'deleted' ? <AppText muted size="sm">Deleted jobs are kept for your records. Restoring a job does not reactivate a cancelled checkout.</AppText> : null}
      {filter === 'needs-driver' ? <AppText muted size="sm">Confirmed bookings waiting for a driver.</AppText> : null}
      {search || filter !== 'all' ? <View style={styles.reset}><Button label="Clear filters" tone="secondary" onPress={resetFilters} /></View> : null}
    </View>
  );

  return (
    <ScreenState
      title="Bookings"
      subtitle={filter === 'deleted' ? 'Review retained jobs and restore them when needed.' : 'Every move, easy to find.'}
      toolbar={toolbar}
      action={<IconButton label="Refresh bookings" icon={<RefreshCw color={colors.text} size={20} />} tone="ghost" onPress={() => { void query.refetch(); }} />}
      status={status}
      emptyMessage={filter === 'deleted' ? search ? 'No deleted jobs match your search. Try another search or clear the filters.' : 'No deleted jobs. Jobs moved here will remain available for review.' : search || filter !== 'all' ? 'No bookings match these filters. Try another search or clear the filters.' : 'No bookings yet. New bookings will appear here.'}
      errorMessage="Bookings could not be loaded. Check your connection and try again."
      onRetry={() => { void query.refetch(); }}
      onRefresh={() => { void query.refetch(); }}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
    >
      <View style={styles.groups}>
        {groups.map(([date, jobs]) => (
          <View key={date} style={styles.dateGroup}>
            <SectionHeader title={displayAdminDate(date)} />
            {jobs.map((job) => <JobCard key={job.id} job={job} onPress={() => { router.push(`/(app)/bookings/${job.id}`); }} />)}
          </View>
        ))}
        {query.isError && hasRows ? <Card><AppText>The list could not be updated. Your last loaded bookings are shown.</AppText><Button label="Try again" tone="secondary" onPress={() => { if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch(); }} /></Card> : null}
        {query.hasNextPage ? <Button label={filter === 'deleted' ? 'Load more deleted jobs' : 'Load more bookings'} tone="secondary" loading={query.isFetchingNextPage} onPress={() => { void query.fetchNextPage(); }} /> : null}
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  dateGroup: { gap: 12 },
  groups: { gap: 28 },
  reset: { alignSelf: 'flex-start' },
  toolbar: { gap: 14 }
});
