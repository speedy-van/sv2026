// Owner tool for one-time checkout coupons. The plain code is printed once and never stored.
//   npm run db:coupon -w @sv/db -- create --total-pence 100 --expires-hours 48 --note "Ads conversion test"
//   npm run db:coupon -w @sv/db -- status --code SV-XXXX-XXXX-XXXX-XXXX
//   npm run db:coupon -w @sv/db -- disable --code SV-XXXX-XXXX-XXXX-XXXX
import { prisma } from './client';
import { couponCodeHash, generateCouponCode } from './coupon';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInt(value: string | undefined, name: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`--${name} must be a whole number of at least ${String(min)}.`);
  return parsed;
}

function requiredCode(args: string[]): string {
  const code = flag(args, 'code');
  if (!code) throw new Error('--code is required.');
  return code;
}

async function create(args: string[]): Promise<void> {
  const fixedTotalPence = positiveInt(flag(args, 'total-pence'), 'total-pence', 30);
  const hours = positiveInt(flag(args, 'expires-hours'), 'expires-hours', 1);
  const code = generateCouponCode();
  const coupon = await prisma.coupon.create({
    data: {
      codeHash: couponCodeHash(code),
      expiresAt: new Date(Date.now() + hours * 3_600_000),
      fixedTotalPence,
      maxRedemptions: 1,
      note: flag(args, 'note') ?? null,
    },
    select: { expiresAt: true, fixedTotalPence: true, id: true },
  });
  process.stdout.write(`${JSON.stringify({ code, ...coupon, expiresAt: coupon.expiresAt.toISOString() }, null, 2)}\n`);
}

async function status(args: string[]): Promise<void> {
  const coupon = await prisma.coupon.findUnique({
    where: { codeHash: couponCodeHash(requiredCode(args)) },
    select: {
      bookings: { select: { reference: true, status: true, totalPence: true } },
      disabledAt: true,
      expiresAt: true,
      fixedTotalPence: true,
      id: true,
      maxRedemptions: true,
      redemptionCount: true,
    },
  });
  if (!coupon) throw new Error('No coupon matches that code.');
  process.stdout.write(`${JSON.stringify(coupon, null, 2)}\n`);
}

async function disable(args: string[]): Promise<void> {
  const result = await prisma.coupon.updateMany({
    data: { disabledAt: new Date() },
    where: { codeHash: couponCodeHash(requiredCode(args)), disabledAt: null },
  });
  if (result.count === 0) throw new Error('No active coupon matches that code.');
  process.stdout.write('Coupon disabled.\n');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') await create(args);
  else if (command === 'status') await status(args);
  else if (command === 'disable') await disable(args);
  else throw new Error('Usage: coupon-cli <create|status|disable> [options]');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
