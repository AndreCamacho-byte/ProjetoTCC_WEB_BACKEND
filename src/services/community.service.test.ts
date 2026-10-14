import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => import("../test/prismaMock"));

import { prisma } from "../test/prismaMock";
import * as community from "./community.service";
import * as profiles from "./profile.service";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

const me: community.Viewer = { id: ME, isAdmin: false };
const admin: community.Viewer = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", isAdmin: true };

const author = (id = OTHER) => ({ id, name: "Tony Teste", username: "tony", avatarUrl: null, skateLevel: null });

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    content: "Sessão de hoje",
    authorId: OTHER,
    author: author(),
    images: [],
    likes: [],
    savedBy: [],
    _count: { likes: 4, comments: 2 },
    createdAt: new Date("2026-10-10T12:00:00.000Z"),
    updatedAt: new Date("2026-10-10T12:00:00.000Z"),
    ...overrides,
  };
}

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    content: "Que manobra!",
    postId: POST_ID,
    authorId: OTHER,
    author: author(),
    post: { authorId: OTHER },
    createdAt: new Date("2026-10-10T12:30:00.000Z"),
    ...overrides,
  };
}

describe("posts", () => {
  it("mostra contadores, curtida e salvo de quem vê e as fotos como endereços", async () => {
    prisma.post.findFirst.mockResolvedValue(
      makePost({ likes: [{ userId: ME }], savedBy: [{ userId: ME }], images: [{ id: "foto-1" }, { id: "foto-2" }] }),
    );

    const post = await community.getPost(POST_ID, me);

    expect(post).toMatchObject({
      likeCount: 4,
      commentCount: 2,
      likedByMe: true,
      savedByMe: true,
      canDelete: false,
      imageUrls: ["/api/posts/images/foto-1", "/api/posts/images/foto-2"],
    });
  });

  it("autor e administrador podem apagar", async () => {
    prisma.post.findFirst.mockResolvedValue(makePost({ authorId: ME }));
    expect((await community.getPost(POST_ID, me)).canDelete).toBe(true);

    prisma.post.findFirst.mockResolvedValue(makePost());
    expect((await community.getPost(POST_ID, admin)).canDelete).toBe(true);
  });

  it("esconde posts de contas suspensas", async () => {
    prisma.post.findFirst.mockResolvedValue(null);

    await expect(community.getPost(POST_ID, me)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.post.findFirst.mock.calls[0][0].where).toMatchObject({ author: { suspendedAt: null } });
  });

  it("pagina o feed por cursor", async () => {
    const posts = [1, 2, 3].map((n) => makePost({ id: `post-${n}` }));
    prisma.post.findMany.mockResolvedValue(posts);

    const page = await community.getFeed(me, { feed: "all", limit: 2, cursor: "post-0" });

    expect(page.posts.map((p) => p.id)).toEqual(["post-1", "post-2"]);
    expect(page.nextCursor).toBe("post-2");
    expect(prisma.post.findMany.mock.calls[0][0]).toMatchObject({ take: 3, skip: 1, cursor: { id: "post-0" } });
  });

  it("sem mais posts, não devolve cursor", async () => {
    prisma.post.findMany.mockResolvedValue([makePost()]);
    expect((await community.getFeed(me, { feed: "all", limit: 10 })).nextCursor).toBeNull();
  });

  it("o feed 'seguindo' traz quem a pessoa segue e ela mesma", async () => {
    prisma.post.findMany.mockResolvedValue([]);

    await community.getFeed(me, { feed: "following", limit: 10 });

    expect(prisma.post.findMany.mock.calls[0][0].where.OR).toEqual([
      { authorId: ME },
      { author: { followers: { some: { followerId: ME } } } },
    ]);
  });

  it("recusa post vazio", async () => {
    await expect(community.createPost(me, { content: "" })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("aceita post só com fotos e grava as fotos na ordem escolhida", async () => {
    prisma.post.create.mockResolvedValue(makePost({ authorId: ME, content: "", images: [{ id: "a" }, { id: "b" }] }));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

    const post = await community.createPost(me, { content: "", images: [jpeg, jpeg] });

    const created = prisma.post.create.mock.calls[0][0].data.images.create;
    expect(created.map((image: { position: number }) => image.position)).toEqual([0, 1]);
    expect(post.imageUrls).toHaveLength(2);
  });

  it("recusa mais de 4 fotos", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    await expect(community.createPost(me, { content: "oi", images: [jpeg, jpeg, jpeg, jpeg, jpeg] })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("só o autor ou um administrador apagam o post", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: OTHER });
    await expect(community.deletePost(POST_ID, me)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.post.delete).not.toHaveBeenCalled();

    await community.deletePost(POST_ID, admin);
    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: POST_ID } });
  });
});

describe("curtidas", () => {
  it("curtir de novo não conta em dobro", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST_ID });
    prisma.like.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);

    const result = await community.likePost(POST_ID, ME);

    expect(prisma.like.upsert).toHaveBeenCalledWith({
      where: { userId_postId: { userId: ME, postId: POST_ID } },
      create: { userId: ME, postId: POST_ID },
      update: {},
    });
    expect(result).toEqual({ likeCount: 5, likedByMe: true });
  });

  it("tira a curtida", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST_ID });
    prisma.like.count.mockResolvedValueOnce(4).mockResolvedValueOnce(0);

    expect(await community.unlikePost(POST_ID, ME)).toEqual({ likeCount: 4, likedByMe: false });
    expect(prisma.like.deleteMany).toHaveBeenCalledWith({ where: { postId: POST_ID, userId: ME } });
  });

  it("não curte post que não existe", async () => {
    prisma.post.findFirst.mockResolvedValue(null);
    await expect(community.likePost(POST_ID, ME)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.like.upsert).not.toHaveBeenCalled();
  });
});

describe("salvos", () => {
  it("salvar duas vezes não duplica", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST_ID });

    expect(await community.savePost(POST_ID, ME)).toEqual({ savedByMe: true });
    expect(prisma.savedPost.upsert).toHaveBeenCalledWith({
      where: { userId_postId: { userId: ME, postId: POST_ID } },
      create: { userId: ME, postId: POST_ID },
      update: {},
    });
  });

  it("não salva post que não existe", async () => {
    prisma.post.findFirst.mockResolvedValue(null);
    await expect(community.savePost(POST_ID, ME)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lista só os salvos de quem está vendo, com cursor", async () => {
    prisma.savedPost.findMany.mockResolvedValue([
      { userId: ME, postId: "p1", post: makePost({ id: "p1", savedBy: [{ userId: ME }] }) },
      { userId: ME, postId: "p2", post: makePost({ id: "p2", savedBy: [{ userId: ME }] }) },
    ]);

    const page = await community.listSavedPosts(me, { limit: 1, cursor: "p0" });

    const args = prisma.savedPost.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: ME, post: { author: { suspendedAt: null } } });
    expect(args.cursor).toEqual({ userId_postId: { userId: ME, postId: "p0" } });
    expect(page).toMatchObject({ nextCursor: "p1" });
    expect(page.posts[0].savedByMe).toBe(true);
  });
});

describe("comentários", () => {
  it("lista do mais antigo para o mais novo", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: POST_ID });
    prisma.comment.findMany.mockResolvedValue([makeComment()]);

    const page = await community.listComments(POST_ID, me, { limit: 10 });

    expect(prisma.comment.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(page.comments[0]).toMatchObject({ content: "Que manobra!", canDelete: false });
  });

  it("o dono do post pode apagar comentários no post dele", async () => {
    prisma.comment.findUnique.mockResolvedValue(makeComment({ post: { authorId: ME } }));

    await community.deleteComment(COMMENT_ID, me);

    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
  });

  it("outra pessoa não apaga o comentário", async () => {
    prisma.comment.findUnique.mockResolvedValue(makeComment());

    await expect(community.deleteComment(COMMENT_ID, me)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });
});

describe("perfis e seguidores", () => {
  const profile = { ...author(), bio: "Ando desde 2015", createdAt: new Date("2026-01-01T00:00:00.000Z") };

  it("mostra o perfil com os contadores, sem email nem idade", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.follow.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    prisma.post.count.mockResolvedValue(7);

    const result = await profiles.getProfile("tony", me);

    expect(result).toMatchObject({ username: "tony", followers: 10, following: 3, posts: 7, followedByMe: true, isMe: false });
    const { select, where } = prisma.user.findFirst.mock.calls[0][0];
    expect(select).not.toHaveProperty("email");
    expect(select).not.toHaveProperty("birthDate");
    expect(where).toMatchObject({ suspendedAt: null, emailVerifiedAt: { not: null } });
  });

  it("perfil suspenso ou inexistente dá 404", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(profiles.getProfile("ninguem", me)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("não deixa seguir a si mesmo", async () => {
    prisma.user.findFirst.mockResolvedValue({ ...profile, id: ME });
    await expect(profiles.follow("tony", me)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.follow.upsert).not.toHaveBeenCalled();
  });

  it("diz quando a pessoa segue de volta (amigos)", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.follow.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prisma.post.count.mockResolvedValue(0);

    expect(await profiles.getProfile("tony", me)).toMatchObject({ followedByMe: true, followsMe: true });
  });

  it("lista os seguidores com o botão de seguir de quem vê", async () => {
    const ana = { ...author("ana-id"), username: "ana" };
    const bia = { ...author("bia-id"), username: "bia" };
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.follow.findMany
      .mockResolvedValueOnce([
        { followerId: "ana-id", followingId: OTHER, follower: ana, following: profile },
        { followerId: "bia-id", followingId: OTHER, follower: bia, following: profile },
      ])
      .mockResolvedValueOnce([{ followingId: "bia-id" }]);

    const result = await profiles.listFollows("tony", "followers", me, { limit: 20 });

    expect(prisma.follow.findMany.mock.calls[0][0].where).toEqual({ followingId: OTHER, follower: { suspendedAt: null } });
    expect(result.people.map((p) => [p.username, p.followedByMe])).toEqual([
      ["ana", false],
      ["bia", true],
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("a lista de quem a pessoa segue usa o outro lado da relação", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.follow.findMany.mockResolvedValue([]);

    await profiles.listFollows("tony", "following", me, { limit: 20, cursor: "x" });

    const args = prisma.follow.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ followerId: OTHER, following: { suspendedAt: null } });
    expect(args.cursor).toEqual({ followerId_followingId: { followerId: OTHER, followingId: "x" } });
  });

  it("seguir duas vezes não dá erro", async () => {
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.follow.count.mockResolvedValue(1);
    prisma.post.count.mockResolvedValue(0);

    const result = await profiles.follow("tony", me);

    expect(prisma.follow.upsert).toHaveBeenCalledWith({
      where: { followerId_followingId: { followerId: ME, followingId: OTHER } },
      create: { followerId: ME, followingId: OTHER },
      update: {},
    });
    expect(result).toEqual({ followers: 1, followedByMe: true });
  });

  it("a busca ignora contas suspensas e não confirmadas", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await profiles.searchProfiles("tony");
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
      where: { suspendedAt: null, emailVerifiedAt: { not: null } },
      take: 20,
    });
  });
});
