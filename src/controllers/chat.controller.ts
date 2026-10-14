import type { Request, Response } from "express";
import { z } from "zod";
import * as chat from "../services/chat.service";

const idParam = z.object({ id: z.uuid("Id inválido") });

const messagesQuery = z.object({
  cursor: z.uuid("Cursor inválido").optional(),
  after: z.uuid("Mensagem inválida").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

const content = z
  .string()
  .trim()
  .max(chat.MAX_MESSAGE_LENGTH, `A mensagem pode ter até ${chat.MAX_MESSAGE_LENGTH} caracteres`)
  .default("");

const messageSchema = z.object({ content, postId: z.uuid("Post inválido").optional() });

const openSchema = z.object({ username: z.string().trim().toLowerCase().min(1, "Informe o @").max(30) });

const shareSchema = z.object({
  postId: z.uuid("Post inválido"),
  usernames: z
    .array(z.string().trim().toLowerCase().min(1).max(30))
    .min(1, "Escolha pelo menos um amigo")
    .max(chat.MAX_SHARE_TARGETS, `Escolha no máximo ${chat.MAX_SHARE_TARGETS} amigos de uma vez`),
  content,
});

export async function listFriends(req: Request, res: Response) {
  res.json(await chat.listFriends(req.userId!));
}

export async function listConversations(req: Request, res: Response) {
  res.json(await chat.listConversations(req.userId!));
}

export async function unreadCount(req: Request, res: Response) {
  res.json(await chat.unreadCount(req.userId!));
}

export async function openConversation(req: Request, res: Response) {
  const { username } = openSchema.parse(req.body);
  res.json(await chat.openConversation(req.userId!, username.replace(/^@/, "")));
}

export async function getConversation(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.getConversation(req.userId!, id));
}

export async function listMessages(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.listMessages(req.userId!, id, messagesQuery.parse(req.query)));
}

export async function sendMessage(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.status(201).json(await chat.sendMessage(req.userId!, id, messageSchema.parse(req.body)));
}

export async function markRead(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.markRead(req.userId!, id));
}

export async function sharePost(req: Request, res: Response) {
  res.status(201).json(await chat.sharePost(req.userId!, shareSchema.parse(req.body)));
}
