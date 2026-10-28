import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColors } from '@/theme/theme';

export function Screen(props: { children: React.ReactNode; title?: string | undefined; subtitle?: string | undefined }): React.ReactElement {
  const colors = useAppColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        {props.title ? (
          <View style={{ gap: 4 }}>
            <Text style={[styles.title, { color: colors.text }]}>{props.title}</Text>
            {props.subtitle ? <AppText muted>{props.subtitle}</AppText> : null}
          </View>
        ) : null}
        {props.children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function AppText({ children, muted, size = 'md', weight, ...props }: TextProps & { children: React.ReactNode; muted?: boolean; size?: 'lg' | 'md' | 'sm'; weight?: 'bold' | 'regular' }): React.ReactElement {
  const colors = useAppColors();
  return (
    <Text
      {...props}
      style={[{
        color: muted ? colors.muted : colors.text,
        fontFamily: weight === 'bold' ? 'Manrope_700Bold' : 'Manrope_500Medium',
        fontSize: size === 'lg' ? 22 : size === 'sm' ? 13 : 16,
        fontWeight: weight === 'bold' ? '700' : '500',
        lineHeight: size === 'lg' ? 28 : size === 'sm' ? 18 : 23
      }, props.style]}
    >
      {children}
    </Text>
  );
}

export function Card(props: { children: React.ReactNode; style?: ViewStyle }): React.ReactElement {
  const colors = useAppColors();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, props.style]}>{props.children}</View>;
}

export function Badge(props: { label: string; tone?: 'danger' | 'neutral' | 'success' | 'warning' }): React.ReactElement {
  const colors = useAppColors();
  const tone = props.tone ?? 'neutral';
  const foreground = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: foreground }]}>
      <Text style={{ color: foreground, fontFamily: 'Manrope_700Bold', fontSize: 12 }}>{props.label}</Text>
    </View>
  );
}

export function Button(props: { disabled?: boolean; label: string; loading?: boolean; loadingLabel?: string; onPress: () => void; tone?: 'danger' | 'primary' | 'secondary' }): React.ReactElement {
  const colors = useAppColors();
  const tone = props.tone ?? 'primary';
  const backgroundColor = props.disabled ? colors.border : tone === 'danger' ? colors.danger : tone === 'secondary' ? colors.surface : colors.action;
  const borderColor = tone === 'secondary' ? colors.border : backgroundColor;
  const textColor = tone === 'secondary' ? colors.text : colors.inverse;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.loading ? props.loadingLabel ?? props.label : props.label}
      accessibilityState={{ busy: props.loading ?? false, disabled: Boolean(props.disabled || props.loading) }}
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor, opacity: pressed ? 0.82 : props.disabled ? 0.56 : 1 }
      ]}
    >
      {props.loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.buttonText, { color: textColor }]}>{props.label}</Text>}
    </Pressable>
  );
}

export function Row(props: { children: React.ReactNode; style?: ViewStyle }): React.ReactElement {
  return <View style={[styles.row, props.style]}>{props.children}</View>;
}

export function TextField(props: TextInputProps & { label: string }): React.ReactElement {
  const colors = useAppColors();
  return (
    <View style={{ gap: 8 }}>
      <AppText size="sm" weight="bold">{props.label}</AppText>
      <TextInput
        {...props}
        accessibilityLabel={props.label}
        placeholderTextColor={colors.muted}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16
  },
  buttonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '800'
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  safe: {
    flex: 1
  },
  screen: {
    gap: 16,
    padding: 18,
    paddingBottom: 36
  },
  title: {
    fontFamily: 'BricolageGrotesque_700Bold',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34
  }
});
