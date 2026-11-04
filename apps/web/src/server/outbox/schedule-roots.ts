import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { prisma } from '@sv/db';
import { after } from 'next/server';
import { processOutboxBatch } from './processor';

/** Only roots committed by this action and their derived channel jobs. */
export function scheduleOutboxRoots(key: { exact: string } | { prefix: string }): void {
  try {
    after(async () => {
      try {
        const roots = await prisma.outboxEvent.findMany({ where: { dedupeKey: 'exact' in key ? key.exact : { startsWith: key.prefix } }, select: { id: true }, take: 25 });
        // Callers allow 180s: stop new claims at 35s and let one final mail job
        // finish its three bounded provider operations and database commits.
        const deadline = Date.now() + 35_000;
        let claims = 0;
        for (const root of roots) {
          while (claims < 40 && Date.now() < deadline) {
            claims += 1;
            const result = await processOutboxBatch(1, undefined, { rootEventId: root.id });
            if (result.done + result.failed === 0) break;
          }
        }
      } catch (error) { Sentry.captureException(error, { tags: { feature: 'action-outbox-dispatch' } }); }
    });
  } catch (error) { Sentry.captureException(error, { tags: { feature: 'action-outbox-scheduling' } }); }
}
