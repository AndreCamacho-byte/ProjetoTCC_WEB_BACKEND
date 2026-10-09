-- Excluir uma conta apaga também os pedidos dela (antes, a exclusão era recusada pelo banco)
ALTER TABLE "orders" DROP CONSTRAINT "orders_userId_fkey";

ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
