import { Router } from "express";
import * as spots from "../controllers/spot.controller";

// Aprovação de spots. O login e a função de administrador são conferidos em admin.routes.ts
// (adminRoutes.use("/admin", requireAuth, requireAdmin)), que vem antes deste arquivo.
export const adminSpotRoutes = Router();

/**
 * @openapi
 * /admin/spots:
 *   get:
 *     tags: [Admin]
 *     summary: 'Spots por situação (padrão: pendentes, os mais antigos primeiro)'
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { $ref: '#/components/schemas/SpotStatus' }
 *     responses:
 *       200:
 *         description: Até 100 spots, com nome e @ de quem sugeriu
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
 *                   type: { $ref: '#/components/schemas/SpotType' }
 *                   address: { type: string, nullable: true }
 *                   latitude: { type: number }
 *                   longitude: { type: number }
 *                   status: { $ref: '#/components/schemas/SpotStatus' }
 *                   imageUrls: { type: array, items: { type: string } }
 *                   createdBy:
 *                     type: object
 *                     nullable: true
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       username: { type: string }
 *                   createdAt: { type: string, format: date-time }
 */
adminSpotRoutes.get("/admin/spots", spots.listSpotsForReview);

/**
 * @openapi
 * /admin/spots/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Aprova ou recusa um spot
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
 *               status: { type: string, enum: [APROVADO, RECUSADO] }
 *     responses:
 *       200: { description: Situação atualizada }
 *       404: { description: Spot não encontrado }
 */
adminSpotRoutes.patch("/admin/spots/:id", spots.reviewSpot);
