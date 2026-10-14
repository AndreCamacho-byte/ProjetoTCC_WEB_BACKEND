-- Várias fotos por post e a lista de salvos (posts e produtos)
-- Fotos dos posts: deixa de ser uma por post e passa a ter id próprio e ordem.
-- As fotos que já existem ganham um id antes de a coluna virar obrigatória.
ALTER TABLE "post_images" DROP CONSTRAINT "post_images_pkey",
ADD COLUMN     "id" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "post_images" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "post_images" ALTER COLUMN "id" SET NOT NULL,
ADD CONSTRAINT "post_images_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "saved_posts" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_posts_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "saved_products" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_products_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateIndex
CREATE INDEX "saved_posts_userId_createdAt_idx" ON "saved_posts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "saved_products_userId_createdAt_idx" ON "saved_products"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "post_images_postId_position_idx" ON "post_images"("postId", "position");

-- AddForeignKey
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

