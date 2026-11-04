import { handleAdminMail } from '@/server/mail/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }): Promise<Response> {
  const params = await context.params;
  return handleAdminMail(request, 'attachment', params.id, params.attachmentId);
}

