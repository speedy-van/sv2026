import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatFindings, scanRoot, scanText } from '../../../scripts/stub-check';

describe('stub-check', () => {
  it('flags fixture-named imports, empty handlers, descriptive UI strings and empty uploads', () => {
    const findings = scanText(
      'apps/admin/app/(app)/bookings/index.tsx',
      [
        "import { dashboardJobs } from '@/fixtures/admin';",
        'export function Screen() {',
        "  return <Button onPress={() => undefined}>Save</Button>;",
        "  const text = 'Ready for staff entry and validation.';",
        "  const upload = { pngBase64: '' };",
        '}',
      ].join('\n'),
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      'empty-handler',
      'fixture-import',
      'empty-upload-payload',
      'descriptive-ui-text',
    ]);
  });

  it('flags app data modules that export hard-coded sample records for screens', () => {
    const findings = scanText(
      'apps/admin/src/data/admin.ts',
      [
        'export const dashboardJobs = [',
        "  { bookingId: 'booking_glasgow', customer: 'Sarah M.', pricePence: 15890, reference: 'SV-8K2Q4P' },",
        '] as const;',
      ].join('\n'),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('fixture-module');
  });

  it('flags imports only when the app data module contains fixture records', () => {
    const root = mkdtempSync(join(tmpdir(), 'sv-stub-check-'));
    try {
      mkdirSync(join(root, 'apps/admin/src/data'), { recursive: true });
      mkdirSync(join(root, 'apps/admin/app/(app)/today'), { recursive: true });
      mkdirSync(join(root, 'apps/driver/src/data'), { recursive: true });
      mkdirSync(join(root, 'apps/driver/app/(app)'), { recursive: true });
      mkdirSync(join(root, 'docs/data'), { recursive: true });
      writeFileSync(
        join(root, 'apps/admin/src/data/admin.ts'),
        [
          'export const dashboardJobs = [',
          "  { bookingId: 'booking_glasgow', customer: 'Sarah M.', pricePence: 15890, reference: 'SV-8K2Q4P' },",
          '] as const;',
        ].join('\n'),
      );
      writeFileSync(join(root, 'apps/admin/app/(app)/today/page.tsx'), "import { dashboardJobs } from '@/data/admin';\nexport const jobs = dashboardJobs;\n");
      writeFileSync(
        join(root, 'apps/driver/src/data/driver.ts'),
        [
          "import type { SpeedyVanApiClient } from '@sv/api-client';",
          'import { z } from \'zod\';',
          'const JobListSchema = z.object({ items: z.array(z.object({ earningPence: z.number().int() })) });',
          "export function listJobs(api: SpeedyVanApiClient) { return api.request('/api/v1/driver/jobs', { schema: JobListSchema }); }",
        ].join('\n'),
      );
      writeFileSync(join(root, 'apps/driver/app/(app)/today.tsx'), "import { listJobs } from '@/data/driver';\nexport const load = listJobs;\n");

      const findings = scanRoot(root);
      expect(findings.map((finding) => `${finding.file}:${finding.rule}`)).toEqual([
        'apps/admin/app/(app)/today/page.tsx:fixture-import',
        'apps/admin/src/data/admin.ts:fixture-module',
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('flags generic admin route definitions but ignores the real test-push handler exception', () => {
    const findings = scanText(
      'apps/web/src/server/admin/routes.ts',
      [
        'export const ADMIN_ROUTE_DEFINITIONS = [',
        "  { action: 'admin.dashboard.view', pattern: 'dashboard', response: 'summary' },",
        "  { action: 'admin.test_push', pattern: 'test-push', response: 'ok' },",
        '] as const;',
        'function responseFor(match: RouteMatch): unknown { return match; }',
        'return apiJson(responseFor(match), { status: 200 }, requestId);',
      ].join('\n'),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('admin-canned-route');
    expect(findings[0]?.message).toContain('admin.dashboard.view');
  });

  it('formats an empty result as a passing summary', () => {
    expect(formatFindings([])).toBe('stub:check passed. No placeholder shells found.');
  });
});
