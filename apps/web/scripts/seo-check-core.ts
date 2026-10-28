export interface SeoPageCheck {
  canonical: string;
  description: string;
  h1Count: number;
  imagesWithoutAlt: number;
  jsonLdCount: number;
  jsonLdErrors: string[];
  linkCount: number;
  noindex: boolean;
  openGraphDescription: string;
  openGraphImage: string;
  openGraphTitle: string;
  openGraphUrl: string;
  status: number;
  title: string;
  twitterCard: string;
  twitterImage: string;
  twitterTitle: string;
  url: string;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match: string, entity: string) => {
    const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
    const code =
      entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function attributes(tag: string): Map<string, string> {
  return new Map(
    Array.from(tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g), (match) => [
      (match[1] ?? '').toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''),
    ]),
  );
}

function withoutScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '');
}

function metaContent(html: string, name: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const values = attributes(match[0]);
    if ((values.get('name') ?? values.get('property'))?.toLowerCase() === name)
      return values.get('content') ?? '';
  }
  return '';
}

function structuredDataErrors(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(structuredDataErrors);
  if (!value || typeof value !== 'object') return ['JSON-LD must contain an object or graph.'];
  const node = value as Record<string, unknown>;
  if ('@graph' in node) return structuredDataErrors(node['@graph']);
  const type = node['@type'];
  if (typeof type !== 'string' && !Array.isArray(type)) return ['JSON-LD object has no @type.'];
  const types: unknown[] = Array.isArray(type) ? type : [type];
  const errors: string[] = [];
  for (const kind of types) {
    if (typeof kind !== 'string') {
      errors.push('JSON-LD @type must contain strings.');
      continue;
    }
    const required =
      kind === 'BreadcrumbList' || kind === 'ItemList'
        ? ['itemListElement']
        : kind === 'FAQPage'
          ? ['mainEntity']
          : kind === 'Service'
            ? ['name', 'serviceType', 'provider']
            : kind === 'Organization' || kind === 'MovingCompany' || kind === 'WebSite'
              ? ['name', 'url']
              : [];
    for (const key of required) {
      const field = node[key];
      if (
        field === undefined ||
        field === null ||
        field === '' ||
        (Array.isArray(field) && field.length === 0)
      ) {
        errors.push(`${kind} JSON-LD is missing ${key}.`);
      }
    }
  }
  return errors;
}

export function internalLinks(html: string, origin: string): string[] {
  const links: string[] = [];
  for (const match of withoutScripts(html).matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(match[0]).get('href');
    if (!href || href.startsWith('#')) continue;
    const url = URL.canParse(href, origin) ? new URL(href, origin) : null;
    if (url?.origin === new URL(origin).origin && !url.pathname.startsWith('/api/')) {
      url.hash = '';
      links.push(url.toString());
    }
  }
  return links;
}

export function parseSeoPage(html: string, status: number, url: string, xRobotsTag = ''): SeoPageCheck {
  const markup = withoutScripts(html);
  const jsonLdErrors: string[] = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(
    (match) => attributes(match[1] ?? '').get('type') === 'application/ld+json',
  );
  for (const script of scripts) {
    try {
      const data: unknown = JSON.parse(script[2] ?? '');
      jsonLdErrors.push(...structuredDataErrors(data));
    } catch {
      jsonLdErrors.push('JSON-LD is not valid JSON.');
    }
  }
  const canonical =
    [...markup.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => attributes(match[0]))
      .find((value) => value.get('rel')?.split(/\s+/).includes('canonical'))
      ?.get('href') ?? '';
  const directives = `${metaContent(markup, 'robots')},${metaContent(markup, 'googlebot')},${xRobotsTag}`;
  return {
    canonical,
    description: metaContent(markup, 'description'),
    h1Count: [...markup.matchAll(/<h1\b/gi)].length,
    imagesWithoutAlt: [...markup.matchAll(/<img\b[^>]*>/gi)].filter(
      (match) => !attributes(match[0]).has('alt'),
    ).length,
    jsonLdCount: scripts.length,
    jsonLdErrors,
    linkCount: internalLinks(markup, url).length,
    noindex: /(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])/i.test(directives),
    openGraphDescription: metaContent(markup, 'og:description'),
    openGraphImage: metaContent(markup, 'og:image'),
    openGraphTitle: metaContent(markup, 'og:title'),
    openGraphUrl: metaContent(markup, 'og:url'),
    status,
    title: decodeEntities((markup.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '').trim()),
    twitterCard: metaContent(markup, 'twitter:card'),
    twitterImage: metaContent(markup, 'twitter:image'),
    twitterTitle: metaContent(markup, 'twitter:title'),
    url,
  };
}

export function validateIndexablePage(page: SeoPageCheck, expectedCanonical: string): string[] {
  const errors: string[] = [];
  const canonical = (value: string) => value.replace(/\/$/, '');
  if (page.status !== 200) errors.push(`returned ${String(page.status)}`);
  if (!page.title || page.title.length > 70) errors.push('has invalid title');
  if (!page.description || page.description.length > 170) errors.push('has invalid description');
  if (page.h1Count !== 1) errors.push(`has ${String(page.h1Count)} H1 elements; expected one`);
  if (!page.canonical || canonical(page.canonical) !== canonical(expectedCanonical))
    errors.push('has invalid canonical');
  if (page.noindex) errors.push('is listed in the sitemap but has noindex');
  if (page.jsonLdCount === 0) errors.push('has no JSON-LD');
  errors.push(...page.jsonLdErrors);
  if (page.linkCount < 5) errors.push('has fewer than five internal links');
  if (page.imagesWithoutAlt > 0) errors.push('has images without alt attributes');
  if (page.openGraphTitle !== page.title || page.twitterTitle !== page.title)
    errors.push('has missing or inconsistent social titles');
  if (page.openGraphDescription !== page.description)
    errors.push('has missing or inconsistent social description');
  if (canonical(page.openGraphUrl) !== canonical(expectedCanonical))
    errors.push('has missing or inconsistent Open Graph URL');
  if (!URL.canParse(page.openGraphImage) || !URL.canParse(page.twitterImage))
    errors.push('has missing or invalid social preview images');
  if (!['summary', 'summary_large_image'].includes(page.twitterCard))
    errors.push('has no supported Twitter card');
  return errors.map((error) => `${page.url} ${error}`);
}

export function metadataWarnings(page: SeoPageCheck): string[] {
  const warnings: string[] = [];
  if (page.title.length > 60)
    warnings.push(`${page.url} title is ${String(page.title.length)} characters (target: 60 or fewer).`);
  if (page.description.length > 155)
    warnings.push(
      `${page.url} description is ${String(page.description.length)} characters (target: 155 or fewer).`,
    );
  return warnings;
}

export function duplicateMetadataErrors(pages: SeoPageCheck[]): string[] {
  const errors: string[] = [];
  for (const key of ['title', 'description'] as const) {
    const seen = new Map<string, string>();
    for (const page of pages) {
      const value = page[key].trim().toLowerCase();
      if (!value) continue;
      const previous = seen.get(value);
      if (previous) errors.push(`${page.url} duplicates ${key} from ${previous}`);
      else seen.set(value, page.url);
    }
  }
  return errors;
}
