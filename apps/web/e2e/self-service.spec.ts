import { expect, test, type Page } from '@playwright/test';
import { expectA11yClean } from './support/a11y';

interface SelfServiceFixture {
  cancel: {
    fullUrl: string;
    lateUrl: string;
    noneUrl: string;
  };
  find: {
    email: string;
    reference: string;
  };
  futureTrackingUrl: string;
  invalidatedManageUrl: string;
  manageUrl: string;
  pay: {
    activeExtraUrl: string;
    expiredUrl: string;
    paidUrl: string;
  };
  reschedule: {
    cheaperDate: string;
    cheaperSlot: string;
    cheaperUrl: string;
    dearerDate: string;
    dearerSlot: string;
    dearerUrl: string;
  };
  reviewUrl: string;
  trackingUrl: string;
}

async function fixture(page: Page): Promise<SelfServiceFixture> {
  let lastFailure = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await page.request.get('/api/test/self-service');
    if (response.ok()) return await response.json() as SelfServiceFixture;
    lastFailure = `Self-service fixture failed ${String(response.status())}: ${await response.text()}`;
    if (response.status() < 500) break;
    await page.waitForTimeout(attempt * 500);
  }
  throw new Error(lastFailure);
}

test('@self-service find my booking is neutral and manage links open the dashboard', async ({ page }) => {
  const data = await fixture(page);
  await page.goto('/manage');
  await expect(page.getByRole('heading', { name: 'Manage your booking' })).toBeVisible();
  await expectA11yClean(page);
  await page.getByLabel('Email').fill('wrong@example.com');
  await page.getByLabel('Booking reference').fill('SV-WRONG1');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText("If those details match a booking, we've emailed you a link.")).toBeVisible();

  await page.getByLabel('Email').fill(data.find.email);
  await page.getByLabel('Booking reference').fill(data.find.reference.replace('-', ''));
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText("If those details match a booking, we've emailed you a link.")).toBeVisible();

  await page.goto(data.manageUrl);
  await expect(page.getByRole('heading', { name: data.find.reference })).toBeVisible();
  await page.locator('textarea').first().fill('Please call from the street.');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByText('Notes saved')).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service changing contact email invalidates old manage links', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.invalidatedManageUrl);
  await expect(page).toHaveURL(/\/manage\?expired=1/);
  await expect(page.getByText('That link has expired. Enter your details to get a new one.')).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service reschedule cheaper refund applies the move', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.reschedule.cheaperUrl);
  await page.getByLabel('New date').fill(data.reschedule.cheaperDate);
  await page.getByLabel('New window').selectOption(data.reschedule.cheaperSlot);
  await page.getByRole('button', { name: 'Change date' }).click();
  await expect(page.getByText(/We'll refund/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByText('Your move is now updated.')).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service reschedule dearer payment applies the move', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.reschedule.dearerUrl);
  await page.getByLabel('New date').fill(data.reschedule.dearerDate);
  await page.getByLabel('New window').selectOption(data.reschedule.dearerSlot);
  await page.getByRole('button', { name: 'Change date' }).click();
  await expect(page.getByText(/You'll pay/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByText('Payment received. Your move is now updated.')).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service cancellation policy bands show exact refund states', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.cancel.fullUrl);
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText(/Refund: £/).last()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel my booking' }).click();
  await expect(page.getByText('Booking cancelled')).toBeVisible();
  await expectA11yClean(page);

  await page.goto(data.cancel.lateUrl);
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText(/Late cancellation refund: 50%/)).toBeVisible();
  await expectA11yClean(page);

  await page.goto(data.cancel.noneUrl);
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText(/Refund: £0\.00/).last()).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service tracking shows location only while en route', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.futureTrackingUrl);
  await expect(page.getByText('Location is hidden until the driver is en route.')).toBeVisible();
  await expectA11yClean(page);

  await page.goto(data.trackingUrl);
  await expect(page.getByRole('heading', { name: /is on the way/ })).toBeVisible();
  await expect(page.getByText('Latest van location')).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service review submits once and then shows already reviewed', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.reviewUrl);
  await page.getByLabel('5 stars - excellent').check();
  await page.getByLabel('Comment').fill('Careful, on time and friendly.');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Thank you for your review.').first()).toBeVisible();
  await expectA11yClean(page);
  await page.reload();
  await expect(page.getByText("You've already reviewed this move. Thank you.").first()).toBeVisible();
  await expectA11yClean(page);
});

test('@self-service pay links cover expired, already paid and active extra charge states', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(data.pay.expiredUrl);
  await expect(page.getByRole('heading', { name: 'This payment link has expired.' })).toBeVisible();
  await expectA11yClean(page);

  await page.goto(data.pay.paidUrl);
  await expect(page.getByRole('heading', { name: 'Payment received - thank you' })).toBeVisible();
  await expectA11yClean(page);

  await page.goto(data.pay.activeExtraUrl);
  await page.getByLabel(/I agree to the terms/).check();
  await page.getByRole('button', { name: /^Pay £/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment received - thank you' })).toBeVisible();
  await expectA11yClean(page);
});
