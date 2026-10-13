import 'server-only';

import { AppError } from '@sv/contracts';
import { serverEnv } from './env';

export function assertCronRequest(request: Request): void {
  const secret = serverEnv().CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== 'production') return;
  const header = request.headers.get('authorization');
  if (!secret || header !== `Bearer ${secret}`) {
    throw new AppError('UNAUTHORIZED', 'Invalid cron token.');
  }
}
