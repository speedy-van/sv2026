import { describe, expect, it } from 'vitest';
import {
  duplicateMetadataErrors,
  internalLinks,
  metadataWarnings,
  parseSeoPage,
  validateIndexablePage,
} from '../scripts/seo-check-core';

const url = 'https://example.org/areas';
const html = `<!doctype html><html><head>
<title>Areas | Speedy Van</title><meta content="Coverage &amp; prices" name="description">
<link href="${url}" rel="canonical">
<meta property="og:title" content="Areas | Speedy Van"><meta property="og:description" content="Coverage &amp; prices">
<meta property="og:url" content="${url}"><meta name="twitter:title" content="Areas | Speedy Van"><meta name="twitter:card" content="summary">
<meta property="og:image" content="https://example.org/badge.webp"><meta name="twitter:image" content="https://example.org/badge.webp">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Speedy Van","url":"https://example.org"}</script>
</head><body><h1>Areas</h1><img src="badge.webp" alt="">
${['/', '/services', '/pricing', '/contact', '/areas/fife'].map((href) => `<a href="${href}">A link</a>`).join('')}
<script>const serializedMarkup = '<h1>Not a rendered heading</h1>';</script></body></html>`;

describe('SEO crawl assertions', () => {
  it('accepts an indexable page with consistent metadata and ignores script heading text', () => {
    const page = parseSeoPage(html, 200, url);
    expect(page.h1Count).toBe(1);
    expect(page.description).toBe('Coverage & prices');
    expect(validateIndexablePage(page, url)).toEqual([]);
  });

  it('rejects noindex sitemap URLs from either metadata or response headers', () => {
    const metaNoindex = parseSeoPage(
      html.replace('</head>', '<meta content="noindex, follow" name="robots"></head>'),
      200,
      url,
    );
    expect(validateIndexablePage(metaNoindex, url).join(' ')).toContain('sitemap but has noindex');
    expect(parseSeoPage(html, 200, url, 'googlebot: noindex, nofollow').noindex).toBe(true);
  });

  it('rejects multiple real H1s, missing image alt and malformed structured data', () => {
    const broken = html
      .replace('<h1>Areas</h1>', '<h1>Areas</h1><h1>Another heading</h1>')
      .replace(' alt=""', '')
      .replace('"name":"Speedy Van",', '');
    const errors = validateIndexablePage(parseSeoPage(broken, 200, url), url).join(' ');
    expect(errors).toContain('2 H1 elements');
    expect(errors).toContain('images without alt');
    expect(errors).toContain('Organization JSON-LD is missing name');
    expect(parseSeoPage(html.replace('"@type":"Organization"', 'BROKEN'), 200, url).jsonLdErrors).toContain(
      'JSON-LD is not valid JSON.',
    );
  });

  it('detects duplicated titles/descriptions across distinct indexable URLs', () => {
    const one = parseSeoPage(html, 200, url);
    const two = { ...one, url: 'https://example.org/areas/fife' };
    expect(duplicateMetadataErrors([one, two])).toHaveLength(2);
  });

  it('requires social preview images and reports the stricter editorial length targets', () => {
    const page = parseSeoPage(html.replace('property="og:image"', 'property="unused"'), 200, url);
    expect(validateIndexablePage(page, url).join(' ')).toContain('social preview images');
    expect(metadataWarnings({ ...page, title: 'A'.repeat(61), description: 'B'.repeat(156) })).toHaveLength(
      2,
    );
  });

  it('validates entities inside a graph without treating the graph container as a missing type', () => {
    const graph = html.replace(
      '{"@context":"https://schema.org","@type":"Organization","name":"Speedy Van","url":"https://example.org"}',
      '{"@context":"https://schema.org","@graph":[{"@type":"MovingCompany","name":"Speedy Van","url":"https://example.org"},{"@type":"WebSite","name":"Speedy Van","url":"https://example.org"}]}',
    );
    expect(validateIndexablePage(parseSeoPage(graph, 200, url), url)).toEqual([]);
  });

  it('excludes external/API/mail links while preserving valid relative public links', () => {
    expect(
      internalLinks(
        '<a href="/api/v1/bookings">API</a><a href="mailto:mail@example.org">Email</a><a href="https://other.org">Other</a><a href="/areas/fife#towns">Fife</a>',
        url,
      ),
    ).toEqual(['https://example.org/areas/fife']);
  });
});
