import { Router } from "express";
import { prisma } from "../lib/prisma";

export const healthRoutes = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Verifica se a API e o banco de dados estão funcionando
 *     responses:
 *       200:
 *         description: API no ar
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 database: { type: string, enum: [connected, disconnected] }
 *                 timestamp: { type: string, format: date-time }
 */
healthRoutes.get("/health", async (_req, res) => {
  let database = "connected";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "disconnected";
  }

  res.json({ status: "ok", database, timestamp: new Date().toISOString() });
});
