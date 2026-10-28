import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

async function isolatePage(page: Page): Promise<string[]> {
  const mutations: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
    await route.fulfill({
      status: 404,
      json: { error: { message: 'API requests are isolated in hero route tests.' } },
    });
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  return mutations;
}

async function openHero(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 932 });
  // Start observing the intro before unrelated lazy images finish loading.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const overlay = page.locator('.home-hero > .hero-route-animation');
  await expect(overlay).toHaveAttribute('data-ready', 'true');
  return overlay;
}

async function dismissCookies(page: Page): Promise<void> {
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await reject.isVisible()) {
    await reject.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }
}

async function expectDecorative(overlay: Locator): Promise<void> {
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay).toHaveCSS('pointer-events', 'none');
  await expect(overlay.locator('svg.hero-route-art')).toHaveAttribute('viewBox', '0 0 1672 941');
  await expect(overlay.locator('svg.hero-route-art')).toHaveAttribute('preserveAspectRatio', 'none');
  await expect(overlay.locator('svg.hero-route-art')).toHaveAttribute('focusable', 'false');
  await expect(
    overlay.locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).toHaveCount(0);
  expect(
    await overlay.evaluate((element) =>
      [...element.querySelectorAll('*')].every((child) => getComputedStyle(child).pointerEvents === 'none'),
    ),
  ).toBe(true);
  const lengths = await overlay
    .locator('.hero-route-line')
    .evaluateAll((elements) =>
      elements.map((element) => (element instanceof SVGPathElement ? element.getTotalLength() : 0)),
    );
  expect(lengths.length).toBeGreaterThan(0);
  for (const length of lengths) expect(length).toBeGreaterThan(0);
}

async function expectAlignment(page: Page, width: number): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const hero = page.locator('.home-hero');
  await expect(hero.locator('.hero-background-image img')).toHaveJSProperty(
    'naturalWidth',
    width >= 1024 ? 1672 : width <= 440 ? 440 : 1280,
  );
  const background = await hero.locator('.hero-background-image img').evaluate((element) => {
    const style = getComputedStyle(element);
    return { fit: style.objectFit, position: style.objectPosition };
  });
  expect(background.fit).toBe('cover');
  expect(background.position).toBe('58% 50%');
  // Compare independent artwork positioning math with the SVG's actual rendered box.
  await expect
    .poll(
      async () =>
        hero.evaluate((element) => {
          const overlay = element.querySelector('.hero-route-animation');
          const art = element.querySelector('.hero-route-art');
          const image = element.querySelector('.hero-background-image img');
          if (!overlay || !art || !(image instanceof HTMLImageElement)) return Number.MAX_SAFE_INTEGER;
          const area = element.getBoundingClientRect();
          const actual = art.getBoundingClientRect();
          const viewport = overlay.getBoundingClientRect();
          const width = element.clientWidth;
          const height = element.clientHeight;
          const desktop = window.matchMedia('(min-width: 1024px)').matches;
          const scale = Math.max(width / 1280, height / 720);
          const artWidth = desktop ? width * 1.12 : 1280 * scale;
          const artHeight = desktop ? (artWidth * 941) / 1672 : 720 * scale;
          const imageBox = image.getBoundingClientRect();
          const left = area.left + element.clientLeft;
          const top = area.top + element.clientTop;
          return Math.max(
            Math.abs(actual.width - artWidth),
            Math.abs(actual.height - artHeight),
            Math.abs(actual.left - (left + (desktop ? 0 : (width - artWidth) * 0.58))),
            Math.abs(actual.top - (top + (height - artHeight) / 2)),
            Math.abs(viewport.left - left),
            Math.abs(viewport.top - top),
            Math.abs(viewport.width - width),
            Math.abs(viewport.height - height),
            Math.abs(imageBox.width - (desktop ? artWidth : width)),
            Math.abs(imageBox.height - (desktop ? artHeight : height)),
          );
        }),
      { message: 'Route artwork must stay aligned after background resizing.' },
    )
    .toBeLessThanOrEqual(2);
  await expect(hero.locator('.hero-route-animation')).toHaveCSS('overflow', 'clip');
  const documentSize = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(documentSize.scroll).toBeLessThanOrEqual(documentSize.client + 1);
}

async function expectForegroundUsable(page: Page): Promise<void> {
  await dismissCookies(page);
  const card = page.locator('.home-hero [data-booking-card]');
  for (const name of ['Furniture', 'Man and van', 'Home move']) {
    const chip = card.getByRole('radio', { name, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
  }
  for (const name of ['From', 'To']) {
    const input = card.getByRole('combobox', { name, exact: true });
    await input.click();
    await expect(input).toBeFocused();
  }
  // Trial verifies the real pointer target without navigating or creating a booking draft.
  await card.getByRole('button', { name: 'See my prices', exact: true }).click({ trial: true });
}

test.use({ reducedMotion: 'no-preference' });

test('@foundation hero route journey is decorative, aligned on desktop and finishes within five seconds', async ({
  page,
}) => {
  const mutations = await isolatePage(page);
  const overlay = await openHero(page, 1440);
  await expect(overlay).toHaveAttribute('data-motion', 'playing');
  const timing = await overlay.evaluate((element) =>
    element.getAnimations({ subtree: true }).map((animation) => {
      const value = animation.effect?.getComputedTiming();
      return {
        finite: value ? Number.isFinite(value.endTime) && Number.isFinite(value.iterations) : false,
        endTime: value?.endTime ?? 0,
      };
    }),
  );
  expect(timing.length).toBeGreaterThan(0);
  for (const animation of timing) {
    expect(animation.finite).toBe(true);
    expect(animation.endTime).toBeGreaterThan(0);
    expect(animation.endTime).toBeLessThanOrEqual(4500);
  }
  await expectDecorative(overlay);
  await expectAlignment(page, 1440);
  await expectForegroundUsable(page);
  await page.locator('.home-hero h1').scrollIntoViewIfNeeded();
  await expect(overlay).toHaveAttribute('data-motion', 'complete');
  expect(await overlay.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  expect(mutations).toEqual([]);
});

test('@foundation responsive hero loads only its matching high-priority artwork', async ({ page }) => {
  const mutations = await isolatePage(page);
  for (const width of [360, 440, 441, 1023, 1024, 1440]) {
    await openHero(page, width);
    const image = page.locator('.hero-background-image img');
    await expect(image).toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('loading', 'eager');
    await expect(image).toHaveAttribute('fetchpriority', 'high');
    await expect
      .poll(() =>
        image.evaluate(
          (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const expectedPath = `/images/speedy-van-highlands-luton-hero${width >= 1024 ? '' : width <= 440 ? '-440' : '-1280'}.avif`;
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.includes('/images/speedy-van-highlands-luton-hero')),
    );
    expect(resources).toEqual([expectedPath]);
    await expect(image).toHaveCSS('pointer-events', 'none');
    await expectAlignment(page, width);
  }
  expect(mutations).toEqual([]);
});

test('@foundation page main keeps the footer beyond the first viewport while content streams', async ({
  page,
}) => {
  const mutations = await isolatePage(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 932 });
    await page.goto('/removals/paisley', { waitUntil: 'domcontentloaded' });
    const main = page.locator('.page-shell > main');
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
    const reserved = await main.evaluate((element) => ({
      minHeight: Number.parseFloat(getComputedStyle(element).minHeight),
      viewportHeight: window.innerHeight,
      headerHeight: document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0,
    }));
    expect(reserved.minHeight).toBeGreaterThanOrEqual(reserved.viewportHeight - reserved.headerHeight);
    const footer = await page.locator('footer.footer').boundingBox();
    expect(footer?.y).toBeGreaterThanOrEqual(reserved.viewportHeight);
  }
  expect(mutations).toEqual([]);
});

test('@foundation marketing content renders directly in main without JavaScript', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('Marketing rendering checks need the configured application URL.');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 932 },
  });
  try {
    const page = await context.newPage();
    const mutations = await isolatePage(page);
    for (const path of [
      '/',
      '/services/house-removals',
      '/removals/paisley',
      '/removals/glasgow-to-edinburgh',
    ]) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      const html = await response?.text();
      const main = html?.match(/<main\b[^>]*\bid="main-content"[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
      expect(main).toMatch(/<h1\b/);
      expect(main).not.toContain('page-loading');
      await expect(page.locator('#main-content').getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('#main-content .page-loading')).toHaveCount(0);
    }
    expect(mutations).toEqual([]);
  } finally {
    await context.close();
  }
});

test('@foundation hero route alignment follows mobile cover and desktop crop across resizes', async ({
  page,
}) => {
  const mutations = await isolatePage(page);
  const overlay = await openHero(page, 360);
  await expectDecorative(overlay);
  for (const width of [360, 430, 768, 1023, 1024, 1440, 1024, 1023, 768, 430, 360]) {
    await page.setViewportSize({ width, height: 932 });
    await expectAlignment(page, width);
  }
  await expectForegroundUsable(page);
  expect(mutations).toEqual([]);
});

test('@foundation CSS sizes hero routes across breakpoints without JavaScript', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('Hero geometry checks need the configured application URL.');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 932 },
  });
  try {
    const page = await context.newPage();
    const mutations = await isolatePage(page);
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    const overlay = page.locator('.home-hero > .hero-route-animation');
    // No controller can initialise or measure the artwork in this context.
    await expect(overlay).toHaveAttribute('data-ready', 'false');
    await expectDecorative(overlay);
    await expect(page.locator('.home-hero h1')).toBeVisible();
    await expect(page.locator('.home-hero [data-booking-card]')).toBeVisible();
    for (const width of [360, 430, 768, 1023, 1024, 1440, 360]) {
      await page.setViewportSize({ width, height: 932 });
      await expectAlignment(page, width);
      await expect(overlay).toHaveAttribute('data-ready', 'false');
    }
    expect(mutations).toEqual([]);
  } finally {
    await context.close();
  }
});

test('@foundation decorative journey waits for the hero image while the booking form stays usable', async ({
  page,
}) => {
  const mutations = await isolatePage(page);
  const imagePattern = /\/images\/speedy-van-highlands-luton-hero(?:-(?:440|1280))?\.(?:avif|webp)(?:\?.*)?$/;

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 360, height: 932 });
    let heldRequests = 0;
    const gate = {
      release: (): void => {
        throw new Error('Hero image gate was not initialised.');
      },
    };
    const released = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const holdImage = async (route: Route): Promise<void> => {
      heldRequests += 1;
      await released;
      await route.continue();
    };
    await page.route(imagePattern, holdImage);
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => heldRequests).toBe(1);
      // Use the existing header effect to establish that hydration is running.
      await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
      const image = page.locator('.home-hero .hero-background-image img');
      const overlay = page.locator('.home-hero > .hero-route-animation');
      await expect(image).toHaveJSProperty('complete', false);
      await expect(page.locator('.home-hero h1')).toBeVisible();
      await expect(page.locator('.home-hero [data-booking-card]')).toBeVisible();
      await expect(overlay).toHaveAttribute('data-ready', 'false');
      await expect(overlay).toHaveAttribute('data-motion', reducedMotion === 'reduce' ? 'static' : 'paused');
      await expectForegroundUsable(page);
      await expect(overlay).toHaveAttribute('data-ready', 'false');
      await expect(image).toHaveJSProperty('complete', false);

      gate.release();
      await expect
        .poll(() =>
          image.evaluate(
            (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await expect(overlay).toHaveAttribute('data-ready', 'true');
      await expect(overlay).toHaveAttribute('data-motion', reducedMotion === 'reduce' ? 'static' : 'playing');
      await expectAlignment(page, 360);
      if (reducedMotion === 'reduce') {
        expect(await overlay.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
      }
    } finally {
      gate.release();
      await page.unroute(imagePattern, holdImage);
    }
  }
  expect(mutations).toEqual([]);
});

test('@foundation reduced motion keeps hero routes static and hides moving glints', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mutations = await isolatePage(page);
  const overlay = await openHero(page, 360);
  await expect(overlay).toHaveAttribute('data-motion', 'static');
  await expectDecorative(overlay);
  await expectAlignment(page, 360);
  const lines = await overlay.locator('.hero-route-line').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, opacity: Number(style.opacity), stroke: style.stroke };
    }),
  );
  for (const line of lines) {
    expect(line.animation).toBe('none');
    expect(line.opacity).toBeGreaterThan(0);
    expect(line.stroke).not.toBe('none');
  }
  for (const comet of await overlay.locator('.hero-route-comet').all()) {
    await expect(comet).toHaveCSS('display', 'none');
    await expect(comet).toHaveCSS('animation-name', 'none');
  }
  expect(await overlay.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expectForegroundUsable(page);
  await expect(overlay).toHaveAttribute('data-motion', 'static');
  expect(mutations).toEqual([]);
});

test('@foundation hero journey pauses offscreen and resumes without restarting', async ({ page }) => {
  const mutations = await isolatePage(page);
  const overlay = await openHero(page, 1440);
  await expect(overlay).toHaveAttribute('data-motion', 'playing');
  const comet = overlay.locator('.hero-route-comet').first();
  await page.locator('footer.footer').scrollIntoViewIfNeeded();
  await expect(overlay).toHaveAttribute('data-motion', 'paused');
  await expect(comet).toHaveCSS('animation-play-state', 'paused');
  const pausedTime = await comet.evaluate((element) => element.getAnimations()[0]?.currentTime ?? null);
  expect(typeof pausedTime).toBe('number');
  await page.locator('.home-hero h1').scrollIntoViewIfNeeded();
  await expect(overlay).toHaveAttribute('data-motion', /^(playing|complete)$/);
  if ((await overlay.getAttribute('data-motion')) === 'playing') {
    await expect(comet).toHaveCSS('animation-play-state', 'running');
    const resumedTime = await comet.evaluate((element) => element.getAnimations()[0]?.currentTime ?? null);
    expect(typeof resumedTime).toBe('number');
    if (typeof pausedTime === 'number' && typeof resumedTime === 'number')
      expect(resumedTime).toBeGreaterThanOrEqual(pausedTime);
  }
  await expect(overlay).toHaveAttribute('data-motion', 'complete');
  expect(mutations).toEqual([]);
});
