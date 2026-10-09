import { Router } from "express";
import * as market from "../controllers/market.controller";

// Administração da loja. O login e a função de administrador são conferidos em admin.routes.ts
// (adminRoutes.use("/admin", requireAuth, requireAdmin)), que vem antes deste arquivo.
export const adminMarketRoutes = Router();

/**
 * @openapi
 * /admin/brands:
 *   post:
 *     tags: [Admin]
 *     summary: Cadastra uma marca
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Clutch }
 *               description: { type: string, nullable: true }
 *               website: { type: string, nullable: true, example: 'https://exemplo.com' }
 *     responses:
 *       201: { description: Marca criada }
 *       409:
 *         description: Já existe uma marca com esse nome
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminMarketRoutes.post("/admin/brands", market.createBrand);

/**
 * @openapi
 * /admin/brands/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Edita uma marca
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string, nullable: true }
 *               website: { type: string, nullable: true }
 *     responses:
 *       200: { description: Marca atualizada }
 *       404:
 *         description: Marca não encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Admin]
 *     summary: Apaga uma marca
 *     description: Não é possível apagar uma marca que ainda tem produtos.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Marca apagada }
 *       409:
 *         description: A marca tem produtos cadastrados
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminMarketRoutes.patch("/admin/brands/:id", market.updateBrand);
adminMarketRoutes.delete("/admin/brands/:id", market.deleteBrand);

/**
 * @openapi
 * /admin/products:
 *   get:
 *     tags: [Admin]
 *     summary: Lista todos os produtos, inclusive os desativados
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 60, default: 12 }
 *     responses:
 *       200: { description: Página de produtos }
 *   post:
 *     tags: [Admin]
 *     summary: Cadastra um produto com os seus tamanhos
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, description, price, brandId, variants]
 *             properties:
 *               name: { type: string, example: Camiseta Clutch Logo }
 *               description: { type: string }
 *               price: { type: number, example: 119.9 }
 *               brandId: { type: string, format: uuid }
 *               active: { type: boolean, default: true }
 *               variants:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [size, stock]
 *                   properties:
 *                     size: { type: string, example: M }
 *                     stock: { type: integer, minimum: 0, example: 10 }
 *     responses:
 *       201:
 *         description: Produto criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       400:
 *         description: Dados inválidos, marca inexistente ou tamanho repetido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 */
adminMarketRoutes.get("/admin/products", market.listAllProducts);
adminMarketRoutes.post("/admin/products", market.createProduct);

/**
 * @openapi
 * /admin/products/images/{imageId}:
 *   delete:
 *     tags: [Admin]
 *     summary: Apaga uma foto de produto
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Foto apagada }
 *       404:
 *         description: Imagem não encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminMarketRoutes.delete("/admin/products/images/:imageId", market.deleteProductImage);

/**
 * @openapi
 * /admin/products/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Detalhes de um produto, mesmo desativado
 *     security:
 *       - bearerAuth: []
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
 *   patch:
 *     tags: [Admin]
 *     summary: Edita um produto
 *     description: |
 *       Envie só o que quer mudar. Quando `variants` vem junto, ela passa a ser a lista completa de
 *       tamanhos: os novos são criados, os existentes têm o estoque atualizado e os que saíram são apagados.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               brandId: { type: string, format: uuid }
 *               active: { type: boolean }
 *               variants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     size: { type: string }
 *                     stock: { type: integer }
 *     responses:
 *       200:
 *         description: Produto atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       404:
 *         description: Produto não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Admin]
 *     summary: Apaga um produto
 *     description: Apaga também os tamanhos e as fotos. Os pedidos antigos mantêm o nome e o preço da compra.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Produto apagado }
 */
adminMarketRoutes.get("/admin/products/:id", market.getAnyProduct);
adminMarketRoutes.patch("/admin/products/:id", market.updateProduct);
adminMarketRoutes.delete("/admin/products/:id", market.deleteProduct);

/**
 * @openapi
 * /admin/products/{id}/images:
 *   post:
 *     tags: [Admin]
 *     summary: Adiciona uma foto ao produto
 *     description: JPEG como data URL em base64 (o site já recorta e reduz para 800x800). Até 5 fotos por produto e 600 KB cada.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' }
 *     responses:
 *       201: { description: Foto adicionada }
 *       409:
 *         description: O produto já tem 5 fotos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       413:
 *         description: Foto grande demais
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminMarketRoutes.post("/admin/products/:id/images", market.addProductImage);

/**
 * @openapi
 * /admin/orders:
 *   get:
 *     tags: [Admin]
 *     summary: Lista os pedidos de todos os clientes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDENTE, PAGO, ENVIADO, ENTREGUE, CANCELADO] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *     responses:
 *       200: { description: Página de pedidos, cada um com o nome e o email do cliente }
 */
adminMarketRoutes.get("/admin/orders", market.listAllOrders);

/**
 * @openapi
 * /admin/orders/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Muda a situação de um pedido
 *     description: |
 *       Caminho permitido: PAGO → ENVIADO → ENTREGUE. Um pedido pago ou enviado pode ser CANCELADO,
 *       e o cancelamento devolve os itens ao estoque. Entregue e cancelado são finais.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [PAGO, ENVIADO, ENTREGUE, CANCELADO] }
 *     responses:
 *       200:
 *         description: Pedido atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Order' }
 *       409:
 *         description: Mudança de situação não permitida (código INVALID_STATUS)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminMarketRoutes.patch("/admin/orders/:id", market.updateOrderStatus);
