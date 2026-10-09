import { Router } from "express";
import * as market from "../controllers/market.controller";
import { requireMinAge } from "../middlewares/age";
import { requireAuth } from "../middlewares/auth";

export const marketRoutes = Router();

// Carrinho e pedidos: só para quem está logado e tem 12 anos ou mais
const buyer = [requireAuth, requireMinAge];

/**
 * @openapi
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, example: Camiseta Clutch Logo }
 *         description: { type: string }
 *         price: { type: number, example: 119.9 }
 *         active: { type: boolean, description: Produtos desativados não aparecem na loja }
 *         brand:
 *           type: object
 *           properties:
 *             id: { type: string, format: uuid }
 *             name: { type: string, example: Clutch }
 *         images:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string, format: uuid }
 *               url: { type: string, example: /api/products/images/3f2b... }
 *         variants:
 *           type: array
 *           description: Tamanhos, cada um com o seu estoque
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string, format: uuid }
 *               size: { type: string, example: M }
 *               stock: { type: integer, example: 12 }
 *         createdAt: { type: string, format: date-time }
 *     Cart:
 *       type: object
 *       properties:
 *         total: { type: number, example: 239.8 }
 *         count: { type: integer, description: Total de unidades no carrinho, example: 2 }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               variantId: { type: string, format: uuid }
 *               quantity: { type: integer, example: 2 }
 *               size: { type: string, example: M }
 *               stock: { type: integer }
 *               unitPrice: { type: number }
 *               subtotal: { type: number }
 *               available: { type: boolean, description: Falso se o produto saiu da loja ou o estoque não cobre a quantidade }
 *               product:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   name: { type: string }
 *                   brandName: { type: string }
 *                   imageUrl: { type: string, nullable: true }
 *     Address:
 *       type: object
 *       required: [recipientName, zipCode, street, addressNumber, district, city, state]
 *       properties:
 *         recipientName: { type: string, example: Tony Hawk }
 *         zipCode: { type: string, example: '01310-100', description: Com ou sem traço }
 *         street: { type: string, example: Avenida Paulista }
 *         addressNumber: { type: string, example: '1000' }
 *         complement: { type: string, example: Apto 12 }
 *         district: { type: string, example: Bela Vista }
 *         city: { type: string, example: São Paulo }
 *         state: { type: string, example: SP }
 *     Order:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         status: { type: string, enum: [PENDENTE, PAGO, ENVIADO, ENTREGUE, CANCELADO] }
 *         total: { type: number }
 *         createdAt: { type: string, format: date-time }
 *         address: { $ref: '#/components/schemas/Address' }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string, format: uuid }
 *               productName: { type: string }
 *               brandName: { type: string }
 *               size: { type: string }
 *               quantity: { type: integer }
 *               unitPrice: { type: number }
 *               subtotal: { type: number }
 */

/**
 * @openapi
 * /products:
 *   get:
 *     tags: [Marketplace]
 *     summary: Lista os produtos da loja (mais recentes primeiro)
 *     description: Rota pública. Só traz produtos ativos.
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Busca no nome, na descrição e na marca
 *       - in: query
 *         name: brandId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 60, default: 12 }
 *     responses:
 *       200:
 *         description: Página de produtos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Product' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 */
marketRoutes.get("/products", market.listProducts);

/**
 * @openapi
 * /products/images/{imageId}:
 *   get:
 *     tags: [Marketplace]
 *     summary: Devolve uma foto de produto
 *     description: Rota pública, usada no atributo src das imagens.
 *     parameters:
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A imagem
 *         content:
 *           image/jpeg:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: Imagem não encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
marketRoutes.get("/products/images/:imageId", market.getProductImage);

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     tags: [Marketplace]
 *     summary: Detalhes de um produto
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: O produto
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       404:
 *         description: Produto não encontrado ou desativado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
marketRoutes.get("/products/:id", market.getProduct);

/**
 * @openapi
 * /brands:
 *   get:
 *     tags: [Marketplace]
 *     summary: Lista as marcas parceiras
 *     responses:
 *       200:
 *         description: Marcas em ordem alfabética
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   name: { type: string }
 *                   description: { type: string, nullable: true }
 *                   website: { type: string, nullable: true }
 */
marketRoutes.get("/brands", market.listBrands);

/**
 * @openapi
 * /cart:
 *   get:
 *     tags: [Marketplace]
 *     summary: Carrinho de quem está logado
 *     description: Exige login e 12 anos ou mais.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: O carrinho
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Cart' }
 *       403:
 *         description: Menor de 12 anos ou idade não verificada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
marketRoutes.get("/cart", buyer, market.getCart);

/**
 * @openapi
 * /cart/items:
 *   put:
 *     tags: [Marketplace]
 *     summary: Coloca um tamanho no carrinho ou muda a quantidade
 *     description: A quantidade enviada substitui a anterior. Máximo de 10 unidades por item, limitado ao estoque.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [variantId, quantity]
 *             properties:
 *               variantId: { type: string, format: uuid, description: Id do tamanho escolhido }
 *               quantity: { type: integer, minimum: 1, maximum: 10, example: 1 }
 *     responses:
 *       200:
 *         description: Carrinho atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Cart' }
 *       404:
 *         description: Produto não está mais disponível
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Estoque insuficiente (código OUT_OF_STOCK)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
marketRoutes.put("/cart/items", buyer, market.setCartItem);

/**
 * @openapi
 * /cart/items/{variantId}:
 *   delete:
 *     tags: [Marketplace]
 *     summary: Tira um item do carrinho
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Carrinho atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Cart' }
 */
marketRoutes.delete("/cart/items/:variantId", buyer, market.removeCartItem);

/**
 * @openapi
 * /orders:
 *   post:
 *     tags: [Marketplace]
 *     summary: Fecha o pedido com o que está no carrinho
 *     description: |
 *       **O pagamento é simulado** (projeto acadêmico): nenhum valor é cobrado e o pedido já nasce como PAGO.
 *       O estoque é baixado e o carrinho é esvaziado. Se faltar estoque de qualquer item, nada é gravado.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Address' }
 *     responses:
 *       201:
 *         description: Pedido criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Order' }
 *       400:
 *         description: Endereço inválido ou carrinho vazio (código EMPTY_CART)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 *       409:
 *         description: Estoque insuficiente (OUT_OF_STOCK) ou produto fora da loja (UNAVAILABLE)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Marketplace]
 *     summary: Pedidos de quem está logado (mais recentes primeiro)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de pedidos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Order' }
 */
marketRoutes.post("/orders", buyer, market.createOrder);
marketRoutes.get("/orders", buyer, market.listMyOrders);

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     tags: [Marketplace]
 *     summary: Detalhes de um pedido de quem está logado
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: O pedido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Order' }
 *       404:
 *         description: Pedido não encontrado (ou de outra pessoa)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
marketRoutes.get("/orders/:id", buyer, market.getMyOrder);
