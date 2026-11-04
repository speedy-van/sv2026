import { handleAdminMail } from '@/server/mail/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(request: Request): Promise<Response> {
  return handleAdminMail(request, 'status');
}

