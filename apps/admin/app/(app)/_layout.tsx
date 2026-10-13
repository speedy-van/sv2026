import { Tabs } from 'expo-router';
import { CalendarDays, LayoutDashboard, Menu, Truck, Users } from 'lucide-react-native';
import { theme } from '@/theme/theme';

export default function AppTabs(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today', tabBarIcon: ({ color }) => <LayoutDashboard color={color} size={20} /> }} />
      <Tabs.Screen name="bookings/index" options={{ title: 'Bookings', tabBarIcon: ({ color }) => <CalendarDays color={color} size={20} /> }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: ({ color }) => <Truck color={color} size={20} /> }} />
      <Tabs.Screen name="drivers/index" options={{ title: 'Drivers', tabBarIcon: ({ color }) => <Users color={color} size={20} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color }) => <Menu color={color} size={20} /> }} />
    </Tabs>
  );
}
