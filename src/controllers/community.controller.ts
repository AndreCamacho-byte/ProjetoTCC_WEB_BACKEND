import type { Request, Response } from "express";
import { z } from "zod";
import * as community from "../services/community.service";
import * as profiles from "../services/profile.service";
import { jpegDataUrl, jpegFromDataUrl } from "../utils/jpeg";

const MAX_POST_IMAGE_BYTES = 600 * 1024; // o site já manda a foto reduzida
export const MAX_POST_LENGTH = 500;
export const MAX_COMMENT_LENGTH = 300;

// Quem está pedindo (o requireAuth já carregou a conta)
const viewerOf = (req: Request): community.Viewer => ({ id: req.userId!, isAdmin: req.authUser?.role === "ADMIN" });

const idParam = (name: string) => z.object({ [name]: z.uuid("Id inválido") });
const usernameParam = z.object({ username: z.string().trim().toLowerCase().min(1).max(30) });

const pageQuery = z.object({
  cursor: z.uuid("Cursor inválido").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const feedQuery = pageQuery.extend({ feed: z.enum(["all", "following"]).default("all") });

// Nas listas de seguidores o cursor é o id da última pessoa já recebida
const followQuery = z.object({
  cursor: z.uuid("Cursor inválido").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const postSchema = z.object({
  content: z.string().trim().max(MAX_POST_LENGTH, `O post pode ter até ${MAX_POST_LENGTH} caracteres`).default(""),
  images: z
    .array(jpegDataUrl)
    .max(community.MAX_POST_IMAGES, `Escolha no máximo ${community.MAX_POST_IMAGES} fotos por post`)
    .default([]),
});

const commentSchema = z.object({
  content: z
    .string("Escreva o comentário")
    .trim()
    .min(1, "Escreva o comentário")
    .max(MAX_COMMENT_LENGTH, `O comentário pode ter até ${MAX_COMMENT_LENGTH} caracteres`),
});

// ---------- Posts ----------

export async function getFeed(req: Request, res: Response) {
  res.json(await community.getFeed(viewerOf(req), feedQuery.parse(req.query)));
}

export async function getPost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.getPost(id, viewerOf(req)));
}

export async function createPost(req: Request, res: Response) {
  const { content, images } = postSchema.parse(req.body);
  const data = images.map((image) => jpegFromDataUrl(image, MAX_POST_IMAGE_BYTES));
  res.status(201).json(await community.createPost(viewerOf(req), { content, images: data }));
}

export async function deletePost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  await community.deletePost(id, viewerOf(req));
  res.status(204).end();
}

export async function getPostImage(req: Request, res: Response) {
  const { imageId } = idParam("imageId").parse(req.params);
  const image = await community.getPostImage(imageId);
  res.set({
    "Content-Type": "image/jpeg",
    // A foto de um post nunca muda (só some junto com o post)
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(image);
}

export async function likePost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.likePost(id, req.userId!));
}

export async function unlikePost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.unlikePost(id, req.userId!));
}

// ---------- Salvos ----------

export async function savePost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.savePost(id, req.userId!));
}

export async function unsavePost(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.unsavePost(id, req.userId!));
}

export async function listSavedPosts(req: Request, res: Response) {
  res.json(await community.listSavedPosts(viewerOf(req), pageQuery.parse(req.query)));
}

// ---------- Comentários ----------

export async function listComments(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await community.listComments(id, viewerOf(req), pageQuery.parse(req.query)));
}

export async function createComment(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  const { content } = commentSchema.parse(req.body);
  res.status(201).json(await community.createComment(id, viewerOf(req), content));
}

export async function deleteComment(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  await community.deleteComment(id, viewerOf(req));
  res.status(204).end();
}

// ---------- Perfis ----------

export async function searchProfiles(req: Request, res: Response) {
  const { search } = z.object({ search: z.string().trim().min(1, "Digite um nome").max(60) }).parse(req.query);
  res.json(await profiles.searchProfiles(search.replace(/^@/, "")));
}

export async function getProfile(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await profiles.getProfile(username, viewerOf(req)));
}

export async function getProfilePosts(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  const authorId = await profiles.getProfileId(username);
  res.json(await community.getPostsByAuthor(authorId, viewerOf(req), pageQuery.parse(req.query)));
}

export async function listFollowers(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await profiles.listFollows(username, "followers", viewerOf(req), followQuery.parse(req.query)));
}

export async function listFollowing(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await profiles.listFollows(username, "following", viewerOf(req), followQuery.parse(req.query)));
}

export async function follow(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await profiles.follow(username, viewerOf(req)));
}

export async function unfollow(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await profiles.unfollow(username, viewerOf(req)));
}
