import { z } from 'zod';
import { IsoTimestampSchema } from './api';

export const VISITOR_ACTIVE_WINDOW_SECONDS = 90;
export const VISITOR_HEARTBEAT_INTERVAL_SECONDS = 30;
export const VISITOR_PRESENCE_COOKIE_NAME = 'sv_visitor';

export const VisitorPresenceHeartbeatRequestSchema = z.object({}).strict();
export const VisitorPresenceHeartbeatResponseSchema = z.object({
  activeWindowSeconds: z.literal(VISITOR_ACTIVE_WINDOW_SECONDS),
}).strict();
export const AdminVisitorPresenceResponseSchema = z.object({
  activeVisitors: z.number().int().nonnegative(), generatedAt: IsoTimestampSchema,
  activeWindowSeconds: z.literal(VISITOR_ACTIVE_WINDOW_SECONDS), measurement: z.literal('consenting-browsers'),
}).strict();

export type VisitorPresenceHeartbeatResponse = z.infer<typeof VisitorPresenceHeartbeatResponseSchema>;
export type AdminVisitorPresenceResponse = z.infer<typeof AdminVisitorPresenceResponseSchema>;
