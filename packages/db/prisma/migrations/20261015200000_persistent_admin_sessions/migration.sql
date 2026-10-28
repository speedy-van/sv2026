-- Existing finite sessions keep their deadlines; new ADMIN sessions may be explicitly until-revoked.
ALTER TABLE "Session" ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastRefreshRequestId" UUID;
