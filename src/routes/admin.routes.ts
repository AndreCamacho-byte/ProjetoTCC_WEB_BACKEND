import { Router } from "express";
import * as adminController from "../controllers/admin.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";

export const adminRoutes = Router();

// Todas as rotas daqui exigem login de um administrador
adminRoutes.use("/admin", requireAuth, requireAdmin);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Lista os usuários (mais recentes primeiro)
 *     description: Exclusivo para administradores.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Busca por nome, @username ou email
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de usuários
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/User' }
 *                 total: { type: integer, example: 42 }
 *                 page: { type: integer, example: 1 }
 *                 pageSize: { type: integer, example: 20 }
 *       401:
 *         description: Token ausente, inválido ou expirado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: A conta não é de administrador
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminRoutes.get("/admin/users", adminController.listUsers);

/**
 * @openapi
 * /admin/users/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Edita um usuário
 *     description: Envie só os campos que quer alterar. Um administrador não pode tirar a própria função de admin.
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
 *               name: { type: string, example: Tony Hawk }
 *               username: { type: string, example: tonyhawk }
 *               role: { type: string, enum: [USER, ADMIN] }
 *               emailVerified: { type: boolean, description: Marca ou desmarca o email como confirmado }
 *               birthDate: { type: string, format: date, nullable: true, example: '2005-05-12', description: Corrige a data de nascimento (null apaga) }
 *     responses:
 *       200:
 *         description: Usuário atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Dados inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 *       403:
 *         description: A conta não é de administrador
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Usuário não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: "@username já em uso"
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Admin]
 *     summary: Remove um usuário
 *     description: |
 *       Apaga a conta e tudo que é dela (posts, comentários, curtidas, seguidores e encontros).
 *       Um administrador não pode remover a própria conta. Os pedidos do marketplace da conta removida são apagados junto.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Usuário removido
 *       400:
 *         description: Tentativa de remover a própria conta
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: A conta não é de administrador
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Usuário não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminRoutes.patch("/admin/users/:id", adminController.updateUser);
adminRoutes.delete("/admin/users/:id", adminController.deleteUser);
