-- Add reminder tracking fields to Booking for session reminder push notifications
ALTER TABLE "Booking" ADD COLUMN "reminder60SentAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "reminder30SentAt" TIMESTAMP(3);

-- Add expiry reminder tracking fields to ConsultancyContract
ALTER TABLE "ConsultancyContract" ADD COLUMN "expiry7dSentAt" TIMESTAMP(3);
ALTER TABLE "ConsultancyContract" ADD COLUMN "expiry1dSentAt" TIMESTAMP(3);
ALTER TABLE "ConsultancyContract" ADD COLUMN "expiryNoticeSentAt" TIMESTAMP(3);
