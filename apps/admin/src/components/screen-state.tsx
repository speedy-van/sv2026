import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AlertCircle, Inbox } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useContext } from 'react';
import { AppText, Button, Card } from './primitives';
import { appLayout, useAppColors } from '@/theme/theme';
import { AdminHeaderInsetContext } from '@/shell/admin-header-context';

export type ScreenStatus = 'empty' | 'error' | 'loading' | 'ready';

export function ScreenState(props: {
  action?: React.ReactNode;
  children: React.ReactNode;
  emptyMessage?: string;
  errorMessage?: string;
  eyebrow?: string;
  onRetry?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  status?: ScreenStatus;
  subtitle?: string;
  title: string;
  toolbar?: React.ReactNode;
}): React.ReactElement {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInsetHandled = useContext(AdminHeaderInsetContext);
  const status = props.status ?? 'ready';
  const wide = width >= 768;
  const body =
    status === 'loading' ? (
      <Skeleton />
    ) : status === 'empty' ? (
      <StateCard
        icon={<Inbox color={colors.muted} size={28} />}
        message={props.emptyMessage ?? 'There is nothing to show here yet.'}
        title="No results"
      />
    ) : status === 'error' ? (
      <StateCard
        error
        icon={<AlertCircle color={colors.danger} size={28} />}
        message={props.errorMessage ?? 'We could not load this screen. Try again.'}
        title="Could not load"
        {...(props.onRetry ? { onRetry: props.onRetry } : {})}
      />
    ) : (
      props.children
    );
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        props.onRefresh ? (
          <RefreshControl
            onRefresh={props.onRefresh}
            refreshing={props.refreshing ?? false}
            tintColor={colors.brand}
          />
        ) : undefined
      }
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View
        testID="screen-content"
        style={[
          styles.container,
          wide ? styles.containerWide : styles.containerPhone,
          {
            paddingTop: (wide ? 36 : 24) + (topInsetHandled ? 0 : insets.top),
            paddingLeft: (wide ? appLayout.tabletGutter : appLayout.phoneGutter) + insets.left,
            paddingRight: (wide ? appLayout.tabletGutter : appLayout.phoneGutter) + insets.right,
          },
        ]}
      >
        <View style={[styles.header, wide && styles.headerWide]}>
          <View style={styles.heading}>
            {props.eyebrow ? (
              <AppText size="xs" tone="brand" weight="bold">
                {props.eyebrow}
              </AppText>
            ) : null}
            <AppText accessibilityRole="header" aria-level={1} size="title" weight="bold">
              {props.title}
            </AppText>
            {props.subtitle ? (
              <AppText muted size="sm" style={styles.subtitle}>
                {props.subtitle}
              </AppText>
            ) : null}
          </View>
          {props.action ? <View style={styles.action}>{props.action}</View> : null}
        </View>
        {props.toolbar ? <View style={styles.toolbar}>{props.toolbar}</View> : null}
        <View style={styles.body}>{body}</View>
      </View>
    </ScrollView>
  );
}

function StateCard(props: {
  error?: boolean;
  icon: React.ReactNode;
  message: string;
  onRetry?: () => void;
  title: string;
}): React.ReactElement {
  const colors = useAppColors();
  return (
    <Card padding="lg" style={styles.stateCard}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.stateIcon, { backgroundColor: props.error ? colors.dangerSoft : colors.surfaceMuted }]}
      >
        {props.icon}
      </View>
      <AppText accessibilityRole="header" aria-level={2} size="lg" weight="bold">
        {props.title}
      </AppText>
      <AppText
        accessibilityLiveRegion="polite"
        accessibilityRole={props.error ? 'alert' : undefined}
        muted
        style={styles.stateMessage}
      >
        {props.message}
      </AppText>
      {props.onRetry ? (
        <View style={styles.retry}>
          <Button label="Retry" onPress={props.onRetry} tone="brand" />
        </View>
      ) : null}
    </Card>
  );
}

function Skeleton(): React.ReactElement {
  const colors = useAppColors();
  return (
    <View
      accessibilityLabel="Loading screen"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      testID="screen-skeleton"
      style={styles.skeletonGroup}
    >
      {[0, 1, 2].map((item) => (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          key={item}
          style={[styles.skeletonCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.skeletonAvatar, { backgroundColor: colors.border }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonTitle, { backgroundColor: colors.border }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceMuted }]} />
            <View style={[styles.skeletonShortLine, { backgroundColor: colors.surfaceMuted }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'flex-start', flexShrink: 1 },
  body: { gap: 24, minWidth: 0 },
  container: {
    alignSelf: 'center',
    gap: 28,
    maxWidth: appLayout.canvasMaxWidth,
    paddingBottom: 48,
    width: '100%',
  },
  containerPhone: { paddingHorizontal: appLayout.phoneGutter, paddingTop: 24 },
  containerWide: { paddingHorizontal: appLayout.tabletGutter, paddingTop: 36 },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  headerWide: { alignItems: 'center', gap: 24 },
  heading: { flexBasis: 210, flexGrow: 1, gap: 6, minWidth: 0 },
  retry: { alignSelf: 'center', marginTop: 8, minWidth: 160 },
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  skeletonAvatar: { borderRadius: 14, height: 44, width: 44 },
  skeletonCard: {
    alignItems: 'center',
    borderRadius: appLayout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 120,
    padding: 20,
  },
  skeletonCopy: { flex: 1, gap: 10 },
  skeletonGroup: { gap: 14 },
  skeletonLine: { borderRadius: 4, height: 12, width: '90%' },
  skeletonShortLine: { borderRadius: 4, height: 12, width: '58%' },
  skeletonTitle: { borderRadius: 5, height: 16, width: '65%' },
  stateCard: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 64,
    justifyContent: 'center',
    marginBottom: 4,
    width: 64,
  },
  stateMessage: { maxWidth: 420, textAlign: 'center' },
  subtitle: { maxWidth: 620 },
  toolbar: { gap: 16, minWidth: 0 },
});
