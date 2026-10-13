import { handleAdminRoute, type AdminMethod } from '@/server/admin/routes';

interface RouteParams {
  params: Promise<{ path?: string[] }>;
}

async function pathFrom(context: RouteParams): Promise<string> {
  const params = await context.params;
  return (params.path ?? []).join('/');
}

async function handle(request: Request, method: AdminMethod, context: RouteParams): Promise<Response> {
  return handleAdminRoute(request, method, await pathFrom(context));
}

export async function GET(request: Request, context: RouteParams): Promise<Response> {
  return handle(request, 'GET', context);
}

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  return handle(request, 'POST', context);
}

export async function PATCH(request: Request, context: RouteParams): Promise<Response> {
  return handle(request, 'PATCH', context);
}

export async function PUT(request: Request, context: RouteParams): Promise<Response> {
  return handle(request, 'PUT', context);
}

export async function DELETE(request: Request, context: RouteParams): Promise<Response> {
  return handle(request, 'DELETE', context);
}
