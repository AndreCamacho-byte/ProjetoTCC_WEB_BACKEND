import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import * as chat from "./chat.service";

// Ids em ordem: ANA < BIA (a conversa guarda sempre o menor como userA)
const ANA = "11111111-1111-4111-8111-111111111111";
const BIA = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const POST = "44444444-4444-4444-8444-444444444444";

const person = (id: string, username: string, suspendedAt: Date | null = null) => ({
  id,
  name: username,
  username,
  avatarUrl: null,
  skateLevel: null,
  suspendedAt,
});

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION,
    userAId: ANA,
    userBId: BIA,
    userA: person(ANA, "ana"),
    userB: person(BIA, "bia"),
    userAReadAt: null,
    userBReadAt: null,
    lastMessageAt: new Date("2026-10-16T12:00:00.000Z"),
    createdAt: new Date("2026-10-16T12:00:00.000Z"),
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    conversationId: CONVERSATION,
    senderId: BIA,
    content: "Bora na pista?",
    postId: null,
    post: null,
    sharedPost: false,
    createdAt: new Date("2026-10-16T12:00:00.000Z"),
    ...overrides,
  };
}

// Amigos = as duas relações de seguir existem
const friends = (yes: boolean) => prisma.follow.count.mockResolvedValue(yes ? 2 : 1);

describe("abrir conversa", () => {
  it("só entre amigos (os dois se seguem)", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: BIA });
    friends(false);

    await expect(chat.openConversation(ANA, "bia")).rejects.toMatchObject({ statusCode: 403, code: "NOT_FRIENDS" });
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it("cada par tem uma conversa só, não importa quem abre", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: ANA });
    friends(true);
    prisma.conversation.upsert.mockResolvedValue(makeConversation());
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());

    // Quem abre é a Bia (id maior): mesmo assim a Ana fica como userA
    const result = await chat.openConversation(BIA, "ana");

    expect(prisma.conversation.upsert.mock.calls[0][0].where).toEqual({ userAId_userBId: { userAId: ANA, userBId: BIA } });
    expect(result).toMatchObject({ id: CONVERSATION, canSend: true, other: { username: "ana" } });
    expect(result.other).not.toHaveProperty("suspendedAt");
  });

  it("não conversa consigo mesmo", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: ANA });
    await expect(chat.openConversation(ANA, "ana")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("perfil inexistente ou suspenso dá 404", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(chat.openConversation(ANA, "ninguem")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ver conversas", () => {
  it("conversa de outras pessoas dá 404", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(chat.getConversation(ANA, CONVERSATION)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
      id: CONVERSATION,
      OR: [{ userAId: ANA }, { userBId: ANA }],
    });
  });

  it("conversa com conta suspensa some", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation({ userB: person(BIA, "bia", new Date()) }));
    await expect(chat.getConversation(ANA, CONVERSATION)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deixaram de ser amigos: lê o histórico mas não manda mensagem nova", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    friends(false);

    expect((await chat.getConversation(ANA, CONVERSATION)).canSend).toBe(false);
    await expect(chat.sendMessage(ANA, CONVERSATION, { content: "oi" })).rejects.toMatchObject({ code: "NOT_FRIENDS" });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("lista com a última mensagem e as não lidas de cada conversa", async () => {
    const readAt = new Date("2026-10-16T11:00:00.000Z");
    prisma.conversation.findMany.mockResolvedValue([
      { ...makeConversation({ userAReadAt: readAt }), messages: [makeMessage()] },
      { ...makeConversation({ id: "outra", userB: person(BIA, "bia", new Date()) }), messages: [makeMessage()] },
    ]);
    prisma.message.count.mockResolvedValue(3);

    const list = await chat.listConversations(ANA);

    // A conversa com a conta suspensa não aparece
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ unread: 3, other: { username: "bia" }, lastMessage: { content: "Bora na pista?", mine: false } });
    // Não lidas: as da outra pessoa, depois da última leitura
    expect(prisma.message.count.mock.calls[0][0].where).toEqual({
      conversationId: CONVERSATION,
      senderId: { not: ANA },
      createdAt: { gt: readAt },
    });
  });

  it("soma as não lidas de todas as conversas", async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { ...makeConversation(), messages: [makeMessage()] },
      { ...makeConversation({ id: "c2" }), messages: [makeMessage()] },
    ]);
    prisma.message.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);

    expect(await chat.unreadCount(ANA)).toEqual({ count: 7 });
  });
});

describe("mensagens", () => {
  it("mostra da mais antiga para a mais nova e marca as minhas", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    prisma.message.findMany.mockResolvedValue([
      makeMessage({ id: "m3", senderId: ANA }),
      makeMessage({ id: "m2" }),
      makeMessage({ id: "m1" }),
    ]);

    const page = await chat.listMessages(ANA, CONVERSATION, { limit: 2 });

    expect(page.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(page.messages[1].mine).toBe(true);
    expect(page.nextCursor).toBe("m2");
  });

  it("com 'after', traz só as que chegaram depois", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    const at = new Date("2026-10-16T12:00:00.000Z");
    prisma.message.findFirst.mockResolvedValue({ createdAt: at });
    prisma.message.findMany.mockResolvedValue([makeMessage({ id: "nova" })]);

    const page = await chat.listMessages(ANA, CONVERSATION, { limit: 30, after: "msg-1" });

    expect(prisma.message.findMany.mock.calls[0][0].where).toEqual({ conversationId: CONVERSATION, createdAt: { gt: at } });
    expect(page.messages[0].id).toBe("nova");
  });

  it("post apagado aparece como indisponível; post de conta suspensa também", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    prisma.message.findMany.mockResolvedValue([
      makeMessage({ id: "a", content: "", sharedPost: true, post: null }),
      makeMessage({
        id: "b",
        sharedPost: true,
        post: { id: POST, content: "x", author: person(BIA, "bia", new Date()), images: [] },
      }),
    ]);

    const page = await chat.listMessages(ANA, CONVERSATION, { limit: 30 });

    expect(page.messages.map((m) => [m.sharedPost, m.post])).toEqual([
      [true, null],
      [true, null],
    ]);
  });

  it("manda mensagem, sobe a conversa e marca como lida para quem mandou", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    friends(true);
    prisma.message.create.mockResolvedValue(makeMessage({ senderId: ANA, content: "Bora!" }));

    const message = await chat.sendMessage(ANA, CONVERSATION, { content: "Bora!" });

    expect(message).toMatchObject({ content: "Bora!", mine: true });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CONVERSATION }, data: { lastMessageAt: expect.any(Date) } }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userAReadAt: expect.any(Date) } }),
    );
  });

  it("recusa mensagem vazia", async () => {
    await expect(chat.sendMessage(ANA, CONVERSATION, { content: "" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("marca como lida do lado certo", async () => {
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    await chat.markRead(BIA, CONVERSATION);
    expect(prisma.conversation.update.mock.calls[0][0].data).toHaveProperty("userBReadAt");
  });
});

describe("compartilhar post com amigos", () => {
  it("manda o post para cada amigo escolhido", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST });
    prisma.user.findFirst.mockImplementation(async ({ where }) => ({ id: where.username === "bia" ? BIA : "99999999-9999-4999-8999-999999999999" }));
    friends(true);
    prisma.conversation.upsert.mockResolvedValue(makeConversation());
    prisma.conversation.findFirst.mockResolvedValue(makeConversation());
    prisma.message.create.mockResolvedValue(makeMessage({ senderId: ANA, postId: POST, sharedPost: true }));

    const result = await chat.sharePost(ANA, { postId: POST, usernames: ["bia", "cau", "bia"], content: "" });

    expect(result).toEqual({ sent: 2 });
    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ postId: POST, sharedPost: true });
  });

  it("se alguém não for amigo, não manda para ninguém", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST });
    prisma.user.findFirst.mockResolvedValue({ id: BIA });
    prisma.follow.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prisma.conversation.upsert.mockResolvedValue(makeConversation());

    await expect(chat.sharePost(ANA, { postId: POST, usernames: ["bia", "cau"], content: "" })).rejects.toMatchObject({
      code: "NOT_FRIENDS",
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("lista de amigos: quem segue e é seguido, sem contas suspensas", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await chat.listFriends(ANA);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      suspendedAt: null,
      following: { some: { followingId: ANA } },
      followers: { some: { followerId: ANA } },
    });
  });
});
