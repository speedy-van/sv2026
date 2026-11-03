-- One-time checkout coupons. Additive only: no existing booking, price or payment changes.
-- Only a SHA-256 hash of the normalised code is stored; the plain code is shown once at creation.
CREATE TYPE "CouponKind" AS ENUM ('FIXED_TOTAL');

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "kind" "CouponKind" NOT NULL DEFAULT 'FIXED_TOTAL',
  "fixedTotalPence" INTEGER NOT NULL,
  "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id"),
  -- Stripe's GBP minimum charge is 30p.
  CONSTRAINT "coupon_fixed_total_min" CHECK ("fixedTotalPence" >= 30),
  CONSTRAINT "coupon_redemptions_valid" CHECK ("maxRedemptions" >= 1 AND "redemptionCount" >= 0 AND "redemptionCount" <= "maxRedemptions")
);
CREATE UNIQUE INDEX "Coupon_codeHash_key" ON "Coupon"("codeHash");
CREATE INDEX "Coupon_expiresAt_idx" ON "Coupon"("expiresAt");

ALTER TABLE "Booking" ADD COLUMN "couponId" TEXT;
CREATE INDEX "Booking_couponId_idx" ON "Booking"("couponId");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
