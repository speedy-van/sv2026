import { describe, expect, it } from 'vitest';
import { AdminScheduleSlotSchema, AdminSlotClosureRequestSchema } from '../src';

describe('admin manual slot closure contracts', () => {
  const request = {
    date: '2026-10-20',
    slot: 'MORNING',
    closed: true,
    expectedClosureId: null,
    reason: 'Vehicle unavailable',
  };

  it('requires a valid civil date, explicit closure identity and a meaningful reason', () => {
    expect(
      AdminSlotClosureRequestSchema.parse({ ...request, reason: '  Vehicle unavailable  ' }).reason,
    ).toBe('Vehicle unavailable');
    for (const invalid of [
      { ...request, date: '2026-02-30' },
      { ...request, expectedClosureId: undefined },
      { ...request, reason: '   ' },
      { ...request, reason: 'x'.repeat(201) },
      { ...request, capacity: 99 },
    ]) {
      expect(AdminSlotClosureRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires the server to distinguish a manual closure from exhausted or rule-based capacity', () => {
    const window = {
      slot: 'MORNING',
      capacity: 0,
      configuredCapacity: 2,
      confirmedUnits: 2,
      heldUnits: 0,
      availableUnits: 0,
      manualClosure: {
        id: 'closure-1',
        reason: 'Vehicle unavailable',
        createdAt: '2026-10-15T12:00:00.000Z',
      },
      closeAllowed: true,
      closeBlockedReason: null,
    };
    expect(AdminScheduleSlotSchema.parse(window).manualClosure?.id).toBe('closure-1');
    expect(AdminScheduleSlotSchema.parse({ ...window, manualClosure: null }).manualClosure).toBeNull();
    expect(AdminScheduleSlotSchema.safeParse({ ...window, manualClosure: undefined }).success).toBe(false);
    expect(AdminScheduleSlotSchema.safeParse({ ...window, configuredCapacity: undefined }).success).toBe(
      false,
    );
  });
});
