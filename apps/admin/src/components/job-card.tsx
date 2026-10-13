import { formatGBP } from '@sv/contracts';
import { Pressable, View } from 'react-native';
import { Badge, AppText, Card } from './primitives';
import type { JobCard as JobCardData } from '@/data/admin';

function dispatchTone(dispatch: JobCardData['dispatch']): 'danger' | 'success' | 'warning' {
  if (dispatch === 'Needs a driver') return 'danger';
  if (dispatch === 'Driver confirmed') return 'success';
  return 'warning';
}

export function JobCard(props: { job: JobCardData; onPress?: () => void }): React.ReactElement {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText weight="bold">{props.job.reference}</AppText>
            <AppText>{props.job.route}</AppText>
            <AppText muted size="sm">{props.job.service} · {props.job.slot} · {props.job.customer}</AppText>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <AppText weight="bold">{formatGBP(props.job.pricePence)}</AppText>
            <Badge label={props.job.dispatch} tone={dispatchTone(props.job.dispatch)} />
          </View>
        </View>
        <Badge label={props.job.stage} tone={props.job.stage === 'En route' ? 'warning' : 'neutral'} />
      </Card>
    </Pressable>
  );
}
