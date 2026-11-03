import 'server-only';

import { AppError } from '@sv/contracts';
import { couponCodeHash, prisma, type DbTx } from '@sv/db';

// One message for every rejection so a guess cannot tell an unknown code from a spent one.
const INVALID_MESSAGE = 'That code is not valid for this booking.';

export interface CouponPrice {
  couponId: string;
  listPricePence: number;
  totalPence: number;
}

function invalid(): AppError {
  return new AppError('VALIDATION_ERROR', INVALID_MESSAGE, { field: 'couponCode' });
}

/** Read-only check: the coupon is usable now and lowers this engine price. Nothing is reserved. */
export async function priceWithCoupon(code: string, listPricePence: number, now: Date): Promise<CouponPrice> {
  const coupon = await prisma.coupon.findUnique({
    where: { codeHash: couponCodeHash(code) },
    select: {
      disabledAt: true,
      expiresAt: true,
      fixedTotalPence: true,
      id: true,
      maxRedemptions: true,
      redemptionCount: true,
    },
  });
  if (
    // FIXED_TOTAL is the only CouponKind; a new kind must add its own pricing branch here.
    !coupon
    || coupon.disabledAt
    || coupon.expiresAt.getTime() <= now.getTime()
    || coupon.redemptionCount >= coupon.maxRedemptions
    // A coupon may only lower a price, never raise it.
    || coupon.fixedTotalPence >= listPricePence
  ) {
    throw invalid();
  }
  return { couponId: coupon.id, listPricePence, totalPence: coupon.fixedTotalPence };
}

/** Atomically claims one redemption inside the booking transaction; concurrent checkouts cannot both win. */
export async function reserveCoupon(tx: DbTx, couponId: string, now: Date): Promise<void> {
  const claimed = await tx.$executeRaw`
    UPDATE "Coupon"
    SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = ${now}
    WHERE "id" = ${couponId}
      AND "disabledAt" IS NULL
      AND "expiresAt" > ${now}
      AND "redemptionCount" < "maxRedemptions"`;
  if (claimed !== 1) throw invalid();
}

/** Returns an unpaid hold's redemption so the code can be used again. */
export async function releaseCoupon(tx: DbTx, couponId: string, now: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Coupon"
    SET "redemptionCount" = "redemptionCount" - 1, "updatedAt" = ${now}
    WHERE "id" = ${couponId} AND "redemptionCount" > 0`;
}
