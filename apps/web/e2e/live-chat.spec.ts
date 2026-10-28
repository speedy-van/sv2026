import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ChatConversationSchema,
  ChatMessageSchema,
  ChatReadRequestSchema,
  ChatSendRequestSchema,
  type ChatConversation,
  type ChatMessage,
  type ChatSendRequest,
} from '@sv/contracts';

const secondMessageId = '00000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-15T18:00:00.000Z';

interface ChatFixture {
  calls: string[];
  unexpectedWrites: string[];
  sends: ChatSendRequest[];
  reads: string[];
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  failNextSend: boolean;
  failReads: boolean;
  replyBeforeNextSend: string | null;
  reply: (body: string) => void;
}

async function isolateChat(page: Page): Promise<ChatFixture> {
  const state: ChatFixture = {
    calls: [], unexpectedWrites: [], sends: [], reads: [], conversation: null,
    messages: [], failNextSend: false, failReads: false, replyBeforeNextSend: null,
    reply(body) {
      state.conversation = ChatConversationSchema.parse({
        id: 'chat-browser-test', customerName: state.conversation?.customerName ?? null,
        createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp, unreadCount: 1,
      });
      state.messages.push(ChatMessageSchema.parse({
        id: `admin-${String(state.messages.length + 1)}`, clientMessageId: secondMessageId,
        sender: 'ADMIN', body, createdAt: timestamp,
      }));
    },
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.startsWith('/api/v1/chat/')) {
      state.calls.push(`${request.method()} ${path}`);
      if (request.method() === 'GET' && state.failReads) {
        await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL', message: 'Chat could not be loaded. Please try again.' } } });
        return;
      }
      if (path === '/api/v1/chat/session' && request.method() === 'GET') {
        await route.fulfill({ json: { conversation: state.conversation } });
        return;
      }
      if (path === '/api/v1/chat/session' && request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({});
        state.conversation ??= ChatConversationSchema.parse({
          id: 'chat-browser-test', customerName: null,
          createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp, unreadCount: 0,
        });
        await route.fulfill({ json: { conversation: state.conversation } });
        return;
      }
      if (path === '/api/v1/chat/messages' && request.method() === 'GET') {
        const after = url.searchParams.get('after');
        const before = url.searchParams.get('before');
        const afterIndex = after ? state.messages.findIndex((message) => message.id === after) : -1;
        const beforeIndex = before ? state.messages.findIndex((message) => message.id === before) : -1;
        const candidates = beforeIndex >= 0 ? state.messages.slice(0, beforeIndex)
          : state.messages.slice(afterIndex >= 0 ? afterIndex + 1 : 0);
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const messages = after ? candidates.slice(0, limit) : candidates.slice(-limit);
        await route.fulfill({ json: {
          conversation: state.conversation, messages,
          cursor: messages.at(-1)?.id ?? after ?? null,
          olderCursor: messages[0]?.id ?? null, hasMore: candidates.length > limit,
        } });
        return;
      }
      if (path === '/api/v1/chat/messages' && request.method() === 'POST') {
        const input = ChatSendRequestSchema.parse(request.postDataJSON());
        state.sends.push(input);
        if (state.failNextSend) {
          state.failNextSend = false;
          await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL', message: 'Your message was not sent. Please try again.' } } });
          return;
        }
        // Simulate an admin reply committed after the last poll but before this send.
        if (state.replyBeforeNextSend) {
          state.reply(state.replyBeforeNextSend);
          state.replyBeforeNextSend = null;
        }
        state.conversation = ChatConversationSchema.parse({
          id: 'chat-browser-test', customerName: input.customerName ?? state.conversation?.customerName ?? null,
          createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp, unreadCount: 0,
        });
        const existing = state.messages.find((message) => message.clientMessageId === input.clientMessageId);
        const message = existing ?? ChatMessageSchema.parse({
          id: `customer-${String(state.messages.length + 1)}`, clientMessageId: input.clientMessageId,
          sender: 'CUSTOMER', body: input.body, createdAt: timestamp,
        });
        if (!existing) state.messages.push(message);
        await route.fulfill({ json: { conversation: state.conversation, message } });
        return;
      }
      if (path === '/api/v1/chat/read' && request.method() === 'POST') {
        const input = ChatReadRequestSchema.parse(request.postDataJSON());
        state.reads.push(input.messageId);
        if (state.conversation) state.conversation = { ...state.conversation, unreadCount: 0 };
        await route.fulfill({ json: { conversation: state.conversation } });
        return;
      }
      state.unexpectedWrites.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 409, json: { error: { message: 'Unexpected chat operation in isolated browser test.' } } });
      return;
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      state.unexpectedWrites.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 409, json: { error: { message: 'No non-chat writes are allowed in this test.' } } });
    } else if (path === '/api/v1/catalogue') {
      await route.fulfill({ json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } } });
    } else {
      await route.fulfill({ status: 404, json: { error: { message: 'Read is outside this browser test.' } } });
    }
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//u, (route) => route.abort());
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  return state;
}

async function visit(page: Page, path = '/'): Promise<void> {
  const consentSaved = (await page.context().cookies()).some((cookie) => cookie.name === 'sv_consent');
  await page.goto(path);
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/u);
  const cookies = page.getByRole('region', { name: 'Cookie preferences', exact: true });
  if (!consentSaved) {
    await expect(cookies).toBeVisible();
    await cookies.getByRole('button', { name: 'Reject all', exact: true }).click();
  }
  await expect(cookies).toBeHidden();
}

async function openChat(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Open live chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat with Speedy Van', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectWithinViewport(page: Page, element: Locator): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('An explicit viewport is required.');
  // Browser resize/visualViewport events settle asynchronously after setViewportSize.
  await expect.poll(async () => {
    const box = await element.boundingBox();
    if (!box) return ['missing visible bounds'];
    return [
      ...(box.x < -1 ? ['left'] : []),
      ...(box.y < -1 ? ['top'] : []),
      ...(box.x + box.width > viewport.width + 1 ? ['right'] : []),
      ...(box.y + box.height > viewport.height + 1 ? ['bottom'] : []),
    ];
  }).toEqual([]);
}

test.use({ reducedMotion: 'reduce' });

test('@foundation live chat stays idle until opened, sends to the admin and receives a reply', async ({ page }) => {
  const state = await isolateChat(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  expect(state.calls).toEqual([]);
  const dialog = await openChat(page);
  const message = dialog.getByRole('textbox', { name: 'Your message', exact: true });
  const send = dialog.getByRole('button', { name: 'Send message', exact: true });
  await expect(message).toBeVisible();
  await expect(send).toBeDisabled();
  expect(state.sends).toEqual([]);
  await dialog.getByRole('textbox', { name: 'Your name (optional)', exact: true }).fill('Browser Test');
  await message.fill('Could you help me move a sofa in Glasgow?');
  await send.click();
  await expect(dialog.getByText('Could you help me move a sofa in Glasgow?', { exact: true })).toBeVisible();
  await expect(message).toHaveValue('');
  expect(state.sends).toHaveLength(1);
  expect(state.calls.filter((call) => call === 'POST /api/v1/chat/session')).toHaveLength(1);
  expect(state.sends[0]).toMatchObject({ body: 'Could you help me move a sofa in Glasgow?', customerName: 'Browser Test' });
  state.reply('Yes, please tell us the collection and delivery postcodes.');
  await expect(dialog.getByText('Yes, please tell us the collection and delivery postcodes.', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect.poll(() => state.reads).toContain('admin-2');
  state.replyBeforeNextSend = 'We can also help with carrying the sofa.';
  await message.fill('Thank you. I will send the postcodes.');
  await send.click();
  await expect(dialog.getByText('We can also help with carrying the sofa.', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(dialog.getByText('Thank you. I will send the postcodes.', { exact: true })).toBeVisible();
  const transcript = await dialog.getByRole('log').innerText();
  expect(transcript.indexOf('We can also help with carrying the sofa.')).toBeLessThan(transcript.indexOf('Thank you. I will send the postcodes.'));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.locator('.floating-chat').evaluate((element) => (
    document.activeElement === element ? 'focused' : JSON.stringify({
      activeElement: document.activeElement?.tagName,
      activeClass: document.activeElement?.className,
      visibility: window.getComputedStyle(element).visibility,
      obstructed: element.closest('.floating-contact')?.getAttribute('data-obstructed'),
      suppressed: element.closest('.floating-contact')?.getAttribute('data-suppressed'),
    })
  ))).toBe('focused');
  state.reply('Your conversation is still here when you return.');
  await expect(page.locator('.floating-contact-unread')).toHaveText('1', { timeout: 22_000 });
  await openChat(page);
  await expect(dialog.getByText('Could you help me move a sofa in Glasgow?', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Your conversation is still here when you return.', { exact: true })).toBeVisible({ timeout: 12_000 });
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation a failed send preserves the message and retries with the same idempotency key', async ({ page }) => {
  const state = await isolateChat(page);
  state.failNextSend = true;
  await visit(page);
  const dialog = await openChat(page);
  const message = dialog.getByRole('textbox', { name: 'Your message', exact: true });
  await message.fill('Please check availability for my move.');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/not sent|try again/iu);
  await expect(message).toHaveValue('Please check availability for my move.');
  expect(state.sends).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('Please check availability for my move.', { exact: true })).toBeVisible();
  await expect(message).toHaveValue('');
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]?.clientMessageId).toBe(state.sends[0]?.clientMessageId);
  expect(state.calls.filter((call) => call === 'POST /api/v1/chat/session')).toHaveLength(1);
  expect(state.messages).toHaveLength(1);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation loading errors offer recovery and message text never renders as HTML', async ({ page }) => {
  const state = await isolateChat(page);
  // Persist the outage until Retry so a development Strict Mode remount cannot consume it.
  state.failReads = true;
  await visit(page);
  const dialog = await openChat(page);
  const retry = dialog.getByRole('button', { name: 'Retry loading messages', exact: true });
  await expect(retry).toBeVisible();
  state.failReads = false;
  await retry.click();
  const message = dialog.getByRole('textbox', { name: 'Your message', exact: true });
  await expect(message).toBeEnabled();
  const body = '<img data-chat-xss src=x onerror="window.chatInjected=true">';
  await message.fill(body);
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText(body, { exact: true })).toBeVisible();
  await expect(dialog.locator('img[data-chat-xss]')).toHaveCount(0);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation earlier messages can be loaded without losing the current conversation', async ({ page }) => {
  const state = await isolateChat(page);
  state.reply('Oldest message in this conversation.');
  for (let index = 1; index <= 50; index += 1) {
    state.messages.push(ChatMessageSchema.parse({
      id: `history-${String(index)}`,
      clientMessageId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      sender: index % 2 === 0 ? 'ADMIN' : 'CUSTOMER',
      body: `Conversation message ${String(index)}.`, createdAt: timestamp,
    }));
  }
  await visit(page);
  const dialog = await openChat(page);
  await expect(dialog.getByText('Conversation message 50.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Oldest message in this conversation.', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(dialog.getByText('Oldest message in this conversation.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Conversation message 50.', { exact: true })).toBeVisible();
  expect(state.sends).toEqual([]);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation an expired chat session does not retain the previous thread in the composer', async ({ page }) => {
  const state = await isolateChat(page);
  state.reply('Message belonging to the previous chat session.');
  await visit(page);
  const dialog = await openChat(page);
  await expect(dialog.getByText('Message belonging to the previous chat session.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(dialog).toBeHidden();
  const sessionReads = state.calls.filter((call) => call === 'GET /api/v1/chat/session').length;
  state.conversation = null;
  state.messages = [];
  await expect.poll(() => state.calls.filter((call) => call === 'GET /api/v1/chat/session').length,
    { timeout: 22_000 }).toBeGreaterThan(sessionReads);
  await openChat(page);
  await expect(dialog.getByText('Message belonging to the previous chat session.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Your name (optional)', exact: true })).toBeVisible();
  expect(state.sends).toEqual([]);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation chat and its contact icons remain accessible in narrow, tablet, desktop and short viewports', async ({ page }) => {
  const state = await isolateChat(page);
  for (const viewport of [
    { width: 360, height: 740 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await visit(page, '/book');
    const contact = page.getByRole('complementary', { name: 'Contact Speedy Van', exact: true });
    const controls = [
      contact.getByRole('button', { name: 'Open live chat', exact: true }),
      contact.getByRole('link', { name: 'WhatsApp Speedy Van (opens in a new tab)', exact: true }),
      contact.getByRole('link', { name: 'Call Speedy Van on 07465 227962', exact: true }),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      await expectWithinViewport(page, control);
      const box = await control.boundingBox();
      if (!box) throw new Error('A contact action is missing its touch target.');
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await controls[0]?.focus();
    await page.keyboard.press('Tab');
    await expect(controls[1] ?? contact).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(controls[2] ?? contact).toBeFocused();
    const dialog = await openChat(page);
    await expectWithinViewport(page, dialog);
    await expectWithinViewport(page, dialog.getByRole('textbox', { name: 'Your message', exact: true }));
    const result = await new AxeBuilder({ page }).include('[role="dialog"], dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.setViewportSize({ width: viewport.width, height: 420 });
    await expectWithinViewport(page, dialog);
    await expectWithinViewport(page, dialog.getByRole('textbox', { name: 'Your message', exact: true }));
    await dialog.getByRole('button', { name: 'Close chat', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(state.unexpectedWrites).toEqual([]);
});
