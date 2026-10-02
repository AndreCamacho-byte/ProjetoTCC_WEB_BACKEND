import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import * as authService from "../services/auth.service";
import { birthDateSchema } from "../utils/age";

const emailField = z.email("Email inválido").trim().toLowerCase();

const passwordField = z.string().min(8, "Senha precisa ter pelo menos 8 caracteres").max(72);

const registerSchema = z.object({
  name: z.string().trim().min(2, "Nome precisa ter pelo menos 2 caracteres").max(60),
  email: emailField,
  password: passwordField,
  birthDate: birthDateSchema,
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Informe a senha"),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token não informado"),
});

const verifyCodeSchema = z.object({
  email: emailField,
  code: z.string().trim().regex(/^\d{6}$/, "O código tem 6 dígitos"),
});

const resendSchema = z.object({
  email: emailField,
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token não informado"),
  password: passwordField,
});

// Endereço do site para montar o link do email. Na AWS o IP do frontend muda a cada deploy,
// então, se APP_URL não estiver configurada, usa o endereço de onde o navegador fez a requisição.
function getAppUrl(req: Request) {
  const url = env.APP_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`;
  return url.replace(/\/+$/, "");
}

// Se a validação falhar, o parse lança ZodError e o errorHandler responde 400
export async function register(req: Request, res: Response) {
  const data = registerSchema.parse(req.body);
  res.status(201).json(await authService.register(data, getAppUrl(req)));
}

export async function login(req: Request, res: Response) {
  const data = loginSchema.parse(req.body);
  res.json(await authService.login(data));
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = verifyEmailSchema.parse(req.body);
  res.json(await authService.verifyEmail(token));
}

export async function verifyEmailCode(req: Request, res: Response) {
  const { email, code } = verifyCodeSchema.parse(req.body);
  res.json(await authService.verifyEmailCode(email, code));
}

export async function resendVerification(req: Request, res: Response) {
  const { email } = resendSchema.parse(req.body);
  res.json(await authService.resendVerification(email, getAppUrl(req)));
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = resendSchema.parse(req.body);
  res.json(await authService.forgotPassword(email, getAppUrl(req)));
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = resetPasswordSchema.parse(req.body);
  res.json(await authService.resetPassword(token, password));
}

export async function me(req: Request, res: Response) {
  res.json(await authService.getUserById(req.userId!));
}
