import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import * as spots from "./spot.service";

const ANA = "11111111-1111-4111-8111-111111111111";
const BIA = "22222222-2222-4222-8222-222222222222";
const SPOT = "33333333-3333-4333-8333-333333333333";
const MEETUP = "44444444-4444-4444-8444-444444444444";

const ana = { id: ANA, isAdmin: false };
const bia = { id: BIA, isAdmin: false };
const admin = { id: "99999999-9999-4999-8999-999999999999", isAdmin: true };

const NOW = new Date("2026-10-21T12:00:00.000Z");
const TOMORROW = new Date("2026-10-22T18:00:00.000Z");

const person = (id: string, username: string) => ({ id, name: username, username, avatarUrl: null, skateLevel: null });

function makeSpot(overrides: Record<string, unknown> = {}) {
  return {
    id: SPOT,
    name: "Praça Roosevelt",
    description: null,
    type: "STREET",
    address: "Consolação, São Paulo",
    latitude: -23.5489,
    longitude: -46.6453,
    status: "APROVADO",
    reviewedAt: null,
    createdById: ANA,
    createdBy: { ...person(ANA, "ana"), suspendedAt: null },
    createdAt: NOW,
    images: [],
    meetups: [],
    ...overrides,
  };
}

function makeMeetup(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETUP,
    title: "Sessão de sábado",
    description: null,
    startsAt: TOMORROW,
    maxParticipants: null,
    cancelledAt: null,
    spotId: SPOT,
    creatorId: ANA,
    createdAt: NOW,
    spot: { id: SPOT, name: "Praça Roosevelt", address: null, type: "STREET" },
    creator: person(ANA, "ana"),
    participants: [],
    _count: { participants: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  prisma.meetupParticipant.findMany.mockResolvedValue([]);
});

describe("spots", () => {
  it("o mapa só mostra spots aprovados, com a capa e os encontros marcados", async () => {
    prisma.spot.findMany.mockResolvedValue([
      { id: SPOT, name: "Praça Roosevelt", type: "STREET", address: null, latitude: 1, longitude: 2, images: [{ id: "img" }], _count: { meetups: 2 } },
    ]);

    const list = await spots.listSpots(NOW);

    expect(prisma.spot.findMany.mock.calls[0][0].where).toEqual({ status: "APROVADO" });
    expect(list[0]).toMatchObject({ coverUrl: "/api/spots/images/img", upcomingMeetups: 2 });
  });

  it("sugestão de usuário fica pendente; a do administrador já entra aprovada", async () => {
    prisma.spot.create.mockResolvedValue({ id: SPOT, status: "PENDENTE" });
    const input = { name: "Pico", type: "STREET" as const, latitude: 1, longitude: 2 };

    await spots.createSpot(ana, input);
    expect(prisma.spot.create.mock.calls[0][0].data).not.toHaveProperty("status");

    await spots.createSpot(admin, input);
    expect(prisma.spot.create.mock.calls[1][0].data).toMatchObject({ status: "APROVADO" });
  });

  it("recusa mais de 3 fotos", async () => {
    const images = Array.from({ length: 4 }, () => Buffer.from([0xff, 0xd8, 0xff]));
    await expect(
      spots.createSpot(ana, { name: "Pico", type: "STREET", latitude: 1, longitude: 2, images }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.spot.create).not.toHaveBeenCalled();
  });

  it("spot pendente só aparece para quem sugeriu e para a equipe", async () => {
    prisma.spot.findUnique.mockResolvedValue(makeSpot({ status: "PENDENTE" }));

    await expect(spots.getSpot(SPOT, bia, NOW)).rejects.toMatchObject({ statusCode: 404 });
    await expect(spots.getSpot(SPOT, ana, NOW)).resolves.toMatchObject({ status: "PENDENTE", canDelete: true });
    await expect(spots.getSpot(SPOT, admin, NOW)).resolves.toMatchObject({ canDelete: true });
  });

  it("não mostra quem sugeriu se a conta estiver suspensa", async () => {
    prisma.spot.findUnique.mockResolvedValue(
      makeSpot({ createdBy: { ...person(ANA, "ana"), suspendedAt: NOW } }),
    );
    expect((await spots.getSpot(SPOT, bia, NOW)).createdBy).toBeNull();
  });

  it("depois de aprovado, quem sugeriu não apaga mais (só a equipe)", async () => {
    prisma.spot.findUnique.mockResolvedValue({ status: "APROVADO", createdById: ANA });

    await expect(spots.deleteSpot(SPOT, ana)).rejects.toMatchObject({ statusCode: 403 });
    await spots.deleteSpot(SPOT, admin);
    expect(prisma.spot.delete).toHaveBeenCalledTimes(1);
  });

  it("quem sugeriu apaga a própria sugestão pendente", async () => {
    prisma.spot.findUnique.mockResolvedValue({ status: "PENDENTE", createdById: ANA });
    await spots.deleteSpot(SPOT, ana);
    expect(prisma.spot.delete).toHaveBeenCalledWith({ where: { id: SPOT } });
  });

  it("aprovar marca a data da revisão", async () => {
    prisma.spot.findUnique.mockResolvedValue({ id: SPOT });
    prisma.spot.update.mockResolvedValue({ id: SPOT, status: "APROVADO" });

    await spots.reviewSpot(SPOT, "APROVADO");

    expect(prisma.spot.update.mock.calls[0][0].data).toMatchObject({ status: "APROVADO", reviewedAt: expect.any(Date) });
  });
});

describe("criar encontro", () => {
  it("só em spot aprovado", async () => {
    prisma.spot.findUnique.mockResolvedValue({ status: "PENDENTE" });
    await expect(spots.createMeetup(SPOT, ana, { title: "Sessão", startsAt: TOMORROW }, NOW)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("recusa data que já passou ou muito distante", async () => {
    prisma.spot.findUnique.mockResolvedValue({ status: "APROVADO" });

    await expect(
      spots.createMeetup(SPOT, ana, { title: "Sessão", startsAt: new Date("2026-10-20T12:00:00.000Z") }, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      spots.createMeetup(SPOT, ana, { title: "Sessão", startsAt: new Date("2027-03-01T12:00:00.000Z") }, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.meetup.create).not.toHaveBeenCalled();
  });

  it("quem cria já entra confirmado", async () => {
    prisma.spot.findUnique.mockResolvedValue({ status: "APROVADO" });
    prisma.meetup.create.mockResolvedValue(makeMeetup({ participants: [{ userId: ANA }] }));

    const meetup = await spots.createMeetup(SPOT, ana, { title: "Sessão", startsAt: TOMORROW, maxParticipants: 10 }, NOW);

    expect(prisma.meetup.create.mock.calls[0][0].data.participants).toEqual({ create: { userId: ANA } });
    // Quem criou só desmarca a própria ida; cancelar para todos é coisa da equipe
    expect(meetup).toMatchObject({ joinedByMe: true, isCreator: true, canCancel: false });
  });
});

describe("presença", () => {
  it("confirma presença", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup());

    await spots.joinMeetup(MEETUP, bia, NOW);

    expect(prisma.meetupParticipant.create).toHaveBeenCalledWith({ data: { meetupId: MEETUP, userId: BIA } });
  });

  it("não deixa entrar em encontro lotado", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ maxParticipants: 2, _count: { participants: 2 } }));

    await expect(spots.joinMeetup(MEETUP, bia, NOW)).rejects.toMatchObject({ statusCode: 409, code: "MEETUP_FULL" });
    expect(prisma.meetupParticipant.create).not.toHaveBeenCalled();
  });

  it("não deixa entrar em encontro cancelado ou que já começou", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ cancelledAt: NOW }));
    await expect(spots.joinMeetup(MEETUP, bia, NOW)).rejects.toMatchObject({ code: "MEETUP_CANCELLED" });

    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ startsAt: new Date("2026-10-21T11:00:00.000Z") }));
    await expect(spots.joinMeetup(MEETUP, bia, NOW)).rejects.toMatchObject({ code: "MEETUP_STARTED" });
  });

  it("confirmar de novo não duplica", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ participants: [{ userId: BIA }] }));
    await spots.joinMeetup(MEETUP, bia, NOW);
    expect(prisma.meetupParticipant.create).not.toHaveBeenCalled();
  });

  it("qualquer um desmarca a ida, inclusive quem criou, sem cancelar o encontro", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup());

    await spots.leaveMeetup(MEETUP, ana, NOW);
    await spots.leaveMeetup(MEETUP, bia, NOW);

    expect(prisma.meetupParticipant.deleteMany).toHaveBeenCalledWith({ where: { meetupId: MEETUP, userId: ANA } });
    expect(prisma.meetupParticipant.deleteMany).toHaveBeenCalledWith({ where: { meetupId: MEETUP, userId: BIA } });
    expect(prisma.meetup.update).not.toHaveBeenCalled();
  });

  it("depois de desmarcar, dá para confirmar de novo", async () => {
    // Já fora da lista (participants vazio para quem está vendo)
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ participants: [] }));

    await spots.joinMeetup(MEETUP, ana, NOW);

    expect(prisma.meetupParticipant.create).toHaveBeenCalledWith({ data: { meetupId: MEETUP, userId: ANA } });
  });

  it("quem criou continua vendo o encontro em Meus encontros depois de desmarcar", async () => {
    prisma.meetup.findMany.mockResolvedValue([]);
    await spots.listMyMeetups(ana, NOW);
    expect(prisma.meetup.findMany.mock.calls[0][0].where.OR).toEqual([
      { participants: { some: { userId: ANA } } },
      { creatorId: ANA },
    ]);
  });
});

describe("cancelar encontro", () => {
  it("só um administrador cancela para todos (nem quem criou)", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup());

    await expect(spots.cancelMeetup(MEETUP, bia, NOW)).rejects.toMatchObject({ statusCode: 403 });
    await expect(spots.cancelMeetup(MEETUP, ana, NOW)).rejects.toMatchObject({ statusCode: 403 });
    await spots.cancelMeetup(MEETUP, admin, NOW);
    expect(prisma.meetup.update).toHaveBeenCalledWith({ where: { id: MEETUP }, data: { cancelledAt: NOW } });
  });

  it("não cancela de novo nem depois que começou", async () => {
    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ cancelledAt: NOW }));
    await expect(spots.cancelMeetup(MEETUP, admin, NOW)).rejects.toMatchObject({ statusCode: 409 });

    prisma.meetup.findFirst.mockResolvedValue(makeMeetup({ startsAt: new Date("2026-10-21T11:00:00.000Z") }));
    await expect(spots.cancelMeetup(MEETUP, admin, NOW)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.meetup.update).not.toHaveBeenCalled();
  });

  it("os cancelados continuam na lista de quem confirmou", async () => {
    prisma.meetup.findMany.mockResolvedValue([makeMeetup({ cancelledAt: NOW, participants: [{ userId: BIA }] })]);

    const [meetup] = await spots.listMyMeetups(bia, NOW);

    expect(prisma.meetup.findMany.mock.calls[0][0].where).not.toHaveProperty("cancelledAt");
    expect(meetup).toMatchObject({ cancelled: true, joinedByMe: true, canCancel: false });
  });
});
