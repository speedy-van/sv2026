import {
  AdminReportExportResponseSchema,
  AdminReportsQuerySchema,
  AdminReportsResponseSchema,
  formatGBP,
} from '@sv/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { AppText, Button, Card, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { todayInLondon } from '@/data/admin-tool-forms';
import { useAdminToolSession } from '@/data/admin-tool-session';

interface DownloadLink {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}
const browserRuntime = globalThis as {
  document?: { createElement(tag: 'a'): DownloadLink; body: { appendChild(link: DownloadLink): void } };
};

export default function ReportsScreen(): React.ReactElement {
  const session = useAdminToolSession();
  const action = useAdminToolAction(session);
  const today = todayInLondon();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from, to });
  const [validation, setValidation] = useState<string | null>(null);
  const query = useQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'reports', range],
    queryFn: ({ signal }) =>
      session.request(
        `/api/v1/admin/reports?${new URLSearchParams(range).toString()}`,
        AdminReportsResponseSchema,
        { signal },
      ),
  });
  const report = session.privateReady ? query.data : undefined;
  async function exportReport(): Promise<void> {
    await action.run(async () => {
      const csv = await session.request(
        `/api/v1/admin/reports/export?${new URLSearchParams(range).toString()}`,
        AdminReportExportResponseSchema,
      );
      if (Platform.OS === 'web') {
        if (!browserRuntime.document) throw new Error('CSV downloads are unavailable in this browser.');
        const url = URL.createObjectURL(
          new Blob([csv.content], { type: csv.contentType, lastModified: Date.now() }),
        );
        try {
          const link = browserRuntime.document.createElement('a');
          link.href = url;
          link.download = csv.filename;
          browserRuntime.document.body.appendChild(link);
          link.click();
          link.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        await Share.share({ title: csv.filename, message: csv.content });
      }
      return true;
    });
  }
  return (
    <ScreenState
      title="Reports"
      subtitle="Bookings created within your selected dates, in London time."
      status={
        !session.privateReady || (query.isPending && !session.offline)
          ? 'loading'
          : report
            ? 'ready'
            : 'error'
      }
      errorMessage="Reports could not be loaded. Check your connection and retry."
      onRetry={() => {
        void query.refetch();
      }}
      toolbar={
        <View style={{ gap: 12 }}>
          <TextField
            label="From date (YYYY-MM-DD)"
            value={from}
            onChangeText={setFrom}
            maxLength={10}
            editable={!action.busy}
          />
          <TextField
            label="To date (YYYY-MM-DD)"
            value={to}
            onChangeText={setTo}
            maxLength={10}
            editable={!action.busy}
          />
          <Button
            label="Apply dates"
            disabled={!session.enabled || action.busy}
            onPress={() => {
              const parsed = AdminReportsQuerySchema.safeParse({ from, to });
              if (!parsed.success) {
                setValidation('Enter valid dates in order, covering no more than 366 days.');
                return;
              }
              setValidation(null);
              setRange(parsed.data);
            }}
          />
          <AdminToolFeedback offline={session.offline} error={validation ?? action.error} />
        </View>
      }
    >
      {report ? (
        <View style={{ gap: 20 }}>
          <AppText muted>
            Showing {report.from} to {report.to}. Counts include bookings created in this period; these are
            not move-date or payment-date totals.
          </AppText>
          <Card>
            <View style={{ gap: 12 }}>
              <Metric label="Bookings" value={String(report.bookings)} />
              <Metric label="Confirmed" value={String(report.confirmed)} />
              <Metric label="Pending payment" value={String(report.pending)} />
              <Metric label="Completed" value={String(report.completed)} />
              <Metric label="Cancelled" value={String(report.cancelled)} />
              <Metric label="Booking value" value={formatGBP(report.totalPence)} />
              <Metric label="Payments received" value={formatGBP(report.paidPence)} />
              <Metric label="Refunds" value={formatGBP(report.refundedPence)} />
              <Metric label="Net payments" value={formatGBP(report.netPaidPence)} />
              <Metric label="Quotes created" value={String(report.quotes)} />
              <Metric label="Manual quote requests" value={String(report.manualQuotes)} />
            </View>
          </Card>
          <ReportGroups title="By service" items={report.byService} />
          <ReportGroups title="By booking source" items={report.bySource} />
          <ReportGroups title="Top pickup towns" items={report.topTowns} />
          {query.isError ? (
            <AdminToolFeedback error="The latest report could not be refreshed. Retry before exporting." />
          ) : null}
          <Button
            label={Platform.OS === 'web' ? 'Download CSV report' : 'Share CSV data'}
            disabled={!session.enabled || query.isError}
            loading={action.busy}
            onPress={() => {
              void exportReport();
            }}
          />
          <AppText muted size="sm">
            The CSV lists bookings in this period, including customer names, email addresses and payment
            totals.
          </AppText>
        </View>
      ) : null}
    </ScreenState>
  );
}
function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ gap: 4 }}>
      <AppText muted>{label}</AppText>
      <AppText numeric weight="bold">
        {value}
      </AppText>
    </View>
  );
}
function ReportGroups({
  title,
  items,
}: {
  title: string;
  items: { label: string; bookings: number; totalPence: number }[];
}): React.ReactElement {
  return (
    <Card>
      <View style={{ gap: 16 }}>
        <AppText size="lg" weight="bold">
          {title}
        </AppText>
        {items.length ? (
          items.map((item) => (
            <Metric
              key={item.label}
              label={item.label}
              value={`${String(item.bookings)} bookings · ${formatGBP(item.totalPence)}`}
            />
          ))
        ) : (
          <AppText muted>No bookings in this period.</AppText>
        )}
      </View>
    </Card>
  );
}
