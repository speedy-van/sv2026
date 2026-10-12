type CheckResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
};

const pendingChecks: readonly CheckResult[] = [
  {
    name: 'FACTS completeness',
    passed: false,
    message: 'Phase 4 adds Setting seed validation and TODO(owner) checks from docs/FACTS.md.',
  },
  {
    name: 'Environment completeness',
    passed: false,
    message: 'Phase 5 adds zod-backed env validation for the web runtime and build.',
  },
  {
    name: 'Pricing approval',
    passed: false,
    message: 'Phase 13 adds Admin pricing approval before launch.',
  },
  {
    name: 'Legal page approval',
    passed: false,
    message: 'Phase 17 requires solicitor-approved legal drafts.',
  },
  {
    name: 'Apple Pay domain',
    passed: false,
    message: 'Phase 17 verifies the live Stripe Apple Pay domain.',
  },
];

const failedChecks = pendingChecks.filter((check) => !check.passed);

if (failedChecks.length > 0) {
  const details = failedChecks.map((check) => `- ${check.name}: ${check.message}`).join('\n');
  process.stderr.write(`Launch checks are not ready:\n${details}\n`);
  process.exit(1);
}

process.stdout.write('Launch checks passed.\n');
