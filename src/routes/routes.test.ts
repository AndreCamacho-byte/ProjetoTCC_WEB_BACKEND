import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { app } from "../app";
import { env } from "../config/env";
import { sendMail } from "../lib/mail";
import { resetRateLimits } from "../middlewares/rateLimit";
import { makeUser, prisma } from "../test/prismaMock";

// Testa as rotas pelo lado de fora (requisição HTTP -> resposta), com o banco simulado:
// confere a validação dos dados, os códigos de status e as proteções de acesso.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const tokenFor = (userId: string) => jwt.sign({ sub: userId }, env.JWT_SECRET);
const bearer = (userId = USER_ID) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

// Define a conta que o banco simulado devolve (é ela que o requireAuth encontra pelo token)
const loggedAs = (overrides: Parameters<typeof makeUser>[0] = {}) =>
  prisma.user.findUnique.mockResolvedValue(makeUser(overrides));

beforeEach(() => {
  resetRateLimits();
});

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

describe("sessões", () => {
  it("recusam o login antigo depois que a senha mudou", async () => {
    loggedAs({ tokenVersion: 1 }); // o token do teste foi emitido na versão 0
    const res = await request(app).get("/api/auth/me").set(bearer());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_EXPIRED");
  });

  it("recusam o token de uma conta excluída", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).patch("/api/users/me").set(bearer()).send({ name: "Novo Nome" });
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("limite de tentativas", () => {
  const login = () => request(app).post("/api/auth/login").send({ email: "x@clutch.test", password: "errada123" });

  it("bloqueia o login depois de 30 tentativas em 15 minutos", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    for (let i = 0; i < 30; i++) expect((await login()).status).toBe(401);

    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("conta cada endereço IP separadamente (cabeçalho X-Real-IP do Nginx)", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 31; i++) await login().set("X-Real-IP", "200.1.1.1");

    expect((await login().set("X-Real-IP", "200.1.1.1")).status).toBe(429);
    expect((await login().set("X-Real-IP", "200.2.2.2")).status).toBe(401);
  });

  it("bloqueia pedidos de email depois de 10 em 15 minutos", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const forgot = () => request(app).post("/api/auth/forgot-password").send({ email: "x@clutch.test" });

    for (let i = 0; i < 10; i++) expect((await forgot()).status).toBe(200);

    expect((await forgot()).status).toBe(429);
  });
});

describe("PATCH /api/users/me/password", () => {
  it("exige login", async () => {
    const res = await request(app).patch("/api/users/me/password").send({ currentPassword: "a", newPassword: "b" });
    expect(res.status).toBe(401);
  });

  it("recusa senha nova com menos de 8 caracteres", async () => {
    loggedAs();
    const res = await request(app)
      .patch("/api/users/me/password")
      .set(bearer())
      .send({ currentPassword: "skate1234", newPassword: "curta" });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("newPassword");
  });

  it("responde 401 quando a senha atual está errada", async () => {
    loggedAs({ passwordHash: await bcrypt.hash("skate1234", 4) });
    const res = await request(app)
      .patch("/api/users/me/password")
      .set(bearer())
      .send({ currentPassword: "errada123", newPassword: "novasenha1" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WRONG_PASSWORD");
  });

  it("troca a senha e devolve um token novo", async () => {
    loggedAs({ passwordHash: await bcrypt.hash("skate1234", 4) });
    prisma.user.update.mockResolvedValue(makeUser({ tokenVersion: 1 }));

    const res = await request(app)
      .patch("/api/users/me/password")
      .set(bearer())
      .send({ currentPassword: "skate1234", newPassword: "novasenha1" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty("tokenVersion");
  });
});

describe("rotas de administrador", () => {
  it("respondem 401 sem login", async () => {
    expect((await request(app).get("/api/admin/users")).status).toBe(401);
    expect((await request(app).patch(`/api/admin/users/${USER_ID}`).send({ name: "X Y" })).status).toBe(401);
    expect((await request(app).delete(`/api/admin/users/${USER_ID}`)).status).toBe(401);
  });

  it("respondem 403 para conta comum", async () => {
    loggedAs({ role: "USER" });
    const res = await request(app).get("/api/admin/users").set(bearer());
    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("listam os usuários para um administrador", async () => {
    loggedAs({ role: "ADMIN" });
    prisma.user.findMany.mockResolvedValue([makeUser()]);
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).get("/api/admin/users?page=1&search=tony").set(bearer());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(res.body.users[0]).not.toHaveProperty("passwordHash");
  });

  it("recusam id que não é um UUID", async () => {
    loggedAs({ role: "ADMIN" });
    const res = await request(app).delete("/api/admin/users/abc").set(bearer());
    expect(res.status).toBe(400);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("recusam página maior que o limite de 100 por página", async () => {
    loggedAs({ role: "ADMIN" });
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
    loggedAs();
    const res = await request(app).patch("/api/users/me").set(bearer()).send({ username });
    expect(res.status).toBe(400);
  });

  it("recusam alteração sem nenhum campo", async () => {
    loggedAs();
    const res = await request(app).patch("/api/users/me").set(bearer()).send({});
    expect(res.status).toBe(400);
  });

  it("recusam excluir a conta sem informar a senha", async () => {
    loggedAs();
    const res = await request(app).delete("/api/users/me").set(bearer()).send({});
    expect(res.status).toBe(400);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});

describe("foto de perfil", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
  const dataUrl = (bytes: Buffer, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;

  beforeEach(() => {
    loggedAs();
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
        "/users/me/password",
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

describe("cabeçalhos de segurança", () => {
  it("vão em todas as respostas da API, sem anunciar a tecnologia do servidor", async () => {
    const res = await request(app).get("/api/nao-existe");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("endereço usado nos links dos emails", () => {
  const register = () =>
    request(app)
      .post("/api/auth/register")
      .send({ name: "Tony Teste", email: "tony@clutch.test", password: "skate1234", birthDate: "2000-01-15" });

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => makeUser({ ...data, emailVerifiedAt: null }));
  });

  it("usa o endereço informado pelo Nginx (X-Site-Url), e não o que o navegador diz", async () => {
    await register().set("X-Site-Url", "http://203.0.113.5").set("Origin", "http://site-falso.example");

    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.text).toContain("http://203.0.113.5/confirmar-email?token=");
    expect(mail.text).not.toContain("site-falso");
  });

  it("no computador de desenvolvimento, sem Nginx, usa o endereço de onde veio a requisição", async () => {
    await register().set("Origin", "http://localhost:5173");

    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.text).toContain("http://localhost:5173/confirmar-email?token=");
  });
});
