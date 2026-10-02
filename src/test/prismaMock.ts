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
  // Uma transação só espera todas as operações terminarem
  $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
  $queryRaw: vi.fn(),
};

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
