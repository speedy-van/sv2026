import 'server-only';

import { AppError } from '@sv/contracts';
import { cookies } from 'next/headers';

export const MANAGE_COOKIE = 'sv_manage';

export async function manageTokenFromCookie(): Promise<string> {
  const store = await cookies();
  const token = store.get(MANAGE_COOKIE)?.value;
  if (!token) throw new AppError('UNAUTHORIZED', 'Open your manage-booking link or request a new one.');
  return token;
}
