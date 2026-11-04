import { handleAdminMail } from '@/server/mail/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await context.params;
  return handleAdminMail(request, 'thread', params.id);
}

