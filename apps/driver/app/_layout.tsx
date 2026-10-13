import 'react-native-gesture-handler';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RootShell } from '@/shell/root-shell';

export default function RootLayout(): React.ReactElement {
  return (
    <RootShell>
      <Slot />
      <StatusBar style="auto" />
    </RootShell>
  );
}
