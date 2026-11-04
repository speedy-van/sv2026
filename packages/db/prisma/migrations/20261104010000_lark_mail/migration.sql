-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailFolder" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "lastUid" BIGINT NOT NULL DEFAULT 0,
    "oldestUid" BIGINT NOT NULL DEFAULT 0,
    "uidNext" BIGINT NOT NULL DEFAULT 1,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "hasMore" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,

    CONSTRAINT "MailFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "uid" BIGINT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" JSONB NOT NULL,
    "fromAddresses" JSONB NOT NULL,
    "toAddresses" JSONB NOT NULL,
    "ccAddresses" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "seen" BOOLEAN NOT NULL,
    "size" INTEGER NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "snippet" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDelivery" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "outboxEventId" TEXT,
    "mailbox" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "rawMime" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "smtpResponseCode" INTEGER,
    "nextAttemptAt" TIMESTAMP(3),
    "sendingStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentCopySaved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "providerCode" INTEGER,

    CONSTRAINT "MailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailQuotaDay" (
    "id" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailQuotaDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailQuotaRecipient" (
    "scope" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "MailQuotaRecipient_pkey" PRIMARY KEY ("scope","day","hash")
);

-- CreateTable
CREATE TABLE "MailLease" (
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailLease_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MailRateWindow" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MailRateWindow_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailFolder_mailbox_folder_key" ON "MailFolder"("mailbox", "folder");

-- CreateIndex
CREATE INDEX "MailMessage_mailbox_folder_sentAt_id_idx" ON "MailMessage"("mailbox", "folder", "sentAt", "id");

-- CreateIndex
CREATE INDEX "MailMessage_mailbox_threadId_sentAt_idx" ON "MailMessage"("mailbox", "threadId", "sentAt");

-- CreateIndex
CREATE INDEX "MailMessage_mailbox_messageId_idx" ON "MailMessage"("mailbox", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_mailbox_folder_uidValidity_uid_key" ON "MailMessage"("mailbox", "folder", "uidValidity", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "MailDelivery_key_key" ON "MailDelivery"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MailDelivery_outboxEventId_key" ON "MailDelivery"("outboxEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MailDelivery_messageId_key" ON "MailDelivery"("messageId");

-- CreateIndex
CREATE INDEX "MailDelivery_mailbox_status_createdAt_idx" ON "MailDelivery"("mailbox", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MailDeliveryAttempt_deliveryId_startedAt_idx" ON "MailDeliveryAttempt"("deliveryId", "startedAt");

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDeliveryAttempt" ADD CONSTRAINT "MailDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "MailDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IMAP UIDs are unsigned 32-bit values; PostgreSQL INTEGER is insufficient.
ALTER TABLE "MailFolder" ADD CONSTRAINT "MailFolder_cursor_bounds" CHECK (
  "lastUid" BETWEEN 0 AND 4294967295 AND "oldestUid" BETWEEN 0 AND 4294967295
  AND "uidNext" BETWEEN 1 AND 4294967295 AND "unreadCount" >= 0
  AND "folder" IN ('inbox', 'sent') AND "uidValidity" ~ '^[0-9]+$');
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_uid_bounds" CHECK (
  "uid" BETWEEN 1 AND 4294967295 AND "size" >= 0 AND "attachmentCount" >= 0
  AND "folder" IN ('inbox', 'sent') AND "uidValidity" ~ '^[0-9]+$');
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_state" CHECK (
  "status" IN ('QUEUED', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'UNCERTAIN', 'DEFERRED')
  AND "attempts" >= 0 AND octet_length("rawMime") <= 2097152);
ALTER TABLE "MailQuotaDay" ADD CONSTRAINT "MailQuotaDay_nonnegative" CHECK ("messages" >= 0);
ALTER TABLE "MailRateWindow" ADD CONSTRAINT "MailRateWindow_positive" CHECK ("count" > 0);

