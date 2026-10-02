import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIp, rateLimit, resetRateLimits } from "./rateLimit";

const MINUTE = 60 * 1000;

const request = (ip: string, realIp?: string) =>
  ({ ip, get: (name: string) => (name.toLowerCase() === "x-real-ip" ? realIp : undefined) }) as unknown as Request;

function fakeResponse() {
  const headers: Record<string, string> = {};
  const res = { set: (name: string, value: string) => (headers[name] = value) } as unknown as Response;
  return { res, headers };
}

// Faz uma chamada e diz se passou
function hit(limiter: ReturnType<typeof rateLimit>, req: Request) {
  const { res, headers } = fakeResponse();
  const next = vi.fn();
  try {
    limiter(req, res, next);
    return { allowed: next.mock.calls.length === 1, headers, error: undefined };
  } catch (error) {
    return { allowed: false, headers, error: error as { statusCode: number; code: string; message: string } };
  }
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deixa passar até o limite e bloqueia a seguinte com 429", () => {
    const limiter = rateLimit({ name: "t1", windowMs: 15 * MINUTE, max: 3 });
    const req = request("1.1.1.1");

    expect(hit(limiter, req).allowed).toBe(true);
    expect(hit(limiter, req).allowed).toBe(true);
    expect(hit(limiter, req).allowed).toBe(true);

    const blocked = hit(limiter, req);
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
  });

  it("informa em quanto tempo dá para tentar de novo", () => {
    const limiter = rateLimit({ name: "t2", windowMs: 15 * MINUTE, max: 1 });
    const req = request("1.1.1.1");
    hit(limiter, req);
    vi.advanceTimersByTime(5 * MINUTE);

    const blocked = hit(limiter, req);

    expect(blocked.headers["Retry-After"]).toBe("600");
    expect(blocked.error?.message).toBe("Muitas tentativas. Tente de novo em 10 minutos.");
  });

  it("libera de novo quando a janela de tempo passa", () => {
    const limiter = rateLimit({ name: "t3", windowMs: 15 * MINUTE, max: 1 });
    const req = request("1.1.1.1");

    expect(hit(limiter, req).allowed).toBe(true);
    expect(hit(limiter, req).allowed).toBe(false);

    vi.advanceTimersByTime(15 * MINUTE + 1);
    expect(hit(limiter, req).allowed).toBe(true);
  });

  it("conta cada endereço IP separadamente", () => {
    const limiter = rateLimit({ name: "t4", windowMs: MINUTE, max: 1 });

    expect(hit(limiter, request("1.1.1.1")).allowed).toBe(true);
    expect(hit(limiter, request("1.1.1.1")).allowed).toBe(false);
    expect(hit(limiter, request("2.2.2.2")).allowed).toBe(true);
  });

  it("limites diferentes não dividem a contagem", () => {
    const login = rateLimit({ name: "t5-login", windowMs: MINUTE, max: 1 });
    const register = rateLimit({ name: "t5-register", windowMs: MINUTE, max: 1 });
    const req = request("1.1.1.1");

    expect(hit(login, req).allowed).toBe(true);
    expect(hit(register, req).allowed).toBe(true);
    expect(hit(login, req).allowed).toBe(false);
  });

  it("aceita uma chave própria, como um teto para o site inteiro", () => {
    const limiter = rateLimit({ name: "t6", windowMs: MINUTE, max: 2, key: () => "site", message: "Limite diário." });

    expect(hit(limiter, request("1.1.1.1")).allowed).toBe(true);
    expect(hit(limiter, request("2.2.2.2")).allowed).toBe(true);

    const blocked = hit(limiter, request("3.3.3.3"));
    expect(blocked.allowed).toBe(false);
    expect(blocked.error?.message).toBe("Limite diário.");
  });

  it("resetRateLimits zera as contagens", () => {
    const limiter = rateLimit({ name: "t7", windowMs: MINUTE, max: 1 });
    const req = request("1.1.1.1");
    hit(limiter, req);
    expect(hit(limiter, req).allowed).toBe(false);

    resetRateLimits();

    expect(hit(limiter, req).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("usa o IP que o Nginx repassa no cabeçalho X-Real-IP", () => {
    expect(clientIp(request("10.0.1.10", "200.1.2.3"))).toBe("200.1.2.3");
  });

  it("sem o cabeçalho, usa o IP da conexão", () => {
    expect(clientIp(request("127.0.0.1"))).toBe("127.0.0.1");
  });
});
