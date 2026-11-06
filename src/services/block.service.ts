import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import type { Viewer } from "./community.service";

// Bloqueio entre duas pessoas. Vale nos dois sentidos para o que cada uma vê: quem bloqueou
// some para quem foi bloqueado, e quem foi bloqueado some do feed, dos comentários e da busca
// de quem bloqueou.

// Ids das pessoas com quem quem está vendo tem um bloqueio, em qualquer sentido
export async function blockedIds(viewerId: string) {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  return rows.map((row) => (row.blockerId === viewerId ? row.blockedId : row.blockerId));
}

// Filtro do Prisma para esconder o que é de pessoas bloqueadas (vazio quando não há bloqueio)
export async function notBlocked(viewerId: string) {
  const ids = await blockedIds(viewerId);
  return ids.length > 0 ? { notIn: ids } : undefined;
}

// Situação entre duas pessoas: quem está vendo bloqueou a outra? a outra bloqueou quem está vendo?
export async function blockBetween(viewerId: string, otherId: string) {
  const rows = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: otherId },
        { blockerId: otherId, blockedId: viewerId },
      ],
    },
    select: { blockerId: true },
  });
  return {
    blockedByMe: rows.some((row) => row.blockerId === viewerId),
    blockedMe: rows.some((row) => row.blockerId === otherId),
  };
}

async function findUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username, emailVerifiedAt: { not: null } }, select: { id: true } });
  if (!user) {
    throw new AppError("Perfil não encontrado", 404);
  }
  return user;
}

// Bloquear: grava o bloqueio e desfaz o "seguir" nos dois sentidos (a amizade acaba, e com ela o chat)
export async function blockUser(username: string, viewer: Viewer) {
  const user = await findUser(username);
  if (user.id === viewer.id) {
    throw new AppError("Você não pode bloquear a si mesmo", 400);
  }

  await prisma.$transaction([
    prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: viewer.id, blockedId: user.id } },
      create: { blockerId: viewer.id, blockedId: user.id },
      update: {},
    }),
    prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: viewer.id, followingId: user.id },
          { followerId: user.id, followingId: viewer.id },
        ],
      },
    }),
  ]);
  return { blockedByMe: true };
}

export async function unblockUser(username: string, viewer: Viewer) {
  const user = await findUser(username);
  await prisma.block.deleteMany({ where: { blockerId: viewer.id, blockedId: user.id } });
  return { blockedByMe: false };
}

// Pessoas que quem está vendo bloqueou (para desbloquear nas configurações)
export async function listBlocked(viewer: Viewer) {
  const rows = await prisma.block.findMany({
    where: { blockerId: viewer.id },
    select: { blocked: { select: { id: true, name: true, username: true, avatarUrl: true, skateLevel: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => row.blocked);
}
