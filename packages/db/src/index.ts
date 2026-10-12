export { createPrismaClient, prisma } from './client';
export {
  ORDERED_SLOTS,
  assertSlotCapacity,
  capacityFor,
  countSlotUsage,
  lockSlot,
  slotsCovered,
  type CapacityCheckInput,
  type DbTx,
} from './locks';
export { enqueueOutbox } from './outbox';
export { PrismaClient, Prisma } from './generated/prisma/client';
export type { Slot } from './generated/prisma/client';
