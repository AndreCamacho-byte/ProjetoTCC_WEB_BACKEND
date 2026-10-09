import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { swaggerSpec } from "./docs/swagger";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { routes } from "./routes";

export const app = express();

// Não anuncia qual tecnologia o servidor usa
app.disable("x-powered-by");

// Cabeçalhos de segurança em todas as respostas da API
app.use((_req, res, next) => {
  res.set({
    // O navegador não tenta "adivinhar" o tipo do arquivo (evita tratar um upload como script)
    "X-Content-Type-Options": "nosniff",
    // A API não pode ser carregada dentro de outra página (proteção contra clickjacking)
    "X-Frame-Options": "DENY",
    // Não repassa o endereço das páginas para outros sites
    "Referrer-Policy": "no-referrer",
    // Respostas com dados de conta não ficam guardadas no navegador nem em proxies
    // (a rota da foto de perfil define o seu próprio cache)
    "Cache-Control": "no-store",
  });
  next();
});

app.use(cors({ origin: env.CORS_ORIGIN }));
// 1mb para caber a foto de perfil (o padrão do Express é 100kb)
app.use(express.json({ limit: "1mb" }));

// Prefixo /api: é esse caminho que o Nginx do frontend repassa para o backend na AWS
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/api", routes);

app.use(notFoundHandler);
app.use(errorHandler);
