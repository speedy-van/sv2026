import { VisitorPresenceHeartbeatRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { heartbeatVisitorPresence, withdrawVisitorPresence } from '@/server/visitor-presence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: VisitorPresenceHeartbeatRequestSchema, rateLimit: 'visitorPresence' }, async ({ requestId }) => {
    const result = await heartbeatVisitorPresence(request);
    return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: VisitorPresenceHeartbeatRequestSchema, rateLimit: 'visitorPresence' }, async ({ requestId }) => {
    const result = await withdrawVisitorPresence(request);
    return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
  });
}
