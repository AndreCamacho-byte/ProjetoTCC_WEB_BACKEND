import type { User } from "@prisma/client";
import { vi } from "vitest";

// Versão simulada do Prisma: nenhuma chamada chega ao banco de verdade.
// Use nos testes com:  vi.mock("../lib/prisma", () => import("../test/prismaMock"));
// e depois diga o que cada consulta deve devolver, ex.:
//   prisma.user.findUnique.mockResolvedValue(makeUser());
export const prisma = {
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  emailVerificationToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  passwordResetToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  userAvatar: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  brand: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  product: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  productVariant: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  productImage: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  cartItem: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  order: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  // Uma transação com lista só espera todas as operações terminarem;
  // com função, roda a função passando o próprio Prisma simulado.
  $transaction: vi.fn(async (operations: unknown): Promise<unknown> => {
    if (typeof operations === "function") return operations(prisma);
    return Promise.all(operations as unknown[]);
  }),
  $queryRaw: vi.fn(),
};

export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// Usuário de exemplo. Passe só os campos que importam para o teste.
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Tony Teste",
    username: "tony",
    email: "tony@clutch.test",
    passwordHash: "hash",
    avatarUrl: null,
    bio: null,
    skateLevel: null,
    role: "USER",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    birthDate: new Date("2000-01-15T00:00:00.000Z"),
    tokenVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}
