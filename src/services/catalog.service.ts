import { Prisma } from "@prisma/client";
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

// Formato do produto nas respostas da API (preço como número, fotos como endereços)
export function toProductView(product: ProductWithRelations) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toNumber(),
    active: product.active,
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
  page: number;
  pageSize: number;
  // O painel do administrador também vê os produtos desativados
  includeInactive?: boolean;
};

export async function listProducts({ search, brandId, page, pageSize, includeInactive = false }: ListInput) {
  const where: Prisma.ProductWhereInput = {
    ...(includeInactive ? {} : { active: true }),
    ...(brandId ? { brandId } : {}),
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

  return { products: products.map(toProductView), total, page, pageSize };
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

export async function getProductImage(imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image) {
    throw new AppError("Imagem não encontrada", 404);
  }
  return Buffer.from(image.data);
}
