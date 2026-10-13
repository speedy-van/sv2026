import { expect, test } from '@playwright/test';
import { expectA11yClean } from './support/a11y';

test('@seo robots and sitemap expose the public SEO surface', async ({ page }) => {
  const robots = await page.request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Sitemap: https://www.speedyvan.uk/sitemap.xml');
  expect(robotsText).toContain('Disallow: /api/');

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const sitemapXml = await sitemap.text();
  expect(sitemapXml).toContain('https://www.speedyvan.uk/services/house-removals');
  expect(sitemapXml).toContain('https://www.speedyvan.uk/removals/glasgow-to-edinburgh');
});

test('@seo canonical links and structured data are present on indexed page types', async ({ page }) => {
  for (const path of ['/', '/services/house-removals', '/areas/glasgow-and-clyde', '/removals/glasgow', '/man-and-van/glasgow', '/removals/glasgow-to-edinburgh']) {
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://www.speedyvan.uk${path === '/' ? '' : path}`);
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expectA11yClean(page);
  }
});

test('@seo private and draft page types are noindex', async ({ page }) => {
  for (const path of ['/manage', '/legal/privacy', '/guides', '/accessibility']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectA11yClean(page);
  }
});
