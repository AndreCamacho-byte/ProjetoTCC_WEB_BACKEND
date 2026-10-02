// Variáveis de ambiente dos testes. São definidas aqui para os testes rodarem em qualquer
// máquina, mesmo sem o arquivo .env, e para nunca usarem o banco nem o envio de email reais
// (nos testes o Prisma e o envio de email são substituídos por versões simuladas).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.JWT_SECRET = "segredo-usado-apenas-nos-testes-automatizados-0123456789";
process.env.BREVO_API_KEY = "";
process.env.ADMIN_EMAILS = "admin@clutch.test";
process.env.APP_URL = "";
