-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "digestSentAt" TIMESTAMP(3),
ADD COLUMN     "weeklyDigest" BOOLEAN NOT NULL DEFAULT false;
