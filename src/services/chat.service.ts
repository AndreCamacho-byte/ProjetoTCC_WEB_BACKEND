import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { authorSelect, postImageUrl } from "./community.service";

// Chat entre amigos. Amigos = as duas pessoas se seguem (como o "Vocês são amigos" do perfil).
// Só amigos começam conversa e mandam mensagem: assim ninguém recebe mensagem de estranhos.

export const MAX_MESSAGE_LENGTH = 1000;
// Quantos amigos dá para escolher de uma vez ao compartilhar um post
export const MAX_SHARE_TARGETS = 10;

type ListInput = { cursor?: string; limit: number };

// Cada par de pessoas tem uma conversa só: userA é sempre o id menor
const orderPair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

async function areFriends(a: string, b: string) {
  const count = await prisma.follow.count({
    where: {
      OR: [
        { followerId: a, followingId: b },
        { followerId: b, followingId: a },
      ],
    },
  });
  return count === 2;
}

// Amigos de quem está vendo (para começar conversa e para compartilhar posts)
export async function listFriends(userId: string) {
  const friends = await prisma.user.findMany({
    where: {
      suspendedAt: null,
      // A pessoa segue quem está vendo...
      following: { some: { followingId: userId } },
      // ...e quem está vendo segue a pessoa
      followers: { some: { followerId: userId } },
    },
    select: authorSelect,
    orderBy: { name: "asc" },
    take: 200,
  });
  return friends;
}

async function findActiveUserByUsername(username: string) {
  const user = await prisma.user.findFirst({
    where: { username, suspendedAt: null, emailVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!user) {
    throw new AppError("Perfil não encontrado", 404);
  }
  return user;
}

// Abre (ou cria) a conversa com um amigo
async function conversationWith(userId: string, otherId: string) {
  if (otherId === userId) {
    throw new AppError("Você não pode conversar com você mesmo", 400);
  }
  if (!(await areFriends(userId, otherId))) {
    throw new AppError("Vocês precisam se seguir para conversar", 403, "NOT_FRIENDS");
  }
  return prisma.conversation.upsert({
    where: { userAId_userBId: orderPair(userId, otherId) },
    create: orderPair(userId, otherId),
    update: {},
  });
}

export async function openConversation(userId: string, username: string) {
  const other = await findActiveUserByUsername(username);
  const conversation = await conversationWith(userId, other.id);
  return getConversation(userId, conversation.id);
}

type ConversationRow = Prisma.ConversationGetPayload<{
  include: { userA: { select: typeof authorSelectWithStatus }; userB: { select: typeof authorSelectWithStatus } };
}>;

const authorSelectWithStatus = { ...authorSelect, suspendedAt: true } satisfies Prisma.UserSelect;

// Quem é o outro lado da conversa e até quando quem está vendo já leu
function sides(conversation: ConversationRow, userId: string) {
  const iAmA = conversation.userAId === userId;
  const { suspendedAt: _, ...other } = iAmA ? conversation.userB : conversation.userA;
  return { other, myReadAt: iAmA ? conversation.userAReadAt : conversation.userBReadAt, otherSuspended: (iAmA ? conversation.userB : conversation.userA).suspendedAt !== null };
}

// Busca a conversa garantindo que quem pede faz parte dela (de outra pessoa = "não existe")
async function findMyConversation(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, OR: [{ userAId: userId }, { userBId: userId }] },
    include: { userA: { select: authorSelectWithStatus }, userB: { select: authorSelectWithStatus } },
  });
  if (!conversation) {
    throw new AppError("Conversa não encontrada", 404);
  }
  const side = sides(conversation, userId);
  // Conversa com conta suspensa some, como o resto da comunidade
  if (side.otherSuspended) {
    throw new AppError("Conversa não encontrada", 404);
  }
  return { conversation, ...side };
}

export async function getConversation(userId: string, conversationId: string) {
  const { conversation, other } = await findMyConversation(userId, conversationId);
  // Dá para ler o histórico mesmo se deixarem de ser amigos, mas só amigos mandam mensagem nova
  return { id: conversation.id, other, canSend: await areFriends(userId, other.id) };
}

// Mensagens não lidas de uma conversa: as do outro lado, depois da última leitura
const unreadWhere = (conversationId: string, userId: string, readAt: Date | null): Prisma.MessageWhereInput => ({
  conversationId,
  senderId: { not: userId },
  ...(readAt ? { createdAt: { gt: readAt } } : {}),
});

// Lista de conversas, as com mensagem mais recente primeiro
export async function listConversations(userId: string) {
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      // Conversa criada mas sem nenhuma mensagem ainda não aparece na lista
      messages: { some: {} },
    },
    include: {
      userA: { select: authorSelectWithStatus },
      userB: { select: authorSelectWithStatus },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  const visible = conversations.map((c) => ({ c, side: sides(c, userId) })).filter(({ side }) => !side.otherSuspended);
  const unread = await prisma.$transaction(
    visible.map(({ c, side }) => prisma.message.count({ where: unreadWhere(c.id, userId, side.myReadAt) })),
  );

  return visible.map(({ c, side }, i) => {
    const last = c.messages[0];
    return {
      id: c.id,
      other: side.other,
      unread: unread[i],
      lastMessage: last
        ? { content: last.content, sharedPost: last.sharedPost, mine: last.senderId === userId, createdAt: last.createdAt }
        : null,
    };
  });
}

// Total de mensagens não lidas (o número que aparece no ícone do chat)
export async function unreadCount(userId: string) {
  const conversations = await listConversations(userId);
  return { count: conversations.reduce((sum, conversation) => sum + conversation.unread, 0) };
}

// ---------- Mensagens ----------

const messageInclude = {
  post: {
    select: {
      id: true,
      content: true,
      author: { select: { ...authorSelect, suspendedAt: true } },
      images: { select: { id: true }, orderBy: { position: "asc" }, take: 1 },
    },
  },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function toMessageView(message: MessageRow, userId: string) {
  // Post de conta suspensa também não aparece dentro do chat
  const post = message.post && message.post.author.suspendedAt === null ? message.post : null;
  return {
    id: message.id,
    content: message.content,
    mine: message.senderId === userId,
    createdAt: message.createdAt,
    sharedPost: message.sharedPost,
    post: post
      ? {
          id: post.id,
          // Só o começo do texto, como numa prévia
          excerpt: post.content.length > 140 ? `${post.content.slice(0, 140)}…` : post.content,
          imageUrl: post.images[0] ? postImageUrl(post.images[0].id) : null,
          author: { name: post.author.name, username: post.author.username, avatarUrl: post.author.avatarUrl },
        }
      : null,
  };
}

// Mensagens da conversa. Sem "after": as mais recentes (página por "cursor" para ver as antigas).
// Com "after": só as que chegaram depois daquela mensagem (é o que o site pergunta a cada poucos segundos).
export async function listMessages(
  userId: string,
  conversationId: string,
  { cursor, after, limit }: ListInput & { after?: string },
) {
  await findMyConversation(userId, conversationId);

  if (after) {
    const reference = await prisma.message.findFirst({ where: { id: after, conversationId }, select: { createdAt: true } });
    if (!reference) {
      throw new AppError("Mensagem de referência não encontrada", 400);
    }
    const newer = await prisma.message.findMany({
      where: { conversationId, createdAt: { gt: reference.createdAt } },
      include: messageInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    return { messages: newer.map((m) => toMessageView(m, userId)), nextCursor: null };
  }

  const rows = await prisma.message.findMany({
    where: { conversationId },
    include: messageInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Na tela, as mensagens vão da mais antiga (em cima) para a mais nova (embaixo)
  return {
    messages: page.reverse().map((m) => toMessageView(m, userId)),
    nextCursor: hasMore ? page[0].id : null,
  };
}

async function assertPostVisible(postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, author: { suspendedAt: null } }, select: { id: true } });
  if (!post) {
    throw new AppError("Post não encontrado", 404);
  }
}

async function createMessage(conversationId: string, userId: string, content: string, postId?: string) {
  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: userId, content, postId, sharedPost: Boolean(postId), createdAt: now },
      include: messageInclude,
    }),
    // Quem manda já leu tudo até agora; a conversa sobe para o topo da lista
    prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
  ]);
  await markRead(userId, conversationId, now);
  return toMessageView(message, userId);
}

export async function sendMessage(userId: string, conversationId: string, { content, postId }: { content: string; postId?: string }) {
  if (!content && !postId) {
    throw new AppError("Escreva a mensagem", 400);
  }
  const { other } = await findMyConversation(userId, conversationId);
  if (!(await areFriends(userId, other.id))) {
    throw new AppError("Vocês precisam se seguir para conversar", 403, "NOT_FRIENDS");
  }
  if (postId) await assertPostVisible(postId);
  return createMessage(conversationId, userId, content, postId);
}

// Compartilha um post com vários amigos de uma vez (cada um recebe na conversa com quem enviou)
export async function sharePost(userId: string, { postId, usernames, content }: { postId: string; usernames: string[]; content: string }) {
  await assertPostVisible(postId);
  const unique = [...new Set(usernames)];

  // Confere todo mundo antes de mandar para alguém: ou vai para todos, ou dá o erro
  const conversations = [];
  for (const username of unique) {
    const other = await findActiveUserByUsername(username);
    conversations.push(await conversationWith(userId, other.id));
  }
  for (const conversation of conversations) {
    await createMessage(conversation.id, userId, content, postId);
  }
  return { sent: conversations.length };
}

// Marca a conversa como lida até agora (ou até a hora informada)
export async function markRead(userId: string, conversationId: string, at = new Date()) {
  const { conversation } = await findMyConversation(userId, conversationId);
  const field = conversation.userAId === userId ? "userAReadAt" : "userBReadAt";
  await prisma.conversation.update({ where: { id: conversationId }, data: { [field]: at } });
  return { ok: true };
}
