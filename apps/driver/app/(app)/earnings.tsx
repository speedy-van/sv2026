import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Screen, AppText, Row } from '@/components/primitives';
import { listEarnings } from '@/data/driver';
import { formatPence } from '@/earnings/format';
import { useAuth } from '@/state/auth';

export default function EarningsScreen(): React.ReactElement {
  const { api } = useAuth();
  const earnings = useQuery({ queryFn: () => listEarnings(api), queryKey: ['driver-earnings'] });
  const totals = earnings.data?.totals;
  return (
    <Screen title="Earnings" subtitle="Completed-job earnings and payout status.">
      <Card>
        <Row>
          <AppText weight="bold">Earned</AppText>
          <AppText size="lg" weight="bold">{formatPence(totals?.earnedPence ?? 0)}</AppText>
        </Row>
        <Row>
          <AppText muted>Paid</AppText>
          <AppText>{formatPence(totals?.paidPence ?? 0)}</AppText>
        </Row>
        <Row>
          <AppText muted>Unpaid</AppText>
          <AppText>{formatPence(totals?.unpaidPence ?? 0)}</AppText>
        </Row>
      </Card>
      {earnings.data?.items.map((item) => (
        <Card key={item.id}>
          <Row>
            <AppText weight="bold">{item.bookingReference}</AppText>
            <Badge label={item.paid ? 'Paid' : 'Unpaid'} tone={item.paid ? 'success' : 'warning'} />
          </Row>
          <AppText>{formatPence(item.amountPence)}</AppText>
          <AppText muted>{item.moveDate} · {item.service}</AppText>
        </Card>
      ))}
    </Screen>
  );
}
