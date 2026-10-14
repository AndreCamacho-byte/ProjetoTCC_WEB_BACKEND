import { Router } from "express";
import * as community from "../controllers/community.controller";
import { requireAuth } from "../middlewares/auth";
import { limits } from "../middlewares/rateLimit";

// Comunidade: feed, posts, curtidas, comentários e perfis.
// Tudo exige login (só a foto do post é pública, porque a tag <img> não manda o token).
export const communityRoutes = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Author:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, example: Tony Hawk }
 *         username: { type: string, example: tonyhawk }
 *         avatarUrl: { type: string, nullable: true }
 *         skateLevel: { type: string, nullable: true, enum: [INICIANTE, INTERMEDIARIO, AVANCADO, PROFISSIONAL] }
 *     Post:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         content: { type: string, example: Sessão de hoje na praça! }
 *         imageUrls:
 *           type: array
 *           description: Até 4 fotos, na ordem escolhida
 *           items: { type: string, example: /api/posts/images/3f2b... }
 *         createdAt: { type: string, format: date-time }
 *         author: { $ref: '#/components/schemas/Author' }
 *         likeCount: { type: integer, example: 12 }
 *         commentCount: { type: integer, example: 3 }
 *         likedByMe: { type: boolean }
 *         savedByMe: { type: boolean, description: Se quem está vendo salvou o post }
 *         canDelete: { type: boolean, description: Verdadeiro para o autor e para administradores }
 *     PostPage:
 *       type: object
 *       properties:
 *         posts:
 *           type: array
 *           items: { $ref: '#/components/schemas/Post' }
 *         nextCursor: { type: string, nullable: true, description: Mande como cursor para buscar os próximos. Nulo quando acabou. }
 *     Comment:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         content: { type: string, example: Que manobra! }
 *         createdAt: { type: string, format: date-time }
 *         author: { $ref: '#/components/schemas/Author' }
 *         canDelete: { type: boolean, description: Verdadeiro para quem escreveu, para o dono do post e para administradores }
 *     Profile:
 *       allOf:
 *         - $ref: '#/components/schemas/Author'
 *         - type: object
 *           properties:
 *             bio: { type: string, nullable: true }
 *             createdAt: { type: string, format: date-time }
 *             followers: { type: integer }
 *             following: { type: integer }
 *             posts: { type: integer }
 *             followedByMe: { type: boolean }
 *             followsMe: { type: boolean, description: A pessoa segue quem está vendo. Os dois verdadeiros = amigos. }
 *             isMe: { type: boolean }
 */

/**
 * @openapi
 * /posts/images/{imageId}:
 *   get:
 *     tags: [Posts]
 *     summary: Devolve uma foto de post
 *     description: Rota pública, usada no atributo src das imagens.
 *     parameters:
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A imagem
 *         content:
 *           image/jpeg:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: Post sem foto ou inexistente
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
communityRoutes.get("/posts/images/:imageId", community.getPostImage);

/**
 * @openapi
 * /posts:
 *   get:
 *     tags: [Posts]
 *     summary: Feed da comunidade (mais recentes primeiro)
 *     description: Posts de contas suspensas não aparecem.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: feed
 *         schema: { type: string, enum: [all, following], default: all }
 *         description: all = todo mundo; following = quem você segue e você
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: Id do último post já recebido (nextCursor da página anterior)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Uma página do feed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PostPage' }
 *       401:
 *         description: Sem login
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   post:
 *     tags: [Posts]
 *     summary: Publica um post
 *     description: Texto de até 500 caracteres e, se quiser, até 4 fotos (JPEG em data URL, até 600 KB cada). Precisa de texto ou de pelo menos uma foto. Limite de 30 posts por hora.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string, maxLength: 500, example: Sessão de hoje na praça! }
 *               images:
 *                 type: array
 *                 maxItems: 4
 *                 items: { type: string, example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' }
 *     responses:
 *       201:
 *         description: Post criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Post' }
 *       400:
 *         description: Post vazio, texto longo demais, mais de 4 fotos ou arquivo que não é JPEG
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       413:
 *         description: Foto grande demais
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Muitos posts seguidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
communityRoutes.get("/posts", requireAuth, community.getFeed);
communityRoutes.post("/posts", requireAuth, limits.posting, community.createPost);

/**
 * @openapi
 * /posts/{id}:
 *   get:
 *     tags: [Posts]
 *     summary: Um post
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: O post
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Post' }
 *       404:
 *         description: Post não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Posts]
 *     summary: Apaga um post
 *     description: Só o autor ou um administrador. Apaga junto a foto, as curtidas e os comentários.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Post apagado
 *       404:
 *         description: Post não encontrado (ou de outra pessoa)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
communityRoutes.get("/posts/:id", requireAuth, community.getPost);
communityRoutes.delete("/posts/:id", requireAuth, community.deletePost);

/**
 * @openapi
 * /posts/{id}/like:
 *   put:
 *     tags: [Posts]
 *     summary: Curte um post
 *     description: Curtir de novo não conta em dobro.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Situação atual das curtidas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 likeCount: { type: integer }
 *                 likedByMe: { type: boolean }
 *   delete:
 *     tags: [Posts]
 *     summary: Tira a curtida
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Situação atual das curtidas
 */
communityRoutes.put("/posts/:id/like", requireAuth, community.likePost);
communityRoutes.delete("/posts/:id/like", requireAuth, community.unlikePost);

/**
 * @openapi
 * /posts/{id}/save:
 *   put:
 *     tags: [Posts]
 *     summary: Salva um post para ver depois
 *     description: Salvar de novo não dá erro. Só quem salvou vê a lista de salvos.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Post salvo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 savedByMe: { type: boolean, example: true }
 *       404:
 *         description: Post não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Posts]
 *     summary: Tira o post dos salvos
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Post fora dos salvos
 */
communityRoutes.put("/posts/:id/save", requireAuth, community.savePost);
communityRoutes.delete("/posts/:id/save", requireAuth, community.unsavePost);

/**
 * @openapi
 * /saved/posts:
 *   get:
 *     tags: [Posts]
 *     summary: Posts que você salvou (os salvos por último primeiro)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: Id do último post já recebido
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Uma página de posts salvos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PostPage' }
 */
communityRoutes.get("/saved/posts", requireAuth, community.listSavedPosts);

/**
 * @openapi
 * /posts/{id}/comments:
 *   get:
 *     tags: [Posts]
 *     summary: Comentários de um post (mais antigos primeiro)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Uma página de comentários
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comments:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Comment' }
 *                 nextCursor: { type: string, nullable: true }
 *   post:
 *     tags: [Posts]
 *     summary: Comenta em um post
 *     description: Até 300 caracteres. Limite de 120 comentários por hora.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 300, example: Que manobra! }
 *     responses:
 *       201:
 *         description: Comentário criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Comment' }
 */
communityRoutes.get("/posts/:id/comments", requireAuth, community.listComments);
communityRoutes.post("/posts/:id/comments", requireAuth, limits.commenting, community.createComment);

/**
 * @openapi
 * /comments/{id}:
 *   delete:
 *     tags: [Posts]
 *     summary: Apaga um comentário
 *     description: Quem escreveu, o dono do post ou um administrador.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Comentário apagado
 *       404:
 *         description: Comentário não encontrado (ou sem permissão)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
communityRoutes.delete("/comments/:id", requireAuth, community.deleteComment);

/**
 * @openapi
 * /profiles:
 *   get:
 *     tags: [Users]
 *     summary: Busca pessoas pelo nome ou @username
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         required: true
 *         schema: { type: string, example: tony }
 *     responses:
 *       200:
 *         description: Até 20 pessoas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Author' }
 */
communityRoutes.get("/profiles", requireAuth, community.searchProfiles);

/**
 * @openapi
 * /profiles/{username}:
 *   get:
 *     tags: [Users]
 *     summary: Perfil público de uma pessoa
 *     description: Mostra nome, @, foto, bio, nível de skate e contadores. Nunca mostra email nem idade.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string, example: tonyhawk }
 *     responses:
 *       200:
 *         description: O perfil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Profile' }
 *       404:
 *         description: Perfil não encontrado ou conta suspensa
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
communityRoutes.get("/profiles/:username", requireAuth, community.getProfile);

/**
 * @openapi
 * /profiles/{username}/posts:
 *   get:
 *     tags: [Users]
 *     summary: Posts de uma pessoa (mais recentes primeiro)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Uma página de posts
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PostPage' }
 */
communityRoutes.get("/profiles/:username/posts", requireAuth, community.getProfilePosts);

/**
 * @openapi
 * /profiles/{username}/follow:
 *   put:
 *     tags: [Users]
 *     summary: Segue uma pessoa
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Situação atual
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 followers: { type: integer }
 *                 followedByMe: { type: boolean }
 *       400:
 *         description: Tentou seguir a si mesmo
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Users]
 *     summary: Deixa de seguir
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Situação atual
 */
/**
 * @openapi
 * /profiles/{username}/followers:
 *   get:
 *     tags: [Users]
 *     summary: Quem segue a pessoa (os mais recentes primeiro)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: Id da última pessoa já recebida
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Uma página de pessoas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 people:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Author'
 *                       - type: object
 *                         properties:
 *                           followedByMe: { type: boolean }
 *                           isMe: { type: boolean }
 *                 nextCursor: { type: string, nullable: true }
 * /profiles/{username}/following:
 *   get:
 *     tags: [Users]
 *     summary: Quem a pessoa segue (os mais recentes primeiro)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Uma página de pessoas (mesmo formato da lista de seguidores)
 */
communityRoutes.get("/profiles/:username/followers", requireAuth, community.listFollowers);
communityRoutes.get("/profiles/:username/following", requireAuth, community.listFollowing);

communityRoutes.put("/profiles/:username/follow", requireAuth, community.follow);
communityRoutes.delete("/profiles/:username/follow", requireAuth, community.unfollow);
