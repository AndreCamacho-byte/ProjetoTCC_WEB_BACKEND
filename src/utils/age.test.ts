import { describe, expect, it } from "vitest";
import { MIN_AGE, ageFrom, ageStatus, birthDateSchema } from "./age";

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("ageFrom", () => {
  const today = new Date("2026-10-02T15:00:00.000Z");

  it("conta os anos completos", () => {
    expect(ageFrom(date("2000-01-15"), today)).toBe(26);
  });

  it("já conta o ano no dia do aniversário", () => {
    expect(ageFrom(date("2014-10-02"), today)).toBe(12);
  });

  it("não conta o ano se o aniversário é amanhã", () => {
    expect(ageFrom(date("2014-10-03"), today)).toBe(11);
  });

  it("não conta o ano se o aniversário é em um mês que ainda não chegou", () => {
    expect(ageFrom(date("2014-12-01"), today)).toBe(11);
  });
});

describe("ageStatus", () => {
  const yearsAgo = (years: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
  };

  it("sem data de nascimento a idade fica como não verificada", () => {
    expect(ageStatus(null)).toBe("UNVERIFIED");
  });

  it("bloqueia quem tem menos que a idade mínima", () => {
    expect(ageStatus(yearsAgo(MIN_AGE - 1))).toBe("UNDERAGE");
  });

  it("libera quem faz a idade mínima hoje", () => {
    expect(ageStatus(yearsAgo(MIN_AGE))).toBe("OK");
  });

  it("libera adultos", () => {
    expect(ageStatus(yearsAgo(30))).toBe("OK");
  });
});

describe("birthDateSchema", () => {
  const isValid = (value: unknown) => birthDateSchema.safeParse(value).success;

  it("aceita uma data válida e converte para Date em UTC", () => {
    const result = birthDateSchema.parse("2005-05-12");
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2005-05-12T00:00:00.000Z");
  });

  it("aceita 29 de fevereiro em ano bissexto", () => {
    expect(isValid("2004-02-29")).toBe(true);
  });

  it.each([
    ["31 de fevereiro", "2005-02-31"],
    ["29 de fevereiro fora de ano bissexto", "2005-02-29"],
    ["mês 13", "2005-13-01"],
    ["formato brasileiro", "12/05/2005"],
    ["texto vazio", ""],
    ["data no futuro", "2999-01-01"],
    ["mais de 120 anos atrás", "1850-01-01"],
  ])("recusa %s", (_caso, value) => {
    expect(isValid(value)).toBe(false);
  });

  it("recusa valores que não são texto", () => {
    expect(isValid(undefined)).toBe(false);
    expect(isValid(20050512)).toBe(false);
  });
});
