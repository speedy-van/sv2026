import { expect, test, type Page } from '@playwright/test';

async function expectOneH1(page: Page, name: RegExp | string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function expectNoMissingFacts(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\b(?:TODO|undefined|null)\b/i);
}

test('@marketing landing page renders required sections without missing facts', async ({ page }) => {
  await page.goto('/');
  await expectOneH1(page, 'Removals and man and van across Scotland');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'What you get' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Services' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'How your price is worked out' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Areas we cover' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Real example prices' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Questions' })).toBeVisible();
  await expect(page.locator('[data-booking-card]')).toHaveCount(2);
  await expectNoMissingFacts(page);
});

test('@marketing service pages include price, FAQ and structured content', async ({ page }) => {
  await page.goto('/services/house-removals');
  await expectOneH1(page, 'Home moves in Scotland');
  await expect(page.getByRole('heading', { name: "What's included" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Price for this service' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible();
  await expect(page.locator('.price-line')).toContainText(/From £|Price shown/);
  await expect(page.locator('#main-content').getByRole('link', { name: 'Man and van' })).toBeVisible();
  await expectNoMissingFacts(page);
});

test('@marketing help search filters FAQs', async ({ page }) => {
  await page.goto('/help');
  await expectOneH1(page, 'Help and FAQs');
  await page.getByPlaceholder('Search questions').fill('payment');
  await expect(page.locator('#main-content').getByText('When do I pay?')).toBeVisible();
  await expectNoMissingFacts(page);
});

test('@marketing contact form submits with user-visible sent state', async ({ page }, testInfo) => {
  await page.goto('/contact');
  await expectOneH1(page, 'Contact');
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    await expectNoMissingFacts(page);
    return;
  }
  await page.getByLabel('Name').fill('Marketing Test');
  await page.getByLabel('Email').fill(`marketing-${Date.now().toString()}@example.com`);
  await page.getByLabel('Message').fill('Please send more information about a move from Glasgow to Edinburgh.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText("Thanks - we'll reply by email.")).toBeVisible();
  await expectNoMissingFacts(page);
});

test('@marketing legal, pricing and reviews pages render stable states', async ({ page }) => {
  await page.goto('/pricing');
  await expectOneH1(page, 'How our prices work');
  await expect(page.getByRole('heading', { name: 'Base prices' })).toBeVisible();
  await expectNoMissingFacts(page);

  await page.goto('/reviews');
  await expectOneH1(page, 'Reviews');
  await expect(page.getByText(/Published reviews will appear|average from/)).toBeVisible();
  await expectNoMissingFacts(page);

  await page.goto('/legal/privacy');
  await expectOneH1(page, 'Privacy policy');
  await expect(page.getByText('Draft for Speedy Van')).toBeVisible();
});
