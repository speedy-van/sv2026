import * as SQLite from 'expo-sqlite';
import type { QueuedEvent } from '@/offline/queue';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('speedyvan-driver.db');
  return databasePromise;
}

export async function initialiseOfflineStore(): Promise<void> {
  const database = await db();
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_events (
      client_event_id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      payload TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS location_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
  `);
}

export async function enqueueOfflineEvent(item: QueuedEvent): Promise<void> {
  await initialiseOfflineStore();
  const database = await db();
  await database.runAsync(
    'INSERT OR IGNORE INTO offline_events (client_event_id, created_at, attempts, payload, last_error) VALUES (?, ?, ?, ?, ?)',
    item.event.clientEventId,
    item.createdAt,
    item.attempts,
    JSON.stringify(item.event),
    item.lastError ?? null
  );
}

export async function removeOfflineEvents(clientEventIds: readonly string[]): Promise<void> {
  if (clientEventIds.length === 0) return;
  await initialiseOfflineStore();
  const database = await db();
  for (const clientEventId of clientEventIds) {
    await database.runAsync('DELETE FROM offline_events WHERE client_event_id = ?', clientEventId);
  }
}

export async function writeLocationPoint(point: unknown): Promise<void> {
  await initialiseOfflineStore();
  const database = await db();
  await database.runAsync(
    'INSERT INTO location_points (payload, recorded_at) VALUES (?, ?)',
    JSON.stringify(point),
    typeof point === 'object' && point !== null && 'recordedAt' in point && typeof point.recordedAt === 'string' ? point.recordedAt : new Date().toISOString()
  );
}
