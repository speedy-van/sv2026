import type { DriverSyncRequestSchema, DriverSyncResponseSchema } from '@sv/contracts';
import type { z } from 'zod';

export type OfflineEvent = z.infer<typeof DriverSyncRequestSchema>['events'][number];
export type SyncResult = z.infer<typeof DriverSyncResponseSchema>['events'][number];

export interface QueuedEvent {
  attempts: number;
  createdAt: string;
  event: OfflineEvent;
  lastError?: string;
}

export function orderAndDedupeEvents(events: readonly QueuedEvent[]): QueuedEvent[] {
  const byId = new Map<string, QueuedEvent>();
  for (const event of events) {
    const existing = byId.get(event.event.clientEventId);
    if (!existing || event.createdAt < existing.createdAt) byId.set(event.event.clientEventId, event);
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function applySyncResults(queue: readonly QueuedEvent[], results: readonly SyncResult[]): QueuedEvent[] {
  const byId = new Map(results.map((result) => [result.clientEventId, result]));
  return queue.flatMap((item) => {
    const result = byId.get(item.event.clientEventId);
    if (!result) return [item];
    if (result.result === 'APPLIED' || result.result === 'DUPLICATE') return [];
    return [{ ...item, attempts: item.attempts + 1, lastError: 'error' in result ? result.error : 'UNKNOWN' }];
  });
}
