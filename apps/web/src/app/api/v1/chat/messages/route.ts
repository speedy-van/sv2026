import { handlePublicChat } from '@/server/chat/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handlePublicChat(request, 'messages');
}

export async function POST(request: Request): Promise<Response> {
  return handlePublicChat(request, 'send');
}
