-- Reversible list cleanup only: retain the booking and every related financial/history row.
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
