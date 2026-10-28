import { Redirect } from 'expo-router';
import { SessionRestoreGate } from '@/components/session-restore-gate';
import { useAuth } from '@/state/auth';

export default function IndexRoute(): React.ReactElement {
  const auth = useAuth();
  if (auth.status === 'restoring') return <SessionRestoreGate />;
  return <Redirect href={auth.status === 'signed-in' ? '/(app)/today' : '/(auth)/sign-in'} />;
}
