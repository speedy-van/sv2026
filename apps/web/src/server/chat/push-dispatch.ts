import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { processOutboxBatch } from '../outbox/processor';
import { maintainPushReceipts } from '../notifications/receipt-maintenance';
import { chatPushScope } from './push';

/** Only this committed message's jobs are eligible, including a retry of its HTTP response. */
export async function dispatchChatPush(messageId: string): Promise<void> {
  if (!messageId) return;
  const deadline = Date.now() + 40_000;
  try {
    for (let claim = 0; claim < 100 && Date.now() < deadline; claim += 1) {
      const result = await processOutboxBatch(1, ['push.send'], { rootEventId: chatPushScope(messageId) });
      if (result.failed > 0) {
        Sentry.captureMessage('Customer chat push delivery failed.', {
          level: 'error', tags: { feature: 'chat-push-delivery' },
        });
      }
      if (result.done + result.failed === 0) return;
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'chat-push-delivery' } });
  } finally {
    // Sending gets the budget first; receipt failures never change the saved message.
    if (Date.now() < deadline) await maintainPushReceipts();
  }
}
