import { Volume2, VolumeX } from 'lucide-react-native';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import { AppText, Button } from '@/components/primitives';
import { chatCopy } from '@/content/chat';
import { useChatSound } from '@/notifications/chat-sound-provider';
import { useAppColors } from '@/theme/theme';

export function ChatSoundControl(): React.ReactElement | null {
  const sound = useChatSound();
  const colors = useAppColors();
  if (!sound) return null;
  const Icon = sound.enabled ? Volume2 : VolumeX;
  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <View style={styles.row}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon color={sound.enabled ? colors.brand : colors.muted} size={19} />
        </View>
        <View style={styles.copy}>
          <AppText weight="bold" size="sm">
            {chatCopy.soundTitle}
          </AppText>
          <AppText muted size="xs">
            {sound.enabled
              ? chatCopy.soundOn
              : Platform.OS === 'web'
                ? chatCopy.soundEnableWeb
                : chatCopy.soundOff}
          </AppText>
        </View>
        <View style={styles.switchTarget}>
          <Switch
            accessibilityLabel={chatCopy.soundTitle}
            accessibilityHint={chatCopy.soundHint}
            accessibilityState={{ checked: sound.enabled, disabled: !sound.available || sound.testing }}
            disabled={!sound.available || sound.testing}
            value={sound.enabled}
            onValueChange={sound.toggle}
            trackColor={{ false: colors.borderStrong, true: colors.brand }}
          />
        </View>
        <Button
          label={sound.error ? chatCopy.soundRetry : chatCopy.soundTest}
          loadingLabel={chatCopy.soundTesting}
          loading={sound.testing}
          disabled={!sound.available}
          tone="ghost"
          onPress={sound.test}
        />
      </View>
      {sound.error ? (
        <AppText accessibilityRole="alert" tone="danger" size="sm">
          {sound.error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 8, padding: 12 },
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  copy: { flex: 1, gap: 2, minWidth: 130 },
  switchTarget: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
});
