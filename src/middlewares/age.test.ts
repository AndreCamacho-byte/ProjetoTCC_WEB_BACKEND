import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { MIN_AGE } from "../utils/age";
import { requireMinAge } from "./age";

const res = {} as Response;

const yearsAgo = (years: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
};

// O requireAuth roda antes e deixa os dados da conta em req.authUser
const requestBornOn = (birthDate: Date | null) => ({ authUser: { role: "USER", birthDate } }) as Request;

describe("requireMinAge", () => {
  it("libera quem tem a idade mínima (13 anos) ou mais", () => {
    const next = vi.fn();
    requireMinAge(requestBornOn(yearsAgo(MIN_AGE)), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("bloqueia quem tem menos que a idade mínima", () => {
    expect(() => requireMinAge(requestBornOn(yearsAgo(MIN_AGE - 1)), res, vi.fn())).toThrowError(
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
