import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { EventEmitter } from 'node:events';
import process from 'node:process';

interface AutocannonRequest {
  body?: string | Buffer;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}

interface AutocannonContext {
  sequence?: number;
}

interface AutocannonLatency {
  p97_5: number;
}

interface AutocannonResult {
  duration: number;
  errors: number;
  latency: AutocannonLatency;
  non2xx: number;
  observedP95: number;
  requests: {
    average: number;
    sent: number;
  };
}

type Autocannon = (
  options: {
    body: string;
    connections: number;
    duration: number;
    headers: Record<string, string>;
    method: 'POST';
    overallRate: number;
    requests: Array<{
      setupRequest(request: AutocannonRequest, context: AutocannonContext): AutocannonRequest;
    }>;
    title: string;
    url: string;
  },
  done: (error: Error | null, result: AutocannonResult) => void,
) => EventEmitter;

const require = createRequire(import.meta.url);
const autocannon = require('autocannon') as Autocannon;

const serverUrl = 'http://127.0.0.1:3000';
const readinessTimeoutMs = 60_000;

const payload = JSON.stringify({
  addons: { assembly: false, helpers: 0, packing: false },
  attribution: { landingPath: '/load-test' },
  dropoff: {
    label: '1 Princes Street, Edinburgh EH1 1BB',
    lat: 55.953,
    line1: '1 Princes Street',
    lng: -3.189,
    mapboxId: 'mock:edinburgh',
    postcode: 'EH1 1BB',
    source: 'MAPBOX',
    town: 'Edinburgh',
  },
  dropoffAccess: {
    carryMetres: 10,
    floorChoice: 'GROUND',
    hasLift: false,
    narrowAccess: false,
    permitZone: false,
  },
  items: [{ itemSlug: 'sofa-2-seater', kind: 'catalogue', quantity: 1 }],
  pickup: {
    label: '1 George Square, Glasgow G2 1DU',
    lat: 55.861,
    line1: '1 George Square',
    lng: -4.25,
    mapboxId: 'mock:glasgow',
    postcode: 'G2 1DU',
    source: 'MAPBOX',
    town: 'Glasgow',
  },
  pickupAccess: {
    carryMetres: 10,
    floorChoice: 'GROUND',
    hasLift: false,
    narrowAccess: false,
    permitZone: false,
  },
  service: 'man-and-van',
  variant: 'standard',
});

function executable(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function spawnCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  if (process.platform === 'win32') {
    return spawn([command, ...args].map(quoteWindowsArg).join(' '), {
      env,
      shell: true,
      stdio: 'inherit',
    });
  }
  return spawn(command, [...args], { env, shell: false, stdio: 'inherit' });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForServer(baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < readinessTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/catalogue`, { cache: 'no-store' });
      if (response.status < 500) return;
    } catch {
      // Poll until the local server is ready.
    }
    await sleep(500);
  }
  throw new Error('Next server was not ready for the quote load test.');
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.pid === undefined || server.killed) return;
  if (process.platform === 'win32') {
    const killer = spawnCommand('taskkill', ['/pid', String(server.pid), '/t', '/f'], process.env);
    await once(killer, 'exit');
    return;
  }
  server.kill('SIGTERM');
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function runAutocannon(baseUrl: string): Promise<AutocannonResult> {
  const duration = numericEnv('LOAD_DURATION_SECONDS', 120);
  const connections = numericEnv('LOAD_CONNECTIONS', 30);
  const overallRate = numericEnv('LOAD_RATE', 30);
  let requestSequence = 0;
  const responseTimes: number[] = [];
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        body: payload,
        connections,
        duration,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
        overallRate,
        requests: [
          {
            setupRequest(request, context) {
              const sequence = ++requestSequence;
              context.sequence = sequence;
              const thirdOctet = 100 + Math.floor(sequence / 250);
              const fourthOctet = 1 + (sequence % 250);
              return {
                ...request,
                headers: {
                  ...request.headers,
                  'x-forwarded-for': `198.51.${String(thirdOctet)}.${String(fourthOctet)}`,
                },
              };
            },
          },
        ],
        title: 'Speedy Van quote endpoint',
        url: `${baseUrl}/api/v1/quotes`,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({ ...result, observedP95: percentile(responseTimes, 95) });
      },
    );
    instance.on('response', (_client: unknown, _statusCode: number, _resBytes: number, responseTime: number) => {
      responseTimes.push(responseTime);
    });
  });
}

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return sorted[index] ?? Number.NaN;
}

function assertResult(result: AutocannonResult): void {
  const p95LimitMs = numericEnv('LOAD_P95_MS', 800);
  if (result.errors !== 0) throw new Error(`Quote load test had ${String(result.errors)} transport errors.`);
  if (result.non2xx !== 0) throw new Error(`Quote load test had ${String(result.non2xx)} non-2xx responses.`);
  const p95 = result.observedP95;
  if (!Number.isFinite(p95)) throw new Error('Quote load test p95 latency percentile is missing.');
  if (p95 >= p95LimitMs) {
    throw new Error(`Quote load test p95 ${String(p95)}ms is not below ${String(p95LimitMs)}ms.`);
  }
  process.stdout.write(
    `Quote load passed: ${String(result.requests.sent)} requests in ${String(result.duration)}s, avg ${String(Math.round(result.requests.average))} req/s, p95 ${String(p95)}ms.\n`,
  );
}

async function main(): Promise<void> {
  const externalBaseUrl = process.env.LOAD_BASE_URL?.replace(/\/$/, '');
  if (externalBaseUrl) {
    assertResult(await runAutocannon(externalBaseUrl));
    return;
  }

  const env = {
    ...process.env,
    CUSTOMER_LINK_SECRET: process.env.CUSTOMER_LINK_SECRET ?? 'local-load-customer-link-secret',
    E2E: process.env.E2E ?? '1',
    IP_HASH_SALT: process.env.IP_HASH_SALT ?? 'local-load-ip-hash-salt',
    MAPBOX_MODE: process.env.MAPBOX_MODE ?? 'mock',
    PUSH_MODE: process.env.PUSH_MODE ?? 'capture',
  };
  const server = spawnCommand(executable('npm'), ['run', 'start', '-w', '@sv/web'], env);
  try {
    await waitForServer(serverUrl);
    assertResult(await runAutocannon(serverUrl));
  } finally {
    await stopServer(server);
  }
}

await main();
