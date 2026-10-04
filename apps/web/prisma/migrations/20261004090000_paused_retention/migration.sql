-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "pauseNoticesSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pausedSince" TIMESTAMP(3);

