import type { ServiceKey } from '@sv/pricing';

export interface ExampleProfile {
  detail: string;
  items?: Array<{ itemSlug: string; quantity: number }>;
  preset?: string;
  service: ServiceKey;
  variant: string;
}

export const removalExampleProfiles: ExampleProfile[] = [
  {
    detail: 'Small move: one armchair and five medium boxes',
    items: [
      { itemSlug: 'armchair', quantity: 1 },
      { itemSlug: 'box-medium', quantity: 5 },
    ],
    service: 'man-and-van',
    variant: 'standard',
  },
  { detail: '1-bedroom flat preset', preset: '1-bed', service: 'house-removals', variant: '1-bed' },
  { detail: '3-bedroom house preset', preset: '3-bed', service: 'house-removals', variant: '3-bed' },
];

export const servicePresetSlugs: Partial<Record<string, string>> = {
  'house-removals': 'studio',
  'office-removals': 'small-office',
  'student-moves': 'student-room',
};

export const featuredRouteSlugs = [
  'glasgow-to-edinburgh',
  'edinburgh-to-dundee',
  'glasgow-to-aberdeen',
  'glasgow-to-inverness',
  'edinburgh-to-dunfermline',
] as const;

export const examplePriceCaption =
  'Ground floors at both ends, no access charges or optional extras. Examples use the named catalogue items or editable preset and the cheapest available slot when this page was updated. Your exact addresses, inventory, access and date determine your price.';
