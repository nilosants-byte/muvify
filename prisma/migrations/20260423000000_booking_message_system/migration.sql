-- AlterTable: make senderId optional and add isSystem flag to BookingMessage
ALTER TABLE "BookingMessage" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BookingMessage" ALTER COLUMN "senderId" DROP NOT NULL;
