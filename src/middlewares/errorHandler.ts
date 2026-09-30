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
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Dados inválidos",
      details: err.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error("Banco de dados indisponível:", err.message);
    res.status(503).json({ error: "Banco de dados indisponível. Tente novamente em instantes." });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
};
