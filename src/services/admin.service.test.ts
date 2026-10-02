import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { makeUser, prisma } from "../test/prismaMock";
import * as admin from "./admin.service";

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError("erro", { code, clientVersion: "6.0.0" });

describe("listUsers", () => {
  beforeEach(() => {
    prisma.user.findMany.mockResolvedValue([makeUser({ passwordHash: "segredo" })]);
    prisma.user.count.mockResolvedValue(41);
  });

  it("devolve a página, o total e nunca o hash da senha", async () => {
    const result = await admin.listUsers({ page: 1, pageSize: 20 });

    expect(result).toMatchObject({ total: 41, page: 1, pageSize: 20 });
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).not.toHaveProperty("passwordHash");
  });

  it("pula os registros das páginas anteriores, dos mais novos para os mais antigos", async () => {
    await admin.listUsers({ page: 3, pageSize: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20, orderBy: { createdAt: "desc" } }),
    );
  });

  it("busca por nome, @username ou email, sem diferenciar maiúsculas", async () => {
    await admin.listUsers({ search: "tony", page: 1, pageSize: 20 });

    const { where } = prisma.user.findMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { name: { contains: "tony", mode: "insensitive" } },
      { username: { contains: "tony", mode: "insensitive" } },
      { email: { contains: "tony", mode: "insensitive" } },
    ]);
  });

  it("sem busca, lista todos", async () => {
    await admin.listUsers({ page: 1, pageSize: 20 });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe("updateUser", () => {
  const target = makeUser({ id: "user-1", username: "tony" });

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.user.update.mockImplementation(async ({ data }) => ({ ...target, ...data }));
  });

  it("responde 404 se o usuário não existe", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(admin.updateUser("nao-existe", ADMIN_ID, { name: "X" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("não deixa o administrador tirar a própria função", async () => {
    await expect(admin.updateUser(ADMIN_ID, ADMIN_ID, { role: "USER" })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("deixa o administrador rebaixar outra pessoa", async () => {
    const result = await admin.updateUser("user-1", ADMIN_ID, { role: "USER" });
    expect(result.role).toBe("USER");
  });

  it("recusa um @username que já é de outra conta", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.username === "leticia" ? makeUser({ id: "user-2", username: "leticia" }) : target,
    );

    await expect(admin.updateUser("user-1", ADMIN_ID, { username: "leticia" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("não confere duplicidade quando o @username não mudou", async () => {
    await admin.updateUser("user-1", ADMIN_ID, { username: "tony", name: "Tony Novo" });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("marca o email como confirmado só se ainda não estava", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...target, emailVerifiedAt: null });
    await admin.updateUser("user-1", ADMIN_ID, { emailVerified: true });
    expect(prisma.user.update.mock.calls[0][0].data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("não troca a data de confirmação de quem já tinha confirmado", async () => {
    await admin.updateUser("user-1", ADMIN_ID, { emailVerified: true });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty("emailVerifiedAt");
  });

  it("desmarca o email confirmado", async () => {
    await admin.updateUser("user-1", ADMIN_ID, { emailVerified: false });
    expect(prisma.user.update.mock.calls[0][0].data.emailVerifiedAt).toBeNull();
  });

  it("corrige ou apaga a data de nascimento", async () => {
    const birthDate = new Date("2010-03-03T00:00:00.000Z");
    await admin.updateUser("user-1", ADMIN_ID, { birthDate });
    expect(prisma.user.update.mock.calls[0][0].data.birthDate).toBe(birthDate);

    await admin.updateUser("user-1", ADMIN_ID, { birthDate: null });
    expect(prisma.user.update.mock.calls[1][0].data.birthDate).toBeNull();
  });
});

describe("deleteUser", () => {
  it("não deixa o administrador remover a própria conta", async () => {
    await expect(admin.deleteUser(ADMIN_ID, ADMIN_ID)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("remove outro usuário", async () => {
    prisma.user.delete.mockResolvedValue(makeUser());
    await admin.deleteUser("user-1", ADMIN_ID);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  it("responde 404 se o usuário não existe", async () => {
    prisma.user.delete.mockRejectedValue(prismaError("P2025"));
    await expect(admin.deleteUser("user-1", ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("responde 409 se o usuário tem pedidos registrados", async () => {
    prisma.user.delete.mockRejectedValue(prismaError("P2003"));
    await expect(admin.deleteUser("user-1", ADMIN_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("repassa erros que não conhece", async () => {
    prisma.user.delete.mockRejectedValue(new Error("falha inesperada"));
    await expect(admin.deleteUser("user-1", ADMIN_ID)).rejects.toThrow("falha inesperada");
  });
});
