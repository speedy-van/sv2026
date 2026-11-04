import { View } from 'react-native';
import { AppText } from './primitives';

export function MailHtml({ text }: { html: string; text: string }): React.ReactElement {
  return (
    <View>
      <AppText muted size="sm">
        Formatted viewing is available in the installed app. Plain text is shown here.
      </AppText>
      <AppText selectable>
        {text || 'No plain text version is available. Use the installed app to view the formatted message.'}
      </AppText>
    </View>
  );
}
