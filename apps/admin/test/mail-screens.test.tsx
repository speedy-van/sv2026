import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type * as ExpoModules from 'expo-modules-core';
import MailScreen from '../app/(app)/mail';
import MailDeliveriesScreen from '../app/(app)/mail/deliveries';
import { MailThread } from '../src/components/mail-thread';
import { mailCopy } from '../src/content/mail';
import { mailContent, mailDelivery, mailList, mailMessage, mailStatus, mailThread } from './mail-fixtures';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual<typeof ExpoModules>('expo-modules-core');
  return { ...actual, uuid: { ...actual.uuid, v4: () => '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be' } };
});
jest.mock('../src/state/auth', () => ({ useAuth: () => ({ user: { id: mockActor } }) }));
jest.mock('../src/data/mail', () => ({
  useMailInbox: () => mockInbox,
  useMailThread: () => mockThread,
  useMailDeliveries: () => mockDeliveries,
}));
jest.mock('../src/components/mail-html', () => ({ MailHtml: () => null }));
jest.mock('../src/components/mail-attachment', () => ({ MailAttachment: () => null }));
let mockActor = 'admin-one';
const mockRefetch = jest.fn(() => Promise.resolve());
const mockReply = jest.fn<Promise<unknown>, [unknown]>();
const mockRead = jest.fn<Promise<unknown>, [unknown]>();
const mockAttachment = jest.fn<Promise<unknown>, [unknown]>();
const mockRetry = jest.fn<Promise<unknown>, [unknown]>();
const mockSync = jest.fn<Promise<unknown>, []>();
function session() {
  return {
    actorId: mockActor,
    enabled: true,
    privateReady: true,
    offline: false,
    revision: 0,
    identityRevision: 0,
    isCurrent: () => true,
    isIdentityCurrent: () => true,
  };
}
function query<Data>(data: Data | undefined) {
  return {
    data,
    isPending: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: mockRefetch,
    fetchNextPage: mockRefetch,
  };
}
let mockInbox = {
  session: session(),
  status: query<typeof mailStatus>(mailStatus),
  query: query<{ pages: (typeof mailList)[] }>({ pages: [mailList] }),
  sync: { mutateAsync: mockSync, isPending: false },
};
let mockThread = {
  session: session(),
  status: query(mailStatus),
  query: query<{ pages: (typeof mailThread)[] }>({ pages: [mailThread] }),
  reply: { mutateAsync: mockReply, isPending: false },
  read: { mutateAsync: mockRead },
  attachment: { mutateAsync: mockAttachment },
};
let mockDeliveries = {
  session: session(),
  query: query({ pages: [{ items: [mailDelivery], nextCursor: null }] }),
  retry: { mutateAsync: mockRetry },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockActor = 'admin-one';
  mockReply.mockReset().mockResolvedValue({ deliveryId: 'delivery-one', status: 'QUEUED' });
  mockRead.mockReset().mockResolvedValue({ ok: true });
  mockAttachment.mockReset().mockResolvedValue(mailContent);
  mockRetry.mockReset().mockResolvedValue({ deliveryId: 'delivery-one', status: 'QUEUED' });
  mockSync.mockReset().mockResolvedValue(mailStatus);
  mockInbox = {
    session: session(),
    status: query(mailStatus),
    query: query({ pages: [mailList] }),
    sync: { mutateAsync: mockSync, isPending: false },
  };
  mockThread = {
    session: session(),
    status: query(mailStatus),
    query: query({ pages: [mailThread] }),
    reply: { mutateAsync: mockReply, isPending: false },
    read: { mutateAsync: mockRead },
    attachment: { mutateAsync: mockAttachment },
  };
  mockDeliveries = {
    session: session(),
    query: query({ pages: [{ items: [mailDelivery], nextCursor: null }] }),
    retry: { mutateAsync: mockRetry },
  };
});

it('opens a real mail thread and shows mailbox status without treating queued replies as sent', async () => {
  const view = await render(<MailScreen />);
  expect(view.getByText('business@example.test')).toBeTruthy();
  expect(view.getByText('Moving details')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Open Moving details, unread' }));
  expect(router.push).toHaveBeenCalledWith('/(app)/mail/thread-one');
});

it('shows loading, empty, unavailable configuration and error retry states', async () => {
  mockInbox.status = { ...query(undefined), isPending: true };
  const view = await render(<MailScreen />);
  expect(view.getByTestId('screen-skeleton')).toBeTruthy();
  mockInbox.status = query({ ...mailStatus, configured: false });
  await view.rerender(<MailScreen />);
  expect(view.getByText(mailCopy.notConfigured)).toBeTruthy();
  mockInbox.status = query(mailStatus);
  mockInbox.query = query({ pages: [{ ...mailList, items: [] }] });
  await view.rerender(<MailScreen />);
  expect(view.getByText('No messages in Inbox.')).toBeTruthy();
  mockInbox.query = { ...query(undefined), isError: true };
  await view.rerender(<MailScreen />);
  expect(view.getByText(mailCopy.loadError)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(mockRefetch).toHaveBeenCalled();
});

it('retains the same reply idempotency key after a network failure and queues reply-all only on press', async () => {
  mockReply.mockRejectedValueOnce(new Error('Network interrupted'));
  const view = await render(<MailThread id="thread-one" />);
  await fireEvent.press(view.getByRole('button', { name: 'Reply to customer@example.test' }));
  await fireEvent.press(view.getByRole('tab', { name: 'Reply all' }));
  await fireEvent.changeText(view.getByLabelText('Email reply'), 'We have the details.');
  expect(mockReply).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Queue reply to all' }));
  await waitFor(() => {
    expect(view.getByText('Network interrupted')).toBeTruthy();
  });
  expect(view.getByLabelText('Email reply').props.value).toBe('We have the details.');
  await fireEvent.press(view.getByRole('button', { name: 'Queue reply to all' }));
  await waitFor(() => {
    expect(view.getByText(mailCopy.replyQueued)).toBeTruthy();
  });
  expect(mockReply.mock.calls[1]?.[0]).toEqual(mockReply.mock.calls[0]?.[0]);
  expect(mockReply).toHaveBeenLastCalledWith({
    id: 'message-one',
    reply: {
      mode: 'reply-all',
      text: 'We have the details.',
      clientMessageId: '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be',
    },
  });
});

it('disables offline sending, blocks unsafe attachments and uses authenticated attachment retrieval', async () => {
  const view = await render(<MailThread id="thread-one" />);
  expect(view.getByText('This file type is blocked.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Open unsafe.exe' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Open move.pdf' }));
  expect(mockAttachment).toHaveBeenCalledWith({ messageId: 'message-one', attachmentId: 'file/one' });
  mockThread.session = { ...session(), enabled: false, offline: true };
  await view.rerender(<MailThread id="thread-one" />);
  expect(view.getByRole('button', { name: 'Reply to customer@example.test' })).toBeDisabled();
});

it('identifies shortened messages in both plain and formatted views', async () => {
  mockThread.query = query({
    pages: [{ ...mailThread, messages: [{ ...mailMessage, bodyTruncated: true }] }],
  });
  const view = await render(<MailThread id="thread-one" />);
  expect(view.getByText(mailCopy.bodyTruncated)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Show formatted email' }));
  expect(view.getByText(mailCopy.bodyTruncated)).toBeTruthy();
});

it('shows an existing unconfirmed reply status instead of claiming that an idempotent retry was queued again', async () => {
  mockReply.mockResolvedValueOnce({ deliveryId: 'delivery-one', status: 'UNCERTAIN' });
  const view = await render(<MailThread id="thread-one" />);
  await fireEvent.press(view.getByRole('button', { name: 'Reply to customer@example.test' }));
  await fireEvent.changeText(view.getByLabelText('Email reply'), 'We have the details.');
  await fireEvent.press(view.getByRole('button', { name: 'Queue reply' }));
  await waitFor(() => {
    expect(view.getByText('Reply status: Delivery unconfirmed. Check Deliveries for details.')).toBeTruthy();
  });
  expect(view.queryByText(mailCopy.replyQueued)).toBeNull();
});

it('marks mail read on the explicit action and clears the reply draft when the account changes', async () => {
  const view = await render(<MailThread id="thread-one" />);
  await fireEvent.press(view.getByRole('button', { name: 'Mark read' }));
  expect(mockRead).toHaveBeenCalledWith({ id: mailMessage.id, read: true });
  await fireEvent.press(view.getByRole('button', { name: 'Reply to customer@example.test' }));
  await fireEvent.changeText(view.getByLabelText('Email reply'), 'Private draft');
  mockActor = 'admin-two';
  await view.rerender(<MailThread id="thread-one" />);
  expect(view.queryByLabelText('Email reply')).toBeNull();
});

it('requires a separate duplicate-risk confirmation before retrying an uncertain delivery', async () => {
  const view = await render(<MailDeliveriesScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Retry Reply to moving details' }));
  expect(mockRetry).not.toHaveBeenCalled();
  expect(view.getByText('Retry an unconfirmed delivery?')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Keep current delivery' }));
  expect(mockRetry).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Retry Reply to moving details' }));
  await fireEvent.press(view.getByRole('button', { name: 'Retry — I understand it may send twice' }));
  await waitFor(() => {
    expect(mockRetry).toHaveBeenCalledWith({ id: 'delivery-one', acknowledgeDuplicateRisk: true });
  });
});

it('retries a known failed delivery without acknowledging duplicate risk', async () => {
  mockDeliveries.query = query({
    pages: [{ items: [{ ...mailDelivery, status: 'FAILED' }], nextCursor: null }],
  });
  const view = await render(<MailDeliveriesScreen />);
  await act(async () => {
    await fireEvent.press(view.getByRole('button', { name: 'Retry Reply to moving details' }));
  });
  expect(mockRetry).toHaveBeenCalledWith({ id: 'delivery-one', acknowledgeDuplicateRisk: false });
});

it('previews the actual Reply-To target and reply-all Cc without including the business mailbox', async () => {
  const message = {
    ...mailMessage,
    replyTo: [{ address: 'reply-desk@example.test' }],
    cc: [...mailMessage.cc, { address: 'BUSINESS@example.test' }],
  };
  mockThread.query = query({ pages: [{ ...mailThread, messages: [message] }] });
  const view = await render(<MailThread id="thread-one" />);
  await fireEvent.press(view.getByRole('button', { name: 'Reply to reply-desk@example.test' }));
  expect(view.getByText('To: reply-desk@example.test')).toBeTruthy();
  await fireEvent.press(view.getByRole('tab', { name: 'Reply all' }));
  expect(view.getByText('Cc: helper@example.test')).toBeTruthy();
});

it('offers a Sent-folder repair when delivery succeeded and its sent copy is still pending', async () => {
  mockDeliveries.query = query({
    pages: [{ items: [{ ...mailDelivery, status: 'SENT', sentAt: mailMessage.sentAt }], nextCursor: null }],
  });
  const view = await render(<MailDeliveriesScreen />);
  expect(view.getByText('Email sent. Its copy could not yet be saved in the Sent folder.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Save Sent-folder copy again' }));
  expect(mockRetry).toHaveBeenCalledWith({ id: 'delivery-one', acknowledgeDuplicateRisk: false });
});
