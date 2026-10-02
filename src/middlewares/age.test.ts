import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireMinAge } from "./age";

const res = {} as Response;

const yearsAgo = (years: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
};

// O requireAuth roda antes e deixa os dados da conta em req.authUser
const requestBornOn = (birthDate: Date | null) => ({ authUser: { role: "USER", birthDate } }) as Request;

describe("requireMinAge", () => {
  it("libera quem tem 12 anos ou mais", () => {
    const next = vi.fn();
    requireMinAge(requestBornOn(yearsAgo(12)), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("bloqueia menores de 12 anos", () => {
    expect(() => requireMinAge(requestBornOn(yearsAgo(11)), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 403, code: "AGE_RESTRICTED" }),
    );
  });

  it("bloqueia contas sem data de nascimento (idade não verificada)", () => {
    expect(() => requireMinAge(requestBornOn(null), res, vi.fn())).toThrowError(
      expect.objectContaining({ statusCode: 403, code: "AGE_NOT_VERIFIED" }),
    );
  });

  it("bloqueia quando o login não foi conferido antes", () => {
    expect(() => requireMinAge({} as Request, res, vi.fn())).toThrowError(
      expect.objectContaining({ code: "AGE_NOT_VERIFIED" }),
    );
  });

  it("não chama a rota quando bloqueia", () => {
    const next = vi.fn();
    expect(() => requireMinAge(requestBornOn(yearsAgo(5)), res, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});
