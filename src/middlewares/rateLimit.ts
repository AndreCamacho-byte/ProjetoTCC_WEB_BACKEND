import type { Request, RequestHandler } from "express";
import { AppError } from "../errors/AppError";

type RateLimitOptions = {
  // Nome do limite (cada um tem a sua própria contagem)
  name: string;
  // Tamanho da janela de tempo, em milissegundos
  windowMs: number;
  // Quantas requisições cabem na janela
  max: number;
  // De quem é a contagem. Padrão: o endereço IP de quem fez a requisição
  key?: (req: Request) => string;
  message?: string;
};

type Counter = { count: number; resetAt: number };

// As contagens ficam na memória do servidor (um Map por limite). Para um único servidor,
// como o do Clutch, é suficiente; ao reiniciar a API as contagens zeram.
const stores = new Map<string, Map<string, Counter>>();

// O Nginx do frontend repassa o IP de quem acessou no cabeçalho X-Real-IP.
// Sem ele (rodando no computador, sem Nginx), usa o IP da própria conexão.
export function clientIp(req: Request) {
  return req.get("x-real-ip") || req.ip || "desconhecido";
}

// Limita quantas vezes a mesma origem pode chamar uma rota dentro de uma janela de tempo.
// Passou do limite: responde 429 e informa em quantos segundos dá para tentar de novo.
export function rateLimit({ name, windowMs, max, key = clientIp, message }: RateLimitOptions): RequestHandler {
  const store = new Map<string, Counter>();
  stores.set(name, store);

  return (req, res, next) => {
    const now = Date.now();
    const id = key(req);
    let counter = store.get(id);

    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + windowMs };
      store.set(id, counter);
    }

    counter.count += 1;

    if (counter.count > max) {
      const retryAfterSeconds = Math.ceil((counter.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      const minutes = Math.ceil(retryAfterSeconds / 60);
      throw new AppError(
        message ?? `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
        429,
        "RATE_LIMITED",
      );
    }

    // Faxina: de vez em quando apaga as contagens que já venceram, para o Map não crescer sem parar
    if (store.size > 5000) {
      for (const [entryId, entry] of store) {
        if (entry.resetAt <= now) store.delete(entryId);
      }
    }

    next();
  };
}

// Zera todas as contagens (usado nos testes)
export function resetRateLimits() {
  for (const store of stores.values()) store.clear();
}

const MINUTE = 60 * 1000;

// Limites usados nas rotas de autenticação
export const limits = {
  // Tentativas de login: dificulta adivinhar senhas por força bruta
  login: rateLimit({ name: "login", windowMs: 15 * MINUTE, max: 30 }),
  // Criação de contas
  register: rateLimit({ name: "register", windowMs: 60 * MINUTE, max: 20 }),
  // Pedidos de email (reenviar código, esqueci minha senha)
  emailRequest: rateLimit({ name: "emailRequest", windowMs: 15 * MINUTE, max: 10 }),
  // Uso de códigos e links (confirmar email, criar nova senha)
  tokenUse: rateLimit({ name: "tokenUse", windowMs: 15 * MINUTE, max: 30 }),
  // Teto do site inteiro para rotas que enviam email: o plano gratuito do Brevo tem 300 por dia,
  // e sem isso bastaria alguém disparar cadastros para travar o envio de todo mundo
  dailyEmails: rateLimit({
    name: "dailyEmails",
    windowMs: 24 * 60 * MINUTE,
    max: 250,
    key: () => "site-inteiro",
    message: "O limite diário de envio de emails foi atingido. Tente de novo amanhã.",
  }),
};
