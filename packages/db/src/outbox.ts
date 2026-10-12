import type { Prisma } from './generated/prisma/client';
import type { DbTx } from './locks';

export async function enqueueOutbox(
  tx: DbTx,
  type: string,
  payload: Prisma.InputJsonValue,
  dedupeKey?: string,
) {
  return tx.outboxEvent.create({
    data: {
      type,
      payload,
      ...(dedupeKey ? { dedupeKey } : {}),
    },
  });
}
