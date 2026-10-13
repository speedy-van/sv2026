import { readFileSync } from 'node:fs';

interface LighthouseReport {
  categories?: Record<string, { score?: number | null } | undefined>;
}

const reports = [
  { name: '/', path: '.lighthouse-home.json' },
  { name: '/services/house-removals', path: '.lighthouse-service.json' },
] as const;

const thresholds = {
  accessibility: 100,
  'best-practices': 95,
  performance: 95,
  seo: 100,
} as const;

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
}
