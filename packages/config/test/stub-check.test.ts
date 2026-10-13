import { describe, expect, it } from 'vitest';
import { formatFindings, scanText } from '../../../scripts/stub-check';

describe('stub-check', () => {
  it('flags app fixture imports, empty handlers, descriptive UI strings and empty uploads', () => {
    const findings = scanText(
      'apps/admin/app/(app)/bookings/index.tsx',
      [
        "import { dashboardJobs } from '@/data/admin';",
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
