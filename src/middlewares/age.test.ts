import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import { requireMinAge } from "./age";

const req = { userId: "user-1" } as Request;
const res = {} as Response;

const yearsAgo = (years: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
};

describe("requireMinAge", () => {
  it("libera quem tem 12 anos ou mais", async () => {
    prisma.user.findUnique.mockResolvedValue({ birthDate: yearsAgo(12) });
    const next = vi.fn();

    await requireMinAge(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("bloqueia menores de 12 anos", async () => {
    prisma.user.findUnique.mockResolvedValue({ birthDate: yearsAgo(11) });
    await expect(requireMinAge(req, res, vi.fn())).rejects.toMatchObject({
      statusCode: 403,
      code: "AGE_RESTRICTED",
    });
  });

  it("bloqueia contas sem data de nascimento (idade não verificada)", async () => {
    prisma.user.findUnique.mockResolvedValue({ birthDate: null });
    await expect(requireMinAge(req, res, vi.fn())).rejects.toMatchObject({
      statusCode: 403,
      code: "AGE_NOT_VERIFIED",
    });
  });

  it("bloqueia quando a conta não existe mais", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(requireMinAge(req, res, vi.fn())).rejects.toMatchObject({ code: "AGE_NOT_VERIFIED" });
  });

  it("não chama a rota quando bloqueia", async () => {
    prisma.user.findUnique.mockResolvedValue({ birthDate: yearsAgo(5) });
    const next = vi.fn();
    await expect(requireMinAge(req, res, next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});
