import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { env } from "../config/env";
import { prisma } from "../test/prismaMock";
import { requireAdmin, requireAuth } from "./auth";

const request = (authorization?: string) => ({ headers: { authorization } }) as Request;
const res = {} as Response;

describe("requireAuth", () => {
  it("deixa passar com um token válido e guarda o id do usuário", () => {
    const token = jwt.sign({ sub: "user-1" }, env.JWT_SECRET);
    const req = request(`Bearer ${token}`);
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe("user-1");
  });

  it("recusa quando não há token", () => {
    expect(() => requireAuth(request(), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 401, message: "Token não informado" }),
    );
  });

  it("recusa quando o cabeçalho não usa o formato Bearer", () => {
    const token = jwt.sign({ sub: "user-1" }, env.JWT_SECRET);
    expect(() => requireAuth(request(`Token ${token}`), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("recusa um token assinado com outra chave", () => {
    const token = jwt.sign({ sub: "user-1" }, "outra-chave-secreta-que-nao-e-a-do-servidor");
    expect(() => requireAuth(request(`Bearer ${token}`), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 401, message: "Token inválido ou expirado" }),
    );
  });

  it("recusa um token expirado", () => {
    const token = jwt.sign({ sub: "user-1" }, env.JWT_SECRET, { expiresIn: -10 });
    expect(() => requireAuth(request(`Bearer ${token}`), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("não chama a rota quando o token é recusado", () => {
    const next = vi.fn();
    expect(() => requireAuth(request("Bearer lixo"), res, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  const req = { userId: "user-1" } as Request;

  it("deixa passar quem é administrador", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("confere a função no banco, pelo id do usuário logado", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    await requireAdmin(req, res, vi.fn());
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { role: true } });
  });

  it("recusa uma conta comum", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "USER" });
    await expect(requireAdmin(req, res, vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("recusa quando a conta não existe mais", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(requireAdmin(req, res, vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
});
