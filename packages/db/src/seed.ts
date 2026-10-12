import { parseSetting, type SettingKey } from '@sv/contracts';
import { DEFAULT_PRICING_CONFIG, SLOT_KEYS } from '@sv/pricing';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { prisma } from './client';
import { readEnv } from './env';
import type { Prisma } from './generated/prisma/client';

type JsonRecord = Record<string, unknown>;
type CsvRow = Record<string, string>;
type FaqSeed = {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const slots = [...SLOT_KEYS];

const CITY_NOTES: Record<string, string> = {
  glasgow:
    'Much of the West End, Southside and city centre is tenement flats of three or four storeys, usually without a lift - choose the right floor so we send the right crew. Glasgow flats are numbered by floor and door: 2/1 means second floor, first door. Several central and West End areas have controlled parking, so tick the permit option if your street has restrictions.',
  edinburgh:
    'The New Town, Old Town, Marchmont, Bruntsfield and Leith are full of tenement and Georgian flats with long common stairs and few lifts. Flats are often labelled by floor and door, like 3F2 (third floor, second door). Much of the central city is a controlled parking zone, and Old Town closes are narrow and steep - mention narrow access and permits so we plan the right van and crew.',
  aberdeen: 'Many city-centre homes are granite tenements with shared stairs. Controlled parking covers the city centre and some surrounding streets; tick the permit option if that is you.',
  dundee: 'Tenement flats are common in the West End and city centre, and some central streets have parking restrictions. Moves across the Tay to Fife use the road bridge, so they are priced instantly.',
  inverness: 'Moves often start or end beyond the city in the wider Highlands. Mainland routes are priced instantly; if your route needs a ferry, our team prices it individually.',
  perth: 'Older town-centre flats can have narrow shared stairs - select narrow access if furniture has tight turns to make.',
  stirling: 'The Old Town around the castle has steep, narrow streets; if you live there, select narrow access so we bring the right van.',
  'dunfermline': "Scotland's newest city (since 2022). Town-centre flats and new-build estates both feature - tell us about stairs and parking so your price is exact.",
};

function repoPath(path: string): string {
  return resolve(repoRoot, path);
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function asRecord(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function normalizeTodos(value: unknown, path: string, missingFacts: string[]): unknown {
  if (typeof value === 'string' && value.trim().startsWith('TODO(owner)')) {
    missingFacts.push(path);
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeTodos(entry, `${path}[${String(index)}]`, missingFacts));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeTodos(child, `${path}.${key}`, missingFacts)]));
  }
  return value;
}

function readFacts(): { facts: JsonRecord; missingFacts: string[] } {
  const factsMarkdown = readFileSync(repoPath('docs/FACTS.md'), 'utf8');
  const match = factsMarkdown.match(/```yaml\s*([\s\S]*?)```/);
  if (!match?.[1]) throw new Error('FACTS.md must contain a yaml code block');
  const missingFacts: string[] = [];
  const parsed = parseYaml(match[1]) as unknown;
  return { facts: normalizeTodos(parsed, 'facts', missingFacts) as JsonRecord, missingFacts };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function emailList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function slotWindow(value: unknown): { label: string; start: string; end: string } {
  if (typeof value !== 'string') throw new Error('slot window must be a string');
  const [start, end] = value.split('-');
  if (!start || !end) throw new Error(`invalid slot window ${value}`);
  return { label: value, start, end };
}

function serviceAreaRule(value: unknown): 'SCOTLAND_ONLY' | 'TO_OR_FROM_SCOTLAND' | 'SCOTLAND_ENGLAND_WALES' {
  if (value === 'PICKUP_OR_DROPOFF_IN_SCOTLAND') return 'TO_OR_FROM_SCOTLAND';
  if (value === 'BOTH_IN_SCOTLAND') return 'SCOTLAND_ONLY';
  if (value === 'SCOTLAND_ONLY' || value === 'TO_OR_FROM_SCOTLAND' || value === 'SCOTLAND_ENGLAND_WALES') return value;
  throw new Error('operations.serviceAreaRule is invalid');
}

function settingsFromFacts(facts: JsonRecord, missingFacts: string[]): Record<SettingKey, unknown> {
  const company = asRecord(facts.company, 'company');
  const contact = asRecord(facts.contact, 'contact');
  const web = asRecord(facts.web, 'web');
  const socials = asRecord(web.socials, 'web.socials');
  const operations = asRecord(facts.operations, 'operations');
  const operationSlotWindows = asRecord(operations.slotWindows, 'operations.slotWindows');
  const cancellation = asRecord(facts.cancellation, 'cancellation');
  const insurance = asRecord(facts.insurance, 'insurance');
  const trust = asRecord(facts.trust, 'trust');
  const drivers = asRecord(facts.drivers, 'drivers');

  let defaultCapacityPerSlot = nullableNumber(operations.defaultCapacityPerSlot);
  if (defaultCapacityPerSlot === null) {
    process.emitWarning('operations.defaultCapacityPerSlot is missing; using 1 in development seed.');
    defaultCapacityPerSlot = 1;
  }

  return {
    company: {
      legalName: nullableString(company.legalName),
      tradingName: nullableString(company.tradingName) ?? 'Speedy Van',
      companyNumber: nullableString(company.companyNumber),
      registeredIn: nullableString(company.registeredIn),
      registeredOffice: nullableString(company.registeredOffice),
      vatRegistered: nullableBoolean(company.vatRegistered),
      vatNumber: nullableString(company.vatNumber),
      icoRegistrationNumber: nullableString(company.icoRegistrationNumber),
    },
    contact: {
      phoneDisplay: nullableString(contact.phoneDisplay),
      phoneE164: nullableString(contact.phoneE164),
      whatsappE164: nullableString(contact.whatsappE164),
      emailPublic: nullableString(contact.emailPublic),
      emailBookings: nullableString(contact.emailBookings),
      emailAdminAlerts: emailList(contact.emailAdminAlerts),
      phoneHours: nullableString(contact.phoneHours),
      showAddressPublicly: contact.showAddressPublicly === true,
    },
    web: {
      canonicalOrigin: nullableString(web.canonicalOrigin) ?? 'https://www.speedyvan.uk',
      googleBusinessProfileUrl: nullableString(web.googleBusinessProfileUrl),
      analyticsIds: {
        gaMeasurementId: nullableString(web.ga4MeasurementId),
        googleAdsId: nullableString(web.googleAdsConversionId),
        googleAdsPurchaseLabel: nullableString(web.googleAdsPurchaseLabel),
      },
      socials: {
        facebook: nullableString(socials.facebook),
        instagram: nullableString(socials.instagram),
        tiktok: nullableString(socials.tiktok),
        x: nullableString(socials.x),
        linkedin: nullableString(socials.linkedin),
        youtube: nullableString(socials.youtube),
      },
    },
    operations: {
      slotWindows: {
        MORNING: slotWindow(operationSlotWindows.MORNING),
        AFTERNOON: slotWindow(operationSlotWindows.AFTERNOON),
        EVENING: slotWindow(operationSlotWindows.EVENING),
      },
      minLeadMinutes: nullableNumber(operations.minLeadMinutes) ?? 120,
      defaultCapacityPerSlot,
      serviceAreaRule: serviceAreaRule(operations.serviceAreaRule),
      crossBorderMoves: nullableBoolean(operations.crossBorderMoves),
      maxInstantDistanceMiles: nullableNumber(operations.maxInstantDistanceMiles) ?? 400,
      quoteValidityMinutes: nullableNumber(operations.quoteValidityMinutes) ?? 60,
      paymentHoldMinutes: nullableNumber(operations.paymentHoldMinutes) ?? 30,
      phoneBookingHoldHours: nullableNumber(operations.phoneBookingHoldHours) ?? 24,
      bookingPaused: false,
      jobSizeRules: Array.isArray(operations.jobSizeRules) ? operations.jobSizeRules : [],
    },
    apps: { adminInstallUrl: null, driverInstallUrl: null },
    cancellation: {
      freeCancellationHours: nullableNumber(cancellation.freeCancellationHours),
      lateCancellationRefundPercent: nullableNumber(cancellation.lateCancellationRefundPercent),
      noRefundHours: nullableNumber(cancellation.noRefundHours),
      selfServiceRescheduleHours: nullableNumber(cancellation.selfServiceRescheduleHours),
    },
    insurance: {
      goodsInTransitInsurer: nullableString(insurance.goodsInTransitInsurer),
      goodsInTransitCoverPence: nullableNumber(insurance.goodsInTransitCoverPence),
      publicLiabilityCoverPence: nullableNumber(insurance.publicLiabilityCoverPence),
      claimsEmail: nullableString(insurance.claimsEmail),
    },
    trust: {
      yearsTrading: nullableNumber(trust.yearsTrading),
      vansInFleet: nullableNumber(trust.vansInFleet),
    },
    drivers: {
      defaultPayoutPercent: nullableNumber(drivers.defaultPayoutPercent),
    },
    siteBanner: { enabled: false, text: '', tone: 'info' },
    notifications: { newBookingRepeatUntilSeen: true, driverQuietHours: { start: '21:00', end: '07:00' } },
    seo: { indexTier3: false },
    legal: { requireExpressStartAck: true },
    launch: { legalApprovedAt: null, applePayDomainVerifiedAt: null, missingFacts },
  };
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...dataRows] = rows;
  if (!headers) return [];
  return dataRows.map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ''])));
}

function requiredCell(row: CsvRow, key: string): string {
  const value = row[key];
  if (value === undefined || value.length === 0) throw new Error(`CSV row is missing ${key}`);
  return value;
}

async function seedPricing(): Promise<void> {
  const existing = await prisma.pricingConfigVersion.count();
  if (existing > 0) return;
  await prisma.pricingConfigVersion.create({
    data: {
      version: 1,
      status: 'ACTIVE',
      config: DEFAULT_PRICING_CONFIG as unknown as Prisma.InputJsonValue,
      approvedByOwner: false,
      notes: 'Seeded DEFAULT_PRICING_CONFIG v1',
      publishedAt: new Date(),
    },
  });
}

async function seedItems(): Promise<void> {
  const rows = parseCsv(readFileSync(repoPath('docs/data/items-catalogue.csv'), 'utf8'));
  for (const row of rows) {
    const data = {
      slug: requiredCell(row, 'slug'),
      name: requiredCell(row, 'name'),
      category: requiredCell(row, 'category'),
      volumeM3: Number(requiredCell(row, 'volume_m3')),
      popular: row.popular === '1',
      aliases: row.aliases ? row.aliases.split('|').filter(Boolean) : [],
      sortOrder: Number(requiredCell(row, 'sort_order')),
      active: true,
    };
    const existing = await prisma.item.findUnique({ where: { slug: data.slug } });
    if (!existing) {
      await prisma.item.create({ data });
    } else if (
      existing.name !== data.name ||
      existing.category !== data.category ||
      existing.volumeM3 !== data.volumeM3 ||
      existing.popular !== data.popular ||
      stableJson(existing.aliases) !== stableJson(data.aliases) ||
      existing.sortOrder !== data.sortOrder ||
      existing.active !== data.active
    ) {
      await prisma.item.update({ where: { slug: data.slug }, data });
    }
  }
}

async function seedPresets(): Promise<void> {
  const existingItems = new Set((await prisma.item.findMany({ select: { slug: true } })).map((item) => item.slug));
  const presetFile = JSON.parse(readFileSync(repoPath('docs/data/item-presets.json'), 'utf8')) as { presets: Array<{ slug: string; name: string; sortOrder: number; items: Array<{ itemSlug: string; quantity: number }> }> };
  for (const preset of presetFile.presets) {
    for (const item of preset.items) {
      if (!existingItems.has(item.itemSlug)) throw new Error(`Preset ${preset.slug} references unknown item ${item.itemSlug}`);
    }
    const data = {
      slug: preset.slug,
      name: preset.name,
      sortOrder: preset.sortOrder,
      items: preset.items as unknown as Prisma.InputJsonValue,
      active: true,
    };
    const existing = await prisma.itemPreset.findUnique({ where: { slug: data.slug } });
    if (!existing) {
      await prisma.itemPreset.create({ data });
    } else if (existing.name !== data.name || existing.sortOrder !== data.sortOrder || stableJson(existing.items) !== stableJson(preset.items) || existing.active !== data.active) {
      await prisma.itemPreset.update({ where: { slug: data.slug }, data });
    }
  }
}

async function seedCapacity(defaultCapacityPerSlot: number, closedDates: unknown): Promise<void> {
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (const slot of slots) {
      const existing = await prisma.capacityRule.findUnique({ where: { weekday_slot: { weekday, slot } } });
      if (!existing) {
        await prisma.capacityRule.create({ data: { weekday, slot, capacity: defaultCapacityPerSlot } });
      }
    }
  }
  if (!Array.isArray(closedDates)) return;
  for (const closedDate of closedDates) {
    if (typeof closedDate !== 'string') continue;
    for (const slot of slots) {
      const date = dateOnly(closedDate);
      const existing = await prisma.capacityOverride.findUnique({ where: { date_slot: { date, slot } } });
      if (!existing) {
        await prisma.capacityOverride.create({ data: { date, slot, capacity: 0, reason: 'Seeded closure from FACTS.md' } });
      }
    }
  }
}

async function seedSettings(settings: Record<SettingKey, unknown>): Promise<void> {
  for (const key of Object.keys(settings) as SettingKey[]) {
    const parsed = parseSetting(key, settings[key]);
    const existing = await prisma.setting.findUnique({ where: { key } });
    const value = parsed as Prisma.InputJsonValue;
    if (!existing) {
      await prisma.setting.create({ data: { key, value } });
    } else if (!existing.updatedById && stableJson(existing.value) !== stableJson(parsed)) {
      await prisma.setting.update({ where: { key }, data: { value } });
    }
  }
}

async function loadFaqSeed(): Promise<FaqSeed[]> {
  const faqPath = repoPath('apps/web/src/content/faqs.ts');
  if (!existsSync(faqPath)) return [];
  const module = (await import(pathToFileURL(faqPath).href)) as { FAQ_SEED?: FaqSeed[] };
  return module.FAQ_SEED ?? [];
}

async function seedFaqs(): Promise<void> {
  if ((await prisma.faq.count()) > 0) return;
  const faqs = await loadFaqSeed();
  if (faqs.length === 0) return;
  await prisma.faq.createMany({
    data: faqs.map((faq) => ({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      sortOrder: faq.sortOrder,
      active: true,
    })),
  });
}

async function seedOwner(): Promise<void> {
  if ((await prisma.user.count({ where: { role: 'OWNER' } })) > 0) return;
  const email = readEnv('SEED_OWNER_EMAIL');
  const name = readEnv('SEED_OWNER_NAME');
  if (!email || !name) {
    process.emitWarning('SEED_OWNER_EMAIL and SEED_OWNER_NAME are missing; skipping local OWNER seed.');
    return;
  }
  await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
}

async function seedLocationContent(): Promise<void> {
  const rows = parseCsv(readFileSync(repoPath('docs/data/scotland-locations.csv'), 'utf8'));
  for (const row of rows) {
    const slug = requiredCell(row, 'slug');
    const existing = await prisma.locationContent.findUnique({ where: { slug } });
    if (existing) continue;
    const cityNote = CITY_NOTES[slug];
    await prisma.locationContent.create({
      data: {
        slug,
        localNotes: cityNote ?? null,
        published: cityNote ? false : true,
      },
    });
  }
}

async function main(): Promise<void> {
  const { facts, missingFacts } = readFacts();
  const settings = settingsFromFacts(facts, missingFacts);
  const operations = asRecord(settings.operations, 'settings.operations');
  const rawOperations = asRecord(facts.operations, 'operations');
  await seedPricing();
  await seedItems();
  await seedPresets();
  await seedCapacity(operations.defaultCapacityPerSlot as number, rawOperations.closedDates);
  await seedSettings(settings);
  await seedFaqs();
  await seedOwner();
  await seedLocationContent();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
