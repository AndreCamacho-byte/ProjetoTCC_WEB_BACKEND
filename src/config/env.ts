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

  // Envio de emails por SMTP (o Gmail do projeto, com uma "senha de app" do Google).
  // Sem SMTP_USER/SMTP_PASS (ex.: no seu computador), o email só aparece no terminal.
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().optional(),
  // A senha de app do Google vem em blocos ("abcd efgh ijkl mnop"): os espaços são tirados
  SMTP_PASS: z
    .string()
    .optional()
    .transform((value) => value?.replace(/\s+/g, "") || undefined),
  // Remetente. Vazio = o próprio SMTP_USER (o Gmail só aceita enviar como a própria conta)
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

// Só um dos dois preenchido: a API sobe mesmo assim, mas os emails ficam só no log até completar
if (Boolean(parsed.data.SMTP_USER) !== Boolean(parsed.data.SMTP_PASS)) {
  console.warn("⚠️  Preencha SMTP_USER e SMTP_PASS juntos. Enquanto isso, os emails aparecem só no terminal.");
}

export const env = parsed.data;
