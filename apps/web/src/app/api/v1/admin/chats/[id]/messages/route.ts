import { handleAdminChat } from '@/server/chat/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleAdminChat(request, 'messages', (await context.params).id);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleAdminChat(request, 'send', (await context.params).id);
}
