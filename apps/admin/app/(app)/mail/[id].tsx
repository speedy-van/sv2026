import { useLocalSearchParams } from 'expo-router';
import { MailThread } from '@/components/mail-thread';

export default function MailConversationScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return <MailThread id={typeof params.id === 'string' ? params.id : ''} />;
}
