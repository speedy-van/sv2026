import { Tabs } from 'expo-router';
import { BriefcaseBusiness, CircleUserRound, Clock3, Coins, Route } from 'lucide-react-native';
import { theme } from '@/theme/theme';
import { useAuth } from '@/state/auth';
import { AppLockGate } from '@/components/app-lock-gate';
import { DriverPermissionGates } from '@/components/permission-gates';

export default function AppTabs(): React.ReactElement {
  const auth = useAuth();
  return <DriverAppSession key={auth.sessionVersion} />;
}

function DriverAppSession(): React.ReactElement {
  const auth = useAuth();
  if (auth.appLocked) return <AppLockGate />;
  return <DriverPermissionGates><DriverTabs /></DriverPermissionGates>;
}

function DriverTabs(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today', tabBarIcon: ({ color }) => <Clock3 color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/index" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: ({ color }) => <Coins color={color} size={20} /> }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: ({ color }) => <CircleUserRound color={color} size={20} /> }} />
      <Tabs.Screen name="offers/[id]" options={{ href: null, title: 'Offer', tabBarIcon: ({ color }) => <BriefcaseBusiness color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]" options={{ href: null, title: 'Job', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]/run" options={{ href: null, title: 'Run', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]/report" options={{ href: null, title: 'Report', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]/extra" options={{ href: null, title: 'Extra', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]/camera" options={{ href: null, title: 'Camera', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
      <Tabs.Screen name="jobs/[id]/signature" options={{ href: null, title: 'Signature', tabBarIcon: ({ color }) => <Route color={color} size={20} /> }} />
    </Tabs>
  );
}
