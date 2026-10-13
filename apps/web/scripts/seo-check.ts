import process from 'node:process';

import { localServerUrl, withNextServer } from './run-with-next-server.js';

interface PageCheck {
  canonical: string;
  description: string;
  h1: string;
  jsonLdCount: number;
  linkCount: number;
  status: number;
  title: string;
  url: string;
}

const origin = 'https://www.speedyvan.uk';

function localise(url: string, baseUrl: string): string {
  return url.replace(origin, baseUrl);
}

function absoluteLink(href: string, baseUrl: string): string | null {
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return null;
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    return localise(`${origin}${url.pathname}${url.search}`, baseUrl);
  } catch {
    return null;
  }
}

function tagContent(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return (match?.[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function metaContent(html: string, name: string): string {
  const nameFirst = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'));
  if (nameFirst?.[1]) return nameFirst[1];
  const contentFirst = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["'][^>]*>`, 'i'));
  return contentFirst?.[1] ?? '';
}

function canonicalHref(html: string, baseUrl: string): string {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["'][^>]*>/i);
  return (match?.[1] ?? '').replace(baseUrl, origin);
}

function jsonLdBlocks(html: string): string[] {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1] ?? '');
}

function anchorHrefs(html: string): string[] {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  return Array.from(withoutScripts.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi), (match) => match[1] ?? '');
}

async function parseSitemap(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/sitemap.xml`);
  if (!response.ok) throw new Error(`Sitemap returned ${String(response.status)}`);
  const xml = await response.text();
  return Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), (match) => localise(match[1] ?? '', baseUrl));
}

async function checkPage(url: string, baseUrl: string): Promise<{ check: PageCheck; links: string[] }> {
  const response = await fetch(url);
  const html = await response.text();
  const scripts = jsonLdBlocks(html);
  for (const script of scripts) {
    JSON.parse(script);
  }
  const links = anchorHrefs(html)
    .map((href) => absoluteLink(href, baseUrl))
    .filter((link): link is string => Boolean(link));
  return {
    check: {
      canonical: canonicalHref(html, baseUrl),
      description: metaContent(html, 'description'),
      h1: tagContent(html, 'h1'),
      jsonLdCount: scripts.length,
      linkCount: links.length,
      status: response.status,
      title: tagContent(html, 'title'),
      url,
    },
    links,
  };
}

function assertPage(check: PageCheck, expectedUrl: string): string[] {
  const errors: string[] = [];
  const expectedCanonical = expectedUrl.replace(/^http:\/\/127\.0\.0\.1:\d+/, origin).replace(/\/$/, '');
  const actualCanonical = check.canonical.replace(/\/$/, '');
  if (check.status !== 200) errors.push(`${check.url} returned ${String(check.status)}`);
  if (!check.title || check.title.length > 70) errors.push(`${check.url} has invalid title`);
  if (!check.description || check.description.length > 170) errors.push(`${check.url} has invalid description`);
  if (!check.h1) errors.push(`${check.url} has no H1`);
  if (!actualCanonical || actualCanonical !== expectedCanonical) {
    errors.push(`${check.url} has invalid canonical ${check.canonical}`);
  }
  if (check.jsonLdCount < 1) errors.push(`${check.url} has no JSON-LD`);
  if (check.linkCount < 5) errors.push(`${check.url} has fewer than five internal links`);
  return errors;
}

const exitCode = await withNextServer(async () => {
  const urls = await parseSitemap(localServerUrl);
  const checks: PageCheck[] = [];
  const errors: string[] = [];
  const brokenLinks = new Map<string, number>();
  for (const url of urls) {
    const { check, links } = await checkPage(url, localServerUrl);
    checks.push(check);
    errors.push(...assertPage(check, url));
    for (const link of links) {
      if (link.includes('/api/') || link.includes('/book?')) continue;
      if (!brokenLinks.has(link)) {
        const head = await fetch(link, { redirect: 'manual' });
        brokenLinks.set(link, head.status);
      }
    }
  }
  for (const [link, status] of brokenLinks) {
    if (status >= 400) errors.push(`Broken internal link ${link} returned ${String(status)}`);
  }
  if (errors.length > 0) {
    throw new Error(`SEO check failed:\n${errors.join('\n')}`);
  }
  process.stdout.write(`SEO check passed for ${String(checks.length)} sitemap URLs and ${String(brokenLinks.size)} internal links.\n`);
  return 0;
});

process.exitCode = exitCode;
