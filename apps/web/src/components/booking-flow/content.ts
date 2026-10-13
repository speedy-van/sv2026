import {
  BriefcaseBusiness,
  GraduationCap,
  Home,
  Package,
  Piano,
  Sofa,
  Trash2,
  Truck,
  Warehouse,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { z } from 'zod';
import type { ServiceKeySchema } from '@sv/contracts';

type ServiceKey = z.infer<typeof ServiceKeySchema>;

export interface ServiceOption {
  description: string;
  icon: LucideIcon;
  key: ServiceKey;
  label: string;
  requiresDropoff: boolean;
  variants: Array<{ key: string; label: string; manualQuote?: boolean }>;
}

export const serviceOptions: ServiceOption[] = [
  {
    description: 'Homes and flats, priced from your addresses and inventory.',
    icon: Home,
    key: 'house-removals',
    label: 'Home move',
    requiresDropoff: true,
    variants: [
      { key: 'studio', label: 'Studio' },
      { key: '1-bed', label: '1 bedroom' },
      { key: '2-bed', label: '2 bedrooms' },
      { key: '3-bed', label: '3 bedrooms' },
      { key: '4-bed-plus', label: '4+ bedrooms' },
    ],
  },
  {
    description: 'A van and driver for smaller moves.',
    icon: Truck,
    key: 'man-and-van',
    label: 'Man and van',
    requiresDropoff: true,
    variants: [{ key: 'standard', label: 'Standard' }],
  },
  {
    description: 'Sofas, wardrobes, appliances and a few bulky items.',
    icon: Sofa,
    key: 'furniture',
    label: 'A few items',
    requiresDropoff: true,
    variants: [{ key: 'standard', label: 'Standard' }],
  },
  {
    description: 'Student halls, shared flats and small rooms.',
    icon: GraduationCap,
    key: 'student',
    label: 'Student',
    requiresDropoff: true,
    variants: [
      { key: 'halls', label: 'Halls' },
      { key: 'shared-flat', label: 'Shared flat or house' },
    ],
  },
  {
    description: 'Office moves and desks.',
    icon: BriefcaseBusiness,
    key: 'office',
    label: 'Office',
    requiresDropoff: true,
    variants: [
      { key: 'small', label: 'Up to 5 desks' },
      { key: 'medium', label: '6-15 desks' },
      { key: 'large', label: '16+ desks', manualQuote: true },
    ],
  },
  {
    description: 'Garage, loft and storage unit moves.',
    icon: Warehouse,
    key: 'storage',
    label: 'Storage',
    requiresDropoff: true,
    variants: [
      { key: 'into-storage', label: 'Into storage' },
      { key: 'out-of-storage', label: 'Out of storage' },
    ],
  },
  {
    description: 'Digital, upright and grand pianos.',
    icon: Piano,
    key: 'piano',
    label: 'Piano',
    requiresDropoff: true,
    variants: [
      { key: 'digital', label: 'Digital' },
      { key: 'upright', label: 'Upright' },
      { key: 'baby-grand', label: 'Baby grand', manualQuote: true },
      { key: 'grand', label: 'Grand', manualQuote: true },
    ],
  },
  {
    description: 'Rubbish removal from one Scottish address.',
    icon: Trash2,
    key: 'rubbish',
    label: 'Rubbish',
    requiresDropoff: false,
    variants: [{ key: 'standard', label: 'Standard' }],
  },
  {
    description: 'Parcels and single item courier jobs.',
    icon: Package,
    key: 'ikea',
    label: 'IKEA',
    requiresDropoff: true,
    variants: [{ key: 'standard', label: 'Standard' }],
  },
  {
    description: 'Urgent moves today, subject to cut-off and capacity.',
    icon: Zap,
    key: 'same-day',
    label: 'Same day',
    requiresDropoff: true,
    variants: [{ key: 'standard', label: 'Standard' }],
  },
];

export const categoryLabels = [
  'Popular',
  'Living room',
  'Bedroom',
  'Dining',
  'Kitchen & appliances',
  'Boxes & bags',
  'Office',
  'Garden',
  'Kids',
  'Leisure',
  'Other',
];

export function serviceByKey(key: ServiceKey | null): ServiceOption | undefined {
  return serviceOptions.find((service) => service.key === key);
}
