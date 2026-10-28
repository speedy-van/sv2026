-- Consent-gated, short-lived presence only; no page, IP, referrer or contact information.
CREATE TABLE "WebsiteVisitorPresence" (
  "id" UUID NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsiteVisitorPresence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebsiteVisitorPresence_lastSeenAt_idx" ON "WebsiteVisitorPresence"("lastSeenAt");
