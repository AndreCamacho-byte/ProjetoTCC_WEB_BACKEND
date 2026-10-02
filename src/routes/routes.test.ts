import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { app } from "../app";
import { env } from "../config/env";
import { makeUser, prisma } from "../test/prismaMock";

// Testa as rotas pelo lado de fora (requisição HTTP -> resposta), com o banco simulado:
// confere a validação dos dados, os códigos de status e as proteções de acesso.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const tokenFor = (userId: string) => jwt.sign({ sub: userId }, env.JWT_SECRET);
const bearer = (userId = USER_ID) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

describe("GET /api/health", () => {
  it("informa quando o banco está conectado", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", database: "connected" });
  });

  it("continua respondendo 200 quando o banco está fora do ar", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("sem conexão"));
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.database).toBe("disconnected");
  });
});

describe("POST /api/auth/register", () => {
  const valid = { name: "Tony Teste", email: "tony@clutch.test", password: "skate1234", birthDate: "2000-01-15" };

  it("aponta cada campo inválido", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "A", email: "nao-e-email", password: "123", birthDate: "2005-02-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Dados inválidos");
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
      "birthDate",
      "email",
      "name",
      "password",
    ]);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("exige a data de nascimento", async () => {
    const { birthDate: _, ...withoutDate } = valid;
    const res = await request(app).post("/api/auth/register").send(withoutDate);
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("birthDate");
  });

  it("cria a conta, normaliza o email e não devolve token", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => makeUser({ ...data, emailVerifiedAt: null }));

    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, email: "  Tony@Clutch.TEST " });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("tony@clutch.test");
    expect(res.body).not.toHaveProperty("token");
  });

  it("responde 409 para email já cadastrado", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/auth/login", () => {
  it("responde 401 para email desconhecido", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/auth/login").send({ email: "x@clutch.test", password: "skate1234" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Email ou senha incorretos" });
  });

  it("responde 403 com o código EMAIL_NOT_VERIFIED para conta não confirmada", async () => {
    const passwordHash = await bcrypt.hash("skate1234", 4);
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, emailVerifiedAt: null }));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "tony@clutch.test", password: "skate1234" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("devolve usuário (sem a senha) e token no login correto", async () => {
    const passwordHash = await bcrypt.hash("skate1234", 4);
    prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "tony@clutch.test", password: "skate1234" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });
});

describe("POST /api/auth/verify-code", () => {
  it.each(["12345", "1234567", "12a456", ""])("recusa o código mal formatado %j", async (code) => {
    const res = await request(app).post("/api/auth/verify-code").send({ email: "tony@clutch.test", code });
    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  it("recusa senha nova com menos de 8 caracteres", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "abc", password: "1234567" });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("password");
  });
});

describe("GET /api/auth/me", () => {
  it("responde 401 sem token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("devolve o usuário logado, sem a senha", async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());
    const res = await request(app).get("/api/auth/me").set(bearer());
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("tony@clutch.test");
    expect(res.body).not.toHaveProperty("passwordHash");
  });
});

describe("rotas de administrador", () => {
  it("respondem 401 sem login", async () => {
    expect((await request(app).get("/api/admin/users")).status).toBe(401);
    expect((await request(app).patch(`/api/admin/users/${USER_ID}`).send({ name: "X Y" })).status).toBe(401);
    expect((await request(app).delete(`/api/admin/users/${USER_ID}`)).status).toBe(401);
  });

  it("respondem 403 para conta comum", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "USER" });
    const res = await request(app).get("/api/admin/users").set(bearer());
    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("listam os usuários para um administrador", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    prisma.user.findMany.mockResolvedValue([makeUser()]);
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).get("/api/admin/users?page=1&search=tony").set(bearer());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(res.body.users[0]).not.toHaveProperty("passwordHash");
  });

  it("recusam id que não é um UUID", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const res = await request(app).delete("/api/admin/users/abc").set(bearer());
    expect(res.status).toBe(400);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("recusam página maior que o limite de 100 por página", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const res = await request(app).get("/api/admin/users?pageSize=500").set(bearer());
    expect(res.status).toBe(400);
  });
});

describe("configurações da conta", () => {
  it("exigem login", async () => {
    expect((await request(app).patch("/api/users/me").send({ name: "X Y" })).status).toBe(401);
    expect((await request(app).put("/api/users/me/avatar").send({ image: "x" })).status).toBe(401);
    expect((await request(app).delete("/api/users/me").send({ password: "x" })).status).toBe(401);
  });

  it.each(["A B", "ab", "COM_MAIUSCULA!", "nome-com-hifen"])("recusam o @username inválido %j", async (username) => {
    const res = await request(app).patch("/api/users/me").set(bearer()).send({ username });
    expect(res.status).toBe(400);
  });

  it("recusam alteração sem nenhum campo", async () => {
    const res = await request(app).patch("/api/users/me").set(bearer()).send({});
    expect(res.status).toBe(400);
  });

  it("recusam excluir a conta sem informar a senha", async () => {
    const res = await request(app).delete("/api/users/me").set(bearer()).send({});
    expect(res.status).toBe(400);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});

describe("foto de perfil", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
  const dataUrl = (bytes: Buffer, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;

  beforeEach(() => {
    prisma.user.update.mockImplementation(async ({ data }) => makeUser(data));
  });

  it("aceita um JPEG válido", async () => {
    const res = await request(app).put("/api/users/me/avatar").set(bearer()).send({ image: dataUrl(jpeg) });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toContain(`/api/users/${USER_ID}/avatar?v=`);
  });

  it("recusa PNG", async () => {
    const res = await request(app)
      .put("/api/users/me/avatar")
      .set(bearer())
      .send({ image: dataUrl(jpeg, "image/png") });
    expect(res.status).toBe(400);
  });

  it("recusa um arquivo que diz ser JPEG mas não é", async () => {
    const res = await request(app)
      .put("/api/users/me/avatar")
      .set(bearer())
      .send({ image: dataUrl(Buffer.from("isto não é uma imagem")) });
    expect(res.status).toBe(400);
    expect(prisma.userAvatar.upsert).not.toHaveBeenCalled();
  });

  it("recusa foto acima de 300 KB", async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(301 * 1024, 1)]);
    const res = await request(app).put("/api/users/me/avatar").set(bearer()).send({ image: dataUrl(big) });
    expect(res.status).toBe(413);
  });

  it("serve a foto publicamente, como imagem e com cache longo", async () => {
    prisma.userAvatar.findUnique.mockResolvedValue({ userId: USER_ID, data: new Uint8Array(jpeg) });

    const res = await request(app).get(`/api/users/${USER_ID}/avatar`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(res.body)).toEqual(jpeg);
  });

  it("responde 404 quando a pessoa não tem foto", async () => {
    prisma.userAvatar.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/users/${USER_ID}/avatar`);
    expect(res.status).toBe(404);
  });
});

describe("outras respostas", () => {
  it("responde 404 em JSON para rota que não existe", async () => {
    const res = await request(app).get("/api/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/nao-existe");
  });

  it("publica a documentação do Swagger com todas as rotas", async () => {
    const res = await request(app).get("/api/docs.json");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/auth/register",
        "/auth/login",
        "/auth/verify-code",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/users/me",
        "/users/me/avatar",
        "/users/me/birth-date",
        "/admin/users",
        "/admin/users/{id}",
      ]),
    );
  });

  it("responde 503 quando o banco cai no meio de uma requisição", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { Prisma } = await import("@prisma/client");
    prisma.user.findUnique.mockRejectedValue(new Prisma.PrismaClientInitializationError("sem conexão", "6.0.0"));

    const res = await request(app).post("/api/auth/login").send({ email: "tony@clutch.test", password: "skate1234" });

    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });
});
