import { useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { appLayout, useAppColors } from '@/theme/theme';

export interface AppTextProps extends TextProps {
  children: React.ReactNode;
  muted?: boolean;
  numeric?: boolean;
  size?: 'display' | 'title' | 'xl' | 'lg' | 'md' | 'sm' | 'xs';
  tone?: 'default' | 'muted' | 'brand' | 'danger' | 'success';
  weight?: 'bold' | 'regular' | 'semibold';
}

const textSizes = {
  display: { fontSize: 44, letterSpacing: -1.2, lineHeight: 52 },
  title: { fontSize: 34, letterSpacing: -0.9, lineHeight: 42 },
  xl: { fontSize: 26, letterSpacing: -0.6, lineHeight: 34 },
  lg: { fontSize: 21, letterSpacing: -0.3, lineHeight: 29 },
  md: { fontSize: 16, letterSpacing: -0.1, lineHeight: 24 },
  sm: { fontSize: 14, letterSpacing: 0, lineHeight: 21 },
  xs: { fontSize: 12, letterSpacing: 0.2, lineHeight: 18 },
} as const;

export function AppText({
  children,
  muted,
  numeric,
  size = 'md',
  style,
  tone = 'default',
  weight = 'regular',
  ...props
}: AppTextProps): React.ReactElement {
  const colors = useAppColors();
  const color = muted || tone === 'muted' ? colors.muted : tone === 'default' ? colors.text : colors[tone];
  const display = numeric || size === 'display' || size === 'title' || size === 'xl';
  const typography: TextStyle = {
    color,
    fontFamily: display
      ? 'BricolageGrotesque_700Bold'
      : weight === 'regular'
        ? 'Manrope_500Medium'
        : 'Manrope_700Bold',
    fontVariant: numeric ? ['tabular-nums'] : [],
    fontWeight: display || weight !== 'regular' ? '700' : '500',
  };
  return (
    <Text {...props} style={[textSizes[size], typography, style]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  padding = 'md',
  style,
  tone = 'default',
}: {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'subtle' | 'brand';
}): React.ReactElement {
  const colors = useAppColors();
  const backgroundColor =
    tone === 'brand' ? colors.brandSoft : tone === 'subtle' ? colors.surfaceMuted : colors.surface;
  return (
    <View
      style={[
        styles.card,
        cardPadding[padding],
        {
          backgroundColor,
          borderColor: tone === 'brand' ? colors.brandSoft : colors.border,
          shadowColor: colors.shadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'danger' | 'neutral' | 'success' | 'warning';
}): React.ReactElement {
  const colors = useAppColors();
  const foreground = tone === 'neutral' ? colors.muted : colors[tone];
  const backgroundColor = tone === 'neutral' ? colors.surfaceMuted : colors[`${tone}Soft`];
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.badgeDot, { backgroundColor: foreground }]}
      />
      <Text style={[styles.badgeText, { color: foreground }]}>{label}</Text>
    </View>
  );
}

export interface ButtonProps {
  accessibilityHint?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  label: string;
  loading?: boolean;
  loadingLabel?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  tone?: 'danger' | 'primary' | 'secondary' | 'brand' | 'ghost';
}

function focusStyle(color: string): ViewStyle {
  return Platform.OS === 'web'
    ? { outlineColor: color, outlineOffset: 3, outlineStyle: 'solid', outlineWidth: 3 }
    : { borderColor: color };
}

export function Button({
  accessibilityHint,
  disabled = false,
  icon,
  label,
  loading = false,
  loadingLabel,
  onPress,
  style,
  tone = 'primary',
}: ButtonProps): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || loading;
  const backgroundColor =
    tone === 'primary'
      ? colors.action
      : tone === 'brand'
        ? colors.brand
        : tone === 'danger'
          ? colors.danger
          : tone === 'ghost'
            ? colors.background
            : colors.surface;
  const color =
    tone === 'primary'
      ? colors.onAction
      : tone === 'brand'
        ? colors.onBrand
        : tone === 'danger'
          ? colors.onDanger
          : colors.text;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={loading ? (loadingLabel ?? `${label}, in progress`) : label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: inactive }}
      disabled={inactive}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onHoverIn={() => {
        setHovered(true);
      }}
      onHoverOut={() => {
        setHovered(false);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor: tone === 'secondary' ? colors.borderStrong : backgroundColor,
          opacity: inactive ? 0.5 : pressed ? 0.76 : hovered ? 0.9 : 1,
        },
        focused && !inactive && focusStyle(colors.focus),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          color={color}
          size="small"
        />
      ) : icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      ) : null}
      <Text style={[styles.buttonText, { color }]}>{loading ? (loadingLabel ?? label) : label}</Text>
    </Pressable>
  );
}

export function IconButton({
  disabled = false,
  icon,
  label,
  onPress,
  tone = 'ghost',
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  tone?: 'ghost' | 'secondary' | 'brand';
}): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor:
            tone === 'brand' ? colors.brandSoft : tone === 'secondary' ? colors.surface : colors.background,
          borderColor: tone === 'secondary' ? colors.borderStrong : colors.background,
          opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
        },
        focused && !disabled && focusStyle(colors.focus),
      ]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {icon}
      </View>
    </Pressable>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeading}>
        <AppText accessibilityRole="header" aria-level={2} size="lg" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText muted size="sm">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export type TextFieldProps = TextInputProps & {
  error?: string;
  hint?: string;
  inputRef?: React.Ref<TextInput>;
  label: string;
};

export function TextField({
  error,
  hint,
  inputRef,
  label,
  onBlur,
  onFocus,
  style,
  ...props
}: TextFieldProps): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  const id = useId();
  const helpId = `${id}-help`;
  const message = error ?? hint;
  return (
    <View style={styles.field}>
      <AppText size="sm" weight="bold">
        {label}
      </AppText>
      <TextInput
        {...props}
        ref={inputRef}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={error ?? hint ?? props.accessibilityHint}
        aria-describedby={message ? helpId : undefined}
        aria-invalid={Boolean(error)}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.brand}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.focus : colors.borderStrong,
            color: colors.text,
            opacity: props.editable === false ? 0.55 : 1,
          },
          focused && focusStyle(error ? colors.danger : colors.focus),
          props.multiline && styles.multiline,
          style,
        ]}
      />
      {message ? (
        <AppText
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          nativeID={helpId}
          size="sm"
          tone={error ? 'danger' : 'muted'}
        >
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

export function SearchField({
  label = 'Search',
  ...props
}: Omit<TextInputProps, 'accessibilityRole'> & { label?: string }): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  const [clearFocused, setClearFocused] = useState(false);
  const input = useRef<TextInput>(null);
  return (
    <View
      style={[
        styles.search,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.focus : colors.borderStrong,
          opacity: props.editable === false ? 0.55 : 1,
        },
        focused && focusStyle(colors.focus),
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.searchGlyph}
      >
        <View style={[styles.searchLens, { borderColor: colors.muted }]} />
        <View style={[styles.searchHandle, { backgroundColor: colors.muted }]} />
      </View>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityRole="search"
        role={Platform.OS === 'web' ? 'searchbox' : undefined}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        placeholder={props.placeholder ?? label}
        placeholderTextColor={colors.placeholder}
        ref={input}
        returnKeyType="search"
        style={[styles.searchInput, { color: colors.text }, props.style]}
      />
      {props.value && props.onChangeText && props.editable !== false ? (
        <Pressable
          accessibilityLabel={`Clear ${label.toLowerCase()}`}
          accessibilityRole="button"
          onBlur={() => {
            setClearFocused(false);
          }}
          onFocus={() => {
            setClearFocused(true);
          }}
          onPress={() => {
            props.onChangeText?.('');
            input.current?.focus();
          }}
          style={({ pressed }) => [
            styles.searchClear,
            { opacity: pressed ? 0.5 : 1 },
            clearFocused && focusStyle(colors.focus),
          ]}
        >
          <Text style={[styles.clearText, { color: colors.muted }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SegmentedControl<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly { disabled?: boolean; label: string; value: Value }[];
  value: Value;
}): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState<Value | null>(null);
  const targets = useRef(new Map<Value, View>());
  function handleKey(event: React.KeyboardEvent<HTMLElement>): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.findIndex((option) => option.value === value);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[index];
    if (!next) return;
    onChange(next.value);
    targets.current.get(next.value)?.focus();
  }
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="tablist"
      style={[styles.segments, { backgroundColor: colors.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ disabled: Boolean(option.disabled), selected }}
            aria-selected={selected}
            disabled={option.disabled}
            key={option.value}
            onBlur={() => {
              setFocused(null);
            }}
            onFocus={() => {
              setFocused(option.value);
            }}
            onPress={() => {
              onChange(option.value);
            }}
            ref={(target) => {
              if (target) targets.current.set(option.value, target);
              else targets.current.delete(option.value);
            }}
            {...(Platform.OS === 'web' ? { onKeyDown: handleKey, tabIndex: selected ? 0 : -1 } : {})}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected ? colors.surfaceElevated : colors.border,
                opacity: option.disabled ? 0.5 : pressed ? 0.7 : 1,
              },
              selected && styles.selectedSegment,
              focused === option.value && focusStyle(colors.focus),
            ]}
          >
            <AppText size="sm" tone={selected ? 'default' : 'muted'} weight={selected ? 'bold' : 'regular'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const cardPadding = StyleSheet.create({
  lg: { padding: 24 },
  md: { padding: 20 },
  none: { padding: 0 },
  sm: { padding: 16 },
});

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  badgeDot: { borderRadius: 3, height: 5, width: 5 },
  badgeText: {
    flexShrink: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    borderRadius: appLayout.controlRadius,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: appLayout.minTouchTarget,
    minWidth: appLayout.minTouchTarget,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    flexShrink: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    textAlign: 'center',
  },
  card: {
    borderRadius: appLayout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    minWidth: 0,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.035,
    shadowRadius: 12,
  },
  clearText: { fontSize: 25, lineHeight: 30, textAlign: 'center' },
  field: { gap: 8, minWidth: 0 },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: appLayout.minTouchTarget,
    justifyContent: 'center',
    width: appLayout.minTouchTarget,
  },
  input: {
    borderRadius: appLayout.controlRadius,
    borderWidth: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 16,
    lineHeight: 24,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  multiline: { minHeight: 112, textAlignVertical: 'top' },
  search: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    minWidth: 0,
    paddingLeft: 16,
  },
  searchClear: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: appLayout.minTouchTarget,
    minWidth: appLayout.minTouchTarget,
  },
  searchGlyph: { height: 20, marginRight: 10, width: 18 },
  searchHandle: {
    borderRadius: 1,
    height: 7,
    left: 13,
    position: 'absolute',
    top: 11,
    transform: [{ rotate: '-45deg' }],
    width: 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 16,
    minHeight: 50,
    minWidth: 0,
    paddingRight: 12,
    paddingVertical: 12,
  },
  searchLens: {
    borderRadius: 8,
    borderWidth: 1.8,
    height: 14,
    left: 0,
    position: 'absolute',
    top: 1,
    width: 14,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  sectionHeading: { flexBasis: 200, flexGrow: 1, gap: 3, minWidth: 0 },
  segment: {
    alignItems: 'center',
    borderRadius: 10,
    flexBasis: 90,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: appLayout.minTouchTarget,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  segments: { borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4 },
  selectedSegment: {
    elevation: 1,
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
  },
});
