import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Address, BookingDraftState } from '../src/components/booking-flow/booking-store';

const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const whatsappMessage = "Hi Speedy Van! I'd like some help with my move. Could you help me with availability and a quote?";
type PersistedDraft = Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>;

async function isolateApi(page: Page): Promise<string[]> {
  const mutations: string[] = [];
  // These contact checks must never create quotes, bookings, visitor records or payments.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutations.push(`${request.method()} ${pathname}`);
      await route.fulfill({ status: 409, json: { error: { message: 'Unexpected mutation in contact test.' } } });
    } else if (pathname === '/api/v1/catalogue') {
      await route.fulfill({ json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } } });
    } else {
      await route.fulfill({ status: 404, json: { error: { message: 'API read is not part of this contact test.' } } });
    }
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  return mutations;
}

async function visit(page: Page, path: string): Promise<void> {
  const consentSaved = (await page.context().cookies()).some((cookie) => cookie.name === 'sv_consent');
  await page.goto(path);
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  // A subsequent SSR visit briefly renders the banner before its saved choice hydrates.
  if (consentSaved) await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
}

async function rejectCookies(page: Page): Promise<void> {
  const banner = page.getByRole('region', { name: 'Cookie preferences', exact: true });
  if (await banner.isVisible()) {
    await banner.getByRole('button', { name: 'Reject all', exact: true }).click();
    await expect(banner).toBeHidden();
  }
}

async function expectNoOverlap(panel: Locator, action: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  await expect(action).toBeVisible();
  // boundingBox includes the panel's collision-avoidance translation.
  await expect.poll(async () => {
    const [floating, target] = await Promise.all([panel.boundingBox(), action.boundingBox()]);
    if (!floating || !target) return false;
    return floating.x + floating.width <= target.x
      || target.x + target.width <= floating.x
      || floating.y + floating.height <= target.y
      || target.y + target.height <= floating.y;
  }).toBe(true);
}

function draftFixture(): PersistedDraft {
  const address: Address = {
    label: '1 Test Street, Glasgow, G1 1AA', line1: '1 Test Street', town: 'Glasgow',
    postcode: 'G1 1AA', lat: 55.8642, lng: -4.2518, source: 'MANUAL',
  };
  const access = { carryMetres: 10, floorChoice: 'GROUND' as const, hasLift: false, narrowAccess: false, permitZone: false };
  return {
    addons: { assembly: false, helpers: 0, packing: false }, contact: { email: '', name: '', phone: '' },
    customerNotes: '', dropoff: address, dropoffAccess: access, idempotencyKey: null,
    items: [{ kind: 'custom', name: 'Test box', quantity: 1, size: 'M' }], marketingOptIn: false,
    pickup: address, pickupAccess: access, quote: null, quotePublicId: null, selectedDate: null,
    selectedSlot: null, service: 'man-and-van', shortNoticeAck: false, statusToken: null,
    termsAccepted: false, variant: 'standard',
  };
}

test.use({ reducedMotion: 'reduce' });

test('@foundation floating contact links have the owner number, helpful message and accessible controls', async ({ page }) => {
  const mutations = await isolateApi(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await visit(page, '/');
    await rejectCookies(page);
    const contact = page.getByRole('complementary', { name: 'Contact Speedy Van', exact: true });
    const whatsapp = contact.getByRole('link', { name: 'WhatsApp Speedy Van (opens in a new tab)', exact: true });
    const call = contact.getByRole('link', { name: 'Call Speedy Van on 07465 227962', exact: true });
    await expect(whatsapp).toBeVisible();
    await expect(call).toHaveAttribute('href', 'tel:+447465227962');
    const href = await whatsapp.getAttribute('href');
    if (!href) throw new Error('WhatsApp must provide a real destination.');
    const url = new URL(href);
    expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/447465227962');
    expect(url.searchParams.get('text')?.replaceAll('’', "'")).toBe(whatsappMessage);
    await expect(whatsapp).toHaveAttribute('target', '_blank');
    await expect(whatsapp).toHaveAttribute('rel', /noopener/);
    await expect(whatsapp).toHaveAttribute('rel', /noreferrer/);
    for (const link of [whatsapp, call]) {
      const box = await link.boundingBox();
      if (!box) throw new Error('Floating contact link has no visible touch target.');
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await whatsapp.focus();
    await expect(whatsapp).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(call).toBeFocused();
    const result = await new AxeBuilder({ page }).include('.floating-contact')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
  }
  expect(mutations).toEqual([]);
});

test('@foundation floating contact yields to cookie preferences and the mobile navigation dialog', async ({ context, page }) => {
  const mutations = await isolateApi(page);
  await context.clearCookies();
  await page.setViewportSize(viewports[0] ?? { width: 390, height: 844 });
  await visit(page, '/');
  const contact = page.locator('.floating-contact');
  await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeVisible();
  await expect(contact).toBeHidden();
  await rejectCookies(page);
  await expect(contact).toBeVisible();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navigation menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(contact).toBeHidden();
  await menu.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(contact).toBeVisible();
  await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeVisible();
  await expect(contact).toBeHidden();
  await rejectCookies(page);
  await expect(contact).toBeVisible();
  expect(mutations).toEqual([]);
});

test('@booking floating contact stays clear of booking actions and the mobile price bar', async ({ page }) => {
  const mutations = await isolateApi(page);
  await page.addInitScript((state) => {
    sessionStorage.setItem('sv-booking-draft-v1', JSON.stringify({ state, version: 1 }));
  }, draftFixture());
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await visit(page, '/book');
    await rejectCookies(page);
    const panel = page.locator('.floating-contact-panel');
    const continueButton = page.getByRole('button', { name: 'Continue to access', exact: true });
    await continueButton.scrollIntoViewIfNeeded();
    await expectNoOverlap(panel, continueButton);
    await continueButton.click();
    await page.getByRole('button', { name: 'Continue to items', exact: true }).click();
    const prices = page.getByRole('button', { name: 'See my prices', exact: true });
    await prices.scrollIntoViewIfNeeded();
    await expectNoOverlap(panel, prices);
    await visit(page, '/');
    await rejectCookies(page);
    const heroPrice = page.locator('[data-booking-card]').first().locator('.button-primary');
    await heroPrice.scrollIntoViewIfNeeded();
    await expectNoOverlap(panel, heroPrice);
    if (viewport.width < 1024) {
      await page.locator('.home-hero').evaluate((element) => {
        window.scrollTo(0, element.getBoundingClientRect().bottom + window.scrollY + 100);
      });
      const sticky = page.locator('.mobile-sticky-cta');
      await expect(sticky).toBeVisible();
      await expectNoOverlap(panel, sticky);
    }
  }
  expect(mutations).toEqual([]);
});
