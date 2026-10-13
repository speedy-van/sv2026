import { router } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { moreSections } from '@/data/admin';

export default function MoreScreen(): React.ReactElement {
  return (
    <ScreenState title="More" subtitle="Operations, settings, reports, team and system tools.">
      <View style={{ gap: 12 }}>
        {moreSections.map((section) => (
          <Card key={section.key}>
            <AppText weight="bold">{section.title}</AppText>
            <AppText muted>{section.description}</AppText>
            <Button label={`Open ${section.title}`} onPress={() => { router.push({ pathname: '/(app)/more-section', params: { section: section.key } }); }} tone="secondary" />
          </Card>
        ))}
      </View>
    </ScreenState>
  );
}
