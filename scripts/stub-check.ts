import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StubFinding {
  file: string;
  line: number;
  message: string;
  rule: string;
}

const ignoredDirectories = new Set([
  '.expo',
  '.git',
  '.next',
  '.turbo',
  'android',
  'build',
  'coverage',
  'dist',
  'ios',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const scannedExtensions = new Set(['.cjs', '.js', '.json', '.jsx', '.mjs', '.ts', '.tsx']);

const descriptiveUiPhrases = [
  'are available from this',
  'This screen includes',
  'Ready for staff',
  'is stored as a compact',
] as const;

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function addFinding(findings: StubFinding[], file: string, index: number, text: string, rule: string, message: string): void {
  findings.push({ file, line: lineNumberAt(text, index), message, rule });
}

function isTestPath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/e2e/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.tsx')
  );
}

function hasScannedExtension(path: string): boolean {
  const normalized = normalizePath(path);
  const dot = normalized.lastIndexOf('.');
  if (dot < 0) return false;
  return scannedExtensions.has(normalized.slice(dot));
}

function collectFiles(root: string, relativePath = ''): string[] {
  const directory = resolve(root, relativePath);
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...collectFiles(root, relativePath ? `${relativePath}/${entry.name}` : entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const file = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (hasScannedExtension(file)) files.push(normalizePath(file));
  }
  return files;
}

function scanEmptyHandlers(file: string, text: string, findings: StubFinding[]): void {
  if (!file.startsWith('apps/') || isTestPath(file)) return;
  const emptyHandler =
    /\bon(?:Press|Click)\s*=\s*{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:undefined|void\s+0|\{\s*\})\s*}/g;
  for (const match of text.matchAll(emptyHandler)) {
    addFinding(findings, file, match.index, text, 'empty-handler', 'Interactive handler is empty or returns undefined.');
  }
}

function isFixtureDataModule(file: string, text: string): boolean {
  if (!file.startsWith('apps/') || isTestPath(file)) return false;
  if (!/^apps\/[^/]+\/src\/data\//.test(file)) return false;
  const exportedLiteral = /\bexport\s+const\s+[A-Za-z_$][\w$]*[^=]*=\s*(?:\[[\s\S]*?\]|\{[\s\S]*?\})\s*(?:as\s+const)?\s*;/g;
  const sampleRecord =
    /\b(?:bookingId|customer|name|reference|route|pricePence|amountPence|earningPence|paidPence|unpaidPence|totalPence|count|total)\s*:\s*(?:['"`]|\d)/;
  const samplePerson = /\b(?:Sarah|David|Jane|John|Alex|Demo|Example|Sample)\b|[A-Z][a-z]+ [A-Z]\./;
  const sampleMoneyOrCount = /\b(?:pricePence|amountPence|earningPence|paidPence|unpaidPence|totalPence|count|total)\s*:\s*\d/;
  for (const match of text.matchAll(exportedLiteral)) {
    const literal = match[0];
    if (sampleMoneyOrCount.test(literal) || (sampleRecord.test(literal) && samplePerson.test(literal))) {
      return true;
    }
  }
  return false;
}

function possibleModulePaths(file: string, source: string): string[] {
  const normalizedSource = normalizePath(source);
  const [appsDirectory, appName] = file.split('/');
  if (appsDirectory !== 'apps' || !appName) return [];
  const candidates: string[] = [];
  if (normalizedSource.startsWith('@/data/')) {
    candidates.push(`apps/${appName}/src/${normalizedSource.slice(2)}`);
  } else if (normalizedSource === '@/data') {
    candidates.push(`apps/${appName}/src/data`);
  } else if (normalizedSource.includes('/src/data/')) {
    const srcIndex = normalizedSource.indexOf('/src/data/');
    candidates.push(`apps/${appName}${normalizedSource.slice(srcIndex)}`);
  }
  return candidates.flatMap((candidate) => [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`]);
}

function scanFixtureImports(file: string, text: string, findings: StubFinding[], fixtureModules: ReadonlySet<string>, includeNamedFixtures: boolean): void {
  if (!file.startsWith('apps/') || isTestPath(file)) return;
  const fixtureImport = /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]*(?:@\/data|\/src\/data|fixtures?|fixture)[^'"]*)['"]/g;
  for (const match of text.matchAll(fixtureImport)) {
    const source = match[1] ?? '';
    const importsNamedFixture = /\bfixtures?\b|\bfixture\b/.test(source);
    const importsFixtureData = possibleModulePaths(file, source).some((candidate) => fixtureModules.has(candidate));
    if ((includeNamedFixtures && importsNamedFixture) || importsFixtureData) {
      addFinding(findings, file, match.index, text, 'fixture-import', `Screen imports fixture/data module ${source}.`);
    }
  }
}

function scanFixtureModule(file: string, text: string, findings: StubFinding[]): void {
  if (isFixtureDataModule(file, text)) {
    addFinding(findings, file, 0, text, 'fixture-module', 'App source data module exports hard-coded sample records for screens.');
  }
}

function scanAdminRoutes(file: string, text: string, findings: StubFinding[]): void {
  if (file !== 'apps/web/src/server/admin/routes.ts') return;
  if (!text.includes('function responseFor(match: RouteMatch): unknown')) return;
  if (!text.includes('return apiJson(responseFor(match)')) return;
  const routeDefinition = /{\s*action:\s*'([^']+)'/g;
  for (const match of text.matchAll(routeDefinition)) {
    const action = match[1];
    if (!action || action === 'admin.test_push') continue;
    addFinding(findings, file, match.index, text, 'admin-canned-route', `${action} falls through the generic canned admin response.`);
  }
}

function scanEmptyUploads(file: string, text: string, findings: StubFinding[]): void {
  if (isTestPath(file)) return;
  const emptyUpload = /\b(?:pngBase64|jpegBase64|jpgBase64|imageBase64|signatureBase64|photoBase64)\s*:\s*(['"])\1/g;
  for (const match of text.matchAll(emptyUpload)) {
    addFinding(findings, file, match.index, text, 'empty-upload-payload', 'Upload payload is empty.');
  }
}

function scanFallbackLocations(file: string, text: string, findings: StubFinding[]): void {
  if (!file.startsWith('docs/data/') && !file.startsWith('apps/web/src/content/')) return;
  const fallback = /"confidence"\s*:\s*"fallback"/g;
  for (const match of text.matchAll(fallback)) {
    addFinding(findings, file, match.index, text, 'fallback-location', 'Location data uses fallback coordinates.');
  }
}

function scanDescriptiveUiText(file: string, text: string, findings: StubFinding[]): void {
  if (!file.startsWith('apps/') || isTestPath(file)) return;
  for (const phrase of descriptiveUiPhrases) {
    let index = text.indexOf(phrase);
    while (index >= 0) {
      addFinding(findings, file, index, text, 'descriptive-ui-text', `UI describes placeholder functionality: "${phrase}".`);
      index = text.indexOf(phrase, index + phrase.length);
    }
  }
}

export function scanText(file: string, text: string): StubFinding[] {
  const normalized = normalizePath(file);
  const findings: StubFinding[] = [];
  scanEmptyHandlers(normalized, text, findings);
  scanFixtureModule(normalized, text, findings);
  scanFixtureImports(normalized, text, findings, new Set(), true);
  scanAdminRoutes(normalized, text, findings);
  scanEmptyUploads(normalized, text, findings);
  scanFallbackLocations(normalized, text, findings);
  scanDescriptiveUiText(normalized, text, findings);
  return findings;
}

export function scanRoot(root: string): StubFinding[] {
  const absoluteRoot = resolve(root);
  const candidateRoots = ['apps', 'docs/data', 'packages', 'scripts']
    .map((path) => resolve(absoluteRoot, path))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
  const texts = new Map<string, string>();
  for (const candidateRoot of candidateRoots) {
    for (const file of collectFiles(candidateRoot)) {
      const absoluteFile = resolve(candidateRoot, file);
      const repoRelative = normalizePath(relative(absoluteRoot, absoluteFile));
      texts.set(repoRelative, readFileSync(absoluteFile, 'utf8'));
    }
  }
  const fixtureModules = new Set<string>();
  for (const [file, text] of texts) {
    if (isFixtureDataModule(file, text)) fixtureModules.add(file);
  }
  const findings: StubFinding[] = [];
  for (const [file, text] of texts) {
    findings.push(...scanText(file, text));
    if (fixtureModules.size > 0) scanFixtureImports(file, text, findings, fixtureModules, false);
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
}

export function formatFindings(findings: readonly StubFinding[]): string {
  if (findings.length === 0) return 'stub:check passed. No placeholder shells found.';
  const lines = findings.map((finding) => `${finding.file}:${String(finding.line)} [${finding.rule}] ${finding.message}`);
  return `stub:check found ${String(findings.length)} issue(s):\n${lines.join('\n')}`;
}

function main(): void {
  const root = process.cwd();
  const findings = scanRoot(root);
  const output = `${formatFindings(findings)}\n`;
  if (findings.length > 0) {
    process.stderr.write(output);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
