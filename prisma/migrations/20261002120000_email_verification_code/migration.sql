-- Os links pendentes não têm código: são apagados (quem não confirmou pede o reenvio)
DELETE FROM "email_verification_tokens";

-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeHash" TEXT NOT NULL;

