import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { AlertCircle, Inbox } from 'lucide-react-native';
import { AppText, Button, Card } from './primitives';
import { useAppColors } from '@/theme/theme';

export type ScreenStatus = 'empty' | 'error' | 'loading' | 'ready';

export function ScreenState(props: {
  action?: React.ReactNode;
  children: React.ReactNode;
  emptyMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onRefresh?: () => void;
  status?: ScreenStatus;
  subtitle?: string;
  title: string;
}): React.ReactElement {
  const colors = useAppColors();
  const status = props.status ?? 'ready';
  const body = status === 'loading'
    ? <Skeleton />
    : status === 'empty'
      ? <StateCard icon={<Inbox color={colors.muted} />} message={props.emptyMessage ?? 'Nothing to show yet.'} />
      : status === 'error'
        ? <StateCard icon={<AlertCircle color={colors.danger} />} message={props.errorMessage ?? 'Something went wrong.'} {...(props.onRetry ? { onRetry: props.onRetry } : {})} />
        : props.children;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={props.onRefresh ? <RefreshControl onRefresh={props.onRefresh} refreshing={false} /> : undefined}
      style={{ backgroundColor: colors.background }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText size="lg" weight="bold">{props.title}</AppText>
            {props.subtitle ? <AppText muted size="sm">{props.subtitle}</AppText> : null}
          </View>
          {props.action}
        </View>
        {body}
      </View>
    </ScrollView>
  );
}

function StateCard(props: { icon: React.ReactNode; message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <Card>
      {props.icon}
      <AppText>{props.message}</AppText>
      {props.onRetry ? <Button label="Retry" onPress={props.onRetry} tone="secondary" /> : null}
    </Card>
  );
}

function Skeleton(): React.ReactElement {
  const colors = useAppColors();
  return (
    <View testID="screen-skeleton" style={{ gap: 12 }}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={[styles.skeleton, { backgroundColor: colors.border }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: 920,
    padding: 16,
    width: '100%'
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  skeleton: {
    borderRadius: 14,
    height: 92,
    opacity: 0.72
  }
});
