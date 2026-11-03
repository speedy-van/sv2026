import { act, renderHook, waitFor } from '@testing-library/react-native';
import { DriverCreateResponseSchema, type DriverCreateRequest } from '@sv/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { z } from 'zod';
import { useAddDriver } from '../src/data/drivers';

jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }),
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: { request: mockRequest },
    status: mockStatus,
    appLocked: mockLocked,
    user: mockActorId ? { id: mockActorId, role: mockRole } : null,
  }),
}));

interface CreateOptions {
  body: unknown;
  method: 'POST';
  schema: z.ZodType;
}
const mockRequest = jest.fn<Promise<unknown>, [string, CreateOptions]>();
let mockOffline = false;
let mockStatus = 'signed-in';
let mockLocked = false;
let mockActorId: string | null = 'test-admin';
let mockRole = 'ADMIN';
const input: DriverCreateRequest = {
  email: 'driver@example.test',
  password: '  Test-only driver password  ',
  phone: '+447700900123',
};
const acknowledgement = { id: 'test-driver-created', ok: true };
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe('direct driver creation without credential caching', () => {
  beforeEach(() => {
    mockOffline = false;
    mockStatus = 'signed-in';
    mockLocked = false;
    mockActorId = 'test-admin';
    mockRole = 'ADMIN';
    mockRequest
      .mockReset()
      .mockImplementation((_path, options) => Promise.resolve(options.schema.parse(acknowledgement)));
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
    jest.restoreAllMocks();
  });

  it('validates the exact password, normalizes contact values and never puts credentials in query or mutation cache', async () => {
    const context = setup();
    const hook = await renderHook(() => useAddDriver(), { wrapper: context.wrapper });
    await act(async () => {
      expect(
        await hook.result.current.addDriver({
          ...input,
          email: ' Driver@Example.Test ',
          phone: '+44 7700 900123',
        }),
      ).toEqual(acknowledgement);
    });
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/drivers', {
      method: 'POST',
      body: input,
      schema: DriverCreateResponseSchema,
    });
    expect(context.client.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(context.client.getQueryCache().getAll())).not.toContain(input.password);
    expect(hook.result.current.isPending).toBe(false);
  });

  it.each([
    { ...input, email: 'not an email' },
    { ...input, phone: '' },
    { ...input, password: 'short' },
    { ...input, password: ' '.repeat(12) },
  ])('rejects invalid credentials %# without a request', async (invalid) => {
    const context = setup();
    const hook = await renderHook(() => useAddDriver(), { wrapper: context.wrapper });
    await act(async () => {
      await expect(hook.result.current.addDriver(invalid)).rejects.toThrow();
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'locked', 'driver', 'missing-user', 'offline'])(
    'blocks creation when %s',
    async (guard) => {
      if (guard === 'signed-out') mockStatus = 'idle';
      if (guard === 'locked') mockLocked = true;
      if (guard === 'driver') mockRole = 'DRIVER';
      if (guard === 'missing-user') mockActorId = null;
      if (guard === 'offline') mockOffline = true;
      const context = setup();
      const hook = await renderHook(() => useAddDriver(), { wrapper: context.wrapper });
      await act(async () => {
        await expect(hook.result.current.addDriver(input)).rejects.toThrow();
      });
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('refreshes only the initiating admin directory and keeps an in-flight duplicate from posting twice', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    mockRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const context = setup();
    const firstKey = ['admin', 'test-admin', 'drivers'];
    const otherKey = ['admin', 'other-admin', 'drivers'];
    const publicKey = ['public', 'drivers'];
    for (const key of [firstKey, otherKey, publicKey]) context.client.setQueryData(key, { items: [] });
    const hook = await renderHook(() => useAddDriver(), { wrapper: context.wrapper });
    let request: Promise<unknown> | undefined;
    await act(async () => {
      request = hook.result.current.addDriver(input);
      await expect(hook.result.current.addDriver(input)).rejects.toThrow('already being added');
    });
    await waitFor(() => {
      expect(hook.result.current.isPending).toBe(true);
    });
    mockActorId = 'other-admin';
    await hook.rerender({});
    await act(async () => {
      if (!resolveRequest) throw new Error('Test request is not pending.');
      resolveRequest(acknowledgement);
      await request;
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(context.client.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(context.client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(context.client.getQueryState(publicKey)?.isInvalidated).toBe(false);
    expect(context.client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('does not automatically retry rejected credentials and is usable for a deliberate second attempt', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Test failure'));
    const context = setup();
    const hook = await renderHook(() => useAddDriver(), { wrapper: context.wrapper });
    await act(async () => {
      await expect(hook.result.current.addDriver(input)).rejects.toThrow('Test failure');
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isPending).toBe(false);
    await act(async () => {
      expect(await hook.result.current.addDriver(input)).toEqual(acknowledgement);
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
