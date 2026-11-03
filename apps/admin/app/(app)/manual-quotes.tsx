import { AdminManualQuoteListSchema, type AdminManualQuoteQuery, formatGBP } from '@sv/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { AppText, Badge, Button, Card, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolSession } from '@/data/admin-tool-session';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';
import { serviceLabel } from '@/data/operations';

type Filter = 'all' | NonNullable<AdminManualQuoteQuery['status']>;
export default function ManualQuotesScreen(): React.ReactElement {
  const session = useAdminToolSession();
  const [filter, setFilter] = useState<Filter>('REQUESTED');
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'manual-quotes', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (filter !== 'all') params.set('status', filter);
      if (pageParam) params.set('cursor', pageParam);
      return session.request(`/api/v1/admin/manual-quotes?${params.toString()}`, AdminManualQuoteListSchema, {
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = session.privateReady ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [];
  return (
    <ScreenState
      title="Quote requests"
      subtitle="Review requests that need a manual price."
      status={
        !session.privateReady || (query.isPending && !session.offline)
          ? 'loading'
          : !items.length && (query.isError || session.offline)
            ? 'error'
            : !items.length
              ? 'empty'
              : 'ready'
      }
      emptyMessage="No quote requests match this filter."
      errorMessage="Quote requests could not be loaded. Check your connection and retry."
      onRetry={() => {
        void query.refetch();
      }}
      toolbar={
        <View style={{ gap: 16 }}>
          <SegmentedControl
            label="Quote request status"
            sizing="content"
            value={filter}
            onChange={setFilter}
            options={[
              { label: 'Requested', value: 'REQUESTED' },
              { label: 'Priced', value: 'PRICED' },
              { label: 'Accepted', value: 'ACCEPTED' },
              { label: 'Declined', value: 'DECLINED' },
              { label: 'Expired', value: 'EXPIRED' },
              { label: 'All', value: 'all' },
            ]}
          />
          <AdminToolFeedback offline={session.offline} />
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        {items.map((item) => (
          <Card key={item.id}>
            <View style={{ gap: 12 }}>
              <Badge label={item.status} />
              <AppText weight="bold">{item.contact.name}</AppText>
              <AppText>
                {serviceLabel(item.service)} · {item.pickupLabel}
                {item.dropoffLabel ? ` → ${item.dropoffLabel}` : ''}
              </AppText>
              <AppText muted>Received {displayBookingCreatedAt(item.createdAt)}</AppText>
              {item.pricePence !== null ? <AppText numeric>{formatGBP(item.pricePence)}</AppText> : null}
              <Button
                label={`Review quote for ${item.contact.name}`}
                tone="secondary"
                onPress={() => {
                  router.push(`/(app)/manual-quote?id=${encodeURIComponent(item.id)}`);
                }}
              />
            </View>
          </Card>
        ))}
        {query.isError ? (
          <AdminToolFeedback error="The latest requests could not be refreshed. Retry before making changes." />
        ) : null}
        {query.hasNextPage ? (
          <Button
            label="Load more requests"
            loading={query.isFetchingNextPage}
            disabled={!session.enabled}
            onPress={() => {
              void query.fetchNextPage();
            }}
          />
        ) : null}
      </View>
    </ScreenState>
  );
}
