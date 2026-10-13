import { stagePathFor } from '@sv/contracts';
import { formatPence, earningTotals } from '@/earnings/format';
import { canUndoStage, driverStagePath } from '@/job/stages';
import { storeLocationPoint } from '@/location/task';
import { compressPhoto } from '@/media/photos';
import { applySyncResults, orderAndDedupeEvents, type QueuedEvent } from '@/offline/queue';

const ids = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333'
};

function stageEvent(clientEventId: string, createdAt: string): QueuedEvent {
  return {
    attempts: 0,
    createdAt,
    event: {
      bookingId: 'booking_1',
      clientEventId,
      occurredAt: createdAt,
      toStage: 'EN_ROUTE_TO_PICKUP',
      type: 'STAGE'
    }
  };
}

describe('driver offline queue', () => {
  it('orders events by creation time and dedupes by client event id', () => {
    const ordered = orderAndDedupeEvents([
      stageEvent(ids.b, '2026-01-02T10:00:00.000Z'),
      stageEvent(ids.a, '2026-01-02T09:00:00.000Z'),
      stageEvent(ids.b, '2026-01-02T11:00:00.000Z')
    ]);
    expect(ordered.map((item) => item.event.clientEventId)).toEqual([ids.a, ids.b]);
  });

  it('removes applied and duplicate events while keeping rejected events with errors', () => {
    const queue = [stageEvent(ids.a, '2026-01-02T09:00:00.000Z'), stageEvent(ids.b, '2026-01-02T10:00:00.000Z'), stageEvent(ids.c, '2026-01-02T11:00:00.000Z')];
    const remaining = applySyncResults(queue, [
      { clientEventId: ids.a, result: 'APPLIED' },
      { clientEventId: ids.b, result: 'DUPLICATE' },
      { clientEventId: ids.c, error: 'INVALID_TRANSITION', result: 'REJECTED' }
    ]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ attempts: 1, lastError: 'INVALID_TRANSITION' });
  });
});

describe('driver stage helpers', () => {
  it('uses the single-address path for rubbish and enforces a two-minute undo window', () => {
    expect(driverStagePath('rubbish')).toEqual(stagePathFor('rubbish'));
    expect(driverStagePath('rubbish')).toEqual(['NOT_STARTED', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'LOADING', 'COMPLETED']);
    expect(canUndoStage(new Date('2026-01-02T10:00:00.000Z'), new Date('2026-01-02T10:01:59.000Z'))).toBe(true);
    expect(canUndoStage(new Date('2026-01-02T10:00:00.000Z'), new Date('2026-01-02T10:02:01.000Z'))).toBe(false);
  });
});

describe('driver media and location', () => {
  it('compresses photos with the documented max width and jpeg quality', async () => {
    await expect(compressPhoto('file://photo.jpg')).resolves.toMatchObject({ uri: 'file://photo.jpg?compressed=1', width: 1600 });
    const imageManipulator = jest.requireMock<{ __manipulate: jest.Mock }>('expo-image-manipulator');
    expect(imageManipulator.__manipulate).toHaveBeenCalledWith('file://photo.jpg');
  });

  it('writes background location points into SQLite', async () => {
    const sqlite = jest.requireMock<{ __sqliteRuns: unknown[][] }>('expo-sqlite');
    sqlite.__sqliteRuns.length = 0;
    await storeLocationPoint({
      accuracyM: 12,
      lat: 55.861,
      lng: -4.25,
      recordedAt: '2026-01-02T10:00:00.000Z'
    });
    expect(sqlite.__sqliteRuns.at(-1)).toEqual([
      'INSERT INTO location_points (payload, recorded_at) VALUES (?, ?)',
      JSON.stringify({ accuracyM: 12, lat: 55.861, lng: -4.25, recordedAt: '2026-01-02T10:00:00.000Z' }),
      '2026-01-02T10:00:00.000Z'
    ]);
  });
});

describe('driver earnings formatting', () => {
  it('formats pence and totals paid versus unpaid rows', () => {
    expect(formatPence(12345)).toBe('£123.45');
    expect(earningTotals([{ amountPence: 1000, paid: true }, { amountPence: 2500, paid: false }])).toEqual({
      earnedPence: 3500,
      paidPence: 1000,
      unpaidPence: 2500
    });
  });
});
