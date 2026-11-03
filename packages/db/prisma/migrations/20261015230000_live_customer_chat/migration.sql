CREATE TABLE "ChatConversation" (
  "id" TEXT NOT NULL,
  "customerTokenHash" TEXT NOT NULL,
  "customerName" VARCHAR(80),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "customerReadSequence" BIGINT NOT NULL DEFAULT 0,
  "adminReadSequence" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_watermarks_nonnegative" CHECK ("customerReadSequence" >= 0 AND "adminReadSequence" >= 0)
);
CREATE TABLE "ChatMessage" (
  "sequence" BIGSERIAL NOT NULL,
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "clientMessageId" UUID NOT NULL,
  "sender" VARCHAR(8) NOT NULL,
  "senderUserId" TEXT,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "chat_sender_valid" CHECK (("sender" = 'CUSTOMER' AND "senderUserId" IS NULL) OR ("sender" = 'ADMIN' AND "senderUserId" IS NOT NULL)),
  CONSTRAINT "chat_body_nonempty" CHECK (length(btrim("body")) BETWEEN 1 AND 2000),
  CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatConversation_customerTokenHash_key" ON "ChatConversation"("customerTokenHash");
CREATE INDEX "ChatConversation_lastMessageAt_id_idx" ON "ChatConversation"("lastMessageAt", "id");
CREATE INDEX "ChatConversation_expiresAt_idx" ON "ChatConversation"("expiresAt");
CREATE UNIQUE INDEX "ChatMessage_id_key" ON "ChatMessage"("id");
CREATE UNIQUE INDEX "ChatMessage_conversationId_clientMessageId_key" ON "ChatMessage"("conversationId", "clientMessageId");
CREATE INDEX "ChatMessage_conversationId_sequence_idx" ON "ChatMessage"("conversationId", "sequence");
CREATE INDEX "ChatMessage_conversationId_sender_sequence_idx" ON "ChatMessage"("conversationId", "sender", "sequence");
