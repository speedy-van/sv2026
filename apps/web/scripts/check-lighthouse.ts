import { readFileSync } from 'node:fs';

interface LighthouseReport {
  audits?: Record<string, {
    details?: {
      items?: Array<Record<string, unknown>>;
    };
    score?: number | null;
  } | undefined>;
  categories?: Record<string, { score?: number | null } | undefined>;
}

const reports = [
  { jsBudgetBytes: 170_000, name: '/', path: '.lighthouse-home.json' },
  { name: '/services/house-removals', path: '.lighthouse-service.json' },
  { name: '/removals/paisley', path: '.lighthouse-location.json' },
  { name: '/removals/glasgow-to-edinburgh', path: '.lighthouse-route.json' },
] as const;

const thresholds = {
  accessibility: 100,
  'best-practices': 95,
  performance: 95,
  seo: 100,
} as const;

function resourceTransfer(report: LighthouseReport, resourceType?: string): number {
  const items = report.audits?.['resource-summary']?.details?.items ?? [];
  if (!resourceType) {
    const total = items.find((item) => item.resourceType === 'total')?.transferSize;
    return typeof total === 'number' ? total : 0;
  }
  return items.reduce((total, item) => {
    const label = item.resourceType;
    const transferSize = item.transferSize;
    if (label !== resourceType) return total;
    return typeof transferSize === 'number' ? total + transferSize : total;
  }, 0);
}

for (const reportInfo of reports) {
  const report = JSON.parse(readFileSync(reportInfo.path, 'utf8')) as LighthouseReport;
  for (const [category, threshold] of Object.entries(thresholds)) {
    const score = report.categories?.[category]?.score;
    if (typeof score !== 'number') {
      throw new Error(`${reportInfo.name} Lighthouse ${category} score is missing.`);
    }
    const percentage = Math.round(score * 100);
    if (percentage < threshold) {
      throw new Error(`${reportInfo.name} Lighthouse ${category} score ${String(percentage)} is below ${String(threshold)}.`);
    }
    process.stdout.write(`${reportInfo.name} Lighthouse ${category} score ${String(percentage)} passed.\n`);
  }

  const totalTransferBytes = resourceTransfer(report);
  if (totalTransferBytes > 500_000) {
    throw new Error(`${reportInfo.name} Lighthouse total transfer ${String(totalTransferBytes)} bytes exceeds 500000.`);
  }
  process.stdout.write(`${reportInfo.name} Lighthouse total transfer ${String(totalTransferBytes)} bytes passed.\n`);

  if ('jsBudgetBytes' in reportInfo) {
    const scriptTransferBytes = resourceTransfer(report, 'script');
    if (scriptTransferBytes > reportInfo.jsBudgetBytes) {
      throw new Error(`${reportInfo.name} Lighthouse JS transfer ${String(scriptTransferBytes)} bytes exceeds ${String(reportInfo.jsBudgetBytes)}.`);
    }
    process.stdout.write(`${reportInfo.name} Lighthouse JS transfer ${String(scriptTransferBytes)} bytes passed.\n`);
  }

  const renderBlocking = report.audits?.['render-blocking-resources']?.score;
  if (typeof renderBlocking === 'number' && renderBlocking < 1) {
    throw new Error(`${reportInfo.name} has render-blocking resources.`);
  }
}
