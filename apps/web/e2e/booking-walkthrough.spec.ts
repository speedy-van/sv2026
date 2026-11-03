import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { CatalogueResponseSchema, QuoteRequestSchema } from '@sv/contracts';
import type { z } from 'zod';
import type { Address, BookingDraftState, QuoteDto } from '../src/components/booking-flow/booking-store';

type PersistedDraft = Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>;
const pickup: Address = {
  label: '1 Test Street, Glasgow, G1 1AA', line1: '1 Test Street', town: 'Glasgow',
  postcode: 'G1 1AA', lat: 55.8642, lng: -4.2518, source: 'MANUAL',
};
const dropoff: Address = {
  label: '2 Test Street, Edinburgh, EH1 1AA', line1: '2 Test Street', town: 'Edinburgh',
  postcode: 'EH1 1AA', lat: 55.9533, lng: -3.1883, source: 'MANUAL',
};

function draftFixture(): PersistedDraft {
  const access = { carryMetres: 10, floorChoice: 'GROUND' as const, hasLift: false, narrowAccess: false, permitZone: false };
  return {
    addons: { assembly: false, helpers: 0, packing: false }, contact: { email: '', name: '', phone: '' },
    customerNotes: '', dropoff, dropoffAccess: access, idempotencyKey: null, items: [], marketingOptIn: false,
    pickup, pickupAccess: access, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null,
    service: 'man-and-van', shortNoticeAck: false, statusToken: null, termsAccepted: false, variant: 'standard',
  };
}

function quoteFixture(input: z.infer<typeof QuoteRequestSchema>): QuoteDto {
  const summary = (address: Address): QuoteDto['pickup'] => ({
    label: address.label, line1: address.line1, town: address.town, postcode: address.postcode, lat: address.lat, lng: address.lng,
  });
  return {
    publicId: `q_walkthrough_${String(input.addons.helpers)}`, expiresAt: '2099-01-01T00:00:00.000Z',
    service: input.service, variant: input.variant, distanceMiles: 45, durationMinutes: 65,
    pickup: summary(input.pickup), dropoff: input.dropoff ? summary(input.dropoff) : null,
    breakdownLines: [{ key: 'base', label: 'Test move price', pence: 15_000 }], staticSubtotalPence: 15_000,
    calendar: ['2031-04-07', '2031-04-08', '2031-04-09'].map((date, index) => ({
      date, weekday: index + 1,
      slots: [
        { slot: 'MORNING', windowLabel: '8am–12pm', pricePence: 15_000, available: true, lastOne: false },
        { slot: 'AFTERNOON', windowLabel: '12pm–4pm', pricePence: 16_000, available: true, lastOne: false },
        { slot: 'EVENING', windowLabel: '4pm–8pm', pricePence: 17_000, available: true, lastOne: false },
      ],
    })),
    cheapest: { date: '2031-04-07', slot: 'MORNING', pricePence: 15_000 },
    staticMapPath: '/api/v1/maps/static?quote=q_walkthrough',
  };
}

function catalogueFixture(): z.infer<typeof CatalogueResponseSchema> {
  const rows = readFileSync(new URL('../../../docs/data/items-catalogue.csv', import.meta.url), 'utf8').trim().split(/\r?\n/).slice(1);
  // The repository's seed CSV includes quoted names with commas.
  const items = rows.map((line) => {
    const [slug, name, category, volume, , aliases] = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((field) => field.replace(/^"|"$/g, '').replaceAll('""', '"'));
    return { slug, name, category, unitVolumeM3: Number(volume), aliases: aliases ? aliases.split('|') : [] };
  });
  return CatalogueResponseSchema.parse({ items, presets: [], categories: [...new Set(items.map((item) => item.category))], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } });
}

async function isolatePage(page: Page): Promise<{ quotes: Array<z.infer<typeof QuoteRequestSchema>>; unexpectedWrites: string[] }> {
  const quotes: Array<z.infer<typeof QuoteRequestSchema>> = [];
  const responses = new Map<string, QuoteDto>();
  const unexpectedWrites: string[] = [];
  const catalogue = catalogueFixture();
  // Every API request is intercepted before it can reach a database or payment provider.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/quotes' && request.method() === 'POST') {
      const input = QuoteRequestSchema.parse(request.postDataJSON());
      quotes.push(input);
      const quote = quoteFixture(input);
      responses.set(quote.publicId, quote);
      await route.fulfill({ json: { quote } });
    } else if (pathname.startsWith('/api/v1/quotes/') && request.method() === 'GET') {
      const quote = responses.get(pathname.slice('/api/v1/quotes/'.length));
      if (!quote) throw new Error('Missing isolated walkthrough quote.');
      await route.fulfill({ json: { quote, expired: false } });
    } else if (pathname === '/api/v1/catalogue' && request.method() === 'GET') {
      await route.fulfill({ json: catalogue });
    } else {
      if (!['GET', 'HEAD'].includes(request.method())) unexpectedWrites.push(`${request.method()} ${pathname}`);
      await route.fulfill({ status: 404, json: { error: { message: 'Request outside the isolated walkthrough.' } } });
    }
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  await page.addInitScript((state) => {
    sessionStorage.setItem('sv-booking-draft-v1', JSON.stringify({ state, version: 1 }));
  }, draftFixture());
  return { quotes, unexpectedWrites };
}

async function inspectStep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: testInfo.outputPath(`${name}-viewport.png`) });
  await page.screenshot({ path: testInfo.outputPath(`${name}-full.png`), fullPage: true });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach(`${name}-accessibility`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  expect.soft(result.violations, `${name}: accessibility violations`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.use({ reducedMotion: 'reduce' });

for (const width of [390, 1440]) {
  test(`@booking complete isolated visual and accessibility walkthrough at ${String(width)}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const api = await isolatePage(page);
    await page.goto('/book');
    await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
    const reject = page.getByRole('button', { name: 'Reject all', exact: true });
    if (await reject.isVisible()) await reject.click();
    await expect(page.getByRole('heading', { name: 'Your move', exact: true })).toBeVisible();
    await inspectStep(page, testInfo, '1-move');
    await page.getByRole('button', { name: 'Continue to access', exact: true }).click();

    const collection = page.locator('.access-card-pickup');
    await collection.getByRole('button', { name: /Upstairs/ }).click();
    await collection.getByLabel('Floor number', { exact: true }).fill('2');
    await collection.getByLabel('Is there a lift you can use?', { exact: true }).check();
    await collection.getByRole('button', { name: 'Anything tricky?', exact: true }).click();
    await collection.getByLabel('Narrow stairs, tight corners or small lift', { exact: true }).check();
    await expect(collection.getByRole('button', { name: /Upstairs/ })).toHaveAttribute('aria-pressed', 'true');
    await inspectStep(page, testInfo, '2-access');
    await page.getByRole('button', { name: 'Continue to items', exact: true }).click();

    const search = page.getByRole('searchbox', { name: 'Search all items', exact: true });
    await search.fill('fridge');
    await page.getByRole('region', { name: 'Search results', exact: true }).getByRole('button', { name: 'Increase Fridge Freezer', exact: true }).click();
    await expect(page.locator('.booking-summary-count')).toContainText('1 item selected');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByLabel("Can't find something? Add it as your own item.", { exact: true }).fill('Test storage chest');
    await page.getByRole('button', { name: 'Add own item', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Test storage chest', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Test storage chest', exact: true })).toHaveCount(0);
    await page.getByLabel("Can't find something? Add it as your own item.", { exact: true }).fill('Test storage chest');
    await page.getByRole('button', { name: 'Add own item', exact: true }).click();
    await page.getByRole('button', { name: 'Increase extra helpers', exact: true }).click();
    await expect(page.locator('.booking-summary-count')).toContainText('2 items selected');
    await inspectStep(page, testInfo, '3-items');
    await page.getByRole('button', { name: 'See my prices', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: /^Tue 8 Apr/ }).click();
    await page.getByRole('button', { name: /^12pm–4pm/ }).click();
    await expect(page.locator('.booking-next-bar')).toContainText('£160.00');
    await expect(page.locator('.booking-next-bar')).toContainText('Tue 8 Apr');
    expect(api.quotes).toContainEqual(expect.objectContaining({
      pickupAccess: expect.objectContaining({ floorChoice: 'FLOOR', floorNumber: 2, hasLift: true, narrowAccess: true }),
      addons: expect.objectContaining({ helpers: 1 }),
      items: expect.arrayContaining([
        { kind: 'catalogue', itemSlug: 'fridge-freezer', quantity: 1 },
        { kind: 'custom', name: 'Test storage chest', size: 'M', quantity: 1 },
      ]),
    }));
    await inspectStep(page, testInfo, '4-prices');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Details and pay', exact: true })).toBeVisible();
    await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'terms', exact: true })).toHaveAttribute('href', '/legal/terms');
    // Provider is deliberately absent. Exercise form validation without bypassing it or creating a booking.
    await page.locator('form').filter({ has: page.getByLabel('Full name', { exact: true }) }).evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error('Missing checkout form.');
      form.requestSubmit();
    });
    for (const label of ['Full name', 'Email', 'Mobile']) {
      await expect(page.getByRole('textbox', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-invalid', 'true');
    }
    await expect(page.getByRole('alert').filter({ hasText: 'Tick the first two boxes' })).toBeVisible();
    await inspectStep(page, testInfo, '5-pay-validation');
    expect(api.unexpectedWrites).toEqual([]);
  });
}
