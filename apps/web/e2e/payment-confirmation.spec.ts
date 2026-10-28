import type { BookingStatusResponseSchema } from '@sv/contracts';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { z } from 'zod';
import type { Address, BookingDraftState, QuoteDto } from '../src/components/booking-flow/booking-store';
import { bookingConfirmationCopy as copy } from '../src/content/booking-confirmation';
import { paymentCopy } from '../src/content/payments';

type StatusResponse = z.infer<typeof BookingStatusResponseSchema>;
type PersistedDraft = Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>;
type ApiIsolation = {
  mutations: string[];
  unexpectedReads: string[];
  statusTokens: string[];
  statusReads: () => number;
};

const statusToken = 'status_confirmation_fixture';
const intentId = 'pi_confirmation_fixture';
const reference = 'SV-CONFIRM-TEST';
const quotePublicId = 'q_confirmation_fixture';
const idempotencyKey = '00000000-0000-4000-8000-000000000001';
const moveDate = '2031-04-07';
const draftKey = 'sv-booking-draft-v1';
const purchaseKey = `sv_purchase_tracked_${reference}`;
const address: Address = {
  label: '1 Test Street, Glasgow, G1 1AA',
  line1: '1 Test Street',
  town: 'Glasgow',
  postcode: 'G1 1AA',
  lat: 55.8642,
  lng: -4.2518,
  source: 'MANUAL',
};

function quoteFixture(): QuoteDto {
  const summary = {
    label: address.label,
    line1: address.line1,
    town: address.town,
    postcode: address.postcode,
    lat: address.lat,
    lng: address.lng,
  };
  return {
    publicId: quotePublicId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    service: 'man-and-van',
    variant: 'standard',
    distanceMiles: 5,
    durationMinutes: 20,
    pickup: summary,
    dropoff: summary,
    breakdownLines: [{ key: 'base', label: 'Base price', pence: 10_000 }],
    staticSubtotalPence: 10_000,
    calendar: [
      {
        date: moveDate,
        weekday: 1,
        slots: [
          { slot: 'MORNING', windowLabel: '8am-12pm', pricePence: 10_000, available: true, lastOne: false },
        ],
      },
    ],
    cheapest: { date: moveDate, slot: 'MORNING', pricePence: 10_000 },
    staticMapPath: `/api/v1/maps/static?quote=${quotePublicId}`,
  };
}

function draftFixture(): PersistedDraft {
  const access = {
    carryMetres: 10,
    floorChoice: 'GROUND' as const,
    hasLift: false,
    narrowAccess: false,
    permitZone: false,
  };
  return {
    addons: { assembly: false, helpers: 0, packing: false },
    contact: { name: 'Confirmation Test', email: 'confirmation@example.test', phone: '+447700900111' },
    customerNotes: 'Test-owned draft must survive an unpaid checkout.',
    dropoff: address,
    dropoffAccess: access,
    idempotencyKey,
    items: [{ kind: 'custom', name: 'Test crate', quantity: 2, size: 'M' }],
    marketingOptIn: false,
    paymentIntentId: intentId,
    pickup: address,
    pickupAccess: access,
    quote: quoteFixture(),
    quotePublicId,
    selectedDate: moveDate,
    selectedSlot: 'MORNING',
    service: 'man-and-van',
    shortNoticeAck: true,
    statusToken,
    termsAccepted: true,
    variant: 'standard',
  };
}

function statusFixture({
  bookingStatus = 'PENDING_PAYMENT',
  paymentStatus = 'REQUIRES_PAYMENT',
  canRetry = true,
  includeCheckout = true,
  holdExpiresAt,
}: {
  bookingStatus?: StatusResponse['status'];
  paymentStatus?: NonNullable<StatusResponse['checkout']>['paymentStatus'];
  canRetry?: boolean;
  includeCheckout?: boolean;
  holdExpiresAt?: string | null;
} = {}): StatusResponse {
  return {
    status: bookingStatus,
    reference,
    summary: {
      date: moveDate,
      dateLabel: 'Monday 7 April',
      slot: 'MORNING',
      slotLabel: '8am-12pm',
      routeLabel: 'Glasgow to Glasgow',
      service: 'man-and-van',
      totalPence: 10_000,
    },
    ...(bookingStatus === 'CONFIRMED'
      ? { manageUrl: 'https://example.test/manage/session?token=confirmation-fixture' }
      : {}),
    ...(includeCheckout
      ? {
          checkout: {
            paymentStatus,
            holdExpiresAt:
              holdExpiresAt === undefined
                ? bookingStatus === 'EXPIRED'
                  ? '2020-01-01T00:00:00.000Z'
                  : '2099-01-01T00:00:00.000Z'
                : holdExpiresAt,
            canRetry,
          },
        }
      : {}),
  };
}

async function preparePage(
  page: Page,
  respond: (route: Route, read: number) => Promise<void>,
  {
    draft = draftFixture(),
    blockExpectedQuoteCreation = false,
    storageFailure,
  }: {
    draft?: PersistedDraft | null;
    blockExpectedQuoteCreation?: boolean;
    storageFailure?: 'corrupt-json' | 'unavailable';
  } = {},
): Promise<ApiIsolation> {
  const mutations: string[] = [];
  const unexpectedReads: string[] = [];
  const statusTokens: string[] = [];
  let reads = 0;
  // Every API request is intercepted: no booking, payment or database fixture is used.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      if (!(blockExpectedQuoteCreation && request.method() === 'POST' && url.pathname === '/api/v1/quotes')) {
        mutations.push(`${request.method()} ${url.pathname}`);
      }
      await route.fulfill({
        status: 409,
        json: { error: { message: 'Mutation blocked by confirmation regression test.' } },
      });
      return;
    }
    if (url.pathname === '/api/v1/bookings/status') {
      const token = url.searchParams.get('token') ?? '';
      statusTokens.push(token);
      if (token !== statusToken) {
        unexpectedReads.push('GET booking status with an unrelated token');
        await route.fulfill({ status: 404, json: { error: { message: 'Unknown test status token.' } } });
        return;
      }
      reads += 1;
      await respond(route, reads);
    } else if (url.pathname === `/api/v1/quotes/${quotePublicId}`) {
      await route.fulfill({ json: { quote: quoteFixture(), expired: false } });
    } else if (url.pathname === '/api/v1/catalogue') {
      await route.fulfill({
        json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } },
      });
    } else if (url.pathname === '/api/v1/maps/static') {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      });
    } else {
      unexpectedReads.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({
        status: 404,
        json: { error: { message: 'API read is not part of this test.' } },
      });
    }
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//u, (route) => route.abort());
  await page.addInitScript({
    content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });',
  });
  await page.addInitScript(
    ({ state, savedDraftKey, savedPurchaseKey, storageFailure }) => {
      const seeded = 'sv_e2e_confirmation_seeded';
      if (sessionStorage.getItem(seeded)) return;
      sessionStorage.setItem(seeded, '1');
      sessionStorage.removeItem(savedPurchaseKey);
      if (state) sessionStorage.setItem(savedDraftKey, JSON.stringify({ state, version: 1 }));
      else sessionStorage.removeItem(savedDraftKey);
      if (storageFailure === 'corrupt-json') {
        sessionStorage.setItem(savedDraftKey, '{invalid test-owned draft JSON');
      } else if (storageFailure === 'unavailable') {
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get() {
            throw new DOMException('Session storage is unavailable in this test.', 'SecurityError');
          },
        });
      }
    },
    { state: draft, savedDraftKey: draftKey, savedPurchaseKey: purchaseKey, storageFailure },
  );
  return { mutations, unexpectedReads, statusTokens, statusReads: () => reads };
}

async function visitConfirmation(page: Page, query = `t=${statusToken}`): Promise<void> {
  await page.goto(`/book/confirmation${query ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/u);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
}

async function savedDraft(page: Page): Promise<unknown> {
  return page.evaluate((key): unknown => {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }, draftKey);
}

async function seedDraft(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, draft }) => {
      sessionStorage.setItem(key, JSON.stringify({ state: draft, version: 1 }));
    },
    { key: draftKey, draft: draftFixture() },
  );
}

async function expectUnpaidDraft(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: "You're booked", exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: paymentCopy.testBookingTitle, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: copy.received.title, exact: true })).toHaveCount(0);
  expect(await savedDraft(page)).toMatchObject({
    state: {
      idempotencyKey,
      paymentIntentId: intentId,
      statusToken,
      quotePublicId,
      items: draftFixture().items,
      contact: draftFixture().contact,
    },
  });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), purchaseKey)).toBeNull();
}

async function expectConfirmedView(page: Page): Promise<void> {
  await expect(page.locator('.reference-box')).toBeVisible();
  const testNotice = page.getByRole('note').filter({ hasText: paymentCopy.testModeTitle });
  const testMode = await testNotice.isVisible();
  await expect(page.getByRole('heading', { name: testMode ? paymentCopy.testBookingTitle : "You're booked", exact: true })).toBeVisible();
  if (testMode) await expect(testNotice).toContainText(paymentCopy.testModeMessage);
}

function expectIsolated(api: ApiIsolation): void {
  expect(api.mutations, 'No payment, booking or test fixture mutation may reach an API').toEqual([]);
  expect(api.unexpectedReads, 'Every API read must use an explicit local fixture').toEqual([]);
  expect(api.statusTokens.every((token) => token === statusToken)).toBe(true);
}

test('@booking confirmation stays neutral while the first server status is delayed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const gate = {
    release: (): void => {
      throw new Error('Status gate not initialised.');
    },
  };
  const released = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const api = await preparePage(page, async (route) => {
    await released;
    await route.fulfill({ json: statusFixture() });
  });
  try {
    const response = await page.goto(`/book/confirmation?t=${statusToken}`, {
      waitUntil: 'domcontentloaded',
    });
    const html = (await response?.text()) ?? '';
    const main = html.match(/<main\b[^>]*\bid="main-content"[^>]*>([\s\S]*?)<\/main>/iu)?.[1] ?? '';
    const headings = await page.evaluate((markup) => {
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      parsed.querySelectorAll('script').forEach((script) => {
        script.remove();
      });
      return [...parsed.querySelectorAll('h1')].map((heading) => heading.textContent.trim());
    }, html);
    expect(headings).toContain(copy.checking.title);
    expect(headings).not.toContain(copy.received.title);
    expect(main).not.toContain(copy.received.title);
    await expect.poll(api.statusReads).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: copy.checking.title, exact: true })).toBeVisible();
    await expectUnpaidDraft(page);
  } finally {
    gate.release();
  }
  await expect(page.getByRole('button', { name: copy.checkAgain, exact: true })).toBeEnabled();
  expectIsolated(api);
});

for (const scenario of [
  { redirect: 'failed', paymentStatus: 'FAILED', title: copy.failed.title, width: 360 },
  { redirect: 'canceled', paymentStatus: 'REQUIRES_PAYMENT', title: copy.canceled.title, width: 1440 },
] as const) {
  test(`@booking ${scenario.redirect} payment resumes the same checkout after a fresh server check`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 932 });
    const api = await preparePage(page, async (route) => {
      await route.fulfill({ json: statusFixture({ paymentStatus: scenario.paymentStatus }) });
    });
    await visitConfirmation(page, `t=${statusToken}&redirect_status=${scenario.redirect}`);
    await expect(page.getByRole('heading', { name: scenario.title, exact: true })).toBeVisible();
    await expectUnpaidDraft(page);
    const retry = page.getByRole('button', { name: copy.retryPayment, exact: true });
    await expect(retry).toBeEnabled();
    const reads = api.statusReads();
    await retry.click();
    await expect(page).toHaveURL(/\/book\?step=pay$/u);
    await expect(page.getByRole('heading', { name: 'Details and pay', exact: true })).toBeVisible();
    expect(api.statusReads()).toBeGreaterThan(reads);
    expect(await savedDraft(page)).toMatchObject({
      state: {
        idempotencyKey,
        paymentIntentId: intentId,
        statusToken,
        quotePublicId,
        selectedDate: moveDate,
        selectedSlot: 'MORNING',
        contact: draftFixture().contact,
      },
    });
    expectIsolated(api);
  });
}

test('@booking a forged successful return cannot prove an unknown pending payment', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 932 });
  const api = await preparePage(page, async (route) => {
    await route.fulfill({ json: statusFixture({ includeCheckout: false }) });
  });
  await visitConfirmation(page, `t=${statusToken}&redirect_status=succeeded`);
  await expect.poll(api.statusReads).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: copy.checking.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
  await expectUnpaidDraft(page);
  expectIsolated(api);
});

test('@booking server processing, receipt and closed-booking states never offer another payment', async ({
  page,
}) => {
  const current = { data: statusFixture({ paymentStatus: 'PROCESSING', canRetry: false }) };
  const api = await preparePage(page, async (route) => {
    await route.fulfill({ json: current.data });
  });
  for (const state of [
    {
      bookingStatus: 'PENDING_PAYMENT',
      paymentStatus: 'PROCESSING',
      title: copy.processing.title,
      width: 360,
    },
    { bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'SUCCEEDED', title: copy.received.title, width: 1440 },
    { bookingStatus: 'CANCELLED', paymentStatus: 'CANCELED', title: copy.unavailable.title, width: 360 },
  ] as const) {
    current.data = statusFixture({
      bookingStatus: state.bookingStatus,
      paymentStatus: state.paymentStatus,
      canRetry: false,
    });
    await page.setViewportSize({ width: state.width, height: 932 });
    await visitConfirmation(page, `t=${statusToken}&redirect_status=failed`);
    await expect(page.getByRole('heading', { name: state.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.seePrices, exact: true })).toHaveCount(0);
    expect(await savedDraft(page)).toMatchObject({ state: { idempotencyKey, statusToken } });
    expect(await page.evaluate((key) => sessionStorage.getItem(key), purchaseKey)).toBeNull();
  }
  expectIsolated(api);
});

test('@booking ended checkouts refresh prices without losing the move inventory or contact', async ({
  page,
}) => {
  const current = {
    data: statusFixture({ bookingStatus: 'EXPIRED', paymentStatus: 'CANCELED', canRetry: false }),
  };
  const api = await preparePage(
    page,
    async (route) => {
      await route.fulfill({ json: current.data });
    },
    { blockExpectedQuoteCreation: true },
  );
  for (const bookingStatus of ['EXPIRED', 'PENDING_PAYMENT'] as const) {
    current.data = statusFixture({ bookingStatus, paymentStatus: 'CANCELED', canRetry: false });
    await page.setViewportSize({ width: bookingStatus === 'EXPIRED' ? 360 : 1440, height: 932 });
    if (bookingStatus === 'PENDING_PAYMENT') await seedDraft(page);
    await visitConfirmation(page);
    await expectUnpaidDraft(page);
    await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
    const reads = api.statusReads();
    await page.getByRole('button', { name: copy.seePrices, exact: true }).click();
    await expect(page).toHaveURL(/\/book\?step=prices$/u);
    await expect(page.getByRole('heading', { name: 'Prices', exact: true })).toBeVisible();
    expect(api.statusReads()).toBeGreaterThan(reads);
    expect(await savedDraft(page)).toMatchObject({
      state: {
        idempotencyKey: null,
        paymentIntentId: null,
        statusToken: null,
        quote: null,
        quotePublicId: null,
        selectedDate: null,
        selectedSlot: null,
        pickup: address,
        dropoff: address,
        items: draftFixture().items,
        contact: draftFixture().contact,
        addons: draftFixture().addons,
        customerNotes: draftFixture().customerNotes,
        service: 'man-and-van',
        variant: 'standard',
      },
    });
  }
  expectIsolated(api);
});

test('@booking an elapsed hold alone cannot replace a still-pending checkout', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 932 });
  const api = await preparePage(page, async (route) => {
    await route.fulfill({
      json: statusFixture({
        paymentStatus: 'REQUIRES_PAYMENT',
        canRetry: false,
        holdExpiresAt: '2020-01-01T00:00:00.000Z',
      }),
    });
  });
  await visitConfirmation(page, `t=${statusToken}&redirect_status=failed`);
  await expect(page.getByRole('heading', { name: copy.expired.title, exact: true })).toBeVisible();
  await expect(page.locator('.confirmation-card').getByRole('status')).toHaveText(copy.awaitingClosure);
  await expect(page.getByRole('button', { name: copy.seePrices, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
  await expectUnpaidDraft(page);
  const reads = api.statusReads();
  await page.getByRole('button', { name: copy.checkAgain, exact: true }).click();
  await expect.poll(api.statusReads).toBeGreaterThan(reads);
  await expect(page.getByRole('heading', { name: copy.expired.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.seePrices, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/book\/confirmation\?/u);
  await expectUnpaidDraft(page);
  expectIsolated(api);
});

test('@booking a failed status read has a working explicit retry without claiming receipt', async ({
  page,
}) => {
  let failed = true;
  const api = await preparePage(page, async (route) => {
    await route.fulfill(
      failed
        ? { status: 503, json: { error: { message: 'Status temporarily unavailable in test.' } } }
        : { json: statusFixture({ paymentStatus: 'PROCESSING', canRetry: false }) },
    );
  });
  await visitConfirmation(page);
  await expect(page.getByRole('heading', { name: copy.error.title, exact: true })).toBeVisible();
  await expectUnpaidDraft(page);
  await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
  const reads = api.statusReads();
  failed = false;
  await page.getByRole('button', { name: copy.checkAgain, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy.processing.title, exact: true })).toBeVisible();
  expect(api.statusReads()).toBeGreaterThan(reads);
  expectIsolated(api);
});

test('@booking pending status polling stops after thirty seconds and an explicit check restarts it', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2031-04-01T12:00:00.000Z') });
  const api = await preparePage(page, async (route) => {
    await route.fulfill({ json: statusFixture({ includeCheckout: false }) });
  });
  await visitConfirmation(page);
  await expect.poll(api.statusReads).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: copy.checking.title, exact: true })).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading', { name: copy.pending.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.checkAgain, exact: true })).toBeEnabled();
  const stoppedReads = api.statusReads();
  await page.clock.fastForward(10_000);
  expect(api.statusReads()).toBe(stoppedReads);
  await expectUnpaidDraft(page);
  await page.getByRole('button', { name: copy.checkAgain, exact: true }).click();
  await expect.poll(api.statusReads).toBeGreaterThan(stoppedReads);
  await expect(page.getByRole('heading', { name: copy.checking.title, exact: true })).toBeVisible();
  const restartedReads = api.statusReads();
  await page.clock.fastForward(1_600);
  await expect.poll(api.statusReads).toBeGreaterThan(restartedReads);
  expectIsolated(api);
});

test('@booking a missing confirmation link never reads a booking or claims payment', async ({ page }) => {
  const api = await preparePage(
    page,
    async (route) => {
      await route.fulfill({ json: statusFixture() });
    },
    { draft: null },
  );
  await visitConfirmation(page, '');
  await expect(page.getByRole('heading', { name: copy.missing.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: copy.received.title, exact: true })).toHaveCount(0);
  expect(api.statusReads()).toBe(0);
  expectIsolated(api);
});

test('@booking confirmed server status survives session fallback clearing and overrides a failed redirect', async ({
  page,
}) => {
  const api = await preparePage(page, async (route) => {
    await route.fulfill({
      json: statusFixture({ bookingStatus: 'CONFIRMED', paymentStatus: 'SUCCEEDED', canRetry: false }),
    });
  });
  for (const query of [
    `payment_intent=${intentId}&payment_intent_client_secret=${intentId}_secret_test&redirect_status=succeeded`,
    `t=${statusToken}&redirect_status=failed`,
  ]) {
    if (api.statusReads() > 0) await seedDraft(page);
    await visitConfirmation(page, query);
    await expectConfirmedView(page);
    await expect(page.locator('.reference-box')).toContainText(reference);
    await expect.poll(() => savedDraft(page)).toBeNull();
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), purchaseKey)).toBe('1');
    expect(new URL(page.url()).searchParams.has('payment_intent_client_secret')).toBe(false);
    const durableUrl = page.url();
    expect(new URL(durableUrl).searchParams.get('t')).toBe(statusToken);
    // A search-param update forces another render after clearing the stored token.
    await page.evaluate(() => {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}?confirmation_view=after-clear`,
      );
    });
    await expectConfirmedView(page);
    await expect(page.getByRole('heading', { name: copy.missing.title, exact: true })).toHaveCount(0);
    // Reload the URL produced by confirmation itself without reseeding the cleared draft.
    await page.evaluate((url) => {
      window.history.replaceState(window.history.state, '', url);
    }, durableUrl);
    const readsBeforeReload = api.statusReads();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectConfirmedView(page);
    await expect(page.locator('.reference-box')).toContainText(reference);
    await expect.poll(api.statusReads).toBeGreaterThan(readsBeforeReload);
    expect(await savedDraft(page)).toBeNull();
    expect(new URL(page.url()).searchParams.get('t')).toBe(statusToken);
  }
  expectIsolated(api);
});

for (const storageFailure of ['corrupt-json', 'unavailable'] as const) {
  test(`@booking a valid confirmation token works with ${storageFailure} session storage`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: storageFailure === 'corrupt-json' ? 360 : 1440, height: 932 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    const api = await preparePage(
      page,
      async (route) => {
        await route.fulfill({
          json: statusFixture({ bookingStatus: 'CONFIRMED', paymentStatus: 'SUCCEEDED', canRetry: false }),
        });
      },
      { storageFailure },
    );
    await visitConfirmation(page);
    await expectConfirmedView(page);
    await expect(page.locator('.reference-box')).toContainText(reference);
    await expect(page.locator('.confirmation-card').getByRole('alert')).toHaveText(
      storageFailure === 'unavailable' ? copy.clearFailed : copy.storageUnavailable,
    );
    await expect(page.getByRole('heading', { name: copy.checking.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: copy.missing.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
    await expect.poll(api.statusReads).toBeGreaterThan(0);
    expect(new URL(page.url()).searchParams.get('t')).toBe(statusToken);
    expect(pageErrors, 'Storage failures must not become unhandled page errors').toEqual([]);
    expectIsolated(api);
  });
}

test('@booking retry rechecks the server and stops if the payment became processing', async ({ page }) => {
  let processing = false;
  const api = await preparePage(page, async (route) => {
    await route.fulfill({
      json: statusFixture({ paymentStatus: processing ? 'PROCESSING' : 'FAILED', canRetry: !processing }),
    });
  });
  await visitConfirmation(page, `t=${statusToken}&redirect_status=failed`);
  await expect(page.getByRole('heading', { name: copy.failed.title, exact: true })).toBeVisible();
  processing = true;
  const reads = api.statusReads();
  await page.getByRole('button', { name: copy.retryPayment, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy.processing.title, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/book\/confirmation\?/u);
  await expect(page.getByRole('button', { name: copy.retryPayment, exact: true })).toHaveCount(0);
  expect(api.statusReads()).toBeGreaterThan(reads);
  expect(await savedDraft(page)).toMatchObject({
    state: { idempotencyKey, paymentIntentId: intentId, statusToken },
  });
  expectIsolated(api);
});

test('@booking an unrelated returned payment intent cannot borrow the saved checkout token', async ({
  page,
}) => {
  const api = await preparePage(page, async (route) => {
    await route.fulfill({ json: statusFixture() });
  });
  await visitConfirmation(
    page,
    'payment_intent=pi_unrelated_fixture&payment_intent_client_secret=pi_unrelated_fixture_secret_test&redirect_status=succeeded',
  );
  await expect(page.getByRole('heading', { name: copy.missing.title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: copy.returnSavedCheckout, exact: true })).toHaveAttribute(
    'href',
    '/book?step=pay',
  );
  expect(api.statusReads()).toBe(0);
  expect(new URL(page.url()).searchParams.has('payment_intent_client_secret')).toBe(false);
  await expectUnpaidDraft(page);
  expectIsolated(api);
});
