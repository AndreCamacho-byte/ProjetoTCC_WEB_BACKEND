import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { imageUrl } from "./catalog.service";

// Máximo de unidades do mesmo item em um carrinho
export const MAX_QUANTITY_PER_ITEM = 10;

const cartInclude = {
  variant: {
    include: {
      product: {
        include: {
          brand: true,
          images: { select: { id: true }, orderBy: { position: "asc" }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemWithRelations = Prisma.CartItemGetPayload<{ include: typeof cartInclude }>;

function toCartView(items: CartItemWithRelations[]) {
  const view = items.map((item) => {
    const { variant } = item;
    const { product } = variant;
    return {
      variantId: variant.id,
      quantity: item.quantity,
      size: variant.size,
      stock: variant.stock,
      unitPrice: product.price.toNumber(),
      subtotal: product.price.mul(item.quantity).toNumber(),
      // Falso quando o produto saiu da loja ou o estoque ficou menor que a quantidade no carrinho
      available: product.active && variant.stock >= item.quantity,
      product: {
        id: product.id,
        name: product.name,
        brandName: product.brand.name,
        imageUrl: product.images[0] ? imageUrl(product.images[0].id) : null,
      },
    };
  });

  const total = items.reduce(
    (sum, item) => sum.plus(item.variant.product.price.mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  return {
    items: view,
    total: total.toNumber(),
    // Quantidade total de unidades (o número que aparece no ícone do carrinho)
    count: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export async function getCart(userId: string) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    include: cartInclude,
    orderBy: { createdAt: "asc" },
  });
  return toCartView(items);
}

// Define a quantidade de um tamanho no carrinho (cria o item se ainda não existir)
export async function setItem(userId: string, variantId: string, quantity: number) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });

  if (!variant || !variant.product.active) {
    throw new AppError("Este produto não está mais disponível", 404);
  }
  if (quantity > variant.stock) {
    const message =
      variant.stock === 0
        ? "Este tamanho está esgotado"
        : `Só temos ${variant.stock} ${variant.stock === 1 ? "unidade" : "unidades"} deste tamanho`;
    throw new AppError(message, 409, "OUT_OF_STOCK");
  }

  await prisma.cartItem.upsert({
    where: { userId_variantId: { userId, variantId } },
    create: { userId, variantId, quantity },
    update: { quantity },
  });

  return getCart(userId);
}

export async function removeItem(userId: string, variantId: string) {
  await prisma.cartItem.deleteMany({ where: { userId, variantId } });
  return getCart(userId);
}
