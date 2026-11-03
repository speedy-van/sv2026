-- Preserve legacy extra charges: only newly accepted admin edits set this flag.
ALTER TABLE "ExtraCharge"
ADD COLUMN "includedInBookingTotal" BOOLEAN NOT NULL DEFAULT false;
