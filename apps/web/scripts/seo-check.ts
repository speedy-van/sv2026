import process from 'node:process';

import {
  duplicateMetadataErrors,
  internalLinks,
  metadataWarnings,
  parseSeoPage,
  validateIndexablePage,
  type SeoPageCheck,
} from './seo-check-core.js';
import { localServerUrl, withNextServer } from './run-with-next-server.js';

function localUrl(publicUrl: string, baseUrl: string): string {
  const url = new URL(publicUrl);
  return new URL(`${url.pathname}${url.search}`, baseUrl).toString();
}

async function readPage(url: string): Promise<{ html: string; page: SeoPageCheck }> {
  const response = await fetch(url, { headers: { 'user-agent': 'Googlebot' }, redirect: 'manual' });
  const html = await response.text();
  return { html, page: parseSeoPage(html, response.status, url, response.headers.get('x-robots-tag') ?? '') };
}

async function runSeoCheck(baseUrl: string): Promise<number> {
  const response = await fetch(`${baseUrl}/sitemap.xml`);
  if (!response.ok) throw new Error(`Sitemap returned ${String(response.status)}`);
  const xml = await response.text();
  const sitemapUrls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  );
  const firstUrl = sitemapUrls[0];
  if (!firstUrl) throw new Error('Sitemap has no URLs.');
  const origin = new URL(firstUrl).origin;
  const checks: SeoPageCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const links = new Set<string>();
  if (new Set(sitemapUrls).size !== sitemapUrls.length) errors.push('Sitemap contains duplicate URLs.');

  for (const publicUrl of sitemapUrls) {
    if (new URL(publicUrl).origin !== origin) {
      errors.push(`Sitemap mixes canonical origins: ${publicUrl}`);
      continue;
    }
    const { html, page } = await readPage(localUrl(publicUrl, baseUrl));
    checks.push(page);
    errors.push(...validateIndexablePage(page, publicUrl));
    warnings.push(...metadataWarnings(page));
    for (const link of internalLinks(html, publicUrl)) links.add(link);
  }
  errors.push(...duplicateMetadataErrors(checks));

  const sitemapSet = new Set(sitemapUrls);
  for (const link of links) {
    if (sitemapSet.has(link)) continue;
    const url = new URL(link);
    const { page } = await readPage(localUrl(link, baseUrl));
    if (page.status >= 400) errors.push(`Broken internal link ${link} returned ${String(page.status)}`);
    if (
      /^\/(?:book(?:\/|$)|manage(?:\/|$)|guides(?:\/|$)|legal(?:\/|$)|styleguide$|accessibility$)/.test(
        url.pathname,
      ) &&
      !page.noindex
    ) {
      errors.push(`${link} is a non-indexable UI page without noindex`);
    }
  }

  // GET-only probes exercise server-rendered metadata; no browser or API fixtures run.
  for (const path of [
    '/book',
    '/book?step=prices',
    '/book?step=unknown&quote=seo-audit-invalid',
    '/book/confirmation',
    '/quote/seo-audit-invalid',
  ]) {
    const { page } = await readPage(new URL(path, baseUrl).toString());
    if (page.status !== 200 || !page.noindex) errors.push(`${path} must return a noindex booking UI`);
    if (path.startsWith('/book')) {
      const expected = new URL(
        path.startsWith('/book/confirmation') ? '/book/confirmation' : '/book',
        origin,
      ).toString();
      if (page.canonical !== expected) errors.push(`${path} has an invalid booking canonical`);
    }
  }

  for (const path of [
    '/areas/constructor',
    '/legal/constructor',
    '/areas/seo-audit-missing',
    '/man-and-van/linwood',
    '/man-and-van/stornoway',
    '/services/seo-audit-missing',
    '/removals/seo-audit-missing',
  ]) {
    const { page } = await readPage(new URL(path, baseUrl).toString());
    if (page.status !== 404) errors.push(`${path} returned ${String(page.status)} instead of 404`);
  }

  if (errors.length > 0) throw new Error(`SEO check failed:\n${errors.join('\n')}`);
  for (const warning of warnings) process.stdout.write(`SEO warning: ${warning}\n`);
  process.stdout.write(
    `SEO check passed for ${String(checks.length)} indexable sitemap URLs, ${String(links.size)} internal links and booking/404 probes.\n`,
  );
  return 0;
}

const exitCode = process.env.SEO_BASE_URL
  ? await runSeoCheck(process.env.SEO_BASE_URL.replace(/\/$/, ''))
  : await withNextServer(async () => runSeoCheck(localServerUrl));

process.exitCode = exitCode;
