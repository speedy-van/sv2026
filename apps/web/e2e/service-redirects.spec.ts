import { expect, test } from '@playwright/test';

const oldPath = '/services/house-removal';
const canonicalPath = '/services/house-removals';
const trackingQuery = '?gclid=redirect-check&utm_source=google&utm_medium=cpc&utm_campaign=house%20moves';

test('@seo the old Glasgow West End sitelink reaches the Glasgow booking page', async ({ request }) => {
  const oldAreaPath = '/areas/glasgow-west-end';
  for (const method of ['GET', 'HEAD']) {
    const response = await request.fetch(`${oldAreaPath}${trackingQuery}`, { method, maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const location = response.headers()['location'];
    expect(location).toBeDefined();
    const destination = new URL(location ?? '', response.url());
    expect(destination.origin).toBe(new URL(response.url()).origin);
    expect(destination.pathname).toBe('/removals/glasgow');
    expect([...destination.searchParams]).toEqual([...new URLSearchParams(trackingQuery)]);
  }
  const response = await request.get(`${oldAreaPath}${trackingQuery}`);
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe('/removals/glasgow');
  const html = await response.text();
  expect(html).toContain('House and flat removals in Glasgow');
  expect(html).toContain('data-booking-card');
});

test('@seo the advertised house-removal URL redirects permanently and preserves attribution', async ({ request }) => {
  for (const method of ['GET', 'HEAD']) {
    const response = await request.fetch(`${oldPath}${trackingQuery}`, { method, maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const location = response.headers()['location'];
    expect(location).toBeDefined();
    const destination = new URL(location ?? '', response.url());
    expect(destination.origin).toBe(new URL(response.url()).origin);
    expect(destination.pathname).toBe(canonicalPath);
    expect([...destination.searchParams]).toEqual([...new URLSearchParams(trackingQuery)]);
  }
  const canonical = await request.get(canonicalPath, { maxRedirects: 0 });
  expect(canonical.status()).toBe(200);
  const unknown = await request.get('/services/unknown-service-redirect-check', { maxRedirects: 0 });
  expect(unknown.status()).toBe(404);
});

test('@seo the old ad URL opens the house removals page and its booking form', async ({ page }) => {
  const mutations: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort();
  });
  const response = await page.goto(`${oldPath}${trackingQuery}`);
  expect(response?.status()).toBe(200);
  const destination = new URL(page.url());
  expect(destination.pathname).toBe(canonicalPath);
  expect([...destination.searchParams]).toEqual([...new URLSearchParams(trackingQuery)]);
  await expect(page.getByRole('heading', { name: 'House removals in Scotland', exact: true })).toBeVisible();
  await expect(page.locator('[data-booking-card]')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://www.speedyvan.uk${canonicalPath}`);
  expect(mutations).toEqual([]);
});
