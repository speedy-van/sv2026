import {
  AddressSchema,
  ItemLineInputSchema,
  type AccessDetailSchema,
  type CatalogueResponseSchema,
  type PostcodeLookupResponseSchema,
  type QuoteRequestSchema,
} from '@sv/contracts';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import type { z } from 'zod';
import { AppText, Button, Card, SegmentedControl, TextField } from './primitives';

type Address = z.infer<typeof AddressSchema>;
type Access = z.infer<typeof AccessDetailSchema>;
type Inputs = z.infer<typeof QuoteRequestSchema>;
type Catalogue = z.infer<typeof CatalogueResponseSchema>;
type Postcode = z.infer<typeof PostcodeLookupResponseSchema>;

export function NumberField(props: {
  label: string;
  value: number;
  onChange(value: number): void;
  disabled: boolean;
  hint?: string;
}): React.ReactElement {
  return (
    <TextField
      label={props.label}
      value={Number.isFinite(props.value) ? String(props.value) : ''}
      onChangeText={(text) => {
        props.onChange(/^\d+$/u.test(text) ? Number(text) : Number.NaN);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      editable={!props.disabled}
      {...(props.hint ? { hint: props.hint } : {})}
    />
  );
}

export function ToggleField(props: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <View style={styles.toggle}>
      <AppText style={styles.grow}>{props.label}</AppText>
      <Switch
        accessibilityLabel={props.label}
        value={props.value}
        onValueChange={(value) => {
          props.onChange(value);
        }}
        disabled={props.disabled}
        style={styles.switch}
      />
    </View>
  );
}

export function BookingAddressFields(props: {
  label: string;
  value: Address | null;
  disabled: boolean;
  lookup(postcode: string): Promise<Postcode>;
  onChange(value: Address): void;
  onValidityChange(valid: boolean): void;
}): React.ReactElement {
  const [draft, setDraft] = useState({
    line1: props.value?.line1 ?? '',
    line2: props.value?.line2 ?? '',
    flat: props.value?.flat ?? '',
    town: props.value?.town ?? '',
    postcode: props.value?.postcode ?? '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const blocked = useRef(props.disabled);
  blocked.current = props.disabled;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);
  function update(field: keyof typeof draft, text: string): void {
    revision.current += 1;
    setDraft((current) => ({ ...current, [field]: text }));
    props.onValidityChange(false);
    setVerified(false);
    setError(null);
  }
  async function verify(): Promise<void> {
    if (pending || props.disabled) return;
    const attempt = revision.current;
    setPending(true);
    setError(null);
    try {
      const postcode = await props.lookup(draft.postcode);
      if (!mounted.current || blocked.current || attempt !== revision.current) return;
      const parsed = AddressSchema.safeParse({
        ...draft,
        postcode: postcode.postcode,
        lat: postcode.lat,
        lng: postcode.lng,
        source: 'MANUAL',
        label: [draft.flat, draft.line1, draft.line2, draft.town, postcode.postcode]
          .filter(Boolean)
          .join(', '),
      });
      if (!parsed.success) {
        setError('Enter an address line, town and valid postcode, then verify again.');
        return;
      }
      props.onChange(parsed.data);
      props.onValidityChange(true);
      setDraft((current) => ({ ...current, postcode: postcode.postcode }));
      setVerified(true);
    } catch {
      if (mounted.current && attempt === revision.current)
        setError(
          'The postcode could not be verified. Check it and try again. Your address has not been changed.',
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Card tone="subtle">
      <AppText accessibilityRole="header" aria-level={3} weight="bold">
        {props.label}
      </AppText>
      <TextField
        label={`${props.label} address line 1`}
        value={draft.line1}
        onChangeText={(text) => {
          update('line1', text);
        }}
        editable={!props.disabled && !pending}
        maxLength={120}
      />
      <TextField
        label={`${props.label} address line 2`}
        value={draft.line2}
        onChangeText={(text) => {
          update('line2', text);
        }}
        editable={!props.disabled && !pending}
        maxLength={120}
      />
      <TextField
        label={`${props.label} flat or unit`}
        value={draft.flat}
        onChangeText={(text) => {
          update('flat', text);
        }}
        editable={!props.disabled && !pending}
        maxLength={40}
      />
      <TextField
        label={`${props.label} town`}
        value={draft.town}
        onChangeText={(text) => {
          update('town', text);
        }}
        editable={!props.disabled && !pending}
        maxLength={80}
      />
      <TextField
        label={`${props.label} postcode`}
        value={draft.postcode}
        onChangeText={(text) => {
          update('postcode', text);
        }}
        editable={!props.disabled && !pending}
        autoCapitalize="characters"
        maxLength={12}
      />
      <AppText muted size="sm">
        Verify the postcode after changing this address so the route can be priced again.
      </AppText>
      <Button
        label={`Verify ${props.label.toLowerCase()} address`}
        tone="secondary"
        disabled={props.disabled}
        loading={pending}
        onPress={() => {
          void verify();
        }}
      />
      {verified ? (
        <AppText accessibilityLiveRegion="polite" tone="success">
          Address verified. Preview the revised price before saving.
        </AppText>
      ) : null}
      {error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}

export function BookingAccessFields(props: {
  label: string;
  value: Access;
  onChange(value: Access): void;
  disabled: boolean;
}): React.ReactElement {
  const value = props.value;
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" aria-level={3} weight="bold">
        {props.label} access
      </AppText>
      <SegmentedControl
        label={`${props.label} floor`}
        value={value.floorChoice}
        options={[
          { label: 'Ground', value: 'GROUND' as const, disabled: props.disabled },
          { label: 'Basement', value: 'BASEMENT' as const, disabled: props.disabled },
          { label: 'Upper floor', value: 'FLOOR' as const, disabled: props.disabled },
        ]}
        onChange={(floorChoice) => {
          if (props.disabled) return;
          const rest = { ...value };
          delete rest.floorNumber;
          props.onChange({ ...rest, floorChoice, ...(floorChoice === 'FLOOR' ? { floorNumber: 1 } : {}) });
        }}
      />
      {value.floorChoice === 'FLOOR' ? (
        <NumberField
          label={`${props.label} floor number`}
          value={value.floorNumber ?? Number.NaN}
          onChange={(floorNumber) => {
            props.onChange({ ...value, floorNumber });
          }}
          disabled={props.disabled}
          hint="From 1 to 30."
        />
      ) : null}
      <NumberField
        label={`${props.label} carry distance in metres`}
        value={value.carryMetres}
        onChange={(carryMetres) => {
          props.onChange({ ...value, carryMetres });
        }}
        disabled={props.disabled}
        hint="From the van to the entrance, up to 500 metres."
      />
      <ToggleField
        label={`${props.label} has a lift`}
        value={value.hasLift}
        onChange={(hasLift) => {
          props.onChange({ ...value, hasLift });
        }}
        disabled={props.disabled}
      />
      <ToggleField
        label={`${props.label} narrow access`}
        value={value.narrowAccess}
        onChange={(narrowAccess) => {
          props.onChange({ ...value, narrowAccess });
        }}
        disabled={props.disabled}
      />
      <ToggleField
        label={`${props.label} parking permit zone`}
        value={value.permitZone}
        onChange={(permitZone) => {
          props.onChange({ ...value, permitZone });
        }}
        disabled={props.disabled}
      />
      <TextField
        label={`${props.label} access notes`}
        value={value.notes ?? ''}
        onChangeText={(notes) => {
          props.onChange({ ...value, notes });
        }}
        editable={!props.disabled}
        multiline
        maxLength={300}
      />
    </View>
  );
}

export function BookingItemsFields(props: {
  value: Inputs['items'];
  catalogue: Catalogue;
  onChange(value: Inputs['items']): void;
  disabled: boolean;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [customSize, setCustomSize] = useState<'S' | 'M' | 'L' | 'XL'>('M');
  const [error, setError] = useState<string | null>(null);
  const matches = search.trim()
    ? props.catalogue.items
        .filter((item) =>
          [item.name, ...item.aliases].some((name) =>
            name.toLowerCase().includes(search.trim().toLowerCase()),
          ),
        )
        .slice(0, 12)
    : [];
  function add(itemSlug: string): void {
    const existing = props.value.find((item) => item.kind === 'catalogue' && item.itemSlug === itemSlug);
    props.onChange(
      existing
        ? props.value.map((item) => (item === existing ? { ...item, quantity: item.quantity + 1 } : item))
        : [...props.value, { kind: 'catalogue', itemSlug, quantity: 1 }],
    );
    setSearch('');
  }
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" aria-level={3} weight="bold">
        Items
      </AppText>
      {props.value.length === 0 ? <AppText muted>No items selected.</AppText> : null}
      {props.value.map((item, index) => {
        const label =
          item.kind === 'custom'
            ? `${item.name} (${item.size})`
            : (props.catalogue.items.find((entry) => entry.slug === item.itemSlug)?.name ?? item.itemSlug);
        return (
          <Card key={`${item.kind}:${String(index)}`} tone="subtle">
            <AppText weight="bold">{label}</AppText>
            <NumberField
              label={`Quantity of ${label}`}
              value={item.quantity}
              onChange={(quantity) => {
                props.onChange(
                  props.value.map((entry, at) => (at === index ? { ...entry, quantity } : entry)),
                );
              }}
              disabled={props.disabled}
            />
            <Button
              label={`Remove ${label}`}
              tone="ghost"
              disabled={props.disabled}
              onPress={() => {
                props.onChange(props.value.filter((_entry, at) => at !== index));
              }}
            />
          </Card>
        );
      })}
      <TextField
        label="Find an item to add"
        value={search}
        onChangeText={setSearch}
        editable={!props.disabled}
        placeholder="Search the item catalogue"
      />
      {search.trim() && matches.length === 0 ? (
        <AppText muted>No catalogue items match. Add a custom item below.</AppText>
      ) : null}
      {matches.map((item) => (
        <Button
          key={item.slug}
          label={`Add ${item.name}`}
          tone="secondary"
          disabled={props.disabled || props.value.length >= 200}
          onPress={() => {
            add(item.slug);
          }}
        />
      ))}
      <TextField
        label="Custom item name"
        value={customName}
        onChangeText={setCustomName}
        editable={!props.disabled}
        maxLength={60}
      />
      <SegmentedControl
        label="Custom item size"
        value={customSize}
        options={(['S', 'M', 'L', 'XL'] as const).map((size) => ({
          label: `${size} · ${String(props.catalogue.customSizes[size])} m³`,
          value: size,
          disabled: props.disabled,
        }))}
        onChange={(size) => {
          if (!props.disabled) setCustomSize(size);
        }}
      />
      <Button
        label="Add custom item"
        tone="secondary"
        disabled={props.disabled || props.value.length >= 200}
        onPress={() => {
          const parsed = ItemLineInputSchema.safeParse({
            kind: 'custom',
            name: customName,
            size: customSize,
            quantity: 1,
          });
          if (!parsed.success) {
            setError('Enter a custom item name of at least two characters.');
            return;
          }
          props.onChange([...props.value, parsed.data]);
          setCustomName('');
          setError(null);
        }}
      />
      {error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

export function BookingExtrasFields(props: {
  value: Inputs['addons'];
  onChange(value: Inputs['addons']): void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" aria-level={3} weight="bold">
        Extras
      </AppText>
      <NumberField
        label="Additional helpers"
        value={props.value.helpers}
        onChange={(helpers) => {
          props.onChange({ ...props.value, helpers });
        }}
        disabled={props.disabled}
        hint="From 0 to 3."
      />
      <ToggleField
        label="Packing"
        value={props.value.packing}
        onChange={(packing) => {
          props.onChange({ ...props.value, packing });
        }}
        disabled={props.disabled}
      />
      <ToggleField
        label="Assembly"
        value={props.value.assembly}
        onChange={(assembly) => {
          props.onChange({ ...props.value, assembly });
        }}
        disabled={props.disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  toggle: { alignItems: 'center', flexDirection: 'row', gap: 16, minHeight: 48 },
  grow: { flex: 1 },
  switch: { minHeight: 48, minWidth: 48 },
});
