import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('.lighthouse-home.json', 'utf8')) as {
  categories?: {
    performance?: {
      score?: number | null;
    };
  };
};

const score = report.categories?.performance?.score;
if (typeof score !== 'number') {
  throw new Error('Lighthouse performance score is missing.');
}

const percentage = Math.round(score * 100);
if (percentage < 95) {
  throw new Error(`Lighthouse performance score ${String(percentage)} is below 95.`);
}

process.stdout.write(`Lighthouse performance score ${String(percentage)} passed.\n`);
