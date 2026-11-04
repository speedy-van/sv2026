import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { z } from 'zod';
import { MailAttachmentResponseSchema } from '@sv/contracts';
import { useMailDeliveries, useMailInbox, useMailThread } from '../src/data/mail';
import { mailContent, mailDelivery, mailList, mailStatus, mailThread } from './mail-fixtures';

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: mockApi,
    status: 'signed-in',
    appLocked: mockLocked,
    user: { id: mockActor, role: 'ADMIN' },
  }),
}));
let mockFocused = true;
let mockLocked = false;
let mockActor = 'admin-one';
let mockNetwork = { isConnected: true, isInternetReachable: true };
const mockRequest = jest.fn<
  Promise<unknown>,
  [string, { schema: z.ZodType; method?: string; body?: unknown; signal?: AbortSignal }]
>();
const mockApi = { request: mockRequest };
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 3, retryDelay: 0, gcTime: Infinity },
    },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  mockFocused = true;
  mockLocked = false;
  mockActor = 'admin-one';
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockRequest
    .mockReset()
    .mockImplementation((path, options) =>
      Promise.resolve(
        options.schema.parse(
          path.endsWith('/status') || path.endsWith('/sync')
            ? mailStatus
            : path.includes('/attachments/')
              ? mailContent
              : path.endsWith('/read')
                ? { ok: true }
                : path.endsWith('/reply') || path.endsWith('/retry')
                  ? { deliveryId: 'delivery-one', status: 'QUEUED' }
                  : path.includes('/threads/')
                    ? mailThread
                    : path.includes('/deliveries')
                      ? { items: [mailDelivery], nextCursor: null }
                      : mailList,
        ),
      ),
    );
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

it('loads status then paginated folder results with encoded search and cancels through query signals', async () => {
  const context = setup();
  const hook = await renderHook(() => useMailInbox('sent', 'name & details'), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.isSuccess).toBe(true);
  });
  const request = mockRequest.mock.calls.find(([path]) => path.includes('/messages?'));
  expect(request?.[0]).toContain('folder=sent');
  expect(request?.[0]).toContain('q=name+%26+details');
  expect(request?.[1].signal).toBeDefined();
  expect(
    context.client.getQueryData(['admin', 'admin-one', 'mail', 'messages', 'sent', 'name & details']),
  ).toBeDefined();
});

it('does not fetch mailbox content when the provider is unconfigured', async () => {
  mockRequest.mockImplementation((_path, options) =>
    Promise.resolve(options.schema.parse({ ...mailStatus, configured: false })),
  );
  const context = setup();
  const hook = await renderHook(() => useMailInbox('inbox', ''), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.status.isSuccess).toBe(true);
  });
  expect(mockRequest.mock.calls.every(([path]) => path.endsWith('/status'))).toBe(true);
});

it('blocks mailbox reads and mutations while locked, offline or unfocused', async () => {
  mockLocked = true;
  const context = setup();
  const hook = await renderHook(() => useMailThread('thread-one'), { wrapper: context.wrapper });
  await act(async () => {
    await expect(hook.result.current.read.mutateAsync({ id: 'message-one', read: true })).rejects.toThrow(
      'unlock',
    );
  });
  expect(mockRequest).not.toHaveBeenCalled();
  mockLocked = false;
  mockNetwork.isConnected = false;
  await hook.rerender(undefined);
  await act(async () => {
    await expect(
      hook.result.current.attachment.mutateAsync({ messageId: 'message-one', attachmentId: 'file/one' }),
    ).rejects.toThrow('online');
  });
  mockNetwork.isConnected = true;
  mockFocused = false;
  await hook.rerender(undefined);
  expect(hook.result.current.session.enabled).toBe(false);
  expect(mockRequest).not.toHaveBeenCalled();
});

it('uses shared schemas, encodes attachment identifiers and invalidates cached reads after a read toggle', async () => {
  const context = setup();
  const hook = await renderHook(() => useMailThread('thread-one'), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.isSuccess).toBe(true);
  });
  await act(async () => {
    await hook.result.current.read.mutateAsync({ id: 'message-one', read: true });
  });
  expect(mockRequest).toHaveBeenCalledWith(
    '/api/v1/admin/mail/messages/message-one/read',
    expect.objectContaining({ body: { read: true }, method: 'POST' }),
  );
  await act(async () => {
    await hook.result.current.attachment.mutateAsync({ messageId: 'message-one', attachmentId: 'file/one' });
  });
  expect(mockRequest).toHaveBeenCalledWith(
    '/api/v1/admin/mail/messages/message-one/attachments/file%2Fone',
    expect.objectContaining({ schema: MailAttachmentResponseSchema }),
  );
});

it('does not automatically resend a failed reply even when the global mutation default retries', async () => {
  const context = setup();
  const hook = await renderHook(() => useMailThread('thread-one'), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.isSuccess).toBe(true);
  });
  mockRequest.mockRejectedValueOnce(new Error('Network interrupted'));
  const input = {
    id: 'message-one',
    reply: {
      clientMessageId: '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be',
      mode: 'reply-all' as const,
      text: 'Confirmed',
    },
  };
  await act(async () => {
    await expect(hook.result.current.reply.mutateAsync(input)).rejects.toThrow('Network interrupted');
  });
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/reply'))).toHaveLength(1);
});

it('never carries cached mail into another account and rejects a response delivered after the account changes', async () => {
  const context = setup();
  const hook = await renderHook(() => useMailThread('thread-one'), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.isSuccess).toBe(true);
  });
  let complete: ((value: unknown) => void) | undefined;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  let rejected: Promise<void> | undefined;
  await act(() => {
    const pending = hook.result.current.attachment.mutateAsync({
      messageId: 'message-one',
      attachmentId: 'file/one',
    });
    rejected = expect(pending).rejects.toThrow('session changed');
  });
  mockActor = 'admin-two';
  await hook.rerender(undefined);
  await act(async () => {
    complete?.(mailContent);
    await rejected;
  });
  expect(hook.result.current.session.actorId).toBe('admin-two');
});

it('passes explicit duplicate-risk acknowledgement to delivery retry without retrying automatically', async () => {
  const context = setup();
  const hook = await renderHook(useMailDeliveries, { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.isSuccess).toBe(true);
  });
  await act(async () => {
    await hook.result.current.retry.mutateAsync({ id: 'delivery-one', acknowledgeDuplicateRisk: true });
  });
  expect(mockRequest).toHaveBeenCalledWith(
    '/api/v1/admin/mail/deliveries/delivery-one/retry',
    expect.objectContaining({ body: { acknowledgeDuplicateRisk: true } }),
  );
});
