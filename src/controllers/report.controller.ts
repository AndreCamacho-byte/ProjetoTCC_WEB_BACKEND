import type { Request, Response } from "express";
import { z } from "zod";
import * as blocks from "../services/block.service";
import type { Viewer } from "../services/community.service";
import * as reports from "../services/report.service";

const viewerOf = (req: Request): Viewer => ({ id: req.userId!, isAdmin: req.authUser?.role === "ADMIN" });

const usernameParam = z.object({ username: z.string().trim().toLowerCase().min(1).max(30) });
const idParam = z.object({ id: z.uuid("Id inválido") });

export const MAX_REPORT_DETAILS = 500;

const reportSchema = z.object({
  targetType: z.enum(["POST", "COMMENT", "USER", "MESSAGE"], "Diga o que está sendo denunciado"),
  targetId: z.uuid("Id inválido"),
  reason: z.enum(["SPAM", "OFENSA", "ASSEDIO", "CONTEUDO_IMPROPRIO", "RISCO", "OUTRO"], "Escolha um motivo"),
  details: z
    .string()
    .trim()
    .max(MAX_REPORT_DETAILS, `Escreva até ${MAX_REPORT_DETAILS} caracteres`)
    .optional(),
});

const statusQuery = z.object({ status: z.enum(["ABERTA", "RESOLVIDA", "DESCARTADA"]).default("ABERTA") });
const statusSchema = z.object({ status: z.enum(["ABERTA", "RESOLVIDA", "DESCARTADA"], "Escolha a situação") });

// ---------- Denúncias ----------

export async function createReport(req: Request, res: Response) {
  await reports.createReport(viewerOf(req), reportSchema.parse(req.body));
  res.status(201).json({ message: "Denúncia enviada. A equipe do Clutch vai analisar." });
}

export async function listReports(req: Request, res: Response) {
  const { status } = statusQuery.parse(req.query);
  res.json(await reports.listReports(status));
}

export async function updateReport(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { status } = statusSchema.parse(req.body);
  res.json(await reports.updateReport(id, status));
}

// ---------- Bloqueios ----------

export async function blockUser(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await blocks.blockUser(username, viewerOf(req)));
}

export async function unblockUser(req: Request, res: Response) {
  const { username } = usernameParam.parse(req.params);
  res.json(await blocks.unblockUser(username, viewerOf(req)));
}

export async function listBlocked(req: Request, res: Response) {
  res.json(await blocks.listBlocked(viewerOf(req)));
}
