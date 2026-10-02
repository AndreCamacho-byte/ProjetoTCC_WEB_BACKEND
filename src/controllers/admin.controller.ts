import type { Request, Response } from "express";
import { z } from "zod";
import * as adminService from "../services/admin.service";
import { birthDateSchema } from "../utils/age";

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idSchema = z.object({ id: z.uuid("Id inválido") });

const updateSchema = z
  .object({
    name: z.string().trim().min(2, "Nome precisa ter pelo menos 2 caracteres").max(60),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,20}$/, "Use de 3 a 20 letras minúsculas, números ou _"),
    role: z.enum(["USER", "ADMIN"]),
    emailVerified: z.boolean(),
    // null apaga a data (a idade volta a ficar "não verificada")
    birthDate: birthDateSchema.nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, "Informe pelo menos um campo para alterar");

export async function listUsers(req: Request, res: Response) {
  res.json(await adminService.listUsers(listSchema.parse(req.query)));
}

export async function updateUser(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  res.json(await adminService.updateUser(id, req.userId!, updateSchema.parse(req.body)));
}

export async function deleteUser(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  await adminService.deleteUser(id, req.userId!);
  res.status(204).end();
}
