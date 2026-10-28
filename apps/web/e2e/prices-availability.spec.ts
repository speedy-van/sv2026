import { expect, test, type Page, type Route } from '@playwright/test';
import type { Address, BookingDraftState, QuoteDto, Slot } from '../src/components/booking-flow/booking-store';

type PersistedDraft = Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>;
type QuoteState = 'open' | 'full' | 'morning-full';

const publicId = 'q_availability_restore';
const firstDate = '2031-04-07';
const address: Address = {
  label: '1 Test Street, Glasgow, G1 1AA',
  line1: '1 Test Street',
  town: 'Glasgow',
  postcode: 'G1 1AA',
  lat: 55.8642,
  lng: -4.2518,
  source: 'MANUAL',
};
const addressSummary = {
  label: address.label,
  line1: address.line1,
  town: address.town,
  postcode: address.postcode,
  lat: address.lat,
  lng: address.lng,
};

function quoteFixture(state: QuoteState): QuoteDto {
  const windows: Array<{ slot: Slot; windowLabel: string; pricePence: number }> = [
    { slot: 'MORNING', windowLabel: '8am-12pm', pricePence: 10_000 },
    { slot: 'AFTERNOON', windowLabel: '12pm-5pm', pricePence: 11_000 },
    { slot: 'EVENING', windowLabel: '5pm-9pm', pricePence: 12_000 },
  ];
  const calendar: QuoteDto['calendar'] = ['2031-04-07', '2031-04-08'].map((date, index) => ({
    date,
    weekday: index + 1,
    slots: windows.map((window) => {
      const available = state !== 'full' && !(state === 'morning-full' && index === 0 && window.slot === 'MORNING');
      return {
        ...window,
        pricePence: window.pricePence + index * 3_000,
        available,
        // Open windows deliberately exercise the owner's request to omit scarcity alerts.
        lastOne: available,
        ...(available ? {} : { reason: 'FULL' as const }),
      };
    }),
  }));
  let cheapest: QuoteDto['cheapest'] = null;
  for (const day of calendar) {
    for (const slot of day.slots) {
      if (slot.available && (!cheapest || slot.pricePence < cheapest.pricePence)) {
        cheapest = { date: day.date, slot: slot.slot, pricePence: slot.pricePence };
      }
    }
  }
  return {
    publicId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    service: 'man-and-van',
    variant: 'standard',
    distanceMiles: 5,
    durationMinutes: 20,
    pickup: addressSummary,
    dropoff: addressSummary,
    breakdownLines: [{ key: 'base', label: 'Base price', pence: 10_000 }],
    staticSubtotalPence: 10_000,
    calendar,
    cheapest,
    staticMapPath: `/api/v1/maps/static?quote=${publicId}`,
  };
}

function draftFixture(quote: QuoteDto, selectedSlot: Slot): PersistedDraft {
  const access = { carryMetres: 10, floorChoice: 'GROUND' as const, hasLift: false, narrowAccess: false, permitZone: false };
  return {
    addons: { assembly: false, helpers: 0, packing: false },
    contact: { email: '', name: '', phone: '' },
    customerNotes: '',
    dropoff: address,
    dropoffAccess: access,
    idempotencyKey: null,
    items: [{ kind: 'custom', name: 'Test box', quantity: 1, size: 'M' }],
    marketingOptIn: false,
    pickup: address,
    pickupAccess: access,
    quote,
    quotePublicId: quote.publicId,
    selectedDate: firstDate,
    selectedSlot,
    service: quote.service,
    shortNoticeAck: false,
    statusToken: null,
    termsAccepted: false,
    variant: quote.variant,
  };
}

async function preparePage(
  page: Page,
  cachedQuote: QuoteDto,
  selectedSlot: Slot,
  respond: (route: Route) => Promise<void>,
): Promise<{ mutations: string[]; quoteReads: () => number }> {
  const mutations: string[] = [];
  let quoteReads = 0;
  // No API request in this suite is allowed to reach the local database or payment provider.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutations.push(`${request.method()} ${pathname}`);
      await route.fulfill({ status: 409, json: { error: { message: 'Unexpected mutation in availability regression test.' } } });
      return;
    }
    if (pathname === `/api/v1/quotes/${publicId}`) {
      quoteReads += 1;
      await respond(route);
      return;
    }
    if (pathname === '/api/v1/catalogue') {
      await route.fulfill({ json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: 'API read is not part of this test.' } } });
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  // The booking module initializes Stripe on every step; price tests must not contact it.
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  await page.addInitScript((draft) => {
    if (!sessionStorage.getItem('sv-booking-draft-v1')) {
      sessionStorage.setItem('sv-booking-draft-v1', JSON.stringify({ state: draft, version: 1 }));
    }
  }, draftFixture(cachedQuote, selectedSlot));
  return { mutations, quoteReads: () => quoteReads };
}

async function visitPrices(page: Page): Promise<void> {
  await page.goto('/book?step=prices');
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences' })).toBeHidden();
  }
  await expect(page.getByRole('heading', { name: 'Prices', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/book\?step=prices$/);
}

async function expectOpenWindows(page: Page): Promise<void> {
  await expect(page.locator('.slot-card')).toHaveCount(3);
  await expect(page.locator('.slot-card:disabled')).toHaveCount(0);
  await expect(page.locator('.price-date-row:disabled')).toHaveCount(0);
  await expect(page.locator('.price-date-list')).not.toContainText('Full');
  await expect(page.locator('.price-date-list')).not.toContainText(/One slot left|Two slots left/);
  await expect(page.locator('.slot-list')).not.toContainText('Last slot');
  await expect(page.locator('.price-date-row-limited, .price-badge-limited')).toHaveCount(0);
  await expect(page.locator('.price-badge-best')).toHaveText('Best Price');
}

test.use({ viewport: { width: 430, height: 932 }, reducedMotion: 'reduce' });

test('@booking restored prices replace stale Full flags through GET before enabling Continue', async ({ page }) => {
  let releaseResponse: () => void = () => undefined;
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const api = await preparePage(page, quoteFixture('full'), 'EVENING', async (route) => {
    await responseReady;
    await route.fulfill({ json: { quote: quoteFixture('open'), expired: false } });
  });
  try {
    await visitPrices(page);
    await expect.poll(api.quoteReads).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(page.locator('.price-date-row')).toHaveCount(0);
  } finally {
    releaseResponse();
  }

  await expectOpenWindows(page);
  await expect(page.getByRole('button', { name: /^5pm-9pm/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.price-date-row[aria-pressed="true"]')).toHaveAttribute('aria-label', /^Mon 7 Apr/);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  const readsBeforeReload = api.quoteReads();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Prices', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/book\?step=prices$/);
  await expect.poll(api.quoteReads).toBeGreaterThan(readsBeforeReload);
  await expect(page.getByRole('button', { name: /^5pm-9pm/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(api.mutations).toEqual([]);
});

test('@booking restored prices replace an unavailable selection with the current cheapest slot', async ({ page }) => {
  const api = await preparePage(page, quoteFixture('open'), 'MORNING', async (route) => {
    await route.fulfill({ json: { quote: quoteFixture('morning-full'), expired: false } });
  });
  await visitPrices(page);
  await expect(page.getByRole('button', { name: /^8am-12pm/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^12pm-5pm/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(page.locator('.slot-list')).not.toContainText('Last slot');
  expect(api.mutations).toEqual([]);
});

test('@booking failed availability restoration stays blocked and retries with GET', async ({ page }) => {
  let fail = true;
  const api = await preparePage(page, quoteFixture('open'), 'EVENING', async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, json: { error: { message: 'Availability check failed.' } } });
    } else {
      await route.fulfill({ json: { quote: quoteFixture('open'), expired: false } });
    }
  });
  await visitPrices(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Availability check failed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.price-date-row')).toHaveCount(0);
  const readsBeforeRetry = api.quoteReads();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expectOpenWindows(page);
  await expect.poll(api.quoteReads).toBeGreaterThan(readsBeforeRetry);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(api.mutations).toEqual([]);
});

test('@booking server-expired restored quote requires explicit refresh without an automatic POST', async ({ page }) => {
  const api = await preparePage(page, quoteFixture('open'), 'EVENING', async (route) => {
    // The server's flag remains authoritative even when the client's cached expiry is in the future.
    await route.fulfill({ json: { quote: quoteFixture('open'), expired: true } });
  });
  await visitPrices(page);
  await expect(page.getByText('Prices have expired.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh prices', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.price-date-row')).toHaveCount(0);
  expect(api.mutations).toEqual([]);
});

test('@booking genuine fully unavailable restored dates remain disabled', async ({ page }) => {
  const api = await preparePage(page, quoteFixture('open'), 'MORNING', async (route) => {
    await route.fulfill({ json: { quote: quoteFixture('full'), expired: false } });
  });
  await visitPrices(page);
  await expect(page.locator('.price-date-row:disabled')).toHaveCount(2);
  await expect(page.locator('.price-date-unavail')).toHaveText(['Full', 'Full']);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  expect(api.mutations).toEqual([]);
});
