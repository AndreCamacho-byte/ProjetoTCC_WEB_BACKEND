import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { authorSelect, type Viewer } from "./community.service";

// Perfil público: o que outras pessoas veem. Nada de email, data de nascimento ou função.
async function findActiveUser(username: string) {
  const user = await prisma.user.findFirst({
    where: { username, suspendedAt: null, emailVerifiedAt: { not: null } },
    select: { ...authorSelect, bio: true, createdAt: true },
  });
  if (!user) {
    throw new AppError("Perfil não encontrado", 404);
  }
  return user;
}

async function followCounts(userId: string, viewerId: string) {
  const [followers, following, posts, mine] = await prisma.$transaction([
    prisma.follow.count({ where: { followingId: userId, follower: { suspendedAt: null } } }),
    prisma.follow.count({ where: { followerId: userId, following: { suspendedAt: null } } }),
    prisma.post.count({ where: { authorId: userId } }),
    prisma.follow.count({ where: { followerId: viewerId, followingId: userId } }),
  ]);
  return { followers, following, posts, followedByMe: mine > 0 };
}

export async function getProfile(username: string, viewer: Viewer) {
  const user = await findActiveUser(username);
  return { ...user, ...(await followCounts(user.id, viewer.id)), isMe: user.id === viewer.id };
}

// Usado pela rota de posts de um perfil
export async function getProfileId(username: string) {
  return (await findActiveUser(username)).id;
}

export async function follow(username: string, viewer: Viewer) {
  const user = await findActiveUser(username);
  if (user.id === viewer.id) {
    throw new AppError("Você não pode seguir a si mesmo", 400);
  }

  // Seguir duas vezes não dá erro (o par seguidor + seguido é único)
  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: viewer.id, followingId: user.id } },
    create: { followerId: viewer.id, followingId: user.id },
    update: {},
  });
  const { followers, followedByMe } = await followCounts(user.id, viewer.id);
  return { followers, followedByMe };
}

export async function unfollow(username: string, viewer: Viewer) {
  const user = await findActiveUser(username);
  await prisma.follow.deleteMany({ where: { followerId: viewer.id, followingId: user.id } });
  const { followers, followedByMe } = await followCounts(user.id, viewer.id);
  return { followers, followedByMe };
}

// Busca de pessoas pelo nome ou @ (para encontrar quem seguir)
export async function searchProfiles(search: string) {
  const where: Prisma.UserWhereInput = {
    suspendedAt: null,
    emailVerifiedAt: { not: null },
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
    ],
  };
  return prisma.user.findMany({ where, select: authorSelect, orderBy: { name: "asc" }, take: 20 });
}
