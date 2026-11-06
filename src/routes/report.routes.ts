import { Router } from "express";
import * as moderation from "../controllers/report.controller";
import { requireAuth } from "../middlewares/auth";
import { limits } from "../middlewares/rateLimit";

// Denúncias e bloqueios. As rotas /admin/... já passam pelo requireAuth + requireAdmin de
// admin.routes.ts, que vem antes deste arquivo.
export const reportRoutes = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     ReportTarget:
 *       type: string
 *       enum: [POST, COMMENT, USER, MESSAGE]
 *     ReportReason:
 *       type: string
 *       enum: [SPAM, OFENSA, ASSEDIO, CONTEUDO_IMPROPRIO, RISCO, OUTRO]
 *     ReportStatus:
 *       type: string
 *       enum: [ABERTA, RESOLVIDA, DESCARTADA]
 */

/**
 * @openapi
 * /reports:
 *   post:
 *     tags: [Moderação]
 *     summary: Denuncia um post, comentário, perfil ou mensagem
 *     description: >
 *       Guarda um trecho do conteúdo para a equipe analisar. Mensagens só podem ser denunciadas
 *       por quem as recebeu. Denunciar a mesma coisa de novo atualiza a denúncia (não cria outra).
 *       Limite de 20 denúncias por dia por conta.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetType, targetId, reason]
 *             properties:
 *               targetType: { $ref: '#/components/schemas/ReportTarget' }
 *               targetId: { type: string, format: uuid, description: 'Id do post, comentário, pessoa ou mensagem' }
 *               reason: { $ref: '#/components/schemas/ReportReason' }
 *               details: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: Denúncia enviada }
 *       400: { description: Dados inválidos ou tentativa de denunciar algo seu }
 *       404: { description: Conteúdo não encontrado }
 *       429: { description: Limite diário de denúncias }
 */
reportRoutes.post("/reports", requireAuth, limits.reporting, moderation.createReport);

/**
 * @openapi
 * /admin/reports:
 *   get:
 *     tags: [Admin]
 *     summary: 'Denúncias por situação (padrão: abertas, as mais antigas primeiro)'
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { $ref: '#/components/schemas/ReportStatus' }
 *     responses:
 *       200:
 *         description: Até 100 denúncias, com nome e @ de quem denunciou e de quem foi denunciado (nunca o email)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   targetType: { $ref: '#/components/schemas/ReportTarget' }
 *                   targetId: { type: string, format: uuid }
 *                   reason: { $ref: '#/components/schemas/ReportReason' }
 *                   details: { type: string, nullable: true }
 *                   excerpt: { type: string, nullable: true, description: Trecho do conteúdo na hora da denúncia }
 *                   status: { $ref: '#/components/schemas/ReportStatus' }
 *                   createdAt: { type: string, format: date-time }
 *                   resolvedAt: { type: string, format: date-time, nullable: true }
 *                   reporter: { type: object, nullable: true }
 *                   reportedUser: { type: object, nullable: true }
 *                   targetExists: { type: boolean, description: O conteúdo ainda existe }
 *                   postId: { type: string, nullable: true, description: Post onde está o conteúdo (posts e comentários) }
 */
reportRoutes.get("/admin/reports", moderation.listReports);

/**
 * @openapi
 * /admin/reports/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Marca uma denúncia como resolvida, descartada ou aberta de novo
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
 *               status: { $ref: '#/components/schemas/ReportStatus' }
 *     responses:
 *       200: { description: Situação atualizada }
 *       404: { description: Denúncia não encontrada }
 */
reportRoutes.patch("/admin/reports/:id", moderation.updateReport);

/**
 * @openapi
 * /blocks:
 *   get:
 *     tags: [Moderação]
 *     summary: Pessoas que você bloqueou
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de pessoas bloqueadas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Author' }
 */
reportRoutes.get("/blocks", requireAuth, moderation.listBlocked);

/**
 * @openapi
 * /profiles/{username}/block:
 *   post:
 *     tags: [Moderação]
 *     summary: Bloqueia uma pessoa
 *     description: >
 *       Desfaz o seguir nos dois sentidos (a amizade e o chat acabam). Vocês deixam de ver os posts
 *       e comentários um do outro, e quem foi bloqueado não encontra mais o seu perfil.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 'Bloqueado ({ blockedByMe: true })' }
 *       400: { description: Tentativa de bloquear a si mesmo }
 *       404: { description: Perfil não encontrado }
 *   delete:
 *     tags: [Moderação]
 *     summary: Desbloqueia uma pessoa
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 'Desbloqueado ({ blockedByMe: false })' }
 *       404: { description: Perfil não encontrado }
 */
reportRoutes.post("/profiles/:username/block", requireAuth, moderation.blockUser);
reportRoutes.delete("/profiles/:username/block", requireAuth, moderation.unblockUser);
