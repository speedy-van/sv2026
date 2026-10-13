import { z } from 'zod';

export const ContactRequestSchema = z
  .object({
    company: z.string().max(0).optional(),
    email: z.email().max(320),
    message: z.string().trim().min(10).max(4000),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

export const ContactResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type ContactRequest = z.infer<typeof ContactRequestSchema>;
export type ContactResponse = z.infer<typeof ContactResponseSchema>;
