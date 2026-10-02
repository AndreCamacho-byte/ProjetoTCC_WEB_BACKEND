import type { RequestHandler } from "express";
import type { UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      // Dados da conta logada, carregados pelo requireAuth e usados pelas outras proteções
      authUser?: { role: UserRole; birthDate: Date | null };
    }
  }
}

// Protege rotas que exigem login. Espera o header: Authorization: Bearer <token>
// Depois dele, o id do usuário logado fica em req.userId.
//
// Além da assinatura do token, confere a conta no banco a cada requisição. Assim o login deixa
// de valer na hora quando a conta é excluída, quando a senha muda (tokenVersion) ou quando um
// administrador tira a confirmação do email, sem esperar o token expirar.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new AppError("Token não informado", 401);
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AppError("Token inválido ou expirado", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub ?? "" },
    select: { id: true, role: true, birthDate: true, tokenVersion: true, emailVerifiedAt: true },
  });

  // Tokens emitidos antes de existir o número de versão contam como versão 0
  const tokenVersion = typeof payload.v === "number" ? payload.v : 0;

  if (!user || !user.emailVerifiedAt || user.tokenVersion !== tokenVersion) {
    throw new AppError("Sessão encerrada. Entre de novo.", 401, "SESSION_EXPIRED");
  }

  req.userId = user.id;
  req.authUser = { role: user.role, birthDate: user.birthDate };
  next();
};

// Protege rotas exclusivas de administradores. Use sempre depois do requireAuth.
// A função vem do banco (carregada pelo requireAuth nesta mesma requisição), então tirar
// o acesso de alguém vale na hora.
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.authUser?.role !== "ADMIN") {
    throw new AppError("Acesso restrito a administradores", 403);
  }

  next();
};
