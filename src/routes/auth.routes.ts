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
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user: { $ref: '#/components/schemas/User' }
 *         token: { type: string, description: JWT para enviar no header Authorization }
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
 *     description: O @username é gerado automaticamente a partir do email.
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
 *         description: Conta criada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
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
 */
authRoutes.post("/auth/login", authController.login);

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
