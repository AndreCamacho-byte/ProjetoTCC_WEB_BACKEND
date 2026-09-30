import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "@prisma/client";
import { env } from "../config/env";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";

type RegisterInput = { name: string; email: string; password: string };
type LoginInput = { email: string; password: string };

// Nunca devolve o hash da senha para o cliente
export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser({ passwordHash: _, ...user }: User): PublicUser {
  return user;
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

// O cadastro não pede @username, então ele é gerado a partir do email
// (ex.: joao.silva@gmail.com -> joaosilva, ou joaosilva4821 se já existir)
async function generateUsername(email: string) {
  const base =
    email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 20) || "skater";

  let username = base;
  while (await prisma.user.findUnique({ where: { username } })) {
    username = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return username;
}

export async function register({ name, email, password }: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("Este email já está cadastrado", 409);
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      username: await generateUsername(email),
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  return { user: toPublicUser(user), token: signToken(user.id) };
}

export async function login({ email, password }: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Mesma mensagem para email inexistente e senha errada, para não revelar quais emails têm conta
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Email ou senha incorretos", 401);
  }

  return { user: toPublicUser(user), token: signToken(user.id) };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError("Usuário não encontrado", 404);
  }
  return toPublicUser(user);
}
