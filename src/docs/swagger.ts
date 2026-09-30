import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";

// A documentação é montada a partir dos comentários @openapi escritos em cima de cada rota
// (veja src/routes/health.routes.ts). Acesse em http://localhost:3000/api/docs
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Clutch API",
      version: "0.0.1",
      description: "API do Clutch: rede social para skatistas, marketplace streetwear e spots de encontro.",
    },
    servers: [{ url: "/api" }],
    tags: [
      { name: "Health", description: "Status da API" },
      { name: "Auth", description: "Cadastro e login" },
      { name: "Users", description: "Perfis e seguidores" },
      { name: "Posts", description: "Feed, curtidas e comentários" },
      { name: "Spots", description: "Spots no mapa e encontros" },
      { name: "Marketplace", description: "Marcas, produtos, carrinho e pedidos" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string", example: "Mensagem de erro" } },
        },
      },
    },
  },
  // .ts em desenvolvimento (tsx) e .js depois do build (dist)
  apis: [path.join(__dirname, "../routes/*.{ts,js}").replace(/\\/g, "/")],
});
