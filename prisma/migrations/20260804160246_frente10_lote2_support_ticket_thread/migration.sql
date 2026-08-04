-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "parentTicketId" TEXT;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

