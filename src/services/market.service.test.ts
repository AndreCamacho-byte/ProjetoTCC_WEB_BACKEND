import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import * as adminMarket from "./adminMarket.service";
import * as cart from "./cart.service";
import * as catalog from "./catalog.service";
import * as orders from "./order.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT_M = "44444444-4444-4444-8444-444444444444";
const VARIANT_G = "55555555-5555-4555-8555-555555555555";
const ORDER_ID = "66666666-6666-4666-8666-666666666666";
const IMAGE_ID = "77777777-7777-4777-8777-777777777777";

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError("erro", { code, clientVersion: "6.0.0" });
const money = (value: number) => new Prisma.Decimal(value);

const brand = { id: BRAND_ID, name: "Clutch", description: null, website: null };

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: "Camiseta Clutch Logo",
    description: "Algodão pesado",
    price: money(119.9),
    active: true,
    brandId: BRAND_ID,
    brand,
    images: [{ id: IMAGE_ID, position: 0 }],
    variants: [
      { id: VARIANT_G, productId: PRODUCT_ID, size: "G", stock: 3 },
      { id: VARIANT_M, productId: PRODUCT_ID, size: "M", stock: 5 },
    ],
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

// Item de carrinho do jeito que o Prisma devolve (com tamanho, produto e marca)
function makeCartItem(overrides: { quantity?: number; stock?: number; active?: boolean; variantId?: string; size?: string } = {}) {
  const { quantity = 2, stock = 5, active = true, variantId = VARIANT_M, size = "M" } = overrides;
  return {
    id: "cart-item",
    userId: USER_ID,
    variantId,
    quantity,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    variant: { id: variantId, productId: PRODUCT_ID, size, stock, product: makeProduct({ active }) },
  };
}

const address = {
  recipientName: "Tony Teste",
  zipCode: "01310100",
  street: "Avenida Paulista",
  addressNumber: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    userId: USER_ID,
    status: "PAGO",
    total: money(239.8),
    createdAt: new Date("2026-10-02T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    complement: null,
    ...address,
    items: [
      {
        id: "order-item",
        orderId: ORDER_ID,
        variantId: VARIANT_M,
        quantity: 2,
        unitPrice: money(119.9),
        productName: "Camiseta Clutch Logo",
        brandName: "Clutch",
        size: "M",
      },
    ],
    ...overrides,
  };
}

describe("catálogo", () => {
  it("ordena os tamanhos de roupa na ordem natural e os demais em ordem numérica", () => {
    expect(["GG", "P", "M", "PP", "G"].sort(catalog.compareSizes)).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(["10", "8.5", "8"].sort(catalog.compareSizes)).toEqual(["8", "8.5", "10"]);
    expect(["42", "M"].sort(catalog.compareSizes)).toEqual(["M", "42"]);
  });

  it("devolve o preço como número, as fotos como endereço e os tamanhos em ordem", async () => {
    prisma.product.findUnique.mockResolvedValue(makeProduct());

    const product = await catalog.getProduct(PRODUCT_ID);

    expect(product.price).toBe(119.9);
    expect(product.images).toEqual([{ id: IMAGE_ID, url: `/api/products/images/${IMAGE_ID}` }]);
    expect(product.variants.map((v) => v.size)).toEqual(["M", "G"]);
    expect(product.brand).toEqual({ id: BRAND_ID, name: "Clutch" });
  });

  it("esconde da loja o produto desativado, mas mostra para o administrador", async () => {
    prisma.product.findUnique.mockResolvedValue(makeProduct({ active: false }));

    await expect(catalog.getProduct(PRODUCT_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(catalog.getProduct(PRODUCT_ID, { includeInactive: true })).resolves.toMatchObject({ active: false });
  });

  it("lista só os ativos, com busca e paginação", async () => {
    prisma.product.findMany.mockResolvedValue([makeProduct()]);
    prisma.product.count.mockResolvedValue(25);

    const result = await catalog.listProducts({ search: "camiseta", brandId: BRAND_ID, page: 2, pageSize: 12 });

    expect(result).toMatchObject({ total: 25, page: 2, pageSize: 12 });
    const args = prisma.product.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 12, take: 12, orderBy: { createdAt: "desc" } });
    expect(args.where).toMatchObject({ active: true, brandId: BRAND_ID });
    expect(args.where.OR).toHaveLength(3);
  });

  it("o painel do administrador lista também os desativados", async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await catalog.listProducts({ page: 1, pageSize: 12, includeInactive: true });

    expect(prisma.product.findMany.mock.calls[0][0].where).not.toHaveProperty("active");
  });

  it("responde 404 para foto que não existe", async () => {
    prisma.productImage.findUnique.mockResolvedValue(null);
    await expect(catalog.getProductImage(IMAGE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("carrinho", () => {
  it("soma os itens e conta as unidades", async () => {
    prisma.cartItem.findMany.mockResolvedValue([
      makeCartItem({ quantity: 2 }),
      makeCartItem({ quantity: 1, variantId: VARIANT_G, size: "G" }),
    ]);

    const result = await cart.getCart(USER_ID);

    expect(result.count).toBe(3);
    expect(result.total).toBe(359.7);
    expect(result.items[0]).toMatchObject({ subtotal: 239.8, unitPrice: 119.9, available: true });
    expect(result.items[0].product.imageUrl).toBe(`/api/products/images/${IMAGE_ID}`);
  });

  it("marca como indisponível o item sem estoque ou de produto desativado", async () => {
    prisma.cartItem.findMany.mockResolvedValue([
      makeCartItem({ quantity: 4, stock: 3 }),
      makeCartItem({ active: false }),
    ]);

    const result = await cart.getCart(USER_ID);

    expect(result.items.map((item) => item.available)).toEqual([false, false]);
  });

  it("guarda a quantidade nova no lugar da antiga", async () => {
    prisma.productVariant.findUnique.mockResolvedValue({ id: VARIANT_M, stock: 5, product: { active: true } });
    prisma.cartItem.findMany.mockResolvedValue([]);

    await cart.setItem(USER_ID, VARIANT_M, 3);

    expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: USER_ID, variantId: VARIANT_M } },
      create: { userId: USER_ID, variantId: VARIANT_M, quantity: 3 },
      update: { quantity: 3 },
    });
  });

  it("recusa quantidade maior que o estoque", async () => {
    prisma.productVariant.findUnique.mockResolvedValue({ id: VARIANT_M, stock: 2, product: { active: true } });

    await expect(cart.setItem(USER_ID, VARIANT_M, 3)).rejects.toMatchObject({
      statusCode: 409,
      code: "OUT_OF_STOCK",
      message: "Só temos 2 unidades deste tamanho",
    });
    expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("avisa quando o tamanho está esgotado", async () => {
    prisma.productVariant.findUnique.mockResolvedValue({ id: VARIANT_M, stock: 0, product: { active: true } });
    await expect(cart.setItem(USER_ID, VARIANT_M, 1)).rejects.toMatchObject({ message: "Este tamanho está esgotado" });
  });

  it("recusa tamanho inexistente ou de produto desativado", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(null);
    await expect(cart.setItem(USER_ID, VARIANT_M, 1)).rejects.toMatchObject({ statusCode: 404 });

    prisma.productVariant.findUnique.mockResolvedValue({ id: VARIANT_M, stock: 5, product: { active: false } });
    await expect(cart.setItem(USER_ID, VARIANT_M, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("só tira do carrinho o item da própria pessoa", async () => {
    prisma.cartItem.findMany.mockResolvedValue([]);
    await cart.removeItem(USER_ID, VARIANT_M);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, variantId: VARIANT_M } });
  });
});

describe("fechar pedido", () => {
  it("recusa carrinho vazio", async () => {
    prisma.cartItem.findMany.mockResolvedValue([]);

    await expect(orders.createOrder(USER_ID, address)).rejects.toMatchObject({ statusCode: 400, code: "EMPTY_CART" });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("baixa o estoque, grava o pedido como pago e esvazia o carrinho", async () => {
    prisma.cartItem.findMany.mockResolvedValue([makeCartItem({ quantity: 2 })]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.create.mockResolvedValue(makeOrder());

    const order = await orders.createOrder(USER_ID, address);

    // A baixa só acontece se ainda houver a quantidade pedida
    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: VARIANT_M, stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    });

    const { data } = prisma.order.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: USER_ID, status: "PAGO", city: "São Paulo" });
    expect(data.total.toNumber()).toBe(239.8);
    // O pedido guarda uma cópia do nome, da marca, do tamanho e do preço
    expect(data.items.create[0]).toMatchObject({
      variantId: VARIANT_M,
      quantity: 2,
      productName: "Camiseta Clutch Logo",
      brandName: "Clutch",
      size: "M",
    });

    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(order).toMatchObject({ status: "PAGO", total: 239.8 });
    expect(order.items[0].subtotal).toBe(239.8);
  });

  it("não grava nada quando falta estoque", async () => {
    prisma.cartItem.findMany.mockResolvedValue([makeCartItem({ quantity: 2 })]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

    await expect(orders.createOrder(USER_ID, address)).rejects.toMatchObject({ statusCode: 409, code: "OUT_OF_STOCK" });
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it("recusa produto que saiu da loja", async () => {
    prisma.cartItem.findMany.mockResolvedValue([makeCartItem({ active: false })]);

    await expect(orders.createOrder(USER_ID, address)).rejects.toMatchObject({ statusCode: 409, code: "UNAVAILABLE" });
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });
});

describe("pedidos", () => {
  it("lista só os pedidos da própria pessoa", async () => {
    prisma.order.findMany.mockResolvedValue([makeOrder()]);

    const result = await orders.listMyOrders(USER_ID);

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ userId: USER_ID });
    expect(result[0].address).toMatchObject({ zipCode: "01310100", state: "SP" });
  });

  it("pedido de outra pessoa responde como se não existisse", async () => {
    prisma.order.findUnique.mockResolvedValue(makeOrder({ userId: "outra-pessoa" }));
    await expect(orders.getMyOrder(USER_ID, ORDER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("o administrador vê o cliente de cada pedido", async () => {
    prisma.order.findMany.mockResolvedValue([makeOrder({ user: { name: "Tony Teste", email: "tony@clutch.test" } })]);
    prisma.order.count.mockResolvedValue(1);

    const result = await orders.listAllOrders({ status: "PAGO", page: 1, pageSize: 20 });

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ status: "PAGO" });
    expect(result.orders[0].customer).toEqual({ name: "Tony Teste", email: "tony@clutch.test" });
  });

  it("segue o caminho pago → enviado", async () => {
    prisma.order.findUnique.mockResolvedValue(makeOrder());
    prisma.order.update.mockResolvedValue(makeOrder({ status: "ENVIADO" }));

    const order = await orders.updateOrderStatus(ORDER_ID, "ENVIADO");

    expect(order.status).toBe("ENVIADO");
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("cancelar devolve os itens ao estoque", async () => {
    prisma.order.findUnique.mockResolvedValue(makeOrder());
    prisma.order.update.mockResolvedValue(makeOrder({ status: "CANCELADO" }));

    await orders.updateOrderStatus(ORDER_ID, "CANCELADO");

    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: VARIANT_M },
      data: { stock: { increment: 2 } },
    });
  });

  it("não mexe em pedido entregue ou cancelado, nem pula etapas", async () => {
    prisma.order.findUnique.mockResolvedValue(makeOrder({ status: "ENTREGUE" }));
    await expect(orders.updateOrderStatus(ORDER_ID, "CANCELADO")).rejects.toMatchObject({ code: "INVALID_STATUS" });

    prisma.order.findUnique.mockResolvedValue(makeOrder({ status: "CANCELADO" }));
    await expect(orders.updateOrderStatus(ORDER_ID, "PAGO")).rejects.toMatchObject({ code: "INVALID_STATUS" });

    prisma.order.findUnique.mockResolvedValue(makeOrder({ status: "PAGO" }));
    await expect(orders.updateOrderStatus(ORDER_ID, "ENTREGUE")).rejects.toMatchObject({ code: "INVALID_STATUS" });

    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("responde 404 para pedido que não existe", async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(orders.updateOrderStatus(ORDER_ID, "ENVIADO")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("administração da loja", () => {
  it("avisa quando o nome da marca já existe", async () => {
    prisma.brand.create.mockRejectedValue(prismaError("P2002"));
    await expect(adminMarket.createBrand({ name: "Clutch" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("não apaga marca que ainda tem produtos", async () => {
    prisma.product.count.mockResolvedValue(2);
    await expect(adminMarket.deleteBrand(BRAND_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.brand.delete).not.toHaveBeenCalled();

    prisma.product.count.mockResolvedValue(0);
    prisma.brand.delete.mockRejectedValue(prismaError("P2025"));
    await expect(adminMarket.deleteBrand(BRAND_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  const input = {
    name: "Camiseta Clutch Logo",
    description: "Algodão pesado",
    price: 119.9,
    brandId: BRAND_ID,
    variants: [
      { size: "M", stock: 5 },
      { size: "G", stock: 3 },
    ],
  };

  it("cria o produto junto com os tamanhos", async () => {
    prisma.brand.findUnique.mockResolvedValue(brand);
    prisma.product.create.mockResolvedValue(makeProduct());

    const product = await adminMarket.createProduct(input);

    expect(prisma.product.create.mock.calls[0][0].data.variants).toEqual({ create: input.variants });
    expect(product.id).toBe(PRODUCT_ID);
  });

  it("recusa tamanho repetido e marca inexistente", async () => {
    await expect(
      adminMarket.createProduct({ ...input, variants: [{ size: "M", stock: 1 }, { size: "m", stock: 2 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });

    prisma.brand.findUnique.mockResolvedValue(null);
    await expect(adminMarket.createProduct(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("ao editar, atualiza os tamanhos que ficam, cria os novos e apaga os que saíram", async () => {
    prisma.product.findUnique.mockResolvedValue(makeProduct());
    prisma.product.findUniqueOrThrow.mockResolvedValue(makeProduct());

    await adminMarket.updateProduct(PRODUCT_ID, {
      price: 99.9,
      variants: [
        { size: "m", stock: 9 },
        { size: "GG", stock: 1 },
      ],
    });

    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: PRODUCT_ID }, data: { price: 99.9 } });
    // O M continua sendo o mesmo registro (não derruba carrinhos nem pedidos)
    expect(prisma.productVariant.update).toHaveBeenCalledWith({ where: { id: VARIANT_M }, data: { size: "m", stock: 9 } });
    expect(prisma.productVariant.create).toHaveBeenCalledWith({ data: { size: "GG", stock: 1, productId: PRODUCT_ID } });
    expect(prisma.productVariant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [VARIANT_G] } } });
  });

  it("sem a lista de tamanhos, não mexe neles", async () => {
    prisma.product.findUnique.mockResolvedValue(makeProduct());
    prisma.product.findUniqueOrThrow.mockResolvedValue(makeProduct({ active: false }));

    const product = await adminMarket.updateProduct(PRODUCT_ID, { active: false });

    expect(product.active).toBe(false);
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    expect(prisma.productVariant.deleteMany).not.toHaveBeenCalled();
  });

  it("responde 404 ao editar ou apagar produto que não existe", async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(adminMarket.updateProduct(PRODUCT_ID, { active: false })).rejects.toMatchObject({ statusCode: 404 });

    prisma.product.delete.mockRejectedValue(prismaError("P2025"));
    await expect(adminMarket.deleteProduct(PRODUCT_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("coloca a foto nova depois das que já existem", async () => {
    prisma.product.findUnique.mockResolvedValue(makeProduct({ images: [{ position: 0 }, { position: 3 }] }));
    prisma.productImage.create.mockResolvedValue({ id: IMAGE_ID });

    const image = await adminMarket.addProductImage(PRODUCT_ID, Buffer.from([0xff, 0xd8, 0xff]));

    expect(prisma.productImage.create.mock.calls[0][0].data).toMatchObject({ productId: PRODUCT_ID, position: 4 });
    expect(image).toEqual({ id: IMAGE_ID, url: `/api/products/images/${IMAGE_ID}` });
  });

  it("limita a 5 fotos por produto", async () => {
    const images = Array.from({ length: 5 }, (_, position) => ({ position }));
    prisma.product.findUnique.mockResolvedValue(makeProduct({ images }));

    await expect(adminMarket.addProductImage(PRODUCT_ID, Buffer.from([0xff]))).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.productImage.create).not.toHaveBeenCalled();
  });

  it("responde 404 ao apagar foto que não existe", async () => {
    prisma.productImage.deleteMany.mockResolvedValue({ count: 0 });
    await expect(adminMarket.deleteProductImage(IMAGE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});
