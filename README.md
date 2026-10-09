# Clutch — Backend

API do **Clutch**, rede social para skatistas com marketplace streetwear e spots de encontro no mapa.

**Stack:** Node.js 20+ · Express 5 · TypeScript · Prisma · PostgreSQL (Aiven) · Swagger

## Como rodar

```bash
npm install
cp .env.example .env      # preencha a DATABASE_URL do Aiven
npm run db:migrate        # cria as tabelas no banco
npm run dev               # sobe a API com recarregamento automático
```

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- Status: http://localhost:3000/api/health

## Variáveis de ambiente

Ficam no arquivo `.env` (modelo em `.env.example`). Esse arquivo nunca vai para o GitHub.

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL (Aiven) |
| `JWT_SECRET` | Chave que assina os tokens de login |
| `BREVO_API_KEY` e `MAIL_FROM_EMAIL` | Envio de emails pelo Brevo. Sem a chave, o email aparece só no terminal |
| `ADMIN_EMAILS` | Emails (separados por vírgula) das contas que são administradoras |
| `PORT`, `CORS_ORIGIN`, `APP_URL` | Opcionais |

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe em modo desenvolvimento (recarrega ao salvar) |
| `npm start` | Compila o TypeScript e sobe a versão de produção (usado pelo PM2 na EC2) |
| `npm run db:migrate` | Cria uma migration a partir do `schema.prisma` e aplica no banco |
| `npm run db:deploy` | Aplica migrations existentes (produção) |
| `npm run db:studio` | Abre o Prisma Studio para ver os dados do banco |

## Estrutura

```
src/
├── config/        variáveis de ambiente validadas
├── controllers/   recebem a requisição e devolvem a resposta
├── services/      regras de negócio
├── routes/        endpoints + documentação Swagger (@openapi)
├── middlewares/   autenticação, tratamento de erros
├── errors/        AppError
├── docs/          configuração do Swagger
├── lib/           cliente do Prisma
├── app.ts         configuração do Express
└── server.ts      inicialização
prisma/
└── schema.prisma  modelo do banco
```

## Documentando rotas no Swagger

Escreva um comentário `@openapi` em cima da rota, dentro de `src/routes/`. Ele aparece automaticamente em `/api/docs`. Veja `src/routes/health.routes.ts` como exemplo.

## Testes

```bash
npm test              # roda todos os testes uma vez
npm run test:watch    # fica rodando e repete a cada alteração
```

Os testes ficam ao lado de cada arquivo (`*.test.ts`) e usam o [Vitest](https://vitest.dev). Eles não precisam de banco nem de internet: o Prisma e o envio de email são substituídos por versões simuladas (`src/test/prismaMock.ts`).

| Arquivo | O que testa |
|---|---|
| `utils/age.test.ts` | cálculo da idade, regra dos 12 anos e validação da data de nascimento |
| `emails/emails.test.ts` | conteúdo dos emails de confirmação e de redefinição de senha |
| `middlewares/*.test.ts` | login por token, acesso de administrador, idade mínima e respostas de erro |
| `services/*.test.ts` | regras de cadastro, login, confirmação de email, senha, conta e painel admin |
| `services/market.service.test.ts` | loja: catálogo, carrinho, fechamento de pedido (estoque), situação dos pedidos e cadastro de produtos |
| `routes/routes.test.ts` | as rotas pelo lado de fora: validação dos dados, códigos de status e proteções |
| `routes/market.routes.test.ts` | rotas da loja: o que é público, o que exige login e 12 anos, o que é só do administrador |
