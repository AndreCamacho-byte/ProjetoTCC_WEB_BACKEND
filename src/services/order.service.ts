import { Prisma, type OrderStatus } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { TX_OPTIONS, prisma } from "../lib/prisma";

export type AddressInput = {
  recipientName: string;
  zipCode: string;
  street: string;
  addressNumber: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
};

const orderInclude = { items: true } satisfies Prisma.OrderInclude;
type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderView(order: OrderWithItems) {
  return {
    id: order.id,
    status: order.status,
    total: order.total.toNumber(),
    createdAt: order.createdAt,
    address: {
      recipientName: order.recipientName,
      zipCode: order.zipCode,
      street: order.street,
      addressNumber: order.addressNumber,
      complement: order.complement,
      district: order.district,
      city: order.city,
      state: order.state,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      brandName: item.brandName,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toNumber(),
      subtotal: item.unitPrice.mul(item.quantity).toNumber(),
    })),
  };
}

// Fecha o pedido com o que está no carrinho.
// O pagamento é SIMULADO (projeto acadêmico): nenhum valor é cobrado e o pedido já nasce como PAGO.
//
// Tudo acontece dentro de uma transação: se faltar estoque de qualquer item, nada é gravado
// (nem o estoque dos outros itens é mexido).
export async function createOrder(userId: string, address: AddressInput) {
  return prisma.$transaction(async (tx) => {
    const items = await tx.cartItem.findMany({
      where: { userId },
      include: { variant: { include: { product: { include: { brand: true } } } } },
    });

    if (items.length === 0) {
      throw new AppError("Seu carrinho está vazio", 400, "EMPTY_CART");
    }

    for (const item of items) {
      const { product } = item.variant;
      if (!product.active) {
        throw new AppError(`"${product.name}" não está mais disponível. Tire do carrinho para continuar.`, 409, "UNAVAILABLE");
      }

      // Baixa o estoque só se ainda houver a quantidade pedida. Fazer a conferência e a baixa
      // na mesma operação evita vender a última unidade para duas pessoas ao mesmo tempo.
      const { count } = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (count === 0) {
        throw new AppError(
          `Não há estoque suficiente de "${product.name}" (tamanho ${item.variant.size}). Ajuste o carrinho para continuar.`,
          409,
          "OUT_OF_STOCK",
        );
      }
    }

    const total = items.reduce(
      (sum, item) => sum.plus(item.variant.product.price.mul(item.quantity)),
      new Prisma.Decimal(0),
    );

    const order = await tx.order.create({
      data: {
        userId,
        status: "PAGO",
        total,
        ...address,
        items: {
          create: items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.variant.product.price,
            productName: item.variant.product.name,
            brandName: item.variant.product.brand.name,
            size: item.variant.size,
          })),
        },
      },
      include: orderInclude,
    });

    await tx.cartItem.deleteMany({ where: { userId } });

    return toOrderView(order);
  }, TX_OPTIONS);
}

export async function listMyOrders(userId: string) {
  const orders = await prisma.order.findMany({
    where: { userId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return orders.map(toOrderView);
}

export async function getMyOrder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  // Pedido de outra pessoa responde igual a pedido inexistente
  if (!order || order.userId !== userId) {
    throw new AppError("Pedido não encontrado", 404);
  }
  return toOrderView(order);
}

// ---------- Administração ----------

// Caminho que um pedido pode seguir. Entregue e cancelado são finais.
const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  PENDENTE: ["PAGO", "CANCELADO"],
  PAGO: ["ENVIADO", "CANCELADO"],
  ENVIADO: ["ENTREGUE", "CANCELADO"],
  ENTREGUE: [],
  CANCELADO: [],
};

export async function listAllOrders({ status, page, pageSize }: { status?: OrderStatus; page: number; pageSize: number }) {
  const where: Prisma.OrderWhereInput = status ? { status } : {};

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: { items: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: orders.map((order) => ({ ...toOrderView(order), customer: order.user })),
    total,
    page,
    pageSize,
  };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) {
      throw new AppError("Pedido não encontrado", 404);
    }
    if (!NEXT_STATUS[order.status].includes(status)) {
      throw new AppError(`Um pedido ${order.status} não pode passar para ${status}`, 409, "INVALID_STATUS");
    }

    // Cancelar devolve os itens ao estoque (dos produtos que ainda existem na loja)
    if (status === "CANCELADO") {
      for (const item of order.items) {
        if (item.variantId) {
          await tx.productVariant.updateMany({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    }

    const updated = await tx.order.update({ where: { id: orderId }, data: { status }, include: orderInclude });
    return toOrderView(updated);
  }, TX_OPTIONS);
}
