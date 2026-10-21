-- CreateEnum
CREATE TYPE "SpotStatus" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO');

-- DropIndex
DROP INDEX "spots_latitude_longitude_idx";

-- AlterTable
ALTER TABLE "spots" DROP COLUMN "imageUrls",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SpotStatus" NOT NULL DEFAULT 'PENDENTE';

-- AlterTable
ALTER TABLE "meetups" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "maxParticipants" INTEGER;

-- CreateTable
CREATE TABLE "spot_images" (
    "id" TEXT NOT NULL,
    "spotId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spot_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spot_images_spotId_position_idx" ON "spot_images"("spotId", "position");

-- CreateIndex
CREATE INDEX "spots_status_idx" ON "spots"("status");

-- CreateIndex
CREATE INDEX "spots_createdById_idx" ON "spots"("createdById");

-- CreateIndex
CREATE INDEX "meetups_startsAt_idx" ON "meetups"("startsAt");

-- CreateIndex
CREATE INDEX "meetup_participants_userId_idx" ON "meetup_participants"("userId");

-- AddForeignKey
ALTER TABLE "spot_images" ADD CONSTRAINT "spot_images_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

