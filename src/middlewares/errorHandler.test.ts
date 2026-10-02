import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "../errors/AppError";
import { errorHandler, notFoundHandler } from "./errorHandler";

// Resposta simulada do Express, que guarda o status e o corpo enviados
function fakeResponse() {
  const sent = { statusCode: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      sent.statusCode = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  // O errorHandler só usa status() e json(), então isso basta para fazer o papel da resposta
  return { res: res as unknown as Response, sent };
}

const handle = (error: unknown) => {
  const { res, sent } = fakeResponse();
  errorHandler(error, {} as Request, res, vi.fn());
  return sent;
};

describe("errorHandler", () => {
  // Os erros inesperados são escritos no console: silencia durante os testes
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde com o status e a mensagem do AppError", () => {
    const res = handle(new AppError("Este email já está cadastrado", 409));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Este email já está cadastrado" });
  });

  it("inclui o código do erro quando existe", () => {
    const res = handle(new AppError("Confirme seu email antes de entrar.", 403, "EMAIL_NOT_VERIFIED"));
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Confirme seu email antes de entrar.", code: "EMAIL_NOT_VERIFIED" });
  });

  it("usa 400 quando o AppError não informa o status", () => {
    expect(handle(new AppError("Algo errado")).statusCode).toBe(400);
  });

  it("transforma erros de validação (Zod) em 400 com o campo e a mensagem", () => {
    const result = z.object({ email: z.email("Email inválido") }).safeParse({ email: "x" });
    const res = handle(result.error);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Dados inválidos", details: [{ field: "email", message: "Email inválido" }] });
  });

  it("responde 503 quando o banco está fora do ar", () => {
    const res = handle(new Prisma.PrismaClientInitializationError("Can't reach database server", "6.0.0"));
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Banco de dados indisponível. Tente novamente em instantes." });
  });

  it.each(["P1001", "P1002", "P1008", "P1017", "P2024"])("responde 503 para a falha passageira %s", (code) => {
    const error = new Prisma.PrismaClientKnownRequestError("falha", { code, clientVersion: "6.0.0" });
    expect(handle(error).statusCode).toBe(503);
  });

  it("não trata como falha passageira os outros erros do Prisma", () => {
    const error = new Prisma.PrismaClientKnownRequestError("violação", { code: "P2002", clientVersion: "6.0.0" });
    expect(handle(error).statusCode).toBe(500);
  });

  it("responde 500 sem revelar detalhes de erros inesperados", () => {
    const res = handle(new Error("senha do banco: 123"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Erro interno do servidor" });
  });
});

describe("notFoundHandler", () => {
  it("responde 404 dizendo qual rota não existe", () => {
    const { res, sent } = fakeResponse();
    notFoundHandler({ method: "GET", originalUrl: "/api/nao-existe" } as Request, res, vi.fn());
    expect(sent.statusCode).toBe(404);
    expect(sent.body).toEqual({ error: "Rota não encontrada: GET /api/nao-existe" });
  });
});
