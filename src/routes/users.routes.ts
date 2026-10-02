import { Router } from "express";
import * as accountController from "../controllers/account.controller";
import { requireAuth } from "../middlewares/auth";

export const usersRoutes = Router();

/**
 * @openapi
 * /users/me:
 *   patch:
 *     tags: [Users]
 *     summary: Altera o nome ou o @username da própria conta
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Tony Hawk }
 *               username: { type: string, example: tonyhawk, description: 3 a 20 letras minúsculas, números ou _ }
 *     responses:
 *       200:
 *         description: Conta atualizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Dados inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 *       401:
 *         description: Token ausente, inválido ou expirado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: "@username já em uso"
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Users]
 *     summary: Exclui a própria conta
 *     description: Pede a senha de novo para confirmar. Apaga a conta e tudo que é dela; não dá para desfazer.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, format: password }
 *     responses:
 *       204:
 *         description: Conta excluída
 *       401:
 *         description: Senha incorreta ou token inválido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: A conta tem pedidos registrados
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
usersRoutes.patch("/users/me", requireAuth, accountController.updateProfile);
usersRoutes.delete("/users/me", requireAuth, accountController.deleteAccount);

/**
 * @openapi
 * /users/me/avatar:
 *   put:
 *     tags: [Users]
 *     summary: Define a foto de perfil
 *     description: A foto vai em JPEG, como data URL em base64 (o site já recorta e reduz para 256x256). Máximo de 300 KB.
 *     security:
 *       - bearerAuth: []
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
 *       200:
 *         description: Foto salva (o campo avatarUrl do usuário passa a apontar para ela)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Imagem inválida
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       413:
 *         description: Imagem grande demais
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Users]
 *     summary: Remove a foto de perfil
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Foto removida
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 */
usersRoutes.put("/users/me/avatar", requireAuth, accountController.setAvatar);
usersRoutes.delete("/users/me/avatar", requireAuth, accountController.removeAvatar);

/**
 * @openapi
 * /users/{id}/avatar:
 *   get:
 *     tags: [Users]
 *     summary: Devolve a foto de perfil de um usuário
 *     description: Rota pública, usada no atributo src das imagens. É o endereço que vem no campo avatarUrl.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A imagem
 *         content:
 *           image/jpeg:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: O usuário não tem foto
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
usersRoutes.get("/users/:id/avatar", accountController.getAvatar);
