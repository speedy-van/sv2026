import { parseSetting, SettingKeySchema, type SettingKey } from '@sv/contracts';
import { prisma } from '@sv/db';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Severity = 'pass' | 'warn' | 'blocker';

interface CheckResult {
  message: string;
  name: string;
  severity: Severity;
}

interface StripeEndpoint {
  enabled_events?: string[];
  status?: string;
  url?: string;
}

interface StripeWebhookResponse {
  data?: StripeEndpoint[];
}

interface ResendDomain {
  name?: string;
  status?: string;
}

interface ResendDomainResponse {
  data?: ResendDomain[];
}

const productionOrigin = 'https://www.speedyvan.uk';
const requiredStripeEvents = [
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'refund.updated',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

const results: CheckResult[] = [];

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
config({ path: resolve(process.cwd(), '.env'), quiet: true });

function valueOf(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function record(severity: Severity, name: string, message: string): void {
  results.push({ message, name, severity });
}

function pass(name: string, message: string): void {
  record('pass', name, message);
}

function warn(name: string, message: string): void {
  record('warn', name, message);
}

function blocker(name: string, message: string): void {
  record('blocker', name, message);
}

function requireEnv(name: string): string | undefined {
  const value = valueOf(name);
  if (!value) {
    blocker(`env:${name}`, `${name} is missing.`);
    return undefined;
  }
  pass(`env:${name}`, `${name} is set.`);
  return value;
}

function requirePrefix(name: string, prefix: string): string | undefined {
  const value = requireEnv(name);
  if (!value) return undefined;
  if (!value.startsWith(prefix)) {
    blocker(`env:${name}`, `${name} must use the ${prefix} production prefix.`);
    return undefined;
  }
  pass(`env:${name}:prefix`, `${name} uses the required production prefix.`);
  return value;
}

function requireMinLength(name: string, minLength: number): string | undefined {
  const value = requireEnv(name);
  if (!value) return undefined;
  if (value.length < minLength) {
    blocker(`env:${name}:length`, `${name} must be at least ${String(minLength)} characters.`);
    return undefined;
  }
  pass(`env:${name}:length`, `${name} meets the minimum length.`);
  return value;
}

function requireUrl(name: string): string | undefined {
  const value = requireEnv(name);
  if (!value) return undefined;
  try {
    new URL(value);
    pass(`env:${name}:url`, `${name} is a valid URL.`);
    return value;
  } catch {
    blocker(`env:${name}:url`, `${name} must be a valid URL.`);
    return undefined;
  }
}

function requireOrigin(name: string): string | undefined {
  const value = requireUrl(name);
  if (!value) return undefined;
  const origin = new URL(value).origin;
  if (origin !== productionOrigin) {
    blocker(`env:${name}:origin`, `${name} must be ${productionOrigin}.`);
    return undefined;
  }
  pass(`env:${name}:origin`, `${name} matches ${productionOrigin}.`);
  return origin;
}

function optionalExpected(name: string, expected: string): void {
  const value = valueOf(name);
  if (!value) return;
  if (value !== expected) {
    blocker(`env:${name}`, `${name} must be ${expected} for launch.`);
    return;
  }
  pass(`env:${name}`, `${name} is ${expected}.`);
}

function optionalMustBeUnset(name: string): void {
  if (valueOf(name)) {
    blocker(`env:${name}`, `${name} must not be set in production.`);
    return;
  }
  pass(`env:${name}`, `${name} is not set.`);
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ${response.statusText}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function checkEnv(): Promise<string | undefined> {
  requireUrl('DATABASE_URL');
  requireUrl('DATABASE_URL_UNPOOLED');
  const appOrigin = requireOrigin('APP_ORIGIN');
  requireOrigin('NEXT_PUBLIC_SITE_URL');
  requirePrefix('STRIPE_SECRET_KEY', 'sk_live_');
  requirePrefix('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_');
  requirePrefix('STRIPE_WEBHOOK_SECRET', 'whsec_');
  requireEnv('MAPBOX_SECRET_TOKEN');
  optionalExpected('MAPBOX_MODE', 'live');
  requireEnv('RESEND_API_KEY');
  requireEnv('EMAIL_FROM');
  requireUrl('UPSTASH_REDIS_REST_URL');
  requireEnv('UPSTASH_REDIS_REST_TOKEN');
  requireEnv('BLOB_READ_WRITE_TOKEN');
  requireEnv('EXPO_ACCESS_TOKEN');
  optionalExpected('PUSH_MODE', 'live');
  optionalMustBeUnset('E2E');
  requireUrl('SENTRY_DSN');
  requireUrl('NEXT_PUBLIC_SENTRY_DSN');
  requireEnv('SENTRY_AUTH_TOKEN');
  requireMinLength('CRON_SECRET', 32);
  requireMinLength('JWT_ACCESS_SECRET', 32);
  requireMinLength('CUSTOMER_LINK_SECRET', 32);
  requireMinLength('OTP_PEPPER', 32);
  requireMinLength('IP_HASH_SALT', 32);
  requireEnv('MIN_ADMIN_APP_VERSION');
  requireEnv('MIN_DRIVER_APP_VERSION');
  return appOrigin;
}

async function checkDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    pass('db:connectivity', 'Database query succeeded.');
  } catch {
    blocker('db:connectivity', 'Database is unreachable with the configured DATABASE_URL.');
    return;
  }

  const keys = SettingKeySchema.options as readonly SettingKey[];
  const rows = await prisma.setting.findMany({
    select: { key: true, value: true },
    where: { key: { in: [...keys] } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  for (const key of keys) {
    const raw = byKey.get(key);
    if (raw === undefined) {
      blocker(`setting:${key}`, `Setting ${key} is missing.`);
      continue;
    }
    try {
      parseSetting(key, raw);
      pass(`setting:${key}`, `Setting ${key} is valid.`);
    } catch {
      blocker(`setting:${key}`, `Setting ${key} is invalid.`);
    }
  }

  const launchRaw = byKey.get('launch');
  if (launchRaw !== undefined) {
    try {
      const launch = parseSetting('launch', launchRaw);
      if (launch.missingFacts.length === 0) {
        pass('launch:missingFacts', 'No TODO(owner) facts remain.');
      } else {
        blocker('launch:missingFacts', `launch.missingFacts contains ${String(launch.missingFacts.length)} unresolved owner facts.`);
      }
      if (launch.legalApprovedAt) {
        pass('launch:legalApprovedAt', 'Solicitor approval timestamp is set.');
      } else {
        blocker('launch:legalApprovedAt', 'launch.legalApprovedAt is not set.');
      }
      if (launch.applePayDomainVerifiedAt) {
        pass('launch:applePayDomainVerifiedAt', 'Apple Pay domain verification timestamp is set.');
      } else {
        warn('launch:applePayDomainVerifiedAt', 'Apple Pay domain verification timestamp is not set.');
      }
    } catch {
      blocker('launch:settings', 'Launch settings could not be parsed.');
    }
  }

  const webRaw = byKey.get('web');
  if (webRaw !== undefined) {
    try {
      const web = parseSetting('web', webRaw);
      if (web.canonicalOrigin === productionOrigin) {
        pass('setting:web.canonicalOrigin', 'canonicalOrigin matches production.');
      } else {
        blocker('setting:web.canonicalOrigin', `canonicalOrigin must be ${productionOrigin}.`);
      }
    } catch {
      blocker('setting:web.canonicalOrigin', 'Web settings could not be parsed.');
    }
  }

  const contactRaw = byKey.get('contact');
  if (contactRaw !== undefined) {
    try {
      const contact = parseSetting('contact', contactRaw);
      if (contact.emailAdminAlerts.length > 0) {
        pass('setting:contact.emailAdminAlerts', 'Admin alert recipients are configured.');
      } else {
        blocker('setting:contact.emailAdminAlerts', 'contact.emailAdminAlerts must contain at least one address.');
      }
    } catch {
      blocker('setting:contact.emailAdminAlerts', 'Contact settings could not be parsed.');
    }
  }

  const activePricing = await prisma.pricingConfigVersion.findFirst({
    select: { approvedByOwner: true, id: true },
    where: { status: 'ACTIVE' },
  });
  if (!activePricing) {
    blocker('pricing:active', 'No ACTIVE pricing version exists.');
  } else if (!activePricing.approvedByOwner) {
    blocker('pricing:approvedByOwner', 'The ACTIVE pricing version is not approved by the owner.');
  } else {
    pass('pricing:approvedByOwner', 'The ACTIVE pricing version is owner-approved.');
  }

  const [ownerCount, capacityCount, adminPushCount] = await Promise.all([
    prisma.user.count({ where: { role: 'OWNER', status: 'ACTIVE' } }),
    prisma.capacityRule.count(),
    prisma.pushDevice.count({
      where: {
        app: 'ADMIN',
        enabled: true,
        lastError: null,
        user: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
      },
    }),
  ]);

  if (ownerCount > 0) {
    pass('staff:owner', 'At least one active OWNER exists.');
  } else {
    blocker('staff:owner', 'At least one active OWNER is required.');
  }
  if (capacityCount > 0) {
    pass('capacity:rules', 'Capacity rules exist.');
  } else {
    blocker('capacity:rules', 'Capacity rules are missing.');
  }
  if (adminPushCount > 0) {
    pass('push:admin-device', 'At least one enabled OWNER/ADMIN push device exists.');
  } else {
    blocker('push:admin-device', 'At least one enabled OWNER/ADMIN push device without a stored error is required.');
  }
}

async function checkHealth(origin: string | undefined): Promise<void> {
  if (!origin) return;
  try {
    const response = await fetch(`${origin}/api/v1/health`, { cache: 'no-store' });
    if (response.status === 200) {
      pass('production:health', 'Production /api/v1/health returned 200.');
    } else {
      blocker('production:health', `Production /api/v1/health returned ${String(response.status)}.`);
    }
  } catch {
    blocker('production:health', 'Production /api/v1/health could not be reached.');
  }
}

async function checkStripe(origin: string | undefined): Promise<void> {
  const secret = valueOf('STRIPE_SECRET_KEY');
  if (!secret?.startsWith('sk_live_') || !origin) return;
  try {
    const body = await fetchJson<StripeWebhookResponse>('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const expectedUrl = `${origin}/api/webhooks/stripe`;
    const endpoint = body.data?.find((candidate) => candidate.url === expectedUrl && candidate.status === 'enabled');
    if (!endpoint) {
      blocker('stripe:webhook', `No enabled live Stripe webhook endpoint exists for ${expectedUrl}.`);
      return;
    }
    const enabled = new Set(endpoint.enabled_events ?? []);
    const missing = requiredStripeEvents.filter((event) => !enabled.has(event) && !enabled.has('*'));
    if (missing.length > 0) {
      blocker('stripe:webhook-events', `Live Stripe webhook is missing events: ${missing.join(', ')}.`);
    } else {
      pass('stripe:webhook-events', 'Live Stripe webhook has every required event.');
    }
  } catch {
    blocker('stripe:webhook', 'Could not verify live Stripe webhook endpoints with STRIPE_SECRET_KEY.');
  }
}

async function checkMapbox(): Promise<void> {
  const token = valueOf('MAPBOX_SECRET_TOKEN');
  if (!token) return;
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', 'Glasgow');
  url.searchParams.set('country', 'gb');
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', token);
  try {
    await fetchJson<unknown>(url.toString());
    pass('mapbox:token', 'Mapbox token answered a geocoding request.');
  } catch {
    blocker('mapbox:token', 'Mapbox token did not answer the launch geocoding request.');
  }
}

async function checkUpstash(): Promise<void> {
  const url = valueOf('UPSTASH_REDIS_REST_URL');
  const token = valueOf('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return;
  try {
    await fetchJson<unknown>(url, {
      body: JSON.stringify(['PING']),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    pass('upstash:ping', 'Upstash REST PING succeeded.');
  } catch {
    blocker('upstash:ping', 'Upstash REST PING failed.');
  }
}

async function checkResend(): Promise<void> {
  const key = valueOf('RESEND_API_KEY');
  if (!key) return;
  try {
    const body = await fetchJson<ResendDomainResponse>('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const domain = body.data?.find((candidate) => candidate.name === 'speedyvan.uk');
    if (domain?.status === 'verified') {
      pass('resend:domain', 'Resend domain speedyvan.uk is verified.');
    } else {
      blocker('resend:domain', 'Resend domain speedyvan.uk is not verified.');
    }
  } catch {
    blocker('resend:domain', 'Could not verify Resend domains with RESEND_API_KEY.');
  }
}

function checkFactsFile(): void {
  try {
    const facts = readFileSync(resolve(process.cwd(), 'docs/FACTS.md'), 'utf8');
    const matches = facts.match(/TODO\(owner\)/g) ?? [];
    if (matches.length === 0) {
      pass('facts:file', 'docs/FACTS.md contains no TODO(owner) placeholders.');
    } else {
      blocker('facts:file', `docs/FACTS.md contains ${String(matches.length)} TODO(owner) placeholder(s).`);
    }
  } catch {
    blocker('facts:file', 'docs/FACTS.md could not be read.');
  }
}

function printResults(): void {
  const order: Record<Severity, number> = { blocker: 0, warn: 1, pass: 2 };
  const sorted = [...results].sort((left, right) => order[left.severity] - order[right.severity] || left.name.localeCompare(right.name));
  for (const result of sorted) {
    const label = result.severity === 'blocker' ? 'BLOCKER' : result.severity === 'warn' ? 'WARN' : 'PASS';
    const output = `${label} ${result.name}: ${result.message}\n`;
    if (result.severity === 'blocker') {
      process.stderr.write(output);
    } else {
      process.stdout.write(output);
    }
  }
}

async function main(): Promise<void> {
  const origin = await checkEnv();
  checkFactsFile();
  await checkDatabase();
  await Promise.all([checkHealth(origin), checkStripe(origin), checkMapbox(), checkUpstash(), checkResend()]);
  await prisma.$disconnect();
  printResults();
  const blockers = results.filter((result) => result.severity === 'blocker');
  if (blockers.length > 0) {
    process.stderr.write(`Launch checks failed with ${String(blockers.length)} blocker(s).\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Launch checks passed.\n');
}

main().catch(async (error: unknown) => {
  await prisma.$disconnect();
  process.stderr.write(`Launch check crashed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
