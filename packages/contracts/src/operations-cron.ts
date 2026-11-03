import { z } from 'zod';
import { CronAuthResponseSchema } from './api';

const CountSchema = z.number().int().nonnegative();
export const OperationsCronResultSchema = z.object({
  bookingsExpired: CountSchema,
  slotHoldsExpired: CountSchema,
  bookingsChecked: CountSchema,
  pushesQueued: CountSchema,
  receiptsChecked: CountSchema,
  devicesDisabled: CountSchema,
  receiptErrors: CountSchema,
  outboxDone: CountSchema,
  outboxFailed: CountSchema,
  deferred: z.boolean(),
}).strict();
export const OperationsCronResponseSchema = CronAuthResponseSchema.extend(OperationsCronResultSchema.shape).strict();
export type OperationsCronResult = z.infer<typeof OperationsCronResultSchema>;
