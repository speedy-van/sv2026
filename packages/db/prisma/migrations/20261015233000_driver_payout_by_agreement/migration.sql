-- Drivers can be paid by a separate phone agreement without an invented percentage.
-- Preserve every existing value, earning and payout. The existing range check also accepts NULL.
ALTER TABLE "DriverProfile"
  ALTER COLUMN "payoutPercent" DROP NOT NULL,
  ALTER COLUMN "payoutPercent" DROP DEFAULT;
