CREATE TABLE "BookingActivity" (
    "id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "service" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "quoteId" TEXT,
    "bookingId" TEXT,
    CONSTRAINT "BookingActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingActivity_stage_check" CHECK ("stage" IN ('SERVICE', 'MOVE', 'ITEMS', 'DATE', 'PAYMENT'))
);
CREATE UNIQUE INDEX "BookingActivity_quoteId_key" ON "BookingActivity"("quoteId");
CREATE UNIQUE INDEX "BookingActivity_bookingId_key" ON "BookingActivity"("bookingId");
CREATE INDEX "BookingActivity_lastSeenAt_id_idx" ON "BookingActivity"("lastSeenAt", "id");
ALTER TABLE "BookingActivity" ADD CONSTRAINT "BookingActivity_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingActivity" ADD CONSTRAINT "BookingActivity_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
