import { z } from 'zod';
import { AuthTokenResponseSchema } from './api';

export const EmptyBrowserSessionSchema = z.object({}).strict();
export const BrowserAuthTokenResponseSchema = AuthTokenResponseSchema.omit({ refreshToken: true }).strict();
export const BrowserSessionLogoutResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type BrowserAuthTokenResponse = z.infer<typeof BrowserAuthTokenResponseSchema>;
