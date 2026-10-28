import { useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card } from './primitives';
import { useVisitorPresence } from '@/data/visitor-presence';
import { useAppColors } from '@/theme/theme';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    }).catch(() => {
      // When the preference cannot be read, keep the safer non-animated presentation.
      if (active) setReduced(true);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function VisitorCount({ value, reduced }: { value: number; reduced: boolean }): React.ReactElement {
  const [count] = useState(() => new Animated.Value(value));
  const [drop] = useState(() => new Animated.Value(0));
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const listener = count.addListener(({ value: next }) => {
      current.current = next;
      setDisplay(Math.round(next));
    });
    return () => { count.removeListener(listener); };
  }, [count]);
  useEffect(() => {
    count.stopAnimation();
    drop.stopAnimation();
    if (reduced || current.current === value) {
      count.setValue(value);
      drop.setValue(0);
      return;
    }
    drop.setValue(-7);
    const animation = Animated.parallel([
      Animated.timing(count, { toValue: value, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false, isInteraction: false }),
      Animated.timing(drop, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
    ]);
    animation.start();
    return () => { animation.stop(); };
  }, [count, drop, reduced, value]);
  return (
    <Animated.View
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      testID="visitor-count-animation" style={{ transform: [{ translateY: drop }] }}
    >
      <AppText numeric size="lg" testID="visitor-count">{display.toLocaleString('en-GB')}</AppText>
    </Animated.View>
  );
}

function checkedAt(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: 'Europe/London', timeZoneName: 'short',
  }).format(new Date(value));
}

export function WebsiteVisitorsHeader(): React.ReactElement | null {
  const presence = useVisitorPresence();
  const colors = useAppColors();
  const reduced = useReducedMotion();
  const [showInfo, setShowInfo] = useState(false);
  const [focused, setFocused] = useState<'pill' | 'done' | null>(null);
  const trigger = useRef<View>(null);
  const done = useRef<View>(null);
  const id = useId();
  const { query } = presence;
  const data = query.data;
  const status = presence.offline ? 'Offline' : !presence.foreground ? 'Paused'
    : query.isError ? 'Unavailable' : presence.outdated ? 'Out of date' : null;
  const loading = !data && query.isPending && !status;
  const readableCount = data ? data.activeVisitors.toLocaleString('en-GB') : null;
  const label = data
    ? `Visitors now: ${readableCount ?? ''}${status ? `. ${status}; last count shown` : ''}. Active consenting browsers within 90 seconds.`
    : `Visitors now, ${loading ? 'loading' : status?.toLowerCase() ?? 'unavailable'}.`;
  if (!presence.authorized) return null;
  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button" accessibilityLabel={label}
        accessibilityHint="Explains how website visitor activity is measured."
        accessibilityState={{ busy: loading }}
        onPress={() => { setShowInfo(true); }}
        onFocus={() => { setFocused('pill'); }} onBlur={() => { setFocused(null); }}
        style={({ pressed }) => [styles.touch, { opacity: pressed ? 0.72 : 1 },
          focused === 'pill' && Platform.OS === 'web' && { outlineColor: colors.focus, outlineOffset: 2, outlineStyle: 'solid', outlineWidth: 3 },
        ]}
      >
        <View testID="visitor-presence-pill" style={[styles.pill, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.dot, { backgroundColor: data && !status ? colors.success : colors.muted }]} />
          <View style={styles.label}>
            <AppText size="xs" weight="bold">Visitors now</AppText>
            {!status ? <AppText muted size="xs">Analytics opt-in</AppText> : null}
            {status ? <AppText muted size="xs">{data ? `Last count · ${status}` : status}</AppText> : null}
          </View>
          {data ? <VisitorCount key={presence.actorId} value={data.activeVisitors} reduced={reduced || presence.outdated} />
            : loading ? <View testID="visitor-count-skeleton" style={[styles.skeleton, { backgroundColor: colors.border }]} />
              : <AppText numeric size="lg" accessibilityElementsHidden>—</AppText>}
        </View>
      </Pressable>
      <Modal visible={showInfo} transparent animationType={reduced ? 'none' : 'fade'}
        accessibilityLabel="Website visitors" role="dialog"
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onShow={() => { done.current?.focus(); }}
        onDismiss={() => { trigger.current?.focus(); }}
        onRequestClose={() => { setShowInfo(false); }}>
        <SafeAreaView accessibilityViewIsModal style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.42)' }]}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Card padding="lg" style={styles.dialog}>
              <AppText accessibilityRole="header" aria-level={2} nativeID={`${id}-title`} size="xl">Website visitors</AppText>
              <AppText nativeID={`${id}-description`}>Counts consenting browser sessions active within the last 90 seconds. This is an estimate of activity, not an exact count of people; visitors who decline analytics are excluded.</AppText>
              {data?.activeVisitors === 0 ? <AppText size="sm">A visitor appears after choosing analytics cookies on the website. A zero does not mean the website is empty: visitors who have not chosen analytics are not counted.</AppText> : null}
              <AppText muted>Updates every 15 seconds while this app is open, unlocked and online.</AppText>
              {data ? <AppText size="sm">Last checked: {checkedAt(data.generatedAt)}</AppText> : null}
              {status ? <AppText accessibilityRole="alert" tone={query.isError ? 'danger' : 'muted'}>
                {presence.offline ? 'You are offline. Any last count shown is not live.'
                  : !presence.foreground ? 'Updates are paused while the app is in the background.'
                    : data ? 'The last count could not be updated. Refresh to check current activity.'
                      : 'The visitor count is unavailable. Refresh to try again.'}
              </AppText> : null}
              <Button label="Refresh count" loading={query.isFetching} tone="secondary"
                disabled={presence.offline || !presence.foreground}
                onPress={() => { void query.refetch(); }} />
              <Pressable ref={done} accessibilityRole="button" accessibilityLabel="Done"
                onFocus={() => { setFocused('done'); }} onBlur={() => { setFocused(null); }}
                onPress={() => { setShowInfo(false); }}
                style={({ pressed }) => [styles.done, { backgroundColor: colors.action, opacity: pressed ? 0.72 : 1 },
                  focused === 'done' && Platform.OS === 'web' && { outlineColor: colors.focus, outlineOffset: 2, outlineStyle: 'solid', outlineWidth: 3 },
                ]}>
                <AppText weight="bold" style={{ color: colors.onAction }}>Done</AppText>
              </Pressable>
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  touch: { minHeight: 48, minWidth: 48, justifyContent: 'center', borderRadius: 22, paddingVertical: 6 },
  pill: { minHeight: 32, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1 },
  skeleton: { width: 21, height: 20, borderRadius: 6 },
  backdrop: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { gap: 16, maxWidth: 440, width: '100%' },
  done: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: 12 },
});
