-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "lastReportIssues" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lastReportTruncated" BOOLEAN NOT NULL DEFAULT false;
