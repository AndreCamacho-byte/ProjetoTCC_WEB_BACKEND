import type { Request, Response } from "express";
import { z } from "zod";
import * as spots from "../services/spot.service";
import type { Viewer } from "../services/community.service";
import { jpegDataUrl, jpegFromDataUrl } from "../utils/jpeg";

const MAX_SPOT_IMAGE_BYTES = 600 * 1024; // o site já manda a foto reduzida
export const MAX_PARTICIPANTS = 50;

const viewerOf = (req: Request): Viewer => ({ id: req.userId!, isAdmin: req.authUser?.role === "ADMIN" });

const idParam = (name: string) => z.object({ [name]: z.uuid("Id inválido") });

// Campo de texto opcional: vazio vira nulo
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => value || null);

const spotSchema = z.object({
  name: z.string("Dê um nome ao spot").trim().min(2, "Dê um nome ao spot").max(60, "O nome pode ter até 60 caracteres"),
  description: optionalText(500, "A descrição pode ter até 500 caracteres"),
  type: z.enum(["STREET", "PISTA", "BOWL", "MINI_RAMP", "DIY", "OUTRO"], "Escolha o tipo do spot"),
  address: optionalText(120, "O endereço pode ter até 120 caracteres"),
  latitude: z.number("Marque o spot no mapa").min(-90).max(90),
  longitude: z.number("Marque o spot no mapa").min(-180).max(180),
  images: z
    .array(jpegDataUrl)
    .max(spots.MAX_SPOT_IMAGES, `Escolha no máximo ${spots.MAX_SPOT_IMAGES} fotos por spot`)
    .default([]),
});

const reviewSchema = z.object({ status: z.enum(["APROVADO", "RECUSADO"], "Escolha aprovar ou recusar") });
const reviewQuery = z.object({ status: z.enum(["PENDENTE", "APROVADO", "RECUSADO"]).default("PENDENTE") });

const meetupSchema = z.object({
  title: z
    .string("Dê um nome ao encontro")
    .trim()
    .min(3, "Dê um nome ao encontro")
    .max(80, "O nome pode ter até 80 caracteres"),
  description: optionalText(500, "A descrição pode ter até 500 caracteres"),
  startsAt: z.coerce.date("Escolha a data e a hora"),
  maxParticipants: z
    .number()
    .int()
    .min(2, "O limite mínimo é 2 pessoas")
    .max(MAX_PARTICIPANTS, `O limite máximo é ${MAX_PARTICIPANTS} pessoas`)
    .nullish()
    .transform((value) => value ?? null),
});

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(30) });

// ---------- Spots ----------

export async function listSpots(_req: Request, res: Response) {
  res.json(await spots.listSpots());
}

export async function listMySpots(req: Request, res: Response) {
  res.json(await spots.listMySpots(viewerOf(req)));
}

export async function getSpot(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await spots.getSpot(id, viewerOf(req)));
}

export async function createSpot(req: Request, res: Response) {
  const { images, ...input } = spotSchema.parse(req.body);
  const data = images.map((image) => jpegFromDataUrl(image, MAX_SPOT_IMAGE_BYTES));
  res.status(201).json(await spots.createSpot(viewerOf(req), { ...input, images: data }));
}

export async function deleteSpot(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  await spots.deleteSpot(id, viewerOf(req));
  res.status(204).end();
}

export async function getSpotImage(req: Request, res: Response) {
  const { imageId } = idParam("imageId").parse(req.params);
  const image = await spots.getSpotImage(imageId);
  res.set({
    "Content-Type": "image/jpeg",
    // A foto de um spot nunca muda (só some junto com o spot)
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(image);
}

// ---------- Administração ----------

export async function listSpotsForReview(req: Request, res: Response) {
  const { status } = reviewQuery.parse(req.query);
  res.json(await spots.listSpotsForReview(status));
}

export async function reviewSpot(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  const { status } = reviewSchema.parse(req.body);
  res.json(await spots.reviewSpot(id, status));
}

// ---------- Encontros ----------

export async function listUpcomingMeetups(req: Request, res: Response) {
  const { limit } = listQuery.parse(req.query);
  res.json(await spots.listUpcomingMeetups(viewerOf(req), limit));
}

export async function listMyMeetups(req: Request, res: Response) {
  res.json(await spots.listMyMeetups(viewerOf(req)));
}

export async function getMeetup(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await spots.getMeetup(id, viewerOf(req)));
}

export async function createMeetup(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  const input = meetupSchema.parse(req.body);
  res.status(201).json(await spots.createMeetup(id, viewerOf(req), input));
}

export async function joinMeetup(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await spots.joinMeetup(id, viewerOf(req)));
}

export async function leaveMeetup(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await spots.leaveMeetup(id, viewerOf(req)));
}

export async function cancelMeetup(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await spots.cancelMeetup(id, viewerOf(req)));
}
