import { handleAdminChat } from '@/server/chat/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleAdminChat(request, 'inbox');
}
