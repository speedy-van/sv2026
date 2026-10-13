import { AppText, Button, Card } from '@/components/primitives';

export function EmptyState(props: { actionLabel?: string; message: string; onAction?: () => void; title: string }): React.ReactElement {
  return (
    <Card>
      <AppText size="lg" weight="bold">{props.title}</AppText>
      <AppText muted>{props.message}</AppText>
      {props.actionLabel && props.onAction ? <Button label={props.actionLabel} onPress={props.onAction} tone="secondary" /> : null}
    </Card>
  );
}
