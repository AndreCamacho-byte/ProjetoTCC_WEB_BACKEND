import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "@prisma/client";
import { env } from "../config/env";
import { loginCodeTemplate } from "../emails/loginCode";
import { resetPasswordTemplate } from "../emails/resetPassword";
import { verifyEmailTemplate } from "../emails/verifyEmail";
import { AppError } from "../errors/AppError";
import { sendMail } from "../lib/mail";
import { prisma } from "../lib/prisma";
import { SUSPENDED_MESSAGE } from "../middlewares/auth";
import { limits } from "../middlewares/rateLimit";

type RegisterInput = { name: string; username: string; email: string; password: string; birthDate: Date };
type LoginInput = { email: string; password: string };

// Nunca devolve o hash da senha (nem o controle interno de sessões) para o cliente
export type PublicUser = Omit<User, "passwordHash" | "tokenVersion">;

export function toPublicUser({ passwordHash: _, tokenVersion: __, ...user }: User): PublicUser {
  return user;
}

// O token leva o número de versão da conta (v). Quando a senha muda, o número da conta
// aumenta e os tokens antigos deixam de ser aceitos (veja requireAuth).
export function signToken(user: Pick<User, "id" | "tokenVersion">) {
  return jwt.sign({ sub: user.id, v: user.tokenVersion }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

// ---------- Administradores ----------

// Emails de administrador definidos na variável ADMIN_EMAILS (separados por vírgula)
export const adminEmails = new Set(
  (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

// Se o email da conta está na lista de administradores, garante a função ADMIN
async function promoteIfAdmin(user: User) {
  if (user.role === "ADMIN" || !adminEmails.has(user.email)) return user;
  return prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
}

// ---------- Confirmação de email ----------

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // o link vale 24 horas
const CODE_TTL_MS = 15 * 60 * 1000; // o código de 6 dígitos vale 15 minutos
const MAX_CODE_ATTEMPTS = 5; // depois disso é preciso pedir um novo código
const RESEND_COOLDOWN_MS = 60 * 1000; // no máximo um reenvio por minuto

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
// O id do usuário entra no hash para o mesmo código não gerar o mesmo hash em contas diferentes
const hashCode = (userId: string, code: string) => hashToken(`${userId}:${code}`);

// Avisada quando o servidor de email não aceitou o envio (fora do ar, senha errada, cota estourada)
const emailFailed = () =>
  new AppError("Não conseguimos enviar o email agora. Tente de novo em alguns minutos.", 503, "EMAIL_FAILED");

// Cria um link e um código novos (invalidando os anteriores) e envia o email.
// Devolve se o email saiu: o cadastro avisa quando não saiu; o reenvio responde sempre igual.
async function sendVerificationEmail(user: User, appUrl: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        codeHash: hashCode(user.id, code),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
    }),
  ]);

  const link = `${appUrl}/confirmar-email?token=${token}`;
  try {
    await sendMail({ to: { email: user.email, name: user.name }, ...verifyEmailTemplate({ name: user.name, link, code }) });
    return true;
  } catch (error) {
    console.error("Falha ao enviar o email de confirmação:", error);
    return false;
  }
}

// Contas que nunca confirmaram o email são apagadas depois deste prazo
const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function register({ name, username, email, password, birthDate }: RegisterInput, appUrl: string) {
  // Faxina: remove cadastros antigos que nunca foram confirmados
  await prisma.user.deleteMany({
    where: { emailVerifiedAt: null, createdAt: { lt: new Date(Date.now() - UNVERIFIED_TTL_MS) } },
  });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.emailVerifiedAt) {
    throw new AppError("Este email já está cadastrado", 409);
  }

  // O @ é escolhido no cadastro (antes era gerado a partir do email e mostrava parte dele)
  const owner = await prisma.user.findUnique({ where: { username } });
  if (owner && owner.id !== existing?.id) {
    throw new AppError("Este @username já está em uso", 409, "USERNAME_TAKEN");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Se já existe um cadastro com esse email que nunca foi confirmado, ele é substituído pelos
  // dados novos. Assim ninguém "prende" o email de outra pessoa só por ter se cadastrado com ele:
  // quem recebe o código (o dono do email) é quem fica com a conta.
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { name, username, usernameChosen: true, birthDate, passwordHash, tokenVersion: { increment: 1 } },
      })
    : await prisma.user.create({
        data: { name, email, birthDate, passwordHash, username, usernameChosen: true },
      });

  // Se o email não saiu, avisa em vez de dizer que enviou. O cadastro fica pendente e é
  // substituído quando a pessoa tentar de novo.
  if (!(await sendVerificationEmail(user, appUrl))) {
    throw emailFailed();
  }

  // Sem token de login: a pessoa só entra depois de confirmar o email
  return { email: user.email, message: "Conta criada. Enviamos um código de confirmação para o seu email." };
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.expiresAt < new Date()) {
    throw new AppError("Link inválido ou expirado. Peça um novo email de confirmação.", 400, "INVALID_TOKEN");
  }

  return confirmUser(record.userId);
}

// Marca o email como confirmado, apaga os links/códigos pendentes e já faz o login,
// para a pessoa não precisar digitar a senha logo depois de confirmar
async function confirmUser(userId: string) {
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
  ]);

  return { user: toPublicUser(await promoteIfAdmin(user)), token: signToken(user) };
}

// Confirmação digitando o código de 6 dígitos recebido por email
export async function verifyEmailCode(email: string, code: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { verificationTokens: true } });
  const record = user?.verificationTokens[0];

  // Mesma mensagem para email inexistente, conta já confirmada e código vencido
  if (!user || !record || record.createdAt.getTime() + CODE_TTL_MS < Date.now()) {
    throw new AppError("Código inválido ou expirado. Peça um novo código.", 400, "INVALID_CODE");
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    throw new AppError("Muitas tentativas erradas. Peça um novo código.", 429, "TOO_MANY_ATTEMPTS");
  }

  if (record.codeHash !== hashCode(user.id, code)) {
    await prisma.emailVerificationToken.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new AppError("Código incorreto. Confira o email e tente de novo.", 400, "INVALID_CODE");
  }

  return confirmUser(user.id);
}

export async function resendVerification(email: string, appUrl: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { verificationTokens: true } });

  const lastSent = user?.verificationTokens.reduce((latest, t) => Math.max(latest, t.createdAt.getTime()), 0) ?? 0;
  if (user && !user.emailVerifiedAt && Date.now() - lastSent > RESEND_COOLDOWN_MS) {
    await sendVerificationEmail(user, appUrl);
  }

  // Sempre a mesma resposta, para não revelar quais emails têm conta
  return { message: "Se existir uma conta aguardando confirmação com esse email, enviamos um novo código." };
}

// ---------- Esqueci minha senha ----------

const RESET_TTL_MS = 60 * 60 * 1000; // o link vale 1 hora

export async function forgotPassword(email: string, appUrl: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { passwordResetTokens: true } });

  const lastSent = user?.passwordResetTokens.reduce((latest, t) => Math.max(latest, t.createdAt.getTime()), 0) ?? 0;
  if (user && Date.now() - lastSent > RESEND_COOLDOWN_MS) {
    const token = crypto.randomBytes(32).toString("base64url");

    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      }),
    ]);

    const link = `${appUrl}/redefinir-senha?token=${token}`;
    try {
      await sendMail({ to: { email: user.email, name: user.name }, ...resetPasswordTemplate({ name: user.name, link }) });
    } catch (error) {
      console.error("Falha ao enviar o email de redefinição de senha:", error);
    }
  }

  // Sempre a mesma resposta, para não revelar quais emails têm conta
  return { message: "Se existir uma conta com esse email, enviamos um link para criar uma nova senha." };
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });

  if (!record || record.expiresAt < new Date()) {
    throw new AppError("Link inválido ou expirado. Peça um novo em \"Esqueci minha senha\".", 400, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        // Encerra os logins que estavam abertos com a senha antiga
        tokenVersion: { increment: 1 },
        // Quem abriu o link provou que é dono do email, então a conta também fica confirmada
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
  ]);

  return { message: "Senha alterada. Você já pode entrar com a nova senha." };
}

// ---------- Login ----------

// Hash usado quando o email não existe, só para a conferência da senha levar o mesmo tempo
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("senha-de-uma-conta-que-nao-existe", 10);

export async function login({ email, password }: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email } });

  // A senha é conferida mesmo quando o email não existe (contra um hash qualquer). Sem isso a
  // resposta viria mais rápida para emails sem conta, e daria para descobrir quem é cadastrado
  // medindo o tempo. A mensagem também é a mesma nos dois casos.
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) {
    throw new AppError("Email ou senha incorretos", 401);
  }

  if (!user.emailVerifiedAt) {
    throw new AppError("Confirme seu email antes de entrar.", 403, "EMAIL_NOT_VERIFIED");
  }

  if (user.suspendedAt) {
    throw new AppError(SUSPENDED_MESSAGE, 403, "ACCOUNT_SUSPENDED");
  }

  // A senha está certa, mas o login só termina com o código enviado por email (segunda etapa)
  await sendLoginCode(user);
  return {
    requiresCode: true as const,
    email: user.email,
    message: "Enviamos um código de 6 dígitos para o seu email. Digite para terminar de entrar.",
  };
}

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000; // o código de login vale 10 minutos
// "login:" no começo para o hash nunca coincidir com o do código de confirmação de conta
const hashLoginCode = (userId: string, code: string) => hashToken(`login:${userId}:${code}`);

// Gera um código novo (substituindo o anterior) e envia por email. Se a pessoa pediu há menos
// de um minuto (ex.: clicou em "entrar" duas vezes), não manda outro: o anterior continua valendo.
async function sendLoginCode(user: User) {
  const last = await prisma.loginCode.findUnique({ where: { userId: user.id } });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS && last.expiresAt.getTime() > Date.now()) {
    return;
  }

  // Conta no teto diário de emails do site (cota do Gmail). Só chega aqui com a senha certa,
  // então tentativas de senha errada não gastam a cota.
  limits.dailyEmails.consume("site-inteiro");

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const data = { codeHash: hashLoginCode(user.id, code), attempts: 0, expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS), createdAt: new Date() };
  await prisma.loginCode.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });

  try {
    await sendMail({ to: { email: user.email, name: user.name }, ...loginCodeTemplate({ name: user.name, code }) });
  } catch (error) {
    console.error("Falha ao enviar o código de login:", error);
    // Apaga o código que não chegou (senão o "reenviar" esperaria 1 minuto à toa) e avisa a pessoa
    await prisma.loginCode.delete({ where: { userId: user.id } }).catch(() => {});
    throw emailFailed();
  }
}

// Segunda etapa do login: confere o código e devolve o token
export async function verifyLoginCode(email: string, code: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { loginCode: true } });
  const record = user?.loginCode;

  // Mesma mensagem para email inexistente, sem código pedido e código vencido
  if (!user || !record || record.expiresAt.getTime() < Date.now()) {
    throw new AppError("Código inválido ou expirado. Entre de novo para receber outro.", 400, "INVALID_CODE");
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    throw new AppError("Muitas tentativas erradas. Entre de novo para receber outro código.", 429, "TOO_MANY_ATTEMPTS");
  }

  if (record.codeHash !== hashLoginCode(user.id, code)) {
    await prisma.loginCode.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
    throw new AppError("Código incorreto. Confira o email e tente de novo.", 400, "INVALID_CODE");
  }

  // Confere de novo: a conta pode ter sido suspensa nesses minutos
  if (user.suspendedAt) {
    throw new AppError(SUSPENDED_MESSAGE, 403, "ACCOUNT_SUSPENDED");
  }

  // O código é de uso único
  await prisma.loginCode.delete({ where: { userId: user.id } });

  return { user: toPublicUser(await promoteIfAdmin(user)), token: signToken(user) };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError("Usuário não encontrado", 404);
  }
  return toPublicUser(await promoteIfAdmin(user));
}
