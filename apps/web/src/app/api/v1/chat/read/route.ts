import { handlePublicChat } from '@/server/chat/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handlePublicChat(request, 'read');
}
