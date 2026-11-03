import { Tabs } from 'expo-router/js-tabs';
import { CalendarDays, LayoutDashboard, Menu, Truck, Users } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '@/theme/theme';
import { useAuth } from '@/state/auth';
import { AppLockGate } from '@/components/app-lock-gate';
import { AdminTabBar } from '@/components/admin-tab-bar';
import { AppText } from '@/components/primitives';
import { WebsiteVisitorsHeader } from '@/components/website-visitors-header';
import { AdminHeaderHeightContext, AdminHeaderInsetContext } from '@/shell/admin-header-context';
import { useChatUnread } from '@/data/chat';

export default function AppTabs(): React.ReactElement {
  const auth = useAuth();
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(0);
  const chats = useChatUnread();
  if (auth.appLocked) return <AppLockGate />;
  return (
    <View style={[styles.shell, { backgroundColor: colors.background }]}>
      <View
        onLayout={(event) => {
          setHeaderHeight(event.nativeEvent.layout.height);
        }}
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.separator,
            paddingTop: insets.top + 8,
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 20,
          },
        ]}
      >
        <AppText size="sm" weight="bold">
          Speedy Van
        </AppText>
        <WebsiteVisitorsHeader />
      </View>
      <AdminHeaderInsetContext value={true}>
        <AdminHeaderHeightContext value={headerHeight}>
          <Tabs
            tabBar={(props) => (
              <AdminTabBar {...props} chatUnreadCount={chats.isError ? undefined : chats.data?.unreadCount} />
            )}
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.brand,
              tabBarInactiveTintColor: colors.muted,
              tabBarPosition: width >= 1024 ? 'left' : 'bottom',
              sceneStyle: { backgroundColor: colors.background },
              animation: 'none',
              tabBarHideOnKeyboard: true,
            }}
          >
            <Tabs.Screen
              name="today"
              options={{
                title: 'Today',
                tabBarIcon: ({ color }) => <LayoutDashboard color={color} size={20} />,
              }}
            />
            <Tabs.Screen
              name="bookings/index"
              options={{
                title: 'Bookings',
                tabBarIcon: ({ color }) => <CalendarDays color={color} size={20} />,
              }}
            />
            <Tabs.Screen
              name="schedule"
              options={{ title: 'Schedule', tabBarIcon: ({ color }) => <Truck color={color} size={20} /> }}
            />
            <Tabs.Screen
              name="drivers/index"
              options={{ title: 'Drivers', tabBarIcon: ({ color }) => <Users color={color} size={20} /> }}
            />
            <Tabs.Screen
              name="more"
              options={{ title: 'More', tabBarIcon: ({ color }) => <Menu color={color} size={20} /> }}
            />
            <Tabs.Screen name="bookings/[id]" options={{ href: null }} />
            <Tabs.Screen name="drivers/[id]" options={{ href: null }} />
            <Tabs.Screen name="drivers/add" options={{ href: null }} />
            <Tabs.Screen name="new-booking" options={{ href: null }} />
            <Tabs.Screen name="more-section" options={{ href: null }} />
            <Tabs.Screen name="chat/index" options={{ href: null }} />
            <Tabs.Screen name="chat/[id]" options={{ href: null }} />
          </Tabs>
        </AdminHeaderHeightContext>
      </AdminHeaderInsetContext>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
});
