import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { blockBetween, notBlocked } from "./block.service";
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
  const [followers, following, posts, mine, theirs] = await prisma.$transaction([
    prisma.follow.count({ where: { followingId: userId, follower: { suspendedAt: null } } }),
    prisma.follow.count({ where: { followerId: userId, following: { suspendedAt: null } } }),
    prisma.post.count({ where: { authorId: userId } }),
    prisma.follow.count({ where: { followerId: viewerId, followingId: userId } }),
    prisma.follow.count({ where: { followerId: userId, followingId: viewerId } }),
  ]);
  // followsMe: a pessoa segue quem está vendo (aparece "Segue você"). Os dois juntos = amigos.
  return { followers, following, posts, followedByMe: mine > 0, followsMe: theirs > 0 };
}

// Quem bloqueou quem está vendo some para ele: o perfil "não existe"
async function findVisibleUser(username: string, viewer: Viewer) {
  const user = await findActiveUser(username);
  const block = await blockBetween(viewer.id, user.id);
  if (block.blockedMe) {
    throw new AppError("Perfil não encontrado", 404);
  }
  return { user, blockedByMe: block.blockedByMe };
}

export async function getProfile(username: string, viewer: Viewer) {
  const { user, blockedByMe } = await findVisibleUser(username, viewer);
  return { ...user, ...(await followCounts(user.id, viewer.id)), isMe: user.id === viewer.id, blockedByMe };
}

// Usado pela rota de posts de um perfil (com bloqueio em qualquer sentido, a lista vem vazia)
export async function getProfileId(username: string) {
  return (await findActiveUser(username)).id;
}

export async function follow(username: string, viewer: Viewer) {
  const user = await findActiveUser(username);
  if (user.id === viewer.id) {
    throw new AppError("Você não pode seguir a si mesmo", 400);
  }
  const block = await blockBetween(viewer.id, user.id);
  if (block.blockedMe) {
    throw new AppError("Perfil não encontrado", 404);
  }
  if (block.blockedByMe) {
    throw new AppError("Desbloqueie a pessoa para seguir", 400, "BLOCKED");
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

// Lista de seguidores ou de quem a pessoa segue, com o botão de seguir de quem está vendo
type ListInput = { cursor?: string; limit: number };

export async function listFollows(
  username: string,
  kind: "followers" | "following",
  viewer: Viewer,
  { cursor, limit }: ListInput,
) {
  const { user } = await findVisibleUser(username, viewer);
  const hidden = await notBlocked(viewer.id);

  // Seguidores: as linhas em que a pessoa é seguida; seguindo: as linhas em que ela segue
  const isFollowers = kind === "followers";
  const rows = await prisma.follow.findMany({
    where: isFollowers
      ? { followingId: user.id, follower: { suspendedAt: null, id: hidden } }
      : { followerId: user.id, following: { suspendedAt: null, id: hidden } },
    include: { follower: { select: authorSelect }, following: { select: authorSelect } },
    orderBy: [{ createdAt: "desc" }, isFollowers ? { followerId: "desc" } : { followingId: "desc" }],
    take: limit + 1,
    ...(cursor
      ? {
          cursor: {
            followerId_followingId: isFollowers
              ? { followerId: cursor, followingId: user.id }
              : { followerId: user.id, followingId: cursor },
          },
          skip: 1,
        }
      : {}),
  });

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).map((row) => (isFollowers ? row.follower : row.following));

  // Quem dessa página quem está vendo já segue
  const mine = await prisma.follow.findMany({
    where: { followerId: viewer.id, followingId: { in: page.map((person) => person.id) } },
    select: { followingId: true },
  });
  const followed = new Set(mine.map((row) => row.followingId));

  return {
    people: page.map((person) => ({ ...person, followedByMe: followed.has(person.id), isMe: person.id === viewer.id })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// Busca de pessoas pelo nome ou @ (para encontrar quem seguir)
export async function searchProfiles(search: string, viewer: Viewer) {
  const where: Prisma.UserWhereInput = {
    id: await notBlocked(viewer.id),
    suspendedAt: null,
    emailVerifiedAt: { not: null },
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
    ],
  };
  return prisma.user.findMany({ where, select: authorSelect, orderBy: { name: "asc" }, take: 20 });
}
