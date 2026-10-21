import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
};

// O Express 5 já encaminha para cá os erros lançados em rotas async.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Dados inválidos",
      details: err.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  // Banco fora de alcance, conexão caiu no meio ou a fila de conexões estourou (P2024):
  // são falhas passageiras, então a resposta é 503 e não "erro interno"
  const databaseUnavailable =
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      ["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"].includes(err.code));

  if (databaseUnavailable) {
    console.error("Banco de dados indisponível:", err.message);
    res.status(503).json({ error: "Banco de dados indisponível. Tente novamente em instantes." });
    return;
  }

  // Valor que precisa ser único já existe (P2002). Os services conferem antes de gravar, mas duas
  // pessoas pedindo o mesmo @ no mesmo instante passam as duas pela conferência: o banco barra a
  // segunda, e aqui ela recebe a mesma resposta de "já em uso", e não "erro interno".
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const fields = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
    if (fields.includes("username")) {
      res.status(409).json({ error: "Este @username já está em uso", code: "USERNAME_TAKEN" });
    } else if (fields.includes("email")) {
      res.status(409).json({ error: "Este email já está cadastrado" });
    } else {
      res.status(409).json({ error: "Esse registro já existe" });
    }
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
};
