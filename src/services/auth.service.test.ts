import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { env } from "../config/env";
import { sendMail } from "../lib/mail";
import { makeUser, prisma } from "../test/prismaMock";
import * as auth from "./auth.service";

const sendMailMock = vi.mocked(sendMail);
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
const APP_URL = "http://localhost:5173";

// Senha "skate1234" já embaralhada, calculada uma vez só (o bcrypt é lento de propósito)
let passwordHash: string;
beforeEach(async () => {
  passwordHash ??= await bcrypt.hash("skate1234", 4);
});

describe("toPublicUser", () => {
  it("nunca devolve o hash da senha nem o controle de sessões", () => {
    const user = auth.toPublicUser(makeUser({ passwordHash: "segredo" }));
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("tokenVersion");
    expect(user.email).toBe("tony@clutch.test");
  });
});

describe("register", () => {
  const input = {
    name: "Tony Teste",
    email: "tony.hawk@clutch.test",
    password: "skate1234",
    birthDate: new Date("2000-01-15T00:00:00.000Z"),
  };

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(null); // email e @username livres
    prisma.user.create.mockImplementation(async ({ data }) => makeUser({ ...data, emailVerifiedAt: null }));
  });

  it("recusa um email que já tem conta", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await expect(auth.register(input, APP_URL)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("libera o email de um cadastro que nunca foi confirmado, trocando os dados pelos novos", async () => {
    const pending = makeUser({ id: "pendente", email: input.email, emailVerifiedAt: null, name: "Outra Pessoa" });
    prisma.user.findUnique.mockResolvedValue(pending);
    prisma.user.update.mockImplementation(async ({ data }) => ({ ...pending, name: data.name }));

    const result = await auth.register(input, APP_URL);

    expect(prisma.user.create).not.toHaveBeenCalled();
    const { where, data } = prisma.user.update.mock.calls[0][0];
    expect(where).toEqual({ id: "pendente" });
    expect(data.name).toBe("Tony Teste");
    expect(await bcrypt.compare("skate1234", data.passwordHash)).toBe(true);
    // quem tinha feito o cadastro anterior perde qualquer acesso
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(result.email).toBe(input.email);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("apaga cadastros não confirmados com mais de 7 dias", async () => {
    await auth.register(input, APP_URL);

    const { where } = prisma.user.deleteMany.mock.calls[0][0];
    expect(where.emailVerifiedAt).toBeNull();
    const days = (Date.now() - where.createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 1);
  });

  it("guarda a senha embaralhada, nunca em texto puro", async () => {
    await auth.register(input, APP_URL);

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.passwordHash).not.toBe("skate1234");
    expect(await bcrypt.compare("skate1234", data.passwordHash)).toBe(true);
  });

  it("salva a data de nascimento e gera o @username a partir do email", async () => {
    await auth.register(input, APP_URL);

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.birthDate).toEqual(input.birthDate);
    expect(data.username).toBe("tonyhawk");
  });

  it("acrescenta números ao @username quando ele já existe", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.username === "tonyhawk" ? makeUser({ username: "tonyhawk" }) : null,
    );

    await auth.register(input, APP_URL);

    expect(prisma.user.create.mock.calls[0][0].data.username).toMatch(/^tonyhawk\d{4}$/);
  });

  it("não devolve token: a pessoa só entra depois de confirmar o email", async () => {
    const result = await auth.register(input, APP_URL);

    expect(result).toEqual({ email: "tony.hawk@clutch.test", message: expect.any(String) });
    expect(result).not.toHaveProperty("token");
  });

  it("envia o email com um código de 6 dígitos e o link do site de onde veio o cadastro", async () => {
    await auth.register(input, APP_URL);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toEqual({ email: "tony.hawk@clutch.test", name: "Tony Teste" });
    expect(mail.subject).toMatch(/^\d{6} é o seu código do Clutch$/);
    expect(mail.text).toContain("http://localhost:5173/confirmar-email?token=");
  });

  it("guarda no banco só o hash do link e do código", async () => {
    await auth.register(input, APP_URL);

    const mail = sendMailMock.mock.calls[0][0];
    const token = mail.text.match(/token=([\w-]+)/)![1];
    const code = mail.subject.slice(0, 6);
    const saved = prisma.emailVerificationToken.create.mock.calls[0][0].data;

    expect(saved.tokenHash).toBe(sha256(token));
    expect(saved.tokenHash).not.toContain(token);
    expect(saved.codeHash).toBe(sha256(`${saved.userId}:${code}`));
  });

  it("continua criando a conta mesmo se o envio do email falhar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(new Error("Brevo fora do ar"));

    await expect(auth.register(input, APP_URL)).resolves.toMatchObject({ email: "tony.hawk@clutch.test" });
  });
});

describe("login", () => {
  it("recusa um email que não tem conta", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(auth.login({ email: "x@clutch.test", password: "skate1234" })).rejects.toMatchObject({
      statusCode: 401,
      message: "Email ou senha incorretos",
    });
  });

  it("recusa a senha errada com a mesma mensagem do email inexistente", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
    await expect(auth.login({ email: "tony@clutch.test", password: "errada123" })).rejects.toMatchObject({
      statusCode: 401,
      message: "Email ou senha incorretos",
    });
  });

  it("bloqueia quem ainda não confirmou o email", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, emailVerifiedAt: null }));
    await expect(auth.login({ email: "tony@clutch.test", password: "skate1234" })).rejects.toMatchObject({
      statusCode: 403,
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("devolve o usuário sem a senha e um token válido", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

    const result = await auth.login({ email: "tony@clutch.test", password: "skate1234" });

    expect(result.user).not.toHaveProperty("passwordHash");
    const payload = jwt.verify(result.token, env.JWT_SECRET) as jwt.JwtPayload;
    expect(payload.sub).toBe(makeUser().id);
    expect(payload.v).toBe(0);
  });

  it("transforma em administrador a conta cujo email está em ADMIN_EMAILS", async () => {
    const admin = makeUser({ email: "admin@clutch.test", passwordHash });
    prisma.user.findUnique.mockResolvedValue(admin);
    prisma.user.update.mockResolvedValue({ ...admin, role: "ADMIN" });

    const result = await auth.login({ email: "admin@clutch.test", password: "skate1234" });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: admin.id }, data: { role: "ADMIN" } });
    expect(result.user.role).toBe("ADMIN");
  });

  it("não mexe na função de uma conta comum", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
    await auth.login({ email: "tony@clutch.test", password: "skate1234" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("verifyEmailCode", () => {
  const user = makeUser({ emailVerifiedAt: null });
  const tokenFor = (overrides = {}) => ({
    id: "token-1",
    userId: user.id,
    tokenHash: "x",
    codeHash: sha256(`${user.id}:123456`),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: minutesAgo(1),
    ...overrides,
  });

  beforeEach(() => {
    prisma.user.update.mockResolvedValue(makeUser());
  });

  it("confirma o email com o código certo e já devolve o login", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, verificationTokens: [tokenFor()] });

    const result = await auth.verifyEmailCode(user.email, "123456");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
    expect(result.token).toEqual(expect.any(String));
  });

  it("conta a tentativa quando o código está errado", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, verificationTokens: [tokenFor()] });

    await expect(auth.verifyEmailCode(user.email, "000000")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_CODE",
    });
    expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { attempts: { increment: 1 } },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("depois de 5 erros recusa até o código certo", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, verificationTokens: [tokenFor({ attempts: 5 })] });

    await expect(auth.verifyEmailCode(user.email, "123456")).rejects.toMatchObject({
      statusCode: 429,
      code: "TOO_MANY_ATTEMPTS",
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("recusa o código depois de 15 minutos", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      verificationTokens: [tokenFor({ createdAt: minutesAgo(16) })],
    });
    await expect(auth.verifyEmailCode(user.email, "123456")).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("dá a mesma resposta para email que não existe e para conta sem código pendente", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(auth.verifyEmailCode("x@clutch.test", "123456")).rejects.toMatchObject({ code: "INVALID_CODE" });

    prisma.user.findUnique.mockResolvedValue({ ...user, verificationTokens: [] });
    await expect(auth.verifyEmailCode(user.email, "123456")).rejects.toMatchObject({ code: "INVALID_CODE" });
  });
});

describe("verifyEmail (link)", () => {
  it("recusa um link que não existe", async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
    await expect(auth.verifyEmail("qualquer")).rejects.toMatchObject({ statusCode: 400, code: "INVALID_TOKEN" });
  });

  it("recusa um link vencido", async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: minutesAgo(1),
      user: makeUser(),
    });
    await expect(auth.verifyEmail("vencido")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("procura pelo hash do token e confirma a conta", async () => {
    const user = makeUser();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });
    prisma.user.update.mockResolvedValue(user);

    const result = await auth.verifyEmail("meu-token");

    expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256("meu-token") },
      include: { user: true },
    });
    expect(result.user.id).toBe(user.id);
    expect(result.token).toEqual(expect.any(String));
  });
});

describe("resendVerification", () => {
  const pending = makeUser({ emailVerifiedAt: null });

  it("responde igual quando o email não existe, sem enviar nada", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await auth.resendVerification("x@clutch.test", APP_URL);

    expect(result.message).toEqual(expect.any(String));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("não reenvia para conta já confirmada", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...makeUser(), verificationTokens: [] });
    await auth.resendVerification("tony@clutch.test", APP_URL);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("não reenvia antes de 1 minuto do último envio", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...pending,
      verificationTokens: [{ createdAt: new Date(Date.now() - 30_000) }],
    });
    await auth.resendVerification(pending.email, APP_URL);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("reenvia depois de 1 minuto", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...pending, verificationTokens: [{ createdAt: minutesAgo(2) }] });
    await auth.resendVerification(pending.email, APP_URL);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });
});

describe("forgotPassword", () => {
  it("responde igual quando o email não existe, sem enviar nada", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await auth.forgotPassword("x@clutch.test", APP_URL);

    expect(result.message).toEqual(expect.any(String));
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("envia o link de redefinição e guarda só o hash, com validade de 1 hora", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...makeUser(), passwordResetTokens: [] });

    await auth.forgotPassword("tony@clutch.test", APP_URL);

    const mail = sendMailMock.mock.calls[0][0];
    const token = mail.text.match(/redefinir-senha\?token=([\w-]+)/)![1];
    const saved = prisma.passwordResetToken.create.mock.calls[0][0].data;

    expect(saved.tokenHash).toBe(sha256(token));
    const minutesValid = (saved.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesValid).toBeGreaterThan(59);
    expect(minutesValid).toBeLessThanOrEqual(60);
  });

  it("não manda outro email antes de 1 minuto", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...makeUser(),
      passwordResetTokens: [{ createdAt: new Date(Date.now() - 20_000) }],
    });
    await auth.forgotPassword("tony@clutch.test", APP_URL);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("recusa link inexistente ou vencido", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(auth.resetPassword("x", "novasenha1")).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    prisma.passwordResetToken.findUnique.mockResolvedValue({ userId: "u", expiresAt: minutesAgo(1) });
    await expect(auth.resetPassword("x", "novasenha1")).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("troca a senha (embaralhada) e apaga os links pendentes", async () => {
    const user = makeUser();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    await auth.resetPassword("meu-token", "novasenha1");

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.passwordHash).not.toBe("novasenha1");
    expect(await bcrypt.compare("novasenha1", data.passwordHash)).toBe(true);
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
    // encerra os logins que estavam abertos com a senha antiga
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it("confirma o email de quem ainda não tinha confirmado, e mantém a data de quem já tinha", async () => {
    const verifiedAt = new Date("2026-01-01T00:00:00.000Z");
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      userId: "u",
      expiresAt: new Date(Date.now() + 60_000),
    });

    prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
    await auth.resetPassword("t", "novasenha1");
    expect(prisma.user.update.mock.calls[0][0].data.emailVerifiedAt).toBeInstanceOf(Date);

    prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ emailVerifiedAt: verifiedAt }));
    await auth.resetPassword("t", "novasenha1");
    expect(prisma.user.update.mock.calls[1][0].data.emailVerifiedAt).toBe(verifiedAt);
  });
});
