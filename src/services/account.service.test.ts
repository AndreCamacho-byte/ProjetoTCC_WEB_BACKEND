import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { makeUser, prisma } from "../test/prismaMock";
import * as account from "./account.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("updateProfile", () => {
  beforeEach(() => {
    prisma.user.update.mockImplementation(async ({ data }) => makeUser(data));
  });

  it("troca o nome sem conferir o @username", async () => {
    const result = await account.updateProfile(USER_ID, { name: "Nome Novo" });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(result.name).toBe("Nome Novo");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("recusa um @username que já é de outra pessoa", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: "outra-pessoa", username: "leticia" }));

    await expect(account.updateProfile(USER_ID, { username: "leticia" })).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("aceita quando o @username enviado já é o da própria pessoa", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: USER_ID, username: "tony" }));
    await expect(account.updateProfile(USER_ID, { username: "tony" })).resolves.toMatchObject({ username: "tony" });
  });
});

describe("setBirthDate", () => {
  const birthDate = new Date("2004-08-09T00:00:00.000Z");

  it("salva a data em uma conta que ainda não tinha", async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ birthDate: null }));
    prisma.user.update.mockResolvedValue(makeUser({ birthDate }));

    const result = await account.setBirthDate(USER_ID, birthDate);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { birthDate } });
    expect(result.birthDate).toEqual(birthDate);
  });

  it("não deixa trocar a data depois de informada", async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

    await expect(account.setBirthDate(USER_ID, birthDate)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("foto de perfil", () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it("salva a foto e aponta o avatarUrl para a rota pública, com versão", async () => {
    prisma.user.update.mockImplementation(async ({ data }) => makeUser(data));

    const result = await account.setAvatar(USER_ID, image);

    expect(prisma.userAvatar.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
    expect(result.avatarUrl).toMatch(new RegExp(`^/api/users/${USER_ID}/avatar\\?v=\\d+$`));
  });

  it("remove a foto e limpa o avatarUrl", async () => {
    prisma.user.update.mockImplementation(async ({ data }) => makeUser(data));

    const result = await account.removeAvatar(USER_ID);

    expect(prisma.userAvatar.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(result.avatarUrl).toBeNull();
  });

  it("devolve os bytes da foto", async () => {
    prisma.userAvatar.findUnique.mockResolvedValue({ userId: USER_ID, data: new Uint8Array(image) });
    await expect(account.getAvatar(USER_ID)).resolves.toEqual(image);
  });

  it("responde 404 quando a pessoa não tem foto", async () => {
    prisma.userAvatar.findUnique.mockResolvedValue(null);
    await expect(account.getAvatar(USER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("deleteAccount", () => {
  let passwordHash: string;
  beforeEach(async () => {
    passwordHash ??= await bcrypt.hash("skate1234", 4);
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
  });

  it("exige a senha correta", async () => {
    await expect(account.deleteAccount(USER_ID, "errada123")).rejects.toMatchObject({
      statusCode: 401,
      code: "WRONG_PASSWORD",
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("exclui a conta com a senha certa", async () => {
    await account.deleteAccount(USER_ID, "skate1234");
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  it("responde 401 se a conta não existe mais", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(account.deleteAccount(USER_ID, "skate1234")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("responde 409 se a conta tem pedidos registrados", async () => {
    prisma.user.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "6.0.0" }),
    );
    await expect(account.deleteAccount(USER_ID, "skate1234")).rejects.toMatchObject({ statusCode: 409 });
  });
});
