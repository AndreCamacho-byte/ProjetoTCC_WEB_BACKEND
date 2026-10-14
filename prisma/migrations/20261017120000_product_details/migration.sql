-- Loja: categoria, ficha de detalhes, perguntas frequentes e local do produto
-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('ROUPA', 'CALCADO', 'SHAPE', 'SKATE_MONTADO', 'PECAS', 'ACESSORIO', 'OUTRO');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "category" "ProductCategory" NOT NULL DEFAULT 'OUTRO',
ADD COLUMN     "details" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "faq" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "location" TEXT;

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

