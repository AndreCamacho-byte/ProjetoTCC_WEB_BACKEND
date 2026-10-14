import { Router } from "express";
import * as chat from "../controllers/chat.controller";
import { requireAuth } from "../middlewares/auth";
import { limits } from "../middlewares/rateLimit";

// Chat entre amigos (pessoas que se seguem). Tudo exige login.
export const chatRoutes = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Conversation:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         other: { $ref: '#/components/schemas/Author' }
 *         canSend: { type: boolean, description: Falso quando deixaram de ser amigos (o histórico continua visível) }
 *     ConversationSummary:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         other: { $ref: '#/components/schemas/Author' }
 *         unread: { type: integer, example: 2 }
 *         lastMessage:
 *           type: object
 *           nullable: true
 *           properties:
 *             content: { type: string }
 *             sharedPost: { type: boolean }
 *             mine: { type: boolean }
 *             createdAt: { type: string, format: date-time }
 *     Message:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         content: { type: string, example: Bora na pista amanhã? }
 *         mine: { type: boolean, description: Se foi quem está vendo que mandou }
 *         createdAt: { type: string, format: date-time }
 *         sharedPost: { type: boolean, description: A mensagem levava um post }
 *         post:
 *           type: object
 *           nullable: true
 *           description: Prévia do post compartilhado. Nulo se o post foi apagado.
 *           properties:
 *             id: { type: string, format: uuid }
 *             excerpt: { type: string }
 *             imageUrl: { type: string, nullable: true }
 *             author:
 *               type: object
 *               properties:
 *                 name: { type: string }
 *                 username: { type: string }
 *                 avatarUrl: { type: string, nullable: true }
 */

/**
 * @openapi
 * /friends:
 *   get:
 *     tags: [Chat]
 *     summary: Seus amigos (pessoas que você segue e que te seguem)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Amigos em ordem alfabética
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Author' }
 */
chatRoutes.get("/friends", requireAuth, chat.listFriends);

/**
 * @openapi
 * /chats:
 *   get:
 *     tags: [Chat]
 *     summary: Suas conversas (a mais recente primeiro)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conversas que têm pelo menos uma mensagem
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ConversationSummary' }
 *   post:
 *     tags: [Chat]
 *     summary: Abre a conversa com um amigo (cria se ainda não existir)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string, example: tonyhawk }
 *     responses:
 *       200:
 *         description: A conversa
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Conversation' }
 *       403:
 *         description: Vocês não se seguem (código NOT_FRIENDS)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
chatRoutes.get("/chats", requireAuth, chat.listConversations);
chatRoutes.post("/chats", requireAuth, chat.openConversation);

/**
 * @openapi
 * /chats/unread-count:
 *   get:
 *     tags: [Chat]
 *     summary: Total de mensagens não lidas
 *     description: O site pergunta de tempos em tempos para mostrar o número no ícone do chat.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Quantidade
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer, example: 3 }
 */
chatRoutes.get("/chats/unread-count", requireAuth, chat.unreadCount);

/**
 * @openapi
 * /chats/share:
 *   post:
 *     tags: [Chat]
 *     summary: Envia um post para até 10 amigos
 *     description: Cada amigo recebe o post na conversa com você. Se algum não for seu amigo, nada é enviado.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [postId, usernames]
 *             properties:
 *               postId: { type: string, format: uuid }
 *               usernames:
 *                 type: array
 *                 maxItems: 10
 *                 items: { type: string, example: tonyhawk }
 *               content: { type: string, description: Mensagem opcional junto com o post }
 *     responses:
 *       201:
 *         description: Enviado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sent: { type: integer, example: 2 }
 *       403:
 *         description: Alguém da lista não é seu amigo
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
chatRoutes.post("/chats/share", requireAuth, limits.messaging, chat.sharePost);

/**
 * @openapi
 * /chats/{id}:
 *   get:
 *     tags: [Chat]
 *     summary: Dados de uma conversa sua
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A conversa
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Conversation' }
 *       404:
 *         description: Conversa não encontrada (ou de outras pessoas)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
chatRoutes.get("/chats/:id", requireAuth, chat.getConversation);

/**
 * @openapi
 * /chats/{id}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: Mensagens da conversa (das mais antigas para as mais novas)
 *     description: Sem parâmetros, traz as últimas. "cursor" busca as anteriores; "after" traz só as que chegaram depois de uma mensagem (usado para atualizar a tela).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: after
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 30 }
 *     responses:
 *       200:
 *         description: Mensagens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Message' }
 *                 nextCursor: { type: string, nullable: true, description: Para buscar as mais antigas }
 *   post:
 *     tags: [Chat]
 *     summary: Manda uma mensagem
 *     description: Texto de até 1000 caracteres e/ou um post. Só entre amigos. Limite de 300 mensagens por hora.
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
 *               content: { type: string, maxLength: 1000 }
 *               postId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Mensagem enviada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Message' }
 *       403:
 *         description: Vocês não se seguem mais (código NOT_FRIENDS)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
chatRoutes.get("/chats/:id/messages", requireAuth, chat.listMessages);
chatRoutes.post("/chats/:id/messages", requireAuth, limits.messaging, chat.sendMessage);

/**
 * @openapi
 * /chats/{id}/read:
 *   put:
 *     tags: [Chat]
 *     summary: Marca a conversa como lida
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Marcada como lida
 */
chatRoutes.put("/chats/:id/read", requireAuth, chat.markRead);
