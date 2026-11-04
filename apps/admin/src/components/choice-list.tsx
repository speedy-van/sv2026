import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { appLayout, useAppColors } from '@/theme/theme';
import { AppText } from './primitives';

export interface ChoiceOption<Value extends string> {
  value: Value;
  title: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Large, plain-language choices stacked vertically. Each option is a full-width card the
 * user taps, with a short explanation underneath, so nobody has to decode short tab labels.
 */
export function ChoiceList<Value extends string>(props: {
  label: string;
  options: readonly ChoiceOption<Value>[];
  value: Value | null;
  onChange(value: Value): void;
  disabled?: boolean;
}): React.ReactElement {
  const colors = useAppColors();
  return (
    <View accessibilityLabel={props.label} accessibilityRole="radiogroup" style={styles.list}>
      {props.options.map((option) => {
        const selected = option.value === props.value;
        const inactive = Boolean(props.disabled || option.disabled);
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.title}
            {...(option.description ? { accessibilityHint: option.description } : {})}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: inactive }}
            disabled={inactive}
            onPress={() => {
              props.onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: selected ? colors.brandSoft : colors.surface,
                borderColor: selected ? colors.brand : colors.border,
                opacity: inactive ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.radio,
                {
                  backgroundColor: selected ? colors.brand : 'transparent',
                  borderColor: selected ? colors.brand : colors.borderStrong,
                },
              ]}
            >
              {selected ? <Check color={colors.onBrand} size={14} strokeWidth={3} /> : null}
            </View>
            <View style={styles.copy}>
              <AppText weight="bold">{option.title}</AppText>
              {option.description ? (
                <AppText muted size="sm">
                  {option.description}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small pill choices that wrap onto several lines, for short picks such as a day. */
export function ChipChoices<Value extends string>(props: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange(value: Value): void;
  disabled?: boolean;
}): React.ReactElement {
  const colors = useAppColors();
  return (
    <View accessibilityLabel={props.label} accessibilityRole="radiogroup" style={styles.chips}>
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: Boolean(props.disabled) }}
            disabled={props.disabled}
            onPress={() => {
              props.onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? colors.brand : colors.surface,
                borderColor: selected ? colors.brand : colors.borderStrong,
                opacity: props.disabled ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <AppText size="sm" weight="bold" style={{ color: selected ? colors.onBrand : colors.text }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  option: {
    alignItems: 'flex-start',
    borderRadius: appLayout.cardRadius,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    minHeight: appLayout.minTouchTarget + 8,
    padding: 16,
  },
  radio: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    marginTop: 1,
    width: 24,
  },
  copy: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: appLayout.minTouchTarget,
    paddingHorizontal: 16,
  },
});
