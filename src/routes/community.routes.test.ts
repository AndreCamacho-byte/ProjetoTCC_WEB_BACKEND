import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { app } from "../app";
import { env } from "../config/env";
import { resetRateLimits } from "../middlewares/rateLimit";
import { makeUser, prisma } from "../test/prismaMock";

// Rotas da comunidade e a suspensão de contas, vistas de fora

const USER_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "33333333-3333-4333-8333-333333333333";

const bearer = { Authorization: `Bearer ${jwt.sign({ sub: USER_ID }, env.JWT_SECRET)}` };
const loggedAs = (overrides: Parameters<typeof makeUser>[0] = {}) =>
  prisma.user.findUnique.mockResolvedValue(makeUser(overrides));

const jpeg = (bytes: number[]) => `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

const createdPost = {
  id: POST_ID,
  content: "Sessão de hoje",
  authorId: USER_ID,
  author: { id: USER_ID, name: "Tony Teste", username: "tony", avatarUrl: null, skateLevel: null },
  image: null,
  likes: [],
  _count: { likes: 0, comments: 0 },
  createdAt: new Date("2026-10-10T12:00:00.000Z"),
  updatedAt: new Date("2026-10-10T12:00:00.000Z"),
};

beforeEach(() => {
  resetRateLimits();
});

describe("comunidade exige login", () => {
  const routes = [
    ["get", "/api/posts"],
    ["post", "/api/posts"],
    ["get", `/api/posts/${POST_ID}`],
    ["delete", `/api/posts/${POST_ID}`],
    ["put", `/api/posts/${POST_ID}/like`],
    ["get", `/api/posts/${POST_ID}/comments`],
    ["post", `/api/posts/${POST_ID}/comments`],
    ["get", "/api/profiles?search=tony"],
    ["get", "/api/profiles/tony"],
    ["put", "/api/profiles/tony/follow"],
  ] as const;

  it.each(routes)("%s %s", async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });

  it("a foto do post é pública (a tag <img> não manda o token)", async () => {
    prisma.postImage.findUnique.mockResolvedValue({ postId: POST_ID, data: new Uint8Array([0xff, 0xd8, 0xff]) });

    const res = await request(app).get(`/api/posts/${POST_ID}/image`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
  });

  it("menor de 12 anos pode usar a comunidade", async () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    loggedAs({ birthDate: tenYearsAgo });
    prisma.post.findMany.mockResolvedValue([]);

    expect((await request(app).get("/api/posts").set(bearer)).status).toBe(200);
  });
});

describe("POST /api/posts", () => {
  it("valida o tamanho do texto", async () => {
    loggedAs();
    const res = await request(app).post("/api/posts").set(bearer).send({ content: "a".repeat(501) });
    expect(res.status).toBe(400);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("recusa foto que não é JPEG de verdade", async () => {
    loggedAs();
    const res = await request(app).post("/api/posts").set(bearer).send({ content: "oi", image: jpeg([1, 2, 3]) });
    expect(res.status).toBe(400);
  });

  it("publica o post", async () => {
    loggedAs();
    prisma.post.create.mockResolvedValue(createdPost);

    const res = await request(app).post("/api/posts").set(bearer).send({ content: "  Sessão de hoje  " });

    expect(res.status).toBe(201);
    expect(prisma.post.create.mock.calls[0][0].data.content).toBe("Sessão de hoje");
    expect(res.body).toMatchObject({ id: POST_ID, canDelete: true, likedByMe: false });
  });

  it("limita a 30 posts por hora por conta", async () => {
    loggedAs();
    prisma.post.create.mockResolvedValue(createdPost);

    for (let i = 0; i < 30; i++) {
      await request(app).post("/api/posts").set(bearer).send({ content: "spam" });
    }
    const res = await request(app).post("/api/posts").set(bearer).send({ content: "spam" });

    expect(res.status).toBe(429);
    expect(prisma.post.create).toHaveBeenCalledTimes(30);
  });
});

describe("comentários e perfis", () => {
  it("comentário vazio é recusado", async () => {
    loggedAs();
    const res = await request(app).post(`/api/posts/${POST_ID}/comments`).set(bearer).send({ content: "   " });
    expect(res.status).toBe(400);
  });

  it("feed com valor inválido é recusado", async () => {
    loggedAs();
    expect((await request(app).get("/api/posts?feed=amigos").set(bearer)).status).toBe(400);
  });

  it("perfil nunca traz email nem data de nascimento", async () => {
    loggedAs();
    prisma.user.findFirst.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Outra Pessoa",
      username: "outra",
      avatarUrl: null,
      skateLevel: "AVANCADO",
      bio: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prisma.follow.count.mockResolvedValue(0);
    prisma.post.count.mockResolvedValue(0);

    const res = await request(app).get("/api/profiles/Outra").set(bearer);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("email");
    expect(res.body).not.toHaveProperty("birthDate");
    // O @ é procurado em minúsculas
    expect(prisma.user.findFirst.mock.calls[0][0].where.username).toBe("outra");
  });
});

describe("conta suspensa", () => {
  it("perde o acesso na hora", async () => {
    loggedAs({ suspendedAt: new Date() });

    const res = await request(app).get("/api/auth/me").set(bearer);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("muda bio e nível de skate nas configurações", async () => {
    loggedAs();
    prisma.user.update.mockImplementation(async ({ data }) => makeUser(data));

    const res = await request(app).patch("/api/users/me").set(bearer).send({ bio: "  ", skateLevel: "INICIANTE" });

    expect(res.status).toBe(200);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ bio: null, skateLevel: "INICIANTE" });
  });

  it("nível de skate inválido é recusado", async () => {
    loggedAs();
    const res = await request(app).patch("/api/users/me").set(bearer).send({ skateLevel: "LENDA" });
    expect(res.status).toBe(400);
  });
});
