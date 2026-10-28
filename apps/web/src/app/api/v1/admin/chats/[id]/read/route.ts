import { handleAdminChat } from '@/server/chat/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleAdminChat(request, 'read', (await context.params).id);
}
