-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('WISH', 'REVIEW', 'QUESTION');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'WISH',
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_isRead_createdAt_idx" ON "Feedback"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_archivedAt_idx" ON "Feedback"("archivedAt");

-- CreateIndex
CREATE INDEX "Feedback_isTest_idx" ON "Feedback"("isTest");
