import type { RequestHandler } from "express";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { MIN_AGE, ageStatus } from "../utils/age";

// Protege as rotas de spots/encontros e do marketplace. Use sempre depois do requireAuth:
//   router.post("/spots", requireAuth, requireMinAge, controller.create)
// Bloqueia quem tem menos de 12 anos e quem ainda não informou a data de nascimento.
export const requireMinAge: RequestHandler = async (req, _res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { birthDate: true } });
  const status = ageStatus(user?.birthDate ?? null);

  if (status === "UNVERIFIED") {
    throw new AppError("Informe sua data de nascimento para liberar esta área.", 403, "AGE_NOT_VERIFIED");
  }
  if (status === "UNDERAGE") {
    throw new AppError(`Esta área só é liberada a partir dos ${MIN_AGE} anos.`, 403, "AGE_RESTRICTED");
  }

  next();
};
