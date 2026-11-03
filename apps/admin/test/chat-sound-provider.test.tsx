import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AdminChatInboxResponse, ChatMessage } from '@sv/contracts';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { ChatSoundControl } from '../src/components/chat-sound-control';
import { chatCopy } from '../src/content/chat';
import { publishIncomingChatMessages } from '../src/notifications/chat-sound-events';
import { ChatSoundProvider, useChatSound } from '../src/notifications/chat-sound-provider';
import { handleForegroundChatPush } from '../src/notifications/chat-push';

const mockPlay = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockStop = jest.fn();
let mockActive = true;
let mockActor = 'admin-1';
let mockSnapshot: AdminChatInboxResponse;
let mockUpdatedAt = 1;
jest.mock('../src/data/chat', () => ({
  useChatRuntime: () => ({ enabled: mockActive, auth: { user: { id: mockActor } } }),
  useChatUnread: () => ({ data: mockSnapshot, dataUpdatedAt: mockUpdatedAt, isSuccess: true }),
}));
jest.mock('../src/notifications/use-chat-sound-player', () => ({
  useChatSoundPlayer: () => ({ play: mockPlay, stop: mockStop, failed: false }),
}));

const oldMessage: ChatMessage = {
  id: 'old',
  sender: 'CUSTOMER',
  body: 'Previous message',
  clientMessageId: '69d18e64-2d82-42f1-81c9-9ec19cb2ee7d',
  createdAt: '2031-10-15T12:00:00.000Z',
};
function incoming(id: string): ChatMessage {
  return { ...oldMessage, id };
}
function send(id: string, actorId = 'admin-1', sender: ChatMessage['sender'] = 'CUSTOMER'): void {
  publishIncomingChatMessages({ actorId, conversationId: 'chat-1', messages: [{ ...incoming(id), sender }] });
}
function push(id: string, recipientUserId = 'admin-1'): boolean {
  return handleForegroundChatPush({
    type: 'CHAT_MESSAGE', conversationId: 'chat-1', messageId: id, recipientUserId,
  });
}
function App(): React.ReactElement {
  return (
    <ChatSoundProvider>
      <ChatSoundControl />
    </ChatSoundProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPlay.mockReset().mockResolvedValue();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockActive = true;
  mockActor = 'admin-1';
  mockUpdatedAt = 1;
  mockSnapshot = {
    items: [
      {
        id: 'chat-1',
        customerName: null,
        createdAt: oldMessage.createdAt,
        updatedAt: oldMessage.createdAt,
        lastMessageAt: oldMessage.createdAt,
        unreadCount: 1,
        lastMessage: oldMessage,
        lastCustomerMessage: oldMessage,
        lastCustomerMessageSequence: '1',
      },
    ],
    unreadCount: 1,
    nextCursor: null,
    latestCustomerSequence: '1',
  };
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('plays only new customer deliveries once globally, and mute discards rather than queues arrivals', async () => {
  const view = await render(<App />);
  expect(mockPlay).not.toHaveBeenCalled();
  await act(() => {
    send('staff', 'admin-1', 'ADMIN');
    send('new');
    send('new');
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
  await fireEvent(view.getByRole('switch', { name: 'Chat sound' }), 'valueChange', false);
  await act(() => {
    send('while-muted');
  });
  expect(mockPlay).toHaveBeenCalledTimes(1);
  await fireEvent(view.getByRole('switch', { name: 'Chat sound' }), 'valueChange', true);
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });
  await act(() => {
    send('while-muted');
    send('after-enable');
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(3);
  });
});

it('shares push identities with thread and inbox polling so either delivery order plays once', async () => {
  await render(<App />);
  await act(() => {
    expect(push('push-first')).toBe(true);
    send('push-first');
    expect(push('push-first')).toBe(true);
    send('poll-first');
    expect(push('poll-first')).toBe(true);
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });
});

it('suppresses native audio for muted/previous-account pushes and leaves background sound to iOS', async () => {
  const view = await render(<App />);
  await fireEvent(view.getByRole('switch', { name: 'Chat sound' }), 'valueChange', false);
  await act(() => {
    expect(push('muted')).toBe(true);
    expect(push('previous-account', 'another-admin')).toBe(true);
  });
  expect(mockPlay).not.toHaveBeenCalled();
  mockActive = false;
  await view.rerender(<App />);
  expect(push('background')).toBe(false);
  expect(handleForegroundChatPush({ type: 'CHAT_MESSAGE' })).toBe(false);
  await view.unmount();
  expect(push('unmounted')).toBe(false);
});

it('requires a browser gesture, displays rejected autoplay, and retries the same sound visibly', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const view = await render(<App />);
  await act(() => {
    send('before-enable');
  });
  expect(mockPlay).not.toHaveBeenCalled();
  mockPlay.mockRejectedValueOnce(new Error('NotAllowedError'));
  await fireEvent.press(view.getByRole('button', { name: 'Test sound' }));
  await waitFor(() => {
    expect(view.getByRole('alert')).toHaveTextContent(chatCopy.soundError);
  });
  await fireEvent.press(view.getByRole('button', { name: 'Retry sound' }));
  await waitFor(() => {
    expect(view.queryByRole('alert')).toBeNull();
  });
  expect(view.getByRole('switch', { name: 'Chat sound' })).toBeChecked();
  await act(() => {
    send('actual-new');
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(3);
  });
});

it('stops when locked/backgrounded, ignores catch-up and other accounts, and resets on account change', async () => {
  const view = await render(<App />);
  await act(() => {
    send('new');
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
  mockActive = false;
  await view.rerender(<App />);
  expect(mockStop).toHaveBeenCalled();
  await act(() => {
    send('background');
  });
  mockActive = true;
  await view.rerender(<App />);
  mockSnapshot = { ...mockSnapshot, items: [], latestCustomerSequence: '2' };
  await view.rerender(<App />);
  await act(() => {
    send('background');
    send('other-admin', 'another-admin');
    send('after-resume');
  });
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });
  mockActor = 'another-admin';
  await view.rerender(<App />);
  await act(() => {
    send('old-account');
  });
  expect(mockPlay).toHaveBeenCalledTimes(2);
  await view.unmount();
  await act(() => {
    send('unmounted', 'another-admin');
  });
  expect(mockPlay).toHaveBeenCalledTimes(2);
});

it('does not enable or surface a late playback result after the app locks', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  let resolve: (() => void) | undefined;
  mockPlay.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const view = await render(<App />);
  await fireEvent.press(view.getByRole('button', { name: 'Test sound' }));
  mockActive = false;
  await view.rerender(<App />);
  await act(() => {
    resolve?.();
  });
  expect(view.getByRole('switch', { name: 'Chat sound' })).not.toBeChecked();
  expect(view.getByRole('switch', { name: 'Chat sound' })).toBeDisabled();
});

it('completes resume baselining on an unchanged successful poll before the next new message', async () => {
  const view = await render(<App />);
  mockActive = false;
  await view.rerender(<App />);
  mockActive = true;
  await view.rerender(<App />);
  mockUpdatedAt += 1; // React Query can retain the same data object for an unchanged successful fetch.
  await view.rerender(<App />);
  mockSnapshot = {
    ...mockSnapshot,
    items: mockSnapshot.items.map((item) => ({
      ...item,
      lastCustomerMessage: incoming('after-resume'),
      lastCustomerMessageSequence: '2',
    })),
    latestCustomerSequence: '2',
  };
  mockUpdatedAt += 1;
  await view.rerender(<App />);
  await waitFor(() => {
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
});

it('changes accounts without remounting its child navigator or retaining browser sound permission', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const mounted = jest.fn();
  const unmounted = jest.fn();
  function Navigator(): React.ReactElement {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <ChatSoundControl />;
  }
  const view = await render(
    <ChatSoundProvider>
      <Navigator />
    </ChatSoundProvider>,
  );
  await fireEvent.press(view.getByRole('button', { name: 'Test sound' }));
  await waitFor(() => {
    expect(view.getByRole('switch', { name: 'Chat sound' })).toBeChecked();
  });
  mockActor = 'another-admin';
  await view.rerender(
    <ChatSoundProvider>
      <Navigator />
    </ChatSoundProvider>,
  );
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  expect(view.getByRole('switch', { name: 'Chat sound' })).not.toBeChecked();
});

it('mutes synchronously before a delivery in the same interaction can start playback', async () => {
  let toggle: (() => void) | undefined;
  function Control(): React.ReactElement {
    toggle = useChatSound()?.toggle;
    return <ChatSoundControl />;
  }
  await render(
    <ChatSoundProvider>
      <Control />
    </ChatSoundProvider>,
  );
  await act(() => {
    toggle?.();
    send('same-interaction');
  });
  expect(mockPlay).not.toHaveBeenCalled();
});

it('bounds a stalled sound test and ignores its late completion', async () => {
  jest.useFakeTimers();
  jest.replaceProperty(Platform, 'OS', 'web');
  let resolve: (() => void) | undefined;
  mockPlay.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const view = await render(<App />);
  await fireEvent.press(view.getByRole('button', { name: 'Test sound' }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  expect(view.getByRole('button', { name: 'Retry sound' })).toBeEnabled();
  expect(view.getByRole('alert')).toHaveTextContent(chatCopy.soundError);
  await act(() => {
    resolve?.();
  });
  expect(view.getByRole('switch', { name: 'Chat sound' })).not.toBeChecked();
  await view.unmount();
  jest.useRealTimers();
});
