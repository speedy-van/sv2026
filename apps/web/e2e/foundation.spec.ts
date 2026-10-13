import { expect, test } from '@playwright/test';
import { expectA11yClean } from './support/a11y';

test('@foundation header, footer and booking hero render', async ({ page }) => {
  await page.goto('/');
  const bookingCard = page.locator('[data-booking-card]').first();

  await expect(page.getByRole('heading', { level: 1, name: 'Removals and man and van across Scotland' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Speedy Van home' })).toBeVisible();
  await expect(bookingCard.getByRole('link', { name: 'See my prices' })).toBeVisible();
  await expect(bookingCard.getByRole('radio', { name: 'Home move' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('contentinfo')).toContainText('Pay by card, Apple Pay or Google Pay.');
  await expectA11yClean(page);
});

test('@foundation consent choices can be saved', async ({ context, page }) => {
  await context.clearCookies();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Cookie preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Reject all' }).click();
  await expect(page.getByRole('region', { name: 'Cookie preferences' })).toBeHidden();
  await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'sv_consent')).toBe(true);
  await expectA11yClean(page);
});

test('@foundation not-found page gives recovery links', async ({ page }) => {
  const response = await page.goto('/missing-foundation-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "We can't find that page." })).toBeVisible();
  await expect(page.locator('#main-content').getByRole('link', { name: 'Services' })).toBeVisible();
  await expect(page.locator('#main-content').getByRole('link', { name: 'Help' })).toBeVisible();
  await expectA11yClean(page);
});
