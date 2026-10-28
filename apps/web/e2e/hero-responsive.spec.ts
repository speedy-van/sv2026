import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Address } from '../src/components/booking-flow/booking-store';

type AddressCase = 'pickup' | 'dropoff';
type Bounds = { left: number; right: number; top: number; bottom: number };

const addressCases = {
  pickup: {
    suggestionTitle: 'Pickup test address',
    address: {
      label: 'Flat 42, The Exceptionally Long Residential Building Name at the Riverside Development, 123 Example Avenue, Merchant City, Glasgow, G1 1AA',
      line1: '123 Example Avenue',
      line2: 'The Exceptionally Long Residential Building Name at the Riverside Development',
      flat: 'Flat 42',
      town: 'Glasgow',
      postcode: 'G1 1AA',
      lat: 55.8642,
      lng: -4.2518,
      source: 'MAPBOX',
      mapboxId: 'pickup',
    },
  },
  dropoff: {
    suggestionTitle: 'Dropoff test address',
    address: {
      label: 'Apartment 108, The Extremely Long Named Apartment Building in the Central Quarter Development, 456 Example Crescent, Edinburgh, EH1 1AA',
      line1: '456 Example Crescent',
      line2: 'The Extremely Long Named Apartment Building in the Central Quarter Development',
      flat: 'Apartment 108',
      town: 'Edinburgh',
      postcode: 'EH1 1AA',
      lat: 55.9533,
      lng: -3.1883,
      source: 'MAPBOX',
      mapboxId: 'dropoff',
    },
  },
} satisfies Record<AddressCase, { suggestionTitle: string; address: Address }>;

test.use({ reducedMotion: 'reduce' });

function addressCase(value: unknown): AddressCase {
  if (value === 'pickup' || value === 'dropoff') return value;
  throw new Error('Address mock received an unexpected fixture identifier.');
}

async function mockAddressSearch(page: Page): Promise<void> {
  await page.route('**/api/v1/address/suggest', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!body || typeof body !== 'object' || !('q' in body)) {
      throw new Error('Address suggestion request must contain a query.');
    }
    const key = addressCase(body.q);
    const fixture = addressCases[key];
    await route.fulfill({
      json: {
        suggestions: [{
          id: key,
          kind: 'address',
          primary: fixture.suggestionTitle,
          secondary: `${fixture.address.town}, ${fixture.address.postcode}`,
        }],
      },
    });
  });
  await page.route('**/api/v1/address/retrieve', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!body || typeof body !== 'object' || !('id' in body)) {
      throw new Error('Address retrieval request must identify a suggestion.');
    }
    await route.fulfill({ json: { address: addressCases[addressCase(body.id)].address } });
  });
}

async function visitHome(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 932 });
  await mockAddressSearch(page);
  await page.goto('/');
  // This existing client-effect attribute distinguishes the hydrated header from SSR markup.
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }
  return page.locator('.home-hero [data-booking-card]');
}

async function selectAddress(card: Locator, label: 'From' | 'To', key: AddressCase): Promise<void> {
  const field = card.getByRole('combobox', { name: label, exact: true });
  await field.fill(key);
  await card.getByRole('option', { name: new RegExp(`^${addressCases[key].suggestionTitle}`) }).click();
  await expect(card.locator('.address-selected').filter({ hasText: addressCases[key].address.label })).toBeVisible();
  await expect(field).toBeHidden();
}

async function bounds(locator: Locator, description: string): Promise<Bounds> {
  await expect(locator, description).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${description} must have a rendered bounding box.`);
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
}

function expectWithin(actual: Bounds, outer: Bounds, description: string): void {
  // Allow subpixel rounding, while checking actual control bounds rather than clipped scrollWidth.
  expect(actual.left, `${description} left edge`).toBeGreaterThanOrEqual(outer.left - 1);
  expect(actual.right, `${description} right edge`).toBeLessThanOrEqual(outer.right + 1);
  expect(actual.right - actual.left, `${description} width`).toBeGreaterThan(0);
}

async function expectHeroLayout(page: Page, card: Locator, selectedCount: number): Promise<void> {
  await expect(card).toHaveCount(1);
  const radios = card.getByRole('radio');
  const selectedRows = card.locator('.address-selected');
  const changeButtons = card.getByRole('button', { name: 'Change', exact: true });
  const addressInputs = card.getByRole('combobox');
  const priceButton = card.getByRole('button', { name: 'See my prices', exact: true });
  await expect(radios).toHaveCount(3);
  await expect(selectedRows).toHaveCount(selectedCount);
  await expect(changeButtons).toHaveCount(selectedCount);
  await expect(addressInputs).toHaveCount(2 - selectedCount);
  await expect(priceButton).toBeEnabled();

  const containerBounds = await bounds(page.locator('.home-hero .container').first(), 'Hero container');
  const cardBounds = await bounds(card, 'Booking card');
  expectWithin(cardBounds, containerBounds, 'Booking card');
  const controls = [
    { locator: card.locator('.chip-row'), description: 'Service chip row' },
    { locator: card.locator('.field-grid'), description: 'Address field grid' },
    { locator: priceButton, description: 'Price button' },
  ];
  for (let index = 0; index < 3; index += 1) {
    controls.push({ locator: radios.nth(index), description: `Service chip ${String(index + 1)}` });
  }
  for (let index = 0; index < selectedCount; index += 1) {
    controls.push({ locator: selectedRows.nth(index), description: `Selected address ${String(index + 1)}` });
    controls.push({ locator: changeButtons.nth(index), description: `Change button ${String(index + 1)}` });
    await expect(changeButtons.nth(index)).toBeEnabled();
  }
  for (let index = 0; index < 2 - selectedCount; index += 1) {
    controls.push({ locator: addressInputs.nth(index), description: `Address input ${String(index + 1)}` });
  }
  for (const control of controls) {
    const controlBounds = await bounds(control.locator, control.description);
    expectWithin(controlBounds, containerBounds, control.description);
    expectWithin(controlBounds, cardBounds, `${control.description} inside card`);
  }
}

test('@foundation hero at 430px stays bounded as addresses are selected and changed', async ({ page }) => {
  const card = await visitHome(page, 430);
  await expectHeroLayout(page, card, 0);

  await selectAddress(card, 'From', 'pickup');
  await expectHeroLayout(page, card, 1);
  await selectAddress(card, 'To', 'dropoff');
  await expectHeroLayout(page, card, 2);

  for (const name of ['Home move', 'Man and van', 'Furniture']) {
    const chip = card.getByRole('radio', { name, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await expectHeroLayout(page, card, 2);
  }

  await card.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(card.getByRole('combobox', { name: 'From', exact: true })).toBeVisible();
  await expectHeroLayout(page, card, 1);
  await selectAddress(card, 'From', 'pickup');
  await expectHeroLayout(page, card, 2);

  await card.getByRole('button', { name: 'Change', exact: true }).last().click();
  await expect(card.getByRole('combobox', { name: 'To', exact: true })).toBeVisible();
  await expectHeroLayout(page, card, 1);
  await selectAddress(card, 'To', 'dropoff');
  await expectHeroLayout(page, card, 2);
});

for (const width of [320, 360, 390, 768, 1440]) {
  test(`@foundation hero controls with long selected addresses stay bounded at ${String(width)}px`, async ({ page }) => {
    const card = await visitHome(page, width);
    await selectAddress(card, 'From', 'pickup');
    await selectAddress(card, 'To', 'dropoff');
    await expectHeroLayout(page, card, 2);

    const selectedRows = card.locator('.address-selected');
    const pickupBounds = await bounds(selectedRows.nth(0), 'Selected pickup');
    const dropoffBounds = await bounds(selectedRows.nth(1), 'Selected dropoff');
    if (width >= 480) {
      expect(Math.abs(pickupBounds.top - dropoffBounds.top), 'Desktop addresses share one row').toBeLessThanOrEqual(1);
      expect(dropoffBounds.left, 'Desktop address columns remain separate').toBeGreaterThan(pickupBounds.right);
    } else {
      expect(dropoffBounds.top, 'Mobile addresses stack vertically').toBeGreaterThan(pickupBounds.bottom);
    }
  });
}
