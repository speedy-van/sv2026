import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const desktopViewport = { width: 1440, height: 900 };
const mobileViewport = { width: 390, height: 780 };

async function visitHome(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  // HeaderShell adds this attribute in its client effect, after the SSR header hydrates.
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }
}

async function controlledPanel(page: Page, trigger: Locator): Promise<Locator> {
  const panelId = await trigger.getAttribute('aria-controls');
  if (!panelId) {
    throw new Error('Navigation disclosure must identify its controlled panel.');
  }
  return page.locator(`[id=${JSON.stringify(panelId)}]`);
}

async function expectHeaderA11yClean(page: Page): Promise<void> {
  // Contrast must be measured after the disclosure's opacity entrance has settled.
  for (const panel of await page.locator('.nav-panel:visible').all()) {
    await expect(panel).toHaveCSS('opacity', '1');
  }
  const results = await new AxeBuilder({ page })
    .include('.site-header')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('@foundation header desktop disclosures toggle and keep only one panel open', async ({ page }) => {
  await visitHome(page, desktopViewport);
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const services = navigation.getByRole('button', { name: 'Services', exact: true });
  const areas = navigation.getByRole('button', { name: 'Areas', exact: true });
  const servicePanel = await controlledPanel(page, services);
  const areaPanel = await controlledPanel(page, areas);

  await expect(services).toHaveAttribute('aria-expanded', 'false');
  await expect(servicePanel).toBeHidden();
  await expect(navigation.getByRole('link', { name: 'Manage booking', exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Get a price', exact: true })).toBeVisible();

  await services.click();
  await expect(services).toHaveAttribute('aria-expanded', 'true');
  await expect(servicePanel.getByRole('link').first()).toBeVisible();
  await expectHeaderA11yClean(page);

  await areas.click();
  await expect(areas).toHaveAttribute('aria-expanded', 'true');
  await expect(areaPanel.getByRole('link', { name: /All areas/ })).toBeVisible();
  await expect(services).toHaveAttribute('aria-expanded', 'false');
  await expect(servicePanel).toBeHidden();
  await expectHeaderA11yClean(page);

  await areas.click();
  await expect(areas).toHaveAttribute('aria-expanded', 'false');
  await expect(areaPanel).toBeHidden();
});

test('@foundation header desktop keyboard opening and dismissal preserve focus', async ({ page }) => {
  await visitHome(page, desktopViewport);
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const services = navigation.getByRole('button', { name: 'Services', exact: true });
  const panel = await controlledPanel(page, services);

  await services.focus();
  await services.press('ArrowDown');
  await expect(services).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(services).toHaveAttribute('aria-expanded', 'false');
  await expect(services).toBeFocused();

  await services.press('Enter');
  await expect(panel).toBeVisible();
  await page.locator('#main-content a:visible').first().focus();
  await expect(panel).toBeHidden();
  await expect(services).toHaveAttribute('aria-expanded', 'false');

  await services.click();
  await expect(panel).toBeVisible();
  await page.locator('#main-content').getByRole('heading', { level: 1 }).click();
  await expect(panel).toBeHidden();
  await expect(services).toHaveAttribute('aria-expanded', 'false');
});

test('@foundation header mobile menu contains keyboard focus and restores it on close', async ({ page }) => {
  await visitHome(page, mobileViewport);
  const openMenu = page.getByRole('button', { name: 'Open menu', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Navigation menu', includeHidden: true });

  await openMenu.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(dialog.getByRole('link', { name: 'Manage booking', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Get a price', exact: true })).toBeVisible();
  await expectHeaderA11yClean(page);

  const focusable = dialog.locator('a[href]:visible, button:not([disabled]):visible, [tabindex="0"]:visible');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(dialog).toHaveJSProperty('open', false);
  await expect(openMenu).toBeFocused();

  await openMenu.click();
  await dialog.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(openMenu).toBeFocused();
});

test('@foundation header mobile menu closes after navigation and when resizing to desktop', async ({ page }) => {
  await visitHome(page, mobileViewport);
  const openMenu = page.getByRole('button', { name: 'Open menu', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Navigation menu', includeHidden: true });

  await openMenu.click();
  await dialog.getByRole('link', { name: 'Prices', exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(dialog).toBeHidden();
  await expect(dialog).toHaveJSProperty('open', false);

  await openMenu.click();
  await expect(dialog).toBeVisible();
  await page.setViewportSize(desktopViewport);
  await expect(dialog).toBeHidden();
  await expect(dialog).toHaveJSProperty('open', false);
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  await expectHeaderA11yClean(page);
});
