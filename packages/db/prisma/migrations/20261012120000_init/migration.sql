CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DRIVER');

CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

CREATE TYPE "AppKind" AS ENUM ('ADMIN', 'DRIVER');

CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TYPE "Slot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE TYPE "DispatchStatus" AS ENUM ('UNASSIGNED', 'OFFERED', 'ACCEPTED');

CREATE TYPE "JobStage" AS ENUM ('NOT_STARTED', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'LOADING', 'EN_ROUTE_TO_DROPOFF', 'AT_DROPOFF', 'UNLOADING', 'COMPLETED');

CREATE TYPE "BookingSource" AS ENUM ('WEB', 'ADMIN_PHONE', 'MANUAL_QUOTE');

CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

CREATE TYPE "AssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

CREATE TYPE "PaymentKind" AS ENUM ('BOOKING', 'RESCHEDULE_DIFFERENCE', 'EXTRA_CHARGE', 'MANUAL_QUOTE', 'ADMIN_BOOKING');

CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'OFFLINE');

CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');

CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

CREATE TYPE "ExtraChargeStatus" AS ENUM ('REQUESTED', 'AWAITING_PAYMENT', 'PAID', 'REJECTED', 'CANCELED');

CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED');

CREATE TYPE "ManualQuoteStatus" AS ENUM ('REQUESTED', 'PRICED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

CREATE TYPE "PricingVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN');

CREATE TYPE "PhotoKind" AS ENUM ('BEFORE', 'AFTER', 'DAMAGE', 'EXTRA');

CREATE TYPE "PayoutMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'OTHER');

CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'HANDLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "role" "Role" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastLoginAt" TIMESTAMPTZ(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_email_key" UNIQUE ("email")
);

CREATE INDEX "User_role_status_idx" ON "User" ("role", "status");

CREATE TABLE "AuthOtp" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "app" "AppKind" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMPTZ(3),
  "ipHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthOtp_email_app_createdAt_idx" ON "AuthOtp" ("email", "app", "createdAt");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "app" "AppKind" NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "previousRefreshTokenHash" TEXT,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT,
  "platform" "DevicePlatform" NOT NULL,
  "appVersion" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedReason" TEXT,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_refreshTokenHash_key" UNIQUE ("refreshTokenHash"),
  CONSTRAINT "Session_previousRefreshTokenHash_key" UNIQUE ("previousRefreshTokenHash")
);

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session" ("userId", "revokedAt");

CREATE TABLE "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "app" "AppKind" NOT NULL,
  "platform" "DevicePlatform" NOT NULL,
  "expoPushToken" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRegisteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushDevice_expoPushToken_key" UNIQUE ("expoPushToken")
);

CREATE INDEX "PushDevice_userId_app_enabled_idx" ON "PushDevice" ("userId", "app", "enabled");

CREATE TABLE "PushTicket" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "pushDeviceId" TEXT NOT NULL,
  "outboxEventId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt" TIMESTAMPTZ(3),
  "status" TEXT,
  "error" TEXT,
  CONSTRAINT "PushTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushTicket_ticketId_key" UNIQUE ("ticketId")
);

CREATE INDEX "PushTicket_checkedAt_createdAt_idx" ON "PushTicket" ("checkedAt", "createdAt");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification" ("userId", "createdAt");

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification" ("userId", "readAt");

CREATE TABLE "DriverProfile" (
  "userId" TEXT NOT NULL,
  "licenceExpiry" DATE,
  "rightToWorkAt" TIMESTAMPTZ(3),
  "payoutPercent" INTEGER NOT NULL DEFAULT 0,
  "defaultVanId" TEXT,
  "homePostcode" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "Van" (
  "id" TEXT NOT NULL,
  "registration" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sizeClass" TEXT NOT NULL,
  "motExpiry" DATE,
  "insuranceExpiry" DATE,
  "taxExpiry" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Van_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Van_registration_key" UNIQUE ("registration")
);

CREATE TABLE "DriverUnavailability" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "slot" "Slot" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverUnavailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverUnavailability_driverId_date_slot_key" UNIQUE ("driverId", "date", "slot")
);

CREATE TABLE "DriverLocation" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "bookingId" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "accuracyM" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "speedMps" DOUBLE PRECISION,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverLocation_bookingId_recordedAt_idx" ON "DriverLocation" ("bookingId", "recordedAt");

CREATE INDEX "DriverLocation_driverId_recordedAt_idx" ON "DriverLocation" ("driverId", "recordedAt");

CREATE TABLE "DriverEarning" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "basis" TEXT NOT NULL,
  "payoutId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverEarning_bookingId_key" UNIQUE ("bookingId")
);

CREATE INDEX "DriverEarning_driverId_createdAt_idx" ON "DriverEarning" ("driverId", "createdAt");

CREATE TABLE "Payout" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "reference" TEXT,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payout_driverId_paidAt_idx" ON "Payout" ("driverId", "paidAt");

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
  "marketingOptInAt" TIMESTAMPTZ(3),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "anonymisedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Customer_email_key" UNIQUE ("email")
);

CREATE TABLE "PricingConfigVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PricingVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "config" JSONB NOT NULL,
  "notes" TEXT,
  "approvedByOwner" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMPTZ(3),
  "publishedById" TEXT,
  CONSTRAINT "PricingConfigVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PricingConfigVersion_version_key" UNIQUE ("version")
);

CREATE TABLE "Quote" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "service" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "accessDetail" JSONB NOT NULL,
  "pickup" JSONB NOT NULL,
  "dropoff" JSONB,
  "distanceMiles" DOUBLE PRECISION NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "routeGeometry" TEXT,
  "requiresManualQuote" BOOLEAN NOT NULL DEFAULT false,
  "capacityUnits" INTEGER NOT NULL DEFAULT 1,
  "blocksSlots" INTEGER NOT NULL DEFAULT 1,
  "manualReasons" TEXT[] NOT NULL,
  "pricingVersionId" TEXT NOT NULL,
  "staticSubtotalPence" INTEGER NOT NULL,
  "breakdown" JSONB NOT NULL,
  "calendar" JSONB NOT NULL,
  "today" DATE NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "customerId" TEXT,
  "attribution" JSONB,
  "ipHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Quote_publicId_key" UNIQUE ("publicId")
);

CREATE INDEX "Quote_createdAt_idx" ON "Quote" ("createdAt");

CREATE INDEX "Quote_status_expiresAt_idx" ON "Quote" ("status", "expiresAt");

CREATE TABLE "Booking" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "dispatchStatus" "DispatchStatus" NOT NULL DEFAULT 'UNASSIGNED',
  "jobStage" "JobStage" NOT NULL DEFAULT 'NOT_STARTED',
  "source" "BookingSource" NOT NULL DEFAULT 'WEB',
  "customerId" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "quoteId" TEXT,
  "service" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "pickup" JSONB NOT NULL,
  "dropoff" JSONB,
  "pickupPostcode" TEXT NOT NULL,
  "dropoffPostcode" TEXT,
  "distanceMiles" DOUBLE PRECISION NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "routeGeometry" TEXT,
  "pricingInput" JSONB NOT NULL,
  "accessDetail" JSONB NOT NULL,
  "priceBreakdown" JSONB NOT NULL,
  "pricingVersionId" TEXT NOT NULL,
  "moveDate" DATE NOT NULL,
  "slot" "Slot" NOT NULL,
  "totalPence" INTEGER NOT NULL,
  "paidPence" INTEGER NOT NULL DEFAULT 0,
  "refundedPence" INTEGER NOT NULL DEFAULT 0,
  "holdExpiresAt" TIMESTAMPTZ(3),
  "capacityUnits" INTEGER NOT NULL DEFAULT 1,
  "blocksSlots" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT,
  "customerNotes" TEXT,
  "adminNotes" TEXT,
  "driverId" TEXT,
  "vanId" TEXT,
  "attribution" JSONB,
  "termsAcceptedAt" TIMESTAMPTZ(3),
  "startWithinCancellationAck" TIMESTAMPTZ(3),
  "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
  "reminderSentAt" TIMESTAMPTZ(3),
  "reviewRequestedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledBy" "CancelledBy",
  "cancelReason" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Booking_reference_key" UNIQUE ("reference"),
  CONSTRAINT "Booking_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX "Booking_moveDate_slot_status_idx" ON "Booking" ("moveDate", "slot", "status");

CREATE INDEX "Booking_status_createdAt_idx" ON "Booking" ("status", "createdAt");

CREATE INDEX "Booking_customerId_idx" ON "Booking" ("customerId");

CREATE INDEX "Booking_driverId_moveDate_idx" ON "Booking" ("driverId", "moveDate");

CREATE INDEX "Booking_pickupPostcode_idx" ON "Booking" ("pickupPostcode");

CREATE INDEX "Booking_holdExpiresAt_idx" ON "Booking" ("holdExpiresAt");

CREATE TABLE "ManualQuote" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "status" "ManualQuoteStatus" NOT NULL DEFAULT 'REQUESTED',
  "reasons" TEXT[] NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "preferredDate" DATE,
  "preferredSlot" "Slot",
  "details" TEXT,
  "pricePence" INTEGER,
  "adminMessage" TEXT,
  "pricedById" TEXT,
  "pricedAt" TIMESTAMPTZ(3),
  "validUntil" TIMESTAMPTZ(3),
  "bookingId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ManualQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualQuote_quoteId_key" UNIQUE ("quoteId"),
  CONSTRAINT "ManualQuote_bookingId_key" UNIQUE ("bookingId")
);

CREATE INDEX "ManualQuote_status_createdAt_idx" ON "ManualQuote" ("status", "createdAt");

CREATE TABLE "CapacityRule" (
  "id" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "slot" "Slot" NOT NULL,
  "capacity" INTEGER NOT NULL,
  CONSTRAINT "CapacityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CapacityRule_weekday_slot_key" UNIQUE ("weekday", "slot")
);

CREATE TABLE "CapacityOverride" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "slot" "Slot" NOT NULL,
  "capacity" INTEGER NOT NULL,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapacityOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CapacityOverride_date_slot_key" UNIQUE ("date", "slot")
);

CREATE TABLE "SlotHold" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "slot" "Slot" NOT NULL,
  "capacityUnits" INTEGER NOT NULL DEFAULT 1,
  "blocksSlots" INTEGER NOT NULL DEFAULT 1,
  "bookingId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "paymentId" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlotHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SlotHold_paymentId_key" UNIQUE ("paymentId")
);

CREATE INDEX "SlotHold_date_slot_expiresAt_idx" ON "SlotHold" ("date", "slot", "expiresAt");

CREATE TABLE "Assignment" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" "AssignmentStatus" NOT NULL DEFAULT 'OFFERED',
  "offeredById" TEXT NOT NULL,
  "offeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "declineReason" TEXT,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Assignment_driverId_status_idx" ON "Assignment" ("driverId", "status");

CREATE INDEX "Assignment_bookingId_status_idx" ON "Assignment" ("bookingId", "status");

CREATE TABLE "JobEvent" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fromStage" "JobStage",
  "toStage" "JobStage",
  "actorUserId" TEXT,
  "clientEventId" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "payload" JSONB,
  CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobEvent_clientEventId_key" UNIQUE ("clientEventId")
);

CREATE INDEX "JobEvent_bookingId_occurredAt_idx" ON "JobEvent" ("bookingId", "occurredAt");

CREATE TABLE "JobPhoto" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "kind" "PhotoKind" NOT NULL,
  "blobKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "clientId" TEXT,
  "takenAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPhoto_clientId_key" UNIQUE ("clientId")
);

CREATE INDEX "JobPhoto_bookingId_kind_idx" ON "JobPhoto" ("bookingId", "kind");

CREATE TABLE "Signature" (
  "bookingId" TEXT NOT NULL,
  "blobKey" TEXT NOT NULL,
  "signedName" TEXT NOT NULL,
  "signedAt" TIMESTAMPTZ(3) NOT NULL,
  "capturedById" TEXT NOT NULL,
  CONSTRAINT "Signature_pkey" PRIMARY KEY ("bookingId")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "kind" "PaymentKind" NOT NULL,
  "method" "PaymentMethod" NOT NULL DEFAULT 'STRIPE',
  "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
  "amountPence" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'gbp',
  "stripePaymentIntentId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "stripeChargeId" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "offlineReference" TEXT,
  "recordedById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_stripePaymentIntentId_key" UNIQUE ("stripePaymentIntentId"),
  CONSTRAINT "Payment_stripeCheckoutSessionId_key" UNIQUE ("stripeCheckoutSessionId")
);

CREATE INDEX "Payment_bookingId_kind_idx" ON "Payment" ("bookingId", "kind");

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "stripeRefundId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_stripeRefundId_key" UNIQUE ("stripeRefundId")
);

CREATE INDEX "Refund_paymentId_idx" ON "Refund" ("paymentId");

CREATE TABLE "ExtraCharge" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "status" "ExtraChargeStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById" TEXT NOT NULL,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMPTZ(3),
  "paymentId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ExtraCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExtraCharge_paymentId_key" UNIQUE ("paymentId")
);

CREATE INDEX "ExtraCharge_bookingId_status_idx" ON "ExtraCharge" ("bookingId", "status");

CREATE TABLE "StripeEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  "error" TEXT,
  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Item" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "volumeM3" DOUBLE PRECISION NOT NULL,
  "aliases" TEXT[] NOT NULL,
  "popular" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Item_slug_key" UNIQUE ("slug")
);

CREATE INDEX "Item_category_sortOrder_idx" ON "Item" ("category", "sortOrder");

CREATE TABLE "ItemPreset" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ItemPreset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ItemPreset_slug_key" UNIQUE ("slug")
);

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "displayName" TEXT NOT NULL,
  "town" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "moderatedById" TEXT,
  "moderatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Review_bookingId_key" UNIQUE ("bookingId")
);

CREATE INDEX "Review_status_createdAt_idx" ON "Review" ("status", "createdAt");

CREATE TABLE "LocationContent" (
  "slug" TEXT NOT NULL,
  "localNotes" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LocationContent_pkey" PRIMARY KEY ("slug")
);

CREATE TABLE "Faq" (
  "id" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMessage" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "message" TEXT NOT NULL,
  "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
  "handledById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage" ("status", "createdAt");

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxEvent_dedupeKey_key" UNIQUE ("dedupeKey")
);

CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent" ("status", "nextAttemptAt");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "requestId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog" ("entityType", "entityId", "createdAt");

CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog" ("actorUserId", "createdAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PushTicket" ADD CONSTRAINT "PushTicket_pushDeviceId_fkey" FOREIGN KEY ("pushDeviceId") REFERENCES "PushDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_defaultVanId_fkey" FOREIGN KEY ("defaultVanId") REFERENCES "Van"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverUnavailability" ADD CONSTRAINT "DriverUnavailability_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualQuote" ADD CONSTRAINT "ManualQuote_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualQuote" ADD CONSTRAINT "ManualQuote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPhoto" ADD CONSTRAINT "JobPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Signature" ADD CONSTRAINT "Signature_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- exactly one ACTIVE pricing version
CREATE UNIQUE INDEX "one_active_pricing_version" ON "PricingConfigVersion" ("status") WHERE "status" = 'ACTIVE';

-- money and counts can't go negative
ALTER TABLE "Booking" ADD CONSTRAINT "booking_money_nonneg" CHECK ("totalPence" >= 0 AND "paidPence" >= 0 AND "refundedPence" >= 0 AND "refundedPence" <= "paidPence");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "refund_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "extra_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "CapacityRule" ADD CONSTRAINT "capacity_rule_valid" CHECK ("weekday" BETWEEN 0 AND 6 AND "capacity" >= 0);
ALTER TABLE "CapacityOverride" ADD CONSTRAINT "capacity_override_valid" CHECK ("capacity" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "DriverProfile" ADD CONSTRAINT "payout_percent_range" CHECK ("payoutPercent" BETWEEN 0 AND 100);
ALTER TABLE "Payment" ADD CONSTRAINT "offline_needs_reference" CHECK ("method" <> 'OFFLINE' OR ("offlineReference" IS NOT NULL AND "recordedById" IS NOT NULL));

-- case-insensitive search helpers for admin
CREATE INDEX "booking_contact_email_lower" ON "Booking" (lower("contactEmail"));
CREATE INDEX "customer_name_lower" ON "Customer" (lower("name"));


