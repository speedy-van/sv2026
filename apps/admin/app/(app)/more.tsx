import { router } from 'expo-router';
import {
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import {
  AppText,
  Badge,
  Button,
  Card,
  SearchField,
  SectionHeader,
  SegmentedControl,
} from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { useAuth } from '@/state/auth';
import { useAppAppearance, useAppColors, type AppAppearance } from '@/theme/theme';

const tools = [
  {
    description: 'Read website messages and reply to customers',
    icon: MessageCircle,
    key: 'chat',
    route: '/(app)/chat',
    title: 'Live chat',
  },
  {
    description: 'Find a booking and view move details',
    icon: LayoutDashboard,
    key: 'bookings',
    route: '/(app)/bookings',
    title: 'Bookings',
  },
  {
    description: 'Jobs and capacity, one day at a time',
    icon: CalendarDays,
    key: 'schedule',
    route: '/(app)/schedule',
    title: 'Schedule',
  },
  {
    description: 'Driver contacts and daily assignments',
    icon: Users,
    key: 'drivers',
    route: '/(app)/drivers',
    title: 'Drivers',
  },
] as const;

export default function MoreScreen(): React.ReactElement {
  const colors = useAppColors();
  const { preference, setPreference } = useAppAppearance();
  const auth = useAuth();
  const { status, user } = auth;
  const [search, setSearch] = useState('');
  const [focusedTool, setFocusedTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matches = tools.filter((tool) =>
    `${tool.title} ${tool.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const initials = user?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await auth.signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-out could not be completed. Please try again.');
    }
  }

  async function openDeviceSettings(): Promise<void> {
    setError(null);
    try {
      await Linking.openSettings();
    } catch {
      setError(
        'Device settings could not be opened. Open Settings on your device to manage app permissions.',
      );
    }
  }

  return (
    <ScreenState title="More" subtitle="Your workspace and account.">
      <View style={styles.content}>
        <Card>
          <View style={styles.profile}>
            <View style={[styles.avatar, { backgroundColor: colors.background }]}>
              <AppText weight="bold" size="lg">
                {initials || 'SV'}
              </AppText>
            </View>
            <View style={styles.profileText}>
              <AppText weight="bold">{user && user.name !== user.email ? user.name : 'Your account'}</AppText>
              {user ? (
                <AppText muted size="sm">
                  {user.email}
                </AppText>
              ) : null}
              {user ? <Badge label={user.role === 'OWNER' ? 'Owner' : 'Administrator'} /> : null}
            </View>
          </View>
        </Card>

        <SearchField
          label="Find in your workspace"
          placeholder="Search chat, bookings, schedule or drivers"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.section}>
          <SectionHeader title="Workspace" />
          {matches.length > 0 ? (
            <Card style={styles.group}>
              {matches.map((tool, index) => {
                const Icon = tool.icon;
                return (
                  <View key={tool.key}>
                    {index > 0 ? (
                      <View style={[styles.separator, { backgroundColor: colors.border }]} />
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${tool.title}`}
                      onFocus={() => {
                        setFocusedTool(tool.key);
                      }}
                      onBlur={() => {
                        setFocusedTool(null);
                      }}
                      onPress={() => {
                        router.push(tool.route);
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        { backgroundColor: pressed ? colors.background : colors.surface },
                        focusedTool === tool.key &&
                          Platform.OS === 'web' && {
                            outlineColor: colors.focus,
                            outlineOffset: -3,
                            outlineStyle: 'solid',
                            outlineWidth: 3,
                          },
                      ]}
                    >
                      <View style={[styles.toolIcon, { backgroundColor: colors.background }]}>
                        <Icon color={colors.brand} size={21} />
                      </View>
                      <View style={styles.rowText}>
                        <AppText weight="bold">{tool.title}</AppText>
                        <AppText muted size="sm">
                          {tool.description}
                        </AppText>
                      </View>
                      <ChevronRight color={colors.muted} size={18} />
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          ) : (
            <Card>
              <AppText weight="bold">No matching tools</AppText>
              <AppText muted>Try chat, bookings, schedule or drivers.</AppText>
              <Button
                label="Clear search"
                tone="secondary"
                onPress={() => {
                  setSearch('');
                }}
              />
            </Card>
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader title="Appearance" />
          <Card>
            <AppText muted size="sm">
              Choose a look for this session. System follows your device settings.
            </AppText>
            <SegmentedControl<AppAppearance>
              label="Appearance"
              onChange={setPreference}
              options={[
                { label: 'System', value: 'system' },
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
              value={preference}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Account" />
          <Card style={styles.group}>
            {Platform.OS !== 'web' ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open device settings"
                  onFocus={() => {
                    setFocusedTool('settings');
                  }}
                  onBlur={() => {
                    setFocusedTool(null);
                  }}
                  onPress={() => {
                    void openDeviceSettings();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.background : colors.surface },
                    focusedTool === 'settings' &&
                      Platform.OS === 'web' && {
                        outlineColor: colors.focus,
                        outlineOffset: -3,
                        outlineStyle: 'solid',
                        outlineWidth: 3,
                      },
                  ]}
                >
                  <View style={[styles.toolIcon, { backgroundColor: colors.background }]}>
                    <Settings color={colors.muted} size={21} />
                  </View>
                  <View style={styles.rowText}>
                    <AppText weight="bold">Device settings</AppText>
                    <AppText muted size="sm">
                      Notifications and app permissions
                    </AppText>
                  </View>
                  <ChevronRight color={colors.muted} size={18} />
                </Pressable>
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
              </>
            ) : null}
            <View style={styles.session}>
              <View style={styles.sessionLabel}>
                <LogOut color={colors.muted} size={19} />
                <AppText weight="bold">This session</AppText>
              </View>
              <AppText muted size="sm">
                {Platform.OS === 'web'
                  ? 'You stay signed in when you refresh or reopen this browser. Use Sign out to end this session.'
                  : 'Your sign-in is saved securely on this device. Use Sign out to end this session.'}
              </AppText>
              <Button
                label="Sign out"
                tone="secondary"
                loading={status === 'submitting'}
                onPress={() => {
                  void handleSignOut();
                }}
              />
            </View>
          </Card>
          {error ? (
            <View accessibilityRole="alert">
              <AppText tone="danger">{error}</AppText>
            </View>
          ) : null}
        </View>
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', borderRadius: 20, height: 60, justifyContent: 'center', width: 60 },
  content: { gap: 28 },
  group: { gap: 0, overflow: 'hidden', padding: 0 },
  profile: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  profileText: { flex: 1, gap: 5, minWidth: 0 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 13, minHeight: 82, padding: 16 },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  section: { gap: 12 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  session: { gap: 12, padding: 18 },
  sessionLabel: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  toolIcon: { alignItems: 'center', borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
});
