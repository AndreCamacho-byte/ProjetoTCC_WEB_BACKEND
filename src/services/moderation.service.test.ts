import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import * as blocks from "./block.service";
import * as community from "./community.service";
import * as profiles from "./profile.service";
import * as reports from "./report.service";

// Bloqueios e denúncias

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "55555555-5555-4555-8555-555555555555";

const me: community.Viewer = { id: ME, isAdmin: false };
const profile = { id: OTHER, name: "Tony Teste", username: "tony", avatarUrl: null, skateLevel: null, bio: null, createdAt: new Date() };

describe("bloqueio", () => {
  it("bloquear grava o bloqueio e desfaz o seguir nos dois sentidos", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: OTHER });

    expect(await blocks.blockUser("tony", me)).toEqual({ blockedByMe: true });

    expect(prisma.block.upsert).toHaveBeenCalledWith({
      where: { blockerId_blockedId: { blockerId: ME, blockedId: OTHER } },
      create: { blockerId: ME, blockedId: OTHER },
      update: {},
    });
    expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { followerId: ME, followingId: OTHER },
          { followerId: OTHER, followingId: ME },
        ],
      },
    });
  });

  it("não deixa bloquear a si mesmo", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: ME });
    await expect(blocks.blockUser("eu", me)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.block.upsert).not.toHaveBeenCalled();
  });

  it("desbloquear só apaga o bloqueio de quem pediu", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: OTHER });
    await blocks.unblockUser("tony", me);
    expect(prisma.block.deleteMany).toHaveBeenCalledWith({ where: { blockerId: ME, blockedId: OTHER } });
  });

  it("os ids bloqueados valem nos dois sentidos", async () => {
    prisma.block.findMany.mockResolvedValue([
      { blockerId: ME, blockedId: "a" },
      { blockerId: "b", blockedId: ME },
    ]);
    expect(await blocks.blockedIds(ME)).toEqual(["a", "b"]);
  });

  it("quem foi bloqueado não vê o perfil de quem bloqueou", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.block.findMany.mockResolvedValue([{ blockerId: OTHER }]);
    await expect(profiles.getProfile("tony", me)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("quem bloqueou vê o perfil com o aviso de bloqueio e não consegue seguir", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.block.findMany.mockResolvedValue([{ blockerId: ME }]);
    prisma.follow.count.mockResolvedValue(0);
    prisma.post.count.mockResolvedValue(0);

    expect(await profiles.getProfile("tony", me)).toMatchObject({ blockedByMe: true });
    await expect(profiles.follow("tony", me)).rejects.toMatchObject({ statusCode: 400, code: "BLOCKED" });
    expect(prisma.follow.upsert).not.toHaveBeenCalled();
  });

  it("o feed e a busca escondem as pessoas bloqueadas", async () => {
    prisma.block.findMany.mockResolvedValue([{ blockerId: ME, blockedId: OTHER }]);
    prisma.post.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await community.getFeed(me, { feed: "all", limit: 10 });
    await profiles.searchProfiles("tony", me);

    expect(prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ author: { id: { notIn: [OTHER] } } });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ id: { notIn: [OTHER] } });
  });

  it("não dá para curtir nem comentar post de quem tem bloqueio", async () => {
    prisma.block.findMany.mockResolvedValue([{ blockerId: OTHER, blockedId: ME }]);
    prisma.post.findFirst.mockResolvedValue(null);

    await expect(community.likePost(POST_ID, ME)).rejects.toMatchObject({ statusCode: 404 });
    await expect(community.createComment(POST_ID, me, "oi")).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.post.findFirst.mock.calls[0][0].where).toMatchObject({ author: { id: { notIn: [OTHER] } } });
  });
});

describe("denúncias", () => {
  it("denuncia um post guardando o autor e um trecho do texto", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: OTHER, content: "propaganda", _count: { images: 2 } });

    await reports.createReport(me, { targetType: "POST", targetId: POST_ID, reason: "SPAM" });

    expect(prisma.report.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reporterId: ME,
          reportedUserId: OTHER,
          targetType: "POST",
          reason: "SPAM",
          excerpt: "propaganda [2 foto(s)]",
        }),
        // Denunciar de novo reabre a mesma denúncia
        update: expect.objectContaining({ status: "ABERTA", resolvedAt: null }),
      }),
    );
  });

  it("corta o trecho em 300 caracteres", async () => {
    prisma.comment.findUnique.mockResolvedValue({ authorId: OTHER, content: "a".repeat(400) });
    await reports.createReport(me, { targetType: "COMMENT", targetId: POST_ID, reason: "OFENSA" });
    expect(prisma.report.upsert.mock.calls[0][0].create.excerpt).toHaveLength(300);
  });

  it("não deixa denunciar algo seu", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: ME, content: "meu", _count: { images: 0 } });
    await expect(reports.createReport(me, { targetType: "POST", targetId: POST_ID, reason: "SPAM" })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prisma.report.upsert).not.toHaveBeenCalled();
  });

  it("conteúdo que não existe dá 404", async () => {
    prisma.post.findUnique.mockResolvedValue(null);
    await expect(reports.createReport(me, { targetType: "POST", targetId: POST_ID, reason: "SPAM" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("só quem está na conversa denuncia uma mensagem", async () => {
    prisma.message.findUnique.mockResolvedValue({
      senderId: OTHER,
      content: "mensagem chata",
      conversation: { userAId: OTHER, userBId: "outra-pessoa" },
    });
    await expect(
      reports.createReport(me, { targetType: "MESSAGE", targetId: MESSAGE_ID, reason: "ASSEDIO" }),
    ).rejects.toMatchObject({ statusCode: 404 });

    prisma.message.findUnique.mockResolvedValue({
      senderId: OTHER,
      content: "mensagem chata",
      conversation: { userAId: ME, userBId: OTHER },
    });
    await reports.createReport(me, { targetType: "MESSAGE", targetId: MESSAGE_ID, reason: "ASSEDIO" });
    expect(prisma.report.upsert.mock.calls[0][0].create).toMatchObject({ reportedUserId: OTHER, excerpt: "mensagem chata" });
  });

  it("a lista do admin diz se o conteúdo ainda existe e em qual post está o comentário", async () => {
    const base = { reason: "SPAM", details: null, excerpt: "x", status: "ABERTA", createdAt: new Date(), resolvedAt: null };
    const person = { id: OTHER, name: "Tony", username: "tony", suspendedAt: null };
    prisma.report.findMany.mockResolvedValue([
      { ...base, id: "r1", targetType: "POST", targetId: "post-apagado", reporter: null, reportedUser: person },
      { ...base, id: "r2", targetType: "COMMENT", targetId: "comentario", reporter: null, reportedUser: person },
    ]);
    prisma.post.findMany.mockResolvedValue([]);
    prisma.comment.findMany.mockResolvedValue([{ id: "comentario", postId: POST_ID }]);
    prisma.message.findMany.mockResolvedValue([]);

    const list = await reports.listReports("ABERTA");

    expect(list.map((report) => [report.id, report.targetExists, report.postId])).toEqual([
      ["r1", false, null],
      ["r2", true, POST_ID],
    ]);
    // Nunca leva o email de ninguém
    const { include } = prisma.report.findMany.mock.calls[0][0];
    expect(include.reporter.select).not.toHaveProperty("email");
    expect(include.reportedUser.select).not.toHaveProperty("email");
  });

  it("resolver marca a data; reabrir limpa", async () => {
    prisma.report.findUnique.mockResolvedValue({ id: "r1" });
    await reports.updateReport("r1", "RESOLVIDA");
    expect(prisma.report.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);

    await reports.updateReport("r1", "ABERTA");
    expect(prisma.report.update.mock.calls[1][0].data.resolvedAt).toBeNull();
  });
});
