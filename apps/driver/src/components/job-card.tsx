import { router } from 'expo-router';
import { Badge, Button, Card, AppText, Row } from '@/components/primitives';
import type { JobCard } from '@/data/driver';
import { formatAgreedEarning } from '@/earnings/format';

function stageTone(stage: string): 'danger' | 'neutral' | 'success' | 'warning' {
  if (stage === 'COMPLETED') return 'success';
  if (stage === 'NOT_STARTED') return 'neutral';
  return 'warning';
}

export function JobCardView(props: { job: JobCard; mode?: 'offer' | 'run' }): React.ReactElement {
  const action = props.mode === 'offer' ? 'Review offer' : 'Open job';
  const path = props.mode === 'offer' ? `/(app)/offers/${props.job.bookingId}` : `/(app)/jobs/${props.job.bookingId}`;
  return (
    <Card>
      <Row>
        <AppText weight="bold">{props.job.reference}</AppText>
        <Badge label={props.job.jobStage.replaceAll('_', ' ')} tone={stageTone(props.job.jobStage)} />
      </Row>
      <AppText size="lg" weight="bold">{props.job.route}</AppText>
      <AppText muted>{props.job.moveDate} · {props.job.slot} · {props.job.service}</AppText>
      <Row>
        <AppText weight="bold">{formatAgreedEarning(props.job.earningPence)}</AppText>
        <Button label={action} onPress={() => { router.push(path); }} tone="secondary" />
      </Row>
    </Card>
  );
}
