import 'server-only';

import { AppError, type DriverCreateRequest, type DriverCreateResponse } from '@sv/contracts';
import { prisma } from '@sv/db';
import * as Sentry from '@sentry/nextjs';
import { hashStaffPassword } from '../auth/password';
import { insertDriverAccount, type DriverAccountActor } from './driver-account-repository';

export async function createDriverAccount(input: DriverCreateRequest, actor: DriverAccountActor): Promise<DriverCreateResponse> {
  try {
    const passwordHash = await hashStaffPassword(input.password);
    return await prisma.$transaction((tx) => insertDriverAccount(tx, input, passwordHash, actor));
  } catch (error) {
    // The unique database constraint also protects two administrators adding the same email at once.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'An account already uses this email. Use a different email address.', { reason: 'EMAIL_ALREADY_EXISTS' });
    }
    // Prisma error messages can include input fields, so report a safe operation failure only.
    if (!(error instanceof AppError)) Sentry.captureException(new Error('Driver account creation failed.'), { tags: { component: 'driver-account-create' } });
    throw error;
  }
}
