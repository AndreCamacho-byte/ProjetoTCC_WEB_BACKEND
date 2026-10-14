import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";

// Quem está pedindo: o id e se é administrador (administradores podem apagar qualquer post ou comentário)
export type Viewer = { id: string; isAdmin: boolean };

// O que aparece de cada autor nos posts e comentários
export const authorSelect = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  skateLevel: true,
} satisfies Prisma.UserSelect;

// Contas suspensas somem da comunidade: os posts e comentários delas não aparecem
export const activeAuthor = { author: { suspendedAt: null } } satisfies Prisma.PostWhereInput;

const postInclude = (viewerId: string) =>
  ({
    author: { select: authorSelect },
    image: { select: { postId: true } },
    // Só a curtida de quem está vendo, para saber se o coração aparece preenchido
    likes: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { likes: true, comments: { where: { author: { suspendedAt: null } } } } },
  }) satisfies Prisma.PostInclude;

type PostWithRelations = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

export const postImageUrl = (postId: string) => `/api/posts/${postId}/image`;

export function toPostView(post: PostWithRelations, viewer: Viewer) {
  return {
    id: post.id,
    content: post.content,
    imageUrl: post.image ? postImageUrl(post.id) : null,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    likedByMe: post.likes.length > 0,
    // O site mostra o botão de apagar só para quem pode
    canDelete: viewer.isAdmin || post.authorId === viewer.id,
  };
}

// Paginação por cursor: o site manda o id do último post que já tem e recebe os próximos.
// Funciona melhor que "página 2, 3..." num feed em que posts novos chegam o tempo todo.
type ListInput = { cursor?: string; limit: number };

async function listPosts(where: Prisma.PostWhereInput, viewer: Viewer, { cursor, limit }: ListInput) {
  const posts = await prisma.post.findMany({
    where: { ...where, ...activeAuthor },
    include: postInclude(viewer.id),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Veio um a mais que o pedido: existe próxima página
  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;

  return {
    posts: page.map((post) => toPostView(post, viewer)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// Feed: "all" mostra os posts de todo mundo; "following" mostra os de quem a pessoa segue (e os dela)
export async function getFeed(viewer: Viewer, input: ListInput & { feed: "all" | "following" }) {
  const where: Prisma.PostWhereInput =
    input.feed === "following"
      ? {
          OR: [{ authorId: viewer.id }, { author: { followers: { some: { followerId: viewer.id } } } }],
        }
      : {};
  return listPosts(where, viewer, input);
}

export async function getPostsByAuthor(authorId: string, viewer: Viewer, input: ListInput) {
  return listPosts({ authorId }, viewer, input);
}

export async function getPost(postId: string, viewer: Viewer) {
  const post = await prisma.post.findFirst({
    where: { id: postId, ...activeAuthor },
    include: postInclude(viewer.id),
  });
  if (!post) {
    throw new AppError("Post não encontrado", 404);
  }
  return toPostView(post, viewer);
}

export async function createPost(viewer: Viewer, { content, image }: { content: string; image?: Buffer }) {
  if (!content && !image) {
    throw new AppError("Escreva alguma coisa ou escolha uma foto", 400);
  }

  const post = await prisma.post.create({
    data: {
      content,
      authorId: viewer.id,
      ...(image ? { image: { create: { data: new Uint8Array(image) } } } : {}),
    },
    include: postInclude(viewer.id),
  });
  return toPostView(post, viewer);
}

// Só o autor ou um administrador (moderação) apagam um post. Para os outros, o post "não existe".
export async function deletePost(postId: string, viewer: Viewer) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!post || (post.authorId !== viewer.id && !viewer.isAdmin)) {
    throw new AppError("Post não encontrado", 404);
  }
  await prisma.post.delete({ where: { id: postId } });
}

export async function getPostImage(postId: string) {
  const image = await prisma.postImage.findUnique({ where: { postId } });
  if (!image) {
    throw new AppError("Imagem não encontrada", 404);
  }
  return Buffer.from(image.data);
}

// ---------- Curtidas ----------

async function assertPostVisible(postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, ...activeAuthor }, select: { id: true } });
  if (!post) {
    throw new AppError("Post não encontrado", 404);
  }
}

async function likeState(postId: string, userId: string) {
  const [likeCount, mine] = await prisma.$transaction([
    prisma.like.count({ where: { postId } }),
    prisma.like.count({ where: { postId, userId } }),
  ]);
  return { likeCount, likedByMe: mine > 0 };
}

// Curtir duas vezes não dá erro nem conta em dobro (o par pessoa + post é único)
export async function likePost(postId: string, userId: string) {
  await assertPostVisible(postId);
  await prisma.like.upsert({
    where: { userId_postId: { userId, postId } },
    create: { userId, postId },
    update: {},
  });
  return likeState(postId, userId);
}

export async function unlikePost(postId: string, userId: string) {
  await assertPostVisible(postId);
  await prisma.like.deleteMany({ where: { postId, userId } });
  return likeState(postId, userId);
}

// ---------- Comentários ----------

const commentInclude = { author: { select: authorSelect }, post: { select: { authorId: true } } } satisfies Prisma.CommentInclude;
type CommentWithRelations = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

function toCommentView(comment: CommentWithRelations, viewer: Viewer) {
  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    author: comment.author,
    // Quem escreveu, o dono do post e os administradores podem apagar o comentário
    canDelete: viewer.isAdmin || comment.authorId === viewer.id || comment.post.authorId === viewer.id,
  };
}

// Comentários em ordem de chegada (os mais antigos primeiro), como numa conversa
export async function listComments(postId: string, viewer: Viewer, { cursor, limit }: ListInput) {
  await assertPostVisible(postId);

  const comments = await prisma.comment.findMany({
    where: { postId, author: { suspendedAt: null } },
    include: commentInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = comments.length > limit;
  const page = hasMore ? comments.slice(0, limit) : comments;

  return {
    comments: page.map((comment) => toCommentView(comment, viewer)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function createComment(postId: string, viewer: Viewer, content: string) {
  await assertPostVisible(postId);
  const comment = await prisma.comment.create({
    data: { postId, authorId: viewer.id, content },
    include: commentInclude,
  });
  return toCommentView(comment, viewer);
}

export async function deleteComment(commentId: string, viewer: Viewer) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: commentInclude });
  if (!comment || !toCommentView(comment, viewer).canDelete) {
    throw new AppError("Comentário não encontrado", 404);
  }
  await prisma.comment.delete({ where: { id: commentId } });
}
