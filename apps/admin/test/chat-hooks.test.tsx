import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  AdminChatInboxResponseSchema,
  AdminChatSendRequestSchema,
  ChatReadResponseSchema,
  ChatSendResponseSchema,
  ChatMessagesResponseSchema,
  type ChatConversation,
  type ChatMessage,
} from '@sv/contracts';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { AppStateStatus } from 'react-native';
import type { z } from 'zod';
import { mergeChatMessages, useChatInbox, useChatThread, useChatUnread } from '../src/data/chat';
import { subscribeIncomingChatMessages } from '../src/notifications/chat-sound-events';

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: mockApi,
    status: mockStatus,
    appLocked: mockLocked,
    user: mockActor ? { id: mockActor } : null,
  }),
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockAppState;
    },
    addEventListener: (_event: string, listener: (state: AppStateStatus) => void) => {
      mockAppStateListener = listener;
      if (mockStateOnSubscribe) mockAppState = mockStateOnSubscribe;
      return { remove: jest.fn() };
    },
  },
}));

let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockStatus = 'signed-in';
let mockLocked = false;
let mockFocused = true;
let mockActor: string | null = 'chat-admin';
let mockAppState: AppStateStatus | null = 'active';
let mockStateOnSubscribe: AppStateStatus | undefined;
let mockAppStateListener: ((state: AppStateStatus) => void) | undefined;
const mockRequest = jest.fn<
  Promise<unknown>,
  [string, { schema: z.ZodType; method?: string; body?: unknown }]
>();
const mockApi = { request: mockRequest };
const clients: QueryClient[] = [];
const conversation: ChatConversation = {
  id: 'chat-1',
  customerName: 'Test Customer',
  createdAt: '2031-10-15T12:00:00.000Z',
  updatedAt: '2031-10-15T12:00:00.000Z',
  lastMessageAt: '2031-10-15T12:00:00.000Z',
  unreadCount: 1,
};
const first: ChatMessage = {
  id: 'message-1',
  clientMessageId: '69d18e64-2d82-42f1-81c9-9ec19cb2ee7d',
  sender: 'CUSTOMER',
  body: 'Can you help with my move?',
  createdAt: conversation.createdAt,
};
const reply: ChatMessage = {
  id: 'message-2',
  clientMessageId: '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be',
  sender: 'ADMIN',
  body: 'We can help. What are your addresses?',
  createdAt: '2031-10-15T12:01:00.000Z',
};
const initial = { conversation, messages: [first], cursor: first.id, olderCursor: first.id, hasMore: true };
const inbox = { items: [{ ...conversation, lastMessage: first }], nextCursor: null, unreadCount: 1 };

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, placeholderData: keepPreviousData },
      mutations: { gcTime: Infinity, retry: 3, retryDelay: 0 },
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

function useObservedThread() {
  const chat = useChatThread(conversation.id);
  return { ...chat, observedData: chat.query.data };
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2031-10-15T12:02:00Z') });
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockStatus = 'signed-in';
  mockLocked = false;
  mockFocused = true;
  mockActor = 'chat-admin';
  mockAppState = 'active';
  mockStateOnSubscribe = undefined;
  mockAppStateListener = undefined;
  mockRequest
    .mockReset()
    .mockImplementation((path, options) =>
      Promise.resolve(
        options.schema.parse(
          path.includes('/messages')
            ? initial
            : path.endsWith('/read')
              ? { conversation: { ...conversation, unreadCount: 0 } }
              : inbox,
        ),
      ),
    );
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.useRealTimers();
});

describe('admin live chat data', () => {
  it('starts polling while native startup state is unknown instead of stranding chat until a relaunch', async () => {
    mockAppState = null;
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    const next = { ...first, id: 'live-customer-after-cold-start', body: 'I have another question.' };
    mockRequest.mockResolvedValue({ ...initial, messages: [next], cursor: next.id, hasMore: false });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.messages).toEqual([first, next]);
    });
  });

  it('rechecks native state after listener registration so a startup transition cannot be missed', async () => {
    mockAppState = 'inactive';
    mockStateOnSubscribe = 'active';
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
  });

  it('loads validated unread counts on an actor-specific key and polls only in the foreground', async () => {
    const context = setup();
    const hook = await renderHook(useChatUnread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/chats?limit=100', {
      schema: AdminChatInboxResponseSchema,
    });
    expect(context.client.getQueryData(['admin', 'chat-admin', 'chat-unread'])).toEqual(inbox);
    const calls = mockRequest.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(mockRequest).toHaveBeenCalledTimes(calls + 1);
    await act(() => {
      mockAppStateListener?.('background');
    });
    const pausedCalls = mockRequest.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockRequest).toHaveBeenCalledTimes(pausedCalls);
  });

  it.each(['signed-out', 'locked', 'offline', 'unfocused'] as const)(
    'does not fetch an inbox when %s',
    async (condition) => {
      if (condition === 'signed-out') mockStatus = 'idle';
      if (condition === 'locked') mockLocked = true;
      if (condition === 'offline') mockNetwork.isConnected = false;
      if (condition === 'unfocused') mockFocused = false;
      const context = setup();
      await renderHook(useChatInbox, { wrapper: context.wrapper });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('never carries another admin account into a new actor cache even when global placeholder data is configured', async () => {
    const context = setup();
    const hook = await renderHook(useChatUnread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.data).toEqual(inbox);
    });
    mockActor = 'another-admin';
    mockRequest.mockImplementation(() => new Promise(() => undefined));
    await hook.rerender({});
    expect(hook.result.current.data).toBeUndefined();
  });

  it.each(['unread', 'thread', 'inbox'] as const)(
    'immediately refreshes a still-fresh cached %s on foreground resume',
    async (kind) => {
      const context = setup();
      const useProbe =
        kind === 'unread' ? useChatUnread : kind === 'inbox' ? useChatInbox : useObservedThread;
      await renderHook(
        () => {
          useProbe();
        },
        { wrapper: context.wrapper },
      );
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(1);
      });
      await act(() => {
        mockAppStateListener?.('background');
      });
      const before = mockRequest.mock.calls.length;
      await act(() => {
        mockAppStateListener?.('active');
      });
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(before + 1);
      });
    },
  );

  it('refreshes a fresh inbox immediately after returning from another screen, without restarting the app', async () => {
    const context = setup();
    const hook = await renderHook(useChatInbox, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    mockFocused = false;
    await hook.rerender({});
    const newCustomer = { ...first, id: 'new-message-in-inbox', body: 'Is anyone there?' };
    const updated = {
      ...inbox,
      items: [{ ...conversation, unreadCount: 2, lastMessage: newCustomer }],
      unreadCount: 2,
    };
    mockRequest.mockResolvedValue(updated);
    mockFocused = true;
    await hook.rerender({});
    await waitFor(() => {
      expect(hook.result.current.query.data?.pages[0]).toEqual(updated);
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('polls forward from the last message and deduplicates repeated messages while retaining history pagination', async () => {
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    mockRequest.mockImplementation((path, options) =>
      Promise.resolve(
        options.schema.parse(
          path.includes('after=')
            ? { ...initial, messages: [first, reply], cursor: reply.id, hasMore: false }
            : initial,
        ),
      ),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.messages).toEqual([first, reply]);
    });
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/api/v1/admin/chats/chat-1/messages?limit=50&after=message-1',
      { schema: ChatMessagesResponseSchema },
    );
    expect(hook.result.current.query.data?.hasOlder).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.messages).toEqual([first, reply]);
    });
  });

  it('posts a trimmed shared-contract reply once, updates the thread and invalidates team unread state', async () => {
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    context.client.setQueryData(['admin', 'chat-admin', 'chat-unread'], inbox);
    context.client.setQueryData(['admin', 'chat-admin', 'chat-inbox'], {
      pages: [inbox],
      pageParams: [null],
    });
    const interleaved = { ...first, id: 'interleaved-customer-message', body: 'One more detail.' };
    mockRequest.mockImplementation((_path, options) =>
      Promise.resolve(
        options.schema.parse(
          options.method === 'POST'
            ? { conversation, message: reply }
            : { ...initial, messages: [interleaved, reply], cursor: reply.id, hasMore: false },
        ),
      ),
    );
    await act(async () => {
      await hook.result.current.send.mutateAsync({
        body: `  ${reply.body}  `,
        clientMessageId: reply.clientMessageId,
      });
    });
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/chats/chat-1/messages', {
      method: 'POST',
      schema: ChatSendResponseSchema,
      body: AdminChatSendRequestSchema.parse({ body: reply.body, clientMessageId: reply.clientMessageId }),
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.messages).toEqual([first, interleaved, reply]);
    });
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/api/v1/admin/chats/chat-1/messages?limit=50&after=message-1',
      {
        schema: ChatMessagesResponseSchema,
      },
    );
    expect(context.client.getQueryState(['admin', 'chat-admin', 'chat-unread'])?.isInvalidated).toBe(true);
    expect(context.client.getQueryState(['admin', 'chat-admin', 'chat-inbox'])?.isInvalidated).toBe(true);
  });

  it('does not retry writes automatically and rejects offline sending before touching the API', async () => {
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    mockRequest.mockRejectedValue(new Error('Connection dropped'));
    const calls = mockRequest.mock.calls.length;
    await act(async () => {
      await expect(
        hook.result.current.send.mutateAsync({ body: reply.body, clientMessageId: reply.clientMessageId }),
      ).rejects.toThrow('Connection dropped');
    });
    expect(mockRequest).toHaveBeenCalledTimes(calls + 1);
    mockNetwork.isConnected = false;
    await hook.rerender({});
    await act(async () => {
      await expect(
        hook.result.current.send.mutateAsync({ body: reply.body, clientMessageId: reply.clientMessageId }),
      ).rejects.toThrow('while online');
    });
    expect(mockRequest).toHaveBeenCalledTimes(calls + 1);
  });

  it('posts the visible message watermark and applies the real team unread response', async () => {
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    await act(async () => {
      await hook.result.current.read.mutateAsync(first.id);
    });
    expect(mockRequest).toHaveBeenLastCalledWith('/api/v1/admin/chats/chat-1/read', {
      method: 'POST',
      schema: ChatReadResponseSchema,
      body: { messageId: first.id },
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.conversation.unreadCount).toBe(0);
    });
  });

  it('prepends older messages without losing a current reply', async () => {
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    const older = { ...first, id: 'earlier-message', createdAt: '2031-10-15T11:00:00.000Z' };
    mockRequest.mockImplementation((_path, options) =>
      Promise.resolve(
        options.schema.parse({ ...initial, messages: [older], olderCursor: older.id, hasMore: false }),
      ),
    );
    await act(async () => {
      await hook.result.current.older.mutateAsync();
    });
    await waitFor(() => {
      expect(hook.result.current.query.data?.messages).toEqual([older, first]);
    });
    expect(hook.result.current.query.data?.hasOlder).toBe(false);
  });

  it('preserves server order and replaces duplicate IDs instead of duplicating the same message', () => {
    expect(mergeChatMessages([first, reply], [{ ...reply, body: 'Updated' }])).toEqual([
      first,
      { ...reply, body: 'Updated' },
    ]);
  });
  it('keeps database sequence order when a later message has an earlier application timestamp', () => {
    const clockSkewed = { ...reply, createdAt: '2031-10-15T11:59:59.000Z' };
    expect(mergeChatMessages([first], [clockSkewed])).toEqual([first, clockSkewed]);
  });

  it('publishes only live forward GET pages, never initial or older history', async () => {
    const received = jest.fn();
    const unsubscribe = subscribeIncomingChatMessages(received);
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    expect(received).not.toHaveBeenCalled();
    const next = { ...first, id: 'new-customer' };
    mockRequest.mockResolvedValue({ ...initial, messages: [next], cursor: next.id, hasMore: false });
    await act(async () => {
      await hook.result.current.query.refetch();
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({
      actorId: 'chat-admin',
      conversationId: 'chat-1',
      messages: [next],
    });
    received.mockClear();
    await act(async () => {
      await hook.result.current.older.mutateAsync();
    });
    expect(received).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('silently drains cached forward history after resume, even across multiple catch-up pages', async () => {
    const received = jest.fn();
    const unsubscribe = subscribeIncomingChatMessages(received);
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    await act(() => {
      mockAppStateListener?.('background');
    });
    await act(() => {
      mockAppStateListener?.('active');
    });
    const catchUp = { ...first, id: 'background-customer' };
    mockRequest.mockResolvedValue({ ...initial, messages: [catchUp], cursor: catchUp.id, hasMore: true });
    await act(async () => {
      await hook.result.current.query.refetch();
    });
    expect(received).not.toHaveBeenCalled();
    const finalCatchUp = { ...first, id: 'last-background-customer' };
    mockRequest.mockResolvedValue({
      ...initial,
      messages: [finalCatchUp],
      cursor: finalCatchUp.id,
      hasMore: false,
    });
    await act(async () => {
      await hook.result.current.query.refetch();
    });
    expect(received).not.toHaveBeenCalled();
    const live = { ...first, id: 'new-live-customer' };
    mockRequest.mockResolvedValue({ ...initial, messages: [live], cursor: live.id, hasMore: false });
    await act(async () => {
      await hook.result.current.query.refetch();
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({
      actorId: 'chat-admin',
      conversationId: 'chat-1',
      messages: [live],
    });
    unsubscribe();
  });

  it('does not publish a slow request that straddles background and foreground transitions', async () => {
    const received = jest.fn();
    const unsubscribe = subscribeIncomingChatMessages(received);
    const context = setup();
    const hook = await renderHook(useObservedThread, { wrapper: context.wrapper });
    await waitFor(() => {
      expect(hook.result.current.query.isSuccess).toBe(true);
    });
    let resolve: ((value: unknown) => void) | undefined;
    mockRequest.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = hook.result.current.query.refetch();
    await act(() => {
      mockAppStateListener?.('background');
    });
    await act(() => {
      mockAppStateListener?.('active');
    });
    await act(async () => {
      resolve?.({
        ...initial,
        messages: [{ ...first, id: 'late-response' }],
        cursor: 'late-response',
        hasMore: false,
      });
      await pending;
    });
    expect(received).not.toHaveBeenCalled();
    unsubscribe();
  });
});
