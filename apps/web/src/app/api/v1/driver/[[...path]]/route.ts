import { handleDriverRoute, type DriverMethod } from '@/server/driver/routes';

interface RouteParams {
  params: Promise<{ path?: string[] }>;
}

async function pathFrom(context: RouteParams): Promise<string> {
  const params = await context.params;
  return (params.path ?? []).join('/');
}

async function handle(request: Request, method: DriverMethod, context: RouteParams): Promise<Response> {
  return handleDriverRoute(request, method, await pathFrom(context));
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
