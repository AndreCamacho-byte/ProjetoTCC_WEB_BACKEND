import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "@prisma/client";
import { env } from "../config/env";
import { verifyEmailTemplate } from "../emails/verifyEmail";
import { AppError } from "../errors/AppError";
import { sendMail } from "../lib/mail";
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

// ---------- Confirmação de email ----------

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // o link vale 24 horas
const RESEND_COOLDOWN_MS = 60 * 1000; // no máximo um reenvio por minuto

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

// Cria um link novo (invalidando os anteriores) e envia o email.
// Se o envio falhar, a conta continua criada: a pessoa pode pedir o reenvio depois.
async function sendVerificationEmail(user: User, appUrl: string) {
  const token = crypto.randomBytes(32).toString("base64url");

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
    }),
  ]);

  const link = `${appUrl}/confirmar-email?token=${token}`;
  try {
    await sendMail({ to: { email: user.email, name: user.name }, ...verifyEmailTemplate({ name: user.name, link }) });
  } catch (error) {
    console.error("Falha ao enviar o email de confirmação:", error);
  }
}

export async function register({ name, email, password }: RegisterInput, appUrl: string) {
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

  await sendVerificationEmail(user, appUrl);

  // Sem token de login: a pessoa só entra depois de confirmar o email
  return { email: user.email, message: "Conta criada. Enviamos um link de confirmação para o seu email." };
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.expiresAt < new Date()) {
    throw new AppError("Link inválido ou expirado. Peça um novo email de confirmação.", 400, "INVALID_TOKEN");
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  // Já faz o login, para a pessoa não precisar digitar a senha logo depois de confirmar
  return { user: toPublicUser(user), token: signToken(user.id) };
}

export async function resendVerification(email: string, appUrl: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { verificationTokens: true } });

  const lastSent = user?.verificationTokens.reduce((latest, t) => Math.max(latest, t.createdAt.getTime()), 0) ?? 0;
  if (user && !user.emailVerifiedAt && Date.now() - lastSent > RESEND_COOLDOWN_MS) {
    await sendVerificationEmail(user, appUrl);
  }

  // Sempre a mesma resposta, para não revelar quais emails têm conta
  return { message: "Se existir uma conta aguardando confirmação com esse email, enviamos um novo link." };
}

// ---------- Login ----------

export async function login({ email, password }: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Mesma mensagem para email inexistente e senha errada, para não revelar quais emails têm conta
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Email ou senha incorretos", 401);
  }

  if (!user.emailVerifiedAt) {
    throw new AppError("Confirme seu email antes de entrar.", 403, "EMAIL_NOT_VERIFIED");
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
