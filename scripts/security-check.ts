import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { once } from 'node:events';
import process from 'node:process';

interface AuditReport {
  vulnerabilities?: Record<string, {
    severity?: string;
  } | undefined>;
}

interface Check {
  name: string;
  run(): Promise<void> | void;
}

const repoRoot = process.cwd();
const allowedHighAuditPackages = new Set([
  '@expo/cli',
  '@expo/code-signing-certificates',
  '@expo/metro',
  '@expo/metro-config',
  '@jest/console',
  '@jest/core',
  '@jest/environment',
  '@jest/expect',
  '@jest/fake-timers',
  '@jest/globals',
  '@jest/reporters',
  '@jest/test-result',
  '@jest/test-sequencer',
  '@jest/transform',
  '@prisma/config',
  '@react-native/community-cli-plugin',
  '@react-native/jest-preset',
  '@react-native/metro-config',
  '@react-native/virtualized-lists',
  '@sentry/react-native',
  '@testing-library/react-native',
  'babel-jest',
  'braces',
  'create-jest',
  'deepmerge-ts',
  'expect',
  'expo',
  'expo-updates',
  'jest',
  'jest-circus',
  'jest-cli',
  'jest-config',
  'jest-environment-node',
  'jest-haste-map',
  'jest-message-util',
  'jest-resolve',
  'jest-resolve-dependencies',
  'jest-runner',
  'jest-runtime',
  'jest-snapshot',
  'jest-watcher',
  'metro',
  'metro-config',
  'metro-file-map',
  'metro-transform-worker',
  'micromatch',
  'mysql2',
  'node-forge',
  'prisma',
  'react-native',
  'react-native-gesture-handler',
  'react-native-is-edge-to-edge',
  'react-native-maps',
  'react-native-reanimated',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-webview',
  'react-native-worklets',
]);

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function filesUnder(relativePath: string, predicate: (path: string) => boolean): string[] {
  const root = join(repoRoot, relativePath);
  const found: string[] = [];
  const visit = (path: string): void => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) visit(join(path, child));
      return;
    }
    if (predicate(path)) found.push(path);
  };
  visit(root);
  return found;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function executable(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

async function commandJson(command: string, args: readonly string[]): Promise<{ code: number; stdout: string }> {
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
        cwd: repoRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn(command, [...args], {
    cwd: repoRoot,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
  if (!stdout && stderr) stdout = stderr;
  return { code: code ?? 1, stdout };
}

function checkExplicitWithApiAuth(): void {
  const routeFiles = filesUnder('apps/web/src', (path) => path.endsWith('.ts') || path.endsWith('.tsx'));
  const offenders = routeFiles
    .filter((path) => readFileSync(path, 'utf8').includes('withApi(request, {'))
    .filter((path) => /withApi\(request, \{(?![^\n]*auth:)/u.test(readFileSync(path, 'utf8')));
  assert(offenders.length === 0, `withApi calls missing explicit auth:\n${offenders.map((path) => relative(repoRoot, path)).join('\n')}`);
}

function checkCronSecrets(): void {
  const cronRoutes = filesUnder('apps/web/src/app/api/cron', (path) => path.endsWith('route.ts'));
  const offenders = cronRoutes.filter((path) => !readFileSync(path, 'utf8').includes('assertCronRequest(request)'));
  assert(offenders.length === 0, `Cron routes without assertCronRequest:\n${offenders.map((path) => relative(repoRoot, path)).join('\n')}`);
}

function checkPublicMutationRateLimits(): void {
  const required = [
    ['apps/web/src/app/api/v1/address/suggest/route.ts', "rateLimit: 'addressSuggest'"],
    ['apps/web/src/app/api/v1/address/retrieve/route.ts', "rateLimit: 'addressRetrieve'"],
    ['apps/web/src/app/api/v1/auth/otp/request/route.ts', "rateLimit: 'authOtpRequest'"],
    ['apps/web/src/app/api/v1/auth/otp/verify/route.ts', "rateLimit: 'authOtpVerify'"],
    ['apps/web/src/app/api/v1/bookings/route.ts', "rateLimit: 'booking'"],
    ['apps/web/src/app/api/v1/contact/route.ts', "rateLimit: 'contact'"],
    ['apps/web/src/app/api/v1/maps/static/route.ts', "rateLimit: 'mapStatic'"],
    ['apps/web/src/app/api/v1/quotes/[publicId]/manual-request/route.ts', "rateLimit: 'manualQuote'"],
    ['apps/web/src/app/manage/request-link/route.ts', "rateLimit: 'manageLink'"],
  ] as const;
  for (const [path, expected] of required) {
    assert(read(path).includes(expected), `${path} is missing ${expected}.`);
  }
  assert(read('apps/web/src/app/api/v1/quotes/route.ts').includes("enforceRateLimit(request, 'quote')"), 'quotes route is missing quote rate limit.');
}

function checkHeaders(): void {
  const config = read('apps/web/next.config.ts');
  for (const header of [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Permissions-Policy',
    'Content-Security-Policy',
  ]) {
    assert(config.includes(header), `next.config.ts is missing ${header}.`);
  }
  for (const directive of ['default-src', 'script-src', 'frame-src', 'connect-src', 'img-src', 'frame-ancestors']) {
    assert(config.includes(directive), `CSP is missing ${directive}.`);
  }
}

function checkNoSecretPrefixesInBuild(): void {
  const nextDir = 'apps/web/.next';
  const builtFiles = filesUnder(nextDir, (path) => /\.(?:html|js|json|map|txt)$/u.test(path));
  const secretPattern = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b|\bwhsec_[A-Za-z0-9]{8,}\b|\bsk\.[A-Za-z0-9._-]{20,}\b/u;
  const offenders: string[] = [];
  for (const path of builtFiles) {
    const content = readFileSync(path, 'utf8');
    if (secretPattern.test(content)) offenders.push(relative(repoRoot, path));
  }
  assert(offenders.length === 0, `Build output contains secret-looking values:\n${offenders.join('\n')}`);
}

function checkPinnedActions(): void {
  const workflowFiles = filesUnder('.github/workflows', (path) => path.endsWith('.yml') || path.endsWith('.yaml'));
  const offenders: string[] = [];
  for (const path of workflowFiles) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      const match = line.match(/uses:\s*([^@\s]+)@([^\s]+)/u);
      if (match && !/^[a-f0-9]{40}$/u.test(match[2] ?? '')) {
        offenders.push(`${relative(repoRoot, path)}:${String(index + 1)} ${line.trim()}`);
      }
    });
  }
  assert(offenders.length === 0, `GitHub Actions are not pinned to commit SHAs:\n${offenders.join('\n')}`);
}

async function checkAudit(): Promise<void> {
  const result = await commandJson(executable('npm'), ['audit', '--omit=dev', '--json']);
  const parsed = JSON.parse(result.stdout) as AuditReport;
  const disallowed = Object.entries(parsed.vulnerabilities ?? {})
    .filter(([, value]) => value?.severity === 'critical' || value?.severity === 'high')
    .map(([name]) => name)
    .filter((name) => !allowedHighAuditPackages.has(name));
  assert(disallowed.length === 0, `npm audit has unreviewed high/critical vulnerabilities:\n${disallowed.join('\n')}`);
}

const checks: readonly Check[] = [
  { name: 'explicit withApi auth', run: checkExplicitWithApiAuth },
  { name: 'cron secrets', run: checkCronSecrets },
  { name: 'public mutation rate limits', run: checkPublicMutationRateLimits },
  { name: 'security headers and CSP', run: checkHeaders },
  { name: 'client/server build secret scan', run: checkNoSecretPrefixesInBuild },
  { name: 'GitHub Actions SHA pins', run: checkPinnedActions },
  { name: 'npm audit reviewed exceptions', run: checkAudit },
];

for (const check of checks) {
  await check.run();
  process.stdout.write(`Security check passed: ${check.name}\n`);
}
