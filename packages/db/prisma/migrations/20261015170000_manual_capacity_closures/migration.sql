-- Manual closures do not replace or destroy existing numeric capacity configuration.
CREATE TABLE "CapacityClosure" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "slot" "Slot" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapacityClosure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CapacityClosure_date_slot_key" ON "CapacityClosure"("date", "slot");
