import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`🛹 Clutch API rodando em http://localhost:${env.PORT}/api`);
  console.log(`📚 Swagger em http://localhost:${env.PORT}/api/docs`);
});
