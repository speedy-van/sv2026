import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { checkPushReceipts } from '../integrations/expo-push';

const COOLDOWN_MS = 60_000;
const BATCH_SIZE = 25;
let nextAttemptAt = 0;
let inFlight: Promise<void> | undefined;

/** Best effort on traffic and the daily cron; this is not a 15-minute scheduler. */
export function maintainPushReceipts(): Promise<void> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (now < nextAttemptAt) return Promise.resolve();
  nextAttemptAt = now + COOLDOWN_MS;
  inFlight = Promise.resolve()
    .then(() => checkPushReceipts(new Date(now), BATCH_SIZE))
    .then(() => undefined)
    .catch((error: unknown) => {
      Sentry.captureException(error, { tags: { feature: 'push-receipt-maintenance' } });
    })
    .finally(() => { inFlight = undefined; });
  return inFlight;
}
