import { PrismaClient } from "@prisma/client";

// Instância única do Prisma para toda a aplicação
export const prisma = new PrismaClient();

// Prazo das transações com várias etapas (fechar pedido, editar produto). O padrão do Prisma é 5 s,
// pouco quando a conexão com o banco está lenta: a transação vencia no meio e o pedido dava erro.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
