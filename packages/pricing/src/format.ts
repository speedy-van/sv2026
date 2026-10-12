import type { StaticBreakdown } from './types';

export interface PriceBreakdownLine {
  key: string;
  label: string;
  pence: number;
}

export function formatPriceBreakdownLines(breakdown: StaticBreakdown): PriceBreakdownLine[] {
  const lines: PriceBreakdownLine[] = [
    {
      key: 'base',
      label: breakdown.variantMultiplier === 1 ? 'Base price' : 'Base price with service variant',
      pence: breakdown.baseAfterVariantPence,
    },
  ];

  if (breakdown.distance.pence > 0) {
    lines.push({ key: 'distance', label: 'Distance', pence: breakdown.distance.pence });
  }

  if (breakdown.floors.pickupPence > 0) {
    lines.push({ key: 'pickup-floors', label: 'Pickup stairs or lift', pence: breakdown.floors.pickupPence });
  }

  if (breakdown.floors.dropoffPence > 0) {
    lines.push({ key: 'dropoff-floors', label: 'Drop-off stairs or lift', pence: breakdown.floors.dropoffPence });
  }

  if (breakdown.inventory.pence > 0) {
    lines.push({ key: 'inventory', label: 'Items and volume', pence: breakdown.inventory.pence });
  }

  if (breakdown.access.pence > 0) {
    lines.push({ key: 'access', label: 'Access', pence: breakdown.access.pence });
  }

  if (breakdown.addons.pence > 0) {
    lines.push({ key: 'addons', label: 'Add-ons', pence: breakdown.addons.pence });
  }

  return lines;
}
