-- CreateTable
CREATE TABLE "FeedPostReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPostReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedPostReport_postId_idx" ON "FeedPostReport"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostReport_postId_reporterId_key" ON "FeedPostReport"("postId", "reporterId");

-- AddForeignKey
ALTER TABLE "FeedPostReport" ADD CONSTRAINT "FeedPostReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostReport" ADD CONSTRAINT "FeedPostReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

