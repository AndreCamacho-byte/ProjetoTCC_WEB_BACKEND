import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "../services/auth.service";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Nome precisa ter pelo menos 2 caracteres").max(60),
  email: z.email("Email inválido").trim().toLowerCase(),
  password: z.string().min(8, "Senha precisa ter pelo menos 8 caracteres").max(72),
});

const loginSchema = z.object({
  email: z.email("Email inválido").trim().toLowerCase(),
  password: z.string().min(1, "Informe a senha"),
});

// Se a validação falhar, o parse lança ZodError e o errorHandler responde 400
export async function register(req: Request, res: Response) {
  const data = registerSchema.parse(req.body);
  res.status(201).json(await authService.register(data));
}

export async function login(req: Request, res: Response) {
  const data = loginSchema.parse(req.body);
  res.json(await authService.login(data));
}

export async function me(req: Request, res: Response) {
  res.json(await authService.getUserById(req.userId!));
}
