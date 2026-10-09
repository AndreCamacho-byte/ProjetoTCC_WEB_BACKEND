import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));
vi.mock("../lib/mail", () => ({ sendMail: vi.fn() }));

import { app } from "../app";
import { env } from "../config/env";
import { resetRateLimits } from "../middlewares/rateLimit";
import { makeUser, prisma } from "../test/prismaMock";

// Rotas da loja vistas de fora: quem pode acessar o quê e a validação dos dados.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "66666666-6666-4666-8666-666666666666";
const IMAGE_ID = "77777777-7777-4777-8777-777777777777";

const bearer = { Authorization: `Bearer ${jwt.sign({ sub: USER_ID }, env.JWT_SECRET)}` };
const loggedAs = (overrides: Parameters<typeof makeUser>[0] = {}) =>
  prisma.user.findUnique.mockResolvedValue(makeUser(overrides));

const product = {
  id: PRODUCT_ID,
  name: "Camiseta Clutch Logo",
  description: "Algodão pesado",
  price: new Prisma.Decimal(119.9),
  active: true,
  brandId: BRAND_ID,
  brand: { id: BRAND_ID, name: "Clutch", description: null, website: null },
  images: [],
  variants: [{ id: VARIANT_ID, productId: PRODUCT_ID, size: "M", stock: 5 }],
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
};

const address = {
  recipientName: "Tony Teste",
  zipCode: "01310-100",
  street: "Avenida Paulista",
  addressNumber: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  state: "sp",
};

beforeEach(() => {
  resetRateLimits();
});

describe("catálogo (público)", () => {
  it("lista os produtos sem pedir login", async () => {
    prisma.product.findMany.mockResolvedValue([product]);
    prisma.product.count.mockResolvedValue(1);

    const res = await request(app).get("/api/products?search=camiseta");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 12 });
    expect(res.body.products[0]).toMatchObject({ name: "Camiseta Clutch Logo", price: 119.9 });
  });

  it("recusa paginação e ids inválidos", async () => {
    expect((await request(app).get("/api/products?pageSize=500")).status).toBe(400);
    expect((await request(app).get("/api/products/abc")).status).toBe(400);
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it("responde 404 para produto desativado", async () => {
    prisma.product.findUnique.mockResolvedValue({ ...product, active: false });
    expect((await request(app).get(`/api/products/${PRODUCT_ID}`)).status).toBe(404);
  });

  it("entrega a foto como JPEG, com cache longo", async () => {
    prisma.productImage.findUnique.mockResolvedValue({ id: IMAGE_ID, data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });

    const res = await request(app).get(`/api/products/images/${IMAGE_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toHaveLength(4);
  });

  it("lista as marcas", async () => {
    prisma.brand.findMany.mockResolvedValue([product.brand]);
    const res = await request(app).get("/api/brands");
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe("Clutch");
  });
});

describe("carrinho e pedidos (login + 12 anos)", () => {
  const protectedRoutes = [
    ["get", "/api/cart"],
    ["put", "/api/cart/items"],
    ["delete", `/api/cart/items/${VARIANT_ID}`],
    ["post", "/api/orders"],
    ["get", "/api/orders"],
    ["get", `/api/orders/${ORDER_ID}`],
  ] as const;

  it.each(protectedRoutes)("%s %s exige login", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it.each(protectedRoutes)("%s %s barra menor de 12 anos", async (method, path) => {
    const eightYearsAgo = new Date();
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);
    loggedAs({ birthDate: eightYearsAgo });

    const res = await request(app)[method](path).set(bearer);
    expect(res.status).toBe(403);
  });

  it("barra conta sem data de nascimento", async () => {
    loggedAs({ birthDate: null });
    const res = await request(app).get("/api/cart").set(bearer);
    expect(res.status).toBe(403);
    expect(prisma.cartItem.findMany).not.toHaveBeenCalled();
  });

  it("mostra o carrinho de quem está logado", async () => {
    loggedAs();
    prisma.cartItem.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/cart").set(bearer);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, count: 0 });
    expect(prisma.cartItem.findMany.mock.calls[0][0].where).toEqual({ userId: USER_ID });
  });

  it("valida a quantidade do item", async () => {
    loggedAs();

    for (const quantity of [0, 11, 1.5, "2"]) {
      const res = await request(app).put("/api/cart/items").set(bearer).send({ variantId: VARIANT_ID, quantity });
      expect(res.status).toBe(400);
    }
    expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("responde 409 quando não há estoque", async () => {
    loggedAs();
    prisma.productVariant.findUnique.mockResolvedValue({ id: VARIANT_ID, stock: 1, product: { active: true } });

    const res = await request(app).put("/api/cart/items").set(bearer).send({ variantId: VARIANT_ID, quantity: 2 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("OUT_OF_STOCK");
  });

  it("aponta os campos do endereço que faltam", async () => {
    loggedAs();

    const res = await request(app).post("/api/orders").set(bearer).send({ ...address, zipCode: "123", state: "XX", city: "" });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(["city", "state", "zipCode"]);
    expect(prisma.cartItem.findMany).not.toHaveBeenCalled();
  });

  it("limpa o CEP e a sigla do estado antes de fechar o pedido", async () => {
    loggedAs();
    prisma.cartItem.findMany.mockResolvedValue([]);

    const res = await request(app).post("/api/orders").set(bearer).send(address);

    // Com o endereço aceito, a recusa passa a ser pelo carrinho vazio
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMPTY_CART");
  });

  it("não mostra pedido de outra pessoa", async () => {
    loggedAs();
    prisma.order.findUnique.mockResolvedValue({ id: ORDER_ID, userId: "outra-pessoa", items: [] });

    const res = await request(app).get(`/api/orders/${ORDER_ID}`).set(bearer);
    expect(res.status).toBe(404);
  });
});

describe("administração da loja", () => {
  const adminRoutes = [
    ["post", "/api/admin/brands"],
    ["patch", `/api/admin/brands/${BRAND_ID}`],
    ["delete", `/api/admin/brands/${BRAND_ID}`],
    ["get", "/api/admin/products"],
    ["post", "/api/admin/products"],
    ["get", `/api/admin/products/${PRODUCT_ID}`],
    ["patch", `/api/admin/products/${PRODUCT_ID}`],
    ["delete", `/api/admin/products/${PRODUCT_ID}`],
    ["post", `/api/admin/products/${PRODUCT_ID}/images`],
    ["delete", `/api/admin/products/images/${IMAGE_ID}`],
    ["get", "/api/admin/orders"],
    ["patch", `/api/admin/orders/${ORDER_ID}`],
  ] as const;

  it.each(adminRoutes)("%s %s exige login", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it.each(adminRoutes)("%s %s recusa quem não é administrador", async (method, path) => {
    loggedAs({ role: "USER" });
    const res = await request(app)[method](path).set(bearer);
    expect(res.status).toBe(403);
  });

  const newProduct = {
    name: "Camiseta Clutch Logo",
    description: "Algodão pesado",
    price: 119.999,
    brandId: BRAND_ID,
    variants: [{ size: "M", stock: 5 }],
  };

  it("cadastra produto arredondando o preço para centavos", async () => {
    loggedAs({ role: "ADMIN" });
    prisma.brand.findUnique.mockResolvedValue(product.brand);
    prisma.product.create.mockResolvedValue(product);

    const res = await request(app).post("/api/admin/products").set(bearer).send(newProduct);

    expect(res.status).toBe(201);
    expect(prisma.product.create.mock.calls[0][0].data.price).toBe(120);
  });

  it("valida os dados do produto", async () => {
    loggedAs({ role: "ADMIN" });

    const res = await request(app)
      .post("/api/admin/products")
      .set(bearer)
      .send({ ...newProduct, price: -5, variants: [] });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(["price", "variants"]);
  });

  it("o administrador vê produto desativado", async () => {
    loggedAs({ role: "ADMIN" });
    prisma.product.findUnique.mockResolvedValue({ ...product, active: false });

    const res = await request(app).get(`/api/admin/products/${PRODUCT_ID}`).set(bearer);
    expect(res.status).toBe(200);
  });

  const jpeg = (bytes: number[]) => `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

  it("aceita foto JPEG", async () => {
    loggedAs({ role: "ADMIN" });
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.productImage.create.mockResolvedValue({ id: IMAGE_ID });

    const res = await request(app)
      .post(`/api/admin/products/${PRODUCT_ID}/images`)
      .set(bearer)
      .send({ image: jpeg([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe(`/api/products/images/${IMAGE_ID}`);
  });

  it("recusa arquivo que não é JPEG de verdade", async () => {
    loggedAs({ role: "ADMIN" });
    const url = `/api/admin/products/${PRODUCT_ID}/images`;

    // Diz que é JPEG, mas o conteúdo é outro
    expect((await request(app).post(url).set(bearer).send({ image: jpeg([1, 2, 3, 4]) })).status).toBe(400);
    expect((await request(app).post(url).set(bearer).send({ image: "data:image/svg+xml;base64,AAAA" })).status).toBe(400);
    expect(prisma.productImage.create).not.toHaveBeenCalled();
  });

  it("recusa foto acima de 600 KB", async () => {
    loggedAs({ role: "ADMIN" });
    const big = Buffer.alloc(601 * 1024, 1);
    big.set([0xff, 0xd8, 0xff]);

    const res = await request(app)
      .post(`/api/admin/products/${PRODUCT_ID}/images`)
      .set(bearer)
      .send({ image: `data:image/jpeg;base64,${big.toString("base64")}` });

    expect(res.status).toBe(413);
  });

  it("só aceita situações de pedido que existem", async () => {
    loggedAs({ role: "ADMIN" });

    const res = await request(app).patch(`/api/admin/orders/${ORDER_ID}`).set(bearer).send({ status: "DEVOLVIDO" });

    expect(res.status).toBe(400);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });
});
