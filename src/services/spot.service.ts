import { Prisma, type SpotStatus, type SpotType } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { TX_OPTIONS, prisma } from "../lib/prisma";
import { authorSelect, type Viewer } from "./community.service";

// No máximo 3 fotos por spot
export const MAX_SPOT_IMAGES = 3;
// Encontros podem ser marcados até 90 dias para a frente
export const MAX_DAYS_AHEAD = 90;

export const spotImageUrl = (imageId: string) => `/api/spots/images/${imageId}`;

// Encontros de contas suspensas somem, como os posts
const activeCreator = { creator: { suspendedAt: null } } satisfies Prisma.MeetupWhereInput;
// Encontros que ainda vão acontecer e não foram cancelados
const upcoming = (now: Date) =>
  ({ startsAt: { gte: now }, cancelledAt: null, ...activeCreator }) satisfies Prisma.MeetupWhereInput;

// O spot aparece para todo mundo depois de aprovado. Antes disso, só para quem sugeriu e para a equipe.
function canSee(spot: { status: SpotStatus; createdById: string | null }, viewer: Viewer) {
  return spot.status === "APROVADO" || spot.createdById === viewer.id || viewer.isAdmin;
}

// ---------- Spots ----------

// Spots aprovados, para colocar no mapa
export async function listSpots(now = new Date()) {
  const spots = await prisma.spot.findMany({
    where: { status: "APROVADO" },
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      latitude: true,
      longitude: true,
      images: { select: { id: true }, orderBy: { position: "asc" }, take: 1 },
      _count: { select: { meetups: { where: upcoming(now) } } },
    },
    orderBy: { name: "asc" },
  });

  return spots.map(({ images, _count, ...spot }) => ({
    ...spot,
    coverUrl: images[0] ? spotImageUrl(images[0].id) : null,
    upcomingMeetups: _count.meetups,
  }));
}

export async function getSpot(spotId: string, viewer: Viewer, now = new Date()) {
  const spot = await prisma.spot.findUnique({
    where: { id: spotId },
    include: {
      images: { select: { id: true }, orderBy: { position: "asc" } },
      createdBy: { select: { ...authorSelect, suspendedAt: true } },
      meetups: { where: upcoming(now), include: meetupInclude(viewer.id), orderBy: { startsAt: "asc" } },
    },
  });
  if (!spot || !canSee(spot, viewer)) {
    throw new AppError("Spot não encontrado", 404);
  }

  const { createdBy } = spot;
  return {
    id: spot.id,
    name: spot.name,
    description: spot.description,
    type: spot.type,
    address: spot.address,
    latitude: spot.latitude,
    longitude: spot.longitude,
    status: spot.status,
    imageUrls: spot.images.map((image) => spotImageUrl(image.id)),
    // Conta suspensa ou apagada: o spot continua, sem mostrar quem sugeriu
    createdBy:
      createdBy && !createdBy.suspendedAt
        ? { id: createdBy.id, name: createdBy.name, username: createdBy.username, avatarUrl: createdBy.avatarUrl, skateLevel: createdBy.skateLevel }
        : null,
    createdAt: spot.createdAt,
    canDelete: canDeleteSpot(spot, viewer),
    meetups: spot.meetups.map((meetup) => toMeetupView(meetup, viewer, now)),
  };
}

type SpotInput = {
  name: string;
  description?: string | null;
  type: SpotType;
  address?: string | null;
  latitude: number;
  longitude: number;
  images?: Buffer[];
};

// Sugestão de spot: fica pendente até um administrador aprovar.
// Spot cadastrado por um administrador já entra aprovado.
export async function createSpot(viewer: Viewer, { images = [], ...input }: SpotInput) {
  if (images.length > MAX_SPOT_IMAGES) {
    throw new AppError(`Escolha no máximo ${MAX_SPOT_IMAGES} fotos por spot`, 400);
  }

  const spot = await prisma.spot.create({
    data: {
      ...input,
      createdById: viewer.id,
      ...(viewer.isAdmin ? { status: "APROVADO", reviewedAt: new Date() } : {}),
      ...(images.length > 0
        ? { images: { create: images.map((image, position) => ({ data: new Uint8Array(image), position })) } }
        : {}),
    },
    select: { id: true, status: true },
  });
  return spot;
}

// Spots que a pessoa sugeriu, com a situação de cada um
export async function listMySpots(viewer: Viewer) {
  const spots = await prisma.spot.findMany({
    where: { createdById: viewer.id },
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      status: true,
      createdAt: true,
      images: { select: { id: true }, orderBy: { position: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return spots.map(({ images, ...spot }) => ({ ...spot, coverUrl: images[0] ? spotImageUrl(images[0].id) : null }));
}

// Quem sugeriu pode apagar enquanto o spot não foi aprovado. Depois de aprovado, o spot é da
// comunidade (pode ter encontros marcados) e só a equipe remove.
function canDeleteSpot(spot: { status: SpotStatus; createdById: string | null }, viewer: Viewer) {
  return viewer.isAdmin || (spot.createdById === viewer.id && spot.status !== "APROVADO");
}

export async function deleteSpot(spotId: string, viewer: Viewer) {
  const spot = await prisma.spot.findUnique({ where: { id: spotId }, select: { status: true, createdById: true } });
  if (!spot || !canSee(spot, viewer)) {
    throw new AppError("Spot não encontrado", 404);
  }
  if (!canDeleteSpot(spot, viewer)) {
    throw new AppError("Spot aprovado só pode ser removido pela equipe", 403);
  }
  await prisma.spot.delete({ where: { id: spotId } });
}

export async function getSpotImage(imageId: string) {
  const image = await prisma.spotImage.findUnique({ where: { id: imageId } });
  if (!image) {
    throw new AppError("Imagem não encontrada", 404);
  }
  return Buffer.from(image.data);
}

// ---------- Administração ----------

// Fila de aprovação: as sugestões mais antigas primeiro
export async function listSpotsForReview(status: SpotStatus) {
  const spots = await prisma.spot.findMany({
    where: { status },
    include: {
      images: { select: { id: true }, orderBy: { position: "asc" } },
      // Nome e @ de quem sugeriu (o email nunca aparece no painel)
      createdBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: { createdAt: status === "PENDENTE" ? "asc" : "desc" },
    take: 100,
  });

  return spots.map(({ images, createdById: _createdById, ...spot }) => ({
    ...spot,
    imageUrls: images.map((image) => spotImageUrl(image.id)),
  }));
}

export async function reviewSpot(spotId: string, status: "APROVADO" | "RECUSADO") {
  const spot = await prisma.spot.findUnique({ where: { id: spotId }, select: { id: true } });
  if (!spot) {
    throw new AppError("Spot não encontrado", 404);
  }
  return prisma.spot.update({
    where: { id: spotId },
    data: { status, reviewedAt: new Date() },
    select: { id: true, status: true, reviewedAt: true },
  });
}

// ---------- Encontros ----------

const meetupInclude = (viewerId: string) =>
  ({
    spot: { select: { id: true, name: true, address: true, type: true } },
    creator: { select: authorSelect },
    // Só a presença de quem está vendo, para saber como o botão aparece
    participants: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { participants: { where: { user: { suspendedAt: null } } } } },
  }) satisfies Prisma.MeetupInclude;

type MeetupWithRelations = Prisma.MeetupGetPayload<{ include: ReturnType<typeof meetupInclude> }>;

function toMeetupView(meetup: MeetupWithRelations, viewer: Viewer, now: Date) {
  const isCreator = meetup.creatorId === viewer.id;
  const cancelled = meetup.cancelledAt !== null;
  const started = meetup.startsAt <= now;
  const participantCount = meetup._count.participants;

  return {
    id: meetup.id,
    title: meetup.title,
    description: meetup.description,
    startsAt: meetup.startsAt,
    maxParticipants: meetup.maxParticipants,
    participantCount,
    full: meetup.maxParticipants !== null && participantCount >= meetup.maxParticipants,
    cancelled,
    started,
    spot: meetup.spot,
    creator: meetup.creator,
    joinedByMe: meetup.participants.length > 0,
    isCreator,
    // Cancelar o encontro para todo mundo é moderação (só administrador). Quem criou só desmarca a própria ida.
    canCancel: viewer.isAdmin && !cancelled && !started,
  };
}

// O encontro existe para quem está vendo: spot aprovado e quem criou não está suspenso
const visibleMeetup = (meetupId: string) =>
  ({ id: meetupId, spot: { status: "APROVADO" }, ...activeCreator }) satisfies Prisma.MeetupWhereInput;

async function findMeetup(meetupId: string, viewer: Viewer, tx: Prisma.TransactionClient = prisma) {
  const meetup = await tx.meetup.findFirst({ where: visibleMeetup(meetupId), include: meetupInclude(viewer.id) });
  if (!meetup) {
    throw new AppError("Encontro não encontrado", 404);
  }
  return meetup;
}

// Próximos encontros em todos os spots (página de eventos)
export async function listUpcomingMeetups(viewer: Viewer, limit: number, now = new Date()) {
  const meetups = await prisma.meetup.findMany({
    where: { ...upcoming(now), spot: { status: "APROVADO" } },
    include: meetupInclude(viewer.id),
    orderBy: { startsAt: "asc" },
    take: limit,
  });
  return meetups.map((meetup) => toMeetupView(meetup, viewer, now));
}

// Encontros em que a pessoa confirmou presença e os que ela criou (mesmo se desmarcou a ida),
// dos últimos 7 dias em diante. Os cancelados continuam aqui: é assim que quem confirmou fica sabendo.
export async function listMyMeetups(viewer: Viewer, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const meetups = await prisma.meetup.findMany({
    where: {
      OR: [{ participants: { some: { userId: viewer.id } } }, { creatorId: viewer.id }],
      startsAt: { gte: weekAgo },
      spot: { status: "APROVADO" },
      ...activeCreator,
    },
    include: meetupInclude(viewer.id),
    orderBy: { startsAt: "asc" },
  });
  return meetups.map((meetup) => toMeetupView(meetup, viewer, now));
}

export async function getMeetup(meetupId: string, viewer: Viewer, now = new Date()) {
  const meetup = await findMeetup(meetupId, viewer);
  const participants = await prisma.meetupParticipant.findMany({
    where: { meetupId, user: { suspendedAt: null } },
    select: { user: { select: authorSelect } },
    orderBy: { joinedAt: "asc" },
  });
  return { ...toMeetupView(meetup, viewer, now), participants: participants.map((p) => p.user) };
}

type MeetupInput = { title: string; description?: string | null; startsAt: Date; maxParticipants?: number | null };

export async function createMeetup(spotId: string, viewer: Viewer, input: MeetupInput, now = new Date()) {
  const spot = await prisma.spot.findUnique({ where: { id: spotId }, select: { status: true } });
  if (!spot || spot.status !== "APROVADO") {
    throw new AppError("Spot não encontrado", 404);
  }
  if (input.startsAt <= now) {
    throw new AppError("Escolha uma data e hora que ainda não passaram", 400);
  }
  if (input.startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    throw new AppError(`Marque o encontro para os próximos ${MAX_DAYS_AHEAD} dias`, 400);
  }

  const meetup = await prisma.meetup.create({
    data: {
      ...input,
      spotId,
      creatorId: viewer.id,
      // Quem cria já está confirmado
      participants: { create: { userId: viewer.id } },
    },
    include: meetupInclude(viewer.id),
  });
  return toMeetupView(meetup, viewer, now);
}

// Confirmar presença. A contagem e a inscrição ficam na mesma transação para o limite valer.
export async function joinMeetup(meetupId: string, viewer: Viewer, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    const meetup = await findMeetup(meetupId, viewer, tx);
    if (meetup.participants.length > 0) return; // já estava confirmado
    if (meetup.cancelledAt) {
      throw new AppError("Esse encontro foi cancelado", 409, "MEETUP_CANCELLED");
    }
    if (meetup.startsAt <= now) {
      throw new AppError("Esse encontro já começou", 409, "MEETUP_STARTED");
    }
    if (meetup.maxParticipants !== null && meetup._count.participants >= meetup.maxParticipants) {
      throw new AppError("Esse encontro já está lotado", 409, "MEETUP_FULL");
    }
    await tx.meetupParticipant.create({ data: { meetupId, userId: viewer.id } });
  }, TX_OPTIONS);

  return getMeetup(meetupId, viewer, now);
}

// Desmarcar a ida. Vale para todo mundo, inclusive quem criou: o encontro continua de pé
// e a pessoa pode confirmar de novo depois (se ainda houver vaga).
export async function leaveMeetup(meetupId: string, viewer: Viewer, now = new Date()) {
  await findMeetup(meetupId, viewer);
  await prisma.meetupParticipant.deleteMany({ where: { meetupId, userId: viewer.id } });
  return getMeetup(meetupId, viewer, now);
}

// Cancelar o encontro para todo mundo: só administrador (moderação), até a hora do encontro
export async function cancelMeetup(meetupId: string, viewer: Viewer, now = new Date()) {
  const meetup = await findMeetup(meetupId, viewer);
  if (!viewer.isAdmin) {
    throw new AppError("Só a equipe pode cancelar um encontro. Para não ir, desmarque sua presença.", 403);
  }
  if (meetup.cancelledAt) {
    throw new AppError("Esse encontro já foi cancelado", 409, "MEETUP_CANCELLED");
  }
  if (meetup.startsAt <= now) {
    throw new AppError("Esse encontro já começou", 409, "MEETUP_STARTED");
  }
  await prisma.meetup.update({ where: { id: meetupId }, data: { cancelledAt: now } });
  return getMeetup(meetupId, viewer, now);
}
