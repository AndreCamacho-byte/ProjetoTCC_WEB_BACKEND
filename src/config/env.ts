import "dotenv/config";
import { z } from "zod";

// Valida as variáveis de ambiente na inicialização: se faltar algo, a API nem sobe
// e mostra exatamente qual variável está errada.
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa ter pelo menos 32 caracteres"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("*"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Envio de emails pelo Brevo. Sem a chave, o link de confirmação só aparece no terminal.
  BREVO_API_KEY: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().optional(),
  MAIL_FROM_NAME: z.string().default("Clutch"),
  // Endereço do site usado nos links dos emails (ex.: http://13.219.234.57).
  // Se ficar vazio, usa o endereço de onde veio o cadastro.
  APP_URL: z.string().optional(),

  // Emails (separados por vírgula) que viram administradores ao confirmar a conta ou fazer login
  ADMIN_EMAILS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variáveis de ambiente inválidas:");
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

if (parsed.data.BREVO_API_KEY && !parsed.data.MAIL_FROM_EMAIL) {
  console.error("❌ MAIL_FROM_EMAIL é obrigatório quando BREVO_API_KEY está preenchida");
  process.exit(1);
}

export const env = parsed.data;
