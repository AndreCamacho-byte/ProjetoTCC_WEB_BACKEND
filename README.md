# Clutch — Backend (API)

API do **Clutch**, a rede social do skatista: contas, spots e encontros no mapa, comunidade, chat entre amigos e loja de streetwear. Projeto de Trabalho de Conclusão de Curso (turma DS2A, 2026).

**Grupo:** André Camacho, Gabriel Neri, Guilherme Sales e Tito Leal.

| Repositório | O que é |
|---|---|
| [ProjetoTCC_WEB_REACTJS](https://github.com/AndreCamacho-byte/ProjetoTCC_WEB_REACTJS) | Site em React |
| **ProjetoTCC_WEB_BACKEND** (este) | API e banco de dados |
| [Terraform_TCC_WEB_REACT](https://github.com/AndreCamacho-byte/Terraform_TCC_WEB_REACT) | Infraestrutura na AWS |

## Tecnologias

Node.js 22 · Express 5 · TypeScript · Prisma 6 · PostgreSQL (Aiven) · Zod · JWT + bcrypt · Nodemailer (Gmail) · Swagger · Vitest + Supertest

## Como rodar

```bash
npm install
cp .env.example .env      # preencha a DATABASE_URL do Aiven e o JWT_SECRET
npm run db:deploy         # cria as tabelas no banco (aplica as migrations)
npm run dev               # sobe a API e recarrega ao salvar
```

- API: http://localhost:3000/api
- Documentação (Swagger): http://localhost:3000/api/docs
- Status: http://localhost:3000/api/health

Sem `SMTP_USER` e `SMTP_PASS`, nenhum email é enviado: o código de confirmação e o de login aparecem no terminal, o que serve para testar no computador.

## Variáveis de ambiente

Ficam no arquivo `.env` (modelo em `.env.example`). Esse arquivo nunca vai para o GitHub.

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL (Aiven) |
| `JWT_SECRET` | Chave que assina os tokens de login (pelo menos 32 caracteres) |
| `SMTP_USER` e `SMTP_PASS` | Envio de emails pelo Gmail do projeto (senha de app do Google). Sem eles, o email aparece só no terminal |
| `ADMIN_EMAILS` | Emails (separados por vírgula) das contas que são administradoras |
| `PORT`, `CORS_ORIGIN`, `APP_URL`, `JWT_EXPIRES_IN` | Opcionais |

## Arquitetura

Arquitetura em camadas, que divide as responsabilidades como o MVC (as "views" são o site e o app, que recebem JSON):

```
Pedido HTTP → routes/ → controllers/ → services/ → Prisma → PostgreSQL
              endereço   valida (Zod)   regras de    acesso ao
              + Swagger  e responde     negócio      banco
```

Erros esperados são lançados com `throw new AppError(mensagem, status, código)` e viram respostas JSON no `middlewares/errorHandler.ts`.

## Rotas (resumo)

A lista completa, com o que mandar e o que volta, está no Swagger em `/api/docs`.

| Área | Prefixo | Acesso |
|---|---|---|
| Status | `/health` | Público |
| Cadastro e login | `/auth/register`, `/auth/verify-code`, `/auth/verify-email`, `/auth/login`, `/auth/login/verify`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/me` | Público (o `/me` exige login) |
| Conta | `/users/me` (perfil, foto, senha, data de nascimento, exclusão) | Login |
| Comunidade | `/posts`, `/comments`, `/profiles`, `/saved/posts` | Login |
| Chat | `/friends`, `/chats` | Login (só entre amigos) |
| Loja | `/products`, `/brands` (público), `/cart`, `/orders`, `/saved/products` | Login + 12 anos para comprar |
| Spots e encontros | `/spots`, `/meetups` | Login + 12 anos |
| Painel | `/admin/users`, `/admin/products`, `/admin/brands`, `/admin/orders`, `/admin/spots` | Só administrador |

## Banco de dados

25 tabelas em PostgreSQL, descritas em `prisma/schema.prisma`, com 14 migrations em `prisma/migrations/`. Todas se ligam à tabela `users`; excluir uma conta apaga em cascata os dados dela. Senhas e códigos ficam só como hash; fotos ficam no próprio banco.

Para mudar o banco: edite o `schema.prisma`, gere a migration e aplique com `npm run db:deploy`.

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe em modo desenvolvimento (recarrega ao salvar) |
| `npm start` | Compila o TypeScript e sobe a versão de produção (usado pelo PM2 na AWS) |
| `npm run db:migrate` | Cria uma migration a partir do `schema.prisma` e aplica no banco |
| `npm run db:deploy` | Aplica as migrations existentes |
| `npm run db:studio` | Abre o Prisma Studio para ver os dados do banco |
| `npm test` | Roda os testes automáticos |
| `npm run typecheck:tests` | Confere os tipos dos arquivos de teste |

## Estrutura

```
src/
├── config/        variáveis de ambiente validadas
├── routes/        endpoints + documentação Swagger (@openapi)
├── controllers/   validam os dados (Zod) e devolvem a resposta
├── services/      regras de negócio
├── middlewares/   login (requireAuth), administrador, idade mínima, limite de tentativas, erros
├── emails/        modelos dos emails (confirmação, código de login, nova senha)
├── lib/           Prisma e envio de email (SMTP)
├── utils/         idade, fotos JPEG, @username
├── errors/        AppError
├── docs/          configuração do Swagger
├── test/          banco simulado e preparo dos testes
├── app.ts         configuração do Express (cabeçalhos de segurança, limites de tamanho)
└── server.ts      inicialização
prisma/
├── schema.prisma  modelo do banco
└── migrations/    histórico das mudanças do banco
```

## Segurança

- Login em duas etapas: senha + código de 6 dígitos por email (vale 10 minutos, 5 tentativas, uso único).
- Senhas com bcrypt; códigos e links de email guardados só como hash.
- Token JWT conferido no banco a cada pedido: conta excluída ou suspensa perde o acesso na hora; trocar a senha encerra os outros logins.
- Limite de tentativas por IP e por conta (login, cadastro, emails, posts, mensagens, spots).
- Idade mínima de 12 anos para spots, encontros e loja (`requireMinAge`).
- O email de uma pessoa nunca aparece para as outras.

## Testes

```bash
npm test
```

**415 testes** em 17 arquivos, todos passando. Ficam ao lado de cada arquivo (`*.test.ts`) e usam o [Vitest](https://vitest.dev). Não precisam de banco nem de internet: o Prisma e o envio de email são substituídos por versões simuladas (`src/test/prismaMock.ts`).

| Arquivo | O que testa |
|---|---|
| `services/auth.service.test.ts` | cadastro, @username único, confirmação de email, login com código, nova senha |
| `services/account.service.test.ts`, `admin.service.test.ts` | configurações da conta e painel do administrador |
| `services/community.service.test.ts`, `chat.service.test.ts` | feed, posts, comentários, seguir e chat só entre amigos |
| `services/market.service.test.ts` | catálogo, carrinho, fechamento de pedido (estoque) e situação dos pedidos |
| `services/spot.service.test.ts` | spots com aprovação, encontros, limite de pessoas, desmarcar presença e cancelamento |
| `middlewares/*.test.ts` | login por token, administrador, idade mínima, limite de tentativas e respostas de erro |
| `routes/*.test.ts` | as rotas pelo lado de fora: validação, códigos de resposta e proteções |
| `utils/age.test.ts`, `emails/emails.test.ts` | cálculo da idade e conteúdo dos emails |

## Publicação (deploy)

A API roda na AWS, numa máquina criada pelo [Terraform](https://github.com/AndreCamacho-byte/Terraform_TCC_WEB_REACT). Ao ser criada, a máquina baixa este repositório, roda `npm install`, `prisma migrate deploy` e sobe a API com o PM2 (`npm start`). O Nginx da máquina do site repassa para ela tudo o que começa com `/api`.
