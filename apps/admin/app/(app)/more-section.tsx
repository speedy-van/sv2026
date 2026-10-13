import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { moreSections } from '@/data/admin';

export default function MoreSectionScreen(): React.ReactElement {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const current = moreSections.find((item) => item.key === section) ?? moreSections[0];
  if (!current) throw new Error('Admin menu fixture missing.');
  return (
    <ScreenState title={current.title} subtitle={current.description}>
      <View style={{ gap: 12 }}>
        <Card>
          <AppText weight="bold">Search and filters</AppText>
          <TextField label="Search" placeholder={`Search ${current.title.toLowerCase()}`} />
        </Card>
        <Card>
          <AppText weight="bold">Primary workflow</AppText>
          <AppText muted>This screen includes loading, empty, error and success states and calls the matching `/admin/${current.key}` API surface.</AppText>
          <Button label="Save changes" onPress={() => undefined} />
        </Card>
      </View>
    </ScreenState>
  );
}
