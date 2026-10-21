import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { app } from "../app";
import { env } from "../config/env";
import { resetRateLimits } from "../middlewares/rateLimit";
import { makeUser, prisma } from "../test/prismaMock";

// Rotas de spots e encontros vistas de fora: login, idade mínima, validação e administração.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SPOT_ID = "33333333-3333-4333-8333-333333333333";
const IMAGE_ID = "77777777-7777-4777-8777-777777777777";

const bearer = { Authorization: `Bearer ${jwt.sign({ sub: USER_ID }, env.JWT_SECRET)}` };
const loggedAs = (overrides: Parameters<typeof makeUser>[0] = {}) =>
  prisma.user.findUnique.mockResolvedValue(makeUser(overrides));

const validSpot = { name: "Praça Roosevelt", type: "STREET", latitude: -23.5489, longitude: -46.6453 };

beforeEach(() => {
  resetRateLimits();
});

describe("acesso", () => {
  it("exige login", async () => {
    expect((await request(app).get("/api/spots")).status).toBe(401);
    expect((await request(app).get("/api/meetups")).status).toBe(401);
  });

  it("bloqueia menor de 12 anos e idade não verificada", async () => {
    loggedAs({ birthDate: new Date("2020-01-01T00:00:00.000Z") });
    expect((await request(app).get("/api/spots").set(bearer)).body.code).toBe("AGE_RESTRICTED");

    loggedAs({ birthDate: null });
    expect((await request(app).get("/api/meetups").set(bearer)).body.code).toBe("AGE_NOT_VERIFIED");
    expect(prisma.spot.findMany).not.toHaveBeenCalled();
  });

  it("a foto do spot é pública e vem com cache longo", async () => {
    prisma.spotImage.findUnique.mockResolvedValue({ id: IMAGE_ID, data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });

    const res = await request(app).get(`/api/spots/images/${IMAGE_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("immutable");
  });
});

describe("sugerir spot", () => {
  it("cria a sugestão", async () => {
    loggedAs();
    prisma.spot.create.mockResolvedValue({ id: SPOT_ID, status: "PENDENTE" });

    const res = await request(app).post("/api/spots").set(bearer).send({ ...validSpot, address: "  " });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: SPOT_ID, status: "PENDENTE" });
    // Endereço em branco vira nulo
    expect(prisma.spot.create.mock.calls[0][0].data.address).toBeNull();
  });

  it("recusa dados inválidos", async () => {
    loggedAs();
    const bad = [
      { ...validSpot, name: "" },
      { ...validSpot, type: "PRAIA" },
      { ...validSpot, latitude: 120 },
      { ...validSpot, longitude: undefined },
      { ...validSpot, images: ["data:image/png;base64,AAAA"] },
    ];
    for (const body of bad) {
      expect((await request(app).post("/api/spots").set(bearer).send(body)).status).toBe(400);
    }
    expect(prisma.spot.create).not.toHaveBeenCalled();
  });

  it("limita 10 sugestões por dia", async () => {
    loggedAs();
    prisma.spot.create.mockResolvedValue({ id: SPOT_ID, status: "PENDENTE" });

    for (let i = 0; i < 10; i++) {
      expect((await request(app).post("/api/spots").set(bearer).send(validSpot)).status).toBe(201);
    }
    expect((await request(app).post("/api/spots").set(bearer).send(validSpot)).status).toBe(429);
  });
});

describe("encontros", () => {
  it("valida o limite de participantes e a data", async () => {
    loggedAs();
    const url = `/api/spots/${SPOT_ID}/meetups`;
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    expect((await request(app).post(url).set(bearer).send({ title: "Sessão", startsAt, maxParticipants: 1 })).status).toBe(400);
    expect((await request(app).post(url).set(bearer).send({ title: "Sessão", startsAt, maxParticipants: 51 })).status).toBe(400);
    expect((await request(app).post(url).set(bearer).send({ title: "Sessão", startsAt: "amanhã" })).status).toBe(400);
    expect(prisma.meetup.create).not.toHaveBeenCalled();
  });

  it("recusa id inválido", async () => {
    loggedAs();
    expect((await request(app).post("/api/meetups/abc/join").set(bearer)).status).toBe(400);
  });
});

describe("administração", () => {
  it("só administrador vê a fila e aprova", async () => {
    loggedAs();
    expect((await request(app).get("/api/admin/spots").set(bearer)).status).toBe(403);
    expect((await request(app).patch(`/api/admin/spots/${SPOT_ID}`).set(bearer).send({ status: "APROVADO" })).status).toBe(403);
  });

  it("administrador aprova", async () => {
    loggedAs({ role: "ADMIN" });
    prisma.spot.findUnique.mockResolvedValue({ id: SPOT_ID });
    prisma.spot.update.mockResolvedValue({ id: SPOT_ID, status: "APROVADO", reviewedAt: new Date() });

    const res = await request(app).patch(`/api/admin/spots/${SPOT_ID}`).set(bearer).send({ status: "APROVADO" });

    expect(res.status).toBe(200);
    expect((await request(app).patch(`/api/admin/spots/${SPOT_ID}`).set(bearer).send({ status: "TALVEZ" })).status).toBe(400);
  });
});
