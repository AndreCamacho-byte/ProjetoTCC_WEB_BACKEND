import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { TX_OPTIONS, prisma } from "../lib/prisma";
import { imageUrl, productInclude, toProductView } from "./catalog.service";

// Máximo de fotos por produto
export const MAX_IMAGES_PER_PRODUCT = 5;

type BrandInput = { name: string; description?: string | null; website?: string | null };

type VariantInput = { size: string; stock: number };

type ProductInput = {
  name: string;
  description: string;
  price: number;
  brandId: string;
  active?: boolean;
  variants: VariantInput[];
};

const isPrismaError = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

// ---------- Marcas ----------

export async function createBrand(data: BrandInput) {
  try {
    return await prisma.brand.create({ data });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new AppError("Já existe uma marca com esse nome", 409);
    throw error;
  }
}

export async function updateBrand(id: string, data: Partial<BrandInput>) {
  try {
    return await prisma.brand.update({ where: { id }, data });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new AppError("Marca não encontrada", 404);
    if (isPrismaError(error, "P2002")) throw new AppError("Já existe uma marca com esse nome", 409);
    throw error;
  }
}

export async function deleteBrand(id: string) {
  // Uma marca com produtos não pode sumir e deixar os produtos sem marca.
  // A conferência é feita aqui porque o erro que o banco devolve nesse caso não vem com um código que dê para tratar.
  const products = await prisma.product.count({ where: { brandId: id } });
  if (products > 0) {
    throw new AppError("Esta marca tem produtos cadastrados. Apague ou mude os produtos antes.", 409);
  }

  try {
    await prisma.brand.delete({ where: { id } });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new AppError("Marca não encontrada", 404);
    throw error;
  }
}

// ---------- Produtos ----------

// Tamanhos sem repetição, ignorando maiúsculas/minúsculas (não dá para ter "M" e "m")
function assertUniqueSizes(variants: VariantInput[]) {
  const seen = new Set<string>();
  for (const { size } of variants) {
    const key = size.toUpperCase();
    if (seen.has(key)) throw new AppError(`O tamanho "${size}" está repetido`, 400);
    seen.add(key);
  }
}

async function assertBrandExists(brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new AppError("Marca não encontrada", 400);
}

export async function createProduct({ variants, ...data }: ProductInput) {
  assertUniqueSizes(variants);
  await assertBrandExists(data.brandId);

  const product = await prisma.product.create({
    data: { ...data, variants: { create: variants } },
    include: productInclude,
  });
  return toProductView(product);
}

export async function updateProduct(id: string, { variants, ...data }: Partial<ProductInput>) {
  const existing = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!existing) {
    throw new AppError("Produto não encontrado", 404);
  }
  if (data.brandId) await assertBrandExists(data.brandId);

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data });

    // Quando a lista de tamanhos vem junto, ela passa a ser a lista completa do produto:
    // tamanhos novos são criados, os que já existem têm o estoque atualizado (mantendo o mesmo
    // registro, para não derrubar carrinhos e pedidos) e os que saíram da lista são apagados.
    if (variants) {
      assertUniqueSizes(variants);
      const bySize = new Map(existing.variants.map((v) => [v.size.toUpperCase(), v]));

      for (const variant of variants) {
        const current = bySize.get(variant.size.toUpperCase());
        if (current) {
          await tx.productVariant.update({ where: { id: current.id }, data: variant });
          bySize.delete(variant.size.toUpperCase());
        } else {
          await tx.productVariant.create({ data: { ...variant, productId: id } });
        }
      }

      const removed = [...bySize.values()].map((v) => v.id);
      if (removed.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: removed } } });
      }
    }
  }, TX_OPTIONS);

  const product = await prisma.product.findUniqueOrThrow({ where: { id }, include: productInclude });
  return toProductView(product);
}

// Apaga o produto, os tamanhos e as fotos. Os pedidos antigos continuam com o nome e o preço
// que foram copiados na compra.
export async function deleteProduct(id: string) {
  try {
    await prisma.product.delete({ where: { id } });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new AppError("Produto não encontrado", 404);
    throw error;
  }
}

// ---------- Fotos ----------

export async function addProductImage(productId: string, image: Buffer) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: { select: { position: true } } },
  });
  if (!product) {
    throw new AppError("Produto não encontrado", 404);
  }
  if (product.images.length >= MAX_IMAGES_PER_PRODUCT) {
    throw new AppError(`Cada produto pode ter no máximo ${MAX_IMAGES_PER_PRODUCT} fotos`, 409);
  }

  // A foto nova entra depois das que já existem
  const position = product.images.reduce((max, img) => Math.max(max, img.position), -1) + 1;
  const created = await prisma.productImage.create({
    data: { productId, position, data: new Uint8Array(image) },
    select: { id: true },
  });

  return { id: created.id, url: imageUrl(created.id) };
}

export async function deleteProductImage(imageId: string) {
  const { count } = await prisma.productImage.deleteMany({ where: { id: imageId } });
  if (count === 0) {
    throw new AppError("Imagem não encontrada", 404);
  }
}
