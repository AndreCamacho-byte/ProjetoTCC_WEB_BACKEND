import { Router } from "express";
import { adminRoutes } from "./admin.routes";
import { authRoutes } from "./auth.routes";
import { healthRoutes } from "./health.routes";

// Todas as rotas da API são registradas aqui e ficam sob o prefixo /api (veja app.ts)
export const routes = Router();

routes.use(healthRoutes);
routes.use(authRoutes);
routes.use(adminRoutes);
