import 'server-only';

import type { OperationsSettings } from '../settings';

export function jobSize(
  volumeM3: number,
  operations: OperationsSettings,
): { capacityUnits: number; blocksSlots: number } {
  const matching = operations.jobSizeRules
    .filter((rule) => volumeM3 >= rule.minVolumeM3)
    .sort((left, right) => left.minVolumeM3 - right.minVolumeM3)
    .at(-1);
  return matching
    ? { blocksSlots: matching.blocksSlots, capacityUnits: matching.capacityUnits }
    : { blocksSlots: 1, capacityUnits: 1 };
}
