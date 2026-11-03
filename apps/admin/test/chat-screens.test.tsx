import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type * as ExpoModules from 'expo-modules-core';
import { DeviceEventEmitter } from 'react-native';
import ChatInboxScreen from '../app/(app)/chat';
import { ChatConversation } from '../app/(app)/chat/[id]';
import { chatCopy } from '../src/content/chat';
import { displayChatTime } from '../src/lib/chat-date-time';
import { AdminHeaderHeightContext } from '../src/shell/admin-header-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'chat-1' }),
}));
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual<typeof ExpoModules>('expo-modules-core');
  return { ...actual, uuid: { ...actual.uuid, v4: () => '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be' } };
});
jest.mock('../src/data/chat', () => ({
  useChatInbox: () => mockInbox,
  useChatThread: () => mockChat,
}));

const conversation = {
  id: 'chat-1',
  customerName: 'Test Customer',
  createdAt: '2031-10-15T12:00:00.000Z',
  updatedAt: '2031-10-15T12:00:00.000Z',
  lastMessageAt: '2031-10-15T12:00:00.000Z',
  unreadCount: 1,
};
const first = {
  id: 'message-1',
  clientMessageId: '69d18e64-2d82-42f1-81c9-9ec19cb2ee7d',
  sender: 'CUSTOMER' as const,
  body: 'Can you help with my move?',
  createdAt: conversation.createdAt,
};
const mockSend = jest.fn<Promise<unknown>, [unknown]>(() => Promise.resolve({}));
const mockRead = jest.fn();
const mockRefetch = jest.fn(() => Promise.resolve());
const mockOlder = jest.fn();
const mockReset = jest.fn();
let mockInbox: {
  offline: boolean;
  query: {
    data: { pages: { items: { lastMessage: typeof first }[] }[] } | undefined;
    isPending: boolean;
    isError: boolean;
    isRefetching: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: typeof mockRefetch;
    fetchNextPage: typeof mockRefetch;
  };
};
let mockChat: {
  offline: boolean;
  enabled: boolean;
  query: {
    data: { conversation: typeof conversation; messages: (typeof first)[]; hasOlder: boolean } | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: typeof mockRefetch;
  };
  send: { mutateAsync: typeof mockSend; isPending: boolean; isError: boolean; reset: typeof mockReset };
  read: { mutate: typeof mockRead; isPending: boolean; isError: boolean };
  older: { mutate: typeof mockOlder; isPending: boolean; isError: boolean };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset().mockResolvedValue({});
  mockInbox = {
    offline: false,
    query: {
      data: { pages: [{ items: [{ ...conversation, lastMessage: first }] }] },
      isPending: false,
      isError: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: mockRefetch,
      fetchNextPage: mockRefetch,
    },
  };
  mockChat = {
    offline: false,
    enabled: true,
    query: {
      data: { conversation, messages: [first], hasOlder: false },
      isPending: false,
      isError: false,
      refetch: mockRefetch,
    },
    send: { mutateAsync: mockSend, isPending: false, isError: false, reset: mockReset },
    read: { mutate: mockRead, isPending: false, isError: false },
    older: { mutate: mockOlder, isPending: false, isError: false },
  };
});

describe('admin live chat screens', () => {
  it('keeps reply and send above a small iPhone keyboard using the measured shell header, then restores controls', async () => {
    const view = await render(
      <AdminHeaderHeightContext value={100}>
        <ChatConversation conversationId="chat-1" />
      </AdminHeaderHeightContext>,
    );
    const avoiding = view.getByTestId('chat-keyboard-avoiding-view');
    await fireEvent(avoiding, 'layout', {
      persist: jest.fn(),
      nativeEvent: { layout: { y: 0, x: 0, height: 567, width: 320 } },
    });
    await fireEvent.changeText(view.getByLabelText('Your reply'), 'Reply while typing');
    await act(() => {
      DeviceEventEmitter.emit('keyboardWillShow', {
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { screenY: 377, height: 290, screenX: 0, width: 320 },
      });
    });
    expect(view.getByTestId('chat-keyboard-avoiding-view')).toHaveStyle({ paddingBottom: 290 });
    expect(view.queryByText('Website conversation · London time')).toBeNull();
    expect(view.getByRole('button', { name: 'Send reply' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: 'Send reply' }));
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ body: 'Reply while typing' }));
    await act(() => {
      DeviceEventEmitter.emit('keyboardWillHide', {
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { screenY: 667, height: 0, screenX: 0, width: 320 },
      });
    });
    expect(view.getByTestId('chat-keyboard-avoiding-view')).toHaveStyle({ paddingBottom: 0 });
    expect(view.getByText('Website conversation · London time')).toBeTruthy();
  });

  it('shows the inbox snippet, real unread count and London time, then opens the conversation', async () => {
    const view = await render(<ChatInboxScreen />);
    expect(view.getByText(first.body)).toBeTruthy();
    expect(view.getByText('1 unread')).toBeTruthy();
    expect(view.getByText(displayChatTime(first.createdAt))).toBeTruthy();
    await fireEvent.press(
      view.getByRole('button', { name: 'Open chat with Test Customer, 1 unread messages' }),
    );
    expect(router.push).toHaveBeenCalledWith('/(app)/chat/chat-1');
  });

  it('keeps loading, empty and error-with-retry states clear without inventing conversations', async () => {
    mockInbox.query = { ...mockInbox.query, data: undefined, isPending: true };
    const view = await render(<ChatInboxScreen />);
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();
    mockInbox.query = { ...mockInbox.query, isPending: false, isError: true };
    await view.rerender(<ChatInboxScreen />);
    expect(view.getByText(chatCopy.inboxError)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    mockInbox.query = { ...mockInbox.query, data: { pages: [{ items: [] }] }, isError: false };
    await view.rerender(<ChatInboxScreen />);
    expect(view.getByText(chatCopy.empty)).toBeTruthy();
  });

  it('marks only visible latest customer messages read, labels the reply and prevents empty sending', async () => {
    const view = await render(<ChatConversation conversationId="chat-1" />);
    expect(mockRead).toHaveBeenCalledWith('message-1');
    expect(view.getByLabelText('Your reply')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(view.getByText(first.body)).toBeTruthy();
  });

  it('preserves the same UUID and text for an uncertain send retry, then clears only a confirmed reply', async () => {
    mockSend.mockRejectedValueOnce(new Error('Connection dropped'));
    const view = await render(<ChatConversation conversationId="chat-1" />);
    await fireEvent.changeText(view.getByLabelText('Your reply'), '  We can help with that move.  ');
    await fireEvent.press(view.getByRole('button', { name: 'Send reply' }));
    expect(view.getByLabelText('Your reply').props.value).toBe('  We can help with that move.  ');
    mockChat.send.isError = true;
    await view.rerender(<ChatConversation conversationId="chat-1" />);
    expect(view.getByText(chatCopy.sendError)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Retry reply' }));
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0]?.[0]).toEqual(mockSend.mock.calls[1]?.[0]);
    expect(mockSend).toHaveBeenLastCalledWith({
      body: 'We can help with that move.',
      clientMessageId: '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be',
    });
    await waitFor(() => {
      expect(view.getByLabelText('Your reply').props.value).toBe('');
    });
  });

  it('shows offline feedback and disables replies without losing a written draft', async () => {
    const view = await render(<ChatConversation conversationId="chat-1" />);
    await fireEvent.changeText(view.getByLabelText('Your reply'), 'Still here');
    mockChat.offline = true;
    mockChat.enabled = false;
    await view.rerender(<ChatConversation conversationId="chat-1" />);
    expect(view.getByText(chatCopy.offline)).toBeTruthy();
    expect(view.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(view.getByLabelText('Your reply').props.value).toBe('Still here');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('offers a clear offline state instead of endless loading when no thread has been cached', async () => {
    mockChat.offline = true;
    mockChat.enabled = false;
    mockChat.query.data = undefined;
    mockChat.query.isPending = true;
    const view = await render(<ChatConversation conversationId="chat-1" />);
    expect(view.getByText(chatCopy.offline)).toBeTruthy();
    expect(view.queryByTestId('screen-skeleton')).toBeNull();
    expect(view.getByRole('button', { name: 'Back to live chat' })).toBeTruthy();
  });

  it('allows earlier history without automatically marking new offscreen messages read', async () => {
    mockChat.query.data = {
      conversation: { ...conversation, unreadCount: 0 },
      messages: [first],
      hasOlder: true,
    };
    const view = await render(<ChatConversation conversationId="chat-1" />);
    await fireEvent.press(view.getByRole('button', { name: chatCopy.older }));
    expect(mockOlder).toHaveBeenCalledTimes(1);
    mockChat.query.data = { conversation, messages: [{ ...first, id: 'new-message' }], hasOlder: true };
    await view.rerender(<ChatConversation conversationId="chat-1" />);
    expect(mockRead).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: chatCopy.newMessages })).toBeTruthy();
    await act(async () => {
      await fireEvent(view.getByLabelText('Messages with Test Customer'), 'scroll', {
        nativeEvent: {
          contentOffset: { y: 100 },
          contentSize: { height: 500 },
          layoutMeasurement: { height: 400 },
        },
      });
    });
    expect(mockRead).toHaveBeenCalledWith('new-message');
  });

  it('formats both summer and winter timestamps in London, independently of the device time zone', () => {
    expect(displayChatTime('2031-07-15T12:30:00.000Z')).toContain('13:30');
    expect(displayChatTime('2031-12-15T12:30:00.000Z')).toContain('12:30');
  });
});
