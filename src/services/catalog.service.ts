import { Prisma, type ProductCategory } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";

// Tudo que uma consulta de produto precisa trazer junto.
// Das fotos vem só o id: os bytes da imagem são servidos por outra rota.
export const productInclude = {
  brand: true,
  variants: true,
  images: { select: { id: true, position: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

// Ordem natural dos tamanhos de roupa; o que não estiver aqui (ex.: 38, 8.0) vai em ordem alfabética/numérica
const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG"];

export function compareSizes(a: string, b: string) {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase());
  const ib = SIZE_ORDER.indexOf(b.toUpperCase());
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, "pt-BR", { numeric: true });
}

export const imageUrl = (imageId: string) => `/api/products/images/${imageId}`;

// Ficha de detalhes e perguntas frequentes ficam em colunas JSON: aqui vira lista de verdade
// (e qualquer coisa fora do formato é ignorada, para a tela nunca quebrar)
export type Detail = { label: string; value: string };
export type FaqItem = { question: string; answer: string };

function asList<T>(value: Prisma.JsonValue, keys: (keyof T)[]): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Prisma.JsonObject =>
      typeof item === "object" && item !== null && !Array.isArray(item) && keys.every((key) => typeof item[key as string] === "string"),
  ) as unknown as T[];
}

// Formato do produto nas respostas da API (preço como número, fotos como endereços)
export function toProductView(product: ProductWithRelations) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toNumber(),
    active: product.active,
    category: product.category,
    details: asList<Detail>(product.details, ["label", "value"]),
    faq: asList<FaqItem>(product.faq, ["question", "answer"]),
    location: product.location,
    brand: { id: product.brand.id, name: product.brand.name },
    images: product.images.map((image) => ({ id: image.id, url: imageUrl(image.id) })),
    variants: [...product.variants]
      .sort((a, b) => compareSizes(a.size, b.size))
      .map((variant) => ({ id: variant.id, size: variant.size, stock: variant.stock })),
    createdAt: product.createdAt,
  };
}

type ListInput = {
  search?: string;
  brandId?: string;
  category?: ProductCategory;
  // Produtos específicos (usado nas "últimas visitas"): voltam na ordem pedida
  ids?: string[];
  page: number;
  pageSize: number;
  // O painel do administrador também vê os produtos desativados
  includeInactive?: boolean;
};

export async function listProducts({ search, brandId, category, ids, page, pageSize, includeInactive = false }: ListInput) {
  const where: Prisma.ProductWhereInput = {
    ...(includeInactive ? {} : { active: true }),
    ...(brandId ? { brandId } : {}),
    ...(category ? { category } : {}),
    ...(ids ? { id: { in: ids } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { brand: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const views = products.map(toProductView);
  // Com "ids", a ordem é a da lista pedida (a mais recente visita primeiro)
  if (ids) views.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { products: views, total, page, pageSize };
}

// Produtos parecidos: primeiro os do mesmo tipo, depois os da mesma marca (sem repetir o próprio)
export async function listRelated(productId: string, limit = 8) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { category: true, brandId: true, active: true },
  });
  if (!product || !product.active) {
    throw new AppError("Produto não encontrado", 404);
  }

  const related = await prisma.product.findMany({
    where: {
      active: true,
      id: { not: productId },
      OR: [{ category: product.category }, { brandId: product.brandId }],
    },
    include: productInclude,
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const sameCategory = related.filter((p) => p.category === product.category);
  const sameBrand = related.filter((p) => p.category !== product.category);
  return [...sameCategory, ...sameBrand].slice(0, limit).map(toProductView);
}

export async function getProduct(id: string, { includeInactive = false } = {}) {
  const product = await prisma.product.findUnique({ where: { id }, include: productInclude });
  if (!product || (!product.active && !includeInactive)) {
    throw new AppError("Produto não encontrado", 404);
  }
  return toProductView(product);
}

export async function listBrands() {
  return prisma.brand.findMany({ orderBy: { name: "asc" } });
}

// ---------- Salvos ----------

export async function saveProduct(productId: string, userId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { active: true } });
  if (!product || !product.active) {
    throw new AppError("Produto não encontrado", 404);
  }
  await prisma.savedProduct.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
  return { savedByMe: true };
}

export async function unsaveProduct(productId: string, userId: string) {
  await prisma.savedProduct.deleteMany({ where: { userId, productId } });
  return { savedByMe: false };
}

// Produtos salvos que ainda estão na loja (os salvos por último primeiro)
export async function listSavedProducts(userId: string) {
  const saved = await prisma.savedProduct.findMany({
    where: { userId, product: { active: true } },
    include: { product: { include: productInclude } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return saved.map((item) => toProductView(item.product));
}

export async function getProductImage(imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image) {
    throw new AppError("Imagem não encontrada", 404);
  }
  return Buffer.from(image.data);
}
