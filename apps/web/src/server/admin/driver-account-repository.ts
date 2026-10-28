import 'server-only';

import {
  AppError, DriverCreateResponseSchema,
  type DriverCreateRequest, type DriverCreateResponse,
} from '@sv/contracts';
import { Prisma, type DbTx } from '@sv/db';

export interface DriverAccountActor { userId: string; requestId: string }

/** The caller owns the transaction; credentials and their audit record commit together. */
export async function insertDriverAccount(
  tx: DbTx, input: DriverCreateRequest, passwordHash: string, actor: DriverAccountActor,
): Promise<DriverCreateResponse> {
  const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new AppError('CONFLICT', 'An account already uses this email. Use a different email address.', { reason: 'EMAIL_ALREADY_EXISTS' });

  const driver = await tx.user.create({
    data: {
      email: input.email,
      name: input.name ?? input.email,
      phone: input.phone,
      passwordHash,
      role: 'DRIVER',
      status: 'ACTIVE',
      driver: { create: { payoutPercent: null } },
    },
    select: { id: true },
  });
  // Credentials and contact details never enter the audit JSON.
  await tx.auditLog.create({ data: {
    action: 'admin.drivers.create', actorType: 'USER', actorUserId: actor.userId,
    entityType: 'driver', entityId: driver.id, requestId: actor.requestId,
    before: Prisma.JsonNull, after: { role: 'DRIVER', status: 'ACTIVE', payoutPercent: null },
  } });
  return DriverCreateResponseSchema.parse({ id: driver.id, ok: true });
}
