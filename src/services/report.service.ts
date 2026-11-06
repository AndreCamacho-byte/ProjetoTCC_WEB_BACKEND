import type { ReportReason, ReportStatus, ReportTarget } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import type { Viewer } from "./community.service";

// Denúncias: qualquer pessoa logada denuncia um post, um comentário, um perfil ou uma mensagem
// que recebeu. A denúncia guarda um trecho do conteúdo (para o admin entender mesmo que ele
// seja apagado depois) e vai para a fila do painel do admin.

const EXCERPT_LENGTH = 300;
const excerptOf = (text: string) => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text);

type ReportInput = { targetType: ReportTarget; targetId: string; reason: ReportReason; details?: string };

const notFound = () => new AppError("Conteúdo não encontrado", 404);

// Confere se quem denuncia consegue ver o alvo e descobre quem é o dono dele
async function findTarget(viewer: Viewer, targetType: ReportTarget, targetId: string) {
  switch (targetType) {
    case "POST": {
      const post = await prisma.post.findUnique({
        where: { id: targetId },
        select: { authorId: true, content: true, _count: { select: { images: true } } },
      });
      if (!post) throw notFound();
      const photos = post._count.images > 0 ? ` [${post._count.images} foto(s)]` : "";
      return { ownerId: post.authorId, excerpt: excerptOf(`${post.content}${photos}`.trim()) };
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({ where: { id: targetId }, select: { authorId: true, content: true } });
      if (!comment) throw notFound();
      return { ownerId: comment.authorId, excerpt: excerptOf(comment.content) };
    }
    case "USER": {
      const user = await prisma.user.findFirst({
        where: { id: targetId, emailVerifiedAt: { not: null } },
        select: { id: true, name: true, username: true, bio: true },
      });
      if (!user) throw notFound();
      return { ownerId: user.id, excerpt: excerptOf(`${user.name} (@${user.username})${user.bio ? `: ${user.bio}` : ""}`) };
    }
    case "MESSAGE": {
      // Só quem recebeu a mensagem pode denunciá-la (é a única forma de a equipe ver um trecho do chat)
      const message = await prisma.message.findUnique({
        where: { id: targetId },
        select: { senderId: true, content: true, conversation: { select: { userAId: true, userBId: true } } },
      });
      const isParticipant = message && [message.conversation.userAId, message.conversation.userBId].includes(viewer.id);
      if (!message || !isParticipant) throw notFound();
      return { ownerId: message.senderId, excerpt: excerptOf(message.content || "[post compartilhado]") };
    }
  }
}

export async function createReport(viewer: Viewer, { targetType, targetId, reason, details }: ReportInput) {
  const target = await findTarget(viewer, targetType, targetId);
  if (target.ownerId === viewer.id) {
    throw new AppError("Você não pode denunciar algo seu", 400);
  }

  // Denunciar a mesma coisa de novo não cria outra denúncia: atualiza o motivo e reabre
  await prisma.report.upsert({
    where: { reporterId_targetType_targetId: { reporterId: viewer.id, targetType, targetId } },
    create: {
      reporterId: viewer.id,
      targetType,
      targetId,
      reportedUserId: target.ownerId,
      reason,
      details: details || null,
      excerpt: target.excerpt,
    },
    update: { reason, details: details || null, status: "ABERTA", resolvedAt: null },
  });
}

// ---------- Painel do admin ----------

const personSelect = { id: true, name: true, username: true, suspendedAt: true } as const;

export async function listReports(status: ReportStatus) {
  const reports = await prisma.report.findMany({
    where: { status },
    include: { reporter: { select: personSelect }, reportedUser: { select: personSelect } },
    orderBy: { createdAt: status === "ABERTA" ? "asc" : "desc" },
    take: 100,
  });

  // O conteúdo ainda existe? Para comentários, em qual post está (o painel abre o post)
  const ids = (type: ReportTarget) => reports.filter((report) => report.targetType === type).map((report) => report.targetId);
  const [posts, comments, messages] = await prisma.$transaction([
    prisma.post.findMany({ where: { id: { in: ids("POST") } }, select: { id: true } }),
    prisma.comment.findMany({ where: { id: { in: ids("COMMENT") } }, select: { id: true, postId: true } }),
    prisma.message.findMany({ where: { id: { in: ids("MESSAGE") } }, select: { id: true } }),
  ]);
  const postIds = new Set(posts.map((post) => post.id));
  const commentPosts = new Map(comments.map((comment) => [comment.id, comment.postId]));
  const messageIds = new Set(messages.map((message) => message.id));

  return reports.map((report) => {
    const postId = report.targetType === "POST" ? report.targetId : commentPosts.get(report.targetId);
    const exists =
      report.targetType === "POST"
        ? postIds.has(report.targetId)
        : report.targetType === "COMMENT"
          ? commentPosts.has(report.targetId)
          : report.targetType === "MESSAGE"
            ? messageIds.has(report.targetId)
            : report.reportedUser !== null;
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      excerpt: report.excerpt,
      status: report.status,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
      reporter: report.reporter,
      reportedUser: report.reportedUser,
      targetExists: exists,
      postId: exists ? (postId ?? null) : null,
    };
  });
}

export async function updateReport(id: string, status: ReportStatus) {
  const report = await prisma.report.findUnique({ where: { id }, select: { id: true } });
  if (!report) {
    throw new AppError("Denúncia não encontrada", 404);
  }
  await prisma.report.update({
    where: { id },
    data: { status, resolvedAt: status === "ABERTA" ? null : new Date() },
  });
  return { id, status };
}
