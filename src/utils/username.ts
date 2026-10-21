import { z } from "zod";

// Regra do @username, a mesma no cadastro e nas configurações da conta
export const usernameField = z
  .string("Escolha um @username")
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Use de 3 a 20 letras minúsculas, números ou _");
