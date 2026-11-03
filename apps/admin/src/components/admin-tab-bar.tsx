import type { BottomTabBarProps } from 'expo-router/js-tabs';
import {
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  Truck,
  UserRound,
  Users,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from './primitives';
import { useAppColors } from '@/theme/theme';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';

const destinations = [
  { name: 'today', label: 'Today', icon: LayoutDashboard },
  { name: 'bookings/index', label: 'Bookings', icon: ListChecks },
  { name: 'schedule', label: 'Schedule', icon: CalendarDays },
  { name: 'drivers/index', label: 'Drivers', icon: Users },
  { name: 'more', label: 'More', icon: MoreHorizontal },
] as const;

export function AdminTabBar({
  state,
  navigation,
  insets,
  chatUnreadCount,
}: BottomTabBarProps & { chatUnreadCount?: number | undefined }): React.ReactElement | null {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const sidebar = width >= 1024;
  const keyboardVisible = useKeyboardVisible();
  const current = state.routes[state.index]?.name;
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const targets = useRef(new Map<string, View>());
  function moveFocus(event: React.KeyboardEvent<HTMLElement>, name: string): void {
    const previous = sidebar ? 'ArrowUp' : 'ArrowLeft';
    const next = sidebar ? 'ArrowDown' : 'ArrowRight';
    if (![previous, next, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = destinations.findIndex((item) => item.name === name);
    const targetIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? destinations.length - 1
          : (index + (event.key === next ? 1 : -1) + destinations.length) % destinations.length;
    const target = destinations[targetIndex];
    if (target) targets.current.get(target.name)?.focus();
  }
  // This is a custom tab bar, so Tabs' tabBarHideOnKeyboard option cannot hide it for us.
  if (!sidebar && keyboardVisible) return null;
  return (
    <View
      style={[
        styles.bar,
        sidebar ? styles.sidebar : styles.bottom,
        {
          backgroundColor: colors.surface,
          borderColor: colors.separator,
          paddingBottom: sidebar ? 20 : Math.max(insets.bottom, 8),
          paddingTop: sidebar ? Math.max(insets.top, 28) : 8,
        },
      ]}
      accessibilityRole="tablist"
    >
      {sidebar ? (
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: colors.action }]}>
            <Truck size={24} color={colors.onAction} strokeWidth={2.2} />
          </View>
          <View>
            <AppText weight="bold">Speedy Van</AppText>
            <AppText size="xs" muted>
              Operations
            </AppText>
          </View>
        </View>
      ) : null}
      <View style={[styles.destinations, sidebar ? styles.sidebarDestinations : styles.bottomDestinations]}>
        {destinations.map((destination) => {
          const route = state.routes.find((item) => item.name === destination.name);
          if (!route) return null;
          const focused = state.routes[state.index]?.key === route.key;
          const selected =
            focused ||
            (destination.name === 'bookings/index' && current?.startsWith('bookings/')) ||
            (destination.name === 'drivers/index' && current?.startsWith('drivers/')) ||
            (destination.name === 'more' && current?.startsWith('chat/'));
          const unread = destination.name === 'more' ? (chatUnreadCount ?? 0) : 0;
          const Icon = destination.icon;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: Boolean(selected) }}
              aria-selected={Boolean(selected)}
              accessibilityLabel={
                unread > 0
                  ? `${destination.label}, ${String(unread)} unread chat messages`
                  : destination.label
              }
              ref={(target) => {
                if (target) targets.current.set(destination.name, target);
                else targets.current.delete(destination.name);
              }}
              onFocus={() => {
                setFocusedKey(route.key);
              }}
              onBlur={() => {
                setFocusedKey(null);
              }}
              {...(Platform.OS === 'web'
                ? {
                    tabIndex: selected ? 0 : -1,
                    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                      moveFocus(event, destination.name);
                    },
                  }
                : {})}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
              style={({ pressed }) => [
                styles.destination,
                sidebar ? styles.sidebarDestination : styles.bottomDestination,
                { backgroundColor: selected ? colors.brandSoft : 'transparent', opacity: pressed ? 0.7 : 1 },
                focusedKey === route.key &&
                  Platform.OS === 'web' && {
                    outlineColor: colors.focus,
                    outlineOffset: 2,
                    outlineStyle: 'solid',
                    outlineWidth: 3,
                  },
              ]}
            >
              <View>
                <Icon
                  color={selected ? colors.brand : colors.muted}
                  size={sidebar ? 21 : 23}
                  strokeWidth={selected ? 2.5 : 1.8}
                />
                {unread > 0 ? (
                  <View style={[styles.unread, { backgroundColor: colors.danger }]}>
                    <AppText
                      size="xs"
                      weight="bold"
                      style={{ color: colors.onDanger, fontSize: 10, lineHeight: 14 }}
                    >
                      {unread > 99 ? '99+' : unread}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText
                size={sidebar ? 'sm' : 'xs'}
                weight={selected ? 'bold' : 'regular'}
                style={{
                  color: selected ? colors.brand : colors.muted,
                  fontSize: sidebar ? 14 : 11,
                  maxWidth: '100%',
                  textAlign: 'center',
                }}
              >
                {destination.label}
              </AppText>
              {sidebar && selected ? (
                <View style={{ marginLeft: 'auto' }}>
                  <ChevronRight color={colors.brand} size={16} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {sidebar ? (
        <View style={[styles.sidebarFooter, { borderColor: colors.separator }]}>
          <View style={[styles.accountIcon, { backgroundColor: colors.surfaceMuted }]}>
            <UserRound color={colors.muted} size={20} />
          </View>
          <View>
            <AppText size="sm" weight="bold">
              Admin workspace
            </AppText>
            <AppText size="xs" muted>
              Speedy Van
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexShrink: 0 },
  sidebar: { width: 224, borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 4, paddingBottom: 36 },
  brandMark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  destinations: { gap: 6 },
  sidebarDestinations: { flexDirection: 'column', flex: 1 },
  bottomDestinations: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 640 },
  destination: { borderRadius: 15, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  sidebarDestination: { flexDirection: 'row', paddingHorizontal: 14, gap: 13 },
  bottomDestination: { flex: 1, gap: 4, paddingVertical: 7 },
  sidebarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingTop: 20,
  },
  accountIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  unread: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -12,
    top: -7,
  },
});
