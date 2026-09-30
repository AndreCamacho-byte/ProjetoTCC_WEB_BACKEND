import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth";

export const authRoutes = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, example: Tony Hawk }
 *         username: { type: string, example: tonyhawk }
 *         email: { type: string, format: email, example: tony@clutch.com }
 *         avatarUrl: { type: string, nullable: true }
 *         bio: { type: string, nullable: true }
 *         skateLevel: { type: string, nullable: true, enum: [INICIANTE, INTERMEDIARIO, AVANCADO, PROFISSIONAL] }
 *         role: { type: string, enum: [USER, ADMIN] }
 *         emailVerifiedAt: { type: string, format: date-time, nullable: true, description: Data da confirmação do email }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user: { $ref: '#/components/schemas/User' }
 *         token: { type: string, description: JWT para enviar no header Authorization }
 *     Message:
 *       type: object
 *       properties:
 *         message: { type: string }
 *     ValidationError:
 *       type: object
 *       properties:
 *         error: { type: string, example: Dados inválidos }
 *         details:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               field: { type: string, example: email }
 *               message: { type: string, example: Email inválido }
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Cria uma conta
 *     description: |
 *       O @username é gerado automaticamente a partir do email.
 *       A conta nasce **sem confirmação**: é enviado um email com um link (válido por 24h)
 *       e o login só é liberado depois que a pessoa clica nele. Por isso esta rota não devolve token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Tony Hawk }
 *               email: { type: string, format: email, example: tony@clutch.com }
 *               password: { type: string, format: password, minLength: 8, example: skate1234 }
 *     responses:
 *       201:
 *         description: Conta criada e email de confirmação enviado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 email: { type: string, format: email, example: tony@clutch.com }
 *                 message: { type: string, example: Conta criada. Enviamos um link de confirmação para o seu email. }
 *       400:
 *         description: Dados inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 *       409:
 *         description: Email já cadastrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
authRoutes.post("/auth/register", authController.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Faz login e devolve o token JWT
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: tony@clutch.com }
 *               password: { type: string, format: password, example: skate1234 }
 *     responses:
 *       200:
 *         description: Login realizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400:
 *         description: Dados inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationError' }
 *       401:
 *         description: Email ou senha incorretos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Email ainda não confirmado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string, example: Confirme seu email antes de entrar. }
 *                 code: { type: string, example: EMAIL_NOT_VERIFIED }
 */
authRoutes.post("/auth/login", authController.login);

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Confirma o email com o token do link e já faz o login
 *     description: O token vem no link enviado por email (`/confirmar-email?token=...`). Cada link só pode ser usado uma vez.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Email confirmado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400:
 *         description: Link inválido, já usado ou expirado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string, example: INVALID_TOKEN }
 */
authRoutes.post("/auth/verify-email", authController.verifyEmail);

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Reenvia o email de confirmação
 *     description: |
 *       Responde sempre a mesma mensagem, exista ou não a conta (para não revelar quais emails estão cadastrados).
 *       Só envia se a conta ainda não foi confirmada, e no máximo um email por minuto.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: tony@clutch.com }
 *     responses:
 *       200:
 *         description: Pedido recebido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Message' }
 */
authRoutes.post("/auth/resend-verification", authController.resendVerification);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Retorna o usuário logado
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usuário logado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Token ausente, inválido ou expirado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
authRoutes.get("/auth/me", requireAuth, authController.me);
