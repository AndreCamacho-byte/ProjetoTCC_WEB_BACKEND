import { PrismaClient } from "@prisma/client";

// Instância única do Prisma para toda a aplicação
export const prisma = new PrismaClient();
