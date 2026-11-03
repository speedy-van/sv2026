import {
  AdminAbandonedCheckoutsResponseSchema,
  AdminBookingActivityResponseSchema,
  AdminBookingsResponseSchema,
  formatGBP,
} from '@sv/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, SegmentedControl } from '@/components/primitives';
import { JobCard } from '@/components/job-card';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolSession, type AdminToolSession } from '@/data/admin-tool-session';
import { displayAdminDate, serviceLabel, slotLabel } from '@/data/operations';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';

type Section = 'activity' | 'pending' | 'abandoned';
const sections: { label: string; value: Section }[] = [
  { label: 'Booking activity', value: 'activity' },
  { label: 'Pending payment', value: 'pending' },
  { label: 'Abandoned', value: 'abandoned' },
];
const stages = {
  SERVICE: 'Choosing a service',
  MOVE: 'Entering move details',
  ITEMS: 'Adding items',
  DATE: 'Choosing a date',
  PAYMENT: 'At payment',
} as const;

export default function LeadsScreen(): React.ReactElement {
  const session = useAdminToolSession();
  const [section, setSection] = useState<Section>('activity');
  const toolbar = (
    <View style={styles.stack}>
      <SegmentedControl
        label="Lead views"
        options={sections}
        sizing="content"
        value={section}
        onChange={setSection}
      />
      <Button
        label="Quote requests"
        tone="secondary"
        onPress={() => {
          router.push('/(app)/manual-quotes');
        }}
      />
      {session.offline ? (
        <AppText accessibilityRole="alert">You're offline. Reconnect to update leads.</AppText>
      ) : null}
    </View>
  );
  if (!session.privateReady)
    return (
      <ScreenState title="Leads" status="loading">
        {null}
      </ScreenState>
    );
  if (section === 'pending')
    return <PendingLeads key={session.actorId} session={session} toolbar={toolbar} />;
  if (section === 'abandoned')
    return <AbandonedLeads key={session.actorId} session={session} toolbar={toolbar} />;
  return <ActivityLeads key={session.actorId} session={session} toolbar={toolbar} />;
}

interface ListProps {
  session: AdminToolSession;
  toolbar: React.ReactNode;
}
function ActivityLeads({ session, toolbar }: ListProps): React.ReactElement {
  const [scope, setScope] = useState<'active' | 'recent'>('active');
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'booking-activity', scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(
        `/api/v1/admin/leads/activity?scope=${scope}&limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        AdminBookingActivityResponseSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: session.enabled ? 20_000 : false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = query.data?.pages[0];
  return (
    <ScreenState
      title="Booking activity"
      subtitle="See where consenting visitors are in the booking form."
      toolbar={
        <View style={styles.stack}>
          {toolbar}
          <SegmentedControl
            label="Activity period"
            options={[
              { label: 'Active now', value: 'active' },
              { label: 'Last 24 hours', value: 'recent' },
            ]}
            value={scope}
            onChange={setScope}
          />
          <AppText muted>
            Visitors are anonymous until they submit a booking. Only browsers that allow analytics appear
            here.
          </AppText>
          {summary ? (
            <AppText>
              {summary.counts.active} active in the last {summary.activeWindowSeconds} seconds.
            </AppText>
          ) : null}
        </View>
      }
      status={
        query.isPending && !session.offline
          ? 'loading'
          : (query.isError && !items.length) || (session.offline && !query.data)
            ? 'error'
            : items.length
              ? 'ready'
              : 'empty'
      }
      emptyMessage={
        scope === 'active'
          ? 'No consenting visitors are currently using the booking form.'
          : 'No booking activity was recorded in the last 24 hours.'
      }
      errorMessage="Booking activity could not be loaded. Reconnect and retry."
      onRetry={() => {
        void query.refetch();
      }}
      onRefresh={() => {
        void query.refetch();
      }}
      refreshing={query.isRefetching}
    >
      {items.map((item) => (
        <Card key={item.id}>
          <Badge
            label={item.active ? 'Active now' : 'Last seen'}
            tone={item.active ? 'success' : 'neutral'}
          />
          <AppText weight="bold">{item.booking?.customerName ?? 'Anonymous visitor'}</AppText>
          <AppText>{stages[item.stage]}</AppText>
          {item.service ? <AppText muted>{serviceLabel(item.service)}</AppText> : null}
          <AppText size="sm" muted>
            Last activity: {displayBookingCreatedAt(item.lastSeenAt)}
          </AppText>
          {item.booking ? (
            <Button
              label={`Open ${item.booking.reference}`}
              tone="secondary"
              onPress={() => {
                if (item.booking) router.push(`/(app)/bookings/${encodeURIComponent(item.booking.id)}`);
              }}
            />
          ) : null}
        </Card>
      ))}
      <ListFooter
        session={session}
        failed={query.isError}
        more={query.hasNextPage}
        loading={query.isFetchingNextPage}
        retry={() => {
          void query.refetch();
        }}
        load={() => {
          void query.fetchNextPage();
        }}
      />
    </ScreenState>
  );
}

function PendingLeads({ session, toolbar }: ListProps): React.ReactElement {
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'pending-leads'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(
        `/api/v1/admin/bookings?status=PENDING_PAYMENT&deleted=exclude&limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        AdminBookingsResponseSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: session.enabled ? 20_000 : false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ScreenState
      title="Pending payment"
      subtitle="Customers who submitted a booking but have not completed payment."
      toolbar={toolbar}
      status={
        query.isPending && !session.offline
          ? 'loading'
          : (query.isError && !items.length) || (session.offline && !query.data)
            ? 'error'
            : items.length
              ? 'ready'
              : 'empty'
      }
      emptyMessage="No bookings are waiting for payment."
      errorMessage="Pending bookings could not be loaded. Reconnect and retry."
      onRetry={() => {
        void query.refetch();
      }}
      onRefresh={() => {
        void query.refetch();
      }}
      refreshing={query.isRefetching}
    >
      {items.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          showDate
          onPress={() => {
            router.push(`/(app)/bookings/${encodeURIComponent(job.id)}`);
          }}
        />
      ))}
      <ListFooter
        session={session}
        failed={query.isError}
        more={query.hasNextPage}
        loading={query.isFetchingNextPage}
        retry={() => {
          void query.refetch();
        }}
        load={() => {
          void query.fetchNextPage();
        }}
      />
    </ScreenState>
  );
}

function AbandonedLeads({ session, toolbar }: ListProps): React.ReactElement {
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'abandoned-leads'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(
        `/api/v1/admin/checkouts/abandoned?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        AdminAbandonedCheckoutsResponseSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ScreenState
      title="Abandoned checkouts"
      subtitle="Expired online bookings created within the last 30 days."
      toolbar={toolbar}
      status={
        query.isPending && !session.offline
          ? 'loading'
          : (query.isError && !items.length) || (session.offline && !query.data)
            ? 'error'
            : items.length
              ? 'ready'
              : 'empty'
      }
      emptyMessage="No abandoned checkouts were found in the last 30 days."
      errorMessage="Abandoned checkouts could not be loaded. Reconnect and retry."
      onRetry={() => {
        void query.refetch();
      }}
      onRefresh={() => {
        void query.refetch();
      }}
      refreshing={query.isRefetching}
    >
      {items.map((item) => (
        <Card key={item.id}>
          <AppText weight="bold">
            {item.reference} · {item.customerName}
          </AppText>
          <AppText>{item.routeLabel}</AppText>
          <AppText muted>
            {displayAdminDate(item.moveDate)} · {slotLabel(item.slot)} · {formatGBP(item.totalPence)}
          </AppText>
          <AppText size="sm" muted>
            Created: {displayBookingCreatedAt(item.createdAt)}
          </AppText>
          {item.expiredAt ? (
            <AppText size="sm" muted>
              Expired: {displayBookingCreatedAt(item.expiredAt)}
            </AppText>
          ) : null}
          <Button
            label="View booking and contact details"
            tone="secondary"
            onPress={() => {
              router.push(`/(app)/bookings/${encodeURIComponent(item.id)}`);
            }}
          />
        </Card>
      ))}
      <ListFooter
        session={session}
        failed={query.isError}
        more={query.hasNextPage}
        loading={query.isFetchingNextPage}
        retry={() => {
          void query.refetch();
        }}
        load={() => {
          void query.fetchNextPage();
        }}
      />
    </ScreenState>
  );
}

function ListFooter(props: {
  session: AdminToolSession;
  failed: boolean;
  more: boolean;
  loading: boolean;
  retry: () => void;
  load: () => void;
}): React.ReactElement {
  return (
    <View style={styles.stack}>
      {props.failed ? (
        <Card>
          <AppText accessibilityRole="alert">
            The list could not be updated. Previously loaded records are shown.
          </AppText>
          <Button
            label="Retry list"
            tone="secondary"
            disabled={!props.session.enabled}
            onPress={props.retry}
          />
        </Card>
      ) : null}
      {props.more ? (
        <Button
          label="Load more"
          tone="secondary"
          disabled={!props.session.enabled}
          loading={props.loading}
          onPress={props.load}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ stack: { gap: 12 } });
