import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError";
import * as accountService from "../services/account.service";
import { birthDateSchema } from "../utils/age";

const MAX_AVATAR_BYTES = 300 * 1024; // o site já manda a foto reduzida (256x256), então isso sobra

const profileSchema = z
  .object({
    name: z.string().trim().min(2, "Nome precisa ter pelo menos 2 caracteres").max(60),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,20}$/, "Use de 3 a 20 letras minúsculas, números ou _"),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, "Informe pelo menos um campo para alterar");

const avatarSchema = z.object({
  image: z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, "Envie a foto em JPEG"),
});

const birthDateBodySchema = z.object({ birthDate: birthDateSchema });

const deleteSchema = z.object({
  password: z.string().min(1, "Informe a senha"),
});

const idSchema = z.object({ id: z.uuid("Id inválido") });

export async function updateProfile(req: Request, res: Response) {
  res.json(await accountService.updateProfile(req.userId!, profileSchema.parse(req.body)));
}

export async function setBirthDate(req: Request, res: Response) {
  const { birthDate } = birthDateBodySchema.parse(req.body);
  res.json(await accountService.setBirthDate(req.userId!, birthDate));
}

export async function setAvatar(req: Request, res: Response) {
  const { image } = avatarSchema.parse(req.body);
  const data = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");

  if (data.length > MAX_AVATAR_BYTES) {
    throw new AppError("A foto é grande demais", 413);
  }
  // Todo JPEG começa com os bytes FF D8 FF: confere se o arquivo é mesmo uma imagem
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    throw new AppError("O arquivo enviado não é uma imagem JPEG válida", 400);
  }

  res.json(await accountService.setAvatar(req.userId!, data));
}

export async function removeAvatar(req: Request, res: Response) {
  res.json(await accountService.removeAvatar(req.userId!));
}

export async function getAvatar(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const image = await accountService.getAvatar(id);

  res.set({
    "Content-Type": "image/jpeg",
    // O endereço da foto muda a cada troca (?v=...), então pode ficar em cache por muito tempo
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(image);
}

export async function deleteAccount(req: Request, res: Response) {
  const { password } = deleteSchema.parse(req.body);
  await accountService.deleteAccount(req.userId!, password);
  res.status(204).end();
}
