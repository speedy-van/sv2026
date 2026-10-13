import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useAppColors } from '@/theme/theme';

export function AppText(props: { children: React.ReactNode; muted?: boolean; size?: 'lg' | 'md' | 'sm'; weight?: 'bold' | 'regular' }): React.ReactElement {
  const colors = useAppColors();
  const size = props.size ?? 'md';
  return (
    <Text
      style={{
        color: props.muted ? colors.muted : colors.text,
        fontFamily: props.weight === 'bold' ? 'Manrope_700Bold' : 'Manrope_500Medium',
        fontSize: size === 'lg' ? 22 : size === 'sm' ? 13 : 16,
        fontWeight: props.weight === 'bold' ? '700' : '500',
        lineHeight: size === 'lg' ? 28 : size === 'sm' ? 18 : 23
      }}
    >
      {props.children}
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

export function Button(props: { disabled?: boolean; label: string; loading?: boolean; onPress: () => void; tone?: 'danger' | 'primary' | 'secondary' }): React.ReactElement {
  const colors = useAppColors();
  const tone = props.tone ?? 'primary';
  const backgroundColor = props.disabled ? colors.border : tone === 'danger' ? colors.danger : tone === 'secondary' ? colors.surface : colors.action;
  const borderColor = tone === 'secondary' ? colors.border : backgroundColor;
  const textColor = tone === 'secondary' ? colors.text : colors.inverse;
  return (
    <Pressable
      accessibilityRole="button"
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
  }
});
