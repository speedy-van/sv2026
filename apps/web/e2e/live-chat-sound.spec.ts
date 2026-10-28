import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ChatConversationSchema,
  ChatMessageSchema,
  ChatReadRequestSchema,
  ChatSendRequestSchema,
  type ChatConversation,
  type ChatMessage,
} from '@sv/contracts';

declare global {
  interface Window {
    chatSoundProbe: { plays: number; blocked: boolean; sources: string[] };
  }
}

const timestamp = '2026-10-15T18:00:00.000Z';

interface SoundFixture {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  unexpectedWrites: string[];
  forwardReads: number;
  replyBeforeNextSend: string | null;
  reply: (body: string) => void;
}

async function isolateChatAndAudio(page: Page): Promise<SoundFixture> {
  await page.addInitScript(() => {
    window.chatSoundProbe = { plays: 0, blocked: false, sources: [] };
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
      if (!this.muted && this.volume > 0) {
        window.chatSoundProbe.plays += 1;
        window.chatSoundProbe.sources.push(new URL(this.currentSrc || this.src, window.location.href).pathname);
      }
      return window.chatSoundProbe.blocked
        ? Promise.reject(new DOMException('Playback needs a user gesture.', 'NotAllowedError'))
        : Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function (): void { /* No actual audio leaves this test. */ };
    HTMLMediaElement.prototype.load = function (): void { /* Avoid browser media work after disposal. */ };
  });
  let serial = 0;
  const state: SoundFixture = {
    conversation: null, messages: [], unexpectedWrites: [], forwardReads: 0,
    replyBeforeNextSend: null,
    reply(body) {
      state.conversation ??= ChatConversationSchema.parse({
        id: 'chat-sound-browser-test', customerName: null,
        createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp, unreadCount: 0,
      });
      serial += 1;
      state.messages.push(ChatMessageSchema.parse({
        id: `admin-${String(serial)}`,
        clientMessageId: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
        sender: 'ADMIN', body, createdAt: timestamp,
      }));
      state.conversation = { ...state.conversation, unreadCount: state.conversation.unreadCount + 1 };
    },
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/chat/session') {
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({});
        state.conversation ??= ChatConversationSchema.parse({
          id: 'chat-sound-browser-test', customerName: null,
          createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp, unreadCount: 0,
        });
      }
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
      const messages = after ? candidates.slice(0, 50) : candidates.slice(-50);
      if (!before) state.forwardReads += 1;
      await route.fulfill({ json: {
        conversation: state.conversation, messages,
        cursor: messages.at(-1)?.id ?? null,
        olderCursor: messages[0]?.id ?? null, hasMore: candidates.length > 50,
      } });
      return;
    }
    if (path === '/api/v1/chat/messages' && request.method() === 'POST') {
      const input = ChatSendRequestSchema.parse(request.postDataJSON());
      if (state.replyBeforeNextSend) {
        state.reply(state.replyBeforeNextSend);
        state.replyBeforeNextSend = null;
      }
      if (!state.conversation) throw new Error('A chat send requires a session handshake.');
      serial += 1;
      const message = ChatMessageSchema.parse({
        id: `customer-${String(serial)}`, clientMessageId: input.clientMessageId,
        sender: 'CUSTOMER', body: input.body, createdAt: timestamp,
      });
      state.messages.push(message);
      await route.fulfill({ json: { conversation: state.conversation, message } });
      return;
    }
    if (path === '/api/v1/chat/read' && request.method() === 'POST') {
      ChatReadRequestSchema.parse(request.postDataJSON());
      if (state.conversation) state.conversation = { ...state.conversation, unreadCount: 0 };
      await route.fulfill({ json: { conversation: state.conversation } });
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method())) state.unexpectedWrites.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 404, json: { error: { message: 'Outside the isolated chat sound test.' } } });
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//u, (route) => route.abort());
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  return state;
}

async function visitAndOpen(page: Page): Promise<Locator> {
  await page.goto('/');
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/u);
  const consent = page.getByRole('region', { name: 'Cookie preferences', exact: true });
  await expect(consent).toBeVisible();
  await consent.getByRole('button', { name: 'Reject all', exact: true }).click();
  await page.getByRole('button', { name: 'Open live chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat with Speedy Van', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Your message', exact: true })).toBeEnabled();
  return dialog;
}

async function plays(page: Page): Promise<number> {
  return page.evaluate(() => window.chatSoundProbe.plays);
}

test.use({ reducedMotion: 'reduce' });

test('@foundation a new chat sounds for its first reply and later closed replies exactly once', async ({ page }) => {
  const state = await isolateChatAndAudio(page);
  const dialog = await visitAndOpen(page);
  // Load real media metadata without playing it through the device speakers.
  const decoded = await page.evaluate(async () => {
    const response = await fetch('/sounds/chat-message.wav');
    if (!response.ok) throw new Error('The bundled chat sound is not available.');
    const bytes = new DataView(await response.arrayBuffer());
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.muted = true;
      audio.preload = 'metadata';
      const timer = window.setTimeout(() => { reject(new Error('The bundled chat sound metadata did not load.')); }, 10_000);
      audio.addEventListener('loadedmetadata', () => {
        window.clearTimeout(timer);
        resolve(audio.duration);
      }, { once: true });
      audio.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('The bundled chat sound could not be decoded.'));
      }, { once: true });
      audio.src = '/sounds/chat-message.wav';
    });
    return { duration, sampleRate: bytes.getUint32(24, true), channels: bytes.getUint16(22, true) };
  });
  expect(decoded.duration).toBeCloseTo(2.3471, 3);
  expect(decoded.sampleRate).toBe(44_100);
  expect(decoded.channels).toBe(2);
  const composer = dialog.getByRole('textbox', { name: 'Your message', exact: true });
  await composer.fill('Can you help with my move?');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('Can you help with my move?', { exact: true })).toBeVisible();
  await expect.poll(() => state.forwardReads).toBeGreaterThan(0);
  expect(await plays(page)).toBe(0);
  state.reply('Yes, please send us your postcodes.');
  await expect(dialog.getByText('Yes, please send us your postcodes.', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect.poll(() => plays(page)).toBe(1);
  state.replyBeforeNextSend = 'We can help with carrying too.';
  await composer.fill('Thank you, I will send them now.');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('We can help with carrying too.', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect.poll(() => plays(page)).toBe(2);
  await dialog.getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(dialog).toBeHidden();
  state.reply('Your reply will still be here when you reopen chat.');
  await expect.poll(() => plays(page), { timeout: 22_000 }).toBe(3);
  await page.getByRole('button', { name: 'Open live chat', exact: true }).click();
  await expect(dialog.getByText('Your reply will still be here when you reopen chat.', { exact: true })).toBeVisible();
  const readCount = state.forwardReads;
  await expect.poll(() => state.forwardReads, { timeout: 12_000 }).toBeGreaterThan(readCount);
  expect(await plays(page)).toBe(3);
  expect(await page.evaluate(() => window.chatSoundProbe.sources)).toEqual([
    '/sounds/chat-message.wav', '/sounds/chat-message.wav', '/sounds/chat-message.wav',
  ]);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation existing and earlier history remain silent and muting prevents later cues', async ({ page }) => {
  const state = await isolateChatAndAudio(page);
  for (let index = 1; index <= 51; index += 1) state.reply(`Existing message ${String(index)}.`);
  const dialog = await visitAndOpen(page);
  await expect(dialog.getByText('Existing message 51.', { exact: true })).toBeVisible();
  expect(await plays(page)).toBe(0);
  await dialog.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(dialog.getByText('Existing message 1.', { exact: true })).toBeVisible();
  expect(await plays(page)).toBe(0);
  state.reply('A new reply after the existing history.');
  await expect.poll(() => plays(page), { timeout: 12_000 }).toBe(1);
  await dialog.getByRole('button', { name: 'Mute chat sound', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Chat sound is muted.' })).toBeVisible();
  state.reply('This new reply must remain silent while muted.');
  await expect(dialog.getByText('This new reply must remain silent while muted.', { exact: true })).toBeVisible({ timeout: 12_000 });
  const readCount = state.forwardReads;
  await expect.poll(() => state.forwardReads, { timeout: 12_000 }).toBeGreaterThan(readCount);
  expect(await plays(page)).toBe(1);
  expect(state.unexpectedWrites).toEqual([]);
});

test('@foundation browser playback denial has an explicit sound recovery action', async ({ page }) => {
  const state = await isolateChatAndAudio(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  const dialog = await visitAndOpen(page);
  await page.evaluate(() => { window.chatSoundProbe.blocked = true; });
  const enable = dialog.getByRole('button', { name: 'Enable chat sound and play a preview', exact: true });
  await enable.click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Sound could not play.' })).toBeVisible();
  expect(await plays(page)).toBe(1);
  await page.evaluate(() => { window.chatSoundProbe.blocked = false; });
  await enable.click();
  await expect(dialog.getByRole('button', { name: 'Mute chat sound', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await plays(page)).toBe(2);
  expect(errors).toEqual([]);
  expect(state.unexpectedWrites).toEqual([]);
});
