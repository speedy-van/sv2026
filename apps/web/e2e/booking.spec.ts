import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function checkA11y(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Speedy Van|Book|Confirmation|Resume/);
  await page.evaluate(() => { window.scrollTo(0, 0); });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function selectAddress(page: Page, label: string, query: string, match: RegExp): Promise<void> {
  const field = page.getByLabel(label);
  await field.fill(query);
  const option = page.getByRole('option', { name: match }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(field).toBeHidden();
}

async function addCustomItem(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('Item name').fill(name);
  await page.getByRole('button', { name: 'Add own item' }).click();
  await expect(page.getByText(/items selected/)).toBeVisible();
}

async function waitForPrices(page: Page): Promise<void> {
  await expect(page.locator('.hero-price')).toContainText('From', { timeout: 20_000 });
}

async function chooseBookingSlot(page: Page, testInfo: TestInfo): Promise<void> {
  const availableDays = page.locator('.day-card:not(.disabled)');
  const dayCount = await availableDays.count();
  const projectSlot = testInfo.project.name.includes('mobile') ? 1 : 0;
  await availableDays.nth(Math.min(projectSlot, Math.max(dayCount - 1, 0))).click();
  const availableSlots = page.locator('.slot-card:not(.disabled)');
  await expect(availableSlots.first()).toBeVisible();
  await availableSlots.first().click();
}

function quotePublicIdFromDraft(raw: string | null): string | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('state' in parsed)) return null;
  const state = parsed.state;
  if (!state || typeof state !== 'object' || !('quotePublicId' in state)) return null;
  return typeof state.quotePublicId === 'string' ? state.quotePublicId : null;
}

async function completeMoveDetails(page: Page, service: string, from = 'Glasgow', to = 'Edinburgh'): Promise<void> {
  await page.getByLabel('Move type').selectOption({ label: service });
  await selectAddress(page, 'From', from, from === 'Glasgow' ? /1 George Square/ : /10 Downing Street/);
  await selectAddress(page, 'To', to, to === 'Edinburgh' ? /1 Princes Street/ : to === 'Rothesay' ? /1 Ferry Road/ : /10 Downing Street/);
}

async function continueThroughAccess(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue to access' }).click();
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to items' }).click();
}

test('@booking customer can complete a mock-paid booking', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'See my prices' }).first().click();
  await expect(page.getByRole('heading', { name: /^Your move$/ })).toBeVisible();
  await checkA11y(page);

  await completeMoveDetails(page, 'Man and van');
  await page.getByRole('button', { name: 'Continue to access' }).click();
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();
  await checkA11y(page);
  await page.getByRole('button', { name: 'Continue to items' }).click();
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
  await checkA11y(page);

  await addCustomItem(page, 'Three archive boxes');
  await page.getByRole('button', { name: 'See my prices' }).click();
  await expect(page.getByRole('heading', { name: 'Prices' })).toBeVisible();
  await waitForPrices(page);
  await chooseBookingSlot(page, testInfo);
  await checkA11y(page);

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Details and pay' })).toBeVisible();
  await page.getByPlaceholder('Full name').fill('Booking Flow Test');
  await page.getByPlaceholder('Email').fill(`booking-${Date.now().toString()}@example.com`);
  await page.getByPlaceholder('Mobile').fill('+447700900123');
  await page.getByLabel('I agree to the terms and cancellation policy').check();
  await page.getByLabel('I ask Speedy Van to start services within the 14-day cancellation period if needed').check();
  await expect(page.getByText('Test payment mode')).toBeVisible();
  await checkA11y(page);

  await page.getByRole('button', { name: /^Pay £/ }).click();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.reference-box')).toContainText(/^SV-/);
  await checkA11y(page);
  await expect.poll(async () => page.evaluate(() => sessionStorage.getItem('sv-booking-draft-v1'))).toBeNull();
});

test('@booking ferry routes go to manual quote request', async ({ page }) => {
  await page.goto('/book');
  await completeMoveDetails(page, 'Home move', 'Glasgow', 'Rothesay');
  await continueThroughAccess(page);
  await addCustomItem(page, 'Packed kitchen boxes');
  await page.getByRole('button', { name: 'See my prices' }).click();

  await expect(page.getByRole('heading', { name: 'We will price this move individually' })).toBeVisible();
  await page.getByPlaceholder('Full name').fill('Manual Quote Test');
  await page.getByPlaceholder('Email').fill(`manual-${Date.now().toString()}@example.com`);
  await page.getByPlaceholder('Mobile').fill('+447700900456');
  await page.getByRole('button', { name: 'Request manual quote' }).click();
  await expect(page.getByText(/Request sent\. Reference MQ-/)).toBeVisible();
  await checkA11y(page);
});

test('@booking outside-area routes are blocked before quote', async ({ page }) => {
  await page.goto('/book');
  await completeMoveDetails(page, 'Home move', 'London', 'London');
  await expect(page.getByText('We move people to and from Scotland. One address needs to be in Scotland.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to access' })).toBeDisabled();
  await checkA11y(page);
});

test('@booking draft reload and quote resume keep the customer in flow', async ({ page }) => {
  await page.goto('/book');
  await completeMoveDetails(page, 'A few items');
  await page.reload();
  await expect(page.getByText('1 George Square, Glasgow G2 1DU')).toBeVisible();
  await continueThroughAccess(page);
  await addCustomItem(page, 'Small armchair');
  await page.getByRole('button', { name: 'See my prices' }).click();
  await waitForPrices(page);
  const publicId = quotePublicIdFromDraft(await page.evaluate(() => sessionStorage.getItem('sv-booking-draft-v1')));
  expect(publicId).toBeTruthy();
  await page.evaluate(() => { sessionStorage.clear(); });
  await page.goto(`/quote/${encodeURIComponent(publicId ?? '')}`);
  await page.getByRole('link', { name: 'Continue quote' }).click();
  await expect(page.getByRole('heading', { name: 'Prices' })).toBeVisible();
  await expect(page.locator('.hero-price')).toContainText('From', { timeout: 20_000 });
  await checkA11y(page);
});
