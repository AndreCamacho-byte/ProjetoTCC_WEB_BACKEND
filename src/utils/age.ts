import { z } from "zod";

// Idade mínima para usar os spots/encontros e o marketplace
export const MIN_AGE = 12;

// Data de nascimento no formato AAAA-MM-DD (o mesmo que o campo <input type="date"> envia)
export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de nascimento")
  // O JavaScript "conserta" datas que não existem (31/02 vira 03/03) em vez de recusar.
  // Por isso a data só vale se, convertida de volta para texto, continuar igual à digitada.
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Data de nascimento inválida")
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => date.getTime() <= Date.now(), "A data de nascimento não pode estar no futuro")
  .refine((date) => ageFrom(date) <= 120, "Data de nascimento inválida");

// Idade em anos completos. As datas de nascimento são guardadas em UTC, sem hora.
export function ageFrom(birthDate: Date, today = new Date()) {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const hadBirthdayThisYear =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() >= birthDate.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Situação da conta em relação à regra de idade:
// - UNVERIFIED: conta sem data de nascimento (criada antes de o cadastro pedir)
// - UNDERAGE: menor de 12 anos
// - OK: liberada
export type AgeStatus = "UNVERIFIED" | "UNDERAGE" | "OK";

export function ageStatus(birthDate: Date | null): AgeStatus {
  if (!birthDate) return "UNVERIFIED";
  return ageFrom(birthDate) < MIN_AGE ? "UNDERAGE" : "OK";
}
