import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText } from './primitives';
import { useAppColors } from '@/theme/theme';

export function OfflineBanner(): React.ReactElement | null {
  const [offline, setOffline] = useState(false);
  const colors = useAppColors();
  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
  }, []);
  if (!offline) return null;
  return (
    <View style={{ backgroundColor: colors.danger, padding: 10 }}>
      <AppText size="sm" weight="bold" style={{ color: colors.onDanger }}>
        You're offline. Showing the last loaded information.
      </AppText>
    </View>
  );
}
