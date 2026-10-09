import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError";
import * as adminMarket from "../services/adminMarket.service";
import * as cart from "../services/cart.service";
import * as catalog from "../services/catalog.service";
import * as orders from "../services/order.service";

const MAX_IMAGE_BYTES = 600 * 1024; // o site já manda a foto reduzida (800x800)

const idParam = (name: string) => z.object({ [name]: z.uuid("Id inválido") });
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);

const pageSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(12),
};

const listProductsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  brandId: z.uuid("Marca inválida").optional(),
  ...pageSchema,
});

// ---------- Catálogo (público) ----------

export async function listProducts(req: Request, res: Response) {
  res.json(await catalog.listProducts(listProductsSchema.parse(req.query)));
}

export async function getProduct(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await catalog.getProduct(id));
}

export async function listBrands(_req: Request, res: Response) {
  res.json(await catalog.listBrands());
}

export async function getProductImage(req: Request, res: Response) {
  const { imageId } = idParam("imageId").parse(req.params);
  const image = await catalog.getProductImage(imageId);

  res.set({
    "Content-Type": "image/jpeg",
    // Uma foto nunca muda depois de enviada (trocar a foto cria outra), então pode ficar em cache
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(image);
}

// ---------- Carrinho ----------

const cartItemSchema = z.object({
  variantId: z.uuid("Tamanho inválido"),
  quantity: z
    .number("Informe a quantidade")
    .int("A quantidade precisa ser um número inteiro")
    .min(1, "A quantidade mínima é 1")
    .max(cart.MAX_QUANTITY_PER_ITEM, `O máximo é ${cart.MAX_QUANTITY_PER_ITEM} unidades por item`),
});

export async function getCart(req: Request, res: Response) {
  res.json(await cart.getCart(req.userId!));
}

export async function setCartItem(req: Request, res: Response) {
  const { variantId, quantity } = cartItemSchema.parse(req.body);
  res.json(await cart.setItem(req.userId!, variantId, quantity));
}

export async function removeCartItem(req: Request, res: Response) {
  const { variantId } = idParam("variantId").parse(req.params);
  res.json(await cart.removeItem(req.userId!, variantId));
}

// ---------- Pedidos ----------

const STATES = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

const addressSchema = z.object({
  recipientName: text(2, 80, "Informe o nome de quem vai receber"),
  // Aceita o CEP com ou sem traço e guarda só os 8 números
  zipCode: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length === 8, "O CEP tem 8 dígitos"),
  street: text(2, 120, "Informe a rua"),
  addressNumber: text(1, 10, "Informe o número"),
  complement: z.string().trim().max(60).optional(),
  district: text(2, 60, "Informe o bairro"),
  city: text(2, 60, "Informe a cidade"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => STATES.includes(value), "Informe a sigla do estado (ex.: SP)"),
});

export async function createOrder(req: Request, res: Response) {
  res.status(201).json(await orders.createOrder(req.userId!, addressSchema.parse(req.body)));
}

export async function listMyOrders(req: Request, res: Response) {
  res.json(await orders.listMyOrders(req.userId!));
}

export async function getMyOrder(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await orders.getMyOrder(req.userId!, id));
}

// ---------- Administração: marcas ----------

const brandSchema = z.object({
  name: text(2, 60, "Informe o nome da marca"),
  description: z.string().trim().max(300).nullable().optional(),
  website: z.url("Endereço do site inválido").max(200).nullable().optional(),
});

export async function createBrand(req: Request, res: Response) {
  res.status(201).json(await adminMarket.createBrand(brandSchema.parse(req.body)));
}

export async function updateBrand(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await adminMarket.updateBrand(id, brandSchema.partial().parse(req.body)));
}

export async function deleteBrand(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  await adminMarket.deleteBrand(id);
  res.status(204).end();
}

// ---------- Administração: produtos ----------

const productSchema = z.object({
  name: text(2, 80, "Informe o nome do produto"),
  description: text(2, 2000, "Informe a descrição"),
  // Arredonda para centavos (evita preços como 99.999)
  price: z
    .number("Informe o preço")
    .positive("O preço precisa ser maior que zero")
    .max(99999.99, "Preço alto demais")
    .transform((value) => Math.round(value * 100) / 100),
  brandId: z.uuid("Marca inválida"),
  active: z.boolean().optional(),
  variants: z
    .array(
      z.object({
        size: text(1, 12, "Informe o tamanho"),
        stock: z.number("Informe o estoque").int().min(0, "O estoque não pode ser negativo").max(100000),
      }),
    )
    .min(1, "Cadastre pelo menos um tamanho")
    .max(20),
});

export async function listAllProducts(req: Request, res: Response) {
  res.json(await catalog.listProducts({ ...listProductsSchema.parse(req.query), includeInactive: true }));
}

export async function getAnyProduct(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await catalog.getProduct(id, { includeInactive: true }));
}

export async function createProduct(req: Request, res: Response) {
  res.status(201).json(await adminMarket.createProduct(productSchema.parse(req.body)));
}

export async function updateProduct(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  res.json(await adminMarket.updateProduct(id, productSchema.partial().parse(req.body)));
}

export async function deleteProduct(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  await adminMarket.deleteProduct(id);
  res.status(204).end();
}

const imageSchema = z.object({
  image: z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, "Envie a foto em JPEG"),
});

export async function addProductImage(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  const { image } = imageSchema.parse(req.body);
  const data = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");

  if (data.length > MAX_IMAGE_BYTES) {
    throw new AppError("A foto é grande demais", 413);
  }
  // Todo JPEG começa com os bytes FF D8 FF: confere se o arquivo é mesmo uma imagem
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    throw new AppError("O arquivo enviado não é uma imagem JPEG válida", 400);
  }

  res.status(201).json(await adminMarket.addProductImage(id, data));
}

export async function deleteProductImage(req: Request, res: Response) {
  const { imageId } = idParam("imageId").parse(req.params);
  await adminMarket.deleteProductImage(imageId);
  res.status(204).end();
}

// ---------- Administração: pedidos ----------

const statusEnum = z.enum(["PENDENTE", "PAGO", "ENVIADO", "ENTREGUE", "CANCELADO"]);

const listOrdersSchema = z.object({
  status: statusEnum.optional(),
  page: pageSchema.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listAllOrders(req: Request, res: Response) {
  res.json(await orders.listAllOrders(listOrdersSchema.parse(req.query)));
}

export async function updateOrderStatus(req: Request, res: Response) {
  const { id } = idParam("id").parse(req.params);
  const { status } = z.object({ status: statusEnum }).parse(req.body);
  res.json(await orders.updateOrderStatus(id, status));
}
