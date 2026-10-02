import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Protege rotas exclusivas de administradores. Use sempre depois do requireAuth.
// A função é conferida no banco a cada requisição (e não no token), então remover o acesso
// de alguém vale na hora, sem esperar o token expirar.
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });

  if (user?.role !== "ADMIN") {
    throw new AppError("Acesso restrito a administradores", 403);
  }

  next();
};

// Protege rotas que exigem login. Espera o header: Authorization: Bearer <token>
// Depois dele, o id do usuário logado fica em req.userId
export const requireAuth: RequestHandler = (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new AppError("Token não informado", 401);
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    req.userId = payload.sub;
    next();
  } catch {
    throw new AppError("Token inválido ou expirado", 401);
  }
};
