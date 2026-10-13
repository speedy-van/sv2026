import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/primitives';
import { useAppColors } from '@/theme/theme';

export function OfflineBanner(): React.ReactElement | null {
  const [online, setOnline] = useState(true);
  const colors = useAppColors();
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);
  if (online) return null;
  return (
    <View style={{ backgroundColor: colors.warning, padding: 10 }}>
      <AppText size="sm" weight="bold">Offline mode active. Job updates will sync in order.</AppText>
    </View>
  );
}
