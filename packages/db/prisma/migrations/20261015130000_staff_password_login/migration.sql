-- Additive: existing staff keep email OTP sign-in until a password is provisioned.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- Browser sessions must not be recorded as iOS devices.
ALTER TYPE "DevicePlatform" ADD VALUE IF NOT EXISTS 'WEB';
