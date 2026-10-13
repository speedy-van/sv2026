import { View } from 'react-native';
import { Button, Card, AppText } from './primitives';

export function SheetList(props: { items: readonly string[]; onSelect?: (item: string) => void }): React.ReactElement {
  return (
    <Card>
      <AppText weight="bold">Actions</AppText>
      <View style={{ gap: 10 }}>
        {props.items.map((item) => (
          <Button key={item} label={item} onPress={() => props.onSelect?.(item)} tone="secondary" />
        ))}
      </View>
    </Card>
  );
}
