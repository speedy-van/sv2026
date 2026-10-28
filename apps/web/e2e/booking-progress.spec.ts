import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Address, BookingDraftState, QuoteDto } from '../src/components/booking-flow/booking-store';

type PersistedDraft = Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>;
const labels = ['Move', 'Access', 'Items', 'Prices', 'Pay'] as const;
const publicId = 'q_booking_progress';
const moveDate = '2031-04-07';
const pickup: Address = {
  label: '1 Test Street, North Queensferry, KY11 1HP',
  line1: '1 Test Street',
  town: 'North Queensferry',
  postcode: 'KY11 1HP',
  lat: 56.0106,
  lng: -3.3938,
  source: 'MANUAL',
};
const dropoff: Address = {
  ...pickup,
  label: '2 Test Street, South Queensferry, EH30 9SD',
  line1: '2 Test Street',
  town: 'South Queensferry',
  postcode: 'EH30 9SD',
  lat: 55.9908,
  lng: -3.3985,
};

function addressSummary(address: Address): QuoteDto['pickup'] {
  return { label: address.label, line1: address.line1, town: address.town, postcode: address.postcode, lat: address.lat, lng: address.lng };
}

function quoteFixture(): QuoteDto {
  return {
    publicId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    service: 'man-and-van',
    variant: 'standard',
    distanceMiles: 5,
    durationMinutes: 20,
    pickup: addressSummary(pickup),
    dropoff: addressSummary(dropoff),
    breakdownLines: [{ key: 'base', label: 'Base price', pence: 10_000 }],
    staticSubtotalPence: 10_000,
    calendar: [{
      date: moveDate,
      weekday: 1,
      slots: [
        { slot: 'MORNING', windowLabel: '8am-12pm', pricePence: 10_000, available: true, lastOne: false },
        { slot: 'AFTERNOON', windowLabel: '12pm-5pm', pricePence: 11_000, available: true, lastOne: false },
        { slot: 'EVENING', windowLabel: '5pm-9pm', pricePence: 12_000, available: true, lastOne: false },
      ],
    }],
    cheapest: { date: moveDate, slot: 'MORNING', pricePence: 10_000 },
    staticMapPath: `/api/v1/maps/static?quote=${publicId}`,
  };
}

function restoredDraft(): PersistedDraft {
  const access = { carryMetres: 10, floorChoice: 'GROUND' as const, hasLift: false, narrowAccess: false, permitZone: false };
  return {
    addons: { assembly: false, helpers: 0, packing: false },
    contact: { email: '', name: '', phone: '' },
    customerNotes: '',
    dropoff,
    dropoffAccess: access,
    idempotencyKey: null,
    items: [{ kind: 'custom', name: 'Test box', quantity: 1, size: 'M' }],
    marketingOptIn: false,
    pickup,
    pickupAccess: access,
    quote: quoteFixture(),
    quotePublicId: publicId,
    selectedDate: moveDate,
    selectedSlot: 'MORNING',
    service: 'man-and-van',
    shortNoticeAck: false,
    statusToken: null,
    termsAccepted: false,
    variant: 'standard',
  };
}

async function isolatePage(page: Page, draft: PersistedDraft | null): Promise<string[]> {
  const mutations: string[] = [];
  // Every API request is fulfilled locally; navigation must never create a quote, booking or payment.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutations.push(`${request.method()} ${pathname}`);
      await route.fulfill({ status: 409, json: { error: { message: 'Unexpected mutation in progress navigation test.' } } });
    } else if (pathname === `/api/v1/quotes/${publicId}`) {
      await route.fulfill({ json: { quote: quoteFixture(), expired: false } });
    } else if (pathname === '/api/v1/catalogue') {
      await route.fulfill({ json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } } });
    } else {
      await route.fulfill({ status: 404, json: { error: { message: 'API read is not part of this test.' } } });
    }
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  // Stripe initializes at module load, but these tests never mount or submit the payment step.
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  await page.addInitScript((state) => {
    if (state) sessionStorage.setItem('sv-booking-draft-v1', JSON.stringify({ state, version: 1 }));
    else sessionStorage.removeItem('sv-booking-draft-v1');
  }, draft);
  return mutations;
}

async function visitStep(page: Page, step: 'move' | 'prices'): Promise<void> {
  await page.goto(`/book?step=${step}`);
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }
  await expect(page.getByRole('heading', { name: step === 'move' ? 'Your move' : 'Prices', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/book\\?step=${step}$`));
}

async function expectProgress(page: Page, currentIndex: number): Promise<void> {
  const progress = page.locator('ol.booking-progress');
  await expect(progress).toHaveAccessibleName('Booking progress');
  await expect(progress.getByRole('button')).toHaveCount(labels.length);
  await expect(progress.locator('button[aria-current="step"]')).toHaveCount(1);
  await expect(progress.locator('li.is-complete')).toHaveCount(currentIndex);
  for (const [index, label] of labels.entries()) {
    const button = progress.getByRole('button', { name: new RegExp(`\\b${label}$`) });
    if (index === currentIndex) await expect(button).toHaveAttribute('aria-current', 'step');
    else await expect(button).not.toHaveAttribute('aria-current', 'step');
    if (index > currentIndex) await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
    if (index < currentIndex) {
      const check = button.locator('svg.lucide-check');
      await expect(check).toBeVisible();
      await expect(button.locator('.booking-step-marker')).toHaveAttribute('aria-hidden', 'true');
    }
  }
}

async function expectTouchTarget(button: Locator): Promise<void> {
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Progress navigation button has no visible box.');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function expectHeaderFits(page: Page, viewportWidth: number): Promise<void> {
  const header = page.locator('header.booking-wizard-header');
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  if (!headerBox) throw new Error('Booking header has no visible box.');
  expect(headerBox.x).toBeGreaterThanOrEqual(0);
  expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(viewportWidth);
  const sizing = await header.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizing.scroll).toBeLessThanOrEqual(sizing.client + 1);
  await expect(header.locator('.route-chip')).toBeVisible();
  await expectTouchTarget(header.getByRole('button', { name: 'Back', exact: true }));
  for (const label of labels) {
    const button = header.locator('ol.booking-progress').getByRole('button', { name: new RegExp(`\\b${label}$`) });
    await expect(button).toBeVisible();
    await expectTouchTarget(button);
    const box = await button.boundingBox();
    if (!box) throw new Error(`${label} has no visible box.`);
    expect(box.x).toBeGreaterThanOrEqual(headerBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
    // A visible button can still have its label hidden with font-size: 0 or clipped outside it.
    const text = await button.evaluate((element, stepLabel) => {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = nodes.nextNode();
      while (node) {
        const start = node.textContent?.indexOf(stepLabel) ?? -1;
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + stepLabel.length);
          const rect = range.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, height: rect.height };
        }
        node = nodes.nextNode();
      }
      return null;
    }, label);
    expect(text).not.toBeNull();
    if (!text) throw new Error(`${label} has no rendered text.`);
    expect(text.width).toBeGreaterThan(8);
    expect(text.height).toBeGreaterThan(8);
    expect(text.x).toBeGreaterThanOrEqual(box.x);
    expect(text.right).toBeLessThanOrEqual(box.x + box.width);
  }
  const a11y = await new AxeBuilder({ page }).include('header.booking-wizard-header').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations).toEqual([]);
}

test.use({ reducedMotion: 'reduce' });

for (const width of [360, 1440]) {
  test(`@booking progress starts at Move with disabled future steps at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations = await isolatePage(page, null);
    await visitStep(page, 'move');
    await expectProgress(page, 0);
    await expect(page.locator('header.booking-wizard-header').getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await expectHeaderFits(page, width);
    expect(mutations).toEqual([]);
  });

  test(`@booking restored Prices supports previous steps and Back at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations = await isolatePage(page, restoredDraft());
    await visitStep(page, 'prices');
    await expectProgress(page, 3);
    const header = page.locator('header.booking-wizard-header');
    await expect(header.locator('.route-chip')).toContainText('North Queensferry to South Queensferry');
    await expect(header.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
    await expectHeaderFits(page, width);

    await header.locator('ol.booking-progress').getByRole('button', { name: /\bAccess$/ }).click();
    await expect(page).toHaveURL(/\/book\?step=access$/);
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible();
    await expectProgress(page, 1);

    await page.goBack();
    await expect(page).toHaveURL(/\/book\?step=prices$/);
    await expectProgress(page, 3);

    const access = header.locator('ol.booking-progress').getByRole('button', { name: /\bAccess$/ });
    await access.focus();
    await expect(access).toBeFocused();
    await access.press('Enter');
    await expect(page).toHaveURL(/\/book\?step=access$/);
    await expectProgress(page, 1);
    await header.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/\/book\?step=move$/);
    await expectProgress(page, 0);
    await expect(header.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    expect(mutations).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`@booking Items keeps its price action without global start-booking buttons at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations = await isolatePage(page, restoredDraft());
    await visitStep(page, 'prices');
    await page.locator('ol.booking-progress').getByRole('button', { name: /\bItems$/ }).click();
    await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/book\?step=items$/);

    const priceAction = page.getByRole('button', { name: 'See my prices', exact: true });
    await expect(priceAction).toHaveCount(1);
    await priceAction.scrollIntoViewIfNeeded();
    await expect(priceAction).toBeVisible();
    await expect(priceAction).toBeEnabled();
    await expect(page.locator('.booking-summary-bar')).toContainText('1 items selected');
    await expect(page.locator('.site-header').getByRole('link', { name: 'Get a price', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.mobile-sticky-cta')).toHaveCount(0);

    if (width < 1024) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Navigation menu', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Get a price', exact: true, includeHidden: true })).toHaveCount(0);
      await expect(dialog.getByRole('link', { name: 'Manage booking', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Close menu', exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    expect(mutations).toEqual([]);
  });
}

test('@booking mobile marketing price bar resets across client navigation and respects the footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const mutations = await isolatePage(page, restoredDraft());
  await page.goto('/');
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }

  const bookingCard = page.locator('[data-booking-card]').first();
  const bottomBookingCard = page.locator('[data-booking-card]').last();
  const stickyPriceAction = page.locator('.mobile-sticky-cta').getByRole('link', { name: 'Get a price', exact: true });
  const marketingSection = page.getByRole('heading', { name: 'What you get', exact: true });
  await bookingCard.scrollIntoViewIfNeeded();
  await expect(bookingCard).toBeInViewport();
  await expect(stickyPriceAction).toBeHidden();
  await marketingSection.evaluate((element) => { element.scrollIntoView({ block: 'start' }); });
  await expect(bookingCard).not.toBeInViewport();
  await expect(stickyPriceAction).toBeVisible();

  // The root layout survives these Link transitions, so stale observer state would survive too.
  await stickyPriceAction.click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(page.getByRole('heading', { name: 'Your move', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-sticky-cta')).toHaveCount(0);
  await expect(page.locator('.site-header').getByRole('link', { name: 'Get a price', exact: true, includeHidden: true })).toHaveCount(0);

  await page.locator('.site-header').getByRole('link', { name: 'Speedy Van home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Removals and man and van across Scotland', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation menu', exact: true });
  await expect(dialog.getByRole('link', { name: 'Get a price', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close menu', exact: true }).click();

  await marketingSection.evaluate((element) => { element.scrollIntoView({ block: 'start' }); });
  await expect(stickyPriceAction).toBeVisible();
  await bottomBookingCard.evaluate((element) => { element.scrollIntoView({ block: 'end' }); });
  await expect(bottomBookingCard).toBeInViewport();
  await expect(bookingCard).not.toBeInViewport();
  await expect(page.locator('footer')).not.toBeInViewport();
  await expect(stickyPriceAction).toBeHidden();
  await marketingSection.evaluate((element) => { element.scrollIntoView({ block: 'start' }); });
  await expect(stickyPriceAction).toBeVisible();
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(page.locator('footer')).toBeInViewport();
  await expect(stickyPriceAction).toBeHidden();
  await marketingSection.evaluate((element) => { element.scrollIntoView({ block: 'start' }); });
  await expect(stickyPriceAction).toBeVisible();
  await bookingCard.scrollIntoViewIfNeeded();
  await expect(bookingCard).toBeInViewport();
  await expect(stickyPriceAction).toBeHidden();
  expect(mutations).toEqual([]);
});
