import { PushDevicePutSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { disableCurrentPushDevices, upsertPushDevice } from '@/server/auth/staff';

export async function PUT(request: Request): Promise<Response> {
  return withApi(request, { auth: {}, input: PushDevicePutSchema }, async ({ input, requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    await upsertPushDevice(staff, input);
    return apiJson({ ok: true }, { status: 200 }, requestId);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    await disableCurrentPushDevices(staff);
    return apiJson({ ok: true }, { status: 200 }, requestId);
  });
}
