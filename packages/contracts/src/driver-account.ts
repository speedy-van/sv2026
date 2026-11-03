import { z } from 'zod';
import { EmailSchema, StaffPasswordSchema, UkPhoneSchema } from './api';

/** Account creation is stricter than login so existing staff passwords remain valid. */
export const DriverCreatePasswordSchema = StaffPasswordSchema.min(12)
  .refine((value) => value.trim().length > 0, 'Enter a password with at least one non-space character.');

export const DriverCreateSchema = z.object({
  email: EmailSchema,
  password: DriverCreatePasswordSchema,
  phone: UkPhoneSchema,
  name: z.string().trim().min(1).max(80).optional(),
}).strict();

export const DriverCreateResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(true),
}).strict();

export type DriverCreateRequest = z.infer<typeof DriverCreateSchema>;
export type DriverCreateResponse = z.infer<typeof DriverCreateResponseSchema>;
