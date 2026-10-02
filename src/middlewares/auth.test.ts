import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { env } from "../config/env";
import { makeUser, prisma } from "../test/prismaMock";
import { requireAdmin, requireAuth } from "./auth";

const request = (authorization?: string) => ({ headers: { authorization } }) as Request;
const res = {} as Response;
const sign = (payload: object, options?: jwt.SignOptions) => jwt.sign(payload, env.JWT_SECRET, options);

describe("requireAuth", () => {
  it("deixa passar com um token válido e guarda os dados da conta", async () => {
    const user = makeUser({ role: "ADMIN" });
    prisma.user.findUnique.mockResolvedValue(user);
    const req = request(`Bearer ${sign({ sub: user.id, v: 0 })}`);
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe(user.id);
    expect(req.authUser).toEqual({ role: "ADMIN", birthDate: user.birthDate });
  });

  it("recusa quando não há token, sem consultar o banco", async () => {
    await expect(requireAuth(request(), res, vi.fn())).rejects.toMatchObject({
      statusCode: 401,
      message: "Token não informado",
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("recusa quando o cabeçalho não usa o formato Bearer", async () => {
    await expect(requireAuth(request(`Token ${sign({ sub: "u" })}`), res, vi.fn())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("recusa um token assinado com outra chave", async () => {
    const token = jwt.sign({ sub: "u" }, "outra-chave-secreta-que-nao-e-a-do-servidor");
    await expect(requireAuth(request(`Bearer ${token}`), res, vi.fn())).rejects.toMatchObject({
      statusCode: 401,
      message: "Token inválido ou expirado",
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("recusa um token expirado", async () => {
    const token = sign({ sub: "u" }, { expiresIn: -10 });
    await expect(requireAuth(request(`Bearer ${token}`), res, vi.fn())).rejects.toMatchObject({ statusCode: 401 });
  });

  it("encerra a sessão de uma conta que foi excluída", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(requireAuth(request(`Bearer ${sign({ sub: "u", v: 0 })}`), res, vi.fn())).rejects.toMatchObject({
      statusCode: 401,
      code: "SESSION_EXPIRED",
    });
  });

  it("encerra os logins feitos antes da troca de senha", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ tokenVersion: 1 }));
    await expect(requireAuth(request(`Bearer ${sign({ sub: "u", v: 0 })}`), res, vi.fn())).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("aceita o login feito depois da troca de senha", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ tokenVersion: 1 }));
    const next = vi.fn();
    await requireAuth(request(`Bearer ${sign({ sub: "u", v: 1 })}`), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("trata tokens antigos, sem número de versão, como versão 0", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ tokenVersion: 0 }));
    const next = vi.fn();
    await requireAuth(request(`Bearer ${sign({ sub: "u" })}`), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("encerra a sessão quando o email deixa de estar confirmado", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
    await expect(requireAuth(request(`Bearer ${sign({ sub: "u", v: 0 })}`), res, vi.fn())).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("não chama a rota quando o login é recusado", async () => {
    const next = vi.fn();
    await expect(requireAuth(request("Bearer lixo"), res, next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  const withRole = (role?: "USER" | "ADMIN") => ({ authUser: role && { role, birthDate: null } }) as Request;

  it("deixa passar quem é administrador", () => {
    const next = vi.fn();
    requireAdmin(withRole("ADMIN"), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("recusa uma conta comum", () => {
    expect(() => requireAdmin(withRole("USER"), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("recusa quando o login não foi conferido antes", () => {
    expect(() => requireAdmin(withRole(), res, vi.fn())).toThrowError(expect.objectContaining({ statusCode: 403 }));
  });
});
